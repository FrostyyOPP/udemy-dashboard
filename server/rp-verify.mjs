import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const { id: COURSE_ID } = JSON.parse(readFileSync(join(__dirname, 'course-shells', 'critical-thinking-ai-era.created.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await page.goto('https://www.udemy.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(()=>{});
await sleep(2500);
const get = (p) => page.evaluate(async (x) => { const r = await fetch(`https://www.udemy.com/api-2.0/${x}`, {credentials:'include',headers:{Accept:'application/json'}}); return r.ok?await r.json():{__s:r.status}; }, p);
for (const id of [43280, 43281]) {
  const rp = await get(`courses/${COURSE_ID}/role-plays/${id}/`);
  console.log(`\n=== ${rp.title} (id ${id}) ===`);
  console.log('scenario:', strip(rp.scenario).slice(0,120)+'…');
  console.log('learner_role:', strip(rp.learner_role).slice(0,90));
  console.log('meeting:', rp.meeting?.title, '·', rp.meeting?.duration, 'min ·', rp.meeting?.goals?.length, 'goals');
  console.log('  goal1:', rp.meeting?.goals?.[0]?.description?.slice(0,80));
  console.log('ai_character:', rp.ai_character?.name, '—', rp.ai_character?.role);
  console.log('  details:', strip(rp.ai_character?.details).slice(0,90)+'…');
  console.log('  first_message:', strip(rp.ai_character?.first_message).slice(0,90));
}
// curriculum tail
const items = (await get(`courses/${COURSE_ID}/instructor-curriculum-items/?page_size=200&fields[role-play]=title&fields[quiz]=title&fields[chapter]=title&fields[lecture]=title`)).results||[];
console.log('\n=== curriculum tail ===');
for (const it of items.slice(-6)) console.log(`  [${it._class}] ${it.title}`);
await sleep(800); await browser.close(); console.log('\ndone');
