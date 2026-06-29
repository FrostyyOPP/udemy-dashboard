// One-time: opens a real browser so YOU can log into Udemy (incl. 2FA),
// then saves the session to udemy-auth.json (gitignored). No password is
// ever read or stored by this script. Run: npm run auth:udemy
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');

console.log('Opening a browser. Log into Udemy as the instructor (do any 2FA).');
console.log('When you can see your instructor dashboard, come back here and press Enter.');

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://www.udemy.com/join/login-popup/', { waitUntil: 'domcontentloaded' });

// Wait for the human to finish logging in.
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once('data', resolve);
});

await ctx.storageState({ path: AUTH_FILE });
await browser.close();
console.log(`\n✅ Session saved to ${AUTH_FILE} (gitignored).`);
console.log('   Now run: npm run scrape:revenue');
process.exit(0);
