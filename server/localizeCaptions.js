// Caption localization orchestrator for the dashboard.
//
// One background job localizes N courses × M languages end-to-end:
//   ensure English .vtt exist (download missing) → translate (free Google engine)
//   → upload to Udemy → auto-publish. Idempotent: skips any lecture that already
//   has that locale caption, so re-running only fills gaps.
//
// Runs a single HEADED browser per job (inherits the connected session + CSRF +
// S3 CORS, exactly like the CLI scripts). Progress is exposed via an in-memory
// job registry that the API polls; nothing here is persisted.
//
// This module is self-contained on purpose — the proven CLI scripts
// (translateVtt.js / uploadCaptions.js) stay untouched.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { minimizeWindow } from './browserWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const EN_DIR = join(__dirname, 'caption-files');
const BUCKET = 'udemy-web-upload-transitional';
// Udemy's static bucket-uploader key (public: the browser sends it on every upload).
const AWS_KEY = process.env.UDEMY_AWS_KEY || 'AKIA5IZMAQTGTLHQJLAD';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || 'untitled').replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
// Throughput knobs (override via env). Translation batches many cues per request
// (see googleBatch); this caps how many batch requests run at once. Uploads run
// concurrently in the one page context.
const BATCH_CONCURRENCY = Number(process.env.CAP_TRANSLATE_CONCURRENCY) || 8;
const UPLOAD_CONCURRENCY = Number(process.env.CAP_UPLOAD_CONCURRENCY) || 5;

// name → { tl: Google target code, locale: Udemy locale_id, core: pin in picker }.
// NOTE: only es_LA is verified live end-to-end. If a locale_id is rejected by
// Udemy's draft-captions endpoint, fix it here — it's the single source of truth.
export const SUPPORTED_LANGS = [
  { name: 'Spanish',    tl: 'es',    locale: 'es_LA', core: true },
  { name: 'French',     tl: 'fr',    locale: 'fr_FR', core: true },
  { name: 'German',     tl: 'de',    locale: 'de_DE', core: true },
  { name: 'Portuguese', tl: 'pt',    locale: 'pt_BR', core: true },
  { name: 'Italian',    tl: 'it',    locale: 'it_IT', core: true },
  { name: 'Arabic',     tl: 'ar',    locale: 'ar_SA', core: true },
  { name: 'Hindi',      tl: 'hi',    locale: 'hi_IN' },
  { name: 'Chinese (Simplified)', tl: 'zh-CN', locale: 'zh_CN' },
  { name: 'Chinese (Traditional)', tl: 'zh-TW', locale: 'zh_TW' },
  { name: 'Japanese',   tl: 'ja',    locale: 'ja_JP' },
  { name: 'Korean',     tl: 'ko',    locale: 'ko_KR' },
  { name: 'Russian',    tl: 'ru',    locale: 'ru_RU' },
  { name: 'Turkish',    tl: 'tr',    locale: 'tr_TR' },
  { name: 'Polish',     tl: 'pl',    locale: 'pl_PL' },
  { name: 'Dutch',      tl: 'nl',    locale: 'nl_NL' },
  { name: 'Indonesian', tl: 'id',    locale: 'id_ID' },
  { name: 'Vietnamese', tl: 'vi',    locale: 'vi_VN' },
  { name: 'Thai',       tl: 'th',    locale: 'th_TH' },
  { name: 'Ukrainian',  tl: 'uk',    locale: 'uk_UA' },
  { name: 'Hebrew',     tl: 'iw',    locale: 'he_IL' },
  { name: 'Greek',      tl: 'el',    locale: 'el_GR' },
  { name: 'Swedish',    tl: 'sv',    locale: 'sv_SE' },
  { name: 'Romanian',   tl: 'ro',    locale: 'ro_RO' },
  { name: 'Czech',      tl: 'cs',    locale: 'cs_CZ' },
  { name: 'Danish',     tl: 'da',    locale: 'da_DK' },
  { name: 'Finnish',    tl: 'fi',    locale: 'fi_FI' },
  { name: 'Norwegian',  tl: 'no',    locale: 'nb_NO' },
  { name: 'Hungarian',  tl: 'hu',    locale: 'hu_HU' },
  { name: 'Spanish (Spain)', tl: 'es', locale: 'es_ES' },
  { name: 'Portuguese (Portugal)', tl: 'pt', locale: 'pt_PT' },
];
const byLocale = (loc) => SUPPORTED_LANGS.find((l) => l.locale === loc);
const targetDir = (lang, slug) => join(__dirname, `caption-files-${lang.tl.toLowerCase()}`, slug);

