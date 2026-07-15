# Distribution Dashboard — Full Integration Reference

This document is a complete, A-to-Z walkthrough of the "Distribution Dashboard" project at
`~/udemy-dashboard`, written so it can be handed to another platform (**Boostr**) for
integration. It covers what the system does, how it's built, where every piece of data comes
from, and exactly how to talk to it over HTTP.

---

## 1. What this is

A self-hosted dashboard that unifies an instructor/publisher's presence across **four
distribution platforms** — Udemy, Coursera, FutureLearn, and Go1 — into one place: course
lists, enrollments, revenue, ratings, captions, and coupons, all in one UI and one API.

None of these platforms expose a proper "partner analytics API" for everything we need, so the
system is a mix of:
- **Official APIs** where they exist (Udemy has one).
- **Authenticated browser scraping** where they don't (Coursera, FutureLearn, Go1, and most of
  Udemy's own richer data like revenue/coupons/captions) — a headed/headless Playwright browser
  reuses the instructor's own logged-in session (via exported cookies) to read pages a real
  human would see, then the dashboard caches the result.

Everything the scrapers produce lands in one local **SQLite database**, which the backend API
serves to the React frontend.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js (ESM) + Express |
| Frontend | React 18 + Vite (plain CSS, no UI framework) |
| Database | SQLite via `better-sqlite3` (single file, WAL mode) |
| Scraping | Playwright (Chromium) |
| AI (optional) | `@anthropic-ai/sdk` — installed for an optional paid caption-translation engine; not required for anything else |
| Hosting | Self-hosted on the owner's Mac via macOS `launchd` agents + an `ngrok` static-domain tunnel (a Render blueprint also exists as an alternative, see §9) |

---

## 3. Folder structure (A to Z)

