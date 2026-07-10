import { useEffect, useMemo, useRef, useState } from 'react';

// The pipeline stages shown as a stepper.
const STAGES = [
  { key: 'download', label: 'Downloading English' },
  { key: 'translate', label: 'Translating' },
  { key: 'upload', label: 'Uploading' },
  { key: 'done', label: 'Done' },
];
const stageIndex = (phase) => {
  if (phase === 'starting' || phase === 'download') return 0;
  if (phase === 'translate') return 1;
  if (phase === 'upload') return 2;
  if (phase === 'done') return 3;
  return 0;
};

// Multi-language caption localization. Two modes:
//   bulk:        <LocalizeCaptions courses={courses} />        (scope: test 1 / all)
//   per-course:  <LocalizeCaptions courses={[course]} single /> (locked to that course)
// Translates (free) + uploads + auto-publishes on Udemy. Dry-run previews with no writes.
export default function LocalizeCaptions({ courses, single = false, onDone }) {
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState([]);          // [{name, locale, core}]
  const [picked, setPicked] = useState(() => new Set());
  const [scope, setScope] = useState('test');      // bulk only: 'test' | 'selected' | 'all'
  const [courseSel, setCourseSel] = useState(() => new Set()); // published_title slugs
  const [courseQuery, setCourseQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const published = useMemo(
    () => courses.filter((c) => c.published_title && (single || c.is_published)),
    [courses, single]
  );
  const targets = single
    ? published
    : scope === 'test' ? published.slice(0, 1)
    : scope === 'selected' ? published.filter((c) => courseSel.has(c.published_title))
    : published;
  const shown = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    return q ? published.filter((c) => (c.title || '').toLowerCase().includes(q)) : published;
  }, [published, courseQuery]);

  function toggleCourse(slug) {
    setCourseSel((prev) => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  }

  useEffect(() => {
    if (!open || langs.length) return;
    fetch('/api/captions/languages').then((r) => r.json()).then((d) => setLangs(d.languages || [])).catch(() => {});
  }, [open, langs.length]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  function toggle(locale) {
    setPicked((prev) => { const n = new Set(prev); n.has(locale) ? n.delete(locale) : n.add(locale); return n; });
  }

  async function submit(dryRun) {
    setBusy(true); setError(null); setJob(null);
    clearInterval(pollRef.current);
    try {
      const res = await fetch('/api/captions/localize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: targets.map((c) => c.published_title), locales: [...picked], dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // poll the job until it finishes
      pollRef.current = setInterval(async () => {
        try {
          const jr = await fetch(`/api/captions/jobs/${data.jobId}`);
          const jd = await jr.json();
          if (!jr.ok) throw new Error(jd.error || `HTTP ${jr.status}`);
          setJob(jd);
          if (jd.status !== 'running') {
            clearInterval(pollRef.current); setBusy(false);
            if (!dryRun && jd.totals?.published > 0) onDone?.();
          }
        } catch (e) { clearInterval(pollRef.current); setBusy(false); setError(e.message); }
      }, 1500);
    } catch (e) { setBusy(false); setError(e.message); }
  }

  function closeAll() {
    clearInterval(pollRef.current); setBusy(false); setJob(null); setError(null); setOpen(false);
  }

  const core = langs.filter((l) => l.core);
  const rest = langs.filter((l) => !l.core);
  const t = job?.totals;
  const running = job?.status === 'running';
  const finished = job && !running;
  const hasFailure = job && (job.status === 'error' || (t && t.failed > 0));
  const sIdx = job ? stageIndex(job.phase) : -1;
  const pct = job
    ? job.status === 'done' ? 100
    : job.progress?.total ? Math.min(100, Math.round((job.progress.done / job.progress.total) * 100))
    : 0
    : 0;

  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>
        🌐 {single ? 'Captions' : 'Localize Captions'}
      </button>
      {open && (
        <div className="drawer-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>{single ? `Captions — ${targets[0]?.title?.slice(0, 40) || ''}` : 'Localize captions'}</h2>
              <button className="close" onClick={() => !busy && setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <div className="banner warn" style={{ margin: 0 }}>
                ⚠️ Publishing writes live captions to your Udemy courses (machine translation via Google).
                Languages already present on a lecture are skipped, so runs are safe to repeat.
              </div>

              <div>
                <div className="muted small" style={{ marginBottom: 6 }}>Languages {picked.size ? `(${picked.size} selected)` : ''}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {core.map((l) => (
                    <button key={l.locale} onClick={() => toggle(l.locale)}
                      className={picked.has(l.locale) ? '' : 'ghost'}
                      style={{ padding: '4px 10px', fontSize: 13 }} title={l.locale}>{l.name}</button>
                  ))}
                </div>
                <details>
                  <summary className="muted small" style={{ cursor: 'pointer' }}>More languages ({rest.length})</summary>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {rest.map((l) => (
                      <button key={l.locale} onClick={() => toggle(l.locale)}
                        className={picked.has(l.locale) ? '' : 'ghost'}
                        style={{ padding: '4px 10px', fontSize: 13 }} title={l.locale}>{l.name}</button>
                    ))}
                  </div>
                </details>
              </div>

              {!single && (
                <label className="fld">Apply to
                  <select value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="test">Test on 1 course ({published[0]?.title?.slice(0, 36) || '—'})</option>
                    <option value="selected">Selected courses…</option>
                    <option value="all">All published courses ({published.length})</option>
                  </select>
                </label>
              )}

              {!single && scope === 'selected' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input value={courseQuery} onChange={(e) => setCourseQuery(e.target.value)}
                      placeholder="Search courses…" style={{ flex: 1 }} />
                    <span className="muted small">{courseSel.size} selected</span>
                    <button className="ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => setCourseSel(new Set(shown.map((c) => c.published_title)))}
                      title="Select all currently shown">All shown</button>
                    <button className="ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => setCourseSel(new Set())} disabled={!courseSel.size}>Clear</button>
                  </div>
                  <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                    {shown.length === 0 && <div className="muted small" style={{ padding: 6 }}>No matches.</div>}
                    {shown.map((c) => (
                      <label key={c.published_title} title={c.published_title}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={courseSel.has(c.published_title)}
                          onChange={() => toggleCourse(c.published_title)} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && <div className="banner err" style={{ margin: 0 }}>❌ {error}</div>}

              {job && (
                <div className="banner" style={{ margin: 0, borderColor: 'var(--border)' }}>
                  {/* stage stepper */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    {STAGES.map((s, i) => {
                      const active = sIdx === i && !finished;
                      const complete = sIdx > i || job.status === 'done';
                      const err = job.status === 'error';
                      return (
                        <div key={s.key} style={{
                          flex: 1, textAlign: 'center', fontSize: 11, padding: '4px 2px', borderRadius: 6,
                          background: active ? 'rgba(199,155,255,.18)' : 'transparent',
                          color: err ? '#f87171' : complete ? '#4ade80' : active ? '#c79bff' : 'var(--muted, #9aa0ad)',
                          fontWeight: active || complete ? 700 : 500,
                        }}>{complete ? '✓ ' : ''}{s.label}</div>
                      );
                    })}
                  </div>
                  {/* progress bar */}
                  <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,.08)', overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: pct + '%', background: job.status === 'error' ? '#f87171' : '#c79bff', transition: 'width .4s ease' }} />
                  </div>
                  <div className="small" style={{ marginBottom: t ? 4 : 0 }}>
                    {job.status === 'error' ? `❌ ${job.error || 'failed'}` : job.phaseDetail || ''}
                    {job.progress?.total ? <span className="muted"> · {job.progress.done}/{job.progress.total}</span> : null}
                  </div>
                  {t && <div className="muted small">published {t.published} · skipped {t.skipped} · translated {t.translated}{t.failed ? ` · failed ${t.failed}` : ''}</div>}
                  <details style={{ marginTop: 6 }}>
                    <summary className="muted small" style={{ cursor: 'pointer' }}>log</summary>
                    <div className="mono small" style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', opacity: 0.85, marginTop: 4 }}>
                      {(job.log || []).slice(-14).join('\n')}
                    </div>
                  </details>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                {finished ? (
                  <>
                    {hasFailure && (
                      <button onClick={() => submit(false)} disabled={busy || !picked.size || !targets.length}>
                        ↻ Try Again
                      </button>
                    )}
                    <button onClick={closeAll} className={hasFailure ? 'ghost' : ''}>Close</button>
                  </>
                ) : (
                  <button onClick={() => submit(false)} disabled={busy || !picked.size || !targets.length}>
                    {busy ? 'Working…' : `Publish ${picked.size} lang${picked.size === 1 ? '' : 's'} → ${targets.length} course${targets.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
