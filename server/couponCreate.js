// Bulk coupon creation via the connected session + a HEADED browser.
// POSTs to /api-2.0/courses/{numId}/coupons-v2/ for each selected course.
// A WRONG payload returns a 400 and creates nothing, so this is safe to try.
// dryRun:true plans the payloads without any write.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// slugs: instructor course slugs (published_title). One coupon `code` per course.
export async function createCoupons({
  slugs = [],
  code,
  type = 'free', // 'free' | 'discount'
  price = 0, // used when type === 'discount' (the new course price)
  maxUses = 100,
  days = 31,
  strategy, // discount_strategy override; defaults to a best guess
  dryRun = false,
}) {
  if (!code || !slugs.length) throw Object.assign(new Error('code and at least one course are required'), { status: 400 });
  if (!existsSync(AUTH_FILE)) throw Object.assign(new Error('Not connected — use Connect Udemy first'), { status: 400 });

  const discountValue = type === 'discount' ? Number(price) : 0;
  const discountStrategy = strategy || (type === 'discount' ? 'custom-price' : 'custom-price');
  const start = new Date();
  const end = new Date(start.getTime() + days * 86400000);
  const payloadFor = () => ({
    code,
    discount_value: discountValue,
    discount_strategy: discountStrategy,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    maximum_uses: maxUses,
  });

  if (dryRun) {
    return {
      dryRun: true,
      plan: { code, type, discount_value: discountValue, discount_strategy: discountStrategy, maximum_uses: maxUses, days },
      courses: slugs.length,
      note: 'Nothing was created. Click Create (dry-run off) to actually create these coupons.',
    };
  }

  const { chromium } = await import('playwright');
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

  try {
    // Warm up Cloudflare on a normal instructor page.
    await page.goto('https://www.udemy.com/instructor/courses/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await sleep(3000);

    // slug -> numeric id.
    const slugToNum = {};
    let url = 'https://www.udemy.com/api-2.0/users/me/taught-courses/?page_size=100&fields[course]=published_title';
    while (url) {
      const d = await apiGet(url);
      if (!d?.results) break;
      for (const c of d.results) if (c.published_title) slugToNum[c.published_title] = c.id;
      url = d.next || null;
      await sleep(600);
    }

    const results = [];
    for (const slug of slugs) {
      const numId = slugToNum[slug];
      if (!numId) { results.push({ slug, ok: false, error: 'could not resolve course id' }); continue; }
      const r = await page.evaluate(async ({ numId, payload }) => {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
        const res = await fetch(`https://www.udemy.com/api-2.0/courses/${numId}/coupons-v2/`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Csrftoken': csrf, Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 400) };
      }, { numId, payload: payloadFor() });

      let ok = r.status >= 200 && r.status < 300;
      let parsed; try { parsed = JSON.parse(r.body); } catch {}
      results.push({ slug, numId, ok, status: r.status, code: ok ? parsed?.code : undefined, error: ok ? undefined : r.body });
      await sleep(1200);
    }
    return { dryRun: false, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  } finally {
    await browser.close();
  }
}
