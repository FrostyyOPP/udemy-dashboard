// Coursera CIN courses to exclude everywhere — from the dashboard display
// and from future scraping. Sourced from a client-provided list of completed
// requirements (Coursera_Completed_Batch_2_4_11.xlsx, 143 titles) that
// shouldn't be counted as part of the general CIN catalog. 142 of the 143
// resolved to a real CIN course (120 exact title match, 22 fuzzy — near-
// duplicate wording like "SystemVerilog Basics" vs the catalog's "SystemVerilog
// Tutorials"). One title, "Cinematic Storytelling Simplified Mastering Lumen5
// AI", has no confident match in the current 467-course catalog and was left
// out rather than guessed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, 'coursera_cin_excluded_slugs.json');

export const EXCLUDED_CIN_SLUGS = new Set(JSON.parse(readFileSync(FILE, 'utf8')));
