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
 *  text seen there (sorted, uncapped — capping is a presentation concern of
 *  the advisory text, not of this data); `x`, `yTop`/`yBottom` are the small
 *  range the raw coordinates collapsed into once merged within
 *  POSITION_TOL of one another (`x` is reported as its cluster's mean since
 *  a block is one column; the y-range can be wider when the source's own
 *  rule wobbles by a point or two). */
export type RepeatedBlock = { texts: string[]; x: number; yTop: number; yBottom: number; pages: number };

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

/** How many distinct texts a single line of output — one block's advisory
 *  line, or the removal report's summary — names before it switches to a
 *  count. A repeated position that carries a genuinely distinct text per
 *  page (a running total, say) can accumulate hundreds of them over a long
 *  document; a single 14KB line is not a report, it is the kind of wall
 *  nobody reads. The run/text COUNT stays exact regardless of the cap —
 *  that is what actually answers "did this do what I asked" or "is this
 *  worth declaring a rule against." */
const LISTING_CAP = 20;

/** How many distinct repeated-block lines the advisory prints before it
 *  switches to a count. A page can carry hundreds of separately-clustered
 *  positions (every cell of a wide table, say, each technically "repeated"
 *  once digit-stripped); left uncapped, one call was measured at 3000
 *  advisory lines and 362,072 characters for a single document. Capped
 *  independently of LISTING_CAP because the two failure shapes are
 *  different: LISTING_CAP bounds one line getting too WIDE, this bounds the
 *  whole advisory getting too TALL. */
const ADVISORY_BLOCK_CAP = 20;

/** Groups a set of coordinates into clusters no more than TOL apart from
 *  the cluster's ANCHOR — its first (lowest) member — never from whichever
 *  member was added last. Anchoring to the last member lets a cluster drift:
 *  a run at 800, 798.5, 797, 795.5, ... each only TOL apart from its
 *  immediate neighbour chains an entire 300-row, 1.5pt-leaded page into one
 *  "block" spanning 450pt, and the advisory then recommends a threshold
 *  that would delete most of the body. Anchoring to the first member bounds
 *  every cluster to at most 2*TOL wide, which a 2pt-wobble page rule (the
 *  case TOL exists for) never approaches. */
