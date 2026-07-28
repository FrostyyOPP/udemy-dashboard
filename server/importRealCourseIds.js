// One-time/periodic import of Udemy's own "eligible courses" CSV export (from
// the bulk-coupon-creation tool) — it carries the REAL numeric Udemy course id
// (e.g. 7260095), unlike the Instructor API's base64-ish id (e.g.
// "x01BLUM9ag..."), which is what's actually needed to create coupons via
// Udemy's bulk tool or URL-based flows. Matched to our course_id by exact
// title against the live taught-courses list, then stored via db.js's
// upsert-merge writer (never wipes courses missing from a given export).
// Run: node importRealCourseIds.js "/path/to/eligible_courses_*.csv"
import { readFileSync } from 'node:fs';
import { udemyGet } from './udemyClient.js';
import { writeUdemyRealCourseIds } from './db.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node importRealCourseIds.js "/path/to/eligible_courses.csv"');
  process.exit(1);
}

// Minimal RFC4180-ish CSV line parser (handles quoted fields, commas and
// doubled quotes inside them) — no need for a dependency for a file this small.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const raw = readFileSync(filePath, 'utf8');
const [header, ...dataRows] = parseCsv(raw);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const required = ['course_id', 'course_name', 'currency', 'best_price_value', 'min_custom_price', 'max_custom_price', 'coupons_remaining'];
for (const r of required) {
  if (!(r in col)) { console.error(`❌ CSV missing expected column "${r}"`); process.exit(1); }
}

const csvCourses = dataRows.map((r) => ({
  realCourseId: Number(r[col.course_id]),
  title: r[col.course_name].trim(),
  currency: r[col.currency],
  bestPriceValue: r[col.best_price_value] === '' ? null : Number(r[col.best_price_value]),
  minCustomPrice: r[col.min_custom_price] === '' ? null : Number(r[col.min_custom_price]),
  maxCustomPrice: r[col.max_custom_price] === '' ? null : Number(r[col.max_custom_price]),
  couponsRemaining: r[col.coupons_remaining] === '' ? null : Number(r[col.coupons_remaining]),
}));
console.log(`Parsed ${csvCourses.length} rows from CSV.`);

console.log('Fetching taught-courses list to match by title…');
const COURSE_FIELDS = 'id,title';
let allCourses = [];
for (let page = 1; page <= 10; page++) {
  const data = await udemyGet('/taught-courses/courses/', { page, page_size: 100, 'fields[course]': COURSE_FIELDS });
  allCourses.push(...(data.results || []));
  if (!data.next) break;
}
console.log(`Fetched ${allCourses.length} taught courses.`);

const byTitle = new Map(allCourses.map((c) => [c.title.trim(), c.id]));
const matched = [];
const unmatched = [];
for (const row of csvCourses) {
  const courseId = byTitle.get(row.title);
  if (courseId) matched.push({ courseId, ...row });
  else unmatched.push(row.title);
}

const result = writeUdemyRealCourseIds(matched);
console.log(`✅ Matched and wrote ${result.written}/${csvCourses.length} courses → dashboard.db`);
if (unmatched.length) {
  console.log(`⚠️ ${unmatched.length} title(s) had no exact match in the taught-courses list:`);
  unmatched.forEach((t) => console.log('   -', t));
}
