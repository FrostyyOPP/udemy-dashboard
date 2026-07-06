// Collects caption/subtitle languages per course (not in the instructor API).
// Uses your connected session + a HEADED browser (Cloudflare blocks headless on
// the api-2.0 data endpoints). Pulls the bulk taught-courses endpoint, then maps
// results to instructor-API course ids by slug. Writes caption-cache.json.
// Run: npm run scrape:captions   (a browser window opens briefly — leave it)
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const CACHE_FILE = join(__dirname, 'caption-cache.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Not connected. Use "Connect Udemy" in the dashboard (or npm run import:cookies) first.');
  process.exit(1);
}

// Read a JSON api-2.0 endpoint by NAVIGATING to it (survives Cloudflare when headed).
async function apiGet(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  for (let i = 0; i < 12; i++) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body && (body.trim().startsWith('{') || body.trim().startsWith('['))) {
      try { return JSON.parse(body); } catch {}
    }
    await sleep(2000); // wait out a Cloudflare challenge
  }
  return null;
}

console.log('Opening a browser to reach Udemy through your session…');
const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

// Warm up / clear the Cloudflare challenge once on a normal page.
await page.goto('https://www.udemy.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
await sleep(3000);

// Pull all taught courses with caption_locales (paginated).
const bySlug = {};
let url = 'https://www.udemy.com/api-2.0/users/me/taught-courses/?page_size=100&fields[course]=title,published_title,caption_locales';
let total = null;
while (url) {
  const data = await apiGet(page, url);
  if (!data || !data.results) { console.error('⚠️ Could not read data (Cloudflare or session issue).'); break; }
  total = data.count;
  for (const c of data.results) {
    if (c.published_title) {
      bySlug[c.published_title] = (c.caption_locales || []).map((x) => x.english_title || x.title).filter(Boolean);
    }
  }
  process.stdout.write(`\r  fetched ${Object.keys(bySlug).length}/${total ?? '?'} courses`);
  url = data.next || null;
  await sleep(1200);
}
process.stdout.write('\n');
await browser.close();

// Map slug → instructor-API course id (the ids the dashboard uses).
const perCourse = {};
let page2 = 1;
while (true) {
  const d = await udemyGet('/taught-courses/courses/', { page: page2, page_size: 100, 'fields[course]': '@default,published_title' });
  for (const c of d.results || []) {
    if (bySlug[c.published_title]) perCourse[c.id] = bySlug[c.published_title];
  }
  if (!d.next) break;
  page2 += 1;
}

writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), perCourse }, null, 2));
const withCaps = Object.values(perCourse).filter((v) => v.length).length;
console.log(`✅ Captions for ${Object.keys(perCourse).length} courses (${withCaps} have subtitles) → caption-cache.json`);
console.log('   Refresh the dashboard to see the Captions column.');
