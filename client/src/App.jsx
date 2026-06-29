import { useEffect, useMemo, useState } from 'react';
import CourseDetail from './CourseDetail.jsx';

// Escape a value for CSV: wrap in quotes if it contains comma/quote/newline.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  { key: 'title', label: 'Course', sortable: true },
  { key: 'num_subscribers', label: 'Students', sortable: true, num: true },
  { key: 'revenue', label: 'Revenue', sortable: true, num: true },
  { key: 'rating', label: 'Rating', sortable: true, num: true },
  { key: 'num_reviews', label: 'Reviews', sortable: true, num: true },
  { key: 'is_published', label: 'Status', sortable: true },
];

const usd = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function App() {
  const [health, setHealth] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'num_reviews', dir: 'desc' });
  const [selected, setSelected] = useState(null);
  const [totalRevenue, setTotalRevenue] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  async function loadCourses() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/courses');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCourses(data.results || []);
      setTotalRevenue(data.total_revenue ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-load once the key is confirmed present.
  useEffect(() => {
    if (health?.hasApiKey) loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.hasApiKey]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = courses;
    if (q) rows = rows.filter((c) => c.title?.toLowerCase().includes(q));
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'title') return mul * String(av || '').localeCompare(String(bv || ''));
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return mul * (av - bv);
    });
  }, [courses, query, sort]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
    );
  }

  function exportCsv() {
    const headers = ['Title', 'Headline', 'Students', 'Revenue (USD)', 'Rating', 'Reviews', 'Status', 'Created', 'URL'];
    const rows = view.map((c) => [
      c.title,
      c.headline,
      c.num_subscribers ?? '',
      c.revenue ?? '',
      c.rating ? Number(c.rating).toFixed(2) : '',
      c.num_reviews ?? 0,
      c.is_published ? 'published' : 'draft',
      c.created ? c.created.slice(0, 10) : '',
      c.url ? `https://www.udemy.com${c.url}` : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // BOM so Excel reads UTF-8 (course titles include accented chars).
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `udemy-courses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ready = health?.hasApiKey;
  const totalReviews = courses.reduce((s, c) => s + (c.num_reviews || 0), 0);
  const totalStudents = courses.reduce((s, c) => s + (c.num_subscribers || 0), 0);
  const published = courses.filter((c) => c.is_published).length;
  const avgRating = (() => {
    const rated = courses.filter((c) => c.num_reviews > 0 && c.rating);
    if (!rated.length) return null;
    const w = rated.reduce((s, c) => s + c.rating * c.num_reviews, 0);
    const n = rated.reduce((s, c) => s + c.num_reviews, 0);
    return (w / n).toFixed(2);
  })();

  return (
    <div className="wrap">
      <header>
        <h1>Udemy Instructor Dashboard</h1>
        <p>Your courses, ratings, and engagement — pulled live from the Instructor API.</p>
      </header>

      {health && !ready && (
        <div className="banner warn">
          ⚠️ Missing <code>UDEMY_API_KEY</code> in <code>server/.env</code>. Add it and restart the backend.
        </div>
      )}
      {error && <div className="banner err">❌ {error}</div>}

      {courses.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span>{courses.length}</span>courses</div>
          <div className="kpi"><span>{totalStudents ? totalStudents.toLocaleString() : '—'}</span>total students</div>
          {totalRevenue != null && (
            <div className="kpi"><span>{usd(totalRevenue)}</span>total revenue</div>
          )}
          <div className="kpi"><span>{published}</span>published</div>
          <div className="kpi"><span>{totalReviews.toLocaleString()}</span>total reviews</div>
          <div className="kpi"><span>{avgRating ?? '—'}</span>avg rating ★</div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search courses…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={loadCourses} disabled={loading || !ready}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="ghost" onClick={exportCsv} disabled={view.length === 0}>
          ⬇ Export CSV
        </button>
        <span className="muted">{view.length} shown</span>
      </div>

      {courses.length === 0 ? (
        <div className="empty">{loading ? 'Loading your catalog…' : 'No courses loaded.'}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.sortable ? 'sortable' : ''}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  style={col.num ? { textAlign: 'right' } : undefined}
                >
                  {col.label}
                  {sort.key === col.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((c) => (
              <tr key={c.id} onClick={() => setSelected(c)} className="row">
                <td>{c.title}</td>
                <td style={{ textAlign: 'right' }}>
                  {c.num_subscribers != null ? c.num_subscribers.toLocaleString() : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{usd(c.revenue)}</td>
                <td style={{ textAlign: 'right' }}>{c.rating ? Number(c.rating).toFixed(2) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{(c.num_reviews ?? 0).toLocaleString()}</td>
                <td>
                  {c.is_published ? (
                    <span className="tag good">published</span>
                  ) : (
                    <span className="tag">draft</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && <CourseDetail course={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
