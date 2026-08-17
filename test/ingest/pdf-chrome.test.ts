import { describe, expect, it } from 'vitest';
import { findRepeated, splitChrome } from '../../src/ingest/pdf/chrome.js';
import type { TextRun } from '../../src/ingest/pdf/geometry.js';

const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('findRepeated', () => {
  it('observes every position-and-text block that repeats across every page', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(`${n} / 2`, 500, 40),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),
    ];
    const blocks = findRepeated([page(1), page(2)]);
    // Sorted top of the page first. The footer's two literal texts ("1 / 2",
    // "2 / 2") group into one block because they agree once digits are
    // stripped; the varying "Turnover" line does not repeat at all (its text
    // differs beyond its digits) and is correctly absent.
    expect(blocks).toEqual([
      { texts: ['TEBIN.PRO Sp. z o.o.'], x: 400, yTop: 800, yBottom: 800, pages: 2 },
      { texts: ['1 / 2', '2 / 2'], x: 500, yTop: 40, yBottom: 40, pages: 2 },
    ]);
  });

  it('returns nothing for a single page: there is no repetition to observe', () => {
    const page: TextRun[] = [run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Body', 60, 600)];
    expect(findRepeated([page])).toEqual([]);
  });

  it('is deterministic: the same input produces the same blocks in the same order every time', () => {
    const page = (n: number): TextRun[] => [
      run('Zebra Corp', 400, 800),
      run('Alpha Ltd', 400, 788),
      run(n === 1 ? 'Body January' : 'Body February', 60, 500),
    ];
    const pages = [page(1), page(2)];
    expect(findRepeated(pages)).toEqual(findRepeated(pages));
  });

  it('does not report a block present on only some pages, even if it repeats identically where it appears', () => {
    // Present on pages 1 and 2 but not 3 — the shape a reflowing table's own
    // content can take when a page break lands differently, not furniture.
    const withBanner: TextRun[] = [run('Promo banner', 400, 800), run('Body A', 60, 500)];
    const withoutBanner: TextRun[] = [run('Body B', 60, 500)];
    const blocks = findRepeated([withBanner, withBanner, withoutBanner]);
    expect(blocks.find((b) => b.texts.includes('Promo banner'))).toBeUndefined();
  });

  it('groups positions jittered within POSITION_TOL as one repeated block', () => {
    // A 0.5pt-ish page rule wobbles a column by a point or two between
    // pages; this must still read as one position, not two.
    const page1: TextRun[] = [run('Letterhead', 400, 800)];
    const page2: TextRun[] = [run('Letterhead', 401.5, 800)];
    const blocks = findRepeated([page1, page2]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.texts).toEqual(['Letterhead']);
    expect(blocks[0]!.pages).toBe(2);
  });

  it('does not let cluster chaining merge a densely-leaded page into one giant block', () => {
    // 40 rows, 1.5pt apart, well within POSITION_TOL (2) of an immediate
    // neighbour but chaining across the whole run would collapse them into
    // one "block" spanning nearly 60pt — exactly the shape that used to
    // recommend deleting most of a dense page's body.
    const y = (i: number): number => 800 - i * 1.5;
    const page = (n: number): TextRun[] => Array.from({ length: 40 }, (_, i) => run(n === 1 ? `Row ${i} one` : `Row ${i} two`, 60, y(i)));
    // None of these rows repeat TEXT (they vary), so findRepeated reports no
    // blocks for them — the point is the intermediate clustering must not
    // throw, must stay linear-shaped, and must not silently widen every
    // row's position into one shared key that WOULD then look repeated.
    const blocks = findRepeated([page(1), page(2)]);
    expect(blocks).toEqual([]);
  });

  it('reports blocks in y-descending order regardless of scan/insertion order', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Body one' : 'Body two', 60, 500),
      run('Footer', 300, 40),
      run('Header', 300, 800),
    ];
    // 'Footer' (low y) is encountered before 'Header' (high y) while
    // scanning, so insertion order into the underlying map is Footer-first.
    // The reported order must be y-descending regardless.
    const blocks = findRepeated([page(1), page(2)]);
    expect(blocks.map((b) => b.texts[0])).toEqual(['Header', 'Footer']);
  });

  it('reports a genuinely non-degenerate y-range with yTop and yBottom the right way round', () => {
    // Every other fixture in this file has a single raw y per cluster
    // (yTop === yBottom), which cannot catch yTop/yBottom being swapped.
    // This one spans two raw values.
    const page1: TextRun[] = [run('Ruled line', 400, 661)];
    const page2: TextRun[] = [run('Ruled line', 400, 662)];
    const blocks = findRepeated([page1, page2]);
    expect(blocks).toEqual([{ texts: ['Ruled line'], x: 400, yTop: 662, yBottom: 661, pages: 2 }]);
  });
});

