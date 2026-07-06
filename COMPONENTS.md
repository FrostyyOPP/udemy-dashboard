# UI Component Reference

A complete inventory of every component in the dashboard — what it is, its parts,
its states, and the exact tokens/classes it uses. Built for redesign work.

- **Stack:** React (Vite), plain CSS (`client/src/index.css`), no UI library.
- **Files:** all components live in `client/src/`.
- **Theme today:** dark, single purple accent. Everything below is the current
  baseline to design *from*.

---

## 1. Design tokens (current)

**Colors** (`:root` in `index.css`)

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#0f1117` | page background (near-black, blue-cool) |
| `--card` | `#1a1d27` | tiles, inputs, table, raised surfaces |
| `--border` | `#2a2e3a` | all hairlines / outlines |
| `--text` | `#e6e8ee` | primary text |
| `--muted` | `#9aa0ad` | secondary text, labels |
| `--accent` | `#a435f0` | Udemy purple — buttons, active states, links-ish |
| `--accent-soft` | `#2a1a3d` | purple tint background |
| `--good` | `#4ade80` | success / published / connected (green) |
| `--warn` | `#fbbf24` | warning (amber) |
| _error_ | `#f87171` | error text (red, inline in `.banner.err`) |
| _link_ | `#c79bff` | anchor color |

**Radius:** 8px (buttons, inputs), 10–12px (cards, tiles, tables, modals), 999px (pills).
**Type:** system sans (`-apple-system, Segoe UI, Roboto`); mono (`ui-monospace, Menlo`) for IDs/codes.
**Type scale in use:** 22px (KPI number) · 24px (h1) · 17px (drawer/modal title) · 14px (body/table) · 13px (muted) · 12px (labels/th) · 11px (mono id).
**Layout:** centered column, `max-width: 1100px`, padding `32px 24px`. Spacing via fl/grid `gap` (4/8/12/16/20px).

> Note: the two platforms currently **share one accent** (purple). A likely redesign
> move is to give Udemy and Coursera each their own color over a neutral shell.

---

## 2. Component tree

```
App                                  (shell: header, platform switch, view routing)
├─ ConnectUdemy | ConnectCoursera    (status pill + connect modal)   — in header
├─ [platform = udemy]
│  ├─ KPI strip                       (inline in App)
│  ├─ Toolbar                         (search · Refresh · Export CSV · CreateCoupons)
│  │  └─ CreateCoupons                (button + create-coupon modal)
│  ├─ view tabs: All Courses | Earnings (Published)
│  ├─ Course table                    (All Courses — inline in App)
│  │  └─ CourseDetail                 (right drawer: Reviews / Q&A / Coupons)
│  └─ EarningsReport                  (Earnings tab table + KPIs)
└─ [platform = coursera]
   └─ CourseraPanel                   (KPIs + engagement table)
```

Files: `App.jsx`, `ConnectUdemy.jsx`, `ConnectCoursera.jsx`, `CreateCoupons.jsx`,
`CourseDetail.jsx`, `EarningsReport.jsx`, `CourseraPanel.jsx`.

---

## 3. Primitives (shared building blocks)

These classes are reused everywhere — design these first; the rest is composition.

### Button
- **Primary** — `button` — purple fill, white text, 8px radius, 9×16 padding, weight 600.
- **Ghost** — `button.ghost` — transparent, hairline border, text color; hover → purple border + light-purple text.
- **Close** — `button.close` — transparent, muted, small (drawer/modal X).
- **Disabled** — `:disabled` → opacity 0.5.
- States needed: default, hover, active/pressed, disabled, loading ("Working…").

### KPI tile — `.kpi` (inside `.kpis` flex strip)
- Card surface, 12px radius. Big number (22px/700) over a muted label (13px).
- Used in every view's summary strip. Wraps on narrow widths.
- Variant: some tiles show a word instead of a number (e.g. "Starweaver" partner).

### Chips / tags
- `.tag` — neutral pill (muted on dark grey). e.g. "draft", "free".
- `.tag.good` — green pill. e.g. "published", coupon "FREE".
- `.conn` — connection status pill (green text + border) — clickable to disconnect.
- Design needs a **status system**: neutral / good / warn / error, plus a
  data-source tag (Live / Scraped / N-A) that doesn't exist yet but should.

### Banner — `.banner` (full-width message)
- `.banner.warn` (amber) · `.banner.err` (red) · plain (neutral, hairline).
- Used for: missing key, errors, connected confirmations, quota warnings, dry-run results.

### Table — `.table`
- Card-wrapped, hairline row dividers, 12px radius.
- `th` — uppercase 12px muted; `.sortable` shows pointer + sort arrow (▲/▼).
- `.row` — clickable (Udemy course rows), hover highlight.
- Numeric cells right-aligned. `.mono` cell = copyable ID (cursor: copy).
- **Design gap:** 9+ columns → needs a wide-table strategy (pin, hide, horizontal scroll, or card view on mobile).

### Modal — `.modal` inside `.drawer-backdrop` (centered)
- Max 560px, 12px radius, header (title + close) + body. Used by Connect and Create Coupons.

### Drawer — `.drawer` inside `.drawer-backdrop` (right-anchored)
- Max 560px, full height, slides from right. Header + tabs + scrollable body. Used by CourseDetail.

### Form fields — `.fld` (label + input/select), `.row2` (two-up grid), `.paste` (textarea)
- Card-surface inputs, 8px radius. Used in the modals.

---

## 4. Feature components

