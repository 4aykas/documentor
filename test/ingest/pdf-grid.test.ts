import { describe, expect, it } from 'vitest';
import { findGrid, rectComponents, tableFrom } from '../../src/ingest/pdf/grid.js';
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
 *  repetition at its extreme. Every cell touches its neighbour, so this is
 *  always one connected component under Ruling 18. */
const boxed = (xs: number[], ys: number[]): Rect[] => {
  const out: Rect[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      out.push({ x0: xs[c]!, x1: xs[c + 1]!, y0: ys[r]!, y1: ys[r + 1]! });
    }
  }
  return out;
};
/** A single row of a table drawn ENTIRELY from disconnected thin rules: the
 *  rule arrives as two half-width, thin rectangles. Ruling 19: neither
 *  motivating document is built this way — measured directly, TEBIN P&L
 *  ACCOUNT.pdf page 1 draws 145 rectangles and NONE is 2pt or thinner (125
 *  are 19.51pt tall, one per cell); 2026 Revenue Estimation.pdf draws 89,
 *  88 taller than 2pt. A table built from nothing but spaced-apart rules
 *  like this one is out of scope and refused — see the refusal tests
 *  below, which use exactly this helper with no bridging element, since a
 *  rule stack cannot be told apart from an unrelated heading rule sharing
 *  the same page margins by geometry alone. */
const rule = (y: number): Rect[] => [
  { x0: 50, x1: 200, y0: y, y1: y + 0.5 },
  { x0: 200, x1: 400, y0: y, y1: y + 0.5 },
];
/** A single rectangle, at the shared column midpoint (x0=199, x1=201, well
 *  inside every rule's own 50-400 span so it can never become a spurious
 *  x-extreme), spanning from just outside the bottommost real cluster to
 *  just outside the topmost — physically overlapping every rule between
 *  them (so rectComponents never splits the sequence) without spanning the
 *  TOPMOST pair of boundaries specifically: with three or more real
 *  clusters this rectangle's own edges sit near the FIRST and LAST
 *  clusters only, never the second-to-last one closedAtTop actually checks
 *  against, so it cannot be mistaken for the table's own closed top. This
 *  is NOT a claim that any real document draws a connecting rectangle like
 *  this — it exists purely to exercise the median-gap and closedAtTop
 *  ARITHMETIC on data that is honestly, if synthetically, one physically
 *  connected structure; a genuinely disconnected rule stack (Ruling 19,
 *  out of scope) is refused elsewhere in this file with no such aid. */
