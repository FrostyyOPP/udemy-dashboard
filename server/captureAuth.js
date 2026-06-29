// One-time: opens a browser so YOU can log into Udemy (incl. 2FA). Detects the
// login the same way Udemy's site does (contexts/me), then saves the session to
// udemy-auth.json (gitignored). No password is read or stored.
// Uses a persistent profile (.chromium-profile, gitignored) so a retry doesn't
// need a fresh login. Run: npm run auth:udemy
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const PROFILE_DIR = join(__dirname, '.chromium-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const executablePath = process.env.BROWSER_PATH || undefined; // bundled Chromium by default
if (executablePath) console.log(`Using browser: ${executablePath}`);

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, executablePath });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://www.udemy.com/join/login-popup/', { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('\n🔓 A browser window opened. Log into Udemy as the instructor (do any 2FA).');
console.log('   It auto-detects your login — nothing to press.\n');

// Canonical logged-in check, run from inside the page (same-origin, cookie-based).
async function loggedIn() {
  try {
    return await page.evaluate(async () => {
      const res = await fetch('https://www.udemy.com/api-2.0/contexts/me/?me=True', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return false;
      const j = await res.json();
      return Boolean(j?.header?.isLoggedIn);
    });
  } catch {
    return false; // page mid-navigation / cross-origin during SSO
  }
}

const DEADLINE = Date.now() + 10 * 60 * 1000;
let ok = false;
let i = 0;
while (Date.now() < DEADLINE) {
  await sleep(3000);
  if (await loggedIn()) { ok = true; break; }
  i++;
  if (i % 6 === 0) {
    const names = (await ctx.cookies().catch(() => [])).map((c) => c.name).join(', ');
    console.log(`\n  …waiting. cookies: ${names || '(none)'}`);
  } else {
    process.stdout.write('.');
  }
}
process.stdout.write('\n');

if (!ok) {
  console.error('❌ Timed out. The cookie list above shows what Udemy set — share it if this keeps failing.');
  await ctx.close();
  process.exit(1);
}

await sleep(1000);
await ctx.storageState({ path: AUTH_FILE });
await ctx.close();
console.log(`✅ Logged in — session saved to ${AUTH_FILE} (gitignored).`);
process.exit(0);
