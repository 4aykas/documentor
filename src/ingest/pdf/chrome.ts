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

/** True if every text seen at a position is the same word for word (a
 *  letterhead line, an address block, a static footer caption), or the same
 *  once its digits are stripped out AND what's left holds no letters (a page
 *  number: "3 / 12" becomes "2 / 12" on the next page, but the " / " around
 *  the digits does not move).
 *
 *  Both guards on the stripped form are load-bearing, not decoration. Drop
 *  the "no letters" guard and "Turnover 1"/"Turnover 2" — ordinary body
 *  content whose only difference is a trailing number — passes the same
 *  test as "1 / 2"/"2 / 2", and a real line of body text gets treated as
 *  furniture-shaped. Drop the "non-empty" guard and a bare value column
 *  ("1"/"2", no template around it at all) passes too, which is exactly
 *  the table-first-column mistake this rule exists to avoid. A page number
 *  with no punctuation and no fixed prefix around it — "1", "2" alone — is
 *  consequently indistinguishable from a quantity column and is not caught
 *  here; that's a real gap, accepted because guessing wrong the other way
 *  loses a table's own data. */
function sameFurnitureText(texts: readonly string[]): boolean {
  if (texts.every((t) => t === texts[0])) return true;
  const stripped = texts.map((t) => t.replace(/\d+/g, ''));
  if (!stripped.every((s) => s === stripped[0])) return false;
  const template = stripped[0]!;
  return template.length > 0 && !/[a-zA-Z]/.test(template);
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

  // Pass one: a candidate is a position that repeats on every page AND
  // carries furniture-shaped text there (see sameFurnitureText). Position
  // alone is too weak a test — a table split across pages has its own rows
  // at the same y on every page too — and that weakness is exactly what
  // used to leave pass two with no genuine body content to anchor against.
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
    return presentOnPages.get(k)?.size === pages.length && sameFurnitureText(textsAtKey.get(k)!);
  };

  // Pass two: the body band is the y-range spanned by the runs that are NOT
  // candidates — real content, now that pass one no longer lets a reflowing
  // table pass as furniture. A candidate outside that band is furniture; a
  // candidate inside it (a column header reprinted atop every page's table)
  // stays, because it sits among the very content that defines "inside".
  const content = all.filter((r) => !candidate(r));
  if (content.length === 0) {
    // Every run on the page repeats both position and text, so there is no
    // non-candidate content left to draw a band from — no honest way to
    // tell furniture from body. Keeping everything, and saying so, is the
    // same refusal-to-guess as the single-page case above.
    return {
      body: pages.map((p) => [...p]),
      dropped: ['page furniture was not looked for: every run repeats both position and text on every page, so there was no body content left to tell furniture from, and everything was kept'],
    };
  }
  const top = Math.max(...content.map((r) => r.y));
  const bottom = Math.min(...content.map((r) => r.y));
  const isChrome = (r: TextRun): boolean => candidate(r) && (r.y > top || r.y < bottom);
  const body = pages.map((p) => p.filter((r) => !isChrome(r)));
  const removed = pages.reduce((n, p) => n + p.filter(isChrome).length, 0);
  const dropped = removed > 0
    ? [`page furniture: ${removed} run(s) repeating outside the body on all ${pages.length} pages (letterhead, footer, page numbers)`]
    : [];
  return { body, dropped };
}