// ---------- translation (free Google endpoint, small concurrency) ----------
async function googleOne(text, tl) {
  if (!text.trim()) return text;
  // sl=auto (not a hardcoded 'en') — some courses' only existing caption track
  // is in a language other than English (e.g. a native-Spanish course), and we
  // translate from whatever source track Udemy actually has (see ensureSource).
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      return (data[0] || []).map((seg) => seg[0]).join('');
    } catch (e) { if (a === 3) throw e; await sleep(800 * (a + 1)); }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}
function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  const header = blocks.shift();
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    cues.push({ pre: lines.slice(0, tsIdx + 1).join('\n'), text: lines.slice(tsIdx + 1).join('\n').trim() });
  }
  return { header, cues };
}
const buildVtt = (header, cues) => [header, ...cues.map((c) => `${c.pre}\n${c.text}`)].join('\n\n') + '\n';

// Batched Google translation. Google's endpoint is 1-request-per-call, but it
// PRESERVES newlines as segment boundaries — so we join many cues with "\n",
// translate in one request, and split back 1:1. ~4× faster than per-cue.
// SAFEGUARD: if a chunk's line count doesn't round-trip, that chunk falls back
// to per-cue translation, so alignment can never silently drift.
async function googleBatch(texts, tl, onProg) {
  const out = new Array(texts.length);
  const chunks = []; let cur = [], chars = 0;
  const flush = () => { if (cur.length) { chunks.push(cur); cur = []; chars = 0; } };
  texts.forEach((t, idx) => {
    const s = String(t ?? '');
    if (!s.trim()) { out[idx] = s; return; }                 // empties pass through
    const line = s.replace(/\s*\n\s*/g, ' ').trim();          // one line → safe delimiter
    if (cur.length >= 40 || chars + line.length > 1200) flush();
    cur.push({ idx, line }); chars += line.length + 1;
  });
  flush();
  let done = 0;
  await pool(chunks, BATCH_CONCURRENCY, async (ch) => {
    let parts = null;
    try { parts = (await googleOne(ch.map((c) => c.line).join('\n'), tl)).split('\n'); } catch { parts = null; }
    if (parts && parts.length === ch.length) {
      ch.forEach((c, k) => { out[c.idx] = parts[k].trim() || c.line; });
    } else {                                                   // drift → per-cue fallback
      await pool(ch, 6, async (c) => { out[c.idx] = await googleOne(c.line, tl).catch(() => c.line); });
    }
    done += ch.length; if (onProg) onProg(done, texts.length);
  });
  return out;
}

