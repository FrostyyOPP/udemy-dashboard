// Checks whether instructors@starweaver.com is on staff (role = "Instructor")
// for every Coursera course, using the connected session + a HEADED browser.
// KEY DISCOVERY: /api/staffMemberships.v1/?q=partnerStaffByCourse returns staff
// memberships for the WHOLE partner in one call (not just the seed courseId) —
// no per-course page visits needed. Writes to dashboard.db via db.js's guarded
// writer. Run: npm run coursera:instructors
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { readCourseraCourses, writeCourseraInstructorCheck } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'coursera-auth.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const STARWEAVER_INSTRUCTOR_EMAIL = 'instructors@starweaver.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Coursera not connected. Use "Connect Coursera" in the dashboard first.');
  process.exit(1);
}

const { courses: knownCourses } = readCourseraCourses();
const seedCourseId = knownCourses[0]?.id;
if (!seedCourseId) {
  console.error('❌ No known Coursera course id to seed the request. Run "npm run coursera:courses" first.');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await minimizeWindow(ctx, page);

console.log('Opening the Starweaver partner console…');
await page.goto('https://www.coursera.org/admin/starweaver/home/courses', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(3000);

console.log('Fetching partner-wide staff memberships…');
const data = await page.evaluate(async ({ seedCourseId }) => {
  const url = 'https://www.coursera.org/api/staffMemberships.v1/'
    + `?q=partnerStaffByCourse&courseId=${seedCourseId}&includes=users%2Crole`
    + '&fields=users.v1(fullName%2Cemail)%2CpartnerRoleTemplates.v1(name%2CisInternal)&limit=5000&start=0';
  const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  return r.json();
}, { seedCourseId });

if (!data?.elements || !data?.linked) {
  console.error('❌ Could not read staff memberships. Re-connect Coursera and retry.');
  await browser.close();
  process.exit(1);
}

const users = data.linked['users.v1'] || [];
const roleTemplates = data.linked['partnerRoleTemplates.v1'] || [];
const starweaverUser = users.find((u) => (u.email || '').toLowerCase() === STARWEAVER_INSTRUCTOR_EMAIL);
if (!starweaverUser) {
  console.error(`❌ ${STARWEAVER_INSTRUCTOR_EMAIL} was not found in the partner's staff roster at all.`);
  await browser.close();
  process.exit(1);
}
const instructorRoleIds = new Set(roleTemplates.filter((r) => r.name === 'Instructor').map((r) => r.id));

const courseIds = new Set();
for (const el of data.elements) {
  if (el.scope?.typeName === 'COURSE' && el.userId === starweaverUser.id && instructorRoleIds.has(el.roleId)) {
    courseIds.add(el.scope.id);
  }
}
console.log(`${STARWEAVER_INSTRUCTOR_EMAIL} is an Instructor on ${courseIds.size} courses. Resolving names…`);

async function nameFor(courseId) {
  return await page.evaluate(async (cid) => {
    try {
      const r = await fetch(`https://www.coursera.org/api/onDemandCourses.v1/${cid}?fields=name`, {
        credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.elements?.[0]?.name ?? null;
    } catch { return null; }
  }, courseId);
}

const names = [];
for (const id of courseIds) {
  const name = await nameFor(id);
  if (name) names.push(name.trim());
  await sleep(300);
}

await browser.close();

const result = writeCourseraInstructorCheck(names);
if (result.guarded) {
  console.error(`⚠️ Refused to write — only ${names.length} courses found, looks like a partial/failed run. Kept existing data. Re-run after reconnecting.`);
  process.exit(1);
}
console.log(`✅ ${names.length} courses have ${STARWEAVER_INSTRUCTOR_EMAIL} as Instructor → dashboard.db`);
