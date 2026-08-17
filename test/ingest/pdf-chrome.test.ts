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
      { texts: ['TEBIN.PRO Sp. z o.o.'], yTop: 800, yBottom: 800, pages: 2 },
      { texts: ['1 / 2', '2 / 2'], yTop: 40, yBottom: 40, pages: 2 },
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
      'repeated across 2 page(s) at y=800: TEBIN.PRO Sp. z o.o. — dropAbovePt below 800 or dropBelowPt above 800 would remove it',
      'repeated across 2 page(s) at y=40: 1 / 2, 2 / 2 — dropAbovePt below 40 or dropBelowPt above 40 would remove it',
    ]);
  });

  it('with an empty rule on a single page: body is unchanged and dropped says why nothing was looked for', () => {
    const page: TextRun[] = [run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Body', 60, 500)];
    const { body, dropped } = splitChrome([page], {});
    expect(body).toEqual([page]);
    expect(dropped).toEqual(['page furniture was not looked for: a single page has no repetition to compare against, so everything on it was kept']);
  });

  // --- dropAbovePt removes the letterhead and nothing else: the four
  // layouts that killed every earlier position-based rule (round-3 review's
  // C-1..C-4 — a totals row, a digit-varying table near an edge, a page
  // whose non-candidate content collapsed to a single point, and a
  // two-column heading) must all now survive trivially, because nothing
  // is inferred any more. Reconstructed from the review's own descriptions
  // (the coordinates in the original review report are not preserved in
  // this repository), each paired with a letterhead so the same declared
  // rule is exercised against all four. ---

  it('drops only the letterhead, leaving a totals row untouched (C-1: totals row)', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(n === 1 ? 'Widget Alpha' : 'Widget Beta', 60, 700),
      run(n === 1 ? '$10.00' : '$20.00', 400, 700),
      run('Total:', 300, 640),
      run(n === 1 ? '$100.00' : '$200.00', 400, 640),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 790 });
    expect(body[0]!.map((r) => r.text)).toEqual(['Widget Alpha', '$10.00', 'Total:', '$100.00']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Widget Beta', '$20.00', 'Total:', '$200.00']);
    expect(dropped).toEqual(['page furniture: 2 run(s) removed by the declared rule, across 2 page(s): TEBIN.PRO Sp. z o.o.']);
  });

  it('drops only the letterhead, leaving a digit-varying data table near an edge untouched (C-2: Revenue shape)', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(n === 1 ? 'Turnover 1000' : 'Turnover 2000', 60, 60),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 790 });
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover 1000']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover 2000']);
    expect(dropped).toEqual(['page furniture: 2 run(s) removed by the declared rule, across 2 page(s): TEBIN.PRO Sp. z o.o.']);
  });

  it('drops only the letterhead, leaving a page whose body is a single line untouched (C-3: band collapses to a point)', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(n === 1 ? 'Only line January' : 'Only line February', 60, 600),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 790 });
    expect(body[0]!.map((r) => r.text)).toEqual(['Only line January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Only line February']);
    expect(dropped).toEqual(['page furniture: 2 run(s) removed by the declared rule, across 2 page(s): TEBIN.PRO Sp. z o.o.']);
  });

  it('drops only the letterhead, leaving a two-column heading untouched (C-4: two-column heading)', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('Chapter', 60, 700),
      run(n === 1 ? 'One' : 'Two', 300, 700),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], { dropAbovePt: 790 });
    expect(body[0]!.map((r) => r.text)).toEqual(['Chapter', 'One']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Chapter', 'Two']);
    expect(dropped).toEqual(['page furniture: 2 run(s) removed by the declared rule, across 2 page(s): TEBIN.PRO Sp. z o.o.']);
  });

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
});
