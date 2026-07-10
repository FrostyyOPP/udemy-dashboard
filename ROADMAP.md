# Distribution Dashboard — Capabilities & Roadmap

A living document of **what the tool does today** and **where it can go next**,
with a deliberate focus on **data visualization** and **design/UX**.

> For API/auth details see [`README.md`](./README.md). For the current UI
> component + design-token inventory see [`COMPONENTS.md`](./COMPONENTS.md).

---

## 1. What the tool does today

A self-hosted dashboard that unifies an instructor's **Udemy** and **Coursera**
presence in one place. Backend is Express (proxies the Udemy API + serves cached
scrapes); frontend is React + Vite (plain CSS, no UI library); the data the APIs
don't expose is filled in by headed-browser **Playwright** scrapers that reuse
the instructor's own session.

### Udemy
| Capability | Detail |
|---|---|
| **Course table** | All taught courses with rating, review count, enrollment, revenue, caption languages, coupon count — searchable, multi-column sortable, CSV export |
| **Course detail drawer** | Per-course Instructors, Reviews, Q&A, and Coupons tabs; domain auto-classification |
| **Enrollment** | Student counts scraped from public course pages |
| **Revenue** | Lifetime total KPI + per-course earnings; **Earnings report** with Days-Live, $/day, and best-performer analysis |
| **Coupons** | Viewer (active coupons per course) + **bulk create** (one code across selected/all courses, dry-run preview) |
| **Captions (view)** | Subtitle-language column (top languages + overflow), sortable, CSV |
| **Captions (localize)** ⭐ | Translate + publish captions in **30 languages** — per-course, selected-courses (checklist), or all; free machine translation (batched), staged progress bar, resumable/idempotent |

### Coursera
| Capability | Detail |
|---|---|
| **Course list** | Authored courses (partner console) |
| **Overview KPIs** | Launched courses, specializations, etc. (from the partner Looker dashboard) |
| **Metrics table** | Per-course enrollments, completions, completion rate, avg rating (scraped from Looker query results) |

### Platform / infrastructure
- **Connect flows** — cookie-export based session connect for both Udemy and Coursera (key/session stays server-side)
- **Daily auto-update** — scheduled refresh of revenue, coupons, captions, Coursera metrics
- **Access control** — HTTP basic-auth gate; one-port deploy (serves the built client)
- **Public access** — stable tunnel URL, always-on via background agents
- **Freshness indicator** — "data updated N ago" from the newest cache timestamp

---

## 2. Architecture at a glance

```
React + Vite (client/)  ──fetch──►  Express (server/index.js)
   table / drawers / modals             │  proxies Udemy API (key server-side)
                                         │  reads cache JSON (fresh per request)
                                         └─ Playwright scrapers (headed, session)
                                              enrollment · revenue · coupons ·
                                              captions · Coursera(Looker) · localize
```

Everything the APIs can't provide is a **cache file** written by a scraper and
merged into `/api/courses` at read time — so the UI never blocks on a scrape.

---

## 3. Where it can go — Visualization

The dashboard is **table-first** today. The data already collected can drive a
much richer analytics layer. Grouped by "already have the data" vs "needs a small
capture addition."

### A. Buildable now (data already collected)
| Idea | What it shows | Source already in hand |
|---|---|---|
| **Overview home page** | KPI band (courses, students, revenue, avg rating) + a few headline charts, instead of landing on the raw table | courses + enrollment + revenue caches |
| **Revenue by course** (bar / treemap) | Which courses earn most, at a glance | per-course revenue |
| **Revenue by domain** (donut / stacked bar) | Earnings split across Finance / AI / Cybersecurity / etc. | revenue + existing domain classifier |
| **$/day leaderboard** | Efficiency, not just totals — best earners per day live | Earnings report math (days-live, $/day) |
| **Enrollment ↔ revenue scatter** | Spot high-enrollment/low-revenue (pricing/coupon) outliers | enrollment + revenue |
| **Rating distribution** (histogram) | Portfolio quality shape; flag low-rated courses | ratings |
| **Caption coverage matrix** ⭐ | Grid of courses × languages — green where localized, gaps to fill; ties directly into the new localize feature | caption locales + localize job results |
| **Coursera funnel** | Enrollments → completions, completion-rate ranking | Coursera metrics |
| **Udemy vs Coursera** compare | Same instructor, two platforms, side by side (reach vs revenue) | both metric sets |

