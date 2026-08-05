// Extract the 2026-07-17 Coursera enrollment snapshot preserved in
// exports/dashboard_dump.sql. That dump is the only surviving record of
// pre-August enrollment — coursera_metrics itself is overwritten each scrape.
// Writes coursera-enrollment-2026-07.json for the history backfill.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP = join(__dirname, '..', 'exports', 'dashboard_dump.sql');

const splitVals = (s) => {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; else cur += c; continue; }
    if (c === "'") { q = true; continue; }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
};

const sql = readFileSync(DUMP, 'utf8');
const rows = [];
const re = /^INSERT INTO coursera_metrics VALUES\((.*)\);$/gm;
let m;
while ((m = re.exec(sql))) {
  const v = splitVals(m[1]);
  rows.push({ name: v[0], domain: v[1] || null, enrollments: Number(v[4]), completions: Number(v[6]), capturedAt: v[9] });
}
const stamps = [...new Set(rows.map((r) => r.capturedAt))];
console.log(`parsed ${rows.length} courses · captured ${stamps.join(', ')}`);
if (stamps.length !== 1) console.warn('⚠️ more than one timestamp present — check before using');
console.log(`total enrollments: ${rows.reduce((s, r) => s + r.enrollments, 0).toLocaleString()}`);

writeFileSync(join(__dirname, 'coursera-enrollment-2026-07.json'),
  JSON.stringify({ capturedAt: stamps[0], source: 'exports/dashboard_dump.sql', courses: rows }, null, 2));
console.log('→ coursera-enrollment-2026-07.json');
