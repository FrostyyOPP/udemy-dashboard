// Remove the blank spacer paragraphs from every published bonus lecture.
//
// Each article carries a literal `<p><br></p>` before each major heading
// (Recommended Next Courses, Exclusive Student Discount, Personalised Learning
// Path, Stay Connected, and the closing line) — five in a standard body. On top
// of Udemy's own paragraph margins that renders as a gap about two lines deep,
// which reads as a formatting mistake. Dropping the spacer leaves the normal
// margin to separate the sections.
//
// Deletes empty paragraphs and nothing else. The guard compares the article's
// visible TEXT before and after: if a single character of real content differs,
// the write is refused. Links are counted separately as a second check.
//
// Idempotent — a body with no spacers left is reported unchanged.
//
// Run: node removeBonusExtraSpacing.js --dry-run
//      node removeBonusExtraSpacing.js [--limit=N]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { minimizeWindow } from './browserWindow.js';
import { liveBonusCourses } from './bonusCourseList.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DRY = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: join(__dirname, 'udemy-auth.json'), userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await minimizeWindow(ctx, page);

// Work list comes from the LIVE catalogue, not the CSV-derived table.
const courses = (await liveBonusCourses(page)).slice(0, LIMIT);
console.log(`${DRY ? '[DRY RUN] ' : ''}${courses.length} courses to process\n`);

mkdirSync(join(__dirname, 'bonus-lecture-backups'), { recursive: true });
const results = []; const backups = [];
const save = () => {
  writeFileSync('/tmp/bonus_spacing_results.json', JSON.stringify(results, null, 2));
  if (backups.length) writeFileSync(join(__dirname, 'bonus-lecture-backups', 'bodies_before_spacing_fix.json'), JSON.stringify(backups, null, 2));
};

