// Page furniture is DECLARED, not inferred. See the design doc's
// "Identifying page furniture" section (docs/superpowers/specs/2026-08-16-
// pdf-ingest-design.md) for the full argument; the short version is that
// three position-based rules were built here, in three earlier rounds, and
// each was broken by an ordinary layout. The one that ended the argument: a
// totals row at y=100 with body at y=500, and a footer at y=100 with body at
// y=500, are the same geometry. Nothing on the page separates them. Only
// meaning does, and this module has no access to meaning.
//
// So it does two separable things instead of one guess. `findRepeated`
// OBSERVES: every position that repeats, with its text and its y-range.
// Observations can be trusted — they assert nothing about what a repeated
// position IS. `splitChrome` ACTS: it removes exactly the runs above or
// below a y its caller declared, and nothing else. No declaration, no
// removal. `documentor` re-issues documents its operator already owns; the
// operator knows their own letterhead and can say where it ends.

import type { TextRun } from './geometry.js';

/** A block whose position and text repeat across every page. An
 *  observation, not a verdict — `findRepeated` never decides that a block
 *  is furniture, only that it repeats. `texts` holds every distinct literal
 *  text seen there (sorted); `yTop`/`yBottom` is the small range the raw
 *  y-values collapsed into once merged within POSITION_TOL of one another. */
export type RepeatedBlock = { texts: string[]; yTop: number; yBottom: number; pages: number };

/** What the operator declared. Both keys optional; an absent key is simply
 *  not applied, so an empty `{}` removes nothing. */
export type ChromeRule = { dropAbovePt?: number; dropBelowPt?: number };

export type ChromeSplit = { body: TextRun[][]; dropped: string[] };

/** Two runs are "the same place" if they land within this many points of one
 *  another, on either axis. A fixed 1pt grid sounds equivalent but is not:
 *  measured on this project's own output, a 0.5pt page rule puts one column
 *  at x=661 on one page and x=662 on the next, and rounding keeps those as
 *  two distinct positions instead of the one they visually are. A measured
 *  number, not a chosen one — the only tunable constant left in this
 *  module, now that the rule it used to feed a furniture decision is gone. */
const POSITION_TOL = 2;

/** How many distinct dropped texts the removal report names before it
 *  switches to a count. A 200-page document can carry hundreds of distinct
 *  digit-varying page-number texts; printing all of them turns one
 *  `dropped` line into a multi-kilobyte wall nobody reads, while the run
 *  count — which is exact regardless of the cap — is what actually answers
 *  "did this do what I asked." */
const LISTING_CAP = 20;

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

/** Digits stripped from a text before grouping it into a block, so a page
 *  number's "1 of 12" and "2 of 12" report as ONE repeated block instead of
 *  two nearly-identical ones cluttering the advisory. This is the same
 *  stripping three earlier rounds used to DECIDE furniture; here it only
 *  groups a REPORT, and the cost of grouping something oddly is a slightly
 *  confusing line of advisory text for a human to read before writing two
 *  numbers into a config — not, as in every earlier design, a silently
 *  deleted row. */
function stripDigits(text: string): string {
  return text.replace(/\d+/g, '');
}