```
udemy-dashboard/
├── .env.example              # template for server/.env (see §8)
├── .gitignore                # excludes all credentials, session files, the DB, node_modules
├── COMPONENTS.md             # UI component/design-token inventory (old v1 UI)
├── LICENSE                   # MIT
├── README.md                 # general-purpose project readme (public, open-sourced)
├── ROADMAP.md                # living doc of capabilities + what's next
├── SETUP.md                  # setup instructions for a fresh clone
├── render.yaml               # optional Render.com deploy blueprint (alternative to self-host)
├── switch-to-ngrok.sh        # helper to rewrite the ngrok launchd agent to a new static domain
├── package.json              # root: just a `build` script that builds client+server
│
├── client/                   # React + Vite frontend
│   ├── dist/                 # built static output (gitignored; served by the backend in prod)
│   ├── package.json
│   └── src/
│       ├── main.jsx                 # entry point, mounts <AppV2/>
│       ├── App.jsx                  # OLD v1 UI (superseded by v2, kept for reference)
│       ├── CourseDetail.jsx         # per-course drawer: instructors/reviews/Q&A/coupons/captions
│       ├── CourseraPanel.jsx        # OLD v1 Coursera table (superseded by v2's inline CourseraView)
│       ├── ConnectUdemy.jsx         # "Connect Udemy" modal (cookie-paste flow)
│       ├── ConnectCoursera.jsx      # same, for Coursera
│       ├── ConnectFutureLearn.jsx   # same, for FutureLearn
│       ├── ConnectGo1.jsx           # same, for Go1
│       ├── CreateCoupons.jsx        # bulk coupon-creation panel (Udemy only)
│       ├── LocalizeCaptions.jsx     # bulk caption-localization panel (Udemy only)
│       ├── EarningsReport.jsx       # OLD v1 earnings view
│       ├── index.css                # OLD v1 stylesheet
│       └── v2/                      # CURRENT UI (this is what's live)
│           ├── AppV2.jsx            # the entire app: sidebar nav, platform switcher, all views
│           ├── data.js              # domain classification, CSV export, smart-search parser
│           ├── charts.jsx           # BarChart/Donut/Histogram/LineChart (hand-rolled SVG, no lib)
│           └── v2.css               # current design system
│
├── docs/                     # misc reference docs
│
└── server/                   # Express backend
    ├── .env                  # REAL secrets (gitignored) — copy of .env.example, filled in
    ├── .env.example          # documents required env vars
    ├── index.js              # the Express app — every HTTP route lives here (see §6)
    ├── db.js                 # SQLite schema + all read/write functions (see §5)
    ├── dashboard.db           # the SQLite file itself (gitignored, created on first run)
    ├── update-all.js         # orchestrates the daily scraper run (see §7)
    │
    ├── udemyClient.js         # thin wrapper around Udemy's official Instructor API
    ├── captureAuth.js         # (legacy) headed-login capture for Udemy — abandoned, bot-blocked
    ├── importCookies.js       # converts a Cookie-Editor export into udemy-auth.json
    ├── testAuth.js            # sanity-checks the Udemy API key works
    │
    ├── scrapeEnrollment.js            # Udemy: public-page student counts
    ├── scrapeRevenue.js                # Udemy: session-based revenue (total/monthly/per-course)
    ├── scrapeCaptions.js               # Udemy: session-based caption-language list
    ├── scrapeCoupons.js                # Udemy: session-based active-coupon list
    ├── scrapeTranscripts.js            # Udemy: public-page caption-language list (bookmarklet alt.)
    ├── scrapeCaptionFiles.js           # Udemy: downloads English .vtt caption files per lecture
    ├── translateVtt.js                 # translates .vtt files to other languages (pluggable engine)
    ├── uploadCaptions.js               # uploads/publishes a caption file to a Udemy lecture
    ├── localizeCaptions.js             # orchestrates translate+upload as one dashboard-triggered job
    ├── couponCreate.js                  # live coupon-creation (POST to Udemy), user-triggered only
    ├── discover.js                      # (dev tool) captures Udemy's raw API responses for exploration
    │
    ├── scrapeCourseraCourses.js        # Coursera: course list
    ├── scrapeCourseraMetrics.js        # Coursera: per-course enrollments/completions/rating
    ├── scrapeCourseraOverview.js       # Coursera: org-level KPI tiles (launched courses, etc.)
    │
    ├── scrapeFutureLearnCourses.js     # FutureLearn: course list + status + wishlist
    ├── scrapeFutureLearnEnrollment.js  # FutureLearn: public-page enrollment counts
    ├── discoverFutureLearn.js          # (dev tool) captures FutureLearn's admin-panel network traffic
    │
    ├── discoverGo1.js                  # (dev tool) captures Go1's dashboard network traffic
    ├── browserWindow.js                # shared helper: minimizes the automation browser window
    ├── bookmarklet-source.js           # source for a browser bookmarklet (manual transcript capture)
    └── migrateJsonToDb.js              # one-time migration script (JSON cache files → SQLite)
```

---

## 4. The core design decision: guarded writes

**Original bug (fixed July 2026):** every scraper used to overwrite a whole JSON cache file per
run. If a session expired mid-scrape, the scraper still exited cleanly with **zero rows**, and
that empty result silently overwrote good data. This already happened once — 149 courses of
caption data and 137 courses of coupon data were wiped to nothing before anyone noticed.

**Fix:** all scraped data now lives in SQLite (`server/dashboard.db`), written through exactly
two safety-checked patterns in `server/db.js`:

- **`upsertMerge()`** — for data scrapers fetch incrementally and cache locally (enrollment,
  transcripts). Only ever upserts rows; never deletes. Safe by construction.
- **`guardedReplaceAll()`** — for data that's a full snapshot each run (captions, coupons,
  revenue, Coursera/FutureLearn/Go1 course lists). Before replacing the table, it compares the
  new row count to what's already there — if the new snapshot is **empty** or a **>50% drop**
  from the existing count, the write is **refused** and logged to a `scrape_runs` table instead
  of touching the table. A bad/partial scrape can no longer destroy good data.

