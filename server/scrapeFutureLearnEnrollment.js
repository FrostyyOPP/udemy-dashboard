// Scrapes public FutureLearn course pages for the "N enrolled on this course"
// text (not exposed anywhere in the admin panel). No session needed — same
// public-page pattern as Udemy's scrapeEnrollment.js. Merge-only write (never
// deletes existing enrollment numbers). Run: npm run futurelearn:enrollment
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { readFutureLearnCourses, writeFutureLearnEnrollment } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX = Number(process.env.MAX) || 0;
const { courses } = readFutureLearnCourses();
const alreadyHave = courses.length - courses.filter((c) => FORCE || c.enrollment == null).length;
let todo = courses.filter((c) => FORCE || c.enrollment == null);
if (MAX > 0) todo = todo.slice(0, MAX);
console.log(`${courses.length} courses; ${alreadyHave} already have enrollment, ${todo.length} to scrape now.`);

const browser = await chromium.launch({ headless: true });
const perSlug = {};
let found = 0;

for (let i = 0; i < todo.length; i++) {
  const c = todo[i];
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();
  await minimizeWindow(ctx, page);
  try {
    await page.goto(`https://www.futurelearn.com/courses/${c.slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    const m = text.match(/([\d,]+)\s+enrolled on this course/i);
    if (m) { perSlug[c.slug] = Number(m[1].replace(/,/g, '')); found++; }
  } catch {}
  await ctx.close();
  process.stdout.write(`\r  ${i + 1}/${todo.length} · ${found} found`);
  await sleep(500 + Math.floor(Math.random() * 500));
}
process.stdout.write('\n');
await browser.close();

writeFutureLearnEnrollment(perSlug);
console.log(`✅ Got enrollment for ${found}/${todo.length} courses → dashboard.db`);
