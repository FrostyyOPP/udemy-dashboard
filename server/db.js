// Local SQLite store for all scraped data (enrollment, revenue, captions,
// coupons, transcripts, Coursera courses/metrics/overview).
//
// Why this exists: every scraper used to `writeFileSync` a whole cache JSON
// file per run. If a run scraped 0 rows (expired session, Cloudflare block,
// etc.) but didn't throw, it still overwrote the file — silently wiping
// good data (this happened to caption-cache.json and coupon-cache.json).
//
// Fix: `guardedReplaceAll` is the ONE place that decides whether a fresh
// scrape is trustworthy enough to replace what's stored. A run that comes
// back empty (or drastically smaller than what's already there) is rejected
// — the existing rows are left untouched and the attempt is logged to
// `scrape_runs` as guarded, instead of silently succeeding.
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import DatabaseCtor from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DASHBOARD_DB_FILE || join(__dirname, 'dashboard.db');

const db = new DatabaseCtor(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS enrollment (
    course_id TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revenue_course (
    course_id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revenue_monthly (
    month TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revenue_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS captions (
    course_id TEXT PRIMARY KEY,
    languages TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupons (
    course_id TEXT NOT NULL,
    code TEXT NOT NULL,
    is_free INTEGER,
    discount_value REAL,
    max_uses INTEGER,
    used INTEGER,
    start_time TEXT,
    end_time TEXT,
    active INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, code)
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    course_id TEXT PRIMARY KEY,
    languages TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coursera_courses (
    id TEXT PRIMARY KEY,
    name TEXT,
    slug TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coursera_metrics (
    course_name TEXT PRIMARY KEY,
    domain TEXT,
    in_specialization INTEGER,
    launch_date TEXT,
    enrollments INTEGER,
    paid_enrollments INTEGER,
    completions INTEGER,
    completion_rate REAL,
    rating REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coursera_instructor_check (
    course_name TEXT PRIMARY KEY,
    has_starweaver_instructor INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coursera_overview_kpis (
    label TEXT PRIMARY KEY,
    value INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_monthly (
    month TEXT PRIMARY KEY,
    minutes_taught REAL,
    active_students INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_course (
    course_id TEXT PRIMARY KEY,
    minutes_taught REAL,
    active_students INTEGER,
    is_udemy_business INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_ub_monthly (
    month TEXT PRIMARY KEY,
    ub_minutes REAL,
    non_ub_minutes REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_course_monthly (
    course_id TEXT NOT NULL,
    month TEXT NOT NULL,
    minutes_taught REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, month)
  );

  CREATE TABLE IF NOT EXISTS futurelearn_courses (
    slug TEXT PRIMARY KEY,
    title TEXT,
    code TEXT,
    category TEXT,
    status TEXT,
    start_date TEXT,
    wishlist_count INTEGER,
    enrollment INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS go1_courses (
    name TEXT PRIMARY KEY,
    enrolments INTEGER,
    completions INTEGER,
    total_minutes INTEGER,
    avg_session_minutes INTEGER,
    month TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    guarded INTEGER NOT NULL DEFAULT 0,
    row_count INTEGER,
    error TEXT
  );
`);

function nowIso() {
  return new Date().toISOString();
}

function tableCount(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function recordRun({ job, startedAt, ok, guarded, rowCount, error }) {
  db.prepare(
    `INSERT INTO scrape_runs (job, started_at, finished_at, ok, guarded, row_count, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(job, startedAt, nowIso(), ok ? 1 : 0, guarded ? 1 : 0, rowCount ?? null, error ?? null);
}

// The core safety net. `rows` must be the COMPLETE fresh snapshot for `table`
// (not a partial page) — on success the whole table is replaced atomically.
// Refuses the replace (and logs a guarded scrape_run) when the new snapshot
// looks like a failed/partial run rather than a real drop in data:
//   - 0 rows while the table currently has data, or
//   - fewer than `minRatio` (default 50%) of the current row count.
function guardedReplaceAll(table, rows, insertFn, { job, minRatio = 0.5 } = {}) {
  const startedAt = nowIso();
  const before = tableCount(table);
  const shrunk = before > 0 && rows.length < before * minRatio;
  if (before > 0 && (rows.length === 0 || shrunk)) {
    recordRun({
      job, startedAt, ok: false, guarded: true, rowCount: rows.length,
      error: `refused: ${rows.length} new rows vs ${before} existing (guard: empty or >${Math.round((1 - minRatio) * 100)}% drop)`,
    });
    return { ok: false, guarded: true, written: 0 };
  }

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    for (const row of rows) insertFn(row);
  });
  tx();
  recordRun({ job, startedAt, ok: true, guarded: false, rowCount: rows.length });
  return { ok: true, guarded: false, written: rows.length };
}

// Merge-style write for datasets scrapers already fetch incrementally
// (enrollment, transcripts) — only ever adds/updates rows, never deletes.
function upsertMerge(table, rows, insertFn, { job } = {}) {
  const startedAt = nowIso();
  const tx = db.transaction(() => { for (const row of rows) insertFn(row); });
  tx();
  recordRun({ job, startedAt, ok: true, guarded: false, rowCount: rows.length });
  return { ok: true, guarded: false, written: rows.length };
}

// --- Enrollment (merge) ---------------------------------------------------
const upsertEnrollmentStmt = db.prepare(
  `INSERT INTO enrollment (course_id, count, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(course_id) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`
);
export function writeEnrollment(counts) {
  const rows = Object.entries(counts).map(([course_id, count]) => ({ course_id, count }));
  const ts = nowIso();
  return upsertMerge('enrollment', rows, (r) => upsertEnrollmentStmt.run(r.course_id, r.count, ts), { job: 'enrollment' });
}
export function readEnrollment() {
  const rows = db.prepare('SELECT course_id, count FROM enrollment').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM enrollment').get().t;
  const counts = {};
  for (const r of rows) counts[r.course_id] = r.count;
  return { counts, scrapedAt };
}

// --- Revenue (guarded snapshot) -------------------------------------------
const insertRevenueCourseStmt = db.prepare('INSERT INTO revenue_course (course_id, amount, updated_at) VALUES (?, ?, ?)');
const insertRevenueMonthlyStmt = db.prepare('INSERT INTO revenue_monthly (month, amount, updated_at) VALUES (?, ?, ?)');
const upsertRevenueMetaStmt = db.prepare(
  `INSERT INTO revenue_meta (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);
export function writeRevenue({ total, currency, monthly, perCourse }) {
  const startedAt = nowIso();
  const ts = nowIso();
  const courseRows = Object.entries(perCourse || {}).map(([course_id, amount]) => ({ course_id, amount }));
  const beforeCourse = tableCount('revenue_course');
  const shrunk = beforeCourse > 0 && courseRows.length < beforeCourse * 0.5;
  const badTotal = total == null;

  if ((beforeCourse > 0 && (courseRows.length === 0 || shrunk)) || badTotal) {
    recordRun({
      job: 'revenue', startedAt, ok: false, guarded: true, rowCount: courseRows.length,
      error: badTotal ? 'refused: total amount missing' : `refused: ${courseRows.length} new rows vs ${beforeCourse} existing`,
    });
    return { ok: false, guarded: true, written: 0 };
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM revenue_course').run();
    for (const r of courseRows) insertRevenueCourseStmt.run(r.course_id, r.amount, ts);
    db.prepare('DELETE FROM revenue_monthly').run();
    for (const m of monthly || []) insertRevenueMonthlyStmt.run(m.month, m.amount, ts);
    upsertRevenueMetaStmt.run('total', String(total), ts);
    upsertRevenueMetaStmt.run('currency', currency || 'USD', ts);
  });
  tx();
  recordRun({ job: 'revenue', startedAt, ok: true, guarded: false, rowCount: courseRows.length });
  return { ok: true, guarded: false, written: courseRows.length };
}
export function readRevenue() {
  const perCourse = {};
  for (const r of db.prepare('SELECT course_id, amount FROM revenue_course').all()) perCourse[r.course_id] = r.amount;
  const monthly = db.prepare('SELECT month, amount FROM revenue_monthly ORDER BY month').all();
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM revenue_meta').all().map((r) => [r.key, r.value]));
  const scrapedAt = db.prepare(
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(updated_at) AS t FROM revenue_course
       UNION ALL SELECT MAX(updated_at) FROM revenue_monthly
       UNION ALL SELECT MAX(updated_at) FROM revenue_meta
     )`
  ).get().t;
  return {
    perCourse,
    monthly,
    total: meta.total != null ? Number(meta.total) : null,
    currency: meta.currency || 'USD',
    scrapedAt,
  };
}

// --- Engagement: minutes watched + Udemy Business coverage (guarded) -----
const insertEngagementCourseStmt = db.prepare(
  `INSERT INTO engagement_course (course_id, minutes_taught, active_students, is_udemy_business, updated_at)
   VALUES (?, ?, ?, ?, ?)`
);
const insertEngagementMonthlyStmt = db.prepare('INSERT INTO engagement_monthly (month, minutes_taught, active_students, updated_at) VALUES (?, ?, ?, ?)');
const insertEngagementUbMonthlyStmt = db.prepare('INSERT INTO engagement_ub_monthly (month, ub_minutes, non_ub_minutes, updated_at) VALUES (?, ?, ?, ?)');
const insertEngagementCourseMonthlyStmt = db.prepare('INSERT INTO engagement_course_monthly (course_id, month, minutes_taught, updated_at) VALUES (?, ?, ?, ?)');
const upsertEngagementMetaStmt = db.prepare(
  `INSERT INTO engagement_meta (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);
export function writeEngagement({ totalMinutes, activeStudents, monthly, perCourse, ubMonthly, courseMonthly }) {
  const startedAt = nowIso();
  const ts = nowIso();
  const courseRows = Object.entries(perCourse || {});
  const beforeCourse = tableCount('engagement_course');
  const shrunk = beforeCourse > 0 && courseRows.length < beforeCourse * 0.5;
  const badTotal = totalMinutes == null;

  if ((beforeCourse > 0 && (courseRows.length === 0 || shrunk)) || badTotal) {
    recordRun({
      job: 'engagement', startedAt, ok: false, guarded: true, rowCount: courseRows.length,
      error: badTotal ? 'refused: total minutes missing' : `refused: ${courseRows.length} new rows vs ${beforeCourse} existing`,
    });
    return { ok: false, guarded: true, written: 0 };
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM engagement_course').run();
    for (const [courseId, c] of courseRows) insertEngagementCourseStmt.run(courseId, c.minutesTaught ?? null, c.activeStudents ?? null, c.isUdemyBusiness ? 1 : 0, ts);
    db.prepare('DELETE FROM engagement_monthly').run();
    for (const m of monthly || []) insertEngagementMonthlyStmt.run(m.month, m.minutesTaught, m.activeStudents, ts);
    db.prepare('DELETE FROM engagement_ub_monthly').run();
    for (const m of ubMonthly || []) insertEngagementUbMonthlyStmt.run(m.month, m.ubMinutes, m.nonUbMinutes, ts);
    db.prepare('DELETE FROM engagement_course_monthly').run();
    for (const r of courseMonthly || []) insertEngagementCourseMonthlyStmt.run(r.courseId, r.month, r.minutesTaught, ts);
    upsertEngagementMetaStmt.run('totalMinutes', String(totalMinutes), ts);
    upsertEngagementMetaStmt.run('activeStudents', String(activeStudents ?? ''), ts);
  });
  tx();
  recordRun({ job: 'engagement', startedAt, ok: true, guarded: false, rowCount: courseRows.length });
  return { ok: true, guarded: false, written: courseRows.length };
}
export function readEngagement() {
  const perCourse = {};
  for (const r of db.prepare('SELECT course_id, minutes_taught, active_students, is_udemy_business FROM engagement_course').all()) {
    perCourse[r.course_id] = { minutesTaught: r.minutes_taught, activeStudents: r.active_students, isUdemyBusiness: !!r.is_udemy_business };
  }
  const monthly = db.prepare('SELECT month, minutes_taught AS minutesTaught, active_students AS activeStudents FROM engagement_monthly ORDER BY month').all();
  const ubMonthly = db.prepare('SELECT month, ub_minutes AS ubMinutes, non_ub_minutes AS nonUbMinutes FROM engagement_ub_monthly ORDER BY month').all();

  // Attach each course's last 3 months of minutes (most recent first: this month, last month, 2 months ago)
  // so the client can render a "minutes consumed by month" report without its own date math.
  const courseMonthlyMap = {};
  for (const r of db.prepare('SELECT course_id, month, minutes_taught FROM engagement_course_monthly').all()) {
    (courseMonthlyMap[r.course_id] ||= {})[r.month] = r.minutes_taught;
  }
  const recentMonths = monthly.slice(-3).map((m) => m.month).reverse();
  for (const [courseId, c] of Object.entries(perCourse)) {
    c.recentMonths = recentMonths.map((month) => ({ month, minutes: courseMonthlyMap[courseId]?.[month] ?? null }));
  }

  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM engagement_meta').all().map((r) => [r.key, r.value]));
  const scrapedAt = db.prepare(
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(updated_at) AS t FROM engagement_course
       UNION ALL SELECT MAX(updated_at) FROM engagement_monthly
       UNION ALL SELECT MAX(updated_at) FROM engagement_ub_monthly
       UNION ALL SELECT MAX(updated_at) FROM engagement_course_monthly
       UNION ALL SELECT MAX(updated_at) FROM engagement_meta
     )`
  ).get().t;
  return {
    perCourse,
    monthly,
    ubMonthly,
    totalMinutes: meta.totalMinutes != null ? Number(meta.totalMinutes) : null,
    activeStudents: meta.activeStudents ? Number(meta.activeStudents) : null,
    scrapedAt,
  };
}

// --- Captions (guarded snapshot) ------------------------------------------
const insertCaptionsStmt = db.prepare('INSERT INTO captions (course_id, languages, updated_at) VALUES (?, ?, ?)');
export function writeCaptions(perCourse) {
  const ts = nowIso();
  const rows = Object.entries(perCourse || {}).map(([course_id, languages]) => ({ course_id, languages }));
  return guardedReplaceAll('captions', rows, (r) => insertCaptionsStmt.run(r.course_id, JSON.stringify(r.languages), ts), { job: 'captions' });
}
export function readCaptions() {
  const rows = db.prepare('SELECT course_id, languages FROM captions').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM captions').get().t;
  const perCourse = {};
  for (const r of rows) perCourse[r.course_id] = JSON.parse(r.languages);
  return { perCourse, scrapedAt };
}

// --- Coupons (guarded snapshot, flattened) --------------------------------
const insertCouponStmt = db.prepare(
  `INSERT INTO coupons (course_id, code, is_free, discount_value, max_uses, used, start_time, end_time, active, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
export function writeCoupons(perCourse) {
  const ts = nowIso();
  const rows = [];
  for (const [course_id, list] of Object.entries(perCourse || {})) {
    for (const c of list) rows.push({ course_id, ...c });
  }
  // Guard on distinct-course coverage (matches how the scraper reports progress),
  // not raw coupon-row count, since courses legitimately have 0-1 coupons each.
  const beforeCourses = db.prepare('SELECT COUNT(DISTINCT course_id) AS n FROM coupons').get().n;
  const afterCourses = new Set(Object.keys(perCourse || {})).size;
  const startedAt = ts;
  if (beforeCourses > 0 && (afterCourses === 0 || afterCourses < beforeCourses * 0.5)) {
    recordRun({
      job: 'coupons', startedAt, ok: false, guarded: true, rowCount: rows.length,
      error: `refused: ${afterCourses} courses covered vs ${beforeCourses} existing`,
    });
    return { ok: false, guarded: true, written: 0 };
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM coupons').run();
    for (const r of rows) {
      insertCouponStmt.run(
        r.course_id, r.code, r.is_free ? 1 : 0, r.discount_value ?? null, r.max_uses ?? null,
        r.used ?? null, r.start ?? null, r.end ?? null, r.active ? 1 : 0, ts
      );
    }
  });
  tx();
  recordRun({ job: 'coupons', startedAt, ok: true, guarded: false, rowCount: rows.length });
  return { ok: true, guarded: false, written: rows.length };
}
export function readCoupons() {
  const rows = db.prepare('SELECT * FROM coupons').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM coupons').get().t;
  const perCourse = {};
  for (const r of rows) {
    (perCourse[r.course_id] ||= []).push({
      code: r.code, is_free: !!r.is_free, discount_value: r.discount_value,
      max_uses: r.max_uses, used: r.used, start: r.start_time, end: r.end_time, active: !!r.active,
    });
  }
  return { perCourse, scrapedAt };
}

// --- Transcripts (merge) ---------------------------------------------------
const upsertTranscriptStmt = db.prepare(
  `INSERT INTO transcripts (course_id, languages, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(course_id) DO UPDATE SET languages = excluded.languages, updated_at = excluded.updated_at`
);
export function writeTranscripts(transcripts) {
  const ts = nowIso();
  const rows = Object.entries(transcripts).map(([course_id, languages]) => ({ course_id, languages }));
  return upsertMerge('transcripts', rows, (r) => upsertTranscriptStmt.run(r.course_id, JSON.stringify(r.languages), ts), { job: 'transcripts' });
}
export function setTranscript(courseId, languages) {
  upsertTranscriptStmt.run(courseId, JSON.stringify(languages), nowIso());
}
export function readTranscripts() {
  const rows = db.prepare('SELECT course_id, languages FROM transcripts').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM transcripts').get().t;
  const transcripts = {};
  for (const r of rows) transcripts[r.course_id] = JSON.parse(r.languages);
  return { transcripts, scrapedAt };
}

// --- Coursera courses (guarded snapshot) ----------------------------------
const insertCourseraCourseStmt = db.prepare('INSERT INTO coursera_courses (id, name, slug, updated_at) VALUES (?, ?, ?, ?)');
export function writeCourseraCourses(courses) {
  const ts = nowIso();
  return guardedReplaceAll(
    'coursera_courses', courses,
    (c) => insertCourseraCourseStmt.run(c.id, c.name, c.slug, ts),
    { job: 'coursera_courses' }
  );
}
export function readCourseraCourses() {
  const courses = db.prepare('SELECT id, name, slug FROM coursera_courses').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM coursera_courses').get().t;
  return { courses, scrapedAt };
}

// --- Coursera metrics (guarded snapshot) ----------------------------------
const insertCourseraMetricStmt = db.prepare(
  `INSERT INTO coursera_metrics
     (course_name, domain, in_specialization, launch_date, enrollments, paid_enrollments, completions, completion_rate, rating, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
export function writeCourseraMetrics(courses) {
  const ts = nowIso();
  return guardedReplaceAll(
    'coursera_metrics', courses,
    (c) => insertCourseraMetricStmt.run(
      c.name, c.domain ?? null, c.inSpecialization ? 1 : 0, c.launchDate ?? null,
      c.enrollments ?? null, c.paidEnrollments ?? null, c.completions ?? null,
      c.completionRate ?? null, c.rating ?? null, ts
    ),
    { job: 'coursera_metrics' }
  );
}
export function readCourseraMetrics() {
  const rows = db.prepare('SELECT * FROM coursera_metrics').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM coursera_metrics').get().t;
  const courses = rows.map((r) => ({
    name: r.course_name, domain: r.domain, inSpecialization: !!r.in_specialization, launchDate: r.launch_date,
    enrollments: r.enrollments, paidEnrollments: r.paid_enrollments, completions: r.completions,
    completionRate: r.completion_rate, rating: r.rating,
  }));
  return { courses, scrapedAt };
}

// --- Coursera instructor check (guarded snapshot) -------------------------
// Stores only the course names where instructors@starweaver.com is on staff
// with the "Instructor" role — absence of a row means "no" (or "unknown, not
// yet checked" if the table has never been populated).
const insertCourseraInstructorCheckStmt = db.prepare(
  'INSERT INTO coursera_instructor_check (course_name, has_starweaver_instructor, updated_at) VALUES (?, 1, ?)'
);
export function writeCourseraInstructorCheck(courseNames) {
  const ts = nowIso();
  return guardedReplaceAll(
    'coursera_instructor_check', courseNames,
    (name) => insertCourseraInstructorCheckStmt.run(name, ts),
    { job: 'coursera_instructor_check' }
  );
}
export function readCourseraInstructorCheck() {
  const rows = db.prepare('SELECT course_name FROM coursera_instructor_check').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM coursera_instructor_check').get().t;
  return { names: rows.map((r) => r.course_name), scrapedAt };
}

// --- Coursera overview KPIs (guarded snapshot) ----------------------------
const insertCourseraKpiStmt = db.prepare('INSERT INTO coursera_overview_kpis (label, value, updated_at) VALUES (?, ?, ?)');
export function writeCourseraOverview(kpis) {
  const ts = nowIso();
  const rows = Object.entries(kpis || {}).map(([label, value]) => ({ label, value }));
  return guardedReplaceAll(
    'coursera_overview_kpis', rows,
    (r) => insertCourseraKpiStmt.run(r.label, r.value, ts),
    { job: 'coursera_overview' }
  );
}
export function readCourseraOverview() {
  const rows = db.prepare('SELECT label, value FROM coursera_overview_kpis').all();
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM coursera_overview_kpis').get().t;
  const kpis = {};
  for (const r of rows) kpis[r.label] = r.value;
  return { kpis, scrapedAt };
}

// --- FutureLearn courses (guarded snapshot, + a merge-style enrollment update) ---
const insertFutureLearnCourseStmt = db.prepare(
  `INSERT INTO futurelearn_courses (slug, title, code, category, status, start_date, wishlist_count, enrollment, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
export function writeFutureLearnCourses(courses) {
  const ts = nowIso();
  // Preserve enrollment numbers already on file (a separate scraper fills those in)
  // when the course-list snapshot replaces the table.
  const existingEnrollment = Object.fromEntries(
    db.prepare('SELECT slug, enrollment FROM futurelearn_courses').all().map((r) => [r.slug, r.enrollment])
  );
  return guardedReplaceAll(
    'futurelearn_courses', courses,
    (c) => insertFutureLearnCourseStmt.run(
      c.slug, c.title, c.code ?? null, c.category ?? null, c.status ?? null,
      c.startDate ?? null, c.wishlistCount ?? null, existingEnrollment[c.slug] ?? null, ts
    ),
    { job: 'futurelearn_courses' }
  );
}
const updateFutureLearnEnrollmentStmt = db.prepare(
  `INSERT INTO futurelearn_courses (slug, enrollment, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(slug) DO UPDATE SET enrollment = excluded.enrollment, updated_at = excluded.updated_at`
);
export function writeFutureLearnEnrollment(perSlug) {
  const ts = nowIso();
  const rows = Object.entries(perSlug).map(([slug, enrollment]) => ({ slug, enrollment }));
  return upsertMerge(
    'futurelearn_courses', rows,
    (r) => updateFutureLearnEnrollmentStmt.run(r.slug, r.enrollment, ts),
    { job: 'futurelearn_enrollment' }
  );
}
export function readFutureLearnCourses() {
  const courses = db.prepare('SELECT * FROM futurelearn_courses').all().map((r) => ({
    slug: r.slug, title: r.title, code: r.code, category: r.category, status: r.status,
    startDate: r.start_date, wishlistCount: r.wishlist_count, enrollment: r.enrollment,
  }));
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM futurelearn_courses').get().t;
  return { courses, scrapedAt };
}

// --- Go1 courses (guarded monthly snapshot) -------------------------------
const insertGo1CourseStmt = db.prepare(
  `INSERT INTO go1_courses (name, enrolments, completions, total_minutes, avg_session_minutes, month, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
export function writeGo1Courses(courses, month) {
  const ts = nowIso();
  return guardedReplaceAll(
    'go1_courses', courses,
    (c) => insertGo1CourseStmt.run(c.name, c.enrolments ?? null, c.completions ?? null, c.totalMinutes ?? null, c.avgSessionMinutes ?? null, month, ts),
    { job: 'go1_courses' }
  );
}
export function readGo1Courses() {
  const courses = db.prepare('SELECT * FROM go1_courses').all().map((r) => ({
    name: r.name, enrolments: r.enrolments, completions: r.completions,
    totalMinutes: r.total_minutes, avgSessionMinutes: r.avg_session_minutes, month: r.month,
  }));
  const scrapedAt = db.prepare('SELECT MAX(updated_at) AS t FROM go1_courses').get().t;
  const month = courses[0]?.month ?? null;
  return { courses, month, scrapedAt };
}

// --- Cross-cutting: last-update / scrape history --------------------------
const ALL_TABLES = [
  'enrollment', 'revenue_course', 'revenue_monthly', 'revenue_meta', 'captions',
  'coupons', 'transcripts', 'coursera_courses', 'coursera_metrics', 'coursera_overview_kpis', 'coursera_instructor_check',
  'futurelearn_courses', 'go1_courses', 'engagement_course', 'engagement_monthly', 'engagement_meta', 'engagement_ub_monthly',
  'engagement_course_monthly',
];
export function latestUpdatedAt() {
  let newest = null;
  for (const t of ALL_TABLES) {
    const row = db.prepare(`SELECT MAX(updated_at) AS t FROM ${t}`).get();
    if (row.t && (!newest || new Date(row.t) > new Date(newest))) newest = row.t;
  }
  return newest;
}
export function recentScrapeRuns(limit = 20) {
  return db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC LIMIT ?').all(limit);
}

export { db };
