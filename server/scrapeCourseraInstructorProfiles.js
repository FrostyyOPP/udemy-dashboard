// Refresh every Coursera instructor profile across BOTH partner sides —
// Starweaver (1510) and the CIN catalogue — into coursera_instructor_profiles.
//
// One row per PERSON. A Coursera profile belongs to the individual, not to a
// partner org, so somebody teaching on both sides has a single profile and is
// stored once, with both side flags set.
//
// Everything here comes from PUBLIC APIs (partners.v1, onDemandCourses.v1,
// instructors.v1), so it refreshes without a partner session — deliberately,
// because the session lapses often and this audit should not go stale with it.
//
// Starweaver courses come from the public partner catalogue. CIN courses come
// from coursera_cin_metrics: partner 1342 is Coursera's own house brand with
// ~3,550 courses, the vast majority produced by other people, so scanning the
// whole thing would say nothing about Starweaver's SMEs.
//
// Run: node scrapeCourseraInstructorProfiles.js
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeCourseraInstructorProfiles, readCourseraInstructorProfiles } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_ID = '141793623';           // instructors@starweaver.com
const SW_PARTNER = '1510';
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

// --- course lists ----------------------------------------------------------
const pj = await get(`https://api.coursera.org/api/partners.v1/${SW_PARTNER}?fields=name,courseIds`);
const swIds = (pj?.elements || [])[0]?.courseIds || [];
if (!swIds.length) { console.error('❌ could not read the Starweaver partner catalogue'); process.exit(1); }

const db = new Database(join(__dirname, 'dashboard.db'), { readonly: true });
const cinRows = db.prepare('SELECT slug, enrollments FROM coursera_cin_metrics WHERE slug IS NOT NULL').all();
const swEnroll = new Map();
try {
  const snap = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(__dirname, 'coursera-enrollment-latest.json'), 'utf8')));
  for (const c of snap.courses || []) swEnroll.set(String(c.slug).toLowerCase(), c.enrollments || 0);
} catch { /* enrollment is enrichment, not a requirement */ }
db.close();
console.log(`Starweaver: ${swIds.length} courses · CIN: ${cinRows.length} courses\n`);

// --- collect instructor ids per side --------------------------------------
const acc = new Map();   // id -> { swCourses, cinCourses, enrollments }
const bump = (id, side, enr) => {
  const a = acc.get(id) || { swCourses: 0, cinCourses: 0, enrollments: 0 };
  if (side === 'sw') a.swCourses += 1; else a.cinCourses += 1;
  a.enrollments += (enr || 0);
  acc.set(id, a);
};

for (let i = 0; i < swIds.length; i++) {
  const j = await get(`https://api.coursera.org/api/onDemandCourses.v1/${swIds[i]}?fields=slug,instructorIds`);
  const e = (j?.elements || [])[0];
  const enr = swEnroll.get(String(e?.slug || '').toLowerCase()) || 0;
  for (const id of e?.instructorIds || []) bump(String(id), 'sw', enr);
  if ((i + 1) % 50 === 0) console.log(`  starweaver ${i + 1}/${swIds.length}`);
  await sleep(95);
}
for (let i = 0; i < cinRows.length; i++) {
  const c = cinRows[i];
  const j = await get(`https://api.coursera.org/api/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(c.slug)}&fields=instructorIds`);
  const e = (j?.elements || [])[0];
  for (const id of e?.instructorIds || []) bump(String(id), 'cin', c.enrollments || 0);
  if ((i + 1) % 50 === 0) console.log(`  cin ${i + 1}/${cinRows.length}`);
  await sleep(95);
}
console.log(`\ndistinct instructors: ${acc.size}`);

// --- resolve each profile --------------------------------------------------
const rows = [];
const ids = [...acc.keys()];
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const j = await get(`https://api.coursera.org/api/instructors.v1/${id}?fields=fullName,title,bio,photo,websites`);
  const e = (j?.elements || [])[0];
  const w = e?.websites || {};
  const a = acc.get(id);
  const clean = (v) => { const s = String(v || '').trim(); return s || null; };
  rows.push({
    instructorId: id,
    fullName: (e?.fullName || '').trim() || null,
    title: clean(e?.title), bio: clean(e?.bio), photo: clean(e?.photo),
    website: clean(w.website), linkedin: clean(w.websiteLinkedin), twitter: clean(w.websiteTwitter),
    facebook: clean(w.websiteFacebook), gplus: clean(w.websiteGplus),
    profileUrl: `https://www.coursera.org/instructor/~${id}`,
    onStarweaver: a.swCourses > 0, onCin: a.cinCourses > 0,
    swCourses: a.swCourses, cinCourses: a.cinCourses, enrollments: a.enrollments,
    isShared: id === SHARED_ID,
  });
  if ((i + 1) % 30 === 0) console.log(`  profiles ${i + 1}/${ids.length}`);
  await sleep(95);
}

const res = writeCourseraInstructorProfiles(rows);
if (!res.ok) { console.error(`❌ refused: ${res.error || 'guard tripped'}`); process.exit(1); }
console.log(`\n✅ ${res.written} profiles stored`);

const { summary } = readCourseraInstructorProfiles();
console.log('\ncompleteness (real people only):');
console.log(`   people                : ${summary.people}   (on both sides: ${summary.onBothSides})`);
console.log(`   website — working     : ${summary.workingWebsite}`);
console.log(`   website — DEAD (go.*) : ${summary.deadWebsite}`);
console.log(`   website — MISSING     : ${summary.missingWebsite}`);
console.log(`   LinkedIn missing      : ${summary.missingLinkedin}`);
console.log(`   bio missing           : ${summary.missingBio}`);
console.log(`   job title missing     : ${summary.missingTitle}`);
console.log(`   photo missing         : ${summary.missingPhoto}`);
