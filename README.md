# Udemy Instructor Dashboard (MERN)

A dashboard that reads your Udemy courses, ratings, reviews, and Q&A from the
official **Udemy Instructor API**.

> **Note on coupons:** Udemy's official API has **no coupon endpoints** — you
> cannot list or create coupons through it (the Affiliate API was discontinued
> Jan 2025). Coupons can only be managed in the Udemy web UI. This dashboard
> covers the analytics the API *does* expose. Coupon automation would require a
> separate browser-automation module.

## Setup

### 1. Credentials
A **single API key** is all you need — it's sent as a **Bearer token**. Put it in
`server/.env`:

```
UDEMY_API_KEY=...
```

### 2. Backend
```bash
cd server
npm install
npm run test:auth   # verifies your credentials work
npm run dev         # starts API on http://localhost:5055
```

### 3. Frontend
```bash
cd client
npm install
npm run dev         # opens http://localhost:5173
```

## How it works
- `server/` — Express proxy. Adds Basic auth and forwards to Udemy so your
  secret never reaches the browser.
  - `GET /api/health` — is the key present?
  - `GET /api/courses` — your taught courses (id, title, rating, num_reviews, is_published)
  - `GET /api/reviews?course=<id>` — reviews (rating + content)
  - `GET /api/questions?course=<id>` — Q&A
  - `GET /api/udemy/*` — generic passthrough to any instructor endpoint

### Confirmed live API facts
- Base: `https://www.udemy.com/instructor-api/v1`, auth `Authorization: Bearer <key>`.
- Courses: `/taught-courses/courses/` — use `fields[course]=@all` to get `rating`,
  `num_reviews`, `headline`, `is_published`. **Student count is NOT exposed.**
- Reviews: `/taught-courses/reviews/?course=<id>` · Questions: `/taught-courses/questions/?course=<id>`
- **No coupon/promotion/discount endpoints exist** (all 404).
- `client/` — React (Vite) UI. Proxies `/api` to the backend.

## Deploy to Render
Single web service serves the API + built frontend, gated by HTTP basic auth.

1. Push this repo to GitHub (already done).
2. Render → **New + → Blueprint** → connect `FrostyyOPP/udemy-dashboard`
   (authorize Render to read the private repo). It reads `render.yaml`.
3. Set the secret env vars in the dashboard:
   - `UDEMY_API_KEY` — your Udemy key
   - `DASHBOARD_PASSWORD` — the password you'll use to log in
   - (`DASHBOARD_USER` defaults to `admin`)
4. Deploy → you get `https://udemy-dashboard.onrender.com`. Browser prompts for
   user/password on first load.

Notes:
- Free tier sleeps after inactivity (~30–60s cold start on next visit).
- The enrollment cache is committed, so data shows immediately. To refresh it,
  re-run the scraper locally and commit `server/enrollment-cache.json`.

## Enrollment (student counts)
The Udemy API does **not** expose enrollment, so it's scraped from public course
pages with Playwright and cached in `server/enrollment-cache.json`.

```bash
cd server
npx playwright install chromium   # one-time
npm run scrape:enrollment         # ~15 min for 168 courses; re-run to fill misses
```

- Cloudflare rate-limits rapid same-session requests, so the scraper uses a
  **fresh browser context per course** + a 2–4s delay. This gets ~100% coverage
  but is intentionally slow.
- Results are cached; re-running **skips courses already scraped** (use
  `--force` to re-scrape everything and refresh the numbers).
- The dashboard merges the cache into `/api/courses` automatically — just hit
  **Refresh** after a scrape completes.

## Roadmap ideas
- Reviews & Q&A drill-down per course
- Enrollment / revenue trends (add MongoDB to snapshot daily numbers — the "N" in MERN)
- CSV export of coupon codes to paste into Udemy (since the API can't create them)
