// One-time seed: import the currently-good JSON cache files into dashboard.db
// before scrapers switch over to writing the DB directly. Safe to re-run —
// each importer goes through the same guarded/merge writers the scrapers use,
// so it won't clobber anything already in the DB with worse data.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  writeEnrollment, writeRevenue, writeCaptions, writeCoupons, writeTranscripts,
  writeCourseraCourses, writeCourseraMetrics, writeCourseraOverview,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => {
  const p = join(__dirname, f);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

function report(label, result) {
  if (!result) { console.log(`  ⏭  ${label} — no cache file found`); return; }
  console.log(`  ${result.ok ? '✅' : '⚠️ '} ${label} — ${result.written} row(s)${result.guarded ? ' (GUARDED — refused, see scrape_runs)' : ''}`);
}

console.log('Seeding dashboard.db from existing cache JSON…\n');

const enrollment = read('enrollment-cache.json');
report('enrollment', enrollment && writeEnrollment(enrollment.counts || {}));

const revenue = read('revenue-cache.json');
report('revenue', revenue && writeRevenue({
  total: revenue.total, currency: revenue.currency, monthly: revenue.monthly || [], perCourse: revenue.perCourse || {},
}));

const captions = read('caption-cache.json');
report('captions', captions && writeCaptions(captions.perCourse || {}));

const coupons = read('coupon-cache.json');
report('coupons', coupons && writeCoupons(coupons.perCourse || {}));

const transcripts = read('transcript-cache.json');
report('transcripts', transcripts && writeTranscripts(transcripts.transcripts || {}));

const courseraCourses = read('coursera-courses-cache.json');
report('coursera courses', courseraCourses && writeCourseraCourses(courseraCourses.courses || []));

const courseraMetrics = read('coursera-metrics-cache.json');
report('coursera metrics', courseraMetrics && writeCourseraMetrics(courseraMetrics.courses || []));

const courseraOverview = read('coursera-overview-cache.json');
report('coursera overview', courseraOverview && writeCourseraOverview(courseraOverview.kpis || {}));

console.log('\nDone. Inspect with: node -e "import(\'./db.js\').then(m => console.log(m.recentScrapeRuns()))"');