Every scraper's exit code reflects this: a guarded refusal calls `process.exit(1)`, so
`update-all.js`'s daily-run summary accurately shows failures again (previously a "successful"
empty scrape reported `ok: true`).

---

## 5. Database schema (`server/db.js`)

SQLite file at `server/dashboard.db` (gitignored). One row per entity, `updated_at` timestamp on
every table for freshness tracking.

| Table | Key | Columns | Written by |
|---|---|---|---|
| `enrollment` | `course_id` | `count` | `scrapeEnrollment.js` (Udemy, merge) |
| `revenue_course` | `course_id` | `amount` | `scrapeRevenue.js` (Udemy, guarded) |
| `revenue_monthly` | `month` | `amount` | `scrapeRevenue.js` (Udemy, guarded) |
| `revenue_meta` | `key` | `value` (total, currency) | `scrapeRevenue.js` (Udemy, guarded) |
| `captions` | `course_id` | `languages` (JSON array) | `scrapeCaptions.js` (Udemy, guarded) |
| `coupons` | `(course_id, code)` | `is_free, discount_value, max_uses, used, start_time, end_time, active` | `scrapeCoupons.js` (Udemy, guarded) |
| `transcripts` | `course_id` | `languages` (JSON array) | `scrapeTranscripts.js` / bookmarklet (Udemy, merge) |
| `coursera_courses` | `id` | `name, slug` | `scrapeCourseraCourses.js` (guarded) |
| `coursera_metrics` | `course_name` | `domain, in_specialization, launch_date, enrollments, paid_enrollments, completions, completion_rate, rating` | `scrapeCourseraMetrics.js` (guarded) |
| `coursera_overview_kpis` | `label` | `value` | `scrapeCourseraOverview.js` (guarded) |
| `futurelearn_courses` | `slug` | `title, code, category, status, start_date, wishlist_count, enrollment` | `scrapeFutureLearnCourses.js` (guarded) + `scrapeFutureLearnEnrollment.js` (merge, enrollment column only) |
| `go1_courses` | `name` | `enrolments, completions, total_minutes, avg_session_minutes, month` | **not yet populated** — see §7.4 |
| `scrape_runs` | auto id | `job, started_at, finished_at, ok, guarded, row_count, error` | every writer above, as an audit log |

Base Udemy course data (title, rating, review count, published status, etc.) is **not** cached
in SQLite — it's fetched live from the Udemy API on every `/api/courses` request and then
"enriched" in-memory with whatever's in the `enrollment`/`revenue_course`/`captions`/`coupons`
tables, keyed by Udemy's numeric course id.

---

## 6. Full API reference (`server/index.js`)

All routes are relative to the backend origin (see §9 for what that origin actually is).
Every route (except `/api/health`) sits behind an optional HTTP Basic-Auth gate — see §8.

### Cross-platform
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, hasApiKey }` |
| GET | `/api/last-update` | `{ updatedAt, lastRun }` — newest data timestamp across all tables + the last `update-all.js` run summary |

### Udemy
| Method | Path | Returns |
|---|---|---|
| GET | `/api/connection` | `{ connected, data: { enrollment, revenue, captions } }` — session + data-availability status |
| POST | `/api/connect` | Body `{ cookies }` (Cookie-Editor export) → saves session |
| POST | `/api/disconnect` | Clears the saved session |
| GET | `/api/courses` | **The main endpoint.** All taught courses (paginated via `?page=`, or all pages if omitted), enriched with `num_subscribers`, `revenue`, `caption_locales`, `coupons` per course. Also returns `total_revenue`, `currency`, `enrollment_scraped_at` |
| GET | `/api/reviews?course=<id>` | Course reviews (proxies Udemy API) |
| GET | `/api/questions?course=<id>` | Course Q&A (proxies Udemy API) |
| GET | `/api/revenue/monthly` | `{ monthly: [{month, amount}], currency, scrapedAt }` |
| GET | `/api/captions/languages` | List of supported localization target languages |
| POST | `/api/captions/localize` | Body `{ slugs, locales, dryRun, limit }` → starts a background translate+upload job, returns `{ jobId }` |
| GET | `/api/captions/jobs/:id` | Poll job progress |
| POST` / GET | `/api/captions/refresh-cache` | Re-runs the caption scraper on demand |
| POST | `/api/coupons/create` | Body is a coupon-creation spec → live-writes coupons to Udemy (real money-adjacent action, dashboard-triggered only) |
| GET | `/api/transcripts/status` | `{ captured, withData, scrapedAt }` |
| POST/GET | `/api/transcripts` / `/api/transcripts/save` | Manual transcript-language capture receiver (bookmarklet) |
| GET | `/api/udemy/*` | Generic passthrough to any Udemy Instructor API path, e.g. `/api/udemy/taught-courses/courses/?page=1` |

