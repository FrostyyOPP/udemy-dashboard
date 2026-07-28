// Broadcasts every active Udemy coupon to partner coupon-listing sites in one
// run. Two submission styles:
//  - "bulk" sites (real.discount, learn-it-university.com) accept many links
//    pasted into one textarea and extract the coupon codes themselves — all
//    links go in a single submission.
//  - "one-by-one" sites (courson.xyz, thecouponcabana.com) only take one link
//    per form, so each active coupon is submitted as its own request.
// Coupon links come from this dashboard's own API (course URL + active
// coupon codes), same source used for the manual thecouponcabana.com run.
// Run: npm run coupons:broadcast [siteKey]   (siteKey limits it to one site)
import 'dotenv/config';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';

const PORT = process.env.PORT || 5055;
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchActiveCouponLinks() {
  const headers = {};
  if (DASHBOARD_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${DASHBOARD_USER}:${DASHBOARD_PASSWORD}`).toString('base64')}`;
  }
  const res = await fetch(`http://localhost:${PORT}/api/courses`, { headers });
  if (!res.ok) throw new Error(`GET /api/courses failed: ${res.status}`);
  const data = await res.json();
  const links = [];
  for (const c of data.results || []) {
    for (const cp of c.coupons || []) {
      if (cp.active) links.push({ title: c.title, code: cp.code, link: `https://www.udemy.com${c.url}?couponCode=${cp.code}` });
    }
  }
  return links;
}

// --- Site adapters ----------------------------------------------------------

// Best-effort cookie-consent dismissal — learn-it-university.com's banner
// otherwise sits on top of the "+ Add Coupons" button and swallows the click.
async function dismissConsent(page) {
  const selectors = ['button:has-text("Accept All")', 'button:has-text("Accept all")', '#onetrust-accept-btn-handler'];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await sleep(500); break; }
    } catch { /* no banner, or already dismissed */ }
  }
}

// Polls until the submit control is enabled — sites like courson.xyz disable
// their button for a cooldown period after several rapid submissions.
async function waitForEnabled(page, sel, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const disabled = await page.$eval(sel, (el) => el.disabled).catch(() => true);
    if (!disabled) return true;
    await sleep(1000);
  }
  return false;
}

// Bulk sites process links asynchronously (e.g. real.discount shows a
// "Processing courses... N%" bar) — poll body text until it stops changing
// instead of reading it right after the click, or an N-link batch gets read
// mid-flight.
async function waitForStableText(page, { maxMs = 180000, quietMs = 6000 } = {}) {
  const start = Date.now();
  let last = null;
  let lastChangeAt = Date.now();
  while (Date.now() - start < maxMs) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const pctMatch = body.match(/processing courses\.\.\.\s*(\d+)%/i);
    if (pctMatch && Number(pctMatch[1]) < 100) {
      // still actively working through the batch — reset the quiet clock
      last = body; lastChangeAt = Date.now();
      await sleep(1500);
      continue;
    }
    if (body !== last) { last = body; lastChangeAt = Date.now(); }
    else if (Date.now() - lastChangeAt >= quietMs) break;
    await sleep(1000);
  }
  return last ?? '';
}

async function submitBulk(page, { url, openSel, textareaSel, honeypotSel, submitSel }, links) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissConsent(page);
  if (openSel) { await page.click(openSel).catch(() => {}); await sleep(500); }
  await page.fill(textareaSel, links.map((l) => l.link).join('\n'));
  if (honeypotSel) await page.fill(honeypotSel, ''); // spam-trap field — must stay empty
  await page.click(submitSel);
  await sleep(1500);
  const body = await waitForStableText(page);
  // Prefer a site's own parsed-summary line ("We parsed 3 coupons. 1 duplicate
  // skipped.") when present; otherwise fall back to counting occurrences.
  const summaryMatch = body.match(/we parsed (\d+) coupons?\.\s*(\d+) duplicates? skipped/i);
  const duplicateCount = summaryMatch
    ? Number(summaryMatch[2])
    : (body.match(/already (been )?added|already exists|already submitted|\bduplicate/gi) || []).length;
  const successCount = summaryMatch
    ? Number(summaryMatch[1]) - Number(summaryMatch[2])
    : (body.match(/\bsuccess/gi) || []).length;
  return { submitted: links.length, successCount, duplicateCount, bodySnippet: body.slice(0, 2000) };
}

