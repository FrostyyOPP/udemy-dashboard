// Create the parsed AI role-plays on the draft course.
//   POST /api-2.0/courses/{courseId}/role-plays/
// Schema learned from an existing role-play (courses/{id}/role-plays/{id}/):
//   { title, scenario(HTML), learner_role, meeting{title,goals[{description}],duration},
//     ai_character{name,role,details(HTML),first_message,avatar{...}}, type }
// Appends both to the curriculum; you can drag RP1→Module 1, RP2→Module 2 after.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const RPS = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.roleplays.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// multi-paragraph text (newline-separated) → HTML <p> blocks
const htmlBlocks = (s) => String(s || '').split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('\n') || '<p></p>';

// Default preset avatar/voice (from an existing role-play). Instructor can change
// the avatar + voice per character in the builder afterward.
const DEFAULT_AVATAR = { id: 2, name: 'Character 2', image_url: 'instructor/role-play/examples/Contemplative+Man+in+Modern+Workspace.webp', voice_option: 'xZhTmJnxrn4YyTmPDrfZ', voice_provider: 'ELEVENLABS', interactive_props: { id: 0 } };

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

const durationMin = (s) => { const m = String(s || '').match(/\d+/); return m ? Number(m[0]) : 10; };

let ok = 0, fail = 0;
for (let i = 0; i < RPS.length; i++) {
  const rp = RPS[i];
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
    type: 'MANUALLY_CREATED',
  };
  const r = await call('POST', `courses/${COURSE_ID}/role-plays/`, payload);
  if (r.status >= 200 && r.status < 300 && r.data?.id) {
    ok++;
    console.log(`✅ RP${i + 1} "${rp.plan.title}" [${rp.module}] → ${r.status} id=${r.data.id}`);
  } else {
    fail++;
    console.log(`❌ RP${i + 1} "${rp.plan.title}" → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  }
  await sleep(800);
}

// verify
const items = (await call('GET', `courses/${COURSE_ID}/instructor-curriculum-items/?page_size=200&fields[role-play]=title`)).data?.results || [];
const rps = items.filter((x) => x._class === 'role-play');
console.log(`\ncreated ${ok}, failed ${fail}. Course now has ${rps.length} role-play(s):`);
for (const x of rps) console.log(`  • ${x.title}`);
console.log('Manage: https://www.udemy.com/course/' + COURSE_ID + '/manage/curriculum/');
await sleep(1500);
await browser.close();