// ---------- in-page helpers (carry session + CSRF + S3 CORS) ----------
const mkApiGet = (page) => (u) => page.evaluate(async (x) => {
  try { const r = await fetch(x, { credentials: 'include', headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; } catch { return null; }
}, u);

// Resolve slug → { courseId, lectures:[{id,assetId,title}] } (video lectures, in order).
async function resolveCourse(apiGet, slug) {
  let courseId = null;
  let url = 'https://www.udemy.com/api-2.0/users/me/taught-courses/?page_size=100&fields[course]=published_title';
  while (url && !courseId) {
    const d = await apiGet(url); if (!d?.results) break;
    const hit = d.results.find((c) => c.published_title === slug);
    if (hit) courseId = hit.id; url = d.next || null;
  }
  if (!courseId) return null;
  const lectures = [];
  let cu = `https://www.udemy.com/api-2.0/courses/${courseId}/public-curriculum-items/?page_size=200&fields[lecture]=id,title,asset&fields[asset]=asset_type,id`;
  while (cu) { const d = await apiGet(cu); if (!d?.results) break;
    for (const it of d.results) if (it._class === 'lecture' && it.asset?.asset_type === 'Video') lectures.push({ id: it.id, assetId: it.asset.id, title: it.title });
    cu = d.next || null;
  }
  return { courseId, lectures };
}

// Ensure caption-files/<slug>/NNN-title.vtt exist for every lecture that has a
// usable source caption. Prefers English, but falls back to whatever locale
// Udemy actually has — some courses are natively non-English (e.g. a
// Spanish-only course with no English track at all), and translating
// "from English" when none exists silently downloads and uploads nothing.
// Downloads only what's missing. Returns { downloaded, sourceLocale } —
// sourceLocale (e.g. "es_LA") is used to skip translating into itself and to
// tell Google Translate the true source language (see googleOne's sl=auto).
async function ensureEnglish(page, ctx, courseId, lectures, slug) {
  const dir = join(EN_DIR, clean(slug));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const already = new Set(readdirSync(dir));
  const need = [];
  lectures.forEach((lec, li) => {
    const fname = `${String(li + 1).padStart(3, '0')}-${clean(lec.title)}.vtt`;
    if (!already.has(fname)) need.push({ li, lec, fname });
  });
  if (!need.length) return { downloaded: 0, sourceLocale: null };
  // fetch caption URLs (in-page, chunks of 8)
  const ids = need.map((n) => n.lec.id);
  const capHit = {};
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const res = await page.evaluate(async ({ cid, chunk }) => {
      const out = {};
      await Promise.all(chunk.map(async (id) => {
        try {
          const r = await fetch(`https://www.udemy.com/api-2.0/users/me/subscribed-courses/${cid}/lectures/${id}/?fields[lecture]=asset&fields[asset]=captions&fields[caption]=url,locale_id,title`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (!r.ok) return;
          const j = await r.json();
          const caps = j.asset?.captions || [];
          const en = caps.find((c) => /^en/i.test(c.locale_id || '') || /english/i.test(c.title || ''));
          const pick = en || caps[0]; // no English track? fall back to whatever exists
          if (pick?.url) out[id] = { url: pick.url, locale: pick.locale_id || null };
        } catch {}
      }));
      return out;
    }, { cid: courseId, chunk });
    Object.assign(capHit, res);
    await sleep(120);
  }
  let n = 0; let sourceLocale = null;
  for (const { lec, fname } of need) {
    const hit = capHit[lec.id]; if (!hit?.url) continue;
    if (!sourceLocale && hit.locale) sourceLocale = hit.locale;
    try { const r = await ctx.request.get(hit.url); if (r.ok()) { writeFileSync(join(dir, fname), await r.text()); n++; } } catch {}
  }
  return { downloaded: n, sourceLocale };
}

// Existing locale caption asset-ids for a course (so we skip already-done lectures).
async function existingLocaleAssets(apiGet, courseId, locale) {
  const d = await apiGet(`https://www.udemy.com/api-2.0/courses/${courseId}/captions/?fields[caption]=asset_id,locale_id&locale=${locale}`);
  const set = new Set();
  for (const c of d?.results || []) if (c.locale_id === locale && c.asset_id) set.add(c.asset_id);
  return set;
}

// Upload one translated .vtt to an asset and poll until Udemy auto-publishes.
async function uploadOne(page, courseId, assetId, filename, vttText, locale) {
  return page.evaluate(async ({ courseId, assetId, filename, vttText, locale, BUCKET, AWS_KEY }) => {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
    const uuid = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(16).slice(2));
    const key = uuid + '.vtt';
    const metaName = encodeURIComponent(filename);
    const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const conditions = [
      { acl: 'private' }, { bucket: BUCKET }, { 'Content-Type': 'text/vtt' },
      { success_action_status: '200' }, { key }, { 'x-amz-meta-qqfilename': metaName },
      ['content-length-range', '1', '4000000000'],
    ];
    const sigRes = await fetch('https://www.udemy.com/api-2.0/s3-upload-signatures/', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({ expiration: exp, conditions }),
    });
    const sig = await sigRes.json().catch(() => ({}));
    if (!sigRes.ok) return { step: 'sign', status: sigRes.status };
    const fd = new FormData();
    fd.append('key', key);
    fd.append('acl', 'private');
    fd.append('Content-Type', 'text/vtt');
    fd.append('success_action_status', '200');
    fd.append('x-amz-meta-qqfilename', metaName);
    fd.append('AWSAccessKeyId', sig.AWSAccessKeyId || sig.access_key || AWS_KEY);
    fd.append('policy', sig.policy);
    fd.append('signature', sig.signature);
    fd.append('file', new Blob([vttText], { type: 'text/vtt' }), filename);
    const s3 = await fetch(`https://${BUCKET}.s3.amazonaws.com/`, { method: 'POST', body: fd });
    if (!(s3.status === 200 || s3.status === 201 || s3.status === 204)) return { step: 's3', status: s3.status };
    const dc = await fetch(`https://www.udemy.com/api-2.0/courses/${courseId}/assets/${assetId}/draft-captions/?fields[draft_caption]=locale,title,url,source,status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({ locale_id: locale, asset: assetId, file_name: key, uuid, title: filename, bucket: BUCKET }),
    });
    const draft = await dc.json().catch(() => ({}));
    if (!dc.ok) return { step: 'draft', status: dc.status };
    let pub = null;
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`https://www.udemy.com/api-2.0/courses/${courseId}/assets/${assetId}/draft-captions/${draft.id}/?fields[draft_caption]=status,published_caption_id`, { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (j.published_caption_id) { pub = j.published_caption_id; break; }
      await new Promise((res) => setTimeout(res, 1000));
    }
    return { step: 'done', published_caption_id: pub };
  }, { courseId, assetId, filename, vttText, locale, BUCKET, AWS_KEY });
}

