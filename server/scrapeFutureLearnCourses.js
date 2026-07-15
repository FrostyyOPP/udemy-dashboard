// Pulls the FutureLearn course list (title, code, category, wishlist count,
// and the most relevant run's status/start date) from the org admin panel.
// Session-based (no partner API). Writes to dashboard.db via db.js's guarded
// writer. Run: npm run futurelearn:courses
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { writeFutureLearnCourses } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'futurelearn-auth.json');
const COURSES_URL = 'https://www.futurelearn.com/admin/organisations/starweaver/courses';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Not connected. Use "Connect FutureLearn" in the dashboard first.');
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

console.log('Opening the FutureLearn courses admin panel…');
await page.goto(COURSES_URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

if (/\/sign-in|\/login/i.test(page.url())) {
  console.error('❌ Session expired (redirected to sign-in). Reconnect FutureLearn.');
  await browser.close();
  process.exit(1);
}

const courses = await page.evaluate(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('li.m-course-list__item')].map((li) => {
    const slug = li.id;
    const titleEl = li.querySelector('h4.m-course-list__course-title');
    // Title text includes a trailing "(CODE)" span plus a nested "Edit Course" link.
    const codeMatch = titleEl?.querySelector('span')?.textContent.match(/\(([^()]+)\)/);
    const code = codeMatch ? codeMatch[1] : null;
    const title = clean(titleEl?.childNodes[0]?.textContent);
    const metaEl = li.querySelector('p.a-course-meta--subtle');
    const metaText = clean(metaEl?.textContent);
    const category = (metaText.split(/\d+\s+learners?/i)[0] || '').replace(/\.\s*$/, '').trim() || null;
    const wishlistMatch = metaText.match(/(\d+)\s+learners?\s+have\s+added/i);
    const wishlistCount = wishlistMatch ? Number(wishlistMatch[1]) : null;

    // Pick the run with the latest real start date; fall back to the first row.
    const runs = [...li.querySelectorAll('table.m-table--manage-courses tbody tr.m-course-list__row')]
      .map((tr) => {
        const status = clean(tr.querySelector('.a-flag')?.textContent);
        const dateText = clean(tr.querySelectorAll('td')[2]?.textContent);
        const date = dateText && dateText !== 'Not set' ? dateText : null;
        return { status, date, ts: date ? Date.parse(date) : 0 };
      });
    const best = runs.reduce((a, b) => ((b.ts || 0) > (a?.ts || 0) ? b : a), runs[0]);

    return { slug, title, code, category, wishlistCount, status: best?.status ?? null, startDate: best?.date ?? null };
  }).filter((c) => c.slug && c.title);
});

await browser.close();

const result = writeFutureLearnCourses(courses);
if (result.guarded) {
  console.error(`⚠️ Refused to write — only ${courses.length} courses found, looks like a partial/failed run. Kept existing data. Re-run after reconnecting.`);
  process.exit(1);
}
console.log(`✅ ${courses.length} FutureLearn courses → dashboard.db`);
