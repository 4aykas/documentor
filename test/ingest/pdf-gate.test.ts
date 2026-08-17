import { describe, expect, it } from 'vitest';
import { assertNoDivergence, docTokens, tokenise } from '../../src/ingest/pdf/gate.js';
import type { Doc } from '../../src/ir/types.js';

describe('tokenise', () => {
  it('normalises the spaces a PDF hides in numbers', () => {
    expect(tokenise('€ 4 500,00')).toEqual(['€', '4', '500,00']);
    expect(tokenise('soft­hyphen')).toEqual(['softhyphen']);
    expect(tokenise('  two   words \n')).toEqual(['two', 'words']);
  });

  it('turns the fi/fl ligature glyphs back into two letters', () => {
    expect(tokenise('ﬁnancial ﬂow')).toEqual(['financial', 'flow']);
  });
});

describe('docTokens', () => {
  it('reads a table row-major, which is the order a mis-placed value changes', () => {
    const cell = (v: string) => [{ t: 'text' as const, v }];
    const doc: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{
        t: 'table', head: [cell('A'), cell('B')],
        rows: [[cell('1'), cell('2')], [cell('3'), cell('4')]], align: ['l', 'l'],
      }],
    };
    expect(docTokens(doc)).toEqual(['A', 'B', '1', '2', '3', '4']);
  });

  it('reads paragraphs, headings, lists, quotes and code in block order', () => {
    const text = (v: string) => [{ t: 'text' as const, v }];
    const doc: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [
        { t: 'heading', level: 1, text: text('Title here') },
        { t: 'para', text: text('a paragraph') },
        { t: 'list', ordered: false, depth: 0, items: [text('one'), text('two')] },
        { t: 'quote', paras: [text('a quote')] },
        { t: 'code', text: 'a b' },
        { t: 'rule' },
        { t: 'image', src: 'x.png', alt: 'nothing to say' },
      ],
    };
    expect(docTokens(doc)).toEqual([
      'Title', 'here', 'a', 'paragraph', 'one', 'two', 'a', 'quote', 'a', 'b',
    ]);
  });
});

describe('assertNoDivergence', () => {
  it('passes when the sequences match', () => {
    expect(() => assertNoDivergence(['a', '1'], ['a', '1'])).not.toThrow();
  });

  it('passes on two empty sequences', () => {
    expect(() => assertNoDivergence([], [])).not.toThrow();
  });

  it('names the first divergence, with both sides', () => {
    expect(() => assertNoDivergence(['Labor', '608'], ['Labor', '806']))
      .toThrow(/token 2.*608.*806/s);
  });

  it('names a value the reader lost', () => {
    expect(() => assertNoDivergence(['a', 'b', 'c'], ['a', 'c'])).toThrow(/token 2/);
  });

  it('names a value the reader gained, not a value that never diverged', () => {
    expect(() => assertNoDivergence(['a', 'b'], ['a', 'b', 'c'])).toThrow(/token 3/);
  });

  it('reports the earliest divergence, not a later one that also differs', () => {
    expect(() => assertNoDivergence(['a', 'x', 'y'], ['a', 'z', 'w'])).toThrow(/token 2.*"x".*"z"/s);
  });

  it('a moved value shows up at the index it moved to, not just any diff', () => {
    // "1" and "2" swap columns: row-major order changes at token 1, not
    // merely "these sequences differ somewhere".
    expect(() => assertNoDivergence(['1', '2', '3'], ['2', '1', '3'])).toThrow(/token 1: source says "1", the assembled document says "2"/);
  });
});
