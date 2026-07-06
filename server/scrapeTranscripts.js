// Scrapes public Udemy course pages for closed-caption / transcript languages.
// Writes transcript-cache.json keyed by course id.
// Run: node scrapeTranscripts.js
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'transcript-cache.json');
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const FORCE = process.argv.includes('--force');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Language name → ISO code map for normalising what Udemy shows.
const LANG_MAP = {
  'english': 'en', 'spanish': 'es', 'french': 'fr', 'german': 'de',
  'portuguese': 'pt', 'italian': 'it', 'japanese': 'ja', 'chinese': 'zh',
  'arabic': 'ar', 'hindi': 'hi', 'korean': 'ko', 'dutch': 'nl',
  'polish': 'pl', 'russian': 'ru', 'turkish': 'tr', 'indonesian': 'id',
  'thai': 'th', 'vietnamese': 'vi', 'romanian': 'ro', 'czech': 'cs',
  'hungarian': 'hu', 'swedish': 'sv', 'danish': 'da', 'norwegian': 'no',
  'finnish': 'fi', 'greek': 'el', 'hebrew': 'he', 'ukrainian': 'uk',
  'bulgarian': 'bg', 'croatian': 'hr', 'serbian': 'sr', 'slovak': 'sk',
  'slovenian': 'sl', 'catalan': 'ca', 'malay': 'ms', 'filipino': 'fil',
  'bengali': 'bn', 'urdu': 'ur', 'persian': 'fa', 'swahili': 'sw',
};

function normalizeLangs(langs) {
  return [...new Set(langs.map((l) => {
    const lower = l.trim().toLowerCase();
    return LANG_MAP[lower] || l.trim();
  }))].sort();
}

function extractFromJson(jsonStr) {
  const langs = [];
  try {
    const data = JSON.parse(jsonStr);
    // Walk looking for caption_available_languages or locale arrays
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      for (const [k, v] of Object.entries(obj)) {
        if ((k === 'caption_available_languages' || k === 'captionLanguages') && Array.isArray(v)) {
          v.forEach((l) => {
            const name = l?.simple_english_title || l?.title || l?.name || l;
            if (typeof name === 'string' && name.length > 0) langs.push(name);
          });
        }
        walk(v);
      }
    };
    walk(data);
  } catch {}
  return langs;
}

const AUTH = existsSync(AUTH_FILE)
  ? JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
  : null;

if (AUTH) {
  console.log('🔐 Using authenticated session from udemy-auth.json — Cloudflare bypass active.');
} else {
  console.log('⚠️  No udemy-auth.json found — scraping without authentication (may be blocked).');
  console.log('   Run: npm run auth:udemy  then re-run this script.');
}

async function scrapeOne(browser, course) {
  const slug = course.published_title;
  if (!slug) return { id: course.id, languages: [], reason: 'no slug' };
  const url = `https://www.udemy.com/course/${slug}/`;

  const ctxOpts = { userAgent: UA, locale: 'en-US' };
  if (AUTH) ctxOpts.storageState = AUTH;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 }).catch(() =>
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    );
    await sleep(3000);

    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const bodyHtml = await page.evaluate(() => document.documentElement.innerHTML).catch(() => '');

    const langs = [];

    // Strategy 1: look for __NEXT_DATA__ JSON blob
    const nextMatch = bodyHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) langs.push(...extractFromJson(nextMatch[1]));

    // Strategy 2: look for UD.serverSideProps or similar inline JSON
    const serverProps = bodyHtml.match(/serverSideProps\s*=\s*(\{[\s\S]{0,200000}\});/);
    if (!langs.length && serverProps) langs.push(...extractFromJson(serverProps[1]));

    // Strategy 3: parse visible "Closed captions" / "Subtitles" text on page
    if (!langs.length) {
      // e.g. "Closed captions\nEnglish [Auto], Spanish"
      const captionMatch = bodyText.match(/(?:closed captions?|subtitles?)[:\s]*\n?([^\n]{0,200})/i);
      if (captionMatch) {
        const parts = captionMatch[1].split(/[,;]/).map((s) => s.replace(/\[.*?\]/g, '').trim()).filter(Boolean);
        langs.push(...parts);
      }
    }

    // Strategy 4: look for "captions" in any inline JSON object
    if (!langs.length) {
      const jsonBlobs = bodyHtml.match(/\{[^<]{100,}\}/g) || [];
      for (const blob of jsonBlobs.slice(0, 30)) {
        const found = extractFromJson(blob);
        if (found.length) { langs.push(...found); break; }
      }
    }

    const normalised = normalizeLangs([...new Set(langs)]);
    return { id: course.id, languages: normalised, reason: normalised.length === 0 ? 'not found' : undefined };
  } catch (e) {
    return { id: course.id, languages: [], reason: e.message.slice(0, 80) };
  } finally {
    await ctx.close();
  }
}

async function getAllPublishedCourses() {
  const all = [];
  let page = 1;
  while (true) {
    const data = await udemyGet('/taught-courses/courses/', {
      page, page_size: 100,
      'fields[course]': '@default,published_title,is_published',
    });
    all.push(...(data.results || []).filter((c) => c.is_published));
    if (!data.next) break;
    page += 1;
  }
  return all;
}

let transcripts = {};
if (existsSync(CACHE_FILE)) {
  try { transcripts = JSON.parse(readFileSync(CACHE_FILE, 'utf8')).transcripts || {}; } catch {}
}
const save = () =>
  writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), transcripts }, null, 2));

console.log('Fetching published course list…');
const courses = await getAllPublishedCourses();
const todo = courses.filter((c) => FORCE || transcripts[c.id] == null);
console.log(`${courses.length} published courses; ${courses.length - todo.length} cached, ${todo.length} to scrape.`);

const browser = await chromium.launch({ headless: true });
let found = 0;
let streak = 0;

for (let i = 0; i < todo.length; i++) {
  const r = await scrapeOne(browser, todo[i]);
  transcripts[r.id] = r.languages;
  if (r.languages.length > 0) { found++; streak = 0; } else { streak++; }

  process.stdout.write(
    `\r  ${i + 1}/${todo.length} · ${found} with captions · ${todo[i].published_title}: [${r.languages.join(', ') || 'none'}]        `
  );
  if (i % 10 === 0) save();

  if (streak >= 6) {
    process.stdout.write(`\n  Cooling down 60s after ${streak} misses…\n`);
    save();
    await sleep(60000);
    streak = 0;
  }
  await sleep(2000 + Math.floor(Math.random() * 1500));
}

process.stdout.write('\n');
await browser.close();
save();
console.log(`✅ Done. ${found}/${todo.length} courses have caption languages detected.`);
