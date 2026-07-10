// Verify: read back sample questions (prompt/answers/correct/feedback) to confirm
// correctness, show the quiz's place in the curriculum, and clean up any stray
// empty-title chapters left by discovery. Deletes only empty/blank-title chapters.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const { id: QUIZ_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.quiz-created.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await page.goto(`https://www.udemy.com/course/${COURSE_ID}/manage/curriculum/`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await sleep(4000);

const call = (method, path) => page.evaluate(async ({ method, path }) => {
  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const res = await fetch(`https://www.udemy.com/api-2.0/${path}`, { method, credentials: 'include', headers: { Accept: 'application/json', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' } });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}, { method, path });

// 1) sample questions
const asmts = (await call('GET', `quizzes/${QUIZ_ID}/assessments/?page_size=100&fields[assessment]=@all`)).data?.results || [];
console.log(`quiz has ${asmts.length} questions. Spot-checking 3:\n`);
for (const idx of [0, 5, 29]) {
  const a = asmts[idx]; if (!a) continue;
  const letters = ['a', 'b', 'c', 'd'];
  console.log(`Q${idx + 1}: ${strip(a.prompt.question)}`);
  a.prompt.answers.forEach((ans, i) => {
    const mark = a.correct_response.includes(letters[i]) ? '✓' : ' ';
    console.log(`   ${mark} ${letters[i]}) ${strip(ans)}`);
  });
  console.log(`   correct_response: ${JSON.stringify(a.correct_response)}\n`);
}

// 2) curriculum placement + stray empty chapters
const items = (await call('GET', `courses/${COURSE_ID}/instructor-curriculum-items/?page_size=200&fields[lecture]=title&fields[chapter]=title&fields[quiz]=title,type`)).data?.results || [];
console.log('=== curriculum tail (last 6 items) ===');
for (const it of items.slice(-6)) console.log(`  [${it._class}] ${it.title || '(empty)'}`);

const strays = items.filter((x) => x._class === 'chapter' && !strip(x.title));
if (strays.length) {
  console.log(`\ncleaning ${strays.length} empty chapter(s)…`);
  for (const s of strays) { const d = await call('DELETE', `users/me/taught-courses/${COURSE_ID}/chapters/${s.id}/`); console.log(`  del empty chapter ${s.id} → ${d.status}`); await sleep(300); }
} else console.log('\nno stray empty chapters.');

await sleep(1200);
await browser.close();
console.log('\n✅ verify done');
