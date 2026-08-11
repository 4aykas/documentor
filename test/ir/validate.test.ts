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
});
