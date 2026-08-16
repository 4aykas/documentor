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
 *  survives that. This is a measured number, not a chosen one. */
const POSITION_TOL = 2;

/** The fraction of a sheet, measured in from either edge, that page
 *  furniture lives in. A totals row sits roughly three quarters of the page
 *  away from the nearest edge; a real letterhead or footer sits within
 *  about a twentieth of it. Anywhere between roughly 8% and 40% draws the
 *  same line on every document this reader has been checked against — a
 *  constant with a wide safe range, not a value fitted to one layout. This
 *  and POSITION_TOL are the only two tunable numbers left in this module.
 *
 *  Do not read this as sufficient by itself. Two failed designs on the way
 *  to this rule are why it is not: a band-only test (rounds 1-2) mistakes a
 *  table's own repeating row for furniture, because a table's first column
 *  repeats position exactly as a letterhead does; a margin-only test on its
 *  own eats nothing on a landscape sheet whose short dimension makes an
 *  ordinary title sit inside the margin fraction, and, worse, it eats a
 *  candidate that happens to sit within this fraction of the edge even when
 *  it is genuinely body content sitting inside a band that reaches that far
 *  down the page (a dense table's last few rows, say). Only the CONJUNCTION
 *  of "outside the body band" and "inside this margin" survives every case
 *  this module has been run against; each half is load-bearing on its own
 *  fixtures, not decoration on the other's. */
const MARGIN_FRACTION = 0.15;

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
  if (!Number.isFinite(heightPt) || heightPt <= 0) {
    // A bad height doesn't fail loudly on its own: a negative or zero value
    // makes every margin distance <= 0, which beats every band comparison
    // and turns every repeating position into furniture (a repeated column
    // header vanishes silently); NaN loses every comparison instead, so
    // nothing is ever dropped and a page full of furniture is reported
    // clean. Both are exactly the silent-loss failure this reader exists to
    // prevent, so this is refused up front instead.
    throw new Error(`documentor: page height must be a finite positive number, got ${heightPt}`);
  }

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
  // This is only ever a "might be furniture" signal. Two earlier rounds of
  // this module tried to make pass one ALSO decide furniture from body, by
  // further restricting which stripped texts count (no bare digits, no
  // letters left in the template). Both restrictions were wrong the same
  // way: a totals row's static "Total:" caption and a page footer caption
  // are the same shape under any text-only rule, and no amount of
  // pattern-matching on the text separates them, because the text genuinely
  // does not. Deciding furniture is pass two's job, using geometry pass one
  // does not have.
  //
  // The per-key work below is memoised: candidate() used to re-derive its
  // answer, and re-spread its text array, on every call from every pass,
  // which made the whole module quadratic in run count — 26s at 40k runs,
  // and it did not finish at 101k. Each key's membership and text list are
  // built with a single push per run, and each key's candidate verdict is
  // computed once and cached.
  const presentOnPages = new Map<string, Set<number>>();
  const textsAtKey = new Map<string, string[]>();
  pages.forEach((page, pageIndex) => {
    for (const r of page) {
      const k = key(r);
      let onPages = presentOnPages.get(k);
      if (!onPages) {
        onPages = new Set();
        presentOnPages.set(k, onPages);
      }
      onPages.add(pageIndex);
      let texts = textsAtKey.get(k);
      if (!texts) {
        texts = [];
        textsAtKey.set(k, texts);
      }
      texts.push(r.text);
    }
  });
  const candidateByKey = new Map<string, boolean>();
  const candidate = (r: TextRun): boolean => {
    const k = key(r);
    const cached = candidateByKey.get(k);
    if (cached !== undefined) return cached;
    let result = presentOnPages.get(k)?.size === pages.length;
    if (result) {
      const texts = textsAtKey.get(k)!;
      const stripped0 = texts[0]!.replace(/\d+/g, '');
      result = texts.every((t) => t.replace(/\d+/g, '') === stripped0);
    }
    candidateByKey.set(k, result);
    return result;
  };

  if (!all.some((r) => !candidate(r))) {
    // Every run repeats both position and text on every page, so there is
    // no non-candidate content anywhere to measure a band or a margin
    // against — no honest way to tell furniture from body. Keeping
    // everything, and saying so, is the same refusal-to-guess as the
    // single-page case above.
    return {
      body: pages.map((p) => [...p]),
      dropped: ['page furniture was not looked for: every run repeats both position and text on every page, so there was no body content left to tell furniture from, and everything was kept'],
    };
  }

  // Pass two: furniture is a candidate that BOTH lies outside the body band
  // (the y-range spanned by that page's own non-candidate runs) AND sits
  // within the page's outer margin (see MARGIN_FRACTION for why neither
  // test alone is enough). The band is computed per page, not pooled across
  // the document — pooling lets one page's outlier content decide another
  // page's band, which is exactly the kind of cross-page leakage this
  // reader exists to avoid. On the margin boundary itself, a tie is not
  // furniture: the comparison below is strict, so a candidate exactly
  // MARGIN_FRACTION of the page from its nearer edge is kept. This project
  // treats keeping on a tie as correct — the module would rather under-
  // detect furniture than lose real content on a coin flip.
  const droppedTexts = new Set<string>();
  const body: TextRun[][] = [];
  let removed = 0;
  for (const page of pages) {
    const contentYs = page.filter((r) => !candidate(r)).map((r) => r.y);
    const top = contentYs.length > 0 ? Math.max(...contentYs) : undefined;
    const bottom = contentYs.length > 0 ? Math.min(...contentYs) : undefined;
    const kept: TextRun[] = [];
    for (const r of page) {
      const inMargin = Math.min(r.y, heightPt - r.y) < MARGIN_FRACTION * heightPt;
      const outsideBand = top !== undefined && bottom !== undefined && (r.y > top || r.y < bottom);
      if (candidate(r) && inMargin && outsideBand) {
        removed += 1;
        droppedTexts.add(r.text);
      } else {
        kept.push(r);
      }
    }
    body.push(kept);
  }

  // Naming a category ("letterhead, footer, page numbers") claims knowledge
  // this reader does not have; it never read the text to classify it that
  // way. Listing what was actually dropped, deduplicated and sorted for a
  // deterministic message, lets a reader check the claim against the page.
  const dropped = removed > 0
    ? [`page furniture: ${removed} run(s) removed across ${pages.length} pages: ${[...droppedTexts].sort().join(', ')}`]
    : [];
  return { body, dropped };
}
