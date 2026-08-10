// Import Coursera partner revenue from one or more "Revenue Share By Product"
// exports and store LIFETIME totals per course slug. Coursera exposes no
// revenue via any API, so these manual exports are the only source.
//
// The report has one row per (slug, channel, quarter, business line), so a
// single course can have 20-30+ rows. We sum "Partner Revenue Share Amount"
// (the partner's take, after Coursera's cut) and "Item Completions" per slug.
//
// IMPORTANT — pass EVERY source file on every run. Rows are upserted by slug,
// so importing a single new quarter on its own would overwrite each course's
// lifetime figure with that quarter alone.
//
// Slugs span both the Starweaver and CIN catalogs; readCourseraMetrics and
// readCourseraCinMetrics each merge this table in by slug, so the import
// itself does not need splitting. Coursera's export UI caps at 500 rows —
// a file with exactly 500 rows is almost certainly truncated, and this script
// warns when it sees that shape.
//
// Run: node importCourseraRevenue.js "file1.xlsx" ["file2.xlsx" ...]
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { writeCourseraRevenueImport } from './db.js';

// Only lifetime totals reach the database, so the quarter breakdown lives
// nowhere but these source files. Archive a copy on import — a set of exports
// read straight out of ~/Downloads was later deleted, and with it the only
// per-quarter record we had.
const ARCHIVE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'coursera-revenue');
function archive(filePath) {
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dest = join(ARCHIVE_DIR, basename(filePath));
    if (resolve(filePath) === resolve(dest)) return null;
    if (existsSync(dest)) return `${basename(filePath)} (already archived)`;
    copyFileSync(filePath, dest);
    return basename(filePath);
  } catch (e) {
    console.warn(`   ⚠️  could not archive ${basename(filePath)}: ${e.message}`);
    return null;
  }
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node importCourseraRevenue.js "<file.xlsx>" ["<file2.xlsx>" ...]');
  console.error('Pass every export — lifetime totals are rebuilt from scratch on each run.');
  process.exit(1);
}

// values arrive either as numbers or as "$1,234.56"
const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const agg = new Map();
let grandRows = 0;
const warnings = [];

for (const filePath of files) {
  const wb = xlsx.read(readFileSync(filePath));
  const sheet = wb.Sheets.Raw || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  const label = basename(filePath);
  const quarters = new Set();
  let fileRevenue = 0;

  for (const r of rows) {
    const slug = String(r['Course/Specialization Slug'] || '').trim().toLowerCase();
    if (!slug) continue;
    const q = r.Quarter ? String(r.Quarter).trim() : null;
    if (q && q !== 'None') quarters.add(q);
    if (!agg.has(slug)) agg.set(slug, { slug, courseName: null, revenue: 0, completions: 0, quarters: new Set() });
    const a = agg.get(slug);
    a.revenue += num(r['Partner Revenue Share Amount']);
    a.completions += num(r['Item Completions']);
    if (q && q !== 'None') a.quarters.add(q);
    if (r['Course/Specialization']) a.courseName = r['Course/Specialization'];
    fileRevenue += num(r['Partner Revenue Share Amount']);
    grandRows++;
  }

  const qs = [...quarters].sort();
  console.log(label);
  console.log(`   ${rows.length} rows · ${qs.length ? `${qs[0]} → ${qs[qs.length - 1]} (${qs.length}q)` : 'no quarter column'} · $${fileRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  if (rows.length === 500) {
    const w = `${label} has exactly 500 rows — Coursera caps this export at 500, so it is very likely TRUNCATED (revenue understated).`;
    warnings.push(w);
    console.warn(`   ⚠️  ${w}`);
  }
}

const imported = [...agg.values()].map((a) => ({
  slug: a.slug, courseName: a.courseName, revenue: a.revenue,
  completions: a.completions, quarterCount: a.quarters.size,
}));
const total = imported.reduce((s, r) => s + r.revenue, 0);
const allQuarters = [...new Set([...agg.values()].flatMap((a) => [...a.quarters]))].sort();

const archived = files.map(archive).filter(Boolean);
if (archived.length) console.log(`\n📦 archived to exports/coursera-revenue/: ${archived.join(', ')}`);

const result = writeCourseraRevenueImport(imported, files.map((f) => basename(f)).join(' + '));
console.log(`\n✅ ${result.written} courses · ${grandRows} source rows · $${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} lifetime partner revenue`);
console.log(`   coverage: ${allQuarters[0]} → ${allQuarters[allQuarters.length - 1]}  (${allQuarters.length} quarters)`);
console.log('   Top 5 by revenue:');
for (const r of [...imported].sort((a, b) => b.revenue - a.revenue).slice(0, 5)) {
  console.log(`   $${r.revenue.toFixed(2)} — ${r.courseName} (${r.slug})`);
}
if (warnings.length) { console.log('\n⚠️  warnings:'); warnings.forEach((w) => console.log(`   - ${w}`)); }