function clusterMeans(values: readonly number[], tol: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let anchor = Number.NaN;
  let cluster: number[] = [];
  const flush = (): void => {
    if (cluster.length === 0) return;
    const mean = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    for (const v of cluster) map.set(v, mean);
  };
  for (const v of sorted) {
    if (cluster.length > 0 && v - anchor > tol) {
      flush();
      cluster = [];
    }
    if (cluster.length === 0) anchor = v;
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
  const xAtKey = new Map<string, number>();
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
      if (!xAtKey.has(k)) xAtKey.set(k, xMeans.get(r.x)!);
    }
  });

  // Presence is required on EVERY page, not merely more than one — a block
  // seen on 9 of 10 pages is exactly the shape a reflowing table's own
  // content takes when a page break happens to fall differently, and
  // reporting it as "repeated" would recommend removing a row that is not
  // furniture at all.
  const blocks: RepeatedBlock[] = [];
  for (const [k, onPages] of presentOnPages) {
    if (onPages.size !== pages.length) continue;
    const texts = textsAtKey.get(k)!;
    const stripped0 = stripDigits(texts[0]!);
    if (!texts.every((t) => stripDigits(t) === stripped0)) continue;
    const ys = yValuesAtKey.get(k)!;
    blocks.push({
      texts: [...new Set(texts)].sort(),
      x: xAtKey.get(k)!,
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

/** Renders a list of texts (already deduplicated by the caller) capped at
 *  LISTING_CAP, with an exact count of what was left out. Shared by the
 *  removal report and the advisory — both were, at different points, found
 *  to only apply this cap in one of the two places. */
function formatTextList(texts: readonly string[]): string {
  if (texts.length <= LISTING_CAP) return texts.join(', ');
  return `${texts.slice(0, LISTING_CAP).join(', ')}, …and ${texts.length - LISTING_CAP} more`;
}

function formatAdvisoryLine(b: RepeatedBlock): string {
  const at = b.yTop === b.yBottom ? `y=${b.yTop}` : `y ${b.yBottom}-${b.yTop}`;
  // No page count here: every reported block is on every page, by the
  // definition findRepeated applies before it exists as a block at all, so
  // restating the total would read as evidence of something that isn't in
  // question. `x` is what actually disambiguates two blocks that share a y
  // (a totals caption and its value, say, sitting on the same line).
  return `repeated block at ${at}, x=${b.x}: ${formatTextList(b.texts)} — dropAbovePt below ${b.yBottom} or dropBelowPt above ${b.yTop} would remove it`;
}

/** The advisory as a whole, capped at ADVISORY_BLOCK_CAP lines. */
function formatAdvisory(blocks: readonly RepeatedBlock[]): string[] {
  const shown = blocks.slice(0, ADVISORY_BLOCK_CAP).map(formatAdvisoryLine);
  if (blocks.length > ADVISORY_BLOCK_CAP) {
    shown.push(`…and ${blocks.length - ADVISORY_BLOCK_CAP} more repeated block(s), not shown`);
  }
  return shown;
}

/** A declared threshold has to be a real, finite number before it is
 *  trusted with a strict comparison. `rule.dropAbovePt !== undefined` alone
 *  admits `null` (`r.y > null` coerces to `r.y > 0` and empties the whole
 *  document), `Infinity`/`-Infinity` (removes nothing, or everything, and
 *  says nothing about why), and a numeric string (coerces and "works" until
 *  it silently doesn't). `NaN` fails every comparison and reports a clean
 *  page. There is no caller of this module yet, so none of this is live —
 *  but a config file or a CLI flag is the very next thing to call it, and
 *  JSON produces `null` for an omitted number constantly. */
function validateRule(rule: ChromeRule): void {
  for (const key of ['dropAbovePt', 'dropBelowPt'] as const) {
    const value = rule[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`documentor: ChromeRule.${key} must be a finite number, got ${String(value)}`);
    }
  }
  if (rule.dropAbovePt !== undefined && rule.dropBelowPt !== undefined && rule.dropAbovePt <= rule.dropBelowPt) {
    // dropAbovePt removes y > dropAbovePt; dropBelowPt removes y <
    // dropBelowPt. The two are OR'd, so once dropAbovePt <= dropBelowPt
    // there is no y left that satisfies neither — the "keep window" is
    // empty or inverted, and the rule silently empties the document. This
    // is overwhelmingly a transposition, not an intentional empty page.
    throw new Error(
      `documentor: ChromeRule.dropAbovePt (${rule.dropAbovePt}) must be greater than dropBelowPt (${rule.dropBelowPt}) — as given, every run on the page is removed by one or the other; the two values are probably transposed`,
    );
  }
}

/** The declared rule matched the page's repetition but removed nothing —
 *  the number given doesn't reach any run in this document. That is
 *  different information from "no rule was declared" and from "nothing
 *  repeats here," and reporting it as either would read as a clean run to
 *  an operator who mistyped a threshold. */
function formatInert(rule: ChromeRule, allYs: readonly number[]): string {
  if (allYs.length === 0) return 'the declared rule removed nothing — this document has no runs to check it against';
  const parts: string[] = [];
  if (rule.dropAbovePt !== undefined) {
    parts.push(`dropAbovePt=${rule.dropAbovePt} is above every run in this document (the highest run is at y=${Math.max(...allYs)})`);
  }
  if (rule.dropBelowPt !== undefined) {
    parts.push(`dropBelowPt=${rule.dropBelowPt} is below every run in this document (the lowest run is at y=${Math.min(...allYs)})`);
  }
  return `the declared rule removed nothing — ${parts.join('; ')}`;
}

export function splitChrome(pages: TextRun[][], rule: ChromeRule): ChromeSplit {
  validateRule(rule);
  const hasRule = rule.dropAbovePt !== undefined || rule.dropBelowPt !== undefined;

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
      dropped: [`page furniture: ${removed} run(s) removed by the declared rule, across ${pages.length} page(s): ${formatTextList([...droppedTexts].sort())}`],
    };
  }

  // Nothing was removed. Three distinct reasons can produce that, and they
  // are not interchangeable: a rule was declared and simply didn't reach
  // anything (inert — the operator needs to know their number was wrong,
  // not read the same report an empty rule would produce); no rule was
  // declared at all (the advisory is the whole point); or there was nothing
  // to observe in the first place (a single page, or none).
  const lines: string[] = [];
  if (hasRule) {
    lines.push(formatInert(rule, pages.flat().map((r) => r.y)));
  }

  if (pages.length === 0) {
    lines.push('no pages were given: there is nothing to report');
  } else if (pages.length === 1) {
    lines.push('page furniture was not looked for: a single page has no repetition to compare against, so everything on it was kept');
  } else {
    const blocks = findRepeated(pages);
    if (blocks.length === 0) {
      lines.push('no repeated block was found across pages: nothing on this document looked like page furniture');
    } else {
      lines.push(...formatAdvisory(blocks));
    }
  }

  return { body, dropped: lines };
}
