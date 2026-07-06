// SOURCE — this is the readable version; the minified bookmarklet is built from this.
// Run in browser console on any udemy.com/course/{slug}/ page to send captions to localhost:5055

(async function() {
  const slug = location.pathname.match(/\/course\/([^/]+)/)?.[1];
  if (!slug) return alert('Not a Udemy course page!');

  // Strategy 1: React store has caption_available_languages
  let langs = [];
  try {
    const scripts = [...document.querySelectorAll('script')];
    for (const s of scripts) {
      const t = s.textContent || '';
      const m = t.match(/"caption_available_languages"\s*:\s*(\[[^\]]*\])/);
      if (m) {
        const arr = JSON.parse(m[1]);
        langs = arr.map(l => l?.simple_english_title || l?.title || l?.name || l).filter(Boolean);
        if (langs.length) break;
      }
    }
  } catch {}

  // Strategy 2: visible "Closed captions" text
  if (!langs.length) {
    const text = document.body.innerText;
    const m = text.match(/[Cc]losed\s+[Cc]aptions?\s*\n?(.{0,300})/);
    if (m) {
      langs = m[1].split(/[,\n]/).map(s => s.replace(/\[.*?\]/g,'').trim()).filter(s => s.length > 1 && s.length < 40);
    }
  }

  // Strategy 3: check for __NEXT_DATA__
  if (!langs.length) {
    const nd = document.getElementById('__NEXT_DATA__');
    if (nd) {
      try {
        const walk = obj => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) { obj.forEach(walk); return; }
          for (const [k,v] of Object.entries(obj)) {
            if (k === 'caption_available_languages' && Array.isArray(v)) {
              langs.push(...v.map(l => l?.simple_english_title || l?.title || l || '').filter(Boolean));
            }
            walk(v);
          }
        };
        walk(JSON.parse(nd.textContent));
      } catch {}
    }
  }

  console.log(`[Udemy Captions] slug=${slug} langs=`, langs);

  const r = await fetch('http://localhost:5055/api/transcripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, languages: langs })
  });
  const data = await r.json();
  if (data.ok) {
    alert(`✅ Saved: ${langs.length ? langs.join(', ') : '(no captions detected)'}\nCourse: ${slug}`);
  } else {
    alert('❌ Error: ' + JSON.stringify(data));
  }
})();
