// The font is inlined, never fetched. A renderer that must reach for a resource
// will one day fail to get it, silently substitute a system face, and re-wrap
// the whole document — a defect only a human opening the PDF ever sees.
//
// Arimo rather than Arial: the brand's document face is Arial, which exists on
// Windows and macOS and not on Linux or CI. Arimo is metrically identical, so
// the line breaks match, and it is Apache-2.0, so it can ship in a public repo.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;
const WEIGHTS = [400, 700] as const;

let cached: string | undefined;

export async function arimoFaceCss(): Promise<string> {
  if (cached !== undefined) return cached;

  // unicode.json ships with the package and is the authority on the ranges;
  // hard-coding them here would rot the day the package re-subsets.
  const ranges = require('@fontsource/arimo/unicode.json') as Record<string, string>;
  const filesDir = require
    .resolve('@fontsource/arimo/unicode.json')
    .replace(/unicode\.json$/, 'files');

  const faces: string[] = [];
  for (const subset of SUBSETS) {
    const range = ranges[subset];
    if (!range) throw new Error(`@fontsource/arimo declares no unicode-range for ${subset}`);
    for (const weight of WEIGHTS) {
      const file = `${filesDir}/arimo-${subset}-${weight}-normal.woff2`;
      const b64 = (await readFile(file)).toString('base64');
      faces.push(
        `@font-face{font-family:Arimo;font-style:normal;font-weight:${weight};font-display:block;` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`,
      );
    }
  }
  cached = faces.join('');
  return cached;
}
