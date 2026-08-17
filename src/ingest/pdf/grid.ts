// The grid comes from what the document draws, never from where its text
// happens to line up. Clustering text by x would read an unruled table and
// would also, now and then, read a two-column page as a table — which is the
// failure this project refuses to ship. A drawn boundary is data.

import type { Rect, TextRun } from './geometry.js';

export type Grid = { xs: number[]; ys: number[] };
export type GridTable = { rows: string[][]; usedRuns: Set<TextRun> };

/** How many DISTINCT rectangles must share an edge before it counts as a
 *  repeated boundary. Two is enough to mean "drawn deliberately"; the real
 *  files repeat their column edges 24-26 times, so nothing here is
 *  delicate. "Distinct" is load-bearing on two fronts: a fill plus a stroke
 *  of the same box is the commonest construct in a PDF, and counting raw
 *  numbers rather than rectangles would let one box, drawn twice, pass as
 *  two boxes agreeing; separately, a single rectangle's OWN two edges
 *  landing in one cluster (its y0 and y1, 0.5pt apart) must never count as
 *  "two" on its own — repetition means a SECOND rectangle agreed, not that
 *  one rectangle has two sides. */
const MIN_REPEAT = 2;
/** Edges closer together than this are the same drawn rule — measured on a
 *  real 0.5pt rule, whose two long edges arrive as 661 and 662. Used for
 *  clustering x/y edges into one boundary, and (see `adjacent` below) for
 *  deciding whether two rectangles physically touch. */
const EDGE_TOL = 2;
/** Runs within this many points of a cell's topmost run are read as the
 *  same wrapped line of text, not a second line. The same measured value as
 *  EDGE_TOL because both come from the same physical scale — a point is a
 *  point on this page as much as on any other — not because banding a
 *  cell's text and merging a rule's two edges are the same kind of
 *  question; kept as its own constant so the two can diverge later without
 *  a comment explaining why one number now means two things. */
const LINE_TOL = 2;
/** How close a rectangle's own y0/y1 must sit to the grid's two topmost
 *  boundaries to count as actually closing the box's top for real, rather
 *  than merely landing near it by coincidence. Same measured value again,
 *  same reason for a separate name. */
const CLOSE_TOL = 2;

/** Rectangles that are byte-identical once compared field by field. A fill
 *  plus a stroke of the same box is the commonest construct in a PDF and
 *  arrives as two Rect values equal in every field; without collapsing
 *  those first, MIN_REPEAT can't tell "two rectangles agree on an edge"
 *  from "one rectangle drawn twice", and a single box drawn around a
 *  paragraph of ordinary prose gets read as a one-cell table. */
