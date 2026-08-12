// `npm run theme:tebin`. Reads only brand/tebin/ and writes only
// themes/tebin/theme.json — no network, so it runs in an offline CI, and the
// snapshot's diff is the record of what the brand changed.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTheme, readTokens, themeJson } from './generate.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = join(ROOT, 'brand', 'tebin');

const [dtcg, logoSvg, logoPng] = await Promise.all([
  readFile(join(BRAND, 'tokens.dtcg.json'), 'utf8'),
  readFile(join(BRAND, 'logo-full.svg'), 'utf8'),
  readFile(join(BRAND, 'logo-full.png')),
]);

const out = themeJson(
  buildTheme({
    tokens: readTokens(dtcg),
    logoSvg,
    logoPngBase64: logoPng.toString('base64'),
    sourceId: 'tebin-classic',
    sourceVersion: '1.0.0',
  }),
);

const target = join(ROOT, 'themes', 'tebin', 'theme.json');
// themes/tebin/ does not exist until the first run.
await mkdir(dirname(target), { recursive: true });
await writeFile(target, out, 'utf8');
process.stdout.write(`wrote ${target}\n`);