### Coursera
| Method | Path | Returns |
|---|---|---|
| GET | `/api/coursera/connection` | `{ connected }` |
| POST | `/api/coursera/connect` | Body `{ cookies }` → saves session (validates a `CAUTH` cookie is present) |
| POST | `/api/coursera/disconnect` | Clears session |
| GET | `/api/coursera/courses` | `{ courses: [{id, name, slug}], scrapedAt }` |
| GET | `/api/coursera/metrics` | `{ courses: [{name, domain, enrollments, completions, completionRate, rating, ...}], scrapedAt }` |
| GET | `/api/coursera/overview` | `{ kpis: {"Launched Courses": N, ...}, scrapedAt }` |

### FutureLearn
| Method | Path | Returns |
|---|---|---|
| GET | `/api/futurelearn/connection` | `{ connected }` |
| POST | `/api/futurelearn/connect` | Body `{ cookies }` → saves session (validates `futurelearn.com` cookie domain) |
| POST | `/api/futurelearn/disconnect` | Clears session |
| GET | `/api/futurelearn/courses` | `{ courses: [{slug, title, code, category, status, startDate, wishlistCount, enrollment}], scrapedAt }` |

### Go1
| Method | Path | Returns |
|---|---|---|
| GET | `/api/go1/connection` | `{ connected }` |
| POST | `/api/go1/connect` | Body `{ cookies }` → saves session (validates `go1.com`/`mygo1.com` cookie domain) |
| POST | `/api/go1/disconnect` | Clears session |
| GET | `/api/go1/courses` | `{ courses: [], month: null, scrapedAt: null }` — **route exists and works, but the underlying scraper hasn't been built yet** (see §7.4). Currently always returns empty. |

---

## 7. How each platform's data actually gets collected

### 7.1 Udemy — official API + session scraping (hybrid)

- **Auth (official API):** a single `UDEMY_API_KEY`, sent as `Authorization: Bearer <key>` to
  `https://www.udemy.com/instructor-api/v1/...`. This is the *only* platform with a real partner
  API, and it only covers taught-courses, reviews, Q&A — **no enrollment counts, no revenue, no
  coupons, no caption info**.
- **Auth (session scraping):** the instructor connects once via **Connect Udemy** in Settings —
  paste a Cookie-Editor JSON export of `udemy.com` cookies (must include `dj_session_id` or
  `ud_cache_logged_in`) → saved to `server/udemy-auth.json` (gitignored) as a Playwright
  `storageState`. All Udemy scrapers below reuse this file.
- **Key technical gotcha:** Udemy's `api-2.0` data endpoints are Cloudflare-protected and
  **block headless browsers even with a valid session** (`cf_clearance` is fingerprint-bound).
  The fix that works: a **headed** (`headless:false`) Chromium with
  `--disable-blink-features=AutomationControlled` + a `navigator.webdriver` override, minimized
  off-screen via CDP so it doesn't disrupt the user (`browserWindow.js`).
