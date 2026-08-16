// A re-issued document gets its theme's letterhead drawn for it. Carrying the
// source's own would print the address twice, so the source's has to be
// recognised — without knowing what a letterhead says, because the reader has
// no idea what any given company puts in one.
//
// The rule is position, in two passes. See the design document.

import type { TextRun } from './geometry.js';

export type ChromeSplit = { body: TextRun[][]; dropped: string[] };

/** Two runs are "the same place" if they land within this many points of one
 *  another, on either axis. A fixed 1pt grid sounds equivalent but is not:
 *  measured on this project's own output, a 0.5pt page rule puts one column
 *  at x=661 on one page and x=662 on the next, and rounding keeps those as
 *  two distinct positions instead of the one they visually are. Clustering
 *  nearby values and using their mean, instead of a grid cell, is what
 *  survives that. */
const POSITION_TOL = 2;

/** How much bigger than the page's own type a vertical gap has to be before
 *  it stops reading as "the next line" and starts reading as a margin. A
 *  paragraph's own line spacing is roughly one to two times its point size;
 *  a letterhead-to-body or body-to-footer gap is a deliberate blank strip,
 *  wider by a large margin. 3x is comfortably past ordinary line spacing and
 *  comfortably short of a genuine margin, for the documents this reader has
 *  been run against — there is no PDF spec value to derive it from, so this
 *  is a judgment call, not a measured constant. */
const GAP_OF_LINES = 3;

/** Groups a set of coordinates into clusters no more than TOL apart between
 *  neighbours (chained, not windowed from one fixed value — so 660, 661.5,
 *  663 is one smear, not two clusters both claiming 661.5) and returns a
 *  lookup from each original value to its cluster's mean. */
function clusterMeans(values: readonly number[], tol: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let cluster: number[] = [];
  const flush = (): void => {
    if (cluster.length === 0) return;
    const mean = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    for (const v of cluster) map.set(v, mean);
  };
  for (const v of sorted) {
    if (cluster.length > 0 && v - cluster[cluster.length - 1]! > tol) {
      flush();
      cluster = [];
    }
    cluster.push(v);
  }
  flush();
  return map;
}

/** Same idea as clusterMeans, but keeps each group's members rather than
 *  collapsing them to a mean — pass two needs to know which candidate
 *  Y-positions travel together, not just where their centre sits. */
function gapGroups(values: readonly number[], gap: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  let current: number[] = [];
  for (const v of sorted) {
    if (current.length > 0 && v - current[current.length - 1]! > gap) {
      groups.push(current);
      current = [];
    }
    current.push(v);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function splitChrome(pages: TextRun[][]): ChromeSplit {
  if (pages.length < 2) {
    // Nothing repeats, so nothing can be identified. Keeping everything is
    // the honest outcome; saying so is what stops a doubled letterhead from
    // being a surprise.
    return {
      body: pages.map((p) => [...p]),
      dropped: ['page furniture was not looked for: a single page has no repetition to compare against, so everything on it was kept'],
    };
  }

  const all = pages.flat();
  const xMeans = clusterMeans(all.map((r) => r.x), POSITION_TOL);
  const yMeans = clusterMeans(all.map((r) => r.y), POSITION_TOL);
  const key = (r: TextRun): string => `${xMeans.get(r.x)}:${yMeans.get(r.y)}`;

  // Pass one: positions present on every page. This alone cannot separate a
  // letterhead from a table's own first column — both repeat position on
  // every page — so everything found here is only a candidate.
  const seen = new Map<string, number>();
  for (const page of pages) {
    for (const k of new Set(page.map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const candidate = (r: TextRun): boolean => seen.get(key(r)) === pages.length;
  const candidates = all.filter(candidate);

  // Pass two: candidates cluster into vertical bands (a letterhead's lines
  // sit close together; a footer sits alone near the bottom; a table's
  // repeating column sits inside the body). The bands at the very top and
  // very bottom of the page are furniture; whatever is left between them is
  // the body, no matter how many separate candidate positions it contains.
  const maxSize = Math.max(...all.map((r) => r.sizePt));
  const candidateYs = [...new Set(candidates.map((r) => yMeans.get(r.y)!))];
  const groups = gapGroups(candidateYs, GAP_OF_LINES * maxSize);

  const furnitureYs = new Set<number>();
  if (groups.length >= 3) {
    // A band at both extremes: header above, footer below, body in the
    // middle — drop both, regardless of which one happens to hold more text.
    for (const y of groups[0]!) furnitureYs.add(y);
    for (const y of groups[groups.length - 1]!) furnitureYs.add(y);
  } else if (groups.length === 2) {
    // Only one extreme band, so there is no interior left to anchor "the
    // middle" against — a single lone band could be a header with no
    // footer, or a footer with no header. Volume is the tie-breaker: a
    // letterhead or a footer is a handful of short lines; the body is most
    // of the page's text. On an exact tie, the higher band goes — a
    // letterhead-only page is the more common shape than a footer-only one,
    // and this only matters when the two bands are otherwise indistinguishable.
    const runCount = (g: number[]): number => candidates.filter((r) => g.includes(yMeans.get(r.y)!)).length;
    const [lower, upper] = groups as [number[], number[]];
    const furniture = runCount(lower) < runCount(upper) ? lower : upper;
    for (const y of furniture) furnitureYs.add(y);
  }
  // groups.length <= 1: every candidate sits in one band, so there is
  // nothing to compare it against. Keeping it all is the safe default —
  // this reader would rather under-detect furniture than lose body text.

  const isChrome = (r: TextRun): boolean => candidate(r) && furnitureYs.has(yMeans.get(r.y)!);
  const body = pages.map((p) => p.filter((r) => !isChrome(r)));
  const removed = pages.reduce((n, p) => n + p.filter(isChrome).length, 0);
  const dropped = removed > 0
    ? [`page furniture: ${removed} run(s) repeating outside the body on all ${pages.length} pages (letterhead, footer, page numbers)`]
    : [];
  return { body, dropped };
}