for (let i = 0; i < courses.length; i++) {
  const c = courses[i];
  const tag = `${String(i + 1).padStart(3)}/${courses.length}`;
  const rec = { courseId: c.realCourseId, title: c.title, stage: null, removed: 0 };
  try {
    await page.goto(`https://www.udemy.com/course/${c.realCourseId}/manage/curriculum/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => /csrftoken=/.test(document.cookie), { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    if (/login|join\/passwordless/.test(page.url())) { rec.stage = 'session-lost'; results.push(rec); save(); console.log(`\n❌ ${tag} session lost — reconnect Udemy and re-run`); break; }

    const attempt = async () => page.evaluate(async ({ cid, dry }) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
      const H = { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json, text/plain, */*', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' };
      const J = async (m, u, p) => { const o = { method: m, credentials: 'include', headers: H }; if (p !== undefined) o.body = JSON.stringify(p);
        const res = await fetch(`https://www.udemy.com${u}`, o); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
        return { status: res.status, json: j, text: t.slice(0, 220) }; };

      const cu = await J('GET', `/api-2.0/courses/${cid}/instructor-curriculum-items/?page_size=600&fields[lecture]=title&fields[chapter]=title`);
      if (cu.status !== 200 || !Array.isArray(cu.json?.results)) return { stage: 'retry', why: `curriculum ${cu.status}` };
      const bonus = cu.json.results.find((x) => x._class === 'lecture' && /bonus/i.test(x.title || ''));
      if (!bonus) return { stage: 'no-bonus' };
      const lec = await J('GET', `/api-2.0/users/me/subscribed-courses/${cid}/lectures/${bonus.id}/?fields[lecture]=asset&fields[asset]=asset_type,body`);
      if (lec.status !== 200 || !lec.json?.asset) return { stage: 'retry', why: `lecture ${lec.status}` };
      if (lec.json.asset.asset_type !== 'Article') return { stage: 'not-article', assetType: lec.json.asset.asset_type };
      const before = lec.json.asset.body || '';
      if (!before) return { stage: 'empty-body' };

      // A spacer is a paragraph whose only content is <br> and/or whitespace
      // (including &nbsp;) — never one carrying real text.
      const SPACER = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*/gi;
      const removed = (before.match(SPACER) || []).length;
      if (!removed) return { stage: 'unchanged' };
      const after = before.replace(SPACER, '');

      // Guard: the visible text must be byte-identical. This is the real
      // safety net — anything that deleted actual copy would trip it.
      const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .split('').map((x) => x.trim()).filter(Boolean).join('');
      if (text(after) !== text(before)) return { stage: 'guard', detail: 'visible text changed', before };
      const links = (s) => (s.match(/https:\/\/www\.udemy\.com\/course\//g) || []).length;
      if (links(after) !== links(before)) return { stage: 'guard', detail: 'course-link count changed', before };
      const hrefs = (s) => (s.match(/href="[^"]*"/g) || []);
      const hb = hrefs(before), ha = hrefs(after);
      if (hb.length !== ha.length || hb.some((h, k) => h !== ha[k])) return { stage: 'guard', detail: 'href changed', before };
      if (/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/i.test(after)) return { stage: 'guard', detail: 'spacer survived', before };

      if (dry) return { stage: 'dry', removed, before, after };

      const as = await J('POST', '/api-2.0/users/me/article-assets/', { body: after, ignore_warnings: true });
      if (as.status !== 201) return { stage: 'asset', status: as.status, detail: as.text, before };
      const ln = await J('PATCH', `/api-2.0/users/me/taught-courses/${cid}/lectures/${bonus.id}/`, { asset: as.json.id });
      if (ln.status !== 200) return { stage: 'link', status: ln.status, before };
      const v = await J('GET', `/api-2.0/users/me/subscribed-courses/${cid}/lectures/${bonus.id}/?fields[lecture]=asset&fields[asset]=body`);
      const liveBody = v.json?.asset?.body || '';
      return { stage: 'done', removed, matches: liveBody === after, before };
    }, { cid: c.realCourseId, dry: DRY });

    let r;
    for (let a = 0; a < 3; a++) {
      try { r = await attempt(); } catch (e) { r = { stage: 'retry', why: e.message.slice(0, 80) }; }
      if (r.stage !== 'retry') break;
      await sleep(3000 * (a + 1));
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForFunction(() => /csrftoken=/.test(document.cookie), { timeout: 30000 }).catch(() => {});
      await sleep(1500);
    }
    if (r.stage === 'retry') r = { stage: 'failed', detail: r.why };

    Object.assign(rec, r);
    if (r.before) { backups.push({ courseId: c.realCourseId, title: c.title, body: r.before }); delete rec.before; }
    delete rec.after;
    results.push(rec); save();

    const label = String(c.title).slice(0, 40);
    if (r.stage === 'unchanged') console.log(`${tag} ok (no spacers)        — ${label}`);
    else if (r.stage === 'dry') console.log(`${tag} would remove ${r.removed}        — ${label}`);
    else if (r.stage === 'done') console.log(`${tag} removed ${r.removed} verified=${r.matches} — ${label}`);
    else console.log(`${tag} ${r.stage}${r.detail ? ` (${r.detail})` : ''} — ${label}`);
  } catch (e) {
    rec.stage = 'error'; rec.error = e.message; results.push(rec); save();
    console.log(`${tag} error: ${e.message}`);
  }
}

await browser.close();
const by = (s) => results.filter((r) => r.stage === s).length;
const touched = results.filter((r) => r.stage === 'done' || r.stage === 'dry');
console.log(`\n${'='.repeat(60)}`);
console.log(`${DRY ? 'WOULD CLEAN' : 'CLEANED'}    : ${touched.length}`);
console.log(`spacers removed: ${touched.reduce((s, r) => s + (r.removed || 0), 0)}`);
console.log(`already clean  : ${by('unchanged')}`);
for (const s of ['no-bonus', 'not-article', 'empty-body', 'guard', 'asset', 'link', 'error', 'failed', 'session-lost']) {
  if (by(s)) console.log(`${s.padEnd(15)}: ${by(s)}`);
}
if (!DRY) {
  const bad = results.filter((r) => r.stage === 'done' && !r.matches);
  console.log(bad.length ? `\n⚠️  ${bad.length} saved but did not verify byte-for-byte` : '\nAll writes verified byte-for-byte.');
  console.log('backups: server/bonus-lecture-backups/bodies_before_spacing_fix.json');
}
console.log('detail -> /tmp/bonus_spacing_results.json');