### B. Needs a small capture addition
| Idea | What it unlocks | What to add |
|---|---|---|
| **Trends over time** (revenue, enrollment, ratings, reviews) | The single biggest gap — everything today is a *snapshot*. Line/area charts of growth | Append a dated row to a history cache on each daily update → instant time-series |
| **Review sentiment over time** | Are recent reviews trending up/down; surface fresh negatives | Timestamp + light sentiment tag on reviews during scrape |
| **Coupon performance** | Redemptions vs issued, expiry timeline | Capture `number_of_uses` over time |
| **Localization ROI** | Enrollment lift after adding languages | Correlate localize dates with enrollment history |

> **Highest-leverage single move:** start writing a **daily snapshot** (date +
> per-course enrollment/revenue/rating) to a `history-*.json`. It's a few lines in
> the update job and turns the whole dashboard from "current state" into "trends."

---

## 4. Where it can go — Design / UX

The current look is a dark, single-purple, table-centric layout (see
`COMPONENTS.md`). Directions that would raise it from "functional tool" to
"polished product":

### Structure & navigation
- **Overview → detail hierarchy.** Land on a visual overview (KPIs + charts); make the big table one tab, not the front door.
- **Tabs/sections** for Overview · Courses · Earnings · Captions · Coursera, instead of stacking everything.
- **Saved views / filters** — by domain, by performance band, by caption-coverage, by platform.

### Visual system
- **Dual-platform theming** — give Udemy (purple) and Coursera (blue/teal) each their own accent over a neutral shell, so you always know which world you're in (already flagged in `COMPONENTS.md`).
- **Light mode + theme toggle.**
- **Card/grid view** as an alternative to the table (course cards with thumbnail, rating, mini-sparkline).
- **Charting library** — adopt a lightweight one (e.g. Recharts/visx) with tokens matching the theme.

### Interaction & feedback
- **Toasts** for actions (coupon created, captions published) instead of inline banners.
- **Skeleton/loading states** and richer empty states.
- **Captions UX polish** — per-course language badges, a coverage-matrix screen, an ETA + per-language sub-progress on the job panel, and a "resume/fill gaps" affordance.
- **Command palette / quick search** (⌘K) to jump to any course.

### Quality
- **Responsive / mobile** layout (today it's desktop-centric).
- **Accessibility** — focus states, keyboard nav in table + drawers, ARIA on the modals.

---

## 5. Beyond visualization — feature ideas

- **Alerts / digests** — email or in-app: rating drop, new low review, coupon expiring, session about to expire.
- **Scheduled reports** — weekly PDF/email earnings + growth summary.
- **Captions expansion** — optional higher-quality translation engines (context-aware), subtitle-quality review pass, more languages.
- **Coursera parity** — bring Coursera detail views up to Udemy's depth as its data allows.
- **Session health** — surface when a platform session is stale (the recent Coursera case) with a one-click reconnect prompt.

---

## 6. Suggested prioritization

| Effort | High impact | Notes |
|---|---|---|
| **Quick win** | Daily **history snapshot** → unlocks all trend charts | few lines in the update job |
| **Quick win** | **Overview page** with KPI band + 2–3 charts (revenue by domain, $/day, rating dist) | data already present |
| **Quick win** | **Caption coverage matrix** | leverages the new localize feature |
| Medium | Dual-platform theming + light mode | design system work |
| Medium | Trends dashboard (line charts) | after history snapshots accrue |
| Medium | Card/grid view + saved filters | UX depth |
| Bigger | Alerts/digests, scheduled reports | new backend surface |
| Bigger | Full responsive + accessibility pass | broad but valuable |

---

*This is a planning doc, not a commitment — pick the rows that match where you
want the tool to go next.*
