import { describe, expect, it } from 'vitest';
import { validateDoc } from '../../src/ir/validate.js';

const good = {
  meta: { title: 'T', lang: 'en' },
  blocks: [{ t: 'para', text: [{ t: 'text', v: 'hello' }] }],
};

describe('validateDoc', () => {
  it('accepts a minimal document', () => {
    expect(() => validateDoc(good)).not.toThrow();
  });

  it('rejects a document with no meta.title', () => {
    expect(() => validateDoc({ meta: { lang: 'en' }, blocks: [] }))
      .toThrow(/meta\.title/);
  });

  it('rejects an unknown block type', () => {
    expect(() => validateDoc({ ...good, blocks: [{ t: 'marquee' }] }))
      .toThrow(/marquee/);
  });

  it('rejects a heading level outside 1..3', () => {
    const doc = { ...good, blocks: [{ t: 'heading', level: 4, text: [] }] };
    expect(() => validateDoc(doc)).toThrow(/level/);
  });

  it('names the index of the offending block', () => {
    const doc = { ...good, blocks: [good.blocks[0], { t: 'nope' }] };
    expect(() => validateDoc(doc)).toThrow(/blocks\[1\]/);
  });

  it('rejects a table with no columns', () => {
    // Every other column check compares against head's length, so all of them
    // pass trivially for an empty head — this is the one malformed table that
    // used to get through, and each renderer then had to survive it. Rejecting
    // it once here is cheaper than three renderers learning to.
    const doc = { ...good, blocks: [{ t: 'table', head: [], align: [], rows: [] }] };
    expect(() => validateDoc(doc)).toThrow(/blocks\[0\]\.head/);
    expect(() => validateDoc(doc)).toThrow(/at least one column/);
  });

  it('accepts an ordered list with a positive integer start', () => {
    const doc = { ...good, blocks: [{ t: 'list', ordered: true, depth: 0, items: [[]], start: 3 }] };
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('rejects a list start that is not a positive integer', () => {
    const doc = { ...good, blocks: [{ t: 'list', ordered: true, depth: 0, items: [[]], start: 0 }] };
    expect(() => validateDoc(doc)).toThrow(/blocks\[0\]\.start/);
  });

  it('accepts a well-formed heatmap block', () => {
    expect(() => validateDoc({
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'heatmap', style: 'scale', rows: [{ label: 'Electrical', values: [8, 8, 0] }] }],
    })).not.toThrow();
  });

  it('refuses a heatmap whose rows disagree about the week count', () => {
    expect(() => validateDoc({
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'heatmap', style: 'scale', rows: [
        { label: 'A', values: [1, 2] }, { label: 'B', values: [1] },
      ] }],
    })).toThrow(/week/);
  });

  it('refuses an unknown heatmap style, a negative value, and an empty matrix', () => {
    const mk = (over: object) => ({
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'heatmap', style: 'scale', rows: [{ label: 'A', values: [1] }], ...over }],
    });
    expect(() => validateDoc(mk({ style: 'rainbow' }))).toThrow(/style/);
    // fill was removed as a style; it must be refused like any other unknown
    // name, never silently accepted or rendered as something else.
    expect(() => validateDoc(mk({ style: 'fill' }))).toThrow(/fill/);
    expect(() => validateDoc(mk({ rows: [{ label: 'A', values: [-1] }] }))).toThrow(/values\[0\]/);
    expect(() => validateDoc(mk({ rows: [] }))).toThrow(/at least one row/);
  });
});
