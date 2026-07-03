import { useMemo, useState } from 'react';

// Bulk coupon creation UI. Udemy caps coupons (~1 free/course/month), so this
// applies ONE code across selected courses. Dry-run previews before any write.
export default function CreateCoupons({ courses, onDone }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [type, setType] = useState('free');
  const [price, setPrice] = useState(11.99);
  const [maxUses, setMaxUses] = useState(100);
  const [days, setDays] = useState(31);
  const [strategy, setStrategy] = useState('custom-price');
  const [scope, setScope] = useState('test'); // 'test' (1 course) | 'all'
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const published = useMemo(() => courses.filter((c) => c.is_published && c.published_title), [courses]);
  const targets = scope === 'test' ? published.slice(0, 1) : published;

  async function submit(dryRun) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/coupons/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slugs: targets.map((c) => c.published_title),
          code: code.trim(),
          type,
          price: Number(price),
          maxUses: Number(maxUses),
          days: Number(days),
          strategy: strategy.trim() || undefined,
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      if (!dryRun && data.created > 0) onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>🎟️ Create Coupons</button>
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Create coupons</h2>
              <button className="close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <div className="banner warn" style={{ margin: 0 }}>
                ⚠️ This writes to your live Udemy account. Udemy limits coupons (~1 free/course/month),
                so start with <b>Test on 1 course</b>. A wrong setting just errors — it won’t create a bad coupon.
              </div>

              <label className="fld">Coupon code
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. FREEAUG2026" />
              </label>

              <div className="row2">
                <label className="fld">Type
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="free">Free (100% off)</option>
                    <option value="discount">Discount price</option>
                  </select>
                </label>
                {type === 'discount' && (
                  <label className="fld">Price (USD)
                    <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </label>
                )}
              </div>

              <div className="row2">
                <label className="fld">Max uses
                  <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
                </label>
                <label className="fld">Valid for (days)
                  <input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
                </label>
              </div>

              <label className="fld">Apply to
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="test">Test on 1 course ({published[0]?.title?.slice(0, 40) || '—'})</option>
                  <option value="all">All published courses ({published.length})</option>
                </select>
              </label>

              <label className="fld">discount_strategy (advanced — change if it errors)
                <input value={strategy} onChange={(e) => setStrategy(e.target.value)} className="mono" />
              </label>

              {error && <div className="banner err" style={{ margin: 0 }}>❌ {error}</div>}
              {result && (
                <div className="banner" style={{ margin: 0, borderColor: 'var(--border)' }}>
                  {result.dryRun ? (
                    <>🔎 Dry run — would create <b>{result.courses}</b> coupon(s): <code>{result.plan.code}</code>{' '}
                      ({result.plan.type}, {result.plan.maximum_uses} uses, {result.plan.days}d). Nothing created yet.</>
                  ) : (
                    <>✅ Created <b>{result.created}</b>, failed <b>{result.failed}</b>.
                      {result.failed > 0 && (
                        <div className="mono small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                          {result.results.filter((r) => !r.ok).slice(0, 3).map((r) => `${r.slug}: ${r.error}`).join('\n')}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="ghost" onClick={() => submit(true)} disabled={busy || !code.trim()}>Preview (dry run)</button>
                <button onClick={() => submit(false)} disabled={busy || !code.trim()}>
                  {busy ? 'Working…' : `Create for ${targets.length} course${targets.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