### `App.jsx` — Shell
- **Renders:** header (`.apphead`), platform switcher (`.platsw`), and routes the body by `platform` + `tab`.
- **Header:** `h1` "Instructor Dashboard" + subtitle; platform switch (Udemy | Coursera); on the right, `<ConnectUdemy>` or `<ConnectCoursera>`.
- **State:** `platform` (udemy/coursera), `tab` (all/earnings), `courses`, `totalRevenue`, `query`, `sort`, `selected` (drawer), loading/error.
- **Udemy body:** KPI strip → view tabs (`.viewtabs`) → Toolbar → Course table (or `<EarningsReport>`).
- **Design surfaces here:** the whole top chrome (title, platform switch, connect), the KPI strip, the tab bar.

### Platform switcher — `.platsw` (in App header)
- Segmented control: **Udemy | Coursera**. Active segment = purple fill.
- The single most important navigation element; a redesign candidate for per-platform color.

### Course table (All Courses) — inline in `App.jsx`
- **Columns:** Course · Course ID (`.mono`, click-to-copy) · Students · Revenue · Rating · Reviews · Captions · Coupons · Status.
- Cells: Status = `.tag`/`.tag.good`; Captions = comma list + "+N" overflow (tooltip); Coupons = count.
- **Row click →** opens `CourseDetail` drawer.
- **States:** loading ("Loading your catalog…"), empty, populated. Some cells show "—" when that data hasn't been scraped yet.

### `CourseDetail.jsx` — Right drawer
- **Trigger:** clicking a Udemy course row.
- **Header:** course title, rating · reviews, "open on Udemy ↗" link.
- **Tabs** (`.tabs`): **Reviews** · **Q&A** · **Coupons** (each shows a count).
- **Item layouts (`.item`):**
  - Review: stars + author + date, then review text (or "rating only").
  - Q&A: author + date, question title, body.
  - Coupon: code (mono, purple) + `FREE`/`$` tag + "used/max" + validity window.
- **States:** loading, empty ("No {tab} for this course"), error banner.

### `EarningsReport.jsx` — Udemy Earnings (Published) tab
- **KPIs:** published courses · total earnings · avg days live · top earner.
- **Best-performer banner** (neutral) — highlights the strongest course + $/day.
- **Table:** Course Title · Total Earning · Days Live · $/Day · Launched. All sortable.
- **States:** warning banner when revenue isn't synced yet; otherwise the grand total shows even before per-course fills in.

### `CourseraPanel.jsx` — Coursera view
- **KPIs:** courses · total enrollments · total completions · avg rating · partner name.
- **Toolbar:** Export CSV + a note (Coursera pays at org level → no per-course revenue).
- **Table:** Course · Domain · Enrollments · Completions · Completion Rate · Rating. Sortable.
- **States:** not-connected (connect prompt), connected-no-data ("run `npm run coursera:metrics`"), populated.

### `ConnectUdemy.jsx` / `ConnectCoursera.jsx` — Connect
- **Collapsed:** either a `🔗 Connect {platform}` ghost button, or a green `● {platform} connected · disconnect` pill.
- **Modal:** heading, a "no OAuth, reuse your login" explanation, a 4-step cookie-export list, a `.paste` textarea, Connect button, "stored locally" note. Error banner on bad paste.
- **This is the trust/onboarding moment** — highest-priority redesign target.

### `CreateCoupons.jsx` — Bulk coupon creator (Udemy)
- **Trigger:** `🎟️ Create Coupons` ghost button in the toolbar.
- **Modal fields:** coupon code · type (Free / Discount price) · price (if discount) · max uses · valid days · scope (Test on 1 course / All published) · `discount_strategy` (advanced) .
- **Actions:** Preview (dry run — writes nothing) · Create (live write).
- **Feedback:** amber warning (live account + quota), dry-run result banner, per-course created/failed result.
- **States:** default, busy ("Working…"), success, partial-failure (shows per-course errors).

---

## 5. Screen compositions

| Screen | Composed of |
|--------|-------------|
| **Udemy · All Courses** | Header + Platform switch + Connect · KPI strip · View tabs · Toolbar (search/Refresh/Export/CreateCoupons) · Course table · CourseDetail drawer |
| **Udemy · Earnings** | Header · View tabs · EarningsReport (KPIs + best-performer banner + table) |
| **Coursera** | Header + ConnectCoursera · CourseraPanel (KPIs + engagement table) |
| **Connect (modal)** | ConnectUdemy / ConnectCoursera modal |
| **Create Coupons (modal)** | CreateCoupons modal |

---

## 6. States to design for every data view

- **Not connected** — onboarding prompt (warm, not an error).
- **Connected, no data yet** — "run your first sync".
- **Loading** — distinguish a quick API load from a minutes-long scrape.
- **Populated** — summary (KPIs) above detail (table).
- **Stale** — cache older than expected; needs a "last synced" marker (not built yet).
- **Error** — expired session / bad key / blocked → say what broke + next step.
- **Empty cell** — a "—" when a scraped field isn't available for that course.

---

## 7. Known design gaps (open for you)

- No **freshness / "last synced"** indicators anywhere (data is a mix of live + cached).
- Two platforms **share one accent** — candidate for per-platform color.
- **Wide Udemy table** (9 cols, growing) has no responsive strategy.
- No **charts** — monthly revenue & enrollment history exist in data but show as flat totals.
- No **cross-platform overview** — you pick a platform first; there's no combined home.
- **Desktop-only**; mobile is unaddressed.
- Connect flow is **functional but bare** — the riskiest step to leave unpolished.