// ---------- job registry ----------
const jobs = new Map();
export function getJob(id) { return jobs.get(id) || null; }

// Start a localization job. Returns the job object immediately; work runs async.
// opts: { slugs:[], locales:[udemy locale_id], dryRun:bool, limit:number }
//   limit — cap lectures per course (e.g. 1 for a quick locale-ID test); 0 = all.
export function startJob({ slugs = [], locales = [], dryRun = false, limit = 0 } = {}) {
  if (!existsSync(AUTH_FILE)) throw Object.assign(new Error('Not connected — use Connect Udemy first'), { status: 400 });
  if (!slugs.length) throw Object.assign(new Error('No courses selected'), { status: 400 });
  const langs = locales.map(byLocale).filter(Boolean);
  if (!langs.length) throw Object.assign(new Error('No valid languages selected'), { status: 400 });

  const id = randomUUID();
  const job = {
    id, dryRun, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    phase: 'starting', phaseDetail: 'Preparing…', progress: { done: 0, total: 0 },
    languages: langs.map((l) => ({ name: l.name, locale: l.locale })),
    courses: slugs.map((slug) => ({ slug, status: 'pending', courseId: null, lectures: null, langs: {} })),
    totals: { published: 0, skipped: 0, failed: 0, translated: 0, downloaded: 0 },
    log: [], error: null,
  };
  jobs.set(id, job);
  const log = (m) => { job.log.push(`${new Date().toLocaleTimeString()}  ${m}`); if (job.log.length > 800) job.log.shift(); };
  runJob(job, slugs, langs, dryRun, Number(limit) || 0, log).catch((e) => {
    // The whole job runs on one headed browser page — if it closes mid-run (Mac slept,
    // Chromium got killed under memory pressure, etc.) every remaining upload fails at
    // once. Uploads are idempotent (already-published locales are skipped), so surface a
    // message that tells the user it's safe to just retry.
    const crashed = /Target (page, context or browser|closed)/i.test(e.message || '');
    const friendly = crashed
      ? `Browser closed unexpectedly mid-run (often the Mac sleeping, or Chromium running low on memory during a long batch). Progress so far (${job.progress.done}/${job.progress.total || '?'}) is safe — already-published captions are skipped, so Try Again will resume from here.`
      : e.message;
    job.status = 'error'; job.phase = 'error'; job.phaseDetail = friendly; job.error = friendly;
    job.finishedAt = new Date().toISOString(); log(`✗ job failed: ${e.message}`);
  });
  return job;
}

