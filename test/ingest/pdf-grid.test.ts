import { describe, expect, it } from 'vitest';
import { findGrid, tableFrom } from '../../src/ingest/pdf/grid.js';
import type { Grid } from '../../src/ingest/pdf/grid.js';
import type { Rect, TextRun } from '../../src/ingest/pdf/geometry.js';

/** A 2-column, 3-row grid of drawn cells: every cell its own rectangle,
 *  both its top and its bottom edge really drawn — a fully-boxed table,
 *  not a bottom-ruled one. */
const drawn = (): Rect[] => {
  const xs = [50, 200, 400];
  const ys = [700, 720, 740, 760];
  const out: Rect[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      out.push({ x0: xs[c]!, x1: xs[c + 1]!, y0: ys[r]!, y1: ys[r + 1]! });
    }
  }
  return out;
};
/** A single-column, or single-row, boxed table: one full rect per cell,
 *  same construction `drawn()` uses for a 2-column grid. Used for I1's
 *  outer-edge cases, where one axis has only one rectangle's worth of
 *  repetition at its extreme. */
const boxed = (xs: number[], ys: number[]): Rect[] => {
  const out: Rect[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      out.push({ x0: xs[c]!, x1: xs[c + 1]!, y0: ys[r]!, y1: ys[r + 1]! });
    }
  }
  return out;
};
/** A bottom-ruled table: each row's rule arrives as two half-width, thin
 *  rectangles, the shape this project's own renderer produces. */