- **What's scraped and how:**
  - Enrollment (`scrapeEnrollment.js`) — public course pages, extracts "X students" text. No
    session needed. Fresh browser *context* per course (Cloudflare rate-limits same-session
    rapid requests).
  - Revenue (`scrapeRevenue.js`) — session-based, hits
    `/api-2.0/share-holders/v2.0/{id}/total/` (lifetime + monthly) and
    `/api-2.0/share-holders/v1.0/{id}/total/?aggregate=course` (per-course).
  - Captions (`scrapeCaptions.js`) — session-based,
    `/api-2.0/users/me/taught-courses/?fields[course]=caption_locales`.
  - Coupons (`scrapeCoupons.js`) — session-based, `/api-2.0/courses/{id}/coupons-v2/`.
  - Caption upload/publish (`uploadCaptions.js`, `localizeCaptions.js`) — a full write pipeline:
    download English `.vtt` → translate (Google Translate free endpoint, or Claude/LibreTranslate
    if configured) → upload via Fine Uploader S3 signature flow → publish via
    `/api-2.0/courses/{id}/assets/{assetId}/draft-captions/`. Idempotent (skips already-published
    locale/lecture combos).

### 7.2 Coursera — pure session scraping, no API

- **Auth:** Connect Coursera in Settings — cookie export must include `CAUTH` →
  `server/coursera-auth.json`.
- **Course list** (`scrapeCourseraCourses.js`) — the partner console
  (`coursera.org/admin/starweaver/home/courses`) captures course ids from network requests to
  `authoringCourseContexts.v1` and a GraphQL `AuthoringUserCoursePermissions` call, then resolves
  names via `onDemandCourses.v1`.
- **Per-course metrics** (`scrapeCourseraMetrics.js`) — Coursera's partner analytics page embeds
  a **Looker BI dashboard** (`university-looker.coursera.org`). The tile queries return their
  full result sets as JSON via `/api/internal/querymanager/queries` — one big response is
  actually several concatenated JSON objects (parsed via brace-counting in the scraper). The
  `course_comparison` query is the full per-course table (enrollments, completions, rating,
  launch date, domain).
- **Org overview KPIs** (`scrapeCourseraOverview.js`) — same Looker embed, reads the small KPI
  tiles ("Launched Courses", "Launched Specializations", etc.) via the iframe's rendered text.
- No revenue (Coursera pays partners at org level, not exposed per-course) and no lifetime
  aggregate distinct from what's in `coursera_metrics`.

### 7.3 FutureLearn — pure session scraping + one public-page trick

- **Auth:** Connect FutureLearn in Settings — cookie export from
  `futurelearn.com/admin/organisations/starweaver` (any `futurelearn.com` cookie accepted; no
  specific auth-cookie name is validated).
- **Course list** (`scrapeFutureLearnCourses.js`) — old-school server-rendered HTML admin panel
  at `/admin/organisations/starweaver/courses`. DOM structure:
  `li.m-course-list__item` (id = slug) → `h4.m-course-list__course-title` (title + `<span>(CODE)</span>`),
  `p.a-course-meta--subtle` (category + wishlist count), and a nested
  `table.m-table--manage-courses tbody tr.m-course-list__row` per **run** (a course can have
  multiple runs with different statuses — the scraper picks the run with the latest real start
  date). 199 courses scraped cleanly at last run.
- **Enrollment** (`scrapeFutureLearnEnrollment.js`) — **not in the admin panel at all.** Found on
  the **public** course page (`futurelearn.com/courses/<slug>`, no auth needed) as plain text:
  *"1,019 enrolled on this course"*. Same public-page-scrape pattern as Udemy's enrollment
  scraper. Merge-only write (never wipes existing counts). Draft/unpublished courses have no
  public page, so they'll never get a count (expected, not a bug).
- **Ratings/reviews:** **not available anywhere.** FutureLearn is a MOOC platform built around
  completion/certificates, not star ratings — confirmed by checking both the admin
  `stats-dashboard/totals` page (only has step-completion/comment-engagement numbers) and the
  public course page (no rating widget exists).
