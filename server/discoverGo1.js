// Discovery tool for Go1. Uses your saved session to visit the content-partner
// dashboard and capture every JSON network response, so we can see Go1's real
// data shapes + endpoints and build an accurate scraper. Captures only — no
// writes. Run: node discoverGo1.js
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'go1-auth.json');
const OUT_FILE = join(__dirname, 'go1-discovery.json');
const DASHBOARD_URL = 'https://starweaver.mygo1.com/p/#/app/dashboard';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

if (!existsSync(AUTH_FILE)) {
  console.error('❌ Not connected. Use "Connect Go1" in the dashboard first.');
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

const captures = [];
page.on('response', async (res) => {
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const text = await res.text().catch(() => '');
    if (!text || text.length < 10) return;
    captures.push({ url: res.url(), status: res.status(), sample: text.slice(0, 4000) });
  } catch {}
});

console.log(`Opening ${DASHBOARD_URL} …`);
await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000); // Go1 is an SPA — give it time to hydrate + fire API calls

const finalUrl = page.url();
const loggedOut = /\/login|\/signin/i.test(finalUrl);
console.log(`→ landed on ${finalUrl}${loggedOut ? '  ⚠️ LOOKS LOGGED OUT' : ''}`);

for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await page.waitForTimeout(1000); }

// Grab visible nav links (SPA, so these are usually client-side routes, not hrefs).
const links = await page.evaluate(() =>
  [...document.querySelectorAll('a')]
    .map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
    .filter((l) => l.text && l.href)
);

await browser.close();

writeFileSync(OUT_FILE, JSON.stringify({ finalUrl, loggedOut, captureCount: captures.length, captures, navLinks: links }, null, 2));
console.log(`\n✅ Captured ${captures.length} JSON responses, ${links.length} nav links → go1-discovery.json`);
console.log('   Share this file (or a summary) so the scraper can be built against real data shapes.');
