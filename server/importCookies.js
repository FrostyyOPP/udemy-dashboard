// Converts cookies exported from your NORMAL logged-in browser (via the
// "Cookie-Editor" extension → Export → JSON) into a Playwright session file.
// This bypasses Udemy's login bot-protection entirely — you're already logged in.
//
// 1) In your normal browser, open udemy.com (logged in as instructor)
// 2) Cookie-Editor extension → Export → Export as JSON (copies to clipboard)
// 3) Save it to server/udemy-cookies.json
// 4) Run: npm run import:cookies
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_FILE = process.env.COOKIES_FILE || join(__dirname, 'udemy-cookies.json');
const AUTH_FILE = join(__dirname, 'udemy-auth.json');

if (!existsSync(IN_FILE)) {
  console.error(`❌ ${IN_FILE} not found.`);
  console.error('   Export udemy.com cookies with the Cookie-Editor extension and save them there.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(IN_FILE, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.cookies || [];

const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
const cookies = list
  .filter((c) => c && c.name && c.domain)
  .map((c) => {
    const out = {
      name: c.name,
      value: String(c.value ?? ''),
      domain: c.domain,
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: sameSiteMap[String(c.sameSite || '').toLowerCase()] || 'Lax',
    };
    const exp = c.expirationDate ?? c.expires;
    out.expires = exp ? Math.floor(Number(exp)) : -1;
    return out;
  });

writeFileSync(AUTH_FILE, JSON.stringify({ cookies, origins: [] }, null, 2));

const flag = cookies.find((c) => c.name === 'ud_cache_logged_in');
const hasSession = cookies.some((c) => c.name === 'dj_session_id');
console.log(`✅ Imported ${cookies.length} cookies → ${AUTH_FILE}`);
console.log(`   ud_cache_logged_in=${flag ? flag.value : 'absent'} · dj_session_id ${hasSession ? 'present' : 'MISSING'}`);
if (!flag || !/^(1|true)$/i.test(String(flag.value)) || !hasSession) {
  console.log('   ⚠️ Session cookies look incomplete — make sure you exported while logged in on udemy.com.');
} else {
  console.log('   Looks good. Now run: npm run discover');
}