- **Known fragility:** `scrapeFutureLearnEnrollment.js` writes once at the very end of its run
  (no incremental checkpointing like the Udemy enrollment scraper has) — a kill mid-run loses all
  progress from that run. A full 199-course run can take 45+ minutes because Draft-status
  courses have no public page and burn the full 30s navigation timeout each. **TODO if revisited:**
  add periodic checkpoint saves, and skip Draft/Sandbox/Retired-status courses.

### 7.4 Go1 — connected, but course-level scraping is UNSOLVED

- **Auth:** Connect Go1 in Settings — cookie export from `mygo1.com` (any cookie from a
  `*.go1.com` domain accepted).
- **Important URL distinction:** Go1 has two very different surfaces under the same domain:
  - `https://starweaver.mygo1.com/p/#/app/dashboard` — the **personal learner dashboard**
    (courses *you* are enrolled in as a learner). Not useful for partner analytics.
  - `https://starweaver.mygo1.com/r/app/content-studio/insights` — the actual
    **content-partner analytics** page, with a "Learning Content" table (course name,
    enrolments, completions, total minutes, avg session duration — 73 items, paginated). This is
    the one that matters, and the DB table/API route are already built for it.
- **The blocker:** this insights page is a Next.js SPA whose data table loads asynchronously and
  **has proven extremely inconsistent to automate.** It rendered fully exactly **once** (proven
  via a saved screenshot with real data). Every attempt since — over 30 automated tries across
  two sessions, varying: headless vs. headed, minimized vs. visible window,
  `page.bringToFront()` + confirmed `visibilityState === 'visible'`, waiting on specific
  selectors vs. arbitrary timeouts, waiting on a "Showing X of Y" pagination signal, a 12x retry
  loop, and an 8x fresh-browser-context-per-attempt loop with a `Referer` header and
  cache-busting headers — has failed identically (a 71-character nav-only page, meaning the
  actual data widget never mounts). This doesn't correlate with any variable tested, which
  suggests either a feature-flag/bot-detection issue on Go1's side, or the account/session
  needing a different navigation path (e.g. a real in-page click rather than a direct URL load,
  which was tried once with a locator-timeout failure and not yet retried carefully).
- **What IS scrapeable from that one successful capture:** an Overview section with **Total
  Users**, **Minutes of Learning**, **Revenue** (explicitly "not yet available" for this
  account), and a **Likes/Dislikes** feedback summary — no 5-star ratings on this platform
  either. These simpler KPIs rendered reliably in the one success and are a smaller, likely more
  achievable target than the full per-course table.
- **Status:** `db.js` (`writeGo1Courses`/`readGo1Courses`), the `/api/go1/courses` route, and the
  `Go1View` client component all exist and work — they just have no scraper feeding them yet.
  The UI shows an honest "not available yet" empty state rather than fake data.

---

## 8. Environment variables (`server/.env`)

| Variable | Purpose | Required |
|---|---|---|
| `UDEMY_API_KEY` | Bearer token for Udemy's official Instructor API | Yes, for any `/api/udemy/*`, `/api/courses`, `/api/reviews`, `/api/questions` route |
| `PORT` | Port the Express server listens on | No (defaults to `5055`) |
| `DASHBOARD_USER` | HTTP Basic-Auth username | No (defaults to `admin`) |
| `DASHBOARD_PASSWORD` | HTTP Basic-Auth password | No — **if unset, the entire API is open with no auth** (fine for local dev, must be set for any public deployment) |
| `DASHBOARD_DB_FILE` | Override path to the SQLite file | No (defaults to `server/dashboard.db`) |

Session credentials for Coursera/FutureLearn/Go1/Udemy are **not** env vars — they're
Playwright `storageState` JSON files (`udemy-auth.json`, `coursera-auth.json`,
`futurelearn-auth.json`, `go1-auth.json`), all gitignored, created via each platform's
**Connect** flow in the dashboard's Settings page (paste a Cookie-Editor export; never a
password).

---

## 9. Deployment — how this is actually running right now

