// Scrapes public Udemy course pages for enrollment counts (not in the API).
// Writes enrollment-cache.json keyed by course id. Run: npm run scrape:enrollment
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { udemyGet } from './udemyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'enrollment-cache.json');
// Sequential — Cloudflare blocks parallel page loads. Reusing one context keeps
// the cf_clearance cookie so only the first page pays the challenge cost.
const FORCE = process.argv.includes('--force'); // re-scrape even if already cached
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extractStudents = (text) => {
  const m = text.match(/([\d,]+)\s+students/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

async function getAllCourses() {
  const all = [];
  let page = 1;
  while (true) {
    const data = await udemyGet('/taught-courses/courses/', {
      page,
      page_size: 100,
      'fields[course]': '@default,published_title,is_published',
    });
    all.push(...(data.results || []));
    if (!data.next) break;
    page += 1;
  }
  return all;
}

async function scrapeOne(browser, course) {
  const slug = course.published_title;
  if (!slug) return { id: course.id, students: null, reason: 'no slug' };
  const url = `https://www.udemy.com/course/${slug}/`;

  // Fresh CONTEXT per course — Cloudflare rate-limits rapid same-session
  // requests, so each scrape looks like a brand-new visitor. Bounded ~20s.
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    let students = extractStudents(await page.evaluate(() => document.body.innerText));
    if (students == null) {
      await page
        .waitForFunction(() => /([\d,]+)\s+students/i.test(document.body.innerText), { timeout: 4000 })
        .catch(() => {});
      students = extractStudents(await page.evaluate(() => document.body.innerText));
    }
    return { id: course.id, students, reason: students == null ? 'no match' : undefined };
  } catch (e) {
    return { id: course.id, students: null, reason: e.message.slice(0, 60) };
  } finally {
    await ctx.close();
  }
}

// Load prior cache so re-runs skip what we already have and never lose data.
let counts = {};
if (existsSync(CACHE_FILE)) {
  try {
    counts = JSON.parse(readFileSync(CACHE_FILE, 'utf8')).counts || {};
  } catch {}
}
const save = () =>
  writeFileSync(CACHE_FILE, JSON.stringify({ scrapedAt: new Date().toISOString(), counts }, null, 2));

console.log('Fetching course list from the API…');
const courses = await getAllCourses();
const todo = courses.filter((c) => FORCE || counts[c.id] == null);
console.log(
  `Found ${courses.length} courses; ${courses.length - todo.length} already cached, ${todo.length} to scrape.`
);

const browser = await chromium.launch({ headless: true });
// NB: do NOT block stylesheets/fonts — it intermittently breaks Udemy's pages.

let ok = 0;
let streak = 0; // consecutive misses → sign the IP got rate-limited
for (let i = 0; i < todo.length; i++) {
  const r = await scrapeOne(browser, todo[i]);
  if (r.students != null) {
    counts[r.id] = r.students;
    ok++;
    streak = 0;
    if (ok % 5 === 0) save(); // checkpoint so a crash keeps progress
  } else {
    streak++;
  }
  process.stdout.write(
    `\r  ${i + 1}/${todo.length} · ${ok} found${r.students != null ? ` · ${todo[i].published_title}: ${r.students}` : ''}            `
  );

  // After 6 misses in a row, Cloudflare has almost certainly throttled this IP.
  // Pause to let the rate-limit window reset, then carry on — lets one run
  // self-heal instead of needing manual re-runs.
  if (streak >= 6) {
    process.stdout.write(`\n  ⏸ ${streak} misses in a row — cooling down 90s for the rate limit…\n`);
    save();
    await sleep(90000);
    streak = 0;
  }
  await sleep(2000 + Math.floor(Math.random() * 2000)); // pace under CF rate limit
}
process.stdout.write('\n');
await browser.close();
save();

const total = Object.values(counts).reduce((s, n) => s + n, 0);
console.log(`✅ Got enrollment for ${ok}/${todo.length} new courses this run.`);
console.log(`   Cache now holds ${Object.keys(counts).length}/${courses.length} courses, ${total.toLocaleString()} total students.`);
console.log(`   Re-run \`npm run scrape:enrollment\` to retry the misses (cached ones are skipped).`);
