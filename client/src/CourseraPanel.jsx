import { useEffect, useState } from 'react';

// Coursera view. Shows the partner course list once connected + scraped.
export default function CourseraPanel() {
  const [conn, setConn] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/coursera/connection').then((r) => r.json()).then(setConn).catch(() => setConn({ connected: false }));
    fetch('/api/coursera/courses').then((r) => r.json()).then(setData).catch(() => setData({ courses: [] }));
  }, []);

  if (!conn?.connected) {
    return (
      <div className="empty" style={{ textAlign: 'left', maxWidth: 680 }}>
        <h3 style={{ color: 'var(--text)' }}>Coursera — connect to begin</h3>
        <p className="muted">
          Coursera has no public instructor API, so (like Udemy) we reuse your logged-in session.
          Use <b>Connect Coursera</b> (top right), then I discover your Starweaver partner data.
        </p>
      </div>
    );
  }

  const courses = data?.courses || [];

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><span>{courses.length}</span>Coursera courses</div>
        <div className="kpi"><span>Starweaver</span>partner (1510)</div>
      </div>

      <div className="banner" style={{ borderColor: 'var(--border)' }}>
        ✓ Connected to <b>Starweaver</b> on Coursera. Course list below. Enrollments / ratings /
        revenue live on a deeper analytics page — that's the next discovery step.
      </div>

      {courses.length === 0 ? (
        <div className="empty">
          No courses cached yet. Run <code>npm run coursera:courses</code> in <code>server/</code>, then refresh.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Course</th><th>Slug</th><th></th></tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="mono">{c.slug}</td>
                <td style={{ textAlign: 'right' }}>
                  <a href={`https://www.coursera.org/learn/${c.slug}`} target="_blank" rel="noreferrer">open ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
