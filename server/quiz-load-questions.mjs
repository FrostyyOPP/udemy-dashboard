// Load all parsed MCQ questions into the already-created quiz (id from
// quiz-created.json). Question schema learned from an existing course:
//   POST /api-2.0/quizzes/{quizId}/assessments/
//   { _class:"assessment", assessment_type:"multiple-choice",
//     prompt:{ question, answers[], feedbacks[] }, correct_response:["<letter>"],
//     question_plain }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const { id: QUIZ_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.quiz-created.json'), 'utf8'));
const QUESTIONS = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.quiz.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) => `<p>${esc(s)}</p>`;

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

// skip any questions already present (idempotent re-run)
const existing = (await call('GET', `quizzes/${QUIZ_ID}/assessments/?page_size=100&fields[assessment]=question_plain`)).data?.results || [];
const have = new Set(existing.map((a) => (a.question_plain || '').trim().slice(0, 60)));
console.log(`quiz ${QUIZ_ID} already has ${existing.length} question(s).`);

let ok = 0, fail = 0, skip = 0;
for (let i = 0; i < QUESTIONS.length; i++) {
  const Q = QUESTIONS[i];
  if (have.has(Q.prompt.trim().slice(0, 60))) { skip++; console.log(`  Q${i + 1} — already present, skip`); continue; }
  const answers = Q.options.map((o) => html(o.text));
  const feedbacks = Q.options.map((o) => (o.feedback ? html(o.feedback) : ''));
  const correctLetter = 'abcdefgh'[Q.options.findIndex((o) => o.correct)];
  const body = {
    _class: 'assessment', assessment_type: 'multiple-choice',
    prompt: { question: html(Q.prompt), answers, feedbacks },
    correct_response: [correctLetter], question_plain: Q.prompt.slice(0, 1000),
  };
  const r = await call('POST', `quizzes/${QUIZ_ID}/assessments/`, body);
  if (r.status >= 200 && r.status < 300) { ok++; console.log(`  Q${i + 1} → ${r.status} (correct=${correctLetter})`); }
  else { fail++; console.log(`  Q${i + 1} → ${r.status} FAILED ${JSON.stringify(r.data).slice(0, 160)}`); }
  await sleep(350);
}

const check = (await call('GET', `quizzes/${QUIZ_ID}/assessments/?page_size=100&fields[assessment]=id`)).data?.count;
console.log(`\nadded ${ok}, skipped ${skip}, failed ${fail} — quiz now has ${check} question(s).`);
console.log('Manage: https://www.udemy.com/course/' + COURSE_ID + '/manage/curriculum/');
await sleep(1500);
await browser.close();
