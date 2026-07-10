// Verify current curriculum with ids + positions; flag any stray item that isn't
// in the spec (e.g. capture-test leftovers). Read-only unless CLEAN=1 is set,
// in which case it deletes stray items only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const SPEC = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.json'), 'utf8'));
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const CLEAN = process.env.CLEAN === '1';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await page.goto(`https://www.udemy.com/course/${COURSE_ID}/manage/curriculum/`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await sleep(4000);

const call = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const res = await fetch(`https://www.udemy.com/api-2.0/${path}`, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}, { method, path, body });

const TC = `users/me/taught-courses/${COURSE_ID}`;
const items = (await call('GET', `courses/${COURSE_ID}/instructor-curriculum-items/?page_size=200&fields[lecture]=title&fields[chapter]=title`)).data?.results || [];

// Build the set of titles the spec expects (chapters + leaf titles).
const expected = new Set();
const leafTitle = (it) => it.type === 'assignment' ? `[Lab] ${it.title}` : it.type === 'quiz' ? `[Quiz] ${it.title}` : it.title;
for (const s of SPEC.sections) { expected.add(s.title); for (const it of s.items) expected.add(leafTitle(it)); }

console.log(`total items on course: ${items.length}\n`);
const strays = [];
let idx = 0;
for (const it of items) {
  const inSpec = expected.has(it.title) || it.title.startsWith('Reading:') || it.title.startsWith('[Discussion]') || it.title.startsWith('[Reading]');
  const mark = it._class === 'chapter' ? '§' : ' •';
  const flag = inSpec ? '' : '   ⟵ STRAY';
  console.log(`${String(idx).padStart(2)} ${mark} [${it._class}] ${it.title}${flag}`);
  if (!inSpec) strays.push(it);
  idx++;
}

if (strays.length && CLEAN) {
  console.log(`\ncleaning ${strays.length} stray item(s)…`);
  for (const it of strays) {
    const kind = it._class === 'chapter' ? 'chapters' : 'lectures';
    const d = await call('DELETE', `${TC}/${kind}/${it.id}/`);
    console.log(`  del ${it._class} "${it.title}" → ${d.status}`);
    await sleep(300);
  }
} else if (strays.length) {
  console.log(`\n${strays.length} stray item(s) found. Re-run with CLEAN=1 to remove.`);
} else {
  console.log('\n✅ no strays — curriculum matches spec exactly.');
}

await sleep(1000);
await browser.close();
