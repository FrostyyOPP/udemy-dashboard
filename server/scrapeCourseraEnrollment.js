// Authoritative per-course enrollment for the Starweaver Coursera partner,
// read from the admin Courses table (each row shows "<N> enrollments").
//
// WHY THIS EXISTS: scrapeCourseraMetrics.js reads the Looker "course_comparison"
// tile, which on 2026-08-05 returned partial figures for 10 courses — e.g.
// "Personal Productivity" came back as 5,453 when the true total was 36,401.
// Enrollment is monotonic, so a decrease is always wrong. The admin table was
// verified against those same courses and matched reality, so it is used here
// as the source of truth and to correct coursera_metrics.
//
// Run: npm run coursera:enrollment
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'coursera-auth.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(AUTH_FILE)) { console.error('❌ Coursera not connected.'); process.exit(1); }

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await minimizeWindow(ctx, page);

await page.goto('https://www.coursera.org/admin/starweaver/home/courses', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await sleep(8000);
if (/login|authMode/.test(page.url())) { console.error('❌ Coursera session expired.'); await browser.close(); process.exit(1); }

// Each row is a <tr> containing the /teach/<slug>/course link and "<N> enrollments".
// Reading the enclosing <tr> is reliable; walking up N parents is not, because the
// enrollment text sits in a sibling cell whose depth varies by row.
const readRows = () => page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/teach/"][href$="/course"]')).map((a) => {
  const tr = a.closest('tr');
  const m = tr ? tr.innerText.match(/([\d,]+)\s+enrollments?/i) : null;
  return {
    slug: a.getAttribute('href').split('/')[2],
    name: a.textContent.trim(),
    enrollments: m ? Number(m[1].replace(/,/g, '')) : null,
  };
}).filter((r) => r.slug && r.name));

const acc = new Map();
let prevFirst = null;
for (let p = 1; p <= 40; p++) {
  let rows = [];
  // wait for the page to change AND for every visible row to have parsed a figure,
  // so a half-rendered table is never accepted
  for (let t = 0; t < 30; t++) {
    rows = await readRows();
    if (rows.length && rows[0].slug !== prevFirst && rows.every((r) => r.enrollments != null)) break;
    await sleep(500);
  }
  if (!rows.length) break;
  prevFirst = rows[0].slug;
  rows.forEach((r) => acc.set(r.slug, r));
  const next = await page.$('button[aria-label="Go to next page"]');
  const off = next ? await next.evaluate((b) => b.disabled || b.getAttribute('aria-disabled') === 'true') : true;
  process.stdout.write(`\r  page ${p}: ${acc.size} courses`.padEnd(44));
  if (!next || off) break;
  await next.click().catch(() => {});
  await sleep(1300);
}
process.stdout.write('\n');
await browser.close();

const list = [...acc.values()];
const withCount = list.filter((r) => r.enrollments != null);
console.log(`courses: ${list.length}  ·  with an enrollment figure: ${withCount.length}`);
if (withCount.length < list.length * 0.8) {
  console.error('❌ Too many rows lacked an enrollment figure — refusing to write.');
  process.exit(1);
}
writeFileSync(join(__dirname, 'coursera-enrollment-latest.json'),
  JSON.stringify({ capturedAt: new Date().toISOString(), courses: list }, null, 2));
console.log(`total enrollments: ${withCount.reduce((s, r) => s + r.enrollments, 0).toLocaleString()}`);
console.log('→ coursera-enrollment-latest.json');
