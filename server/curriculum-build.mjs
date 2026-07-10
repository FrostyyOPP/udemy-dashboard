// Build the full curriculum on the created draft, using the REAL editor endpoints
// (captured from the UI): sections/lectures are created under
//   POST /api-2.0/users/me/taught-courses/{courseId}/chapters|lectures/
// with header x-requested-with: XMLHttpRequest, from the manage-page context.
// Steps: clean any existing items → create every section + item in spec order
// (append = correct final order) → verify. Videos stay empty for manual upload.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const SPEC = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.json'), 'utf8'));
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
// Must be on the manage page for curriculum writes to be accepted.
await page.goto(`https://www.udemy.com/course/${COURSE_ID}/manage/curriculum/`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await sleep(4000);

// in-page fetch with the exact headers the editor uses.
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
const READ = `courses/${COURSE_ID}/instructor-curriculum-items/?page_size=200&fields[lecture]=title&fields[chapter]=title`;

const newChapter = (title) => call('POST', `${TC}/chapters/`, { title, description: '' });
const newLecture = (title) => call('POST', `${TC}/lectures/`, { title, description: '' });

// ---- clean slate: delete every existing chapter + lecture ----
console.log('=== clean slate ===');
let existing = (await call('GET', READ)).data?.results || [];
console.log(`existing items: ${existing.length}`);
for (const it of existing) {
  const kind = it._class === 'chapter' ? 'chapters' : 'lectures';
  const d = await call('DELETE', `${TC}/${kind}/${it.id}/`);
  console.log(`  del ${it._class} "${it.title}" → ${d.status}`);
  await sleep(300);
}

// ---- build in spec order ----
console.log('\n=== build ===');
const tally = { chapters: 0, lectures: 0, failed: 0 };
const leafTitle = (it) =>
  it.type === 'assignment' ? `[Lab] ${it.title}`
  : it.type === 'quiz' ? `[Quiz] ${it.title}`
  : it.kind === 'article' ? `[Reading] ${it.title}`.replace('[Reading] Discussion', '[Discussion]').replace('[Reading] Reading:', 'Reading:')
  : it.title;

for (const sec of SPEC.sections) {
  const c = await newChapter(sec.title);
  if (c.status >= 200 && c.status < 300) { tally.chapters++; console.log(`\n§ "${sec.title}" → ${c.status}`); }
  else { tally.failed++; console.log(`\n§ "${sec.title}" → ${c.status} FAILED ${JSON.stringify(c.data).slice(0,150)}`); }
  await sleep(500);
  for (const it of sec.items) {
    const t = leafTitle(it);
    const r = await newLecture(t);
    if (r.status >= 200 && r.status < 300) { tally.lectures++; console.log(`   • ${t} → ${r.status}`); }
    else { tally.failed++; console.log(`   • ${t} → ${r.status} FAILED ${JSON.stringify(r.data).slice(0,150)}`); }
    await sleep(400);
  }
}

// ---- verify ----
const fin = (await call('GET', READ)).data?.results || [];
console.log('\n=== FINAL CURRICULUM ===');
for (const it of fin) console.log(it._class === 'chapter' ? `\n§ ${it.title}` : `   • ${it.title}`);
console.log(`\nCreated — chapters:${tally.chapters} lectures:${tally.lectures} failed:${tally.failed}`);
console.log('Manage: https://www.udemy.com/course/' + COURSE_ID + '/manage/curriculum/');

await sleep(1500);
await browser.close();
