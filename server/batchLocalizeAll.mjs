// One-off maintenance script: run caption localization across EVERY published
// course, in small batches (default 5), so a single-browser crash on a long
// run only costs one batch — not the whole catalog (see localizeCaptions.js:
// one headed browser page drives an entire job end to end). Idempotent:
// already-published locales are skipped by the job itself, so batches are
// safe to retry or re-run the whole script from scratch at any time.
// Run: node batchLocalizeAll.mjs [batchSize]
const BASE = process.env.DASHBOARD_URL || 'http://localhost:5055';
const AUTH_USER = process.env.DASHBOARD_USER || 'admin';
// Set DASHBOARD_PASSWORD in the environment (matches the running backend's).
const AUTH_PASS = process.env.DASHBOARD_PASSWORD || '';
const BATCH_SIZE = Number(process.argv[2]) || 5;
// Core 6 — the set the dashboard treats as core (matches SUPPORTED_LANGS core:true).
const CORE_LOCALES = ['es_LA', 'fr_FR', 'de_DE', 'pt_BR', 'it_IT', 'ar_SA'];

const authHeader = 'Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: authHeader, 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} ${path}`);
  return data;
}

async function runBatch(slugs, attempt = 1) {
  const { jobId } = await api('/api/captions/localize', {
    method: 'POST',
    body: JSON.stringify({ slugs, locales: CORE_LOCALES, dryRun: false }),
  });
  let job;
  while (true) {
    await sleep(3000);
    job = await api(`/api/captions/jobs/${jobId}`);
    if (job.status !== 'running') break;
  }
  if (job.status === 'error' && attempt < 2) {
    console.log(`  ⚠️  batch crashed (${job.error}) — retrying once…`);
    return runBatch(slugs, attempt + 1);
  }
  return job;
}

console.log(`\n=== Batch caption localization · ${new Date().toISOString()} ===`);
console.log(`Languages: ${CORE_LOCALES.join(', ')} · batch size: ${BATCH_SIZE}\n`);

const coursesData = await api('/api/courses');
const slugs = (coursesData.results || []).filter((c) => c.is_published && c.published_title).map((c) => c.published_title);
console.log(`${slugs.length} published courses to process.\n`);

const batches = [];
for (let i = 0; i < slugs.length; i += BATCH_SIZE) batches.push(slugs.slice(i, i + BATCH_SIZE));

const totals = { published: 0, skipped: 0, translated: 0, failed: 0 };
let batchErrors = 0;
let suspiciousZeros = 0; // batches that did literally nothing — likely a silent block, not "no captions"
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  console.log(`▶ Batch ${i + 1}/${batches.length} (${batch.length} courses): ${batch.join(', ')}`);
  try {
    const job = await runBatch(batch);
    const t = job.totals || {};
    totals.published += t.published || 0;
    totals.skipped += t.skipped || 0;
    totals.translated += t.translated || 0;
    totals.failed += t.failed || 0;
    if (job.status === 'error') {
      batchErrors++;
      console.log(`  ✗ batch ${i + 1} failed after retry: ${job.error}`);
    } else if (!(t.published || t.skipped || t.translated)) {
      // 0/0/0 across every course in the batch is suspicious — Udemy silently
      // returning nothing (rate limit / soft block) looks identical to "no
      // captions exist". Print the job's own log so it's diagnosable.
      suspiciousZeros++;
      console.log(`  ⚠️  published 0 · skipped 0 · translated 0 — possible rate limit, not necessarily "no captions". Job log:`);
      (job.log || []).slice(-10).forEach((l) => console.log(`      ${l}`));
    } else {
      console.log(`  ✓ published ${t.published || 0} · skipped ${t.skipped || 0} · translated ${t.translated || 0}${t.failed ? ` · failed ${t.failed}` : ''}`);
    }
  } catch (e) {
    batchErrors++;
    console.log(`  ✗ batch ${i + 1} errored: ${e.message}`);
  }
  // Cool-down between batches — sustained back-to-back headed-browser traffic
  // with no pauses looks like what triggered Udemy to start returning empty
  // caption lookups partway through the first unthrottled run of this script.
  if (i < batches.length - 1) await sleep(15000);
}

console.log(`\n=== Done ===`);
console.log(`Batches: ${batches.length} (${batchErrors} failed even after retry, ${suspiciousZeros} suspicious all-zero)`);
console.log(`Totals — published: ${totals.published} · skipped: ${totals.skipped} · translated: ${totals.translated} · failed: ${totals.failed}`);
if (suspiciousZeros) console.log(`\n⚠️  ${suspiciousZeros} batch(es) did nothing at all — re-run the script again to retry just those (idempotent; already-done courses are skipped instantly).`);
