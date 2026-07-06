// Refreshes all dashboard data by running the scrapers in sequence.
// Session-based scrapers open a browser window briefly (needed to pass Cloudflare).
// Resilient: one failing step doesn't stop the rest. Writes last-update.json.
// Run: npm run update
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Datasets that change day to day. Each entry is [label, script file, platform].
// Enrollment is slow (~15 min, public pages) — run it manually/weekly instead.
const STEPS = [
  ['Udemy revenue', 'scrapeRevenue.js', 'udemy'],
  ['Udemy coupons', 'scrapeCoupons.js', 'udemy'],
  ['Udemy captions', 'scrapeCaptions.js', 'udemy'],
  ['Coursera metrics', 'scrapeCourseraMetrics.js', 'coursera'],
  ['Coursera overview', 'scrapeCourseraOverview.js', 'coursera'],
];

// Skip session-based steps if the session file is missing (avoids noisy failures).
const needsUdemy = existsSync(join(__dirname, 'udemy-auth.json'));
const needsCoursera = existsSync(join(__dirname, 'coursera-auth.json'));

// Spawn with the SAME node binary that's running us — works under launchd/cron
// where npm/nvm aren't on PATH.
function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(__dirname, file)], { cwd: __dirname, stdio: 'inherit' });
    p.on('close', (code) => resolve(code));
    p.on('error', () => resolve(1));
  });
}

console.log(`\n=== Dashboard update · ${new Date().toISOString()} ===`);
const results = [];
for (const [name, file, platform] of STEPS) {
  if (platform === 'coursera' && !needsCoursera) { results.push({ name, skipped: 'not connected' }); continue; }
  if (platform === 'udemy' && !needsUdemy) { results.push({ name, skipped: 'not connected' }); continue; }
  console.log(`\n▶ ${name}…`);
  const t = Date.now();
  const code = await run(file);
  results.push({ name, ok: code === 0, secs: Math.round((Date.now() - t) / 1000) });
}

writeFileSync(join(__dirname, 'last-update.json'), JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2));

console.log('\n=== Summary ===');
for (const r of results) {
  if (r.skipped) console.log(`  ⏭  ${r.name} — ${r.skipped}`);
  else console.log(`  ${r.ok ? '✅' : '❌'} ${r.name} (${r.secs}s)`);
}
const failed = results.filter((r) => r.ok === false);
if (failed.length) console.log(`\n⚠️  ${failed.length} step(s) failed — your session may have expired; reconnect from the dashboard.`);
