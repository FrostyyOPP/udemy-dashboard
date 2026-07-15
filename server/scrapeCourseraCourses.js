// Pulls the Coursera course list for the connected partner (Starweaver) using
// the session + a HEADED browser. Gets admin course ids from the partner console,
// then course names via onDemandCourses.v1. Writes to dashboard.db via db.js's
// guarded writer. Run: npm run coursera:courses   (a browser window opens — leave it)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { writeCourseraCourses } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'coursera-auth.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Coursera not connected. Use Connect Coursera in the dashboard first.');
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

await minimizeWindow(ctx, page); // keep the automation window out of the user's way
// Collect admin course ids from the partner console's permission calls.
const courseIds = new Set();
page.on('response', async (res) => {
  const u = res.url();
  if (/authoringCourseContexts\.v1\/([A-Za-z0-9_-]+)\//.test(u)) {
    courseIds.add(u.match(/authoringCourseContexts\.v1\/([A-Za-z0-9_-]+)\//)[1]);
  }
  if (/opname=AuthoringUserCoursePermissions/.test(u) || /opname=AdminUserPermissionsQuery/.test(u)) {
    try {
      const t = await res.text();
      for (const m of t.matchAll(/130949192~([A-Za-z0-9_-]{20,})/g)) courseIds.add(m[1]);
    } catch {}
  }
});

console.log('Opening the Starweaver partner console…');
await page.goto('https://www.coursera.org/admin/starweaver/home/courses', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(6000);
// scroll to trigger lazy-loaded course rows
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2000).catch(() => {}); await sleep(1500); }

const ids = [...courseIds];
console.log(`Found ${ids.length} course ids. Fetching names…`);

async function name(id) {
  return await page.evaluate(async (cid) => {
    try {
      const r = await fetch(`https://www.coursera.org/api/onDemandCourses.v1/${cid}?fields=name,slug`, {
        credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const el = j.elements?.[0];
      return el ? { id: cid, name: el.name, slug: el.slug } : null;
    } catch { return null; }
  }, id);
}

const courses = [];
for (const id of ids) {
  const c = await name(id);
  if (c) courses.push(c);
  process.stdout.write(`\r  ${courses.length}/${ids.length}`);
  await sleep(400);
}
process.stdout.write('\n');
await browser.close();

const result = writeCourseraCourses(courses);
if (result.guarded) {
  console.error(`⚠️ Refused to write — only ${courses.length} courses found, looks like a partial/failed run. Kept existing data. Re-run after reconnecting.`);
  process.exit(1);
}
console.log(`✅ ${courses.length} Coursera courses → dashboard.db`);