This is **not** deployed to Render (the `render.yaml` blueprint exists as an option but isn't
what's live). The live setup is **self-hosted on the owner's own Mac**, kept always-on via three
macOS `launchd` agents in `~/Library/LaunchAgents/`:

| Agent | Does |
|---|---|
| `com.starweaver.dashboard-backend` | `node server/index.js` with `PORT=5055`, `DASHBOARD_USER`/`DASHBOARD_PASSWORD` set — serves the built `client/dist` + the API on one origin. `KeepAlive`, restarts if it crashes. |
| `com.starweaver.dashboard-ngrok` | `ngrok http 5055 --url=<static-domain>` — a **stable, permanent HTTPS URL** (ngrok's free static-domain feature), so the public URL never changes across restarts. |
| `com.starweaver.dashboard-update` | Runs `npm run update` (→ `update-all.js`) daily at 7am — chains the revenue/coupons/captions/Coursera scrapers (enrollment and the newer FutureLearn scrapers are excluded from the daily chain, run manually). |

**For a new integration (Boostr) to reach this API:** it's the public ngrok URL +
`DASHBOARD_USER`/`DASHBOARD_PASSWORD` as HTTP Basic-Auth credentials. Ask the project owner for
the current URL and password rather than assuming — the ngrok domain is a static one but not
included in this document since it's a live credential.

**To pick up code changes on the live stack:**
```bash
cd client && npx vite build                                              # rebuild frontend
launchctl kickstart -k gui/$(id -u)/com.starweaver.dashboard-backend      # restart backend
```

---

## 10. Frontend structure (`client/src/v2/AppV2.jsx`)

Single-file-per-concern React app, no router library (a `view` state string + a `platform` state
string drive everything):

- **Sidebar nav:** Overview / Courses / Earnings / Captions / Coupons / Settings.
- **Platform switcher:** All Platforms / Udemy / Coursera / FutureLearn / Go1 — changes what the
  "Courses" (and other) views render. Only Udemy is integrated into the "All Platforms" aggregate
  Overview KPIs today; Coursera/FutureLearn/Go1 are separate dedicated tabs with their own views
  (`CourseraView`, `FutureLearnView`, `Go1View` — all in `AppV2.jsx`), not yet merged into the
  cross-platform totals.
- **Smart search** (Courses page): a client-side-only phrase parser
  (`parseSmartQuery()`/`applyFilter()` in `data.js`) — type things like `rating below 4.3` or
  `no coupons` and it filters instantly, no network call, no AI. (Originally scoped as an
  AI-powered natural-language parser via `@anthropic-ai/sdk`, but the project has no
  `ANTHROPIC_API_KEY` configured, so it was rebuilt as a deterministic keyword/operator parser
  covering rating, review count, student count, revenue, caption count, coupon count, published
  status, domain, and title — falls back to plain substring search for anything it doesn't
  recognize as a metric filter.)
- **`data.js`** also has the Domain-classification rules (keyword-matches a course title to one
  of ~12 subject categories for the "Domain" column/filter) and CSV export.
- **`charts.jsx`** — all charts are hand-rolled inline SVG components, no charting library.

---

## 11. Summary for Boostr integration

If Boostr just wants to **consume** this dashboard's data (read-only), the simplest path:

1. Get the current public URL + Basic-Auth credentials from the project owner.
2. Hit `GET /api/courses` for the full enriched Udemy course list (this is the richest, most
   reliable dataset — 173+ courses with enrollment, revenue, captions, coupons all merged in).
3. Hit `GET /api/coursera/metrics`, `GET /api/futurelearn/courses`, `GET /api/go1/courses` for
   the other three platforms (Go1 will return an empty array until §7.4 is resolved).
4. `GET /api/last-update` tells you how fresh all of this is.
5. If Boostr needs its *own* copy of the data rather than proxying live, the cleanest approach is
   probably to poll these endpoints on a schedule and store the response — there's no webhook/push
   mechanism, everything here is pull-based.

If instead Boostr wants to **host or replace** parts of this system, everything above (schema,
scrapers, auth patterns) is the full inventory needed to reimplement or migrate it.
