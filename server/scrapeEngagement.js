// Pulls instructor engagement metrics (total minutes watched, active students,
// monthly trend, and per-course breakdown including Udemy Business coverage)
// using the connected session + a HEADED browser (Cloudflare blocks headless on
// api-2.0). Writes to dashboard.db via db.js's guarded writer.
// Run: npm run scrape:engagement
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { udemyGet } from './udemyClient.js';
import { writeEngagement } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Not connected. Use "Connect Udemy" in the dashboard first.');
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

console.log('Opening the course engagement page…');
await page.goto('https://www.udemy.com/instructor/performance/engagement/?date_filter=year', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(3000);

async function apiGet(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) { try { return JSON.parse(body); } catch {} }
    await sleep(1500);
  }
  return null;
}

const data = await apiGet(
  'https://www.udemy.com/api-2.0/instructor-performance/engagement-metrics/?date_filter=year&data_scope=all' +
  '&fields[ds_instructor_course_engagement_snapshot]=@default,monthly,course_metrics&fields[ds_course_engagement_snapshot]=@default,monthly,course&page_size=500'
);
const snap = data?.results?.[0];
if (!snap) {
  console.error('❌ Could not read engagement data. Re-connect and retry.');
  await browser.close();
  process.exit(1);
}

const totalMinutes = snap.minutes_taught ?? null;
const activeStudents = snap.active_students ?? null;
const monthly = (snap.monthly || []).map((m) => ({ month: m.date, minutesTaught: m.minutes_taught, activeStudents: m.active_students }));

// numericId (from this response) → slug (from course.url), then slug → instructor-API id.
const numToSlug = {};
const numData = {};
// Per-course `monthly` lets us split the total monthly minutes into
// Udemy-Business vs non-UB, since the top-level `monthly` is an all-courses aggregate.
const ubMonthlyMap = {}; // month -> { ub, nonUb }
for (const c of snap.course_metrics || []) {
  const slug = (c.course?.url || '').match(/\/course\/([^/]+)\//)?.[1];
  if (!slug) continue;
  const isUb = !!c.course.is_in_any_ufb_content_collection;
  numToSlug[c.course.id] = slug;
  numData[c.course.id] = { minutesTaught: c.minutes_taught, activeStudents: c.active_students, isUdemyBusiness: isUb, monthly: c.monthly || [] };
  for (const m of c.monthly || []) {
    const bucket = ubMonthlyMap[m.date] || (ubMonthlyMap[m.date] = { ub: 0, nonUb: 0 });
    bucket[isUb ? 'ub' : 'nonUb'] += m.minutes_taught || 0;
  }
}
const ubMonthly = Object.entries(ubMonthlyMap)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([month, { ub, nonUb }]) => ({ month, ubMinutes: ub, nonUbMinutes: nonUb }));

await browser.close();

const slugToId = {};
let p2 = 1;
while (true) {
  const d = await udemyGet('/taught-courses/courses/', { page: p2, page_size: 100, 'fields[course]': '@default,published_title' });
  for (const c of d.results || []) slugToId[c.published_title] = c.id;
  if (!d.next) break;
  p2 += 1;
}

const perCourse = {};
const courseMonthly = [];
for (const [numId, slug] of Object.entries(numToSlug)) {
  const id = slugToId[slug];
  if (!id) continue;
  const { monthly: courseMonths, ...rest } = numData[numId];
  perCourse[id] = rest;
  for (const m of courseMonths) courseMonthly.push({ courseId: id, month: m.date, minutesTaught: m.minutes_taught });
}

const result = writeEngagement({ totalMinutes, activeStudents, monthly, perCourse, ubMonthly, courseMonthly });
const mapped = Object.keys(perCourse).length;
const ub = Object.values(perCourse).filter((c) => c.isUdemyBusiness).length;
if (result.guarded) {
  console.error(`⚠️ Refused to write — only ${mapped} courses mapped, looks like a partial/failed run. Kept existing data. Re-run after reconnecting.`);
  process.exit(1);
}
console.log(`✅ ${Math.round(totalMinutes).toLocaleString()} total minutes taught · ${activeStudents.toLocaleString()} active students · ${mapped} courses mapped (${ub} in Udemy Business) · ${ubMonthly.length} months of UB/non-UB split · ${courseMonthly.length} course-month rows → dashboard.db`);
