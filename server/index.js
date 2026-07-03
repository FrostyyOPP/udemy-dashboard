import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { udemyGet } from './udemyClient.js';

const app = express();
const PORT = process.env.PORT || 5055;
const __dirname = dirname(fileURLToPath(import.meta.url));
// CACHE_FILE can point at a Render persistent disk; defaults to the repo copy.
const CACHE_FILE = process.env.CACHE_FILE || join(__dirname, 'enrollment-cache.json');
const REVENUE_FILE = process.env.REVENUE_FILE || join(__dirname, 'revenue-cache.json');
const AUTH_FILE = join(__dirname, 'udemy-auth.json');

// Convert a Cookie-Editor JSON export into a Playwright session (storageState).
const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
function cookiesToState(list) {
  const cookies = (Array.isArray(list) ? list : list?.cookies || [])
    .filter((c) => c && c.name && c.domain)
    .map((c) => ({
      name: c.name,
      value: String(c.value ?? ''),
      domain: c.domain,
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: sameSiteMap[String(c.sameSite || '').toLowerCase()] || 'Lax',
      expires: c.expirationDate ?? c.expires ? Math.floor(Number(c.expirationDate ?? c.expires)) : -1,
    }));
  return { cookies, origins: [] };
}

// Read scraped enrollment counts (fresh each call so a re-scrape shows up).
function enrollmentCache() {
  if (!existsSync(CACHE_FILE)) return { counts: {}, scrapedAt: null };
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return { counts: {}, scrapedAt: null };
  }
}

// Read scraped revenue (per-course + total). Absent on the public deploy.
function revenueCache() {
  if (!existsSync(REVENUE_FILE)) return { perCourse: {}, total: null, currency: 'USD' };
  try {
    return JSON.parse(readFileSync(REVENUE_FILE, 'utf8'));
  } catch {
    return { perCourse: {}, total: null, currency: 'USD' };
  }
}

// Read scraped caption languages: { perCourse: { <courseId>: ["en","es",...] } }.
const CAPTIONS_FILE = process.env.CAPTIONS_FILE || join(__dirname, 'caption-cache.json');
function captionsCache() {
  if (!existsSync(CAPTIONS_FILE)) return { perCourse: {} };
  try {
    return JSON.parse(readFileSync(CAPTIONS_FILE, 'utf8'));
  } catch {
    return { perCourse: {} };
  }
}

// Read scraped active coupons: { perCourse: { <courseId>: [{code,...}] } }.
const COUPONS_FILE = process.env.COUPONS_FILE || join(__dirname, 'coupon-cache.json');
function couponsCache() {
  if (!existsSync(COUPONS_FILE)) return { perCourse: {} };
  try {
    return JSON.parse(readFileSync(COUPONS_FILE, 'utf8'));
  } catch {
    return { perCourse: {} };
  }
}

app.use(cors());
app.use(express.json());

// --- Access control ------------------------------------------------------
// Gate everything behind HTTP basic auth when DASHBOARD_PASSWORD is set.
// (Unset in local dev = open; set on Render = private.)
const AUTH_USER = process.env.DASHBOARD_USER || 'admin';
const AUTH_PASS = process.env.DASHBOARD_PASSWORD;
app.use((req, res, next) => {
  if (!AUTH_PASS) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
    if (u === AUTH_USER && p === AUTH_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Udemy Dashboard"');
  return res.status(401).send('Authentication required');
});

// Wrap async route handlers so thrown errors hit the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Health / auth check -------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.UDEMY_API_KEY) });
});

// --- Udemy account connection (session) ----------------------------------
// Connection status: is a session saved, and which scraped datasets exist?
app.get('/api/connection', (req, res) => {
  res.json({
    connected: existsSync(AUTH_FILE),
    data: {
      enrollment: existsSync(CACHE_FILE),
      revenue: existsSync(REVENUE_FILE),
      captions: existsSync(join(__dirname, 'caption-cache.json')),
    },
  });
});

