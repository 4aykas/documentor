// `npm run theme:tebin`. Reads only brand/tebin/ and writes only
// themes/tebin/theme.json — no network, so it runs in an offline CI, and the
// snapshot's diff is the record of what the brand changed.
//
// The recipe itself lives in tebin.ts, because the test that guards this file
// against hand-edits has to use the same one.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tebinThemeJson } from './tebin.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const out = await tebinThemeJson(join(ROOT, 'brand', 'tebin'));

const target = join(ROOT, 'themes', 'tebin', 'theme.json');
// themes/tebin/ does not exist until the first run.
await mkdir(dirname(target), { recursive: true });
await writeFile(target, out, 'utf8');
process.stdout.write(`wrote ${target}\n`);
