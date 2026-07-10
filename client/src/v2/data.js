// Shared data logic ported verbatim from the live App.jsx so the redesign is an
// exact superset (same Domain classification, instructor flags, CSV export).

export const DOMAIN_RULES = [
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

export function classifyDomain(title = '') {
  const t = title.toLowerCase();
  for (const { domain, keywords } of DOMAIN_RULES) if (keywords.some((kw) => t.includes(kw))) return domain;
  return 'Other';
}

export const FINANCE_DOMAINS = new Set(['Finance & Capital Markets']);

export const DOMAIN_COLOR = {
  'Finance & Capital Markets': '#0066cc', 'AI / Generative AI': '#a435f0', 'Cybersecurity': '#ef4444',
  'Healthcare & Life Sciences': '#10b981', 'Data & Analytics': '#06b6d4', 'Cloud & DevOps': '#f59e0b',
  'Business & Leadership': '#8b5cf6', 'Sales & Marketing': '#ec4899', 'Communication & Writing': '#14b8a6',
  'Product Management': '#6366f1', 'HR & People': '#f43f5e', 'Hospitality': '#84cc16', 'Other': '#9ca3af',
};

export function instructorInfo(course) {
  const names = (course.visible_instructors || []).map((i) => i.title || i.name || '');
  const hasPaul = names.some((n) => n.includes('Paul Siegel'));
  const hasGlobecon = names.some((n) => n.includes('Globecon'));
  const sme = names.filter((n) => !n.includes('Starweaver') && !n.includes('Paul Siegel') && !n.includes('Globecon'));
  return { hasPaul, hasGlobecon, sme };
}

export const capNames = (list) =>
  !Array.isArray(list) ? [] : list.map((x) => (typeof x === 'string' ? x : x?.title || x?.locale || '')).filter(Boolean);

export const usd = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// enrich a raw Udemy course with the derived fields the live table shows
export function enrich(c) {
  const domain = classifyDomain(c.title);
  const isFinance = FINANCE_DOMAINS.has(domain);
  const { hasPaul, hasGlobecon, sme } = instructorInfo(c);
  const above2k = c.num_subscribers == null ? 'N/A' : c.num_subscribers > 2000 ? 'Yes' : 'No';
  return { ...c, domain, isFinance, hasPaul, hasGlobecon, sme, above2k };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function exportCsv(rows) {
  const headers = ['Title','Domain','Total Ratings','Total Enrollments','Enroll > 2k','Avg Rating','Revenue','Captions','Coupons','Paul','Globecon','SME','URL'];
  const data = rows.map((c) => [
    c.title, c.domain, c.num_reviews ?? 0, c.num_subscribers ?? '', c.above2k,
    c.rating ? Number(c.rating).toFixed(2) : '', c.revenue ?? '',
    capNames(c.caption_locales).join('; '), Array.isArray(c.coupons) ? c.coupons.length : '',
    c.hasPaul ? 'Yes' : 'No', c.isFinance ? (c.hasGlobecon ? 'Yes' : 'No') : 'N/A', c.sme?.join('; ') || '',
    c.url ? `https://www.udemy.com${c.url}` : '',
  ]);
  const csv = [headers, ...data].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `courses-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}
