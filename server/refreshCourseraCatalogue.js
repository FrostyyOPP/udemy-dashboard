// Refresh the Coursera course list + status from Coursera's PUBLIC partner
// catalogue, no login required.
//
// Why this exists: coursera_course_status is written by an admin-console
// scraper that needs a session, and that session lapses often. When it does,
// the table silently ages — on 2026-08-12 it listed 137 launched courses while
// Coursera's own catalogue held 150, and the 10 newest (launched 6-11 Aug) were
// invisible to every downstream script.
//
// partners.v1/{id}?fields=courseIds is the authoritative membership list and is
// public, so this keeps the catalogue current between sessions. It cannot
// replace the admin scrape entirely — that one also brings review text — but it
// keeps course/slug/status right.
//
// Run: node refreshCourseraCatalogue.js [--partner=1510] [--dry-run]
import { writeCourseraCourseStatus, readCourseraCourseStatus } from './db.js';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const PARTNER = arg('partner', '1510');
const DRY = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const get = async (url) => {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(700); continue; }
      return await r.json();
    } catch { await sleep(700); }
  }
  return null;
};

const pj = await get(`https://api.coursera.org/api/partners.v1/${PARTNER}?fields=name,courseIds`);
const partner = (pj?.elements || [])[0];
if (!partner) { console.error(`❌ partner ${PARTNER} not found`); process.exit(1); }
const ids = partner.courseIds || [];
console.log(`${partner.name} (${PARTNER}) — ${ids.length} courses in the public catalogue\n`);

const rows = [];
for (let i = 0; i < ids.length; i++) {
  const j = await get(`https://api.coursera.org/api/onDemandCourses.v1/${ids[i]}?fields=name,slug,courseStatus,launchedAt`);
  const e = (j?.elements || [])[0];
  if (e?.slug) {
    rows.push({ courseName: (e.name || '').trim(), slug: e.slug, status: e.courseStatus || null,
                launchedAt: e.launchedAt || null });
  }
  if ((i + 1) % 40 === 0) console.log(`  ${i + 1}/${ids.length}`);
  await sleep(95);
}

const before = readCourseraCourseStatus();
const known = new Set(Object.keys(before.byName).map((n) => n.trim().toLowerCase()));
const added = rows.filter((r) => !known.has(r.courseName.toLowerCase()));
const tally = rows.reduce((a, r) => { a[r.status || '?'] = (a[r.status || '?'] || 0) + 1; return a; }, {});

console.log(`\nstatus tally: ${JSON.stringify(tally)}`);
console.log(`already in coursera_course_status: ${rows.length - added.length}`);
console.log(`NEW to the table: ${added.length}`);
for (const a of added) {
  const d = a.launchedAt ? new Date(a.launchedAt).toISOString().slice(0, 10) : '—';
  console.log(`   [${a.status}] launched ${d}  ${a.courseName}`);
}

if (DRY) { console.log('\n[dry run] nothing written'); process.exit(0); }
// upsertMerge: never deletes, so admin-scraped rows for courses outside this
// partner catalogue (drafts, retired) survive untouched.
const res = writeCourseraCourseStatus(rows);
console.log(`\n✅ ${res.written ?? rows.length} rows merged into coursera_course_status`);
const after = readCourseraCourseStatus();
console.log(`   table: ${Object.keys(before.byName).length} → ${Object.keys(after.byName).length} rows`);
