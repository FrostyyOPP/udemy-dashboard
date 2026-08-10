// Import Coursera partner revenue PER QUARTER into coursera_revenue_quarterly.
//
// importCourseraRevenue.js stores a lifetime total per course, which cannot
// answer "what did this course earn last quarter". Worse, the quarter split
// only ever lived in the source spreadsheets — when a set of exports was
// deleted from ~/Downloads, the split went with it and had to be rebuilt from
// a file the user happened to still have. This script makes that data durable.
//
// Two source shapes are supported and auto-detected:
//
//   1. "Revenue Share By Product" export — one row per
//      (course x channel x quarter x business line), WITH a slug column.
//      Product Type splits Course / Coursera Plus / Specialization. Course and
//      Coursera Plus are both per-course revenue on the same slug and are
//      summed; Specialization is a separate product, stored with
//      product_type='specialization' so it never lands in a course's figure.
//      Coursera caps this export at 500 rows — a file with exactly 500 is
//      almost certainly truncated and is flagged loudly.
//
//   2. "ALL Coursera Data - REPORT" — the historical roll-up, NO slug column.
//      Its Channels column identifies the catalog: ALEX is CIN, SWO and ANGUS
//      are Starweaver. Course rows must be keyed on "RFP Advance Product Name"
//      (the individual course); "Starweaver Name" is the parent PROGRAM
//      ("GenAI Data and Analytics Academy") and keying on it silently merges
//      every course in a bootcamp into one bucket.
//
// Imports are merged, never replaced — each file usually covers only a few
// quarters and older ones must survive.
//
// Run: node importCourseraQuarterlyRevenue.js "<file.xlsx>" ["<file2.xlsx>" ...]
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { writeCourseraRevenueQuarterly, readCourseraQuarterTotals } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = join(__dirname, '..', 'exports', 'coursera-revenue');

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: node importCourseraQuarterlyRevenue.js "<file.xlsx>" ["<file2.xlsx>" ...]');
  process.exit(1);
}

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function archive(filePath) {
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dest = join(ARCHIVE_DIR, basename(filePath));
    if (resolve(filePath) === resolve(dest) || existsSync(dest)) return null;
    copyFileSync(filePath, dest);
    return basename(filePath);
  } catch (e) {
    console.warn(`   ⚠️  could not archive ${basename(filePath)}: ${e.message}`);
    return null;
  }
}

// (catalog|courseKey|quarter|productType) -> accumulator
const agg = new Map();
const bump = (k, patch) => {
  const cur = agg.get(k) || { revenue: 0, netSales: 0, completions: 0 };
  cur.revenue += patch.revenue || 0;
  cur.netSales += patch.netSales || 0;
  cur.completions += patch.completions || 0;
  Object.assign(cur, { ...patch, revenue: cur.revenue, netSales: cur.netSales, completions: cur.completions });
  agg.set(k, cur);
};
const warnings = [];

for (const filePath of files) {
  const label = basename(filePath);
  const wb = xlsx.read(readFileSync(filePath));
  // "All Data" is the historical report's tab; otherwise take Raw or the first.
  const sheetName = wb.SheetNames.includes('All Data') ? 'All Data'
    : (wb.SheetNames.includes('Raw') ? 'Raw' : wb.SheetNames[0]);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  if (!rows.length) { console.warn(`${label}: empty, skipped`); continue; }

  const cols = Object.keys(rows[0]);
  const hasSlug = cols.includes('Course/Specialization Slug');
  const isHistorical = cols.includes('RFP Advance Product Name') && cols.includes('Channels');
  const quarters = new Set();
  let kept = 0;

  if (hasSlug) {
    for (const r of rows) {
      const slug = String(r['Course/Specialization Slug'] || '').trim().toLowerCase();
      const quarter = String(r.Quarter || '').trim();
      if (!slug || !quarter || quarter === 'None') continue;
      const productType = String(r['Product Type'] || '') === 'Specialization' ? 'specialization' : 'course';
      quarters.add(quarter);
      kept++;
      bump(`starweaver|${slug}|${quarter}|${productType}`, {
        catalog: 'starweaver', courseKey: slug, quarter, productType,
        courseName: r['Course/Specialization'] ? String(r['Course/Specialization']).trim() : null,
        slug,
        revenue: num(r['Partner Revenue Share Amount']),
        netSales: num(r['Quarterly Net Sales']),
        completions: num(r['Item Completions']),
      });
    }
    if (rows.length === 500) {
      const w = `${label} has exactly 500 rows — Coursera caps this export at 500, so it is almost certainly TRUNCATED.`;
      warnings.push(w);
    }
  } else if (isHistorical) {
    for (const r of rows) {
      const quarter = String(r.Quarter || '').trim();
      if (!quarter || quarter === 'None') continue;
      const channel = String(r.Channels || '').trim().toUpperCase();
      const catalog = channel === 'ALEX' ? 'cin' : 'starweaver';
      const isSpec = String(r.Channel || '').trim().toUpperCase() === 'SPECIALIZATION';
      // Key on the per-course column; the "Starweaver Name" column is the
      // parent program and would merge a whole bootcamp into one row.
      const courseName = isSpec
        ? String(r['Starweaver Name'] || r['RFP Advance Product Name'] || '').replace(/\s*\n\s*/g, ' + ').trim()
        : String(r['RFP Advance Product Name'] || r['Starweaver Name'] || '').trim();
      const key = norm(courseName);
      if (!key) continue;
      const productType = isSpec ? 'specialization' : 'course';
      quarters.add(quarter);
      kept++;
      bump(`${catalog}|${key}|${quarter}|${productType}`, {
        catalog, courseKey: key, quarter, productType,
        courseName, slug: null,
        revenue: num(r['Partner Revenue Share Amount']),
        netSales: num(r['Quarterly Net Sales']),
        completions: 0,
      });
    }
  } else {
    console.warn(`${label}: unrecognised layout (no slug column, not the historical report) — skipped`);
    continue;
  }

  const qs = [...quarters].sort();
  console.log(`${label}  [${hasSlug ? 'by-slug export' : 'historical report'}]`);
  console.log(`   ${rows.length} rows · ${kept} usable · ${qs[0]} → ${qs[qs.length - 1]} (${qs.length}q)`);
  if (rows.length === 500) console.warn('   ⚠️  exactly 500 rows — likely truncated');
}

const out = [...agg.values()];
if (!out.length) { console.error('❌ nothing to import'); process.exit(1); }

const archived = files.map(archive).filter(Boolean);
if (archived.length) console.log(`\n📦 archived: ${archived.join(', ')}`);

const res = writeCourseraRevenueQuarterly(out, files.map((f) => basename(f)).join(' + '));
console.log(`\n✅ ${res.written} rows written · table ${res.before} → ${res.after}`);

console.log('\nStarweaver — partner revenue by quarter:');
for (const t of readCourseraQuarterTotals('starweaver')) {
  console.log(`   ${t.quarter}  ${t.product_type.padEnd(14)} $${t.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
}
if (warnings.length) { console.log('\n⚠️  warnings:'); warnings.forEach((w) => console.log(`   - ${w}`)); }