function distinctRects(rects: readonly Rect[]): Rect[] {
  const seen = new Set<string>();
  const out: Rect[] = [];
  for (const r of rects) {
    const key = `${r.x0}|${r.y0}|${r.x1}|${r.y1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function gap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(a0, b0) - Math.min(a1, b1);
}
/** Whether one interval's edge sits within EDGE_TOL of the other's — either
 *  edge of either interval, not just the "facing" pair. Two abutting table
 *  cells satisfy this at their shared edge (one's x1 equals the other's
 *  x0); two near-identical rectangles (a fill/stroke pair too different to
 *  dedupe exactly) satisfy it at every edge, since the whole rectangle is
 *  nearly the same. */
function edgeClose(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.abs(a0 - b0) <= EDGE_TOL || Math.abs(a0 - b1) <= EDGE_TOL
    || Math.abs(a1 - b0) <= EDGE_TOL || Math.abs(a1 - b1) <= EDGE_TOL;
}
/** RULING 20: adjacency means ABUTMENT, not overlap. Ruling 18's test —
 *  both axes' gaps within EDGE_TOL — treated containment as adjacency,
 *  because a rectangle fully inside another has a negative (overlapping)
 *  gap on BOTH axes, satisfying "<= EDGE_TOL" trivially. That is exactly
 *  the bug measured on both motivating documents: each draws one full-page
 *  background rectangle, which contains every cell, every logo fragment,
 *  every stray mark — and under Ruling 18's test, "contains" counted as
 *  "touches," gluing the entire page into ONE component. `rectComponents`
 *  returned exactly one component on all four real pages checked; Ruling 18
 *  was a no-op on every one of them.
 *
 *  A rectangle that merely ENCLOSES another is a backdrop, not a neighbour.
 *  Real abutment needs an edge of one within EDGE_TOL of an edge of the
 *  other — proving the two rectangles actually share a boundary line — AND
 *  the two rectangles overlapping along the PERPENDICULAR axis, proving
 *  that shared boundary is a real line segment and not two edges that
 *  merely happen to have close coordinates while the rectangles sit
 *  nowhere near each other. Side-by-side table cells abut this way (facing
 *  x-edges close, y-ranges overlap because they're on the same row);
 *  stacked cells abut the other way (facing y-edges close, x-ranges
 *  overlap because they're in the same column). A page-wide background
 *  shares no edge with a cell drawn well inside its margins, so it no
 *  longer connects to anything. Two near-identical rectangles (the
 *  commonest logo construction: a fill and a stroke a fraction of a point
 *  apart, too different for `distinctRects` to collapse into one) abut EACH
 *  OTHER — every edge of one is close to the corresponding edge of the
 *  other, and the two nearly coincide — so they form their own small
 *  component, correctly separate from the table, rather than dissolving
 *  into nothing or gluing themselves to whatever else the background
 *  happened to touch. */
function adjacent(a: Rect, b: Rect): boolean {
  const xEdgeClose = edgeClose(a.x0, a.x1, b.x0, b.x1);
  const yEdgeClose = edgeClose(a.y0, a.y1, b.y0, b.y1);
  const xOverlaps = gap1D(a.x0, a.x1, b.x0, b.x1) <= 0;
  const yOverlaps = gap1D(a.y0, a.y1, b.y0, b.y1) <= 0;
  return (xEdgeClose && yOverlaps) || (yEdgeClose && xOverlaps);
}

/** Splits a page's rectangles into connected components by physical
 *  adjacency (see `adjacent`) — the drawn structures a page actually
 *  contains, decided once, by definition, before anything asks whether any
 *  of them is a table. Exported so a caller that already understands the
 *  document's layout (Task 4) can hand each component to `findGrid`
 *  separately, rather than relying on `findGrid`'s own "biggest first"
 *  fallback below. Deduplicates its input first, same as `findGrid`, so a
 *  fill-plus-stroke pair of identical rectangles is one member, not two.
 *
 *  Adjacency-based components work on real input because real tables draw
 *  full, ABUTTING cells, not disconnected thin rules — this is a measured
 *  fact about the two documents this reader is built for, not an
 *  assumption, and it is not recoverable from the code without this note.
 *  `TEBIN P&L ACCOUNT.pdf` page 1 draws 145 rectangles and NONE is 2pt or
 *  thinner (125 are 19.51pt tall, one per cell); `2026 Revenue
 *  Estimation.pdf` draws 89 rectangles, 88 of them taller than 2pt. Every
 *  cell in both documents touches its row's neighbour, so this reader never
 *  needs to bridge a gap between separately-drawn rules — see Ruling 19
 *  (`findGridInComponent`'s degenerate-refusal comment) for the shape that
 *  is refused because it isn't this. */
export function rectComponents(rects: readonly Rect[]): Rect[][] {
  const distinct = distinctRects(rects);
  const n = distinct.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  // Iterative, not recursive: a page's worth of connected rectangles is not
  // bounded in this codebase's own terms (a totals row alone was measured
  // at 100,000+ runs in chrome.ts), and a recursive find() blows the call
  // stack around 9,000 connected rectangles (measured directly: 8,000
  // returns in 90ms, 10,000 throws RangeError). findGrid's contract is
  // `Grid | null` — it must never throw on input size, so this walks to the
  // root in a loop, then walks again to compress every visited node onto
  // it, instead of recursing on the way up.
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (parent[cur] !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (adjacent(distinct[i]!, distinct[j]!)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  // Grouped by root, then sorted EXPLICITLY by each group's own lowest
  // original index — not left as an incidental property of Map insertion
  // order or of which index union() happened to pick as a tree's root.
  // findGrid's "largest component, ties broken by lowest original index"
  // rule (see its own comment) depends on this ordering being real and
  // documented, not a coincidence of iteration order that a future
  // refactor of the union-find internals could silently break. Before this
  // was made explicit, two same-size components could pick a different
  // winner depending on which one the input happened to list first.
  const groups = new Map<number, { rects: Rect[]; minIndex: number }>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let g = groups.get(root);
    if (g === undefined) { g = { rects: [], minIndex: i }; groups.set(root, g); }
    g.rects.push(distinct[i]!);
  }
  return [...groups.values()].sort((a, b) => a.minIndex - b.minIndex).map((g) => g.rects);
}

type Cluster = { mean: number; rects: Set<number> };

/** Clusters values within EDGE_TOL of one another, anchored to each
 *  cluster's FIRST member rather than whichever value was added last —
 *  anchoring to the last value lets a long run of closely-spaced values (a
 *  page leaded 1.5pt apart, say) chain into one cluster spanning far past
 *  EDGE_TOL. This exact bug was found in the neighbouring module
 *  (chrome.ts) last week; the brief's own reference pseudocode for this
 *  file reproduced it, which is why this deliberately diverges from that
 *  pseudocode. Each cluster keeps which rectangle indices (into the
 *  caller's own rect array) contributed to it, since "how many distinct
 *  rectangles agree" is what MIN_REPEAT needs — not "how many numbers
 *  landed near each other." */
function clusterEdges(entries: readonly { value: number; rect: number }[]): Cluster[] {
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const groups: { value: number; rect: number }[][] = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && e.value - last[0]!.value <= EDGE_TOL) last.push(e);
    else groups.push([e]);
  }
  return groups.map((g) => ({
    mean: g.reduce((a, b) => a + b.value, 0) / g.length,
    rects: new Set(g.map((e) => e.rect)),
  }));
}

/** The x- or y-edges of a rectangle set, reduced to boundaries. An edge
 *  counts as a boundary either because MIN_REPEAT distinct rectangles agree
 *  on it, or because it is the extreme (outermost) edge of the whole axis —
 *  a table's outer bound is drawn by definition, and a boxed table's
 *  outermost row or column repeats its own outer edge only once (every
 *  interior row/column repeats its edges twice, against its neighbour on
 *  each side; the outermost one has no further neighbour). The extreme is
 *  only forced in once SOME interior edge on this axis has already met
 *  MIN_REPEAT on its own: without that guard, a single rectangle (or
 *  several identical ones, once deduped to one) would supply its own two
 *  edges as "extremes" and manufacture a grid out of nothing — exactly the
 *  case the refusal test guards ("returns null when nothing is drawn
 *  twice"). Forcing an extreme in is safe here in a way it was not for
 *  Ruling 17's axis-only membership test: every rectangle passed in has
 *  already been proven, by `rectComponents`, to physically touch every
 *  other rectangle in the same structure — there is no unrelated box left
 *  to widen the extent by coincidence, only the table's own geometry. */
function boundaries(rects: readonly Rect[], pick: (r: Rect) => readonly [number, number]): number[] {
  const entries = rects.flatMap((r, i) => pick(r).map((value) => ({ value, rect: i })));
  if (entries.length === 0) return [];
  const clusters = clusterEdges(entries);
  const qualifying = new Set<number>();
  clusters.forEach((c, i) => { if (c.rects.size >= MIN_REPEAT) qualifying.add(i); });
  if (qualifying.size === 0) return [];
  qualifying.add(0);
  qualifying.add(clusters.length - 1);
  return [...qualifying].sort((a, b) => a - b).map((i) => clusters[i]!.mean);
}

/** Whether some rectangle already spans the gap between the topmost
 *  boundary and the one below it — the box's own top edge, drawn for real,
 *  rather than a rule sitting UNDER the top row with nothing drawn above
 *  it. A fully-boxed table (every cell its own rectangle) always closes
 *  this way; a bottom-ruled table never does, because its "rows" are
 *  inferred purely from rule spacing and no rectangle spans a full row's
 *  height at all. */
function closedAtTop(rects: readonly Rect[], ys: readonly number[]): boolean {
  if (ys.length < 2) return false;
  const below = ys[ys.length - 2]!;
  const top = ys[ys.length - 1]!;
  return rects.some((r) => Math.abs(r.y0 - below) <= CLOSE_TOL && Math.abs(r.y1 - top) <= CLOSE_TOL);
}

/** The median-gap implied top boundary, added only when the component does
 *  not already close its own top (see `closedAtTop`). A true median, not
 *  "whichever gap floor(n/2) lands on": for an even gap count that index is
 *  the UPPER of the two middle values, which for a 2-gap table (three
 *  rules) is exactly the larger gap — indistinguishable from always taking
 *  the max. Averaging the two middle gaps is what actually resists an
 *  irregular gap on either side.
 *
 *  KNOWN LIMITATION, accepted rather than patched around: this estimate
 *  assumes the header row is the same height as the body rows. A header
 *  taller than the body — the ordinary case for a real table — gets an
 *  implied top only one (short) body-row above the last rule, short of
 *  where the actual header text sits, and the header falls outside the
 *  grid. That failure is loud, not silent: the excluded header runs are
 *  simply outside the grid, same as any other out-of-grid run, and the
 *  token-completeness gate downstream refuses the document for missing
 *  tokens rather than shipping a table with no header. Reaching for text
 *  position to patch this would fix the tall-header case but break the one
 *  principle the whole design rests on — a drawn boundary is data, text
 *  position is not — so a loud refusal here is the accepted trade. */
function impliedYs(ys: readonly number[]): number[] {
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).sort((a, b) => a - b);
  const mid = gaps.length / 2;
  const median = gaps.length === 0
    ? 0
    : Number.isInteger(mid)
      ? (gaps[mid - 1]! + gaps[mid]!) / 2
      : gaps[Math.floor(mid)]!;
  return median > 0 ? [...ys, ys[ys.length - 1]! + median] : [...ys];
}

/** Everything findGrid does once it has settled on ONE physically-connected
 *  component: derive boundaries, imply a top if the box doesn't close its
 *  own, and refuse a degenerate result. */
function findGridInComponent(component: readonly Rect[]): Grid | null {
  const xs = boundaries(component, (r) => [r.x0, r.x1]);
  const ys = boundaries(component, (r) => [r.y0, r.y1]);
  // A table needs at least one full cell: two x-boundaries and two
  // y-boundaries. Anything less is not a grid but a stray rectangle or two
  // that touch without ever mutually repeating an edge on either axis.
  //
  // RULING 19: this is also where a table drawn ENTIRELY from disconnected
  // thin rules is refused — not as a special case, but as a consequence.
  // Each rule is its own component (rectComponents never bridges a
  // row-height gap), so a rule-only table never has more than two rects in
  // any one component and never reaches this point with two real
  // boundaries on each axis. That refusal is by design, not a gap to
  // patch: neither document this reader is built for is that shape
  // (measured directly — see rectComponents' own comment), and a rule
  // stack sharing a table's page margins is geometrically identical to an
  // unrelated heading rule sharing the same margins. Only intent tells
  // them apart, and this project refuses rather than guesses when only
  // intent would decide (the same call chrome.ts made about a totals row
  // that looked exactly like a footer). findGrid's contract is a bare
  // `null` either way, so there is nowhere to attach a message to this
  // specific refusal reason beyond this comment.
  if (xs.length < 2 || ys.length < 2) return null;
  // A typeset table draws a rule UNDER each row, so n rows arrive as n
  // boundaries and the top row has no upper edge — its text would fall
  // outside the grid and be lost. Measured on this project's own table:
  // rules at 706.5, 684 and 661.5 against a header at y=715. But a
  // FULLY-BOXED table (every cell its own rectangle, both edges drawn) has
  // no such gap — closedAtTop is true — and adding an implied boundary on
  // top of a box that already closes itself would manufacture a phantom
  // empty row above a real one.
  const finalYs = closedAtTop(component, ys) ? ys : impliedYs(ys);
  // A result with exactly two xs and two ys is a single box, not a table —
  // one cell has no "row" or "column" for a text run to be placed relative
  // to, and reading it as a 1x1 table merges everything inside it into one
  // string, silently. This also closes a pre-existing hole for free: four
  // full-width rules plus three internal verticals can cluster down to
  // just their own outer extent (every interior edge failing MIN_REPEAT,
  // every interior edge failing the extreme test too, since it isn't the
  // min or the max) and collapse the whole table into one merged cell.
  if (xs.length === 2 && finalYs.length === 2) return null;
  return { xs, ys: finalYs };
}

export function findGrid(rects: readonly Rect[]): Grid | null {
  const components = rectComponents(rects);
  if (components.length === 0) return null;
  // Caller convenience, not a rule about tables: handed a whole page's
  // rectangles at once, the largest connected component (by rectangle
  // count) is assumed to be the table of interest, and this refuses if
  // even that component doesn't yield a grid. A page can draw more than
  // one genuine table, or a table alongside unrelated boxed content of
  // comparable size — "biggest" is not a claim about which one matters.
  // Task 4, which knows the document's own layout, is expected to call
  // rectComponents itself and try every component in turn rather than
  // lean on this fallback.
  //
  // I2/R3: on a tie, `reduce` keeps the accumulator — the component
  // encountered EARLIER in `components` — rather than switching to `b`,
  // which `rectComponents` now guarantees (by an explicit sort, not an
  // incidental one) is the component whose lowest original rectangle index
  // is smallest. That is a deliberate, documented, tested choice, not
  // "whichever the input happened to list first": swap which of two
  // same-size tables appears earlier in the input and the answer swaps
  // with it, predictably, every time — see the dedicated test for this.
  const largest = components.reduce((a, b) => (b.length > a.length ? b : a));
  return findGridInComponent(largest);
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
  // loss the brief warns against (a run inside the grid landing in no
  // cell) cannot happen by construction. Only a run outside the outer
  // extent returns -1 and is left alone. A value sitting exactly on a
  // shared internal edge belongs to the band ABOVE it (the row whose
  // bottom that edge is) — never both bands, never neither.
  const band = (edges: readonly number[], v: number): number => {
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
  // A cell's runs are not necessarily one line: a wrapped label ("Office
  // rent and" / "utilities charged") arrives as five runs at two different
  // y values, all inside the same cell. Reading order is y-descending (top
  // line first), THEN x-ascending within a line — sorting every run in the
  // cell by x alone, regardless of which line it sits on, is what
  // scrambles a wrapped cell into nonsense. Lines are banded with LINE_TOL,
  // anchored to the line's FIRST (topmost) run for the same chaining
  // reason clusterEdges anchors to a cluster's first member: two runs a
  // half-point apart in y are normal baseline jitter in extracted text and
  // belong on one line, but anchoring to whichever run was added last would
  // let a long, gently-sloped run of baselines chain into one "line"
  // spanning far more than LINE_TOL.
  const linesOf = (cellRuns: readonly TextRun[]): TextRun[][] => {
    const sorted = [...cellRuns].sort((a, b) => b.y - a.y);
    const lines: TextRun[][] = [];
    for (const r of sorted) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last[0]!.y - r.y <= LINE_TOL) last.push(r);
      else lines.push([r]);
    }
    return lines;
  };
  // A run that is whitespace only — not merely the empty string — is
  // filtered before joining, both within a line and across lines, so it
  // doesn't leave a run of extra spaces between real words; geometry.ts
  // never hands this module a whitespace-only run today (it drops those at
  // the source), but tableFrom is exported and callable directly, and this
  // file's own tests already feed it whitespace runs deliberately. The
  // final trim then catches whitespace baked into a single real run's own
  // text (a leading/trailing space on the token itself), which the
  // per-piece filter above does not touch.
  const cellText = (cellRuns: readonly TextRun[]): string =>
    linesOf(cellRuns)
      .map((line) => line.sort((a, b) => a.x - b.x).map((r) => r.text).filter((t) => t.trim() !== '').join(' '))
      .filter((t) => t.trim() !== '')
      .join(' ')
      .trim();
  // ys ascend but a page reads downward, so the last band is the top row.
  // Every band gets an entry, blank or not: a genuinely blank spacer row
  // between sections, a whitespace-only run, or a run one page's row-count
  // away from its continuation's are all real structure, and dropping a
  // row because it happens to be blank on THIS call is exactly the silent
  // loss this module exists to rule out — it would also falsify usedRuns
  // (a run counted as "used" whose row was then discarded) and corrupt any
  // caller that stitches rows from two pages of the same table by index.
  const rows = cells.map((row) => row.map(cellText)).reverse();
  return { rows, usedRuns };
}
