// themes/tebin/theme.json is generated. This is the only thing standing between
// that sentence and a hand-edit that quietly makes it false.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tebinThemeJson } from '../../src/theme/tebin.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('themes/tebin/theme.json', () => {
  it('is exactly what the generator produces from the vendored snapshot', async () => {
    // The recipe comes from the same function `npm run theme:tebin` calls.
    // Spelling the inputs out again here would put the drift this test exists
    // to catch inside the test itself — and did, once.
    const regenerated = await tebinThemeJson(join(ROOT, 'brand', 'tebin'));
    const committed = readFileSync(join(ROOT, 'themes', 'tebin', 'theme.json'), 'utf8');
    expect(
      committed.replace(/\r\n/g, '\n'),
      'themes/tebin/theme.json is generated — run `npm run theme:tebin` and commit the result, rather than editing it',
    ).toBe(regenerated);
  });
});
