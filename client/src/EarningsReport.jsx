import { useMemo, useState } from 'react';

const usd = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (s) =>
  !s ? '—' : new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Published-only report: Course Title · Total Earning · Launched Date.
export default function EarningsReport({ courses, totalRevenue }) {
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' });

  const rows = useMemo(() => {
    const published = courses.filter((c) => c.is_published);
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...published].sort((a, b) => {
      if (key === 'title') return mul * String(a.title || '').localeCompare(String(b.title || ''));
      if (key === 'launched') return mul * ((new Date(a.published_time || 0)) - (new Date(b.published_time || 0)));
      return mul * ((a.revenue || 0) - (b.revenue || 0)); // revenue
    });
  }, [courses, sort]);

  const perCourseSum = rows.reduce((s, c) => s + (c.revenue || 0), 0);
  const hasPerCourse = rows.some((c) => c.revenue != null);
  // Grand total from the revenue account; per-course sum once that endpoint lands.
  const totalEarnings = hasPerCourse ? perCourseSum : totalRevenue;
  const hasRevenue = totalRevenue != null || hasPerCourse;

  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  function exportCsv() {
    const header = ['Course Title', 'Total Earning (USD)', 'Launched Date'];
    const body = rows.map((c) => [c.title, c.revenue ?? '', c.published_time ? c.published_time.slice(0, 10) : '']);
    const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `udemy-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const arrow = (k) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><span>{rows.length}</span>published courses</div>
        <div className="kpi"><span>{hasRevenue ? usd(totalEarnings) : '—'}</span>total earnings</div>
      </div>

      {!hasRevenue && (
        <div className="banner warn">
          ⚠️ <b>Total Earning</b> needs your revenue data. Connect Udemy and run
          <code>npm run scrape:revenue</code>; it fills in here.
        </div>
      )}
      {hasRevenue && !hasPerCourse && (
        <div className="banner warn">
          ✓ Grand total earnings shown above. The <b>per-course</b> breakdown uses a separate
          Udemy endpoint that isn’t wired up yet — those cells show “—” for now.
        </div>
      )}

      <div className="toolbar">
        <button className="ghost" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
        <span className="muted">{rows.length} published courses</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle('title')}>Course Title{arrow('title')}</th>
            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('revenue')}>Total Earning{arrow('revenue')}</th>
            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('launched')}>Launched Date{arrow('launched')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.title}</td>
              <td style={{ textAlign: 'right' }}>{usd(c.revenue)}</td>
              <td style={{ textAlign: 'right' }}>{fmtDate(c.published_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
