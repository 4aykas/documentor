// letterhead.ts holds the one decision html.ts and docx.ts must not be free
// to make differently: which of entity/date print, in what order, and how
// the first line is set apart. A shared rule with no test of its own is the
// next thing to drift, the same way it already drifted once.

import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from '../../src/render/letterhead.js';

const doc = (entity?: string, date?: string): Doc => ({
  meta: { title: 'T', lang: 'en', ...(entity !== undefined ? { entity } : {}), ...(date !== undefined ? { date } : {}) },
  blocks: [],
});

describe('letterheadDocLines', () => {
  it('prints entity before date when both are set', () => {
    expect(letterheadDocLines(doc('Acme Sp. z o.o.', '2026-08-12'))).toEqual(['Acme Sp. z o.o.', '2026-08-12']);
  });

  it('prints only the date when the entity is unset', () => {
    expect(letterheadDocLines(doc(undefined, '2026-08-12'))).toEqual(['2026-08-12']);
  });

  it('prints only the entity when the date is unset', () => {
    expect(letterheadDocLines(doc('Acme Sp. z o.o.'))).toEqual(['Acme Sp. z o.o.']);
  });

  it('drops an empty string the same way it drops an unset field', () => {
    // An empty string is not a blank line worth printing — the same rule
    // applied to `undefined`.
    expect(letterheadDocLines(doc('', ''))).toEqual([]);
  });

  it('prints nothing when the document sets neither', () => {
    expect(letterheadDocLines(doc())).toEqual([]);
  });
});

describe('LETTERHEAD_ENTITY_DATE_GAP_PT', () => {
  it('is a positive gap, the same number both renderers spend', () => {
    // Pinned as a value, not just a type: html.ts and docx.ts each convert
    // this into their own unit (a CSS pt margin, a DXA `spacing.before`), so
    // this is the one place a change to "5" is a change on purpose rather
    // than one file's copy drifting from the other's.
    expect(LETTERHEAD_ENTITY_DATE_GAP_PT).toBe(5);
  });
});
