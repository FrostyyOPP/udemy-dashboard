// Correct coursera_metrics.enrollments using the admin-table figures captured by
// scrapeCourseraEnrollment.js. Guards against writing a value lower than the
// 2026-07-17 snapshot, since enrollment is monotonic and a decrease means the
// source was wrong (which is exactly the bug this repairs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const latest = JSON.parse(readFileSync(join(__dirname, 'coursera-enrollment-latest.json'), 'utf8'));
const july = JSON.parse(readFileSync(join(__dirname, 'coursera-enrollment-2026-07.json'), 'utf8'));
const db = new Database(join(__dirname, 'dashboard.db'));

const norm = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const liveByName = new Map(latest.courses.filter((c) => c.enrollments != null).map((c) => [norm(c.name), c.enrollments]));
const julyByName = new Map(july.courses.map((c) => [norm(c.name), c.enrollments]));

const rows = db.prepare('SELECT course_name, enrollments FROM coursera_metrics').all();
const upd = db.prepare('UPDATE coursera_metrics SET enrollments = ? WHERE course_name = ?');

let fixed = 0, unchanged = 0, noMatch = 0, refused = 0;
const changes = [];
const tx = db.transaction(() => {
  for (const r of rows) {
    const live = liveByName.get(norm(r.course_name));
    if (live == null) { noMatch++; continue; }
    const jul = julyByName.get(norm(r.course_name));
    if (jul != null && live < jul) { refused++; console.log(`  ⚠️ refused ${r.course_name}: live ${live} < july ${jul}`); continue; }
    if (live === r.enrollments) { unchanged++; continue; }
    upd.run(live, r.course_name);
    changes.push({ name: r.course_name, was: r.enrollments, now: live, delta: live - (r.enrollments ?? 0) });
    fixed++;
  }
});
tx();

console.log(`rows in coursera_metrics : ${rows.length}`);
console.log(`  corrected              : ${fixed}`);
console.log(`  already correct        : ${unchanged}`);
console.log(`  no match in admin list : ${noMatch}`);
console.log(`  refused (below July)   : ${refused}`);

changes.sort((a, b) => b.delta - a.delta);
console.log('\nlargest corrections:');
changes.slice(0, 12).forEach((c) => console.log(`   ${String(c.was).padStart(7)} -> ${String(c.now).padStart(7)}  (+${c.delta.toLocaleString()})  ${c.name.slice(0, 50)}`));

const total = db.prepare('SELECT SUM(enrollments) AS t FROM coursera_metrics').get().t;
console.log(`\ntotal enrollments now: ${Number(total).toLocaleString()}  (was 343,020)`);

// no course may sit below its July value
const bad = db.prepare('SELECT course_name, enrollments FROM coursera_metrics').all()
  .filter((r) => { const j = julyByName.get(norm(r.course_name)); return j != null && r.enrollments < j; });
console.log(`courses still below their July figure: ${bad.length}`);
bad.slice(0, 10).forEach((b) => console.log(`   ${b.course_name} = ${b.enrollments} (july ${julyByName.get(norm(b.course_name))})`));