// Connect by submitting a Cookie-Editor export of udemy.com cookies.
app.post('/api/connect', (req, res) => {
  const state = cookiesToState(req.body?.cookies ?? req.body);
  const names = state.cookies.map((c) => c.name);
  // Sanity: must look like a logged-in Udemy session.
  const isUdemy = state.cookies.some((c) => /udemy\.com$/.test(c.domain));
  const loggedIn = names.includes('dj_session_id') || names.includes('ud_cache_logged_in');
  if (!state.cookies.length || !isUdemy || !loggedIn) {
    return res.status(400).json({
      error: 'That does not look like a logged-in udemy.com cookie export. Export from udemy.com while signed in.',
      cookieCount: state.cookies.length,
    });
  }
  writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
  res.json({ connected: true, cookieCount: state.cookies.length });
});

// Disconnect: remove the saved session.
app.post('/api/disconnect', (req, res) => {
  try { if (existsSync(AUTH_FILE)) unlinkSync(AUTH_FILE); } catch {}
  res.json({ connected: false });
});

// --- Typed routes for the common instructor resources --------------------

const COURSE_FIELDS =
  '@default,rating,num_reviews,headline,is_published,created,published_time,visible_instructors';

// List your taught courses. By default fetches ALL pages (168 is small);
// pass ?page=N for a single page.
app.get('/api/courses', wrap(async (req, res) => {
  const { counts, scrapedAt } = enrollmentCache();
  const { perCourse, total: totalRevenue, currency } = revenueCache();
  const { perCourse: captions } = captionsCache();
  const { perCourse: coupons } = couponsCache();
  const enrich = (c) => ({
    ...c,
    num_subscribers: counts[c.id] ?? null,
    revenue: perCourse[c.id] ?? null,
    caption_locales: captions[c.id] ?? null,
    coupons: coupons[c.id] ?? null,
  });

  if (req.query.page) {
    const data = await udemyGet('/taught-courses/courses/', {
      page: req.query.page,
      page_size: req.query.page_size || 100,
      'fields[course]': COURSE_FIELDS,
    });
    data.results = (data.results || []).map(enrich);
    data.enrollment_scraped_at = scrapedAt;
    data.total_revenue = totalRevenue;
    data.currency = currency;
    return res.json(data);
  }

  // Walk every page and return the combined list.
  const results = [];
  let page = 1;
  while (true) {
    const data = await udemyGet('/taught-courses/courses/', {
      page,
      page_size: 100,
      'fields[course]': COURSE_FIELDS,
    });
    results.push(...(data.results || []));
    if (!data.next) break;
    page += 1;
    if (page > 50) break; // safety stop
  }
  res.json({
    count: results.length,
    results: results.map(enrich),
    enrollment_scraped_at: scrapedAt,
    total_revenue: totalRevenue,
    currency,
  });
}));

// Reviews — filtered to a course via ?course=<id>, or all if omitted.
app.get('/api/reviews', wrap(async (req, res) => {
  const data = await udemyGet('/taught-courses/reviews/', {
    course: req.query.course,
    page: req.query.page || 1,
    page_size: req.query.page_size || 20,
  });
  res.json(data);
}));

// Q&A questions — filtered to a course via ?course=<id>, or all if omitted.
app.get('/api/questions', wrap(async (req, res) => {
  const data = await udemyGet('/taught-courses/questions/', {
    course: req.query.course,
    page: req.query.page || 1,
    page_size: req.query.page_size || 20,
  });
  res.json(data);
}));

// --- Generic passthrough -------------------------------------------------
// Hit ANY instructor endpoint without writing new code, e.g.:
//   /api/udemy/taught-courses/courses/?page=1
app.get('/api/udemy/*', wrap(async (req, res) => {
  const path = '/' + req.params[0];
  const data = await udemyGet(path, req.query);
  res.json(data);
}));

// --- Serve the built frontend (production) -------------------------------
// In prod the React build is served from the same origin, so the client's
// relative /api calls work with no proxy.
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// --- Error handler -------------------------------------------------------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message, status, body: err.body });
});

app.listen(PORT, () => {
  console.log(`Udemy dashboard API running on http://localhost:${PORT}`);
});
