// Approves the pixel baselines from the last `npm run test:pixels`: every
// image in test/baseline/__actual__ becomes its baseline, a baseline with no
// image left is removed (its test is gone), and __baseline__/approved.json
// records the platform and Chromium build they were approved on, so a run
// anywhere else says so instead of failing every image.
//
//   npm run test:pixels        # writes __actual__
//   npm run pixels:diff -- test/baseline/__baseline__ test/baseline/__actual__ --strip review.png
//   npm run pixels:approve     # only after looking
//
// It approves what is there and nothing more: look first.

import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { describeStamp, stampOf, writeApproval } from '../test/helpers/pixel-stamp.js';

const DIR = fileURLToPath(new URL('../test/baseline/', import.meta.url));
const ACTUAL = join(DIR, '__actual__');
const BASELINE = join(DIR, '__baseline__');

const fresh = existsSync(ACTUAL) ? readdirSync(ACTUAL).filter((f) => f.endsWith('.png')).sort() : [];
if (fresh.length === 0) {
  console.error('nothing to approve: run npm run test:pixels first, and look at test/baseline/__actual__');
  process.exit(2);
}
const browser = await chromium.launch();
const stamp = stampOf(browser);
await browser.close();

for (const f of fresh) copyFileSync(join(ACTUAL, f), join(BASELINE, f));
const stale = readdirSync(BASELINE).filter((f) => f.endsWith('.png') && !fresh.includes(f));
for (const f of stale) rmSync(join(BASELINE, f));
await writeApproval(join(BASELINE, 'approved.json'), { ...stamp, approved: new Date().toISOString().slice(0, 10), images: fresh });
console.log(`approved ${fresh.length} images on ${describeStamp(stamp)}${stale.length ? `; removed ${stale.join(', ')}` : ''}`);
console.log('commit test/baseline/__baseline__, saying what you looked at');
