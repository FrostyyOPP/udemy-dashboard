// Replace the course image on Udemy for a list of courses.
//
// Flow (captured from the instructor console, not guessed):
//   1. POST /api-2.0/s3-upload-signatures/       signed upload
//   2. POST udemy-image-web-upload.s3.amazonaws.com   file to S3
//   3. POST /api-2.0/cropped-images/             Udemy makes its crops
//   4. PATCH /api-2.0/courses/{id}/              attach to the course
// All four are driven by attaching the file to the Course image input and
// clicking Save — attaching alone uploads to S3 but does NOT apply it.
//
// Source images are 1920x1080; Udemy wants 750x422 (same 16:9), so each is
// resized with sips before upload.
//
// Safety: the original image URL is recorded before every change, and after
// saving the course is re-read to confirm the image URL changed AND that
// title / headline / description are untouched — the Save button submits the
// whole basics form, so that is checked rather than assumed.
//
// Input JSON: [{ courseId, title, file }]
// Run: node updateUdemyThumbnails.js <jobs.json> [--dry-run] [--limit=N]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimizeWindow } from './browserWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = process.argv[2];
if (!src || !existsSync(src)) { console.error('Usage: node updateUdemyThumbnails.js <jobs.json> [--dry-run] [--limit=N]'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');
const lim = process.argv.find((a) => a.startsWith('--limit='));
const jobs = JSON.parse(readFileSync(src, 'utf8')).slice(0, lim ? Number(lim.split('=')[1]) : Infinity);

const TMP = join(__dirname, '.thumb-resized');
mkdirSync(TMP, { recursive: true });
const BACKUP = join(__dirname, 'udemy-thumbnail-backups.json');
const backups = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : [];
const results = [];
const save = () => {
  writeFileSync(BACKUP, JSON.stringify(backups, null, 1));
  writeFileSync('/tmp/udemy_thumbnail_results.json', JSON.stringify(results, null, 1));
};

console.log(`${DRY ? '[DRY RUN] ' : ''}${jobs.length} courses\n`);

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: join(__dirname, 'udemy-auth.json'), userAgent: UA });
const page = await ctx.newPage();
await minimizeWindow(ctx, page);

const read = (cid) => page.evaluate(async (id) => {
  const r = await fetch(`https://www.udemy.com/api-2.0/courses/${id}/?fields[course]=image_750x422,title,headline,description`,
    { credentials: 'include', headers: { Accept: 'application/json' } });
  return r.ok ? r.json() : null;
}, cid);

for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  const tag = `${String(i + 1).padStart(3)}/${jobs.length}`;
  const rec = { courseId: j.courseId, title: j.title, file: basename(j.file), stage: null };
  try {
    if (!existsSync(j.file)) { rec.stage = 'file-missing'; results.push(rec); save(); console.log(`${tag} ❌ file missing — ${j.title}`); continue; }
    const out = join(TMP, `${j.courseId}.png`);
    execFileSync('sips', ['--resampleHeightWidth', '422', '750', j.file, '--out', out], { stdio: 'ignore' });

    await page.goto(`https://www.udemy.com/instructor/course/${j.courseId}/manage/basics/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => /csrftoken=/.test(document.cookie), { timeout: 25000 }).catch(() => {});
    await sleep(6500);
    if (/join\/passwordless|\/login/.test(page.url())) { rec.stage = 'session-lost'; results.push(rec); save(); console.log(`\n❌ ${tag} session lost — reconnect Udemy`); break; }

    const before = await read(j.courseId);
    if (!before) { rec.stage = 'read-failed'; results.push(rec); save(); console.log(`${tag} ⚠️  could not read course — ${j.title}`); continue; }
    rec.before = before.image_750x422;
    if (!backups.some((b) => b.courseId === j.courseId)) {
      backups.push({ courseId: j.courseId, title: before.title, image_750x422: before.image_750x422, capturedAt: new Date().toISOString() });
    }
    if (DRY) { rec.stage = 'dry'; results.push(rec); save(); console.log(`${tag} would replace — ${String(j.title).slice(0, 46)}`); continue; }

    const input = page.locator('input[type=file][accept*="jpg"], input[type=file][accept*="png"]').first();
    if (!(await input.count())) { rec.stage = 'no-input'; results.push(rec); save(); console.log(`${tag} ⚠️  no image input — ${j.title}`); continue; }
    await input.setInputFiles(out);
    await sleep(11000);                       // S3 upload + crop generation

    // Capture the PATCH the Save button sends, so it can be re-issued if
    // Udemy rejects it on a validation warning.
    let patchBody = null;
    const grab = (r) => { if (r.method() === 'PATCH' && r.url().includes(`/api-2.0/courses/${j.courseId}/`)) patchBody = r.postData(); };
    page.on('request', grab);

    const saveBtn = page.locator('button', { hasText: /^Save$/i }).first();
    if (!(await saveBtn.count())) { page.off('request', grab); rec.stage = 'no-save-button'; results.push(rec); save(); console.log(`${tag} ⚠️  no Save button — ${j.title}`); continue; }
    await saveBtn.click().catch(() => {});
    await sleep(9000);
    page.off('request', grab);

    // Udemy's money-reference validator rejects the WHOLE basics form when a
    // course's own title or headline mentions money ("Cash Flow", "Securities"),
    // even though neither is being edited. Re-issuing the same PATCH with
    // ignore_warnings clears it — the flag the article-asset writes needed too.
    const mid = await read(j.courseId);
    if (patchBody && mid && mid.image_750x422 === rec.before) {
      const r2 = await page.evaluate(async ({ id, raw }) => {
        const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
        const res = await fetch(`https://www.udemy.com/api-2.0/courses/${id}/`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ ...JSON.parse(raw), ignore_warnings: true }),
        });
        return res.status;
      }, { id: j.courseId, raw: patchBody }).catch(() => null);
      if (r2) { rec.ignoredWarnings = true; await sleep(4000); }
    }

    const after = await read(j.courseId);
    rec.after = after?.image_750x422 ?? null;
    const changed = rec.after && rec.after !== rec.before;
    // Save submits the whole basics form — confirm nothing else moved.
    const intact = after && after.title === before.title && after.headline === before.headline
      && after.description === before.description;
    rec.stage = changed && intact ? 'done' : 'verify-failed';
    rec.changed = !!changed; rec.intact = !!intact;
    results.push(rec); save();
    console.log(`${tag} ${rec.stage === 'done' ? '✅' : '⚠️ '} ${String(j.title).slice(0, 44).padEnd(46)}`
      + `${changed ? 'image changed' : 'IMAGE UNCHANGED'}${intact ? '' : ' · OTHER FIELDS MOVED'}`);
  } catch (e) {
    rec.stage = 'error'; rec.error = e.message.slice(0, 120); results.push(rec); save();
    console.log(`${tag} error: ${e.message.slice(0, 70)}`);
  }
  await sleep(1200);
}
await browser.close();

const by = (s) => results.filter((r) => r.stage === s).length;
console.log(`\n${'='.repeat(60)}`);
console.log(`${DRY ? 'would replace' : 'replaced'} : ${DRY ? by('dry') : by('done')}`);
for (const s of ['verify-failed', 'file-missing', 'read-failed', 'no-input', 'no-save-button', 'error', 'session-lost']) {
  if (by(s)) console.log(`${s.padEnd(16)}: ${by(s)}`);
}
if (!DRY) console.log(`\nbackups: server/udemy-thumbnail-backups.json (${backups.length} courses)`);
console.log('detail -> /tmp/udemy_thumbnail_results.json');
