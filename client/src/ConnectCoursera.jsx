import { useEffect, useState } from 'react';

// "Connect Coursera" — same session-reuse pattern as Udemy (no OAuth exists).
export default function ConnectCoursera({ onConnected }) {
  const [conn, setConn] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = () =>
    fetch('/api/coursera/connection').then((r) => r.json()).then(setConn).catch(() => setConn({ connected: false }));
  useEffect(() => { refresh(); }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      let cookies;
      try { cookies = JSON.parse(text); } catch { throw new Error('That is not valid JSON. Paste the full Cookie-Editor export.'); }
      const res = await fetch('/api/coursera/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOpen(false);
      setText('');
      await refresh();
      onConnected?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const disconnect = async () => { await fetch('/api/coursera/disconnect', { method: 'POST' }); refresh(); };
  const connected = conn?.connected;

  return (
    <>
      {connected ? (
        <span className="conn ok" onClick={disconnect}>● Coursera connected · disconnect</span>
      ) : (
        <button className="ghost" onClick={() => setOpen(true)}>🔗 Connect Coursera</button>
      )}

      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Connect your Coursera account</h2>
              <button className="close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p className="muted" style={{ marginTop: 0 }}>
                Coursera has no “authorize app” flow either, so we reuse your existing login. One-time:
              </p>
              <ol className="muted" style={{ lineHeight: 1.7 }}>
                <li>Install the <b>Cookie-Editor</b> extension.</li>
                <li>Open <b>coursera.org</b> logged in (Starweaver partner account).</li>
                <li>Cookie-Editor → <b>Export</b> → <b>Export as JSON</b>.</li>
                <li>Paste below and Connect.</li>
              </ol>
              <textarea className="paste" placeholder="Paste the coursera.org Cookie-Editor JSON here…" value={text} onChange={(e) => setText(e.target.value)} />
              {error && <div className="banner err" style={{ marginTop: 10 }}>❌ {error}</div>}
              <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                <button onClick={connect} disabled={busy || !text.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
                <span className="muted" style={{ alignSelf: 'center' }}>Stored locally, gitignored.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
