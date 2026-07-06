// Pulls ACTIVE coupons per course (not in the instructor API). Uses the connected
// session + a HEADED browser. Endpoint: /api-2.0/courses/{numId}/coupons-v2/?invalid=false
// Writes coupon-cache.json: { perCourse: { <courseId>: [{code,...}] } }.
// Run: npm run scrape:coupons   (a browser window opens — leave it)
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const CACHE_FILE = join(__dirname, 'coupon-cache.json');
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

async function apiGet(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) { try { return JSON.parse(body); } catch {} }
    await sleep(1500);
  }
  return null;
}

// Warm up Cloudflare.
await page.goto('https://www.udemy.com/instructor/courses/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
await sleep(3000);

// numericId → slug from api-2.0 taught-courses.
const courses = [];
let url = 'https://www.udemy.com/api-2.0/users/me/taught-courses/?page_size=100&fields[course]=published_title,is_published';
while (url) {
  const d = await apiGet(url);
  if (!d?.results) break;
  for (const c of d.results) if (c.id) courses.push({ numId: c.id, slug: c.published_title });
  url = d.next || null;
  await sleep(800);
}
console.log(`Checking coupons for ${courses.length} courses…`);

// slug → instructor id.
const slugToId = {};
let p2 = 1;
while (true) {
  const d = await udemyGet('/taught-courses/courses/', { page: p2, page_size: 100, 'fields[course]': '@default,published_title' });
  for (const c of d.results || []) slugToId[c.published_title] = c.id;
  if (!d.next) break;
  p2 += 1;
}

const perCourse = {};
let done = 0, withCoupons = 0;
for (const c of courses) {
  const data = await apiGet(`https://www.udemy.com/api-2.0/courses/${c.numId}/coupons-v2/?invalid=false&ordering=end_time,-created&page_size=50`);
  const list = (data?.results || []).map((x) => ({
    code: x.code,
    is_free: (x.discount_value ?? 0) === 0,
    discount_value: x.discount_value,
    max_uses: x.maximum_uses,
    used: x.number_of_uses,
    start: x.start_time,
    end: x.end_time,
    active: x.is_active,
  }));
  const id = c.slug && slugToId[c.slug];
  if (id) perCourse[id] = list;
  if (list.length) withCoupons++;
  done++;
  if (done % 5 === 0) writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), perCourse }, null, 2));
  process.stdout.write(`\r  ${done}/${courses.length} · ${withCoupons} with active coupons`);
  await sleep(1000 + Math.floor(Math.random() * 800));
}
process.stdout.write('\n');
await browser.close();

writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), perCourse }, null, 2));
const totalCoupons = Object.values(perCourse).reduce((s, l) => s + l.length, 0);
console.log(`✅ ${withCoupons} courses have active coupons (${totalCoupons} total) → coupon-cache.json`);
