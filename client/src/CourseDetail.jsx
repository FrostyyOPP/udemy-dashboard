import { useEffect, useState } from 'react';

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
    'ai-driven','ai & digital','generative ai in','copilot','claude & gemini',
  ]},
  { domain: 'Cybersecurity', keywords: [
    'cybersecurity','cyber security','cyber threat','threat hunting','threat intelligence',
    'penetration testing','ethical hacking','incident response','cyber defense',
    'cyber investigation','forensics','digital forensics','application security',
    'endpoint security','network defense','cloud security','offensive cyber',
    'cyber espionage','counterintelligence','nist','iso cybersecurity',
    'cyber deterrence','cyber effects','cyber risk','soc operations',
  ]},
  { domain: 'Healthcare & Life Sciences', keywords: [
    'healthcare','clinical','ehr','electronic health','telemedicine','virtual care',
    'pharmaceutical','health data','digital health','life sciences','medical',
    'clinical decision','health informatics','health governance','health security',
  ]},
  { domain: 'Data & Analytics', keywords: [
    'data science','machine learning','data analytics','data visualization',
    'power bi','statistics for business','big data','python for data',
    'data storytelling','analytics','data pipeline','master statistics','advanced ai for data',
  ]},
  { domain: 'Cloud & DevOps', keywords: [
    'aws','azure','google cloud','devops','devsecops','ansible','cloud operations',
    'cloud protection','cloud immersion','cloud security',
  ]},
  { domain: 'Business & Leadership', keywords: [
    'leadership','executive','ceo','change management','business transformation',
    'digital transformation','business operations','business strategy','business process',
    'business analysis','iiba','cbap','management','entrepreneurial',
  ]},
  { domain: 'Sales & Marketing', keywords: [
    'sales','marketing','social media marketing','facebook ads','shopify',
    'seo','customer service','customer journey','relationship management',
  ]},
  { domain: 'Communication & Writing', keywords: [
    'writing','communication','listening','presentation','storytelling for',
    'business writing','technical writing','active listening','narrativa de datos',
    'redacción','escritura','comunicación','escucha activa',
  ]},
  { domain: 'Product Management', keywords: ['product management','product innovation','product manager'] },
  { domain: 'HR & People', keywords: ['hr management','human resources','emotional intelligence','team dynamics','supervision','from peer to leader','workplace'] },
  { domain: 'Hospitality', keywords: ['hotel','hospitality','food & beverage','guest experience'] },
];

function classifyDomain(title = '') {
  const t = title.toLowerCase();
  for (const { domain, keywords } of DOMAIN_RULES) {
    if (keywords.some((kw) => t.includes(kw))) return domain;
  }
  return 'Other';
}

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

export default function CourseDetail({ course, onClose }) {
  const [tab, setTab] = useState('instructors');
  const [reviews, setReviews] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);

  const domain = classifyDomain(course.title);
  const isFinance = domain === 'Finance & Capital Markets';
  const { hasPaul, hasGlobecon, sme } = instructorInfo(course);
  const transcripts = course.transcript_languages;
  const hasTranscripts = Array.isArray(transcripts) && transcripts.length > 0;

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
            <div className="muted" style={{ marginTop: 4 }}>
              <span className="tag" style={{ marginRight: 6 }}>{domain}</span>
              {course.rating ? Number(course.rating).toFixed(2) : '—'} ★ ·{' '}
              {(course.num_reviews ?? 0).toLocaleString()} ratings
              {course.num_subscribers != null && (
                <> · {course.num_subscribers.toLocaleString()} enrolled</>
              )}
              {course.url && (
                <> · <a href={`https://www.udemy.com${course.url}`} target="_blank" rel="noreferrer">open ↗</a></>
              )}
            </div>
          </div>
          <button className="close" onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          <button className={tab === 'instructors' ? 'active' : ''} onClick={() => setTab('instructors')}>Instructors</button>
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
          {tab === 'instructors' && (
            <div className="instructor-panel">

              <div className="info-grid">
                <div className="info-row">
                  <span className="info-label">Domain</span>
                  <span className="tag">{domain}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Total Ratings</span>
                  <strong>{(course.num_reviews ?? 0).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span className="info-label">Total Enrollments</span>
                  <strong>
                    {course.num_subscribers != null
                      ? course.num_subscribers.toLocaleString()
                      : <span className="muted">— scraping pending</span>}
                  </strong>
                </div>
                <div className="info-row">
                  <span className="info-label">Avg Rating</span>
                  <strong>{course.rating ? `${Number(course.rating).toFixed(2)} ★` : '—'}</strong>
                </div>
              </div>

              <div className="section-divider">Transcripts / Captions</div>
              <div className="info-row">
                <span className="info-label">Languages</span>
                <span>
                  {hasTranscripts
                    ? transcripts.map((lang, i) => (
                        <span key={i} className="tag" style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}>{lang}</span>
                      ))
                    : transcripts === null
                      ? <span className="muted">Scraping not yet run</span>
                      : <span className="muted">No captions detected</span>}
                </span>
              </div>

              <div className="section-divider">Instructor Status</div>
              <div className="info-row">
                <span className="info-label">Paul Siegel</span>
                {hasPaul
                  ? <span className="tag good">✓ Active on course</span>
                  : <span className="tag err">✗ Not on course</span>}
              </div>
              <div className="info-row">
                <span className="info-label">Globecon Experts</span>
                {isFinance
                  ? hasGlobecon
                    ? <span className="tag good">✓ Active on course</span>
                    : <span className="tag err">✗ Missing — Finance course needs Globecon</span>
                  : <span className="muted">— Not a Finance course</span>}
              </div>
              <div className="info-row" style={{ alignItems: 'flex-start' }}>
                <span className="info-label">SME / Others</span>
                <span>
                  {sme.length > 0
                    ? sme.map((name, i) => (
                        <span key={i} className="tag" style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}>{name}</span>
                      ))
                    : <span className="muted">None</span>}
                </span>
              </div>
            </div>
          )}

          {tab !== 'instructors' && (
            list === null ? (
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
            )
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
