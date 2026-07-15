import { useEffect, useMemo, useRef, useState } from 'react';
import './v2.css';
import CourseDetail from '../CourseDetail.jsx';
import LocalizeCaptions from '../LocalizeCaptions.jsx';
import CreateCoupons from '../CreateCoupons.jsx';
import ConnectUdemy from '../ConnectUdemy.jsx';
import ConnectCoursera from '../ConnectCoursera.jsx';
import ConnectFutureLearn from '../ConnectFutureLearn.jsx';
import ConnectGo1 from '../ConnectGo1.jsx';
import { BarChart, Donut, Histogram, LineChart, ChartPlaceholder } from './charts.jsx';
import { enrich, classifyDomain, DOMAIN_COLOR, capNames, usd, exportCsv, exportMinutesCsv, applyFilter, parseSmartQuery } from './data.js';

const num = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const relTime = (iso) => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60; if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const daysLive = (c) => { const d = c.published_time || c.created; return d ? Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null; };
// monthly: [{month:'2026-06-01', amount:N}, ...] newest-first from the API — take the
// most recent N months, sort chronological, and label each point "Jan '24".
const monthlySeries = (monthly, n = 24) => [...monthly].sort((a, b) => a.month.localeCompare(b.month)).slice(-n)
  .map((m) => ({ label: new Date(m.month).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value: m.amount || 0 }));

// Small hand-rolled stroke icons (no icon library dependency) for the sidebar nav.
const ICONS = {
  overview: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  courses: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  earnings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" /></svg>,
  minutes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>,
  captions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  coupons: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 1 0 0 6" /><path d="M22 9a3 3 0 1 1 0 6" /><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="12" y1="6" x2="12" y2="18" strokeDasharray="2 2" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
};
const NAV = [['overview', 'Overview'], ['courses', 'Courses'], ['earnings', 'Earnings'], ['minutes', 'Minutes'], ['captions', 'Captions'], ['coupons', 'Coupons']];

