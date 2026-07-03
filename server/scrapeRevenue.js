// Pulls your total instructor earnings using the connected session + a HEADED
// browser (Cloudflare blocks headless on api-2.0). Auto-detects your share-holder
// id from the revenue page, then reads the lifetime total + monthly series.
// Writes revenue-cache.json. Run: npm run scrape:revenue  (a window opens briefly)
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

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

// Detect the share-holder id from the revenue page's own API calls.
let shareHolderId = null;
page.on('response', (res) => {
  const m = res.url().match(/\/api-2\.0\/share-holders\/(?:v2\.0\/)?(\d+)\//);
  if (m && !shareHolderId) shareHolderId = m[1];
});

console.log('Opening the revenue page to read your earnings…');
await page.goto('https://www.udemy.com/instructor/performance/revenue/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(5000);

if (!shareHolderId) {
  console.error('❌ Could not detect your revenue account id (session/Cloudflare issue). Re-connect and retry.');
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

const total = await apiGet(`https://www.udemy.com/api-2.0/share-holders/v2.0/${shareHolderId}/total/`);
await browser.close();

const amount = total?.amount?.amount ?? null;
const currency = (total?.amount?.currency || 'usd').toUpperCase();
const monthly = (total?.items || []).map((it) => ({ month: it.identifier, amount: it.amount?.amount ?? 0 }));

writeFileSync(
  CACHE_FILE,
  JSON.stringify({ scrapedAt: new Date().toISOString(), currency, total: amount, monthly, perCourse: {} }, null, 2)
);

if (amount != null) {
  console.log(`✅ Total earnings: ${currency} ${amount.toLocaleString()} (${monthly.length} months) → revenue-cache.json`);
  console.log('   Note: per-course earnings need a separate endpoint (not found yet); the total shows now.');
} else {
  console.log('⚠️ Could not parse the total. Re-run, or share what the revenue page shows.');
}
