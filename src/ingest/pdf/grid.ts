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
 *  real 0.5pt rule, whose two long edges arrive as 661 and 662. Used only
 *  for clustering x/y edges into one boundary. */
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

/** Which of the given rectangles (by index into THIS array) contribute to a
 *  cluster that meets MIN_REPEAT on this axis alone. Used only to decide
 *  table MEMBERSHIP (Ruling 17) — never to produce a boundary directly.
 *  Membership has to be checked per axis independently before a single
 *  rectangle is trusted, because a rectangle can legitimately repeat an
 *  edge with something that isn't part of the same table at all: a page
 *  hundreds of points wide gives plenty of room for an unrelated box (a
 *  logo, a second table) to share an x or a y with this one by
 *  coincidence, and repeating on ONE axis is exactly what coincidence looks
 *  like — a real table's own rectangles repeat on BOTH. */
function qualifyingRectIndices(rects: readonly Rect[], pick: (r: Rect) => readonly [number, number]): Set<number> {
  const entries = rects.flatMap((r, i) => pick(r).map((value) => ({ value, rect: i })));
  if (entries.length === 0) return new Set();
  const out = new Set<number>();
  for (const c of clusterEdges(entries)) {
    if (c.rects.size >= MIN_REPEAT) for (const idx of c.rects) out.add(idx);
  }
  return out;
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
 *  twice"). Callers pass only the table's MEMBER rectangles (see
 *  findGrid), not the raw input, so an unrelated rectangle elsewhere on the
 *  page can never widen what "extreme" means here. */
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
 *  height at all. Callers pass only the table's MEMBER rectangles: an
 *  unrelated rectangle (or a coincidental pair of them) that happens to
 *  span the same y-range elsewhere on the page must never be able to
 *  suppress a real table's implied top and drop its header. */
function closedAtTop(rects: readonly Rect[], ys: readonly number[]): boolean {
  if (ys.length < 2) return false;
  const below = ys[ys.length - 2]!;
  const top = ys[ys.length - 1]!;
  return rects.some((r) => Math.abs(r.y0 - below) <= CLOSE_TOL && Math.abs(r.y1 - top) <= CLOSE_TOL);
}

export function findGrid(rects: readonly Rect[]): Grid | null {
  const distinct = distinctRects(rects);
  // Ruling 17: a rectangle belongs to THIS table only if it repeats an edge
  // on BOTH axes — x and y independently, then ANDed. A stray box anywhere
  // else on the page (a logo, a second table, a decorative rule) can easily
  // repeat an edge on ONE axis by coincidence; a table's own rectangles
  // repeat on both, always, because that is what being a row-and-column of
  // the SAME table means. Membership is computed once, from the deduped
  // input, and everything from here on — the boundaries, the extremes, the
  // closed-top check — is recomputed from the member set alone, so the
  // answer no longer depends on what else the page happens to draw.
  const qualifyingX = qualifyingRectIndices(distinct, (r) => [r.x0, r.x1]);
  const qualifyingY = qualifyingRectIndices(distinct, (r) => [r.y0, r.y1]);
  const members = distinct.filter((_, i) => qualifyingX.has(i) && qualifyingY.has(i));

  const xs = boundaries(members, (r) => [r.x0, r.x1]);
  const ys = boundaries(members, (r) => [r.y0, r.y1]);
  // A table needs at least one full cell: two x-boundaries and two
  // y-boundaries. Anything less is not a grid but a stray box, or several
  // rectangles that never mutually repeat on both axes at once — including
  // the case where excluding a non-member happens to drop a boundary's
  // distinct-rectangle count back below MIN_REPEAT. That is deliberately
  // NOT resolved by iterating to a fixed point (recomputing membership
  // against the new, smaller set, and so on): a single pass is predictable
  // and an iteration is not, so this refuses instead of chasing convergence.
  if (xs.length < 2 || ys.length < 2) return null;
  // A typeset table draws a rule UNDER each row, so n rows arrive as n
  // boundaries and the top row has no upper edge — its text would fall
  // outside the grid and be lost. Measured on this project's own table:
  // rules at 706.5, 684 and 661.5 against a header at y=715. But a
  // FULLY-BOXED table (every cell its own rectangle, both edges drawn) has
  // no such gap — closedAtTop is true — and adding an implied boundary on
  // top of a box that already closes itself would manufacture a phantom
  // empty row above a real one. The implied top, when it IS needed, is one
  // more row's worth above the highest boundary, taken from the real rows'
  // own median gap: drawn geometry only, never text position, per the
  // design's lines-first principle.
  //
  // KNOWN LIMITATION, accepted rather than patched around: this estimate
  // assumes the header row is the same height as the body rows. A header
  // taller than the body — the ordinary case for a real table — gets an
  // implied top only one (short) body-row above the last rule, short of
  // where the actual header text sits, and the header falls outside the
  // grid. That failure is loud, not silent: the excluded header runs are
  // simply outside the grid, same as any other out-of-grid run, and the
  // token-completeness gate downstream refuses the document for missing
  // tokens rather than shipping a table with no header. Reaching for text
  // position to patch this would fix the tall-header case but break the
  // one principle the whole design rests on — a drawn boundary is data,
  // text position is not — so a loud refusal here is the accepted trade.
  if (closedAtTop(members, ys)) return { xs, ys };
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).sort((a, b) => a - b);
  const mid = gaps.length / 2;
  // A true median, not "whichever gap floor(n/2) lands on": for an even
  // count that index is the UPPER of the two middle values, which for a
  // 2-gap table (three rules) is exactly the larger gap — indistinguishable
  // from always taking the max. Averaging the two middle gaps is what
  // actually resists an irregular gap on either side.
  const median = gaps.length === 0
    ? 0
    : Number.isInteger(mid)
      ? (gaps[mid - 1]! + gaps[mid]!) / 2
      : gaps[Math.floor(mid)]!;
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
  // scrambles a wrapped cell into nonsense. Lines are banded with LINE_TOL
  // and the same anchor-to-first discipline used for the grid's own edges
  // above.
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
