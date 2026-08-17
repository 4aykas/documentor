// The grid comes from what the document draws, never from where its text
// happens to line up. Clustering text by x would read an unruled table and
// would also, now and then, read a two-column page as a table — which is the
// failure this project refuses to ship. A drawn boundary is data.

import type { Rect, TextRun } from './geometry.js';

export type Grid = { xs: number[]; ys: number[] };
export type GridTable = { rows: string[][]; usedRuns: Set<TextRun> };

/** How many rectangles must share an edge before it counts as a boundary.
 *  Two is enough to mean "drawn deliberately"; the real files repeat their
 *  column edges 24-26 times, so nothing here is delicate. */
const MIN_REPEAT = 2;
/** Edges closer together than this are the same drawn line. A rule is drawn
 *  as a thin filled rectangle, so its two long edges arrive as two numbers a
 *  fraction of a point apart — measured at 661 and 662 for a 0.5pt rule on
 *  this project's own output. Treating them as two boundaries invents a
 *  1pt-tall row between them. */
const MERGE = 2;

/** Clusters sorted values within MERGE of one another and keeps their mean,
 *  the same discipline chrome.ts's clusterMeans uses for the same reason:
 *  anchoring to the group's first member, never to whichever value was
 *  added last, so a long run of closely-spaced edges cannot chain into one
 *  cluster spanning far more than MERGE. */
function boundaries(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && v - last[0]! <= MERGE) last.push(v);
    else groups.push([v]);
  }
  return groups
    .filter((g) => g.length >= MIN_REPEAT)
    .map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

export function findGrid(rects: readonly Rect[]): Grid | null {
  const xs = boundaries(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = boundaries(rects.flatMap((r) => [r.y0, r.y1]));
  // Two boundaries make one column; a table needs at least one column and one
  // row, and anything less than that is not a grid but a stray box.
  if (xs.length < 2 || ys.length < 2) return null;
  // A typeset table draws a rule UNDER each row, so n rows arrive as n
  // boundaries and the top row has no upper edge — its text would fall
  // outside the grid and be lost. Measured on this project's own table:
  // rules at 706.5, 684 and 661.5 against a header at y=715. The implied top
  // is one more row's worth above the highest rule, taken from the rules'
  // own median gap, so it comes from drawn geometry and nothing else.
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
  return { xs, ys: median > 0 ? [...ys, ys[ys.length - 1]! + median] : ys };
}

export function tableFrom(grid: Grid, runs: readonly TextRun[]): GridTable {
  const { xs, ys } = grid;
  const cols = xs.length - 1;
  const rowCount = ys.length - 1;
  const cells: TextRun[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: cols }, () => [] as TextRun[]));
  const usedRuns = new Set<TextRun>();
  // Half-open bands [edges[i], edges[i+1]) partition the grid's interior
  // with no gap between one band and the next, so a run whose x AND y both
  // sit inside the grid's outer extent is guaranteed a cell — the silent
  // loss the brief warns against (a run inside the grid landing in no cell)
  // cannot happen by construction. Only a run outside the outer extent
  // returns -1 and is left alone, which is the "outside" case the tests
  // check for directly.
  const band = (edges: number[], v: number): number => {
    for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i]! && v < edges[i + 1]!) return i;
    return -1;
  };
  for (const r of runs) {
    const c = band(xs, r.x);
    const y = band(ys, r.y);
    if (c < 0 || y < 0) continue;
    cells[y]![c]!.push(r);
    usedRuns.add(r);
  }
  // ys ascend but a page reads downward, so the last band is the top row.
  const rows = cells
    .map((row) => row.map((rs) => rs.sort((a, b) => a.x - b.x).map((r) => r.text).join(' ').trim()))
    .reverse()
    // findGrid's implied top boundary (see its own comment) is unconditional:
    // it is needed whenever a table draws only bottom rules, but a table
    // that already draws full cells has its top row closed by a real edge,
    // and the implied band above it then catches no run at all. Dropping a
    // band only when EVERY one of its cells is empty costs nothing — no run
    // is ever in a fully-empty band, so usedRuns is unaffected — and it is
    // what keeps the two shapes (bottom-ruled vs. fully-boxed) from needing
    // two different code paths in findGrid itself.
    .filter((row) => row.some((cell) => cell !== ''));
  return { rows, usedRuns };
}
