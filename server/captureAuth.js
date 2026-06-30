// Opens a NORMAL browser (Chrome) with only a debug port — no automation driving
// it — so Udemy's login works like any other day. The script merely *connects*
// afterward to read your session and save it to udemy-auth.json (gitignored).
// No password is read or stored. Run: npm run auth:udemy
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const PROFILE_DIR = join(__dirname, '.cdp-profile');
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Comet.app/Contents/MacOS/Comet',
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.error('❌ No Chrome/Comet found. Set BROWSER_PATH to your browser binary.');
  process.exit(1);
}
console.log(`Launching: ${exe}`);

const child = spawn(
  exe,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.udemy.com/join/login-popup/',
  ],
  { detached: true, stdio: 'ignore' }
);
child.unref();

console.log('\n🔓 A normal browser window opened. Log into Udemy as the instructor (do any 2FA).');
console.log('   This is an ordinary browser — login works normally. Auto-detects when done.\n');

async function loggedInCookies(browser) {
  for (const ctx of browser.contexts()) {
    const cookies = await ctx.cookies().catch(() => []);
    const flag = cookies.find((c) => c.name === 'ud_cache_logged_in');
    if (flag && /^(1|true)$/i.test(String(flag.value))) return ctx;
  }
  return null;
}

const DEADLINE = Date.now() + 10 * 60 * 1000;
let browser = null;
let savedCtx = null;
let i = 0;
while (Date.now() < DEADLINE) {
  await sleep(3000);
  try {
    if (!browser) browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
    savedCtx = await loggedInCookies(browser);
    if (savedCtx) break;
  } catch {
    browser = null; // debug endpoint not ready yet; retry
  }
  i++;
  if (i % 6 === 0) console.log('  …waiting for login.');
  else process.stdout.write('.');
}
process.stdout.write('\n');

if (!savedCtx) {
  console.error('❌ Timed out waiting for login.');
  try { process.kill(-child.pid); } catch {}
  process.exit(1);
}

await savedCtx.storageState({ path: AUTH_FILE });
console.log(`✅ Logged in — session saved to ${AUTH_FILE} (gitignored).`);
try { process.kill(-child.pid); } catch {} // close the browser we launched
process.exit(0);
