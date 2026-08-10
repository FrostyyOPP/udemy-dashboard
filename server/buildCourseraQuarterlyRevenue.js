// Course-by-course Coursera partner revenue for the last N quarters.
//
// The dashboard's coursera_revenue_import table stores only LIFETIME totals per
// slug, so a quarter breakdown can never be reconstructed from it — it has to
// come from the "Revenue Share By Product" exports, which carry a Quarter
// column. This script reads one or more of those exports and pivots
// (slug x quarter) into an Excel sheet: Title | Q-2 | Q-1 | latest Q | total.
//
// Coursera's export UI caps at 500 rows and the report emits one row per
// (course x channel x quarter x business line), so ONE export covering three
// quarters across ~140 courses will silently truncate. Export one quarter per
// file and pass them all here. Any file with exactly 500 rows is flagged loudly.
//
// Starweaver-vs-CIN: slugs from both catalogs can appear in an export. Pass
// --starweaver-only to keep just the slugs present in coursera_course_status,
// which is scraped from the Starweaver partner console.
//
// Run: node buildCourseraQuarterlyRevenue.js [--starweaver-only] [--quarters=3] \
//        [--out=path.xlsx] "Q4.xlsx" "Q1.xlsx" "Q2.xlsx"
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import xlsx from 'xlsx';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const starweaverOnly = argv.includes('--starweaver-only');
const nQuarters = Number(flag('quarters', 3));
const outPath = flag('out', join(__dirname, '..', 'exports', 'Coursera_Revenue_By_Quarter.xlsx'));
const files = argv.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('Usage: node buildCourseraQuarterlyRevenue.js [--starweaver-only] [--quarters=3] [--out=...] "<export.xlsx>" ...');
  console.error('Pass one file per quarter — a single multi-quarter export will hit Coursera\'s 500-row cap.');
  process.exit(1);
}

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// slug -> { name, byQuarter: {q: {rev, net}} }
const agg = new Map();
const allQuarters = new Set();
const warnings = [];

for (const filePath of files) {
  const wb = xlsx.read(readFileSync(filePath));
  const sheet = wb.Sheets.Raw || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  const label = basename(filePath);
  const qs = new Set();

  for (const r of rows) {
    const slug = String(r['Course/Specialization Slug'] || '').trim().toLowerCase();
    const q = r.Quarter ? String(r.Quarter).trim() : null;
    if (!slug || !q || q === 'None') continue;
    qs.add(q);
    allQuarters.add(q);
    if (!agg.has(slug)) agg.set(slug, { slug, name: null, byQuarter: {} });
    const a = agg.get(slug);
    if (r['Course/Specialization']) a.name = String(r['Course/Specialization']).trim();
    const cell = (a.byQuarter[q] ||= { rev: 0, net: 0 });
    cell.rev += num(r['Partner Revenue Share Amount']);
    cell.net += num(r['Net Sales Amount'] ?? r['Net Sales']);
  }

  console.log(`${label}: ${rows.length} rows · quarters ${[...qs].sort().join(', ') || '(none)'}`);
  if (rows.length === 500) {
    const w = `${label} has exactly 500 rows — Coursera caps this export at 500, so it is TRUNCATED. Re-export a narrower slice.`;
    warnings.push(w);
    console.warn(`   ⚠️  ${w}`);
  }
}

// Keep only the most recent N quarters present across all files.
const quarters = [...allQuarters].sort().slice(-nQuarters);
if (!quarters.length) { console.error('❌ No Quarter values found — is this the right report?'); process.exit(1); }
console.log(`\nQuarters reported: ${quarters.join(' · ')}`);

let rows = [...agg.values()];
if (starweaverOnly) {
  const db = new Database(join(__dirname, 'dashboard.db'), { readonly: true });
  const swSlugs = new Set(db.prepare('SELECT slug FROM coursera_course_status WHERE slug IS NOT NULL')
    .all().map((r) => r.slug.toLowerCase()));
  db.close();
  const before = rows.length;
  rows = rows.filter((r) => swSlugs.has(r.slug));
  console.log(`Starweaver filter: ${rows.length} of ${before} slugs matched the partner console.`);
}

// Drop courses with no money in any of the reported quarters — they only add noise.
const withTotals = rows.map((r) => {
  const per = quarters.map((q) => r.byQuarter[q]?.rev || 0);
  const net = quarters.reduce((s, q) => s + (r.byQuarter[q]?.net || 0), 0);
  return { ...r, per, total: per.reduce((s, v) => s + v, 0), net };
}).filter((r) => r.total !== 0 || r.net !== 0)
  .sort((a, b) => b.total - a.total);

const out = xlsx.utils.book_new();
const header = ['#', 'Course Title', ...quarters, `Total (${quarters.length} qtrs)`, 'Net Sales'];
const aoa = [header, ...withTotals.map((r, i) => [i + 1, r.name || r.slug, ...r.per, r.total, r.net])];
const grand = quarters.map((_, i) => withTotals.reduce((s, r) => s + r.per[i], 0));
aoa.push([]);
aoa.push(['', 'TOTAL', ...grand, grand.reduce((s, v) => s + v, 0),
  withTotals.reduce((s, r) => s + r.net, 0)]);

const ws = xlsx.utils.aoa_to_sheet(aoa);
ws['!cols'] = [{ wch: 5 }, { wch: 60 }, ...quarters.map(() => ({ wch: 15 })), { wch: 17 }, { wch: 15 }];
ws['!freeze'] = { xSplit: 2, ySplit: 1 };
xlsx.utils.book_append_sheet(out, ws, 'Revenue by quarter');
xlsx.writeFile(out, outPath);

console.log(`\n✅ ${withTotals.length} courses → ${outPath}`);
quarters.forEach((q, i) => console.log(`   ${q}: $${grand[i].toLocaleString(undefined, { maximumFractionDigits: 2 })}`));
console.log(`   Total: $${grand.reduce((s, v) => s + v, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
if (warnings.length) { console.log('\n⚠️  warnings:'); warnings.forEach((w) => console.log(`   - ${w}`)); }