const rule = (y: number): Rect[] => [
  { x0: 50, x1: 200, y0: y, y1: y + 0.5 },
  { x0: 200, x1: 400, y0: y, y1: y + 0.5 },
];
const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('findGrid', () => {
  it('takes the boundaries the rectangles agree on, and adds no phantom top to a closed box', () => {
    const g = findGrid(drawn());
    expect(g).not.toBeNull();
    expect(g!.xs).toEqual([50, 200, 400]);
    // drawn() rects close their own top (row 2 spans 740..760 for real), so
    // no implied boundary is added on top of an already-closed box.
    expect(g!.ys).toEqual([700, 720, 740, 760]);
  });

  it('adds the top boundary a bottom-ruled table never draws', () => {
    // Three rules under three rows, as any typeset table draws them — the
    // shape this project's own renderer produces. Without an implied top the
    // first row's text falls outside the grid and is lost.
    const g = findGrid([...rule(661.5), ...rule(684), ...rule(706.5)]);
    expect(g).not.toBeNull();
    expect(g!.ys).toEqual([661.75, 684.25, 706.75, 729.25]);
    // Ruling 4's measured case: the header at y=715 must be admitted by the
    // implied top, and the document title at y=736 must stay excluded.
    expect(715).toBeLessThan(g!.ys[g!.ys.length - 1]!);
    expect(736).toBeGreaterThan(g!.ys[g!.ys.length - 1]!);
  });

  it('reads a rule\'s two long edges as one boundary', () => {
    // A 0.5pt rule arrives as y=661 and y=662; two boundaries there would
    // invent a 1pt-tall row.
    const g = findGrid([
      { x0: 50, x1: 200, y0: 661, y1: 662 }, { x0: 200, x1: 400, y0: 661, y1: 662 },
      { x0: 50, x1: 200, y0: 700, y1: 701 }, { x0: 200, x1: 400, y0: 700, y1: 701 },
    ]);
    expect(g!.ys).toHaveLength(3); // two rules, plus the implied top
  });

  it('returns null when nothing is drawn twice — the refusal the design rests on', () => {
    expect(findGrid([{ x0: 0, x1: 10, y0: 0, y1: 10 }])).toBeNull();
    expect(findGrid([])).toBeNull();
  });

  it('does not chain a long run of closely-spaced edges into one cluster', () => {
    // Twenty edges 1.5pt apart, TOL = 2pt. Anchoring to the cluster's first
    // member breaks a new cluster every second edge (0, 1.5 fit within 2 of
    // the anchor; 3 does not). Anchoring to whichever edge was added last
    // never breaks at all, since every step is only 1.5pt — chrome.ts's
    // clusterMeans hit exactly this bug: a whole 300-row page collapsed
    // into "one block" 450pt tall. Ten two-member clusters, not one
    // twenty-member cluster, is the property that rules that out here.
    const ys: Rect[] = [];
    for (let i = 0; i < 20; i++) {
      const y = 700 + i * 1.5;
      ys.push({ x0: 50, x1: 200, y0: y, y1: y }, { x0: 200, x1: 400, y0: y, y1: y });
    }
    const g = findGrid(ys);
    expect(g).not.toBeNull();
    // 10 merged boundaries from the drawn edges, plus the implied top.
    expect(g!.ys).toHaveLength(11);
  });

  it('does not read one rectangle drawn twice (fill + stroke) as a table', () => {
    // A fill plus a stroke of the same box is the commonest construct in a
    // PDF. Without deduping identical rectangles first, MIN_REPEAT can't
    // tell "two rectangles agree" from "one rectangle drawn twice", and a
    // paragraph of ordinary prose boxed this way gets read as a table.
    const box: Rect = { x0: 50, x1: 550, y0: 600, y1: 700 };
    expect(findGrid([box, { ...box }])).toBeNull();
  });

  it('keeps the outer edge of a fully-boxed column even though only one row touches it', () => {
    // A thin, single-column table: three rows, each its own full-width
    // rectangle. The outermost y (700, 760) is touched by only one row's
    // rectangle each; the interior ys (720, 740) are each touched by two.
    // Without I1's fix, MIN_REPEAT alone drops the outer edges and the
    // bottom row's run is lost.
    const g = findGrid(boxed([50, 400], [700, 720, 740, 760]));
    expect(g).not.toBeNull();
    expect(g!.ys).toEqual([700, 720, 740, 760]);
  });

  it('keeps the outer edge of a fully-boxed row even though only one column touches it', () => {
    // A thin, single-row table: three columns, each its own full-height
    // rectangle. The outermost x (50, 500) is touched by only one column's
    // rectangle each.
    const g = findGrid(boxed([50, 200, 350, 500], [700, 730]));
    expect(g).not.toBeNull();
    expect(g!.xs).toEqual([50, 200, 350, 500]);
  });

  it('takes a true median gap, not the upper-middle value an even count picks by index', () => {
    // Three rules with an IRREGULAR gap between them (10pt, then 30pt).
    // gaps[Math.floor(n/2)] on a 2-element array picks index 1 — the
    // larger gap — which is indistinguishable from always taking the max.
    // A true median averages the two middle gaps: (10+30)/2 = 20, giving
    // an implied top of 640.25 + 20 = 660.25 — neither the min-gap answer
    // (650.25) nor the max-gap answer (670.25).
    const g = findGrid([...rule(600), ...rule(610), ...rule(640)]);
    expect(g).not.toBeNull();
    expect(g!.ys[g!.ys.length - 1]!).toBeCloseTo(660.25, 5);
  });

  it('documents the tall-header limitation: a header taller than the body rows falls outside the implied top', () => {
    // Body rows 20pt apart, as measured on the real document. A header
    // taller than the body — the ordinary case for a real table — sits
    // well above the implied top a body-height median produces. This
    // module refuses loud rather than reaching for text position to patch
    // it: the header run stays outside the grid, and the downstream
    // token-completeness gate refuses the document for a missing token
    // instead of silently shipping a table with no header.
    const g = findGrid([...rule(600), ...rule(620), ...rule(640)])!;
    const impliedTop = g.ys[g.ys.length - 1]!;
    const tallHeaderY = 680;
    expect(tallHeaderY).toBeGreaterThan(impliedTop);
  });

  it('refuses a grid with only one boundary on an axis, not just zero', () => {
    // Two zero-height rects sharing the same y (700) on both sides — a
    // degenerate construction, but a real one: it produces a single
    // qualifying y-cluster and nothing else, so ys.length === 1. A `< 1`
    // refusal check lets this through as a "grid" with zero rows
    // (rowCount = ys.length - 1 = 0); only `< 2` catches it.
    const g = findGrid([
      { x0: 50, x1: 200, y0: 700, y1: 700 },
      { x0: 200, x1: 400, y0: 700, y1: 700 },
    ]);
    expect(g).toBeNull();
  });
});

