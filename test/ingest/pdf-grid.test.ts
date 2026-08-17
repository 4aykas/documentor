import { describe, expect, it } from 'vitest';
import { findGrid, tableFrom } from '../../src/ingest/pdf/grid.js';
import type { Grid } from '../../src/ingest/pdf/grid.js';
import type { Rect, TextRun } from '../../src/ingest/pdf/geometry.js';

/** A 2-column, 3-row grid of drawn cells. */
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
const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('findGrid', () => {
  it('takes the boundaries the rectangles agree on', () => {
    const g = findGrid(drawn());
    expect(g).not.toBeNull();
    expect(g!.xs).toEqual([50, 200, 400]);
    // Four drawn boundaries plus the implied top, one median gap above.
    expect(g!.ys).toEqual([700, 720, 740, 760, 780]);
  });

  it('adds the top boundary a bottom-ruled table never draws', () => {
    // Three rules under three rows, as any typeset table draws them — the
    // shape this project's own renderer produces. Without an implied top the
    // first row's text falls outside the grid and is lost.
    const rule = (y: number): Rect[] => [
      { x0: 50, x1: 200, y0: y, y1: y + 0.5 },
      { x0: 200, x1: 400, y0: y, y1: y + 0.5 },
    ];
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
    // Twenty edges 1.5pt apart, MERGE = 2pt. Anchoring to the cluster's
    // first member breaks a new cluster every second edge (0, 1.5 fit
    // within 2 of the anchor; 3 does not). Anchoring to whichever edge was
    // added last never breaks at all, since every step is only 1.5pt —
    // chrome.ts's clusterMeans hit exactly this bug: a whole 300-row page
    // collapsed into "one block" 450pt tall. Ten two-member clusters, not
    // one twenty-member cluster, is the property that rules that out here.
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
});
