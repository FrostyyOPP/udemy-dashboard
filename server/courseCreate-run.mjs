// Create ONE draft course from the shell spec by driving Udemy's 4-step wizard:
//   1 course-type · 2 title · 3 category · 4 time-commitment → Create Course.
// Captures the create response + new course id, then reads the curriculum baseline.
// Creates exactly one draft (the course named in the spec). No other writes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const SPEC = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = SPEC.meta.title;
const CATEGORY = 'Business'; // authorized category

if (!existsSync(AUTH_FILE)) { console.error('❌ Not connected'); process.exit(1); }

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

let createHit = null;
page.on('response', async (res) => {
  const u = res.url(); const m = res.request().method();
  if (u.includes('/api-2.0/') && m === 'POST' && /course/i.test(u) && !/ecl|datadog|visits/.test(u)) {
    let body = null; try { body = await res.json(); } catch {}
    console.log(`>>> POST ${u.split('?')[0]} → ${res.status()}`);
    if (body?.id && !createHit) createHit = { url: u.split('?')[0], id: body.id, body };
  }
});

const waitEnabledClick = async (locator, label, tries = 25) => {
  for (let i = 0; i < tries; i++) { if (!(await locator.isDisabled().catch(() => true))) break; await sleep(400); }
  await locator.click({ timeout: 8000 }).catch((e) => console.log(`  ${label}:`, e.message.split('\n')[0]));
  await sleep(2500);
};

console.log(`=== Creating draft: "${TITLE}" (type=Course, category=${CATEGORY}) ===`);
await page.goto('https://www.udemy.com/course/create/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await sleep(4000);

// Step 1 — course type: click the "Course" label (wraps the hidden radio).
await page.locator('label').filter({ hasText: /^Course/ }).first().click().catch(async () => {
  await page.locator('input[name="course-type"]').first().check({ force: true });
});
await sleep(700);
await waitEnabledClick(page.locator('button:has-text("Continue")').first(), 'continue-1');

// Step 2 — title.
await page.locator('input[type="text"]').first().fill(TITLE).catch((e) => console.log('  title:', e.message.split('\n')[0]));
await sleep(700);
await waitEnabledClick(page.locator('button:has-text("Continue")').first(), 'continue-2');

// Step 3 — category select.
const sel = page.locator('select').first();
if (await sel.count().catch(() => 0)) {
  await sel.selectOption({ label: CATEGORY }).catch(async () => { await sel.selectOption({ index: 2 }); });
}
await sleep(700);
await waitEnabledClick(page.locator('button:has-text("Continue")').first(), 'continue-3');

// Step 4 — time-commitment survey: pick the first option, then Create Course.
await page.locator('label').filter({ has: page.locator('input[name^="survey-question"]') }).first().click().catch(async () => {
  await page.locator('input[name^="survey-question"]').first().check({ force: true });
});
await sleep(700);
await waitEnabledClick(page.locator('button:has-text("Create Course")').first(), 'create');
await sleep(5000);

const url = page.url();
const idFromUrl = url.match(/course\/(\d+)\/manage/)?.[1] || createHit?.id;
console.log('\n=== result ===');
console.log('landed on:', url);
console.log('new draft course id:', idFromUrl || '(not detected)');

if (idFromUrl) {
  const cur = await page.evaluate(async (cid) => {
    try { const r = await fetch(`https://www.udemy.com/api-2.0/courses/${cid}/curriculum-items/?page_size=20&fields[lecture]=title&fields[chapter]=title`, { credentials: 'include', headers: { Accept: 'application/json' } }); return { status: r.status, body: r.ok ? await r.json() : (await r.text()).slice(0, 200) }; }
    catch (e) { return { status: 0, body: String(e) }; }
  }, idFromUrl);
  console.log('curriculum baseline status:', cur.status, '· items:', JSON.stringify(cur.body?.results || cur.body).slice(0, 300));
  writeFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), JSON.stringify({ id: idFromUrl, url, createEndpoint: createHit?.url, at: new Date().toISOString() }, null, 2));
  console.log('\n✅ draft created — saved to critical-thinking-ai-era.created.json');
  console.log('   Manage: https://www.udemy.com/course/' + idFromUrl + '/manage/curriculum/');
} else {
  console.log('\n⚠️  no course id detected — nothing confirmed created.');
}

await sleep(1500);
await browser.close();