describe('splitChrome', () => {
  it('with an empty rule removes nothing: body is unchanged and dropped names the repeated blocks', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(`${n} / 2`, 500, 40),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),
    ];
    const pages = [page(1), page(2)];
    const { body, dropped } = splitChrome(pages, {});
    expect(body).toEqual(pages);
    expect(dropped).toEqual([
      'repeated block at y=800, x=400: TEBIN.PRO Sp. z o.o. — dropAbovePt below 800 or dropBelowPt above 800 would remove it',
      'repeated block at y=40, x=500: 1 / 2, 2 / 2 — dropAbovePt below 40 or dropBelowPt above 40 would remove it',
    ]);
  });

  it('with an empty rule on a single page: body is unchanged and dropped says why nothing was looked for', () => {
    const page: TextRun[] = [run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Body', 60, 500)];
    const { body, dropped } = splitChrome([page], {});
    expect(body).toEqual([page]);
    expect(dropped).toEqual(['page furniture was not looked for: a single page has no repetition to compare against, so everything on it was kept']);
  });

  it('reports a distinct message for a zero-page document rather than reusing the single-page message', () => {
    const { body, dropped } = splitChrome([], {});
    expect(body).toEqual([]);
    expect(dropped).toEqual(['no pages were given: there is nothing to report']);
  });

  it('states the y-range and the drop recommendation the right way round for a non-degenerate block', () => {
    // Same 661/662 fixture as findRepeated's own pinning test, but through
    // the advisory line itself: both the displayed range and the two
    // recommended threshold values must use yBottom/yTop the right way
    // round, not swapped.
    const page1: TextRun[] = [run('Ruled line', 400, 661)];
    const page2: TextRun[] = [run('Ruled line', 400, 662)];
    const { dropped } = splitChrome([page1, page2], {});
    expect(dropped).toEqual([
      'repeated block at y 661-662, x=400: Ruled line — dropAbovePt below 661 or dropBelowPt above 662 would remove it',
    ]);
  });

  it('names the x position in the advisory so two blocks sharing a y are distinguishable', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'body one' : 'body two', 60, 500),
      run('Total:', 300, 100),
      run(n === 1 ? '$100' : '$200', 400, 100),
    ];
    const { dropped } = splitChrome([page(1), page(2)], {});
    const atY100 = dropped.filter((l) => l.includes('y=100'));
    expect(atY100).toHaveLength(2);
    expect(atY100.some((l) => l.includes('x=300'))).toBe(true);
    expect(atY100.some((l) => l.includes('x=400'))).toBe(true);
  });

  // --- The four layouts that killed every earlier position-based rule
  // (round-3 review, exact coordinates from
  // .superpowers/sdd/2026-08-16-pdf-ingest/round3-broken-layouts.md), each
  // asserted with the design's actual promise: an EMPTY rule leaves them
  // completely untouched, because nothing about them is inferred any more. ---

  it('C-1: a digit-varying data table (Revenue Estimation shape) survives untouched under an empty rule', () => {
    const page = (n: number): TextRun[] => [
      run('Revenue Estimation', 300, 560),
      run(n === 1 ? 'Quarter One' : 'Quarter Two', 60, 300),
      run(n === 1 ? 'Turnover 1000' : 'Turnover 2000', 60, 50),
      run(n === 1 ? 'Costs 1500' : 'Costs 2500', 60, 30),
    ];
    const pages = [page(1), page(2)];
    const { body } = splitChrome(pages, {});
    expect(body).toEqual(pages);
  });

  it('C-2: a totals row at the bottom of an invoice survives untouched under an empty rule', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'body one' : 'body two', 60, 500),
      run('Total:', 300, 100),
      run(n === 1 ? '$100' : '$200', 400, 100),
    ];
    const pages = [page(1), page(2)];
    const { body } = splitChrome(pages, {});
    expect(body).toEqual(pages);
  });

  it('C-3: a page whose repeated content collapses to a single point survives untouched under an empty rule', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Prepared January' : 'Prepared February', 60, 400),
      run('Terms and conditions apply', 60, 100),
      run('Signature:', 60, 60),
    ];
    const pages = [page(1), page(2)];
    const { body } = splitChrome(pages, {});
    expect(body).toEqual(pages);
  });

  it('C-4: a two-column heading survives untouched under an empty rule', () => {
    const page = (n: number): TextRun[] => [
      run('Notes', 400, 750),
      run(n === 1 ? 'note one' : 'note two', 400, 730),
      run(n === 1 ? 'left A' : 'left B', 60, 700),
      run(n === 1 ? 'left C' : 'left D', 60, 100),
    ];
    const pages = [page(1), page(2)];
    const { body } = splitChrome(pages, {});
    expect(body).toEqual(pages);
  });

  // --- Declared removal: boundary strictness, combined keys, reporting ---

  it('keeps a run exactly on the declared dropAbovePt line', () => {
    // Strictly greater, not greater-or-equal: y === dropAbovePt is kept, on
    // purpose. The operator gave a number, not a zone.
    const page: TextRun[] = [run('On the line', 60, 800), run('Body', 60, 500)];
    const { body } = splitChrome([page, page], { dropAbovePt: 800 });
    expect(body[0]!.map((r) => r.text)).toEqual(['On the line', 'Body']);
    expect(body[1]!.map((r) => r.text)).toEqual(['On the line', 'Body']);
  });

  it('keeps a run exactly on the declared dropBelowPt line', () => {
    const page: TextRun[] = [run('On the line', 60, 500), run('Body', 60, 800)];
    const { body } = splitChrome([page, page], { dropBelowPt: 500 });
    expect(body[0]!.map((r) => r.text)).toEqual(['On the line', 'Body']);
    expect(body[1]!.map((r) => r.text)).toEqual(['On the line', 'Body']);
  });

  it('applies dropAbovePt and dropBelowPt together', () => {
    const page = (n: number): TextRun[] => [
      run('Letterhead', 400, 800),
      run(n === 1 ? 'Body January' : 'Body February', 60, 500),
      run(`${n} / 2`, 500, 30),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 790, dropBelowPt: 40 });
    expect(body[0]!.map((r) => r.text)).toEqual(['Body January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Body February']);
    // 2 letterhead runs + 2 footer runs = 4; three distinct texts, sorted
    // (digits sort before letters).
    expect(dropped).toEqual(['page furniture: 4 run(s) removed by the declared rule, across 2 page(s): 1 / 2, 2 / 2, Letterhead']);
  });

  it('deduplicates repeated dropped texts rather than listing each occurrence', () => {
    const page = (n: number): TextRun[] => [
      run('Letterhead', 400, 800),
      run('Letterhead', 400, 788), // same text, a different position, also above the line
      run(n === 1 ? 'Body January' : 'Body February', 60, 500),
    ];
    const { dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 700 });
    // 4 runs removed (2 positions * 2 pages) but only one distinct text.
    expect(dropped).toEqual(['page furniture: 4 run(s) removed by the declared rule, across 2 page(s): Letterhead']);
  });

  it('is deterministic and sorts the dropped listing, not insertion order', () => {
    const page = (n: number): TextRun[] => [
      run('Zebra Corp', 400, 800),
      run('Alpha Ltd', 400, 788),
      run(n === 1 ? 'Body January' : 'Body February', 60, 500),
    ];
    const pages = [page(1), page(2)];
    const first = splitChrome(pages, { dropAbovePt: 700 });
    const second = splitChrome(pages, { dropAbovePt: 700 });
    expect(first.dropped).toEqual(second.dropped);
    expect(first.dropped).toEqual(['page furniture: 4 run(s) removed by the declared rule, across 2 page(s): Alpha Ltd, Zebra Corp']);
  });

  it('caps the listing of distinct dropped texts at 20, keeping the run count exact', () => {
    const page = (n: number): TextRun[] => {
      const runs: TextRun[] = [];
      for (let i = 0; i < 25; i++) runs.push(run(`Furniture ${String(i).padStart(2, '0')}`, 60, 800));
      runs.push(run(n === 1 ? 'Body January' : 'Body February', 60, 500));
      return runs;
    };
    const { dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 700 });
    expect(dropped).toHaveLength(1);
    const [line] = dropped;
    // 25 positions * 2 pages = 50 runs removed; 25 distinct texts, capped at
    // 20 shown plus a count of the rest.
    expect(line).toMatch(/^page furniture: 50 run\(s\)/);
    expect(line).toMatch(/…and 5 more$/);
  });

  it('does not mutate the pages it was given', () => {
    const original = [[run('Letterhead', 400, 800), run('Body', 60, 500)]];
    const snapshot = JSON.parse(JSON.stringify(original)) as unknown;
    splitChrome(original, { dropAbovePt: 700 });
    expect(original).toEqual(snapshot);
  });

  // --- The inert rule: declared, but its threshold reaches nothing ---

  it('reports an inert rule instead of silently matching the empty-rule output', () => {
    const page = (n: number): TextRun[] => [run(n === 1 ? 'Body one' : 'Body two', 60, 500)];
    const pages = [page(1), page(2)];
    const { body, dropped } = splitChrome(pages, { dropAbovePt: 5000 });
    expect(body).toEqual(pages);
    expect(dropped[0]).toMatch(/declared rule removed nothing/);
    expect(dropped[0]).toContain('dropAbovePt=5000');
    expect(dropped[0]).toContain('y=500');
    // The empty-rule case must NOT produce this same output — the whole
    // point is that an operator who mistyped a threshold does not read what
    // a clean run reads.
    const emptyRule = splitChrome(pages, {});
    expect(emptyRule.dropped).not.toEqual(dropped);
  });

  it('reports an inert dropBelowPt with the lowest run in the document', () => {
    const page = (n: number): TextRun[] => [run(n === 1 ? 'Body one' : 'Body two', 60, 500)];
    const { dropped } = splitChrome([page(1), page(2)], { dropBelowPt: -5000 });
    expect(dropped[0]).toMatch(/declared rule removed nothing/);
    expect(dropped[0]).toContain('dropBelowPt=-5000');
    expect(dropped[0]).toContain('y=500');
  });

  // --- Bounding the advisory: it must not be able to grow without limit ---

  it('caps the per-line text list in a repeated block advisory', () => {
    // 25 pages, each contributing one page-number-shaped text at the same
    // position: 25 distinct literal texts grouped into one block.
    const pages = Array.from({ length: 25 }, (_, i) => [run(`${i + 1}`, 300, 50)]);
    const { dropped } = splitChrome(pages, {});
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatch(/…and 5 more/);
  });

  it('caps the number of advisory lines when many distinct positions repeat', () => {
    const page = (): TextRun[] => Array.from({ length: 25 }, (_, i) => run(`Label ${i}`, 60, 100 + i * 20));
    const { dropped } = splitChrome([page(), page()], {});
    // 20 block lines + 1 "and N more" trailer.
    expect(dropped).toHaveLength(21);
    expect(dropped[20]).toMatch(/…and 5 more repeated block\(s\)/);
  });

  // --- Input guards ---

  describe('rule validation', () => {
    const pages: TextRun[][] = [[run('A', 60, 500)], [run('B', 60, 500)]];

    it('throws naming the key when a threshold is null', () => {
      expect(() => splitChrome(pages, { dropAbovePt: null as unknown as number })).toThrow(/dropAbovePt/);
    });

    it('throws when a threshold is Infinity or -Infinity', () => {
      expect(() => splitChrome(pages, { dropBelowPt: Infinity })).toThrow(/dropBelowPt/);
      expect(() => splitChrome(pages, { dropAbovePt: -Infinity })).toThrow(/dropAbovePt/);
    });

    it('throws when a threshold is a numeric string', () => {
      expect(() => splitChrome(pages, { dropAbovePt: '100' as unknown as number })).toThrow(/dropAbovePt/);
    });

    it('throws when a threshold is NaN', () => {
      expect(() => splitChrome(pages, { dropAbovePt: Number.NaN })).toThrow(/dropAbovePt/);
    });

    it('throws on a contradictory rule with the thresholds transposed', () => {
      expect(() => splitChrome(pages, { dropAbovePt: 100, dropBelowPt: 500 })).toThrow(/transposed/);
    });

    it('throws when the thresholds are exactly equal', () => {
      expect(() => splitChrome(pages, { dropAbovePt: 300, dropBelowPt: 300 })).toThrow(/transposed/);
    });
  });
});
