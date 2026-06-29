// Pulls revenue from the LOGGED-IN instructor dashboard using the saved
// session (run captureAuth.js first). Captures the revenue page's network
// JSON, dumps candidates for discovery, and writes revenue-cache.json.
// Run: npm run scrape:revenue        (all files gitignored)
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const CACHE_FILE = join(__dirname, 'revenue-cache.json');
const DISCOVERY_FILE = join(__dirname, 'revenue-discovery.json');

if (!existsSync(AUTH_FILE)) {
  console.error('❌ No session found. Run `npm run auth:udemy` first and log in.');
  process.exit(1);
}

// Candidate pages the revenue report may live behind.
const PAGES = [
  'https://www.udemy.com/instructor/performance/revenue/',
  'https://www.udemy.com/instructor/revenue-report/',
  'https://www.udemy.com/instructor/performance/overview/',
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: AUTH_FILE });
const page = await ctx.newPage();

// Capture JSON responses that look money-related for discovery.
const captured = [];
page.on('response', async (res) => {
  try {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    if (!/revenue|earning|amount|stat|performance|course/i.test(url)) return;
    const body = await res.json().catch(() => null);
    if (!body) return;
    const text = JSON.stringify(body);
    if (/revenue|amount|earning/i.test(text)) {
      captured.push({ url, sample: text.slice(0, 2000) });
    }
  } catch {}
});

let loggedIn = false;
for (const url of PAGES) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  const onLogin = /\/join\/login/.test(page.url());
  if (!onLogin) loggedIn = true;
  await page.waitForTimeout(2500); // let XHRs fire
}

if (!loggedIn) {
  console.error('❌ Session looks logged out (redirected to login). Re-run `npm run auth:udemy`.');
  await browser.close();
  process.exit(1);
}

writeFileSync(DISCOVERY_FILE, JSON.stringify(captured, null, 2));
console.log(`Captured ${captured.length} money-related JSON responses → ${DISCOVERY_FILE}`);

// Best-effort parse: find a payload with per-course revenue entries.
let perCourse = {};
let total = null;
for (const c of captured) {
  try {
    const j = JSON.parse(c.sample.length < 2000 ? c.sample : '{}');
    // (full parsing happens below against the live body)
  } catch {}
}
// Re-fetch the most promising endpoint fully (sample was truncated for the dump).
const best = captured.find((c) => /revenue/i.test(c.url) && /results|courses|\[/.test(c.sample));
if (best) {
  const body = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    return r.ok ? r.json() : null;
  }, best.url).catch(() => null);
  if (body) {
    const rows = body.results || body.courses || (Array.isArray(body) ? body : []);
    for (const row of rows) {
      const amt = row.amount ?? row.revenue ?? row.total ?? row.earnings;
      const id = row.course_id ?? row.id ?? row.course?.id;
      if (id != null && amt != null) perCourse[String(id)] = Number(amt);
    }
    total = body.total ?? body.total_amount ?? Object.values(perCourse).reduce((s, n) => s + n, 0);
  }
}

await browser.close();

const out = {
  scrapedAt: new Date().toISOString(),
  currency: 'USD',
  total,
  perCourse,
  note: 'Best-effort. If perCourse is empty, inspect revenue-discovery.json to find the right payload.',
};
writeFileSync(CACHE_FILE, JSON.stringify(out, null, 2));

if (Object.keys(perCourse).length) {
  console.log(`✅ Parsed revenue for ${Object.keys(perCourse).length} courses. Total: ${total}`);
} else {
  console.log('⚠️  Could not auto-parse per-course revenue.');
  console.log(`   Open ${DISCOVERY_FILE} and share it — I will write the exact parser.`);
}
console.log(`   Saved ${CACHE_FILE}`);
