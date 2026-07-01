// Collects the caption/subtitle languages for each course (not in the API).
// Uses your saved session (run auth/import first). For each course it reads the
// numeric id off the course page, then asks Udemy's api-2.0 for caption_locales.
// Writes caption-cache.json: { perCourse: { <courseId>: ["English", ...] } }.
// Run: npm run scrape:captions      (finalize endpoint via `npm run discover` if empty)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, 'udemy-auth.json');
const CACHE_FILE = join(__dirname, 'caption-cache.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(AUTH_FILE)) {
  console.error('❌ No session. Run `npm run auth:udemy` or `npm run import:cookies` first.');
  process.exit(1);
}

async function getAllCourses() {
  const all = [];
  let page = 1;
  while (true) {
    const data = await udemyGet('/taught-courses/courses/', {
      page,
      page_size: 100,
      'fields[course]': '@default,published_title',
    });
    all.push(...(data.results || []));
    if (!data.next) break;
    page += 1;
  }
  return all;
}

const courses = await getAllCourses();
console.log(`Fetching caption languages for ${courses.length} courses…`);

const browser = await chromium.launch({ headless: true });
let perCourse = {};
if (existsSync(CACHE_FILE)) {
  try { perCourse = JSON.parse(readFileSync(CACHE_FILE, 'utf8')).perCourse || {}; } catch {}
}
const save = () => writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), perCourse }, null, 2));

let ok = 0;
for (let i = 0; i < courses.length; i++) {
  const c = courses[i];
  if (perCourse[c.id]) continue; // skip cached
  const ctx = await browser.newContext({ storageState: AUTH_FILE });
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.udemy.com/course/${c.published_title}/`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    const numId = await page.evaluate(() => {
      const m = document.documentElement.outerHTML.match(/"course_?[iI]d"\s*[:=]\s*"?(\d{5,9})/);
      return m ? m[1] : null;
    });
    if (numId) {
      const locales = await page.evaluate(async (id) => {
        const r = await fetch(`https://www.udemy.com/api-2.0/courses/${id}/?fields[course]=caption_locales`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!r.ok) return null;
        const j = await r.json();
        return (j.caption_locales || []).map((x) => x.title || x.locale).filter(Boolean);
      }, numId);
      if (locales) { perCourse[c.id] = locales; ok++; if (ok % 5 === 0) save(); }
    }
  } catch {}
  await ctx.close();
  process.stdout.write(`\r  ${i + 1}/${courses.length} · ${ok} with captions`);
  await sleep(1500 + Math.floor(Math.random() * 1500));
}
process.stdout.write('\n');
await browser.close();
save();

console.log(`✅ Got captions for ${Object.keys(perCourse).length} courses → ${CACHE_FILE}`);
if (ok === 0) console.log('⚠️ Nothing captured — run `npm run discover` and share the output so I can fix the endpoint.');
