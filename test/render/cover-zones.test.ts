import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/ir/types.js';
import { partitionCoverBlocks, ruleIndexes, splitAtFirstPagebreak } from '../../src/render/cover-zones.js';

const p = (v: string): Block => ({ t: 'para', text: [{ t: 'text', v }] });
const rule: Block = { t: 'rule' };
const pagebreak: Block = { t: 'pagebreak' };

describe('ruleIndexes', () => {
  it('finds every rule, in order', () => {
    const blocks = [p('a'), rule, p('b'), rule, p('c')];
    expect(ruleIndexes(blocks)).toEqual([1, 3]);
  });

  it('is empty when there is no rule', () => {
    expect(ruleIndexes([p('a'), p('b')])).toEqual([]);
  });
});

describe('partitionCoverBlocks', () => {
  it('with no rule, puts everything in `flowing` and leaves panel/foot empty', () => {
    const blocks = [p('a'), p('b')];
    expect(partitionCoverBlocks(blocks, ruleIndexes(blocks))).toEqual({ panel: [], flowing: blocks, foot: [] });
  });

  it('with one rule, splits panel/flowing and leaves foot empty', () => {
    const blocks = [p('a'), rule, p('b'), p('c')];
    expect(partitionCoverBlocks(blocks, ruleIndexes(blocks))).toEqual({
      panel: [p('a')],
      flowing: [p('b'), p('c')],
      foot: [],
    });
  });

  it('with two rules, splits panel/flowing/foot around the first and last', () => {
    const blocks = [p('a'), rule, p('b'), rule, p('c')];
    expect(partitionCoverBlocks(blocks, ruleIndexes(blocks))).toEqual({
      panel: [p('a')],
      flowing: [p('b')],
      foot: [p('c')],
    });
  });

  it('with more than two rules, only the first and the last matter — an interior rule flows as an ordinary block', () => {
    const blocks = [p('a'), rule, p('b'), rule, p('c'), rule, p('d')];
    const idxs = ruleIndexes(blocks);
    expect(idxs).toEqual([1, 3, 5]);
    expect(partitionCoverBlocks(blocks, idxs)).toEqual({
      panel: [p('a')],
      flowing: [p('b'), rule, p('c')],
      foot: [p('d')],
    });
  });

  it('tolerates an empty panel or foot when a rule sits at either end', () => {
    const blocks = [rule, p('a'), rule];
    expect(partitionCoverBlocks(blocks, ruleIndexes(blocks))).toEqual({ panel: [], flowing: [p('a')], foot: [] });
  });
});

describe('splitAtFirstPagebreak', () => {
  it('keeps every block in pageBlocks when there is no pagebreak', () => {
    const blocks = [p('a'), p('b')];
    expect(splitAtFirstPagebreak(blocks)).toEqual({ pageBlocks: blocks, restBlocks: [] });
  });

  it('splits before the first pagebreak, keeping the marker itself in restBlocks', () => {
    const blocks = [p('a'), pagebreak, p('b'), pagebreak, p('c')];
    expect(splitAtFirstPagebreak(blocks)).toEqual({
      pageBlocks: [p('a')],
      restBlocks: [pagebreak, p('b'), pagebreak, p('c')],
    });
  });
});
