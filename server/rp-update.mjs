// The role-play create saved only the title; fill the content via an update call
// to courses/{courseId}/role-plays/{id}/ (tries PATCH, then PUT). Maps parsed data
// → scenario/learner_role/meeting/ai_character. Re-verifies after.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const RPS = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.roleplays.json'), 'utf8'));
const IDS = [43280, 43281]; // created RP ids, in RPS order
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlBlocks = (s) => String(s || '').split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('\n') || '<p></p>';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const DEFAULT_AVATAR = { id: 2, name: 'Character 2', image_url: 'instructor/role-play/examples/Contemplative+Man+in+Modern+Workspace.webp', voice_option: 'xZhTmJnxrn4YyTmPDrfZ', voice_provider: 'ELEVENLABS', interactive_props: { id: 0 } };
const durationMin = (s) => { const m = String(s || '').match(/\d+/); return m ? Number(m[0]) : 10; };

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

for (let i = 0; i < RPS.length; i++) {
  const rp = RPS[i], id = IDS[i];
  const payload = {
    title: rp.plan.title,
    scenario: htmlBlocks(rp.plan.scenario),
    learner_role: String(rp.plan.learner_role || '').replace(/\n+/g, ' ').trim(),
    meeting: {
      title: rp.settings.meeting_title,
      duration: durationMin(rp.settings.duration),
      goals: rp.goals.map((g) => ({ description: g })),
    },
    ai_character: {
      name: rp.character.name,
      role: rp.character.role,
      details: htmlBlocks(rp.character.personality),
      first_message: String(rp.character.first_line || '').replace(/\n+/g, ' ').trim(),
      avatar: DEFAULT_AVATAR,
    },
  };
  let r = await call('PATCH', `courses/${COURSE_ID}/role-plays/${id}/`, payload);
  if (r.status >= 400) { console.log(`  PATCH ${id} → ${r.status}, trying PUT…`); r = await call('PUT', `courses/${COURSE_ID}/role-plays/${id}/`, payload); }
  console.log(`RP${i + 1} update (${id}) → ${r.status}`);
  await sleep(700);
}

// verify
for (const id of IDS) {
  const rp = (await call('GET', `courses/${COURSE_ID}/role-plays/${id}/`)).data;
  console.log(`\n=== ${rp.title} (${id}) ===`);
  console.log('  scenario:', strip(rp.scenario).slice(0, 100) + '…');
  console.log('  learner_role:', strip(rp.learner_role).slice(0, 80));
  console.log('  meeting:', rp.meeting?.title, '·', rp.meeting?.duration, 'min ·', rp.meeting?.goals?.length, 'goals');
  console.log('  character:', rp.ai_character?.name, '—', rp.ai_character?.role);
  console.log('  first_message:', strip(rp.ai_character?.first_message).slice(0, 80));
}
console.log('\nManage: https://www.udemy.com/course/' + COURSE_ID + '/manage/curriculum/');
await sleep(1500);
await browser.close();
