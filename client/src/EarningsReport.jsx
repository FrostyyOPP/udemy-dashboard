import { useMemo, useState } from 'react';

const usd = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtDate = (s) =>
  !s ? '—' : new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const daysLive = (s) => (s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000)) : null);

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Published-only earnings analysis: Title · Total Earning · Days Live · $/Day · Launched.
export default function EarningsReport({ courses, totalRevenue }) {
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' });

  const rows = useMemo(() => {
    return courses
      .filter((c) => c.is_published)
      .map((c) => {
        const days = daysLive(c.published_time);
        const perDay = c.revenue != null && days ? c.revenue / Math.max(days, 1) : c.revenue != null ? c.revenue : null;
        return { ...c, _days: days, _perDay: perDay };
      });
  }, [courses]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    const val = (c) =>
      key === 'title' ? c.title || ''
      : key === 'launched' ? new Date(c.published_time || 0).getTime()
      : key === 'days' ? (c._days ?? -1)
      : key === 'perday' ? (c._perDay ?? -1)
      : (c.revenue ?? -1); // revenue
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (key === 'title') return mul * String(av).localeCompare(String(bv));
      return mul * (av - bv);
    });
  }, [rows, sort]);

  const perCourseSum = rows.reduce((s, c) => s + (c.revenue || 0), 0);
  const hasPerCourse = rows.some((c) => c.revenue != null);
  const totalEarnings = hasPerCourse ? perCourseSum : totalRevenue;
  const hasRevenue = totalRevenue != null || hasPerCourse;
  const best = hasPerCourse ? [...rows].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0] : null;
  const avgDays = rows.length ? Math.round(rows.reduce((s, c) => s + (c._days || 0), 0) / rows.length) : 0;

  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  function exportCsv() {
    const header = ['Course Title', 'Total Earning (USD)', 'Days Live', 'Earning per Day (USD)', 'Launched Date'];
    const body = sorted.map((c) => [
      c.title,
      c.revenue ?? '',
      c._days ?? '',
      c._perDay != null ? c._perDay.toFixed(2) : '',
      c.published_time ? c.published_time.slice(0, 10) : '',
    ]);
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
        <div className="kpi"><span>{avgDays.toLocaleString()}</span>avg days live</div>
        {best && (
          <div className="kpi"><span title={best.title}>{usd(best.revenue)}</span>top earner</div>
        )}
      </div>

      {!hasRevenue && (
        <div className="banner warn">
          ⚠️ <b>Total Earning</b> needs your revenue data. Connect Udemy and run
          <code>npm run scrape:revenue</code>; it fills in here.
        </div>
      )}
      {best && (
        <div className="banner" style={{ borderColor: 'var(--border)' }}>
          🏆 Best performer: <b>{best.title}</b> — {usd(best.revenue)} over{' '}
          {best._days?.toLocaleString()} days live ({usd2(best._perDay)}/day).
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
            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('days')}>Days Live{arrow('days')}</th>
            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('perday')}>$/Day{arrow('perday')}</th>
            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('launched')}>Launched{arrow('launched')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id}>
              <td>{c.title}</td>
              <td style={{ textAlign: 'right' }}>{usd(c.revenue)}</td>
              <td style={{ textAlign: 'right' }}>{c._days != null ? c._days.toLocaleString() : '—'}</td>
              <td style={{ textAlign: 'right' }}>{c._perDay != null ? usd2(c._perDay) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{fmtDate(c.published_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