describe('tableFrom', () => {
  it('puts each run in the cell its position falls inside, top row first', () => {
    const g = findGrid(drawn())!;
    const runs = [
      run('Turnover', 60, 745), run('3253', 210, 745),
      run('Labor', 60, 725), run('1536', 210, 725),
      run('Other', 60, 705), run('196', 210, 705),
    ];
    const t = tableFrom(g, runs);
    expect(t.rows).toEqual([
      ['Turnover', '3253'],
      ['Labor', '1536'],
      ['Other', '196'],
    ]);
    expect(t.usedRuns.size).toBe(6);
  });

  it('joins two runs that share a cell, in reading order', () => {
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('Office rent', 60, 745), run('& utilities', 130, 745)]);
    expect(t.rows[0]![0]).toBe('Office rent & utilities');
  });

  it('leaves a run outside the grid alone', () => {
    const g = findGrid(drawn())!;
    const outside = run('A note under the table', 60, 400);
    const t = tableFrom(g, [outside]);
    expect(t.usedRuns.has(outside)).toBe(false);
  });

  it('puts a run sitting exactly on a shared boundary in the band above it', () => {
    // Bands are half-open [edges[i], edges[i+1]) so a value exactly on a
    // shared internal edge belongs to only one of the two bands it touches
    // — the one above, matching a baseline that sits precisely on a ruled
    // line reading as that line's row rather than the row below it. A run
    // in both rows, or in neither, is exactly the silent-loss/duplication
    // this half-open convention exists to rule out.
    const g: Grid = { xs: [0, 10], ys: [0, 10, 20] };
    const t = tableFrom(g, [run('Lower', 5, 5), run('Boundary', 5, 10)]);
    expect(t.rows).toEqual([['Boundary'], ['Lower']]);
  });

  it('bands a wrapped cell into lines by y before reading order within each line', () => {
    // A wrapped label, exactly as measured: "Office rent and" / "utilities
    // charged", five runs at two different y values, all inside one cell.
    // Sorting every run in the cell by x alone (ignoring which line it's
    // on) scrambles this into "Office utilities rent charged and".
    const g: Grid = { xs: [0, 300], ys: [0, 800] };
    const runs = [
      run('Office', 60, 705), run('rent', 110, 705), run('and', 150, 705),
      run('utilities', 60, 685), run('charged', 120, 685),
    ];
    const t = tableFrom(g, runs);
    expect(t.rows).toEqual([['Office rent and utilities charged']]);
  });

  it('sorts runs within a line by x, regardless of input order', () => {
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('rent', 130, 745), run('Office', 60, 745)]);
    expect(t.rows[0]![0]).toBe('Office rent');
  });

  it('trims the assembled cell text', () => {
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('  Office  ', 60, 745)]);
    expect(t.rows[0]![0]).toBe('Office');
  });

  it('sizes rows from ys.length - 1, not ys.length', () => {
    // The boundary count is always one more than the row count; mutating
    // rowCount to ys.length adds a permanently-empty phantom band that no
    // run can ever reach (band() can never return an index that high).
    const g: Grid = { xs: [0, 10], ys: [0, 10, 20] };
    const t = tableFrom(g, [run('A', 5, 5), run('B', 5, 15)]);
    expect(t.rows).toHaveLength(2);
  });

  it('keeps a genuine blank spacer row between two sections of a closed box', () => {
    const g = findGrid(boxed([50, 400], [700, 720, 740, 760]))!;
    // Top and bottom rows carry text; the middle row is a real blank
    // spacer, not a byproduct of an implied boundary. It must survive.
    const t = tableFrom(g, [run('Top', 100, 750), run('Bottom', 100, 710)]);
    expect(t.rows).toEqual([['Top'], [''], ['Bottom']]);
  });

  it('gives two pages of the same table shape the same row count regardless of which cells are blank', () => {
    // A cross-page join splices by row index. If a blank top row on page 1
    // were dropped, page 1 would report one row fewer than page 2's
    // identically-shaped grid, and the splice would land on the wrong row.
    const shape = (): Rect[] => boxed([50, 400], [700, 720, 740]);
    const page1 = tableFrom(findGrid(shape())!, [run('OnlyBottom', 100, 710)]);
    const page2 = tableFrom(findGrid(shape())!, [run('Top', 100, 730), run('Bottom', 100, 710)]);
    expect(page1.rows).toHaveLength(page2.rows.length);
    expect(page1.rows).toEqual([[''], ['OnlyBottom']]);
  });

  it('keeps a whitespace-only run\'s row present, matching usedRuns', () => {
    // A run trimming to '' still occupies a real cell; dropping its row
    // while leaving the run in usedRuns would claim the run was placed
    // somewhere that then doesn't exist in `rows`.
    const g = findGrid(boxed([50, 400], [700, 720, 740]))!;
    const whitespace = run('   ', 100, 730);
    const t = tableFrom(g, [whitespace, run('Bottom', 100, 710)]);
    expect(t.usedRuns.has(whitespace)).toBe(true);
    expect(t.rows).toEqual([[''], ['Bottom']]);
  });

  it('does not drop a row just because a run landed 0.1pt into the neighbouring band', () => {
    const g = findGrid(boxed([50, 400], [700, 720, 740]))!;
    // 720.1 lands just inside the upper band [720, 740), leaving the lower
    // band [700, 720) empty — the row count must still be 2.
    const t = tableFrom(g, [run('Nudged', 100, 720.1)]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows).toEqual([['Nudged'], ['']]);
  });

  it('keeps the run at the bottom of a thin single-column boxed table', () => {
    const g = findGrid(boxed([50, 400], [700, 720, 740, 760]))!;
    const t = tableFrom(g, [run('BottomRow', 100, 710)]);
    expect(t.rows).toEqual([[''], [''], ['BottomRow']]);
  });

  it('keeps the runs at both ends of a thin single-row boxed table', () => {
    const g = findGrid(boxed([50, 200, 350, 500], [700, 730]))!;
    const t = tableFrom(g, [run('Left', 60, 710), run('Right', 490, 710)]);
    expect(t.rows).toEqual([['Left', '', 'Right']]);
  });
});
