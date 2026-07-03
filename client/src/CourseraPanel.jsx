import { useEffect, useState } from 'react';

// Coursera view. Data endpoints are discovered after you connect — until then
// this prompts to connect. Once connected, we build the real views.
export default function CourseraPanel() {
  const [conn, setConn] = useState(null);
  useEffect(() => {
    fetch('/api/coursera/connection').then((r) => r.json()).then(setConn).catch(() => setConn({ connected: false }));
  }, []);

  if (conn?.connected) {
    return (
      <div className="empty" style={{ textAlign: 'left', maxWidth: 640 }}>
        <div className="banner" style={{ borderColor: 'var(--border)' }}>
          ✓ <b>Coursera connected.</b> Next step is discovery — I capture what your partner
          dashboard exposes (courses, enrollments, ratings, and revenue if your login shows it),
          then build these views. Tell me you’ve connected and I’ll run it.
        </div>
      </div>
    );
  }

  return (
    <div className="empty" style={{ textAlign: 'left', maxWidth: 680 }}>
      <h3 style={{ color: 'var(--text)' }}>Coursera — connect to begin</h3>
      <p className="muted">
        Coursera has no public instructor API, so (just like Udemy) we reuse your logged-in
        session. Use <b>Connect Coursera</b> (top right), then I’ll discover what your Starweaver
        partner dashboard exposes and build the courses / enrollment / earnings views around it.
      </p>
      <p className="muted small">
        Note: on Coursera, individual instructors usually see enrollments &amp; ratings; revenue is
        often reported at the org level — we’ll see exactly what your login has once connected.
      </p>
    </div>
  );
}
