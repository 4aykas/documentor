// themes/tebin/theme.json is generated. This is the only thing standing between
// that sentence and a hand-edit that quietly makes it false.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTheme, readTokens, themeJson } from '../../src/theme/generate.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = join(ROOT, 'brand', 'tebin');

describe('themes/tebin/theme.json', () => {
  it('is exactly what the generator produces from the vendored snapshot', () => {
    const regenerated = themeJson(
      buildTheme({
        tokens: readTokens(readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8')),
        logoSvg: readFileSync(join(BRAND, 'logo-full.svg'), 'utf8'),
        logoPngBase64: readFileSync(join(BRAND, 'logo-full.png')).toString('base64'),
        cornerMarkSvg: readFileSync(join(BRAND, 'corner-mark.svg'), 'utf8'),
        cornerMarkPngBase64: readFileSync(join(BRAND, 'corner-mark.png')).toString('base64'),
        sourceId: 'tebin-classic',
        sourceVersion: '1.0.0',
      }),
    );
    const committed = readFileSync(join(ROOT, 'themes', 'tebin', 'theme.json'), 'utf8');
    expect(
      committed.replace(/\r\n/g, '\n'),
      'themes/tebin/theme.json is generated — run `npm run theme:tebin` and commit the result, rather than editing it',
    ).toBe(regenerated);
  });
});
