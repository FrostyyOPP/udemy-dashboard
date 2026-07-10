// Tiny dependency-free inline-SVG charts, themed to the v2 palette.
// Each takes plain data and renders responsive SVG. No libraries.

const fmt = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};

// Horizontal bar chart. data: [{ label, value, color? }]
export function BarChart({ data = [], money = false, height = 260 }) {
  const rows = data.slice(0, 8);
  const max = Math.max(1, ...rows.map((d) => d.value || 0));
  const rowH = 28, gap = 10, labelW = 150, top = 4;
  const h = Math.max(height, rows.length * (rowH + gap));
  return (
    <svg viewBox={`0 0 600 ${h}`} width="100%" height={h} preserveAspectRatio="xMinYMin meet" role="img">
      {rows.map((d, i) => {
        const y = top + i * (rowH + gap);
        const w = ((d.value || 0) / max) * (600 - labelW - 60);
        return (
          <g key={i}>
            <text x="0" y={y + rowH / 2 + 4} fontSize="12" fill="#4b5563">{(d.label || '').slice(0, 22)}</text>
            <rect x={labelW} y={y} width={Math.max(2, w)} height={rowH} rx="5" fill={d.color || '#a435f0'} opacity="0.9" />
            <text x={labelW + Math.max(2, w) + 6} y={y + rowH / 2 + 4} fontSize="12" fontWeight="600" fill="#1a202c">{money ? '$' : ''}{fmt(d.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Donut chart. data: [{ label, value, color }]
export function Donut({ data = [], money = false, size = 220 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1;
  const R = 80, r = 50, cx = 110, cy = 110;
  let a0 = -Math.PI / 2;
  const arc = (a1) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x1, y1] = p(a0, R), [x2, y2] = p(a1, R), [x3, y3] = p(a1, r), [x4, y4] = p(a0, r);
    return `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z`;
  };
  const segs = data.map((d) => { const a1 = a0 + ((d.value || 0) / total) * Math.PI * 2; const s = { d, path: arc(a1) }; a0 = a1; return s; });
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 220 220" width={size} height={size} role="img">
        {segs.map((s, i) => <path key={i} d={s.path} fill={s.d.color} />)}
        <text x="110" y="106" textAnchor="middle" fontSize="13" fill="#4b5563">Total</text>
        <text x="110" y="128" textAnchor="middle" fontSize="18" fontWeight="700" fill="#1a202c">{money ? '$' : ''}{fmt(total)}</text>
      </svg>
      <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
            <span style={{ flex: 1, color: '#374151' }}>{d.label}</span>
            <b>{money ? '$' : ''}{fmt(d.value)}</b>
            <span className="muted" style={{ width: 42, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Histogram of buckets. data: [{ label, value }]
export function Histogram({ data = [], color = '#a435f0', height = 240 }) {
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  const n = data.length || 1, bw = 480 / n, pad = 10;
  return (
    <svg viewBox="0 0 520 260" width="100%" height={height} preserveAspectRatio="xMinYMin meet" role="img">
      {data.map((d, i) => {
        const bh = ((d.value || 0) / max) * 200;
        const x = 20 + i * bw, y = 220 - bh;
        return (
          <g key={i}>
            <rect x={x + pad / 2} y={y} width={bw - pad} height={bh} rx="5" fill={color} opacity="0.9" />
            <text x={x + bw / 2} y="240" textAnchor="middle" fontSize="12" fill="#4b5563">{d.label}</text>
            <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1a202c">{d.value || 0}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Line chart for a time series. data: [{ label, value }], in chronological order.
export function LineChart({ data = [], money = false, height = 240, color = '#10b981' }) {
  const rows = data;
  const max = Math.max(1, ...rows.map((d) => d.value || 0));
  const w = 560, padL = 10, padR = 10, padT = 14, padB = 30;
  const plotW = w - padL - padR, plotH = height - padT - padB;
  const n = Math.max(1, rows.length - 1);
  const x = (i) => padL + (i / n) * plotW;
  const y = (v) => padT + plotH - (v / max) * plotH;
  const path = rows.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.value || 0).toFixed(1)}`).join(' ');
  const area = `${path} L${x(rows.length - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z`;
  const step = Math.max(1, Math.ceil(rows.length / 8));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="xMinYMin meet" role="img">
      <path d={area} fill={color} opacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {rows.map((d, i) => (i % step === 0 || i === rows.length - 1) ? (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value || 0)} r="3" fill={color} />
          <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="#4b5563">{d.label}</text>
        </g>
      ) : null)}
      {rows.length > 0 && <text x={x(rows.length - 1)} y={y(rows[rows.length - 1].value || 0) - 10} textAnchor="end" fontSize="11" fontWeight="600" fill="#1a202c">{money ? '$' : ''}{fmt(rows[rows.length - 1].value)}</text>}
    </svg>
  );
}

export function ChartPlaceholder({ children, note = 'Needs history' }) {
  return (
    <div className="chart-placeholder">
      <span className="ph-badge">{note}</span>
      <div>{children}</div>
    </div>
  );
}
