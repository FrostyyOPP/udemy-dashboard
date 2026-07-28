// One-time/periodic import of real Coursera partner revenue from a manually
// provided report file (e.g. "ANGUS + ALEX Till 2026 Q1.xlsx"). Coursera's
// Partner API exposes no revenue data at all — this is the only source, and
// it only updates when the user supplies a fresh export.
//
// The report has one row per (course slug, channel, quarter, business line)
// combination — a single course can have 20-30+ rows. We sum
// "Partner Revenue Share Amount" (the partner's actual take, after Coursera's
// cut) and "Item Completions" per slug across every row, regardless of
// channel/quarter/business line, to get a lifetime total.
//
// Slugs in this file span BOTH the Starweaver and CIN course catalogs
// (confirmed: 120 of 162 known Starweaver slugs and 317 of 467 known CIN
// slugs matched in the first import) — readCourseraMetrics/readCourseraCinMetrics
// both merge this table in by slug, so no need to split the import itself.
//
// Run: node importCourseraRevenue.js "/path/to/report.xlsx"
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import xlsx from 'xlsx';
import { writeCourseraRevenueImport } from './db.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node importCourseraRevenue.js "/path/to/report.xlsx"');
  process.exit(1);
}

const wb = xlsx.read(readFileSync(filePath));
const sheet = wb.Sheets['Raw'] || wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

const agg = new Map();
for (const r of rows) {
  const slug = (r['Course/Specialization Slug'] || '').toString().trim().toLowerCase();
  if (!slug) continue;
  const name = r['Course/Specialization'];
  const revenue = Number(r['Partner Revenue Share Amount']) || 0;
  const completions = Number(r['Item Completions']) || 0;
  const quarter = r['Quarter'];
  if (!agg.has(slug)) agg.set(slug, { slug, courseName: name, revenue: 0, completions: 0, quarters: new Set() });
  const a = agg.get(slug);
  a.revenue += revenue;
  a.completions += completions;
  if (quarter) a.quarters.add(quarter);
  if (name) a.courseName = name; // keep the most recently seen display name
}

const imported = [...agg.values()].map((a) => ({
  slug: a.slug, courseName: a.courseName, revenue: a.revenue, completions: a.completions, quarterCount: a.quarters.size,
}));

const result = writeCourseraRevenueImport(imported, basename(filePath));
const totalRevenue = imported.reduce((s, r) => s + r.revenue, 0);
console.log(`✅ Imported revenue for ${result.written} courses · $${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })} total → dashboard.db`);
console.log('   Top 5 by revenue:');
for (const r of [...imported].sort((a, b) => b.revenue - a.revenue).slice(0, 5)) {
  console.log(`   $${r.revenue.toFixed(2)} — ${r.courseName} (${r.slug})`);
}
