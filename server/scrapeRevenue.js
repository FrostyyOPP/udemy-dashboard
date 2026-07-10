// Pulls instructor earnings (lifetime total, monthly series, AND per-course)
// using the connected session + a HEADED browser (Cloudflare blocks headless on
// api-2.0). Writes revenue-cache.json. Run: npm run scrape:revenue
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const CACHE_FILE = join(__dirname, 'revenue-cache.json');
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

await minimizeWindow(ctx, page); // keep the automation window out of the user's way
let shareHolderId = null;
page.on('response', (res) => {
  const m = res.url().match(/\/api-2\.0\/share-holders\/(?:v[\d.]+\/)?(\d+)\//);
  if (m && !shareHolderId) shareHolderId = m[1];
});

console.log('Opening the revenue page…');
await page.goto('https://www.udemy.com/instructor/performance/revenue/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(5000);
if (!shareHolderId) {
  console.error('❌ Could not detect your revenue account id. Re-connect and retry.');
  await browser.close();
  process.exit(1);
}
console.log('Revenue account id:', shareHolderId);

async function apiGet(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) { try { return JSON.parse(body); } catch {} }
    await sleep(1500);
  }
  return null;
}

// 1) Lifetime total + monthly series.
const total = await apiGet(`https://www.udemy.com/api-2.0/share-holders/v2.0/${shareHolderId}/total/`);
const totalAmount = total?.amount?.amount ?? null;
const currency = (total?.amount?.currency || 'usd').toUpperCase();
const monthly = (total?.items || []).map((it) => ({ month: it.identifier, amount: it.amount?.amount ?? 0 }));

// 2) Per-course lifetime earnings → { numericId: amount }.
const perNum = {};
const byCourse = await apiGet(`https://www.udemy.com/api-2.0/share-holders/v1.0/${shareHolderId}/total/?aggregate=course`);
for (const it of byCourse?.items || []) {
  const m = String(it.identifier).match(/course:(\d+)/);
  if (m) perNum[m[1]] = it.amount?.amount ?? 0;
}

// 3) numericId → slug (api-2.0 taught-courses), paginated.
const numToSlug = {};
let url = 'https://www.udemy.com/api-2.0/users/me/taught-courses/?page_size=100&fields[course]=published_title';
while (url) {
  const d = await apiGet(url);
  if (!d?.results) break;
  for (const c of d.results) if (c.id && c.published_title) numToSlug[c.id] = c.published_title;
  url = d.next || null;
  await sleep(800);
}
await browser.close();

// 4) slug → instructor-API course id (the ids the dashboard uses).
const slugToId = {};
let p2 = 1;
while (true) {
  const d = await udemyGet('/taught-courses/courses/', { page: p2, page_size: 100, 'fields[course]': '@default,published_title' });
  for (const c of d.results || []) slugToId[c.published_title] = c.id;
  if (!d.next) break;
  p2 += 1;
}

// Combine: numericId → slug → instructor id → amount.
const perCourse = {};
for (const [numId, amount] of Object.entries(perNum)) {
  const slug = numToSlug[numId];
  const id = slug && slugToId[slug];
  if (id) perCourse[id] = amount;
}

writeFileSync(
  CACHE_FILE,
  JSON.stringify({ scrapedAt: new Date().toISOString(), currency, total: totalAmount, monthly, perCourse }, null, 2)
);

const mapped = Object.keys(perCourse).length;
const earning = Object.values(perCourse).filter((v) => v > 0).length;
console.log(`✅ Total ${currency} ${totalAmount?.toLocaleString()} · per-course mapped for ${mapped} courses (${earning} earning) → revenue-cache.json`);
console.log('   Refresh the dashboard — the Earnings report now has per-course Total Earning.');
