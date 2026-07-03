import { useEffect, useState } from 'react';

export default function CourseDetail({ course, onClose }) {
  const [tab, setTab] = useState('reviews');
  const [reviews, setReviews] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const id = encodeURIComponent(course.id);
    setReviews(null);
    setQuestions(null);
    setError(null);

    fetch(`/api/reviews?course=${id}&page_size=50`)
      .then((r) => r.json())
      .then((d) => setReviews(d.results || []))
      .catch((e) => setError(e.message));

    fetch(`/api/questions?course=${id}&page_size=50`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.results || []))
      .catch((e) => setError(e.message));
  }, [course.id]);

  const coupons = Array.isArray(course.coupons) ? course.coupons : null;
  const list = tab === 'reviews' ? reviews : tab === 'questions' ? questions : coupons;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>{course.title}</h2>
            <div className="muted">
              {course.rating ? Number(course.rating).toFixed(2) : '—'} ★ ·{' '}
              {(course.num_reviews ?? 0).toLocaleString()} reviews
              {course.url && (
                <>
                  {' · '}
                  <a href={`https://www.udemy.com${course.url}`} target="_blank" rel="noreferrer">
                    open on Udemy ↗
                  </a>
                </>
              )}
            </div>
          </div>
          <button className="close" onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          <button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>
            Reviews {reviews && `(${reviews.length})`}
          </button>
          <button className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}>
            Q&A {questions && `(${questions.length})`}
          </button>
          <button className={tab === 'coupons' ? 'active' : ''} onClick={() => setTab('coupons')}>
            Coupons {coupons && `(${coupons.length})`}
          </button>
        </div>

        {error && <div className="banner err">❌ {error}</div>}

        <div className="drawer-body">
          {list === null ? (
            <div className="muted">Loading…</div>
          ) : list.length === 0 ? (
            <div className="muted">No {tab} for this course.</div>
          ) : (
            list.map((item, idx) => (
              <div className="item" key={item.id || item.code || idx}>
                {tab === 'reviews' ? (
                  <>
                    <div className="item-head">
                      <b>{'★'.repeat(Math.round(item.rating || 0)) || '—'}</b>
                      <span className="muted">{item.user?.display_name || item.user?.title || 'Anonymous'}</span>
                      <span className="muted small">{fmtDate(item.created)}</span>
                    </div>
                    <p>{item.content || <em className="muted">(rating only, no text)</em>}</p>
                  </>
                ) : tab === 'questions' ? (
                  <>
                    <div className="item-head">
                      <span className="muted">{item.user?.display_name || item.user?.title || 'Student'}</span>
                      <span className="muted small">{fmtDate(item.created)}</span>
                    </div>
                    <p><b>{item.title}</b></p>
                    {item.content && <p className="muted">{stripHtml(item.content)}</p>}
                  </>
                ) : (
                  <>
                    <div className="item-head">
                      <b className="mono" style={{ color: 'var(--accent)', fontSize: 13 }}>{item.code}</b>
                      <span className="tag good">{item.is_free ? 'FREE' : `$${item.discount_value}`}</span>
                      <span className="muted small">{item.used}/{item.max_uses ?? '∞'} used</span>
                    </div>
                    <p className="muted small">
                      {fmtDate(item.start)} → {fmtDate(item.end)}
                      {item.active === false && ' · inactive'}
                    </p>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function stripHtml(s = '') {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