export default function AppV2() {
  const [raw, setRaw] = useState(null);
  const [coursera, setCoursera] = useState([]);
  const [futurelearn, setFuturelearn] = useState([]);
  const [go1, setGo1] = useState({ courses: [], month: null });
  const [conn, setConn] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [view, setView] = useState('overview');
  const [platform, setPlatform] = useState('all');
  const [selected, setSelected] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [monthly, setMonthly] = useState([]);
  const [engagement, setEngagement] = useState({ totalMinutes: null, activeStudents: null, monthly: [] });

  const load = () => {
    fetch('/api/courses').then((r) => r.json()).then(setRaw).catch(() => setRaw({ results: [] }));
    fetch('/api/connection').then((r) => r.json()).then(setConn).catch(() => {});
    fetch('/api/last-update').then((r) => r.json()).then((d) => setLastUpdate(d.updatedAt)).catch(() => {});
    fetch('/api/coursera/metrics').then((r) => r.json()).then((d) => setCoursera(d.courses || d.results || [])).catch(() => {});
    fetch('/api/revenue/monthly').then((r) => r.json()).then((d) => setMonthly(d.monthly || [])).catch(() => {});
    fetch('/api/futurelearn/courses').then((r) => r.json()).then((d) => setFuturelearn(d.courses || [])).catch(() => {});
    fetch('/api/go1/courses').then((r) => r.json()).then((d) => setGo1({ courses: d.courses || [], month: d.month || null })).catch(() => {});
    fetch('/api/engagement').then((r) => r.json()).then(setEngagement).catch(() => {});
  };
  useEffect(load, []);

  const udemy = useMemo(() => (raw?.results || []).filter((c) => c.is_published).map(enrich), [raw]);
  const totalRevenue = raw?.total_revenue ?? null;

  if (!raw) return <div className="dcx"><div className="center-note">Loading your dashboard…</div></div>;
  const go = (v) => { setView(v); setSideOpen(false); };

  return (
    <div className={'dcx' + (dark ? ' dark' : '')}>
      <div className="dashboard">
        <aside className={'sidebar' + (sideOpen ? ' open' : '')}>
          <div className="logo"><span className="dot" /> Instructor Hub</div>
          <div className="nav-section">
            <div className="nav-label">Main</div>
            {NAV.map(([k, l]) => (
              <div key={k} className={'nav-item' + (view === k ? ' active' : '') + (platform === 'coursera' ? ' p-coursera' : '')} onClick={() => go(k)}>{ICONS[k]}<span>{l}</span></div>
            ))}
          </div>
          <div className="nav-section">
            <div className="nav-label">Tools</div>
            <div className={'nav-item' + (view === 'settings' ? ' active' : '')} onClick={() => go('settings')}>{ICONS.settings}<span>Settings</span></div>
          </div>
          <div className="side-foot">Last updated {relTime(lastUpdate)}</div>
        </aside>

        <main className="main-content">
          <button className="btn btn-secondary menu-btn" style={{ marginBottom: 16 }} onClick={() => setSideOpen((o) => !o)}>☰ Menu</button>
          <div className="platform-tabs">
            {[['all', 'All Platforms'], ['udemy', 'Udemy'], ['coursera', 'Coursera'], ['futurelearn', 'FutureLearn'], ['go1', 'Go1']].map(([k, l]) => (
              <button key={k} className={'ptab' + (platform === k ? ' active' : '') + (k === 'coursera' ? ' p-coursera' : '')} onClick={() => setPlatform(k)}>{l}</button>
            ))}
          </div>
          {view === 'overview' && <Overview udemy={udemy} coursera={coursera} futurelearn={futurelearn} go1={go1.courses} totalRevenue={totalRevenue} platform={platform} monthly={monthly} engagement={engagement} />}
          {view === 'courses' && (
            platform === 'coursera' ? <CourseraView rows={coursera} />
            : platform === 'futurelearn' ? <FutureLearnView rows={futurelearn} />
            : platform === 'go1' ? <Go1View rows={go1.courses} month={go1.month} />
            : <Courses udemy={udemy} totalRevenue={totalRevenue} onOpen={setSelected} onRefresh={load} />
          )}
          {view === 'earnings' && (platform === 'coursera'
            ? <PlatformUnavailable platform={platform} title="Earnings" note="Coursera revenue isn't exposed via the Partner API — earnings tracking is Udemy-only." />
            : platform === 'futurelearn'
            ? <PlatformUnavailable platform={platform} title="Earnings" note="FutureLearn doesn't expose partner revenue — earnings tracking is Udemy-only." />
            : platform === 'go1'
            ? <PlatformUnavailable platform={platform} title="Earnings" note="Your Go1 account doesn't have revenue reporting available yet — earnings tracking is Udemy-only." />
            : <Earnings udemy={udemy} totalRevenue={totalRevenue} monthly={monthly} />)}
          {view === 'minutes' && (platform === 'coursera' || platform === 'futurelearn' || platform === 'go1'
            ? <PlatformUnavailable platform={platform} title="Minutes" note="Minutes-consumed tracking is a Udemy feature — this platform's courses aren't covered here." />
            : <MinutesReport udemy={udemy} />)}
          {view === 'captions' && (platform === 'coursera' || platform === 'futurelearn' || platform === 'go1'
            ? <PlatformUnavailable platform={platform} title="Captions" note="Caption localization is a Udemy feature — this platform's courses aren't covered here." />
            : <Captions udemy={udemy} onRefresh={load} />)}
          {view === 'coupons' && (platform === 'coursera' || platform === 'futurelearn' || platform === 'go1'
            ? <PlatformUnavailable platform={platform} title="Coupons" note="Coupon tracking is a Udemy feature — this platform doesn't have promotional codes tracked here." />
            : <Coupons udemy={udemy} />)}
          {view === 'settings' && <Settings conn={conn} dark={dark} setDark={setDark} lastUpdate={lastUpdate} onRefresh={load} />}
        </main>
      </div>
      {selected && <CourseDetail course={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ---------------- Overview ----------------
const coursraPct = (c) => { const v = c.completionRate; return v == null ? null : (v <= 1 ? v * 100 : v); };

function Overview({ udemy, coursera, futurelearn, go1, totalRevenue, platform, monthly, engagement }) {
  const isUdemy = platform === 'udemy';
  const isCoursera = platform === 'coursera';
  const isFutureLearn = platform === 'futurelearn';
  const isGo1 = platform === 'go1';
  const isAll = platform === 'all';

  const courStats = { count: coursera.length, enroll: coursera.reduce((s, c) => s + (c.enrollments || 0), 0) };
  const flStats = {
    count: futurelearn.length,
    known: futurelearn.filter((c) => c.enrollment != null).length,
    enroll: futurelearn.reduce((s, c) => s + (c.enrollment || 0), 0),
    live: futurelearn.filter((c) => c.status === 'In progress').length,
  };
  const go1Stats = { count: go1.length, enroll: go1.reduce((s, c) => s + (c.enrolments || 0), 0), month: go1[0]?.month ?? null };
  const uEnroll = udemy.reduce((s, c) => s + (c.num_subscribers || 0), 0);
  const reviews = udemy.reduce((s, c) => s + (c.num_reviews || 0), 0);
  const rated = udemy.filter((c) => c.rating);
  const cRated = coursera.filter((c) => c.rating);
  const uAvg = rated.length ? rated.reduce((s, c) => s + Number(c.rating) * (c.num_reviews || 1), 0) / rated.reduce((s, c) => s + (c.num_reviews || 1), 0) : 0;
  const cAvg = cRated.length ? cRated.reduce((s, c) => s + Number(c.rating), 0) / cRated.length : 0;
  const courses = isUdemy ? udemy.length : isCoursera ? courStats.count : isFutureLearn ? flStats.count : isGo1 ? go1Stats.count
    : udemy.length + courStats.count + flStats.count + go1Stats.count;
  const enroll = isUdemy ? uEnroll : isCoursera ? courStats.enroll : isFutureLearn ? flStats.enroll : isGo1 ? go1Stats.enroll
    : uEnroll + courStats.enroll + flStats.enroll; // Go1 is a monthly snapshot, not a lifetime total — excluded from the "all" sum
  const withPaul = udemy.filter((c) => c.hasPaul).length;
  const finGap = udemy.filter((c) => c.isFinance && !c.hasGlobecon).length;
  const ubCount = udemy.filter((c) => c.is_udemy_business).length;
  const minutesWatched = engagement.totalMinutes != null ? Math.round(engagement.totalMinutes) : null;

  const ratingValue = isCoursera ? cAvg : (isFutureLearn || isGo1) ? null : uAvg;
  const ratingTrend = isCoursera ? `across ${cRated.length} rated courses`
    : isFutureLearn ? 'not offered by FutureLearn' : isGo1 ? 'not offered by Go1'
    : isAll ? `Udemy only — based on ${num(reviews)} reviews` : `based on ${num(reviews)} reviews`;
  const revenueValue = (isCoursera || isFutureLearn || isGo1) ? '—' : (totalRevenue == null ? '—' : usd(totalRevenue));
  const revenueTrend = isCoursera ? 'not tracked for Coursera' : isFutureLearn ? 'not exposed to partners' : isGo1 ? 'not yet available' : 'Udemy earnings';

  let charts;
  if (isFutureLearn) {
    const statusCounts = {};
    futurelearn.forEach((c) => { statusCounts[c.status || 'Unknown'] = (statusCounts[c.status || 'Unknown'] || 0) + 1; });
    const statusDonut = Object.entries(statusCounts).map(([label, value]) => ({ label, value, color: label === 'In progress' ? '#0c9bae' : label === 'Draft' ? '#ea7112' : '#002fa7' }));
    const byEnroll = [...futurelearn].filter((c) => c.enrollment > 0).sort((a, b) => b.enrollment - a.enrollment).slice(0, 8)
      .map((c) => ({ label: c.title, value: c.enrollment, color: '#002fa7' }));
    charts = (
      <div className="charts-section">
        <h2 className="section-title">📊 FutureLearn Portfolio</h2>
        <div className="charts-grid">
          <div className="chart-card"><h3>Top Courses by Enrollment (known)</h3>{byEnroll.length ? <BarChart data={byEnroll} /> : <div className="chart-placeholder">No enrollment data yet</div>}</div>
          <div className="chart-card"><h3>Run Status</h3>{statusDonut.length ? <Donut data={statusDonut} /> : <div className="chart-placeholder">No data</div>}</div>
        </div>
      </div>
    );
  } else if (isGo1) {
    const byEnroll = [...go1].filter((c) => c.enrolments > 0).sort((a, b) => b.enrolments - a.enrolments).slice(0, 8)
      .map((c) => ({ label: c.name, value: c.enrolments, color: '#0c9bae' }));
    charts = (
      <div className="charts-section">
        <h2 className="section-title">📊 Go1 Content Studio{go1Stats.month ? ` (${go1Stats.month})` : ''}</h2>
        <div className="chart-card">{byEnroll.length ? <BarChart data={byEnroll} /> : <div className="chart-placeholder">No course-level data yet — Go1's Content Studio dashboard has been unreliable to automate. See the Go1 tab under Courses for status.</div>}</div>
      </div>
    );
  } else if (isCoursera) {
    const byCourse = [...coursera].filter((c) => c.enrollments > 0).sort((a, b) => b.enrollments - a.enrollments).slice(0, 8)
      .map((c) => ({ label: c.name, value: c.enrollments, color: '#0066cc' }));
    const domEnr = {};
    coursera.forEach((c) => { if (c.enrollments > 0) domEnr[c.domain || 'Other'] = (domEnr[c.domain || 'Other'] || 0) + c.enrollments; });
    const donut = Object.entries(domEnr).map(([label, value]) => ({ label, value, color: DOMAIN_COLOR[label] || '#9ca3af' })).sort((a, b) => b.value - a.value).slice(0, 8);
    const buckets = [['< 3.5', 0, 3.5], ['3.5–4', 3.5, 4], ['4–4.5', 4, 4.5], ['4.5–5', 4.5, 5.01]]
      .map(([label, lo, hi]) => ({ label, value: cRated.filter((c) => Number(c.rating) >= lo && Number(c.rating) < hi).length }));
    const compBuckets = [['0–50%', 0, 50], ['50–70%', 50, 70], ['70–85%', 70, 85], ['85–100%', 85, 101]]
      .map(([label, lo, hi]) => { const p = coursraPct; return { label, value: coursera.filter((c) => { const v = p(c); return v != null && v >= lo && v < hi; }).length }; });
    charts = (
      <>
        <div className="charts-section">
          <h2 className="section-title">📊 Enrollment &amp; Completion</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>Enrollments by Course (top 8)</h3>{byCourse.length ? <BarChart data={byCourse} /> : <div className="chart-placeholder">No data</div>}</div>
            <div className="chart-card"><h3>Enrollments by Domain</h3>{donut.length ? <Donut data={donut} /> : <div className="chart-placeholder">No data</div>}</div>
          </div>
        </div>
        <div className="charts-section">
          <h2 className="section-title">🎯 Portfolio Quality</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>Rating Distribution</h3><Histogram data={buckets} color="#0066cc" /></div>
            <div className="chart-card"><h3>Completion Rate Distribution</h3><Histogram data={compBuckets} color="#0066cc" /></div>
          </div>
        </div>
      </>
    );
  } else {
    // Udemy-only, or All — revenue only exists for Udemy either way.
    const byCourse = udemy.filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((c) => ({ label: c.title, value: c.revenue, color: '#002fa7' }));
    const domRev = {};
    udemy.forEach((c) => { if (c.revenue > 0) domRev[c.domain] = (domRev[c.domain] || 0) + c.revenue; });
    const donut = Object.entries(domRev).map(([label, value]) => ({ label, value, color: DOMAIN_COLOR[label] || '#9ca3af' })).sort((a, b) => b.value - a.value).slice(0, 8);

    // "All" merges both platforms' ratings into one distribution; Udemy-only stays Udemy-only.
    const ratedPool = isAll ? [...rated.map((c) => Number(c.rating)), ...cRated.map((c) => Number(c.rating))] : rated.map((c) => Number(c.rating));
    const buckets = [['< 3.0', 0, 3], ['3–3.5', 3, 3.5], ['3.5–4', 3.5, 4], ['4–4.5', 4, 4.5], ['4.5–5', 4.5, 5.01]]
      .map(([label, lo, hi]) => ({ label, value: ratedPool.filter((r) => r >= lo && r < hi).length }));

    const revSeries = monthlySeries(monthly);
    const engSeries = monthlySeries((engagement.monthly || []).map((m) => ({ month: m.month, amount: Math.round(m.minutesTaught || 0) })));
    const byMinutes = udemy.filter((c) => c.minutes_taught > 0).sort((a, b) => b.minutes_taught - a.minutes_taught).slice(0, 8)
      .map((c) => ({ label: c.title, value: Math.round(c.minutes_taught), color: '#0c9bae' }));
    const ubSeries = monthlySeries((engagement.ubMonthly || []).map((m) => ({ month: m.month, amount: Math.round(m.ubMinutes || 0) })));
    const ubByMinutes = udemy.filter((c) => c.is_udemy_business && c.minutes_taught > 0).sort((a, b) => b.minutes_taught - a.minutes_taught).slice(0, 8)
      .map((c) => ({ label: c.title, value: Math.round(c.minutes_taught), color: '#ea7112' }));

    // "All" also gets a cross-platform enrollment chart since revenue can't merge (Coursera has none).
    // Go1 is excluded — its numbers are a monthly snapshot, not comparable to lifetime totals.
    const combinedEnroll = isAll
      ? [...udemy.map((c) => ({ label: c.title, value: c.num_subscribers || 0, color: '#002fa7' })),
         ...coursera.map((c) => ({ label: c.name, value: c.enrollments || 0, color: '#0066cc' })),
         ...futurelearn.map((c) => ({ label: c.title, value: c.enrollment || 0, color: '#ea7112' }))]
          .sort((a, b) => b.value - a.value).slice(0, 8)
      : null;

    charts = (
      <>
        <div className="charts-section">
          <h2 className="section-title">📊 Revenue &amp; Growth{isAll ? ' (Udemy)' : ''}</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>Revenue by Course (top 8)</h3>{byCourse.length ? <BarChart data={byCourse} money /> : <div className="chart-placeholder">No revenue data</div>}</div>
            <div className="chart-card"><h3>Revenue by Domain</h3>{donut.length ? <Donut data={donut} money /> : <div className="chart-placeholder">No revenue data</div>}</div>
          </div>
        </div>
        {combinedEnroll && (
          <div className="charts-section">
            <h2 className="section-title">👥 Enrollments Across Platforms</h2>
            <div className="charts-grid">
              <div className="chart-card" style={{ gridColumn: '1 / -1' }}><h3>Top Courses by Enrollment (Udemy + Coursera + FutureLearn)</h3><BarChart data={combinedEnroll} /></div>
            </div>
          </div>
        )}
        <div className="charts-section">
          <h2 className="section-title">🎧 Engagement{isAll ? ' (Udemy)' : ''}</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>Minutes Watched Over Time (last 12mo)</h3>{engSeries.length ? <LineChart data={engSeries} /> : <ChartPlaceholder>No engagement history yet</ChartPlaceholder>}</div>
            <div className="chart-card"><h3>Top Courses by Minutes Watched</h3>{byMinutes.length ? <BarChart data={byMinutes} /> : <div className="chart-placeholder">No engagement data</div>}</div>
          </div>
        </div>
        <div className="charts-section">
          <h2 className="section-title">🏢 Udemy Business Engagement{isAll ? ' (Udemy)' : ''}</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>UB Minutes Watched Over Time (last 12mo)</h3>{ubSeries.length ? <LineChart data={ubSeries} color="#ea7112" /> : <ChartPlaceholder>No UB engagement history yet</ChartPlaceholder>}</div>
            <div className="chart-card"><h3>Top UB Courses by Minutes Watched</h3>{ubByMinutes.length ? <BarChart data={ubByMinutes} /> : <div className="chart-placeholder">No UB engagement data</div>}</div>
          </div>
        </div>
        <div className="charts-section">
          <h2 className="section-title">🎯 Portfolio Quality{isAll ? ' (Udemy + Coursera)' : ''}</h2>
          <div className="charts-grid">
            <div className="chart-card"><h3>Rating Distribution</h3><Histogram data={buckets} /></div>
            <div className="chart-card"><h3>Revenue Over Time (last 24mo, Udemy)</h3>{revSeries.length ? <LineChart data={revSeries} money /> : <ChartPlaceholder>No revenue history yet</ChartPlaceholder>}</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header crumb="OVERVIEW" title="Dashboard" sub={
        isUdemy ? 'Your Udemy portfolio' : isCoursera ? 'Your Coursera portfolio' : isFutureLearn ? 'Your FutureLearn portfolio'
        : isGo1 ? 'Your Go1 portfolio' : 'Your teaching portfolio at a glance'
      } actions={isUdemy || isAll ? <button className="btn btn-primary" onClick={() => exportCsv(udemy)}>↓ Export CSV</button> : undefined} />
      <div className="kpi-grid">
        <Kpi icon="📚" bg="rgba(0,47,167,.09)" fg="#002fa7" label="Total Courses" value={num(courses)}
          trend={isAll ? `${udemy.length} Udemy · ${courStats.count} Coursera · ${flStats.count} FutureLearn · ${go1Stats.count} Go1`
            : isUdemy ? 'Udemy' : isCoursera ? 'Coursera' : isFutureLearn ? 'FutureLearn' : 'Go1'} />
        <Kpi icon="👥" bg="#cce5ff" fg="#0066cc" label="Total Enrollments" value={num(enroll)}
          trend={isAll ? 'Udemy + Coursera + FutureLearn (Go1 is monthly, not included)' : isFutureLearn ? `known — ${flStats.known}/${flStats.count} courses` : isGo1 ? `this month${go1Stats.month ? ` (${go1Stats.month})` : ''}` : 'across the portfolio'} />
        <Kpi icon="💵" bg="#dcfce7" fg="#10b981" label="Lifetime Revenue" value={revenueValue} trend={revenueTrend} />
        <Kpi icon="⭐" bg="#fef3c7" fg="#f59e0b" label="Average Rating" value={ratingValue ? ratingValue.toFixed(2) : '—'} trend={ratingTrend} />
        {(isUdemy || isAll) && (
          <>
            <Kpi icon="🎧" bg="rgba(12,155,174,.12)" fg="#0c9bae" label="Minutes Watched" value={minutesWatched != null ? num(minutesWatched) : '—'}
              trend={engagement.activeStudents != null ? `${num(engagement.activeStudents)} active students` : 'Udemy'} />
            <Kpi icon="🏢" bg="rgba(234,113,18,.15)" fg="#ea7112" label="Udemy Business" value={num(ubCount)} trend={`${ubCount}/${udemy.length} courses`} />
          </>
        )}
      </div>
      {(isUdemy || isAll) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 30 }}>
          <span className="pill ok">Paul on {withPaul}/{udemy.length} courses</span>
          <span className={'pill ' + (finGap ? 'draft' : 'ok')}>Finance ∖ Globecon: {finGap}</span>
          <span className="pill" style={{ background: '#eef2ff', color: '#4f46e5' }}>{udemy.filter((c) => capNames(c.caption_locales).length > 1).length} courses with 2+ caption languages</span>
        </div>
      )}

      {charts}
    </>
  );
}

const PLATFORM_LABELS = { coursera: 'Coursera', futurelearn: 'FutureLearn', go1: 'Go1' };
function PlatformUnavailable({ title, note, platform }) {
  return (
    <>
      <Header crumb={title.toUpperCase()} title={title} sub={`Not available for ${PLATFORM_LABELS[platform] || platform}`} />
      <div className="chart-card" style={{ maxWidth: 520 }}>
        <p className="muted" style={{ margin: 0 }}>{note}</p>
      </div>
    </>
  );
}

// ---------------- Courses (Udemy, full 12-column parity) ----------------
const COLS = [
  ['title', 'Course', 'str'], ['domain', 'Domain', 'str'], ['num_reviews', 'Total Ratings', 'num'],
  ['num_subscribers', 'Enrollments', 'num'], ['above2k', 'Enroll > 2k', 'str'], ['rating', 'Avg Rating', 'num'],
  ['revenue', 'Revenue', 'num'], ['minutes_taught', 'Minutes Watched', 'num'], ['caption_locales', 'Captions', 'none'], ['coupons', 'Coupons', 'num'],
  ['is_udemy_business', 'Udemy Business', 'none'], ['hasPaul', 'Paul', 'none'], ['hasGlobecon', 'Globecon', 'none'], ['sme', 'SME', 'none'],
];
function Courses({ udemy, totalRevenue, onOpen, onRefresh }) {
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('All');
  const [sort, setSort] = useState({ key: 'num_reviews', dir: -1 });
  const domains = useMemo(() => ['All', ...[...new Set(udemy.map((c) => c.domain))].sort()], [udemy]);
  const searchSpec = useMemo(() => parseSmartQuery(q), [q]);
  const clearSearch = () => setQ('');

  const rows = useMemo(() => {
    let r = udemy;
    if (domain !== 'All') r = r.filter((c) => c.domain === domain);
    r = applyFilter(r, searchSpec);
    const col = COLS.find((c) => c[0] === sort.key);
    return [...r].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (col?.[2] === 'str') return sort.dir * String(av || '').localeCompare(String(bv || ''));
      if (Array.isArray(av)) av = av.length; if (Array.isArray(bv)) bv = bv.length;
      return sort.dir * ((Number(av) || 0) - (Number(bv) || 0));
    });
  }, [udemy, searchSpec, domain, sort]);
  const th = ([key, label, type]) => (
    <th key={key} className={type === 'none' ? 'no-sort' : ''} onClick={() => type !== 'none' && setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
      {label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  );
  return (
    <>
      <Header crumb="COURSES · UDEMY" title="Courses" sub="All Udemy courses — search, filter, sort, export"
        actions={<>
          <button className="btn btn-secondary" onClick={onRefresh}>↻ Refresh</button>
          <button className="btn btn-secondary" onClick={() => exportCsv(rows)}>⬇ Export CSV</button>
          <CreateCoupons courses={udemy} onDone={onRefresh} />
          <LocalizeCaptions courses={udemy} onDone={onRefresh} />
        </>} />
      <div className="table-card">
        <div className="table-header">
          <input
            className="table-search"
            placeholder="Search, or try 'rating below 4.3' or 'no coupons'"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') clearSearch(); }}
          />
          <select value={domain} onChange={(e) => setDomain(e.target.value)} style={{ width: 'auto', minWidth: 180 }}>{domains.map((d) => <option key={d}>{d}</option>)}</select>
          <span className="muted">{rows.length} shown</span>
        </div>
        {searchSpec?.conditions.some((c) => c.field !== 'title') && (
          <div className="table-header" style={{ paddingTop: 0, gap: 8 }}>
            <span className="pill" style={{ background: '#eef2ff', color: '#4f46e5' }}>
              ✨ {searchSpec.explanation} <span onClick={clearSearch} style={{ cursor: 'pointer', marginLeft: 6, fontWeight: 700 }}>✕</span>
            </span>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="click" onClick={() => onOpen(c)}>
                  <td style={{ fontWeight: 500, minWidth: 200 }}>{c.title}</td>
                  <td><span className="platform-badge" style={{ background: (DOMAIN_COLOR[c.domain] || '#9ca3af') + '22', color: DOMAIN_COLOR[c.domain] || '#6b7280' }}>{c.domain}</span></td>
                  <td style={{ textAlign: 'right' }}>{num(c.num_reviews) === '—' ? 0 : num(c.num_reviews)}</td>
                  <td style={{ textAlign: 'right' }}>{c.num_subscribers != null ? num(c.num_subscribers) : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{c.above2k === 'Yes' ? <span className="pill ok">Yes</span> : c.above2k === 'No' ? <span className="pill draft">No</span> : <span className="muted">N/A</span>}</td>
                  <td style={{ textAlign: 'right' }}>{c.rating ? <span className="rating-stars">★ {Number(c.rating).toFixed(2)}</span> : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: c.revenue ? '#10b981' : '#9ca3af' }}>{c.revenue ? usd(c.revenue) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{c.minutes_taught ? num(Math.round(c.minutes_taught)) : <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 13 }} title={capNames(c.caption_locales).join(', ')}>{capNames(c.caption_locales).slice(0, 3).join(', ') || '—'}{capNames(c.caption_locales).length > 3 ? ` +${capNames(c.caption_locales).length - 3}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>{Array.isArray(c.coupons) ? (c.coupons.length || '0') : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{c.is_udemy_business ? <span title="Udemy Business" style={{ color: '#ea7112' }}>✓</span> : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{c.hasPaul ? <span title="Active" style={{ color: '#10b981' }}>✓</span> : <span title="Not on course" style={{ color: '#f59e0b' }}>✗</span>}</td>
                  <td style={{ textAlign: 'center' }}>{c.isFinance ? (c.hasGlobecon ? <span style={{ color: '#10b981' }}>✓</span> : <span title="Missing" style={{ color: '#ef4444' }}>✗</span>) : <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={(c.sme || []).join(', ')}>{(c.sme || []).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------- Coursera (native, full metrics parity) ----------------
function CourseraView({ rows }) {
  const [sort, setSort] = useState({ key: 'enrollments', dir: -1 });
  const pct = (r) => (r == null ? '—' : (r <= 1 ? Math.round(r * 100) : Math.round(r)) + '%');
  const data = useMemo(() => [...rows].sort((a, b) => sort.dir * ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0))), [rows, sort]);
  if (!rows.length) return (<><Header crumb="COURSES · COURSERA" title="Coursera" sub="Partner course metrics" /><div className="table-card"><div style={{ padding: 24 }} className="muted">No Coursera metrics cached. Reconnect Coursera in Settings, then run the metrics scrape.</div></div></>);
  const totE = rows.reduce((s, c) => s + (c.enrollments || 0), 0);
  const totC = rows.reduce((s, c) => s + (c.completions || 0), 0);
  const rated = rows.filter((c) => c.rating);
  const avgR = rated.length ? rated.reduce((s, c) => s + Number(c.rating), 0) / rated.length : 0;
  const th = (key, label) => <th key={key} style={{ textAlign: 'right' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <>
      <Header crumb="COURSES · COURSERA" title="Coursera" sub="Partner course metrics (org-level revenue, so no per-course revenue)" />
      <div className="kpi-grid">
        <Kpi icon="📚" bg="#cce5ff" fg="#0066cc" label="Courses" value={num(rows.length)} />
        <Kpi icon="👥" bg="#cce5ff" fg="#0066cc" label="Enrollments" value={num(totE)} />
        <Kpi icon="🎓" bg="#dcfce7" fg="#10b981" label="Completions" value={num(totC)} trend={`${Math.round((totC / (totE || 1)) * 100)}% overall`} />
        <Kpi icon="⭐" bg="#fef3c7" fg="#f59e0b" label="Avg Rating" value={avgR ? avgR.toFixed(2) : '—'} />
      </div>
      <div className="table-card"><div className="table-scroll"><table>
        <thead><tr><th className="no-sort">Course</th><th className="no-sort">Domain</th>{th('enrollments', 'Enrollments')}{th('completions', 'Completions')}{th('completionRate', 'Compl. Rate')}{th('rating', 'Rating')}<th className="no-sort">Instructor</th></tr></thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{c.name}</td>
              <td className="muted" style={{ fontSize: 13 }}>{c.domain || '—'}</td>
              <td style={{ textAlign: 'right' }}>{num(c.enrollments)}</td>
              <td style={{ textAlign: 'right' }}>{num(c.completions)}</td>
              <td style={{ textAlign: 'right' }}>{pct(c.completionRate)}</td>
              <td style={{ textAlign: 'right' }}>{c.rating ? <span className="rating-stars">★ {Number(c.rating).toFixed(2)}</span> : '—'}</td>
              <td style={{ textAlign: 'center' }}>{c.hasStarweaverInstructor ? <span title="instructors@starweaver.com is an Instructor" style={{ color: '#10b981' }}>✓</span> : <span title="instructors@starweaver.com not found as Instructor" style={{ color: '#ef4444' }}>✗</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}

// ---------------- FutureLearn (native: course list + status + enrollment) ----------------
function FutureLearnView({ rows }) {
  const [sort, setSort] = useState({ key: 'enrollment', dir: -1 });
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((c) => (c.title || '').toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const data = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (sort.key === 'title' || sort.key === 'category' || sort.key === 'status') return sort.dir * String(av || '').localeCompare(String(bv || ''));
    return sort.dir * ((Number(av) || 0) - (Number(bv) || 0));
  }), [filtered, sort]);
  if (!rows.length) return (<><Header crumb="COURSES · FUTURELEARN" title="FutureLearn" sub="Course list + status" /><div className="table-card"><div style={{ padding: 24 }} className="muted">No FutureLearn courses cached. Connect FutureLearn in Settings, then run <code>npm run futurelearn:courses</code>.</div></div></>);
  const totalEnroll = rows.reduce((s, c) => s + (c.enrollment || 0), 0);
  const live = rows.filter((c) => c.status === 'In progress').length;
  const th = (key, label) => <th key={key} style={{ textAlign: 'right' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <>
      <Header crumb="COURSES · FUTURELEARN" title="FutureLearn" sub="Course list, run status, and public enrollment counts (no partner API, no ratings exposed)" />
      <div className="kpi-grid">
        <Kpi icon="📚" bg="#cce5ff" fg="#0066cc" label="Courses" value={num(rows.length)} />
        <Kpi icon="🟢" bg="#dcfce7" fg="#10b981" label="Live runs" value={num(live)} />
        <Kpi icon="👥" bg="#cce5ff" fg="#0066cc" label="Enrollments (known)" value={num(totalEnroll)} />
      </div>
      <div className="table-card">
        <div className="table-header">
          <input className="table-search" placeholder="Search courses…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted">{data.length} shown</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th className="no-sort">Course</th><th className="no-sort">Code</th><th className="no-sort">Category</th>{th('status', 'Status')}<th className="no-sort">Start date</th>{th('wishlistCount', 'Wishlist')}{th('enrollment', 'Enrollment')}</tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.slug}>
                <td style={{ fontWeight: 500, minWidth: 200 }}>{c.title}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.code || '—'}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.category || '—'}</td>
                <td>{c.status || '—'}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.startDate || '—'}</td>
                <td style={{ textAlign: 'right' }}>{num(c.wishlistCount)}</td>
                <td style={{ textAlign: 'right' }}>{c.enrollment != null ? num(c.enrollment) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Go1 (native: monthly course-level consumption) ----------------
function Go1View({ rows, month }) {
  const [sort, setSort] = useState({ key: 'enrolments', dir: -1 });
  const data = useMemo(() => [...rows].sort((a, b) => sort.dir * ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0))), [rows, sort]);
  if (!rows.length) return (
    <>
      <Header crumb="COURSES · GO1" title="Go1" sub="Content Studio — course-level consumption" />
      <div className="table-card"><div style={{ padding: 24 }} className="muted">
        No Go1 course data cached yet. Connect Go1 in Settings — course-level scraping is still being finalized (Go1's Content Studio dashboard has proven flaky to automate); Overview KPIs (Total Users, Minutes of Learning) are available sooner than the per-course breakdown.
      </div></div>
    </>
  );
  const totE = rows.reduce((s, c) => s + (c.enrolments || 0), 0);
  const totC = rows.reduce((s, c) => s + (c.completions || 0), 0);
  const th = (key, label) => <th key={key} style={{ textAlign: 'right' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <>
      <Header crumb="COURSES · GO1" title="Go1" sub={`Content Studio — course-level consumption${month ? ` (${month})` : ''}. Monthly snapshot, not a lifetime total.`} />
      <div className="kpi-grid">
        <Kpi icon="📚" bg="#cce5ff" fg="#0066cc" label="Courses" value={num(rows.length)} />
        <Kpi icon="👥" bg="#cce5ff" fg="#0066cc" label="Enrolments (month)" value={num(totE)} />
        <Kpi icon="🎓" bg="#dcfce7" fg="#10b981" label="Completions (month)" value={num(totC)} />
      </div>
      <div className="table-card"><div className="table-scroll"><table>
        <thead><tr><th className="no-sort">Course</th>{th('enrolments', 'Enrolments')}{th('completions', 'Completions')}{th('totalMinutes', 'Total minutes')}{th('avgSessionMinutes', 'Avg session')}</tr></thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{c.name}</td>
              <td style={{ textAlign: 'right' }}>{num(c.enrolments)}</td>
              <td style={{ textAlign: 'right' }}>{num(c.completions)}</td>
              <td style={{ textAlign: 'right' }}>{num(c.totalMinutes)}</td>
              <td style={{ textAlign: 'right' }}>{num(c.avgSessionMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}

// ---------------- Earnings (native, parity: Days Live + $/day + best) ----------------
function Earnings({ udemy, totalRevenue, monthly }) {
  const earning = udemy.filter((c) => c.revenue > 0);
  const revSeries = monthlySeries(monthly);
  const [sort, setSort] = useState({ key: 'revenue', dir: -1 });
  const withDerived = earning.map((c) => { const d = daysLive(c); return { ...c, _days: d, _perDay: d ? c.revenue / d : 0 }; });
  const rows = useMemo(() => [...withDerived].sort((a, b) => sort.dir * ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0))), [withDerived, sort]);
  const top = rows[0];
  const perDayChart = [...withDerived].sort((a, b) => b._perDay - a._perDay).slice(0, 8).map((c) => ({ label: c.title, value: c._perDay, color: '#0066cc' }));
  const th = (key, label) => <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <>
      <Header crumb="EARNINGS" title="Earnings" sub="Published-course revenue, days live, and $/day" actions={<button className="btn btn-secondary" onClick={() => exportCsv(udemy)}>⬇ Export CSV</button>} />
      <div className="kpi-grid">
        <Kpi label="Lifetime Revenue" value={usd(totalRevenue)} fg="#10b981" trend="all-time Udemy" />
        <Kpi label="Top Course" value={(top?.title || '—').slice(0, 22)} big={false} trend={usd(top?.revenue)} />
        <Kpi label="Courses Earning" value={num(earning.length)} trend={`of ${udemy.length} total`} />
        <Kpi label="Best $/Day" value={usd(top ? [...withDerived].sort((a, b) => b._perDay - a._perDay)[0]?._perDay : null)} trend="top earner per day" />
      </div>
      <div className="charts-section">
        <div className="charts-grid">
          <div className="chart-card"><h3>$ / Day (top earners per day live)</h3>{perDayChart.length ? <BarChart data={perDayChart} money /> : <div className="chart-placeholder">No data</div>}</div>
          <div className="chart-card"><h3>Revenue Over Time (last 24mo)</h3>{revSeries.length ? <LineChart data={revSeries} money /> : <ChartPlaceholder>No revenue history yet</ChartPlaceholder>}</div>
        </div>
      </div>
      <div className="table-card">
        <div className="table-header"><b>Earnings by Course (published)</b><span className="muted">{rows.length} earning</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th className="no-sort">Course</th><th className="no-sort">Published</th>{th('_days', 'Days Live')}{th('revenue', 'Total Earning')}{th('_perDay', '$/Day')}</tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.title}</td>
                <td className="muted">{(c.published_time || c.created) ? new Date(c.published_time || c.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{c._days ? num(c._days) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{usd(c.revenue)}</td>
                <td style={{ textAlign: 'right' }}>{c._perDay ? '$' + c._perDay.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Minutes Report (mins consumed per course, last 3 months) ----------------
const monthLabel = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
function MinutesReport({ udemy }) {
  const rows = useMemo(() => udemy.filter((c) => c.recent_months), [udemy]);
  const labels = rows[0]?.recent_months?.map((m) => monthLabel(m.month)) || ['This Month', 'Last Month', '2 Months Ago'];
  const [sort, setSort] = useState({ key: 'm0', dir: -1 });
  const withDerived = rows.map((c) => ({
    ...c,
    m0: c.recent_months?.[0]?.minutes ?? null,
    m1: c.recent_months?.[1]?.minutes ?? null,
    m2: c.recent_months?.[2]?.minutes ?? null,
  }));
  const sorted = useMemo(() => [...withDerived].sort((a, b) => sort.dir * ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0))), [withDerived, sort]);
  const th = (key, label) => <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <>
      <Header crumb="MINUTES" title="Minutes Consumed" sub="Learner minutes watched per course, by month" actions={<button className="btn btn-secondary" onClick={() => exportMinutesCsv(sorted)}>⬇ Export CSV</button>} />
      <div className="table-card">
        <div className="table-header"><b>Minutes Consumed by Course</b><span className="muted">{rows.length} courses</span></div>
        <div className="table-scroll"><table>
          <thead><tr>
            <th className="no-sort">Course</th>
            <th className="no-sort">Live Date</th>
            {th('m0', labels[0])}
            {th('m1', labels[1])}
            {th('m2', labels[2])}
          </tr></thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.title}</td>
                <td className="muted">{(c.published_time || c.created) ? new Date(c.published_time || c.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{c.m0 != null ? num(Math.round(c.m0)) : <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'right' }}>{c.m1 != null ? num(Math.round(c.m1)) : <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'right' }}>{c.m2 != null ? num(Math.round(c.m2)) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Captions ----------------
const COVER_COLS = [['en', 'EN'], ['es', 'ES'], ['fr', 'FR'], ['de', 'DE'], ['pt', 'PT'], ['it', 'IT'], ['ar', 'AR']];
const LANG_MATCH = [['en', /english/i], ['es', /spanish/i], ['fr', /french/i], ['de', /german/i], ['pt', /portuguese/i], ['it', /italian/i], ['ar', /arabic/i]];
const langCodes = (locales = []) => { const set = new Set(); for (const l of capNames(locales)) for (const [c, re] of LANG_MATCH) if (re.test(l)) set.add(c); return set; };
// Captions come from a once-a-day scrape (caption-cache.json), not a live Udemy
// lookup — this re-runs that scrape on demand so a caption added directly on
// Udemy shows up right away instead of waiting for the next 7am refresh.
function RefreshCaptionsButton({ onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function start() {
    clearInterval(pollRef.current);
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/captions/refresh-cache', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      pollRef.current = setInterval(async () => {
        const r = await fetch('/api/captions/refresh-cache');
        const d = await r.json();
        if (!d.running) {
          clearInterval(pollRef.current); setBusy(false);
          setMsg(d.ok === false ? `Failed: ${d.error || 'unknown error'}` : 'Captions refreshed ✓');
          if (d.ok !== false) onRefresh?.();
        }
      }, 1500);
    } catch (e) { setBusy(false); setMsg(`Failed: ${e.message}`); }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {msg && <span className="muted small" style={{ fontSize: 12 }}>{msg}</span>}
      <button className="btn btn-secondary" onClick={start} disabled={busy}>{busy ? '↻ Refreshing…' : '↻ Refresh Captions'}</button>
    </span>
  );
}

function Captions({ udemy, onRefresh }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => { const s = q.trim().toLowerCase(); return s ? udemy.filter((c) => (c.title || '').toLowerCase().includes(s)) : udemy; }, [udemy, q]);
  const matrix = rows.slice(0, 40);
  return (
    <>
      <Header crumb="CAPTIONS" title="Captions & Localization" sub="Subtitle coverage and localization status" actions={<><RefreshCaptionsButton onRefresh={onRefresh} /><LocalizeCaptions courses={udemy} onDone={onRefresh} /></>} />
      <div className="chart-card" style={{ marginBottom: 22, overflowX: 'auto' }}>
        <h3>Coverage Matrix <span className="muted" style={{ fontWeight: 400 }}>(first {matrix.length} courses)</span></h3>
        <table style={{ minWidth: 520 }}>
          <thead><tr><th className="no-sort">Course</th>{COVER_COLS.map(([, l]) => <th key={l} className="no-sort" style={{ textAlign: 'center' }}>{l}</th>)}</tr></thead>
          <tbody>
            {matrix.map((c) => { const have = langCodes(c.caption_locales); return (
              <tr key={c.id}>
                <td style={{ fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</td>
                {COVER_COLS.map(([code]) => <td key={code} style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, background: have.has(code) ? '#10b981' : '#e5e7eb' }} /></td>)}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
      <div className="table-card">
        <div className="table-header"><input className="table-search" placeholder="Search courses…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted">{rows.length} courses</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th className="no-sort">Course</th><th className="no-sort">Languages</th><th className="no-sort">Coverage</th><th className="no-sort">Action</th></tr></thead>
          <tbody>
            {rows.slice(0, 60).map((c) => {
              const have = langCodes(c.caption_locales);
              const pct = Math.round((COVER_COLS.filter(([code]) => have.has(code)).length / COVER_COLS.length) * 100);
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.title}</td>
                  <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{capNames(c.caption_locales).slice(0, 4).map((l, i) => <span key={i} className="lang-chip">{l}</span>)}{capNames(c.caption_locales).length > 4 && <span className="lang-chip">+{capNames(c.caption_locales).length - 4}</span>}</div></td>
                  <td><span className="cov-track"><span className="cov-fill" style={{ width: pct + '%' }} /></span> <span style={{ fontSize: 13 }}>{pct}%</span></td>
                  <td><LocalizeCaptions courses={[c]} single onDone={onRefresh} /></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Coupons ----------------
// discount_value is the coupon's resulting PRICE in dollars (not a percent) —
// is_free is true exactly when that price is $0 (see couponCreate.js / scrapeCoupons.js).
function Coupons({ udemy }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const list = [];
    udemy.forEach((c) => (c.coupons || []).forEach((cp) => list.push({ ...cp, course: c.title, courseId: c.id, courseUrl: c.url })));
    return list;
  }, [udemy]);
  const active = useMemo(() => rows.filter((r) => r.active), [rows]);
  const totalUsed = active.reduce((s, r) => s + (r.used || 0), 0);
  const totalRemaining = active.reduce((s, r) => s + Math.max(0, (r.max_uses || 0) - (r.used || 0)), 0);
  // Udemy's documented rule this app works within: ~1 free coupon per course per
  // month — so "room to create more" = published courses with no active free coupon.
  const coursesWithActiveFree = new Set(udemy.filter((c) => (c.coupons || []).some((cp) => cp.active && cp.is_free)).map((c) => c.id));
  const headroom = udemy.length - coursesWithActiveFree.size;
  const activeCourseCount = new Set(active.map((r) => r.courseId)).size;
  // Flag courses stacking more than one active coupon at once (worth a second look —
  // could mean two promos are competing for the same enrollment).
  const activeCountByCourse = useMemo(() => {
    const m = new Map();
    active.forEach((r) => m.set(r.courseId, (m.get(r.courseId) || 0) + 1));
    return m;
  }, [active]);
  const stackedCourses = [...activeCountByCourse.entries()].filter(([, n]) => n > 1);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? active.filter((r) => r.course.toLowerCase().includes(s) || (r.code || '').toLowerCase().includes(s)) : active;
  }, [active, q]);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

  return (
    <>
      <Header crumb="COUPONS" title="Coupons" sub="Active promotional codes across your Udemy courses" />
      <div className="kpi-grid">
        <Kpi icon="🎟️" bg="#eef2ff" fg="#4f46e5" label="Active Coupons" value={num(active.length)} trend={`across ${activeCourseCount} course${activeCourseCount === 1 ? '' : 's'}`} />
        <Kpi icon="👥" bg="#cce5ff" fg="#0066cc" label="Learners Used" value={num(totalUsed)} trend="redemptions so far" />
        <Kpi icon="🎯" bg="#dcfce7" fg="#10b981" label="Enrollment Slots Left" value={num(totalRemaining)} trend="before active coupons cap out" />
        <Kpi icon="➕" bg="#fef3c7" fg="#f59e0b" label="Coupon Creation Headroom" value={num(headroom)} trend="courses without an active free coupon (Udemy: ~1/course/month)" />
      </div>
      {stackedCourses.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 22 }}>
          ⚠️ {stackedCourses.length} course{stackedCourses.length === 1 ? '' : 's'} currently {stackedCourses.length === 1 ? 'has' : 'have'} more than one active coupon at once — two promos competing for the same enrollment:{' '}
          {stackedCourses.map(([cid], i) => {
            const codes = active.filter((r) => r.courseId === cid).map((r) => r.code).join(' + ');
            const name = active.find((r) => r.courseId === cid)?.course;
            return <span key={cid}>{i > 0 ? ', ' : ''}<b>{name}</b> ({codes})</span>;
          })}
        </div>
      )}
      <div className="table-card">
        <div className="table-header">
          <input className="table-search" placeholder="Search course or code…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted">{shown.length} active coupon{shown.length === 1 ? '' : 's'}</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th className="no-sort">Course</th><th className="no-sort">Code</th><th className="no-sort">Type</th><th className="no-sort">Used / Max</th><th className="no-sort">Remaining</th><th className="no-sort">Expires</th><th className="no-sort">Link</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No active coupons right now.</td></tr>}
            {shown.map((r, i) => {
              const remaining = Math.max(0, (r.max_uses || 0) - (r.used || 0));
              const pct = r.max_uses ? Math.round(((r.used || 0) / r.max_uses) * 100) : 0;
              const stacked = (activeCountByCourse.get(r.courseId) || 0) > 1;
              const link = r.courseUrl ? `https://www.udemy.com${r.courseUrl}?couponCode=${encodeURIComponent(r.code)}` : null;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.course}{stacked && <span className="pill draft" style={{ marginLeft: 6, fontSize: 11 }}>×{activeCountByCourse.get(r.courseId)} active</span>}
                  </td>
                  <td className="mono">{r.code}</td>
                  <td><span className={'pill ' + (r.is_free ? 'ok' : 'draft')}>{r.is_free ? 'Free enrollment' : `$${r.discount_value} price`}</span></td>
                  <td>{r.used || 0}/{r.max_uses || 0} <span className="cov-track" style={{ marginLeft: 6 }}><span className="cov-fill" style={{ width: pct + '%' }} /></span></td>
                  <td>{remaining}</td>
                  <td className="muted">{fmtDate(r.end)}</td>
                  <td>{link ? <a href={link} target="_blank" rel="noreferrer">Open ↗</a> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Settings (connect flows + theme + refresh) ----------------
function Settings({ conn, dark, setDark, lastUpdate, onRefresh }) {
  const connected = conn?.connected;
  return (
    <>
      <Header crumb="SETTINGS" title="Settings" sub="Connections, appearance, and data" actions={<button className="btn btn-secondary" onClick={onRefresh}>↻ Refresh data</button>} />
      <div className="table-card" style={{ maxWidth: 680 }}>
        <div style={{ padding: 24 }}>
          <div className="setting">
            <label>Udemy connection</label>
            <div className={connected ? 'status-ok' : 'status-bad'} style={{ marginBottom: 10 }}>{connected ? '✓ Connected — session active' : '✕ Not connected'}</div>
            <ConnectUdemy onConnected={onRefresh} />
          </div>
          <div className="setting">
            <label>Coursera connection</label>
            <ConnectCoursera onConnected={onRefresh} />
          </div>
          <div className="setting">
            <label>FutureLearn connection</label>
            <ConnectFutureLearn onConnected={onRefresh} />
          </div>
          <div className="setting">
            <label>Go1 connection</label>
            <ConnectGo1 onConnected={onRefresh} />
          </div>
          <div className="setting">
            <label>Data feeds</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{['enrollment', 'revenue', 'captions'].map((k) => <span key={k} className={'pill ' + (conn?.data?.[k] ? 'ok' : 'draft')}>{k} {conn?.data?.[k] ? '✓' : '—'}</span>)}</div>
          </div>
          <div className="setting">
            <label>Theme</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-secondary" style={{ flex: 1, outline: dark ? 'none' : '2px solid #002fa7' }} onClick={() => setDark(false)}>☀️ Light</button>
              <button className="btn btn-secondary" style={{ flex: 1, outline: dark ? '2px solid #002fa7' : 'none' }} onClick={() => setDark(true)}>🌙 Dark</button>
            </div>
          </div>
          <div className="setting"><label>Last data refresh</label><div className="muted">{relTime(lastUpdate)} — updates run daily</div></div>
        </div>
      </div>
    </>
  );
}

// ---------------- shared ----------------
function Header({ title, sub, actions, crumb }) {
  return (<div className="page-header"><div>{crumb && <div className="page-crumb">{crumb}</div>}<h1 className="page-title">{title}</h1><p className="page-subtitle">{sub}</p></div>{actions && <div className="header-actions">{actions}</div>}</div>);
}
function Kpi({ icon, bg, fg, label, value, trend, big = true }) {
  return (<div className="kpi-card">{icon && <div className="kpi-icon" style={{ background: bg, color: fg }}>{icon}</div>}<div className="kpi-label">{label}</div><div className="kpi-value" style={{ color: fg && !icon ? fg : undefined, fontSize: big ? undefined : 18 }}>{value}</div>{trend && <div className="kpi-trend">{trend}</div>}</div>);
}
