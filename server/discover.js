// Discovery tool. Uses your saved session to visit the authenticated instructor
// pages (courses, revenue, coupons) and capture the network JSON each one loads,
// so we can see Udemy's real data shapes + endpoints and build accurate scrapers.
// Captures only — no writes. Run: npm run auth:udemy  then  npm run discover
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const OUT_FILE = join(__dirname, 'discover-output.json');

if (!existsSync(AUTH_FILE)) {
  console.error('❌ No session. Run `npm run auth:udemy` first and log in.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: AUTH_FILE });
const page = await ctx.newPage();

// Capture every JSON response that looks instructor/money/coupon related.
const captures = [];
page.on('response', async (res) => {
  try {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    if (!/coupon|promo|discount|revenue|earning|amount|course|instructor|stat|caption|locale|subtitle/i.test(url)) return;
    const text = await res.text().catch(() => '');
    if (!text) return;
    captures.push({ url, status: res.status(), sample: text.slice(0, 3000) });
  } catch {}
});

async function visit(label, url) {
  const before = captures.length;
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => ({ err: e.message }));
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  const loggedOut = /\/join\/login/.test(finalUrl);
  console.log(`\n[${label}] ${url}`);
  console.log(`  → ${finalUrl}${loggedOut ? '  ⚠️ LOGGED OUT' : ''}`);
  console.log(`  captured ${captures.length - before} JSON responses on this page`);
  return { label, url, finalUrl, loggedOut, captureCount: captures.length - before };
}

const pages = [];
pages.push(await visit('courses', 'https://www.udemy.com/instructor/courses/'));
pages.push(await visit('revenue', 'https://www.udemy.com/instructor/performance/revenue/'));
pages.push(await visit('overview', 'https://www.udemy.com/instructor/performance/overview/'));

// Try to find a course's coupon page by reading manage links off the courses page.
let couponPage = null;
try {
  await page.goto('https://www.udemy.com/instructor/courses/', { waitUntil: 'networkidle', timeout: 45000 });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/manage/"], a[href*="/instructor/course/"]')]
      .map((x) => x.getAttribute('href'))
      .find(Boolean);
    return a || null;
  });
  if (href) {
    const base = href.replace(/\/manage\/.*$/, '/manage/').replace(/\/$/, '');
    const couponUrl = `https://www.udemy.com${base}/coupons/`.replace('//coupons', '/manage/coupons');
    couponPage = await visit('coupons', couponUrl.startsWith('http') ? couponUrl : `https://www.udemy.com${couponUrl}`);
  } else {
    console.log('\n[coupons] could not find a course manage link to derive the coupon URL');
  }
} catch (e) {
  console.log('\n[coupons] error:', e.message);
}
if (couponPage) pages.push(couponPage);

await browser.close();

writeFileSync(OUT_FILE, JSON.stringify({ pages, captures }, null, 2));
console.log(`\n✅ Saved ${captures.length} JSON captures across ${pages.length} pages → ${OUT_FILE}`);
console.log('   Share that file (or paste relevant captures) and I will build the parsers + coupon creator.');
if (pages.some((p) => p.loggedOut)) {
  console.log('   ⚠️ Some pages showed logged-out — re-run `npm run auth:udemy`.');
}