const bridge = (ys: number[]): Rect => ({
  x0: 199, x1: 201, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1.5,
});
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

  it('Ruling 19: a table drawn entirely from disconnected thin rules is out of scope and refused', () => {
    // This was ruling 4's original motivating shape: rules 22.5pt apart,
    // measured as "706.5, 684, 661.5" against a header at y=715. That
    // measurement turned out to be wrong — re-measured directly against
    // the actual PDF, both motivating documents draw full, abutting cells
    // (TEBIN P&L ACCOUNT.pdf page 1: 145 rectangles, none 2pt or thinner,
    // 125 at 19.51pt tall, one per cell; 2026 Revenue Estimation.pdf: 89
    // rectangles, 88 taller than 2pt), so this shape describes no document
    // this reader is built for. It stays refused rather than resurrected
    // with a bridging element, because a rule stack sharing a table's
    // margins is geometrically identical to a heading rule sharing the
    // same margins — only intent tells them apart, and this project
    // refuses rather than guesses when only intent would decide (see
    // findGrid's own comment at the degenerate-refusal site).
    const g = findGrid([...rule(661.5), ...rule(684), ...rule(706.5)]);
    expect(g).toBeNull();
  });

  it('Ruling 19: a 0.5pt rule\'s two long edges merging into one boundary does not, by itself, make a disconnected rule stack a table', () => {
    // Two isolated rules, 39pt apart: even though each rule's own y0/y1
    // (0.5pt apart) correctly merge to a single boundary — the general
    // EDGE_TOL merging this project relies on everywhere — two isolated
    // rules never touch each other, so this stays refused, same as the
    // three-rule case above.
    const g = findGrid([
      { x0: 50, x1: 200, y0: 661, y1: 662 }, { x0: 200, x1: 400, y0: 661, y1: 662 },
      { x0: 50, x1: 200, y0: 700, y1: 701 }, { x0: 200, x1: 400, y0: 700, y1: 701 },
    ]);
    expect(g).toBeNull();
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
    // Consecutive edges are only 1.5pt apart, well within EDGE_TOL, so the
    // whole run is one connected component regardless.
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

  it('refuses when a single rectangle\'s own two edges land in one cluster — repetition needs a second rectangle', () => {
    // Two independent, unrelated horizontal rules — a heading rule, a
    // footer rule far below it — each ONE rectangle whose y0 and y1
    // (0.5pt apart) fall inside a single EDGE_TOL cluster on their own.
    // Counting raw edge VALUES per cluster sees "2" there and calls the
    // y-axis repeated; counting DISTINCT rectangles correctly sees 1,
    // refuses that axis, and refuses the whole grid with it — rather than
    // reading the gap between an unrelated heading and footer as one
    // giant row spanning the whole page. (They also don't touch each
    // other, so Ruling 18 would refuse this on its own; this test pins the
    // distinct-rectangle counting specifically, within a single rectangle.)
    const heading: Rect = { x0: 50, x1: 400, y0: 706, y1: 706.5 };
    const footer: Rect = { x0: 50, x1: 400, y0: 600, y1: 600.5 };
    expect(findGrid([heading, footer])).toBeNull();
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
    // Three rule-shaped clusters with an IRREGULAR gap between them,
    // bridged into one physically connected structure by bridge() rather
    // than the disconnected rule stack Ruling 19 keeps out of scope — this
    // exercises the median ARITHMETIC in isolation, not a claim about how
    // any real table is drawn. gaps[Math.floor(n/2)] on a 2-element array
    // picks index 1 — the larger gap — which is indistinguishable from
    // always taking the max. A true median averages the two middle gaps.
    const rowYs = [600, 610, 640];
    const g = findGrid([...rowYs.flatMap(rule), bridge(rowYs)]);
    expect(g).not.toBeNull();
    const ys = g!.ys;
    const gaps = [ys[1]! - ys[0]!, ys[2]! - ys[1]!];
    const trueMedian = (Math.min(...gaps) + Math.max(...gaps)) / 2;
    // The implied top must sit exactly one true-median gap above the
    // topmost real boundary — neither the min-gap answer nor the max-gap
    // answer, both of which differ from it here since the two real gaps
    // are unequal.
    expect(gaps[0]).not.toBe(gaps[1]);
    expect(ys[3]!).toBeCloseTo(ys[2]! + trueMedian, 5);
  });

  it('R7: sorts three or more unequal gaps before taking the median, not just the two-gap case', () => {
    // Four rule-shaped clusters with three UNEQUAL gaps between them
    // (40, 10, 12 in the order the boundaries arise). The existing
    // true-median test only has two gaps (even count); with three or
    // more, `gaps[Math.floor(n/2)]` on the UNSORTED array (in the order
    // the boundaries were computed, not sorted by size) picks index 1 —
    // the SECOND gap encountered (10) — not the true middle value once
    // sorted (12, from [10, 12, 40]). Read dynamically from the actual
    // output so a bridge() perturbation of the outer clusters' means
    // can't desync the expected numbers from the real ones.
    const rowYs = [600, 640, 650, 662];
    const g = findGrid([...rowYs.flatMap(rule), bridge(rowYs)]);
    expect(g).not.toBeNull();
    const ys = g!.ys;
    const rawGaps = [ys[1]! - ys[0]!, ys[2]! - ys[1]!, ys[3]! - ys[2]!];
    const sortedMedian = [...rawGaps].sort((a, b) => a - b)[1]!;
    const unsortedPick = rawGaps[Math.floor(rawGaps.length / 2)]!;
    expect(sortedMedian).not.toBe(unsortedPick);
    expect(ys[4]!).toBeCloseTo(ys[3]! + sortedMedian, 5);
  });

  it('documents the tall-header limitation: a header taller than the body rows falls outside the implied top', () => {
    // Equal-gap rule clusters, bridged into one connected structure by
    // bridge() — see the previous test's comment on why a bridge is used
    // here and not for a table shape. A header taller than the body — the
    // ordinary case for a real table — sits well above the implied top a
    // body-height median produces. This module refuses loud rather than
    // reaching for text position to patch it: the header run stays outside
    // the grid, and the downstream token-completeness gate refuses the
    // document for a missing token instead of silently shipping a table
    // with no header.
    const rowYs = [600, 620, 640];
    const g = findGrid([...rowYs.flatMap(rule), bridge(rowYs)])!;
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

  it('R5: refuses when one axis has a genuine repeat but the other never repeats an edge at all', () => {
    // Two rectangles that ABUT (B sits directly on top of A, sharing the
    // y=10 edge — one connected component under Ruling 20) but whose x
    // values never repeat between them (0/100 from A, 20/60 from B, all
    // more than EDGE_TOL apart): the y axis has a genuine 2-rectangle
    // repeat at y=10 and computes real boundaries; the x axis has NONE.
    // Without the `qualifying.size === 0` guard in boundaries(), x's own
    // two individually-unqualified extreme clusters (0 and 100) would
    // still get forced in, producing a bogus one-column, two-row grid
    // instead of the correct refusal — this is the reviewer's own
    // escaping fixture, confirmed to reach exactly that guard.
    const a: Rect = { x0: 0, x1: 100, y0: 0, y1: 10 };
    const b: Rect = { x0: 20, x1: 60, y0: 10, y1: 20 };
    expect(findGrid([a, b])).toBeNull();
  });

  it('a page-wide background rectangle that merely CONTAINS a cell does not connect to it', () => {
    // Ruling 20's own motivating case, at the unit level: one large box
    // fully containing one small, unrelated box. Under Ruling 18's
    // overlap-based adjacency these were one component (both axes'
    // gaps negative, hence "touching"); under Ruling 20 they share no
    // EDGE at all, so rectComponents now correctly reports two separate,
    // single-rectangle components — the exact mechanism that stopped
    // both motivating documents' page-wide background rectangles from
    // gluing every mark on the page into one structure.
    const big: Rect = { x0: 0, x1: 100, y0: 0, y1: 100 };
    const small: Rect = { x0: 50, x1: 60, y0: 50, y1: 60 };
    expect(rectComponents([big, small])).toHaveLength(2);
    expect(findGrid([big, small])).toBeNull();
  });

  it('refuses a grid that collapses to a single cell (M-1): interior rules and verticals swallowed by the outer extent', () => {
    // Four full-width rules, each on its own (not touching one another
    // directly), bridged by three internal verticals spanning all of them.
    // Every interior rule position and every interior vertical is touched
    // by only ONE rectangle each (never the min or the max, never repeated
    // by a second rectangle at that exact position) and is dropped; the
    // verticals' own shared top/bottom and the rules' own shared left/right
    // survive as the only boundaries, collapsing what should be several
    // rows and columns into one merged cell.
    const rules: Rect[] = [700, 705, 710, 715].map((y) => ({ x0: 50, x1: 400, y0: y, y1: y + 0.5 }));
    const verticals: Rect[] = [50, 225, 400].map((x) => ({ x0: x - 0.5, x1: x + 0.5, y0: 698, y1: 717 }));
    expect(findGrid([...rules, ...verticals])).toBeNull();
  });

  it('does not connect two rectangles that share an x-position but sit far apart in y', () => {
    // Two independent tables sharing column margins (case 2): each half of
    // the AND in `adjacent` has to be checked independently, or dropping
    // just the y-side would silently reconnect this.
    const a: Rect = { x0: 50, x1: 200, y0: 0, y1: 20 };
    const b: Rect = { x0: 50, x1: 200, y0: 500, y1: 520 };
    expect(rectComponents([a, b])).toHaveLength(2);
  });

  it('does not connect two rectangles that share a y-position but sit far apart in x', () => {
    const a: Rect = { x0: 0, x1: 20, y0: 700, y1: 720 };
    const b: Rect = { x0: 500, x1: 520, y0: 700, y1: 720 };
    expect(rectComponents([a, b])).toHaveLength(2);
  });

  it('Case 1: a heading rule sharing a table\'s page margins does not merge with it', () => {
    // A heading rule drawn in two segments well above a boxed table, at the
    // same x margins — exactly the shape that let Ruling 17's per-axis
    // membership test through, since the heading rule repeats the table's
    // x edges. It does not physically touch the table, so it is a separate
    // component and never reaches findGridInComponent for the table at all.
    const table = boxed([50, 200, 400], [700, 720, 740]);
    const heading: Rect[] = [
      { x0: 50, x1: 200, y0: 800, y1: 800.5 }, { x0: 200, x1: 400, y0: 800, y1: 800.5 },
    ];
    const gAlone = findGrid(table);
    const gWithHeading = findGrid([...table, ...heading]);
    expect(gWithHeading).toEqual(gAlone);
  });

  it('Case 2: two independent tables sharing column margins stay separate', () => {
    const tableA = boxed([50, 200, 400], [700, 720, 740]);
    const tableB = boxed([50, 200, 400], [100, 120, 140]); // far below, same columns
    const gA = findGrid(tableA);
    const gCombined = findGrid([...tableA, ...tableB]);
    // The largest component is either table alone (both are the same
    // size here); either way the combined grid must equal ONE table's
    // grid, never a grid whose y-extent spans both.
    expect(gCombined!.ys[gCombined!.ys.length - 1]! - gCombined!.ys[0]!)
      .toBe(gA!.ys[gA!.ys.length - 1]! - gA!.ys[0]!);
  });

  it('I2/R3: a tie between two same-size components picks the geometrically topmost one, the SAME winner regardless of input order', () => {
    // tableA and tableB are the same size (4 rects each), far enough apart
    // that they never touch, and at different heights: tableA's bounding
    // box is topmost (y1 = 740 vs tableB's 140). "Lowest original
    // rectangle index" looked stable but wasn't — it is stable within one
    // array, not under reordering, so it picked "whichever the input
    // listed first" and swapped answers when the caller (or a future
    // rectComponents refactor) changed order. Geometry is a property of
    // the page, not of array order: BOTH orderings must return tableA's
    // grid, unchanged.
    const tableA = boxed([50, 200, 400], [700, 720, 740]);
    const tableB = boxed([10, 90, 130], [100, 120, 140]);
    const gAFirst = findGrid([...tableA, ...tableB]);
    const gBFirst = findGrid([...tableB, ...tableA]);
    expect(gAFirst).toEqual(findGrid(tableA));
    expect(gBFirst).toEqual(findGrid(tableA));
    expect(gAFirst).toEqual(gBFirst);
  });

  it('I2/R3: a tie on topmost y1 too breaks on leftmost x0, the SAME winner regardless of input order', () => {
    // Two same-size boxed tables at the SAME y-range (tied on the primary
    // "topmost" tie-break) but different x — a sits at x 50..400, b at x
    // 550..900, the coordinator's own reviewed example. On the pre-fix
    // index-based tie-break this measured findGrid([...a, ...b]).xs as
    // [50, 200, 400] and findGrid([...b, ...a]).xs as [550, 700, 900] —
    // order flips the answer. Leftmost x0 breaks the y1 tie instead, so
    // both orderings pick `a` (x0 = 50, left of b's 550).
    const a = boxed([50, 200, 400], [700, 720, 740]);
    const b = boxed([550, 700, 900], [700, 720, 740]);
    const gAFirst = findGrid([...a, ...b]);
    const gBFirst = findGrid([...b, ...a]);
    expect(gAFirst!.xs).toEqual([50, 200, 400]);
    expect(gBFirst!.xs).toEqual([50, 200, 400]);
    expect(gAFirst).toEqual(gBFirst);
  });

  it('Case 3: a stacked pair of same-width boxes elsewhere does not enlarge the table', () => {
    const table = boxed([200, 300, 400], [700, 720, 740]);
    const sidebarTop: Rect = { x0: 40, x1: 120, y0: 560, y1: 600 };
    const sidebarBottom: Rect = { x0: 40, x1: 120, y0: 600, y1: 640 }; // touches sidebarTop, not the table
    const gAlone = findGrid(table);
    const gWithSidebar = findGrid([...table, sidebarTop, sidebarBottom]);
    expect(gWithSidebar).toEqual(gAlone);
  });

  it('Case 4 (known, accepted limit): a shading band flush with the table\'s bottom edge genuinely touches it', () => {
    // A page-wide shading band sharing the table's left margin and flush
    // with its bottom (y1 = the table's own y0) DOES physically touch the
    // table — Ruling 18 has no way to tell, from geometry alone, whether
    // that band is part of the table or an unrelated background element,
    // and building a fourth membership rule to guess is explicitly not the
    // fix. It stays a member, and its unsupported x1 = 900 widens the
    // grid — documented here as a known, accepted limitation, not a bug to
    // chase, so the next reader does not rediscover it as one. Task 4, with
    // the components in hand, can choose to exclude it if it wants to.
    const table = boxed([200, 300, 400], [700, 720, 740]);
    const band: Rect = { x0: 200, x1: 900, y0: 660, y1: 700 };
    const g = findGrid([...table, band]);
    expect(g).not.toBeNull();
    expect(g!.xs).toContain(900);
  });

  it('I-1: a merged header cell overhanging the body comes back as a genuine component member', () => {
    // A header rect wider than the table it sits above, flush with the
    // table's own top edge — it genuinely touches the table, so under
    // Ruling 18 it belongs in the same component and its own extent
    // (wider left, wider right, taller top) is honoured.
    const table = boxed([50, 200, 350], [700, 720, 740]);
    const header: Rect = { x0: 20, x1: 380, y0: 740, y1: 780 };
    const gTableAlone = findGrid(table);
    const gWithHeader = findGrid([...table, header]);
    expect(gWithHeader).not.toEqual(gTableAlone);
    expect(gWithHeader!.xs[0]).toBe(20);
    expect(gWithHeader!.xs[gWithHeader!.xs.length - 1]).toBe(380);
    expect(gWithHeader!.ys[gWithHeader!.ys.length - 1]).toBe(780);
  });

  it('recognizes a closed box even when its edges are a fraction of a point off the cluster mean (a thick-drawn rule)', () => {
    // The top row's two half-rects have a slightly mismatched top edge
    // (740 vs 740.8) — a thick or slightly uneven rule, not perfectly
    // aligned. CLOSE_TOL has to allow for that fraction-of-a-point gap
    // between a rectangle's own edge and the cluster MEAN it contributed
    // to, or a perfectly ordinary closed box gets a phantom implied top.
    const table: Rect[] = [
      { x0: 50, x1: 400, y0: 700, y1: 720 },
      { x0: 50, x1: 200, y0: 720, y1: 740 }, { x0: 200, x1: 400, y0: 720, y1: 740.8 },
    ];
    const g = findGrid(table);
    expect(g).not.toBeNull();
    expect(g!.ys).toHaveLength(3); // no implied top: the box is closed, just not perfectly evenly
  });

  it('checks the TOP gap for closedAtTop, not an arbitrary pair of boundaries', () => {
    // A table whose BOTTOM gap is closed by a real rectangle but whose TOP
    // gap is not (a boxed bottom row, a rule-shaped top row, bridged into
    // one physically connected structure by bridge() — see the median-gap
    // test's comment on why a bridge is used here, not for a table shape).
    // Checking any pair other than the topmost two would wrongly see the
    // bottom row's real closure and skip the implied top the top row
    // actually needs.
    const bottomRow: Rect[] = [
      { x0: 50, x1: 200, y0: 700, y1: 720 }, { x0: 200, x1: 400, y0: 700, y1: 720 },
    ];
    const topRule: Rect[] = [
      { x0: 50, x1: 200, y0: 740, y1: 740.5 }, { x0: 200, x1: 400, y0: 740, y1: 740.5 },
    ];
    const g = findGrid([...bottomRow, ...topRule, bridge([700, 720, 740])]);
    expect(g).not.toBeNull();
    // 700, 720, ~740.something, plus the implied top: four boundaries.
    expect(g!.ys).toHaveLength(4);
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

  it('does not let a stray rectangle claim prose that sits nowhere near the real table', () => {
    const table = boxed([200, 300, 400], [700, 720, 740]);
    const logo: Rect = { x0: 40, y0: 500, x1: 120, y1: 560 };
    const g = findGrid([...table, logo])!;
    const prose = run('Prose between logo and table', 60, 520);
    const t = tableFrom(g, [prose, run('A', 250, 710)]);
    expect(t.usedRuns.has(prose)).toBe(false);
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

  it('bands cell lines anchored to the line\'s FIRST (topmost) run, not whichever run was added last', () => {
    // Three runs 1.5-2pt apart in y, each within LINE_TOL of its immediate
    // neighbour but not of the run two steps away. Anchoring to the first
    // (topmost) run of the current line breaks a new line at C; anchoring
    // to whichever run was added last chains all three into one line and
    // scrambles the x-order.
    const g: Grid = { xs: [0, 300], ys: [0, 800] };
    const t = tableFrom(g, [run('A', 60, 705), run('B', 200, 703.5), run('C', 10, 702)]);
    expect(t.rows).toEqual([['A B C']]);
  });

  it('bands runs into the same line even with half a point of baseline jitter', () => {
    // Half a point of baseline jitter between two runs on what is visually
    // one line is normal in extracted text; LINE_TOL = 0 would read them
    // as two separate lines and reverse their order.
    const g: Grid = { xs: [0, 300], ys: [0, 800] };
    const t = tableFrom(g, [run('B', 200, 705), run('A', 60, 704.5)]);
    expect(t.rows[0]![0]).toBe('A B');
  });

  it('sorts runs within a line by x, regardless of input order', () => {
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('rent', 130, 745), run('Office', 60, 745)]);
    expect(t.rows[0]![0]).toBe('Office rent');
  });

  it('filters a whitespace-only run out of a line, not just a literally-empty one', () => {
    // geometry.ts never hands this module a whitespace-only run today (it
    // drops those at the source), but tableFrom is exported and callable
    // directly, and this file's own earlier tests already feed it
    // whitespace deliberately. A filter on `t !== ''` lets '   ' through,
    // leaving a run of extra spaces between the real words either side.
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('A', 60, 745), run('   ', 130, 745), run('B', 190, 745)]);
    expect(t.rows[0]![0]).toBe('A B');
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

describe('rectComponents', () => {
  it('splits a page into the connected structures it actually draws', () => {
    const table = boxed([50, 200, 400], [700, 720, 740]);
    const logo: Rect = { x0: 40, y0: 500, x1: 120, y1: 560 };
    const groups = rectComponents([...table, logo]);
    expect(groups).toHaveLength(2);
    expect(groups.some((g) => g.length === table.length)).toBe(true);
    expect(groups.some((g) => g.length === 1)).toBe(true);
  });

  it('deduplicates before grouping, so a fill-plus-stroke pair is one member', () => {
    const box: Rect = { x0: 50, x1: 550, y0: 600, y1: 700 };
    const groups = rectComponents([box, { ...box }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('connects two rectangles whose perpendicular ranges touch at a single point, not just genuinely overlap', () => {
    // A touches B's shared x-edge (x=10), but their y-ranges only meet at
    // the single point y=10 (A spans 0-10, B spans 10-20) rather than
    // overlapping over a real span. The perpendicular-overlap check uses
    // "gap <= 0", not "gap < 0": a degenerate zero-width overlap still
    // counts as touching. Real table cells never present this exact shape
    // (rows fully overlap, not just at a corner), but the check has to be
    // right at the boundary it actually draws, not just in the common case.
    const a: Rect = { x0: 0, x1: 10, y0: 0, y1: 10 };
    const b: Rect = { x0: 10, x1: 20, y0: 10, y1: 20 };
    expect(rectComponents([a, b])).toHaveLength(1);
  });

  it('C2: does not crash on a large connected component (recursion depth)', () => {
    // A chain of 11,000 abutting rectangles, each touching the next — one
    // more than the measured recursive find() crash threshold. A
    // RECURSIVE find() throws `RangeError: Maximum call stack size
    // exceeded` above roughly 9,000 connected rectangles (measured
    // directly: 8,000 returns in 90ms, 10,000 throws). findGrid's contract
    // is `Grid | null`; it must never throw on input size. This is a
    // slower test than this file's usual (a few hundred ms), which is the
    // point — it exercises the actual scale that broke the recursive
    // version, not a token-sized stand-in for it.
    const chain: Rect[] = [];
    for (let i = 0; i < 11_000; i++) {
      chain.push({ x0: 0, x1: 10, y0: i * 10, y1: i * 10 + 10 });
    }
    expect(() => rectComponents(chain)).not.toThrow();
    const groups = rectComponents(chain);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(11_000);
  });
});