export function findRepeated(pages: TextRun[][]): RepeatedBlock[] {
  if (pages.length < 2) {
    // Nothing repeats, so there is nothing to observe. The caller (or a
    // human reading `dropped`) is told this in words; findRepeated itself
    // just reports no blocks.
    return [];
  }

  const all = pages.flat();
  const xMeans = clusterMeans(all.map((r) => r.x), POSITION_TOL);
  const yMeans = clusterMeans(all.map((r) => r.y), POSITION_TOL);
  const key = (r: TextRun): string => `${xMeans.get(r.x)}:${yMeans.get(r.y)}`;

  // One pass, one push per run into each map — no re-spreading an
  // accumulator array per run, which is what made an earlier version of
  // this scan quadratic. Linear in run count, same shape as before.
  const presentOnPages = new Map<string, Set<number>>();
  const textsAtKey = new Map<string, string[]>();
  const yValuesAtKey = new Map<string, number[]>();
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
      let ys = yValuesAtKey.get(k);
      if (!ys) {
        ys = [];
        yValuesAtKey.set(k, ys);
      }
      ys.push(r.y);
    }
  });

  const blocks: RepeatedBlock[] = [];
  for (const [k, onPages] of presentOnPages) {
    if (onPages.size !== pages.length) continue;
    const texts = textsAtKey.get(k)!;
    const stripped0 = stripDigits(texts[0]!);
    if (!texts.every((t) => stripDigits(t) === stripped0)) continue;
    const ys = yValuesAtKey.get(k)!;
    blocks.push({
      texts: [...new Set(texts)].sort(),
      yTop: Math.max(...ys),
      yBottom: Math.min(...ys),
      pages: onPages.size,
    });
  }

  // Deterministic order: top of the page first, ties broken by text, so the
  // same document reports the same advisory byte-for-byte on every run —
  // Map iteration order is insertion order, not a property to depend on.
  blocks.sort((a, b) => b.yTop - a.yTop || a.texts.join(' ').localeCompare(b.texts.join(' ')));
  return blocks;
}

function formatTextList(texts: ReadonlySet<string>): string {
  const sorted = [...texts].sort();
  if (sorted.length <= LISTING_CAP) return sorted.join(', ');
  return `${sorted.slice(0, LISTING_CAP).join(', ')}, …and ${sorted.length - LISTING_CAP} more`;
}

function formatAdvisoryLine(b: RepeatedBlock): string {
  const at = b.yTop === b.yBottom ? `y=${b.yTop}` : `y ${b.yBottom}-${b.yTop}`;
  return `repeated across ${b.pages} page(s) at ${at}: ${b.texts.join(', ')} — dropAbovePt below ${b.yBottom} or dropBelowPt above ${b.yTop} would remove it`;
}

export function splitChrome(pages: TextRun[][], rule: ChromeRule): ChromeSplit {
  // The declared rule is a per-run predicate; it needs no repetition and no
  // second page to make sense, so it is applied unconditionally, before
  // anything below asks whether there was anything to observe. Strictly
  // greater / strictly less: a run sitting exactly ON a declared line is
  // kept, on both sides. The operator gave a number, not a zone, and this
  // is the property that makes a declared rule trustworthy — a run at
  // exactly y=800 stays with dropAbovePt: 800, and only goes once the
  // number reads 799 or lower.
  const droppedTexts = new Set<string>();
  let removed = 0;
  const body = pages.map((page) =>
    page.filter((r) => {
      const above = rule.dropAbovePt !== undefined && r.y > rule.dropAbovePt;
      const below = rule.dropBelowPt !== undefined && r.y < rule.dropBelowPt;
      if (!above && !below) return true;
      removed += 1;
      droppedTexts.add(r.text);
      return false;
    }),
  );

  if (removed > 0) {
    return {
      body,
      dropped: [`page furniture: ${removed} run(s) removed by the declared rule, across ${pages.length} page(s): ${formatTextList(droppedTexts)}`],
    };
  }

  // Nothing was removed — either no rule was declared, or the declared
  // thresholds didn't reach anything in this particular document. Either
  // way, the useful thing left to say is the advisory: what repetition (if
  // any) exists for the operator to declare a rule against next.
  if (pages.length < 2) {
    return {
      body,
      dropped: ['page furniture was not looked for: a single page has no repetition to compare against, so everything on it was kept'],
    };
  }
  const blocks = findRepeated(pages);
  if (blocks.length === 0) {
    return { body, dropped: ['no repeated block was found across pages: nothing on this document looked like page furniture'] };
  }
  return { body, dropped: blocks.map(formatAdvisoryLine) };
}