// Classifies the post-submit page text into one of three outcomes rather than
// a flat ok/fail — "duplicate" (site already has this coupon, e.g. picked up
// by its own scanner) is expected and not an error like "invalid".
function classifyResult(body, successText) {
  if (successText && body.includes(successText)) return 'success';
  if (/already exists|already submitted|already added|duplicate/i.test(body)) return 'duplicate';
  if (/❌|invalid|error/i.test(body)) return 'failed';
  return successText ? 'unknown' : 'success';
}

async function submitOneByOne(page, { url, inputSel, submitSel, successText }, links) {
  const results = [];
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissConsent(page);
  for (const l of links) {
    if (!(await page.isVisible(inputSel).catch(() => false))) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissConsent(page);
      await sleep(1000);
    }
    await page.fill(inputSel, l.link);
    await page.dispatchEvent(inputSel, 'change');
    const enabled = await waitForEnabled(page, submitSel, 60000);
    if (!enabled) {
      results.push({ title: l.title, code: l.code, status: 'skipped-disabled' });
      console.log(`  ⏭  ${l.title} (${l.code}) — submit stayed disabled 60s (rate limit?), skipping`);
      continue;
    }
    await page.click(submitSel);
    await sleep(4000); // pace submissions to avoid tripping rate limits
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const status = classifyResult(body, successText);
    results.push({ title: l.title, code: l.code, status });
    const icon = status === 'success' ? '✓' : status === 'duplicate' ? '↺' : '⚠️ ';
    console.log(`  ${icon} ${l.title} (${l.code}) — ${status}`);
  }
  return results;
}

const SITES = {
  'real.discount': {
    type: 'bulk',
    url: 'https://www.real.discount/add',
    textareaSel: 'textarea[name="udemyLink"]',
    submitSel: 'button[type=submit]',
  },
  'learn-it-university.com': {
    type: 'bulk',
    url: 'https://learn-it-university.com/udemy-free-coupons',
    openSel: '#add-coupons',
    textareaSel: '#ac-input',
    honeypotSel: '#ac-website',
    submitSel: '#ac-submit',
  },
  'courson.xyz': {
    type: 'one-by-one',
    url: 'https://courson.xyz/submit-coupon',
    inputSel: '#url-input',
    submitSel: 'button[type=submit]',
  },
  'thecouponcabana.com': {
    type: 'one-by-one',
    url: 'https://www.thecouponcabana.com/add-course',
    inputSel: '#course-url',
    submitSel: 'button[type=submit]',
    successText: 'successfully updated',
  },
};

async function main() {
  const only = process.argv[2];
  if (only && !SITES[only]) {
    console.error(`Unknown site "${only}". Known: ${Object.keys(SITES).join(', ')}`);
    process.exit(1);
  }

  const links = await fetchActiveCouponLinks();
  if (!links.length) { console.log('No active coupons found.'); return; }
  const targets = only ? [only] : Object.keys(SITES);
  console.log(`Found ${links.length} active coupon links. Broadcasting to: ${targets.join(', ')}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await minimizeWindow(ctx, page);

  const summary = {};
  for (const name of targets) {
    const cfg = SITES[name];
    console.log(`\n=== ${name} ===`);
    try {
      if (cfg.type === 'bulk') {
        const r = await submitBulk(page, cfg, links);
        summary[name] = r;
        console.log(`  Submitted all ${links.length} links in one batch.`);
        console.log(`  successCount=${r.successCount} duplicateCount=${r.duplicateCount}`);
        console.log(`  Page response snippet: ${r.bodySnippet.replace(/\s+/g, ' ').trim()}`);
      } else {
        const r = await submitOneByOne(page, cfg, links);
        const counts = r.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {});
        summary[name] = { submitted: r.length, ...counts };
      }
    } catch (err) {
      console.log(`  ❌ ${name} failed: ${err.message}`);
      summary[name] = { error: err.message };
    }
  }

  await browser.close();
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

main();
