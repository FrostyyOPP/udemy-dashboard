import { useEffect, useMemo, useState } from 'react';
import CourseDetail from './CourseDetail.jsx';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Domain classification ────────────────────────────────────────────────────
const DOMAIN_RULES = [
  { domain: 'Finance & Capital Markets', keywords: [
    'capital market','financial market','bond market','fixed income','yield curve',
    'interest rate swap','equity swap','credit risk','credit analysis','credit portfolio',
    'commercial credit','mortgage backed','mortgage business','securities trade',
    'professional futures','stock market','equity market','blockchain for finance',
    'financial math','financial modeling','financial modelling','financial model',
    'financial analyst','credit underwriting','accounting to valuation',
    'startup accounting','data to insight: storytelling for finance',
    'análisis y suscripción','análisis de crédito','fundamentos del análisis de crédito',
    'narrativa de datos para inversionistas',
  ]},
  { domain: 'AI / Generative AI', keywords: [
    'generative ai','genai','gen ai','chatgpt','llm','large language model',
    'prompt engineering','rag systems','langchain','ai engineer','ai model engineering',
    'ai for non-technical','ai-powered','ai for entrepreneurs','ai for leaders',
    'ai for hr','ai for marketing','ai for finance','ai for product','ai for legal',
    'ai for healthcare','ai in healthcare','ai video production',
    'autonomous ai','ai strategy','enterprise ai','ai leadership',
    'ai-driven','ai & digital','generative ai in','intelligent',
    'copilot','claude & gemini',
  ]},
  { domain: 'Cybersecurity', keywords: [
    'cybersecurity','cyber security','cyber threat','threat hunting','threat intelligence',
    'penetration testing','ethical hacking','incident response','cyber defense',
    'cyber investigation','forensics','digital forensics','application security',
    'endpoint security','network defense','cloud security','offensive cyber',
    'cyber espionage','counterintelligence','nist','iso cybersecurity',
    'cyber deterrence','cyber effects','cyber risk','soc operations',
    'vulnerability','malware','security operations','security governance',
  ]},
  { domain: 'Healthcare & Life Sciences', keywords: [
    'healthcare','clinical','ehr','electronic health','telemedicine','virtual care',
    'pharmaceutical','health data','digital health','life sciences','medical',
    'clinical decision','patient','nursing','biomedical','hospital',
    'health informatics','health governance','health security',
  ]},
  { domain: 'Data & Analytics', keywords: [
    'data science','machine learning','data analytics','data visualization',
    'power bi','statistics for business','big data','python for data',
    'data storytelling','analytics','data pipeline','data modeling',
    'data insight','master statistics','advanced ai for data',
  ]},
  { domain: 'Cloud & DevOps', keywords: [
    'aws','azure','google cloud','cloud security','devops','devsecops',
    'ansible','infrastructure','kubernetes','docker','ci/cd',
    'cloud operations','cloud protection','cloud immersion',
  ]},
  { domain: 'Business & Leadership', keywords: [
    'leadership','executive','ceo','change management','business transformation',
    'digital transformation','business operations','business strategy','business process',
    'business analysis','iiba','cbap','management','entrepreneurial','strategy for business',
    'ai roadmap for leaders','lead smarter','ai for enterprise',
  ]},
  { domain: 'Sales & Marketing', keywords: [
    'sales','marketing','social media marketing','facebook ads','shopify','dropshipping',
    'seo','customer service','customer journey','relationship management',
    'sales leadership','client & sales','beyond the transaction',
  ]},
  { domain: 'Communication & Writing', keywords: [
    'writing','communication','listening','presentation','storytelling for',
    'business writing','technical writing','data storytelling',
    'global business communication','active listening','narrativa de datos',
    'redacción','escritura','comunicación','escucha activa',
  ]},
  { domain: 'Product Management', keywords: [
    'product management','product innovation','product manager',
    'ai product','product strategy',
  ]},
  { domain: 'HR & People', keywords: [
    'hr management','human resources','talent','people management',
    'emotional intelligence','team dynamics','supervision',
    'from peer to leader','workplace',
  ]},
  { domain: 'Hospitality', keywords: [
    'hotel','hospitality','food & beverage','guest experience',
  ]},
];

function classifyDomain(title = '') {
  const t = title.toLowerCase();
  for (const { domain, keywords } of DOMAIN_RULES) {
    if (keywords.some((kw) => t.includes(kw))) return domain;
  }
  return 'Other';
}

