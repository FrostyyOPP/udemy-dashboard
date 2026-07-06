// Pulls per-course Coursera metrics (enrollments, completions, completion rate,
// star rating) from the partner analytics Looker dashboard. The dashboard's tile
// queries return their results as JSON via /querymanager/queries — we capture that
// and extract the "course_comparison" table (136 courses). Session + headed browser.
// Writes coursera-metrics-cache.json. Run: npm run coursera:metrics
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'coursera-auth.json');
const CACHE_FILE = join(__dirname, 'coursera-metrics-cache.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) { console.error('❌ Coursera not connected.'); process.exit(1); }

// Split concatenated JSON objects (brace counting, string-aware).
function splitJson(text) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
const P = 'eds_partner_dashboard_overview_course_comparison.';
const val = (row, key) => { const c = row[P + key]; return c && typeof c === 'object' ? c.value : c; };

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
const ctx = await browser.newContext({ storageState: AUTH_FILE, userAgent: UA });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

const bodies = [];
page.on('response', async (res) => {
  if (!/querymanager\/queries/.test(res.url())) return;
  try { const t = await res.text(); if (t.length > 200) bodies.push(t); } catch {}
});

console.log('Opening the partner analytics dashboard…');
await page.goto('https://www.coursera.org/admin/starweaver/analytics/monitor', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await sleep(8000);
// Scroll the Looker frame to trigger lazy-loaded tiles (the course table sits low).
for (const f of page.frames()) {
  if (!/looker/.test(f.url())) continue;
  for (let i = 0; i < 6; i++) { await f.evaluate(() => window.scrollBy(0, 1200)).catch(() => {}); await sleep(1500); }
}
await sleep(4000);
await browser.close();

if (!bodies.length) { console.error('❌ No dashboard data captured. Re-connect Coursera and retry.'); process.exit(1); }

// Find the full per-course table: a query whose rows have enrollments + rating + launch date.
const captured = bodies.join('\n');
let best = null;
for (const chunk of splitJson(captured)) {
  let o; try { o = JSON.parse(chunk); } catch { continue; }
  const rows = o?.data?.data;
  if (!Array.isArray(rows) || !rows.length) continue;
  const cols = Object.keys(rows[0]);
  if (cols.includes(P + 'enrollments_count') && cols.includes(P + 'avg_star_rating') && cols.includes(P + 'course_launch_date_date')) {
    if (!best || rows.length > best.length) best = rows;
  }
}
if (!best) { console.error('❌ Could not find the per-course table in the dashboard data.'); process.exit(1); }

const courses = best.map((r) => ({
  name: val(r, 'course_name'),
  domain: val(r, 'course_primary_domain'),
  inSpecialization: val(r, 'is_course_in_specialization') === 'Yes',
  launchDate: val(r, 'course_launch_date_date'),
  enrollments: val(r, 'enrollments_count'),
  paidEnrollments: val(r, 'paid_enrollments_count'),
  completions: val(r, 'completions_count'),
  completionRate: val(r, 'paid_completition_rate') ?? val(r, 'completition_rate'),
  rating: val(r, 'avg_star_rating'),
})).filter((c) => c.name);

writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), source: 'Institution Overview (Looker) course_comparison', courses }, null, 2));
const totalEnroll = courses.reduce((s, c) => s + (c.enrollments || 0), 0);
console.log(`✅ ${courses.length} courses with metrics · ${totalEnroll.toLocaleString()} total enrollments → coursera-metrics-cache.json`);
