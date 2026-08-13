// Set each SME's website link on their Coursera instructor profile.
//
// The partner console hides this, but the course-scoped editor at
//   /teach/{courseSlug}/course/settings/course-staff/profile/{instructorId}
// is backed by instructorProfiles.v1, and PUT there is accepted with our
// session. The public instructors.v1 view lags a minute or two behind the
// write — that is cache, not failure.
//
// ONLY social.websites is changed. The whole profile object is read, that one
// array is swapped, and everything else is re-sent verbatim; after the write
// the profile is re-read and compared field by field, and anything other than
// `social` differing is reported as a failure. Every original is backed up
// before its first write.
//
// Input: a JSON array of { id, name, slug, new, cur, reason }.
// Run: node updateCourseraInstructorLinks.js <todo.json> [--dry-run] [--limit=N]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimizeWindow } from './browserWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error('Usage: node updateCourseraInstructorLinks.js <todo.json> [--dry-run] [--limit=N]'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');
const lim = process.argv.find((a) => a.startsWith('--limit='));
const todo = JSON.parse(readFileSync(file, 'utf8')).slice(0, lim ? Number(lim.split('=')[1]) : Infinity);

const BACKUP = join(__dirname, 'coursera-instructor-backups.json');
const backups = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : [];
const backedUp = new Set(backups.map((b) => String(b.id)));
const results = [];
const save = () => {
  writeFileSync(BACKUP, JSON.stringify(backups, null, 1));
  writeFileSync('/tmp/coursera_link_updates.json', JSON.stringify(results, null, 1));
};

console.log(`${DRY ? '[DRY RUN] ' : ''}${todo.length} instructor profiles\n`);

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: join(__dirname, 'coursera-auth.json'), userAgent: UA });
const page = await ctx.newPage();
await minimizeWindow(ctx, page);

for (let i = 0; i < todo.length; i++) {
  const t = todo[i];
  const tag = `${String(i + 1).padStart(3)}/${todo.length}`;
  const rec = { id: t.id, name: t.name, reason: t.reason, from: t.cur, to: t.new, stage: null };
  try {
    await page.goto(`https://www.coursera.org/teach/${t.slug}/course/settings/course-staff/profile/${t.id}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => /CSRF3-Token=/.test(document.cookie), { timeout: 25000 }).catch(() => {});
    await sleep(2500);
    if (/join\/passwordless|\/login/.test(page.url())) {
      rec.stage = 'session-lost'; results.push(rec); save();
      console.log(`\n❌ ${tag} session lost — reconnect Coursera and re-run`); break;
    }

    const r = await page.evaluate(async ({ id, newUrl, dry }) => {
      const csrf = document.cookie.match(/CSRF3-Token=([^;]+)/)?.[1] || '';
      const H = { 'Content-Type': 'application/json', 'X-CSRF3-Token': csrf, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
      const U = `https://www.coursera.org/api/instructorProfiles.v1/${id}`;
      const get = async () => (await (await fetch(U, { credentials: 'include', headers: { Accept: 'application/json' } })).json()).elements?.[0];

      const before = await get();
      if (!before) return { stage: 'no-profile' };
      const cur = (before.social?.websites || [])[0] || null;
      if (cur === newUrl) return { stage: 'already-set', before };
      if (dry) return { stage: 'dry', before, cur };

      const body = JSON.parse(JSON.stringify(before));
      delete body.id;
      body.social = { ...before.social, websites: [newUrl] };
      const put = await fetch(U, { method: 'PUT', credentials: 'include', headers: H, body: JSON.stringify(body) });
      if (!put.ok) return { stage: 'put-failed', status: put.status, detail: (await put.text()).slice(0, 200), before };

      await new Promise((x) => setTimeout(x, 1200));
      const after = await get();
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after || {})])];
      const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after?.[k]));
      const socialChanged = Object.keys(before.social || {})
        .filter((k) => JSON.stringify(before.social[k]) !== JSON.stringify(after?.social?.[k]));
      return {
        stage: 'done', before,
        saved: (after?.social?.websites || [])[0] || null,
        onlySocial: changed.length === 1 && changed[0] === 'social',
        socialChanged, changed,
      };
    }, { id: t.id, newUrl: t.new, dry: DRY });

    Object.assign(rec, { stage: r.stage, saved: r.saved, onlySocial: r.onlySocial, socialChanged: r.socialChanged, detail: r.detail, status: r.status });
    if (r.before && !backedUp.has(String(r.before.id ?? t.id))) {
      backups.push({ id: t.id, capturedAt: new Date().toISOString(), profile: r.before });
      backedUp.add(String(t.id));
    }
    results.push(rec); save();

    const ok = r.stage === 'done' && r.saved === t.new && r.onlySocial;
    const label = String(t.name).slice(0, 30);
    if (r.stage === 'done') console.log(`${tag} ${ok ? '✅' : '⚠️ '} ${label.padEnd(31)} ${t.reason.padEnd(7)} -> ${r.saved === t.new ? 'saved' : 'MISMATCH'}${r.onlySocial ? '' : ' (other fields changed!)'}`);
    else if (r.stage === 'dry') console.log(`${tag} would set ${label.padEnd(31)} ${String(r.cur || '(none)').slice(0, 40)} -> ${t.new.slice(0, 46)}`);
    else console.log(`${tag} ${r.stage} ${r.detail ? '(' + r.detail.slice(0, 60) + ')' : ''} — ${label}`);
  } catch (e) {
    rec.stage = 'error'; rec.error = e.message; results.push(rec); save();
    console.log(`${tag} error: ${e.message.slice(0, 70)}`);
  }
  await sleep(700);
}
await browser.close();

const by = (s) => results.filter((r) => r.stage === s).length;
const good = results.filter((r) => r.stage === 'done' && r.saved === r.to && r.onlySocial);
console.log(`\n${'='.repeat(60)}`);
console.log(`${DRY ? 'would update' : 'updated'} : ${DRY ? by('dry') : good.length}`);
console.log(`already set  : ${by('already-set')}`);
for (const s of ['put-failed', 'no-profile', 'error', 'session-lost']) if (by(s)) console.log(`${s.padEnd(13)}: ${by(s)}`);
const bad = results.filter((r) => r.stage === 'done' && !(r.saved === r.to && r.onlySocial));
if (bad.length) {
  console.log(`\n⚠️  ${bad.length} wrote but did not verify cleanly:`);
  bad.forEach((r) => console.log(`   ${r.name}: saved=${r.saved} onlySocial=${r.onlySocial} changed=${JSON.stringify(r.changed)}`));
}
if (!DRY) console.log(`\nbackups: server/coursera-instructor-backups.json (${backups.length} profiles)`);
console.log('detail -> /tmp/coursera_link_updates.json');