const FINANCE_DOMAINS = new Set(['Finance & Capital Markets']);

// ── Instructor helpers ───────────────────────────────────────────────────────
function instructorInfo(course) {
  const instructors = course.visible_instructors || [];
  const names = instructors.map((i) => i.title || i.name || '');
  const hasPaul = names.some((n) => n.includes('Paul Siegel'));
  const hasGlobecon = names.some((n) => n.includes('Globecon'));
  const sme = names.filter(
    (n) => !n.includes('Starweaver') && !n.includes('Paul Siegel') && !n.includes('Globecon')
  );
  return { hasPaul, hasGlobecon, sme };
}

// ── Formatting ───────────────────────────────────────────────────────────────
const usd = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const COLUMNS = [
  { key: 'title',           label: 'Course',            sortable: true,  str: true },
  { key: 'domain',          label: 'Domain',            sortable: true,  str: true },
  { key: 'num_reviews',     label: 'Total Ratings',     sortable: true,  num: true },
  { key: 'num_subscribers', label: 'Total Enrollments', sortable: true,  num: true },
  { key: 'above2k',         label: 'Enroll > 2k',       sortable: true,  str: true },
  { key: 'rating',          label: 'Avg Rating',        sortable: true,  num: true },
  { key: 'transcript_languages', label: 'Transcripts',  sortable: false },
  { key: 'paul',            label: 'Paul',              sortable: false },
  { key: 'globecon',        label: 'Globecon',          sortable: false },
  { key: 'sme',             label: 'SME',               sortable: false },
];

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [health, setHealth] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'num_reviews', dir: 'desc' });
  const [selected, setSelected] = useState(null);
  const [totalRevenue, setTotalRevenue] = useState(null);
  const [domainFilter, setDomainFilter] = useState('All');

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
      // Exclude drafts right at load time
      setCourses((data.results || []).filter((c) => c.is_published));
      setTotalRevenue(data.total_revenue ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (health?.hasApiKey) loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.hasApiKey]);

  // Enrich published courses with computed fields.
  const enriched = useMemo(() =>
    courses.map((c) => {
      const domain = classifyDomain(c.title);
      const isFinance = FINANCE_DOMAINS.has(domain);
      const { hasPaul, hasGlobecon, sme } = instructorInfo(c);
      const above2k = c.num_subscribers == null ? 'N/A' : c.num_subscribers > 2000 ? 'Yes' : 'No';
      return { ...c, domain, isFinance, hasPaul, hasGlobecon, sme, above2k };
    }),
    [courses]
  );

  const allDomains = useMemo(() => {
    const set = new Set(enriched.map((c) => c.domain));
    return ['All', ...[...set].sort()];
  }, [enriched]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = enriched;
    if (domainFilter !== 'All') rows = rows.filter((c) => c.domain === domainFilter);
    if (q) rows = rows.filter((c) => c.title?.toLowerCase().includes(q));
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    const col = COLUMNS.find((c) => c.key === key);
    return [...rows].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (col?.str) return mul * String(av || '').localeCompare(String(bv || ''));
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return mul * (av - bv);
    });
  }, [enriched, query, sort, domainFilter]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
    );
  }

  function exportCsv() {
    const headers = ['Title','Domain','Total Ratings','Total Enrollments','Enroll > 2k','Avg Rating','Transcripts','Paul','Globecon','SME','URL'];
    const rows = view.map((c) => [
      c.title,
      c.domain,
      c.num_reviews ?? 0,
      c.num_subscribers ?? '',
      c.above2k,
      c.rating ? Number(c.rating).toFixed(2) : '',
      Array.isArray(c.transcript_languages) ? c.transcript_languages.join('; ') : (c.transcript_languages ?? ''),
      c.hasPaul ? 'Yes' : 'No',
      c.isFinance ? (c.hasGlobecon ? 'Yes' : 'No') : 'N/A',
      c.sme?.join('; ') || '',
      c.url ? `https://www.udemy.com${c.url}` : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
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
  const withTranscripts = enriched.filter((c) => Array.isArray(c.transcript_languages) && c.transcript_languages.length > 0).length;
  const avgRating = (() => {
    const rated = courses.filter((c) => c.num_reviews > 0 && c.rating);
    if (!rated.length) return null;
    const w = rated.reduce((s, c) => s + c.rating * c.num_reviews, 0);
    const n = rated.reduce((s, c) => s + c.num_reviews, 0);
    return (w / n).toFixed(2);
  })();
  const withPaul = enriched.filter((c) => c.hasPaul).length;
  const financeWithoutGlobecon = enriched.filter((c) => c.isFinance && !c.hasGlobecon).length;

  return (
    <div className="wrap">
      <header>
        <h1>Udemy Instructor Dashboard</h1>
        <p>Published courses only · ratings, enrollments, transcripts and instructor status — live from the API.</p>
      </header>

      {health && !ready && (
        <div className="banner warn">
          ⚠️ Missing <code>UDEMY_API_KEY</code> in <code>server/.env</code>. Add it and restart the backend.
        </div>
      )}
      {error && <div className="banner err">❌ {error}</div>}

      {courses.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span>{courses.length}</span>published courses</div>
          <div className="kpi"><span>{totalReviews.toLocaleString()}</span>total ratings</div>
          <div className="kpi"><span>{totalStudents ? totalStudents.toLocaleString() : '—'}</span>total enrollments</div>
          <div className="kpi"><span>{avgRating ?? '—'}</span>avg rating ★</div>
          <div className="kpi" title="Courses where transcript scraper has run">
            <span>{withTranscripts > 0 ? withTranscripts : '—'}</span>with transcripts
          </div>
          {totalRevenue != null && (
            <div className="kpi"><span>{usd(totalRevenue)}</span>total revenue</div>
          )}
          <div className="kpi" title="Courses with Paul Siegel active"><span>{withPaul} / {courses.length}</span>Paul on course</div>
          <div className="kpi" title="Finance courses missing Globecon Experts">
            <span style={{ color: financeWithoutGlobecon > 0 ? '#f87171' : 'inherit' }}>{financeWithoutGlobecon}</span>
            finance ∖ Globecon
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search courses…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="domain-select"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          {allDomains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button onClick={loadCourses} disabled={loading || !ready}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="ghost" onClick={exportCsv} disabled={view.length === 0}>
          ⬇ Export CSV
        </button>
        <a href="http://localhost:5055/bookmarklet" target="_blank" rel="noreferrer"
           style={{ fontSize: 13, color: '#c79bff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          📎 Caption Tool
        </a>
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
                {/* Course */}
                <td className="course-title">{c.title}</td>

                {/* Domain */}
                <td><span className={`tag domain-tag domain-${c.domain.split(' ')[0].toLowerCase()}`}>{c.domain}</span></td>

                {/* Total Ratings */}
                <td style={{ textAlign: 'right' }}>{(c.num_reviews ?? 0).toLocaleString()}</td>

                {/* Total Enrollments */}
                <td style={{ textAlign: 'right' }}>
                  {c.num_subscribers != null ? c.num_subscribers.toLocaleString() : <span className="muted">—</span>}
                </td>

                {/* Enroll > 2k */}
                <td style={{ textAlign: 'center' }}>
                  {c.above2k === 'Yes'
                    ? <span className="tag good">Yes</span>
                    : c.above2k === 'No'
                      ? <span className="tag">No</span>
                      : <span className="muted">N/A</span>}
                </td>

                {/* Avg Rating */}
                <td style={{ textAlign: 'right' }}>
                  {c.rating ? Number(c.rating).toFixed(2) : '—'}
                </td>

                {/* Transcripts */}
                <td className="transcript-cell">
                  {Array.isArray(c.transcript_languages) && c.transcript_languages.length > 0
                    ? <span title={c.transcript_languages.join(', ')}>{c.transcript_languages.join(', ')}</span>
                    : c.transcript_languages === null
                      ? <span className="muted">pending</span>
                      : <span className="muted">none</span>}
                </td>

                {/* Paul */}
                <td style={{ textAlign: 'center' }}>
                  {c.hasPaul
                    ? <span className="tag good" title="Active">✓</span>
                    : <span className="tag warn" title="Not on course">✗</span>}
                </td>

                {/* Globecon */}
                <td style={{ textAlign: 'center' }}>
                  {c.isFinance
                    ? c.hasGlobecon
                      ? <span className="tag good" title="Present">✓</span>
                      : <span className="tag err" title="Missing from Finance course">✗</span>
                    : <span className="muted">—</span>}
                </td>

                {/* SME */}
                <td className="sme-cell">
                  {c.sme?.length > 0
                    ? <span title={c.sme.join(', ')}>{c.sme.join(', ')}</span>
                    : <span className="muted">—</span>}
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