async function runJob(job, slugs, langs, dryRun, limit, log) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
  try {
    const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    const page = await ctx.newPage();
    await minimizeWindow(ctx, page); // keep the automation window out of the user's way
    const apiGet = mkApiGet(page);
    log(`${dryRun ? 'DRY RUN — ' : ''}${slugs.length} course(s) × ${langs.length} language(s)`);

    const nC = job.courses.length;
    for (let ci = 0; ci < job.courses.length; ci++) {
      const cj = job.courses[ci];
      const where = nC > 1 ? ` · course ${ci + 1}/${nC}` : '';
      cj.status = 'running';
      // warm Cloudflare on this course page, then resolve id + lectures
      job.phase = 'download'; job.phaseDetail = `Preparing ${cj.slug}${where}`;
      await page.goto(`https://www.udemy.com/course/${cj.slug}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(2500);
      const resolved = await resolveCourse(apiGet, cj.slug);
      if (!resolved) { cj.status = 'error'; log(`✗ ${cj.slug}: not found in taught-courses`); continue; }
      cj.courseId = resolved.courseId; cj.lectures = resolved.lectures.length;
      await page.evaluate((cid) => { window.__CID = cid; }, resolved.courseId);

      job.phase = 'download'; job.phaseDetail = `Downloading source captions — ${cj.slug}${where}`;
      const { downloaded: dl, sourceLocale } = await ensureEnglish(page, ctx, resolved.courseId, resolved.lectures, cj.slug);
      if (dl) { job.totals.downloaded += dl; log(`${cj.slug}: downloaded ${dl} source caption(s)${sourceLocale ? ` (source language: ${sourceLocale})` : ''}`); }
      const enDir = join(EN_DIR, clean(cj.slug));
      let enFiles = existsSync(enDir) ? readdirSync(enDir).filter((f) => f.endsWith('.vtt')).sort() : [];
      if (limit > 0) enFiles = enFiles.slice(0, limit);
      if (!enFiles.length) log(`✗ ${cj.slug}: no usable source caption found on Udemy for any lecture — nothing to translate`);

      // Skip "translating" into the language that's already the source on Udemy —
      // it's already there, and existingLocaleAssets would skip the upload anyway.
      const effLangs = sourceLocale ? langs.filter((l) => l.locale !== sourceLocale) : langs;
      for (const skipLang of (sourceLocale ? langs.filter((l) => l.locale === sourceLocale) : [])) {
        cj.langs[skipLang.locale] = { name: skipLang.name, locale: skipLang.locale, translated: 0, published: 0, skipped: enFiles.length, failed: 0, total: enFiles.length, status: 'done' };
        job.totals.skipped += enFiles.length;
        log(`${cj.slug} → ${skipLang.name}: skipped (already the source language on Udemy)`);
      }
      job.progress.total += enFiles.length * effLangs.length; // upload units for this course

      for (const lang of effLangs) {
        const st = { name: lang.name, locale: lang.locale, translated: 0, published: 0, skipped: 0, failed: 0, total: enFiles.length, status: 'running' };
        cj.langs[lang.locale] = st;
        const outDir = targetDir(lang, clean(cj.slug));
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

        // translate missing files — flatten every cue across all files and run
        // ONE bounded pool (fast, but capped so we don't trip Google rate limits).
        job.phase = 'translate'; job.phaseDetail = `Translating → ${lang.name} — ${cj.slug}${where}`;
        const toDo = enFiles.filter((f) => !existsSync(join(outDir, f)));
        if (toDo.length) {
          const parsed = toDo.map((f) => ({ f, ...parseVtt(readFileSync(join(enDir, f), 'utf8')) }));
          const flat = [];
          parsed.forEach((p, pi) => p.cues.forEach((c, ci) => flat.push({ pi, ci, text: c.text })));
          const out = await googleBatch(flat.map((x) => x.text), lang.tl, (d, total) => {
            job.phaseDetail = `Translating → ${lang.name} ${d}/${total} cues — ${cj.slug}${where}`;
          });
          flat.forEach((it, k) => { parsed[it.pi].cues[it.ci].text = out[k] ?? parsed[it.pi].cues[it.ci].text; });
          for (const p of parsed) {
            try { writeFileSync(join(outDir, p.f), buildVtt(p.header, p.cues)); st.translated++; job.totals.translated++; }
            catch (e) { log(`  ✗ write ${cj.slug}/${p.f} → ${lang.name}: ${e.message}`); }
          }
        }
        log(`${cj.slug} → ${lang.name}: translated ${st.translated}, ${enFiles.length} total`);

        if (dryRun) { st.status = 'planned'; job.progress.done += enFiles.length; continue; }

        // upload — build the work list (skipping already-present / missing), then
        // run several uploads concurrently in the one page context.
        job.phase = 'upload';
        const already = await existingLocaleAssets(apiGet, resolved.courseId, lang.locale);
        const items = [];
        for (const f of enFiles) {
          const idx = parseInt(f.slice(0, 3), 10);
          const lec = resolved.lectures[idx - 1];
          const outPath = join(outDir, f);
          if (!lec || !existsSync(outPath)) { job.progress.done++; continue; }
          if (already.has(lec.assetId)) { st.skipped++; job.totals.skipped++; job.progress.done++; continue; }
          items.push({ lec, outPath, title: f.replace(/^\d+-/, ''), f });
        }
        let up = 0;
        await pool(items, UPLOAD_CONCURRENCY, async (it) => {
          const res = await uploadOne(page, resolved.courseId, it.lec.assetId, it.title, readFileSync(it.outPath, 'utf8'), lang.locale);
          if (res.step === 'done' && res.published_caption_id) { st.published++; job.totals.published++; }
          else { st.failed++; job.totals.failed++; log(`  ✗ ${cj.slug}/${it.f} → ${lang.name}: failed at ${res.step} (${res.status || ''})`); }
          job.progress.done++; up++;
          job.phaseDetail = `Uploading → ${lang.name} ${up}/${items.length} — ${cj.slug}${where}`;
        });
        st.status = 'done';
        log(`${cj.slug} → ${lang.name}: published ${st.published}, skipped ${st.skipped}${st.failed ? `, failed ${st.failed}` : ''}`);
      }
      cj.status = 'done';
    }
    job.status = 'done';
    job.phase = 'done';
    job.phaseDetail = `Done — published ${job.totals.published}${job.totals.skipped ? `, skipped ${job.totals.skipped}` : ''}${job.totals.failed ? `, failed ${job.totals.failed}` : ''}`;
    job.finishedAt = new Date().toISOString();
    log(`✅ finished — published ${job.totals.published}, skipped ${job.totals.skipped}, translated ${job.totals.translated}${job.totals.failed ? `, failed ${job.totals.failed}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
  }
}
