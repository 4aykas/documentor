// Two renderings compared pixel by pixel: two PDFs (page by page), two PNGs,
// or two folders of PNGs (by file name, as __baseline__ and __actual__).
//
//   npm run pixels:diff -- before.pdf after.pdf
//   npm run pixels:diff -- test/baseline/__baseline__ test/baseline/__actual__ --strip review.png
//
// Prints, per page or image, how many pixels differ; --strip writes one PNG
// with a row per differing pair: the first | the second | the difference in
// red. Counting is done in the Chromium documentor already ships, so nothing
// else is needed. Exit 0 when every pair is identical, 1 when any differs.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { rasterPages } from '../test/helpers/raster.js';

type Img = { name: string; png: Buffer };
type Compared = { size: string; n: number; total: number; row: string };

// Page code is a string, as everywhere in documentor: a function handed to
// page.evaluate is compiled by tsx first and arrives calling its __name
// helper, which the page does not have.
const LOAD = `(src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; })`;

const COMPARE = `async ([x, y, wantRow]) => {
  const load = ${LOAD};
  const [p, q] = await Promise.all([load('data:image/png;base64,' + x), load('data:image/png;base64,' + y)]);
  if (p.width !== q.width || p.height !== q.height) return { size: p.width + 'x' + p.height + ' against ' + q.width + 'x' + q.height, n: -1, total: 0, row: '' };
  const w = p.width, h = p.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(p, 0, 0); const dp = g.getImageData(0, 0, w, h).data;
  g.clearRect(0, 0, w, h); g.drawImage(q, 0, 0); const dq = g.getImageData(0, 0, w, h).data;
  const diff = g.createImageData(w, h);
  let n = 0;
  for (let i = 0; i < dp.length; i += 4) {
    const same = dp[i] === dq[i] && dp[i + 1] === dq[i + 1] && dp[i + 2] === dq[i + 2] && dp[i + 3] === dq[i + 3];
    if (!same) n++;
    diff.data[i] = same ? 255 : 230; diff.data[i + 1] = same ? 255 : 0; diff.data[i + 2] = same ? 255 : 0; diff.data[i + 3] = 255;
  }
  if (n === 0 || !wantRow) return { size: '', n, total: w * h, row: '' };
  g.putImageData(diff, 0, 0);
  const s = document.createElement('canvas'); s.width = w * 3; s.height = h;
  const sg = s.getContext('2d');
  sg.drawImage(p, 0, 0); sg.drawImage(q, w, 0); sg.drawImage(c, w * 2, 0);
  return { size: '', n, total: w * h, row: s.toDataURL('image/png') };
}`;

// Each row scaled to one width and stacked, so a long strip stays readable.
const STACK = `async (urls) => {
  const load = ${LOAD};
  const ims = await Promise.all(urls.map(load));
  const W = 2400;
  const hs = ims.map((im) => Math.round(im.height * W / im.width));
  const c = document.createElement('canvas'); c.width = W; c.height = hs.reduce((s, x) => s + x + 12, 0);
  const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, c.width, c.height);
  let y = 0;
  ims.forEach((im, i) => { g.drawImage(im, 0, y, W, hs[i]); y += hs[i] + 12; });
  return c.toDataURL('image/png');
}`;

const args = process.argv.slice(2);
const si = args.indexOf('--strip');
const strip = si === -1 ? undefined : resolve(args.splice(si, 2)[1] ?? '');
const [a, b] = args;
if (a === undefined || b === undefined || args.length !== 2) {
  console.error('usage: npm run pixels:diff -- <a> <b> [--strip <out.png>]   (two PDFs, two PNGs or two folders of PNGs)');
  process.exit(2);
}

async function images(p: string): Promise<Img[]> {
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  if (statSync(p).isDirectory()) {
    return Promise.all(readdirSync(p).filter((f) => f.endsWith('.png')).sort().map(async (f) => ({ name: f, png: await readFile(join(p, f)) })));
  }
  if (extname(p).toLowerCase() === '.pdf') {
    const pages = await rasterPages(await readFile(p));
    return pages.map((png, i) => ({ name: `page-${String(i + 1).padStart(2, '0')}`, png }));
  }
  return [{ name: basename(p), png: await readFile(p) }];
}

const [left, right] = await Promise.all([images(resolve(a)), images(resolve(b))]);
const singles = left.length === 1 && right.length === 1;
const byName = new Map(right.map((i) => [i.name, i]));
const pairs = singles ? [[left[0]!, right[0]!] as const] : left.flatMap((l) => (byName.has(l.name) ? [[l, byName.get(l.name)!] as const] : []));
const onlyLeft = singles ? [] : left.filter((l) => !byName.has(l.name)).map((l) => l.name);
const onlyRight = singles ? [] : right.filter((r) => !left.some((l) => l.name === r.name)).map((r) => r.name);

const browser = await chromium.launch();
let differing = 0;
try {
  const page = await browser.newPage();
  const rows: string[] = [];
  for (const [l, r] of pairs) {
    const res = await page.evaluate(`(${COMPARE})(${JSON.stringify([l.png.toString('base64'), r.png.toString('base64'), strip !== undefined])})`) as Compared;
    const label = singles ? `${l.name} | ${r.name}` : l.name;
    if (res.n === -1) { differing++; console.log(`${label}: sizes differ, ${res.size}`); continue; }
    if (res.n > 0) differing++;
    console.log(`${label}: ${res.n === 0 ? 'identical' : `${res.n} px differ (${(100 * res.n / res.total).toFixed(3)}%)`}`);
    if (res.row !== '') rows.push(res.row);
  }
  for (const n of onlyLeft) console.log(`${n}: only in ${a}`);
  for (const n of onlyRight) console.log(`${n}: only in ${b}`);
  if (strip !== undefined && rows.length > 0) {
    const out = await page.evaluate(`(${STACK})(${JSON.stringify(rows)})`) as string;
    await writeFile(strip, Buffer.from(out.slice(out.indexOf(',') + 1), 'base64'));
    console.log(`strip: ${strip} (${rows.length} row${rows.length === 1 ? '' : 's'}: first | second | difference)`);
  }
} finally {
  await browser.close();
}
process.exit(differing > 0 || onlyLeft.length > 0 || onlyRight.length > 0 ? 1 : 0);
