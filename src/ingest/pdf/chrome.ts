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
 *  survives that. This is the only tunable number left in this module, and
 *  it is a measured one, not a guess. */
const POSITION_TOL = 2;

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

export function splitChrome(pages: TextRun[][], heightPt: number): ChromeSplit {
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

  // Pass one: a candidate is a position that repeats on every page and
  // carries the same text there once its digits are stripped out — a static
  // caption stays a candidate trivially (nothing to strip); a page number
  // ("3 / 12" -> "2 / 12") becomes one because only the digits move.
  //
  // Two rounds of this module tried to make pass one ALSO decide furniture
  // from body, by further restricting which stripped texts count (no bare
  // digits, no letters left in the template). Both restrictions were wrong
  // in the same way: a totals row's static "Total:" caption and a page
  // footer are the same shape under any text-only rule — an identical
  // caption repeated at a fixed position — and no amount of pattern-matching
  // on the text separates them, because the text genuinely does not. Pass
  // one is now only this: text-and-position repetition. It does not — and
  // structurally cannot — decide furniture on its own; that is pass two's
  // job, and pass two has geometry to work with that pass one does not.
  const presentOnPages = new Map<string, Set<number>>();
  const textsAtKey = new Map<string, string[]>();
  pages.forEach((page, pageIndex) => {
    for (const r of page) {
      const k = key(r);
      if (!presentOnPages.has(k)) presentOnPages.set(k, new Set());
      presentOnPages.get(k)!.add(pageIndex);
      textsAtKey.set(k, [...(textsAtKey.get(k) ?? []), r.text]);
    }
  });
  const candidate = (r: TextRun): boolean => {
    const k = key(r);
    if (presentOnPages.get(k)?.size !== pages.length) return false;
    const stripped = textsAtKey.get(k)!.map((t) => t.replace(/\d+/g, ''));
    return stripped.every((s) => s === stripped[0]);
  };

  // Pass two: furniture is a candidate that sits closer to its page edge
  // than to the nearest run that is not a candidate. This is what makes the
  // totals-row-vs-footer question decidable at all: a totals row sits a
  // line or two below the last body row and a long way from the bottom of
  // the page; a footer sits a long way from the last body row and a few
  // points above the bottom of the page. Nothing about their TEXT tells
  // them apart — "Total:" and a footer caption are both static captions —
  // but their physical position on the page does, once the page's own
  // height is in hand to measure against. Without heightPt there is no
  // "distance to the edge" to compare against, and a totals row and a
  // footer are provably indistinguishable; that is why this parameter
  // exists and must not be removed.
  const content = all.filter((r) => !candidate(r));
  if (content.length === 0) {
    // Every run on the page repeats both position and text, so there is no
    // non-candidate content left to measure a distance against — no honest
    // way to tell furniture from body. Keeping everything, and saying so,
    // is the same refusal-to-guess as the single-page case above.
    return {
      body: pages.map((p) => [...p]),
      dropped: ['page furniture was not looked for: every run repeats both position and text on every page, so there was no body content left to tell furniture from, and everything was kept'],
    };
  }
  const contentYs = content.map((r) => r.y);
  const distanceToContent = (y: number): number => Math.min(...contentYs.map((cy) => Math.abs(cy - y)));
  const distanceToEdge = (y: number): number => Math.min(y, heightPt - y);
  const isChrome = (r: TextRun): boolean => candidate(r) && distanceToEdge(r.y) < distanceToContent(r.y);

  const body = pages.map((p) => p.filter((r) => !isChrome(r)));
  const removed = pages.reduce((n, p) => n + p.filter(isChrome).length, 0);
  const dropped = removed > 0
    ? [`page furniture: ${removed} run(s) repeating outside the body on all ${pages.length} pages (letterhead, footer, page numbers)`]
    : [];
  return { body, dropped };
}
