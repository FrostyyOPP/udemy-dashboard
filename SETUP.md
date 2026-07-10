# Setup & Operations Guide

How to stand this dashboard up on a fresh machine and run it the way the
original deployment runs it. Nothing here contains secrets — every credential is
supplied via environment variables or the in-app "Connect" flows.

---

## 1. Prerequisites

- **Node.js 20+** (the original ran on Node 24).
- **Playwright Chromium** — installed automatically by `npm install` in `server/`;
  if a browser launch ever fails, run `npx playwright install chromium`.
- A **Udemy instructor account** and (optionally) a **Coursera partner account**.
- A **Udemy Instructor API key** (from Udemy → *Instructor → API clients*) for the
  read-only Instructor API.

## 2. Install

```bash
cd server && npm install
cd ../client && npm install && npm run build   # builds client/dist, served by the backend in prod
```

## 3. Environment variables (`server/.env`)

| Var | Required | Purpose |
|---|---|---|
| `UDEMY_API_KEY` | yes | Bearer token for the read-only Instructor API |
| `PORT` | no (default 5055) | Backend port |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | recommended | HTTP basic-auth gate. **If `DASHBOARD_PASSWORD` is unset the dashboard is open** — set it for any non-local deploy. |
| `CAP_TRANSLATE_CONCURRENCY` | no (8) | Parallel caption-translation batches |
| `CAP_UPLOAD_CONCURRENCY` | no (5) | Parallel caption uploads |
| `UDEMY_AWS_KEY` | no | Udemy's public S3 bucket-uploader key; the built-in default already works |
| `ANTHROPIC_API_KEY` | no | Only if you enable the AI transcript/translation paths |

The `*_FILE` / `*_CACHE` vars let you relocate the JSON caches (e.g. onto a
persistent disk); defaults live next to the code.

## 4. Connect your accounts (no passwords stored)

Auth is **cookie-based**, imported once through the UI — the dashboard never sees
your Udemy/Coursera password.

1. Start the backend: `cd server && node index.js`
2. Open the dashboard → **Settings**.
3. **Connect Udemy**: export your Udemy cookies with the *Cookie-Editor* browser
   extension (JSON export) and paste them in. This writes `server/udemy-auth.json`
   (a Playwright storage-state file — **gitignored, never commit it**).
4. **Connect Coursera**: same flow → `server/coursera-auth.json`.

Sessions expire periodically; when a scrape starts failing, re-run the Connect
flow to refresh cookies.

## 5. Populate the data caches

The API only exposes courses/ratings/reviews/Q&A. Everything else is scraped with
your session (a headed Chrome window opens briefly — see
[docs/UDEMY-INTERNAL-API.md](docs/UDEMY-INTERNAL-API.md) for *why* it must be headed).

```bash
cd server
node update-all.js          # revenue + coupons + captions + Coursera metrics/overview
node scrapeEnrollment.js    # slow (~15 min, public pages) — run occasionally
```

`update-all.js` is resilient: one failing step doesn't stop the rest, and it
writes `last-update.json`. Individual scrapers can be run on their own.

## 6. Run it

- **Dev**: `cd server && node --watch index.js` and `cd client && npm run dev`.
- **Prod (single origin)**: build the client (step 2), then run the backend — it
  serves `client/dist` from the same origin, gated by basic auth.

### Keeping it always-on (macOS launchd)

The original deployment used three **launchd** agents (equivalent to systemd
services on Linux). Recreate them however your host prefers:

| Job | What it does |
|---|---|
| **backend** | `node server/index.js` with `PORT`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD` set |
| **tunnel** | `ngrok` (or Cloudflare Tunnel) pointing at the backend port, ideally a **static** domain so the URL is stable |
| **update** | runs `node server/update-all.js` on a daily schedule (original: 7am) to refresh caches |

For a Linux host, one systemd service per row (with a `systemd` timer for the
daily update) is the direct equivalent.

## 7. The redesigned UI

The dashboard defaults to the redesigned UI (`client/src/v2/`). Append
`?ui=old` to the URL to fall back to the classic app (the choice persists in
`localStorage`); `?ui=new` returns to the redesign.

---

## Operational safety notes (learned the hard way)

- **Scrapers are session-gated by Cloudflare.** They open a *visible* Chrome
  because headless is blocked far more aggressively. Windows now **auto-minimize**
  (`server/browserWindow.js`) so they don't steal focus.
- **Never overwrite a good cache with an empty scrape.** `scrapeCaptions.js`
  refuses to write when it reads 0 courses (a Cloudflare/session error state, not
  "you have no captions"). Mirror this guard if you add scrapers.
- **Caption/coupon/course writes are idempotent** — safe to re-run; already-done
  work is skipped.
- **Sensitive files are gitignored**: `udemy-auth.json`, `coursera-auth.json`,
  all `*-cache.json`, `caption-files*/`, `.env`. Keep them that way.
