// themes/tebin/theme.json and themes/tebin-ua/theme.json are generated. This
// is the only thing standing between that sentence and a hand-edit that
// quietly makes it false.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEBIN_ENTITIES, tebinThemeJson } from '../../src/theme/tebin.js';
import { tebinSchweizId, tebinSchweizThemeJson } from '../../src/theme/tebin-schweiz.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Driven by the generator's own entity list, not by a list spelled out here:
// an entity added to TEBIN_ENTITIES is guarded the moment it exists, which is
// the whole reason the recipe is shared in the first place.
describe.each(TEBIN_ENTITIES)('themes/$id/theme.json', (entity) => {
  it('is exactly what the generator produces from the vendored snapshot', async () => {
    // The recipe comes from the same function `npm run theme:tebin` calls.
    // Spelling the inputs out again here would put the drift this test exists
    // to catch inside the test itself — and did, once.
    const regenerated = await tebinThemeJson(join(ROOT, 'brand', 'tebin'), entity);
    const committed = readFileSync(join(ROOT, 'themes', entity.id, 'theme.json'), 'utf8');
    expect(
      committed.replace(/\r\n/g, '\n'),
      `themes/${entity.id}/theme.json is generated — run \`npm run theme:tebin\` and commit the result, rather than editing it`,
    ).toBe(regenerated);
  });
});

// The Schweiz variants come from the same script and the same snapshot, and
// are guarded the same way.
describe.each(TEBIN_ENTITIES.map((e) => ({ ...e, variant: tebinSchweizId(e) })))('themes/$variant/theme.json', (entity) => {
  it('is exactly what the generator produces from the vendored snapshot', async () => {
    const regenerated = await tebinSchweizThemeJson(join(ROOT, 'brand', 'tebin'), entity);
    const committed = readFileSync(join(ROOT, 'themes', entity.variant, 'theme.json'), 'utf8');
    expect(
      committed.replace(/\r\n/g, '\n'),
      `themes/${entity.variant}/theme.json is generated — run \`npm run theme:tebin\` and commit the result, rather than editing it`,
    ).toBe(regenerated);
  });
});

describe('the TEBIN entity themes', () => {
  it('give every entity its own letterhead, and no two the same', () => {
    // The defect this whole split exists to fix: one hard-coded letterhead
    // meant a Ukraine-scope document printed the Polish company's NIP. Two
    // entities sharing a letterhead would be that defect back, wearing two
    // theme ids.
    const printed = TEBIN_ENTITIES.map((e) => e.letterhead.join('\n'));
    expect(new Set(printed).size).toBe(TEBIN_ENTITIES.length);
  });

  it('names the Ukrainian entity by its own registration, not a translation', () => {
    // Transcribed from the company's own letterhead. Pinned because these are
    // the numbers that say which company signed: a plausible-looking wrong
    // one is worse than a missing one.
    const ua = TEBIN_ENTITIES.find((e) => e.id === 'tebin-ua');
    expect(ua?.letterhead).toEqual([
      'ТОВ «ТЕБІН.ПРО»',
      'Ярославська 58, Київ 04071, Україна',
      '+380 95 283 93 92 | www.tebin.pro | info@tebin.pro',
      'ЄДРПОУ: 43655986 | ІНН: 436559826565',
    ]);
  });
});
