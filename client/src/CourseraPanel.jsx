import { useEffect, useMemo, useState } from 'react';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const star = (n) => (n == null ? '—' : Number(n).toFixed(2));

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function CourseraPanel() {
  const [conn, setConn] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [sort, setSort] = useState({ key: 'enrollments', dir: 'desc' });

  useEffect(() => {
    fetch('/api/coursera/connection').then((r) => r.json()).then(setConn).catch(() => setConn({ connected: false }));
    fetch('/api/coursera/metrics').then((r) => r.json()).then(setMetrics).catch(() => setMetrics({ courses: [] }));
  }, []);

  const courses = metrics?.courses || [];
  const sorted = useMemo(() => {
    const { key, dir } = sort; const mul = dir === 'asc' ? 1 : -1;
    return [...courses].sort((a, b) => {
      if (key === 'name' || key === 'domain') return mul * String(a[key] || '').localeCompare(String(b[key] || ''));
      return mul * ((a[key] ?? -1) - (b[key] ?? -1));
    });
  }, [courses, sort]);

  const totalEnroll = courses.reduce((s, c) => s + (c.enrollments || 0), 0);
  const totalCompl = courses.reduce((s, c) => s + (c.completions || 0), 0);
  const rated = courses.filter((c) => c.rating);
  const avgRating = rated.length ? (rated.reduce((s, c) => s + c.rating, 0) / rated.length).toFixed(2) : '—';

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  const arrow = (k) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  function exportCsv() {
    const header = ['Course', 'Domain', 'Enrollments', 'Paid Enrollments', 'Completions', 'Completion Rate', 'Rating', 'Launch Date', 'In Specialization'];
    const body = sorted.map((c) => [c.name, c.domain, c.enrollments, c.paidEnrollments, c.completions, c.completionRate, c.rating, c.launchDate, c.inSpecialization ? 'Yes' : 'No']);
    const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coursera-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  if (!conn?.connected) {
    return (
      <div className="empty" style={{ textAlign: 'left', maxWidth: 680 }}>
        <h3 style={{ color: 'var(--text)' }}>Coursera — connect to begin</h3>
        <p className="muted">Use <b>Connect Coursera</b> (top right) to reuse your logged-in session, then run <code>npm run coursera:metrics</code>.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><span>{courses.length}</span>courses</div>
        <div className="kpi"><span>{num(totalEnroll)}</span>total enrollments</div>
        <div className="kpi"><span>{num(totalCompl)}</span>total completions</div>
        <div className="kpi"><span>{avgRating}</span>avg rating ★</div>
        <div className="kpi"><span>Starweaver</span>partner (1510)</div>
      </div>

      {courses.length === 0 ? (
        <div className="empty">No metrics cached. Run <code>npm run coursera:metrics</code>, then refresh.</div>
      ) : (
        <>
          <div className="toolbar">
            <button className="ghost" onClick={exportCsv}>⬇ Export CSV</button>
            <span className="muted">{courses.length} courses · enrollments/completions/ratings (Coursera pays partners at org level, so no per-course revenue)</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggle('name')}>Course{arrow('name')}</th>
                <th className="sortable" onClick={() => toggle('domain')}>Domain{arrow('domain')}</th>
                <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('enrollments')}>Enrollments{arrow('enrollments')}</th>
                <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('completions')}>Completions{arrow('completions')}</th>
                <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('completionRate')}>Compl. Rate{arrow('completionRate')}</th>
                <th className="sortable" style={{ textAlign: 'right' }} onClick={() => toggle('rating')}>Rating{arrow('rating')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td className="muted">{c.domain || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{num(c.enrollments)}</td>
                  <td style={{ textAlign: 'right' }}>{num(c.completions)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(c.completionRate)}</td>
                  <td style={{ textAlign: 'right' }}>{star(c.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
