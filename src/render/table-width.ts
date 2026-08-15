// How wide each column of a table gets, shared by the two renderers that draw
// one. It lives here for the same reason tint.ts does: Word computed
// content-proportional widths with floors and a ceiling while the HTML/PDF
// side handed the question to Chromium's automatic table algorithm, and the
// two answered it differently — the same annex wrapped to a second line in
// Word and left a wide unused strip in the PDF. One solver, one answer.
//
// Everything here is unit-agnostic in the sense that matters: it works in
// DXA (twentieths of a point, Word's own unit) because DXA are integers and
// the rounding has to be exact, and the HTML side converts the result to
// percentages of the same total.

import type { Block, Inline } from '../ir/types.js';

/** DXA — twentieths of a point, the unit table widths are computed in. */
export const dxa = (pt: number): number => Math.round(pt * 20);

function flatten(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : flatten(n.children))).join('');
}

/**
 * The widths, in DXA, of a table's columns: content-proportional, each at
 * least MIN_COL_CHARS wide and at most MAX_COL_FRACTION of the table, summing
 * to exactly `totalDxa`. `bodyPt` sizes the floor, which is expressed in
 * characters and has to become points somewhere.
 */
export function columnWidthsDxa(
  b: Extract<Block, { t: 'table' }>, cols: number, totalDxa: number, bodyPt: number,
): number[] {
  return distribute(totalDxa, columnDemand(b, cols), minColumnDxa(bodyPt), MAX_COL_FRACTION);
}

/**
 * Whether `cols` columns can each have their minimum width inside `totalDxa`.
 * False is the wide-table case: the widths still sum to the page, but at
 * least one column is below the floor that makes a column readable at all,
 * and the renderer should find the table a wider page rather than draw a
 * grid nobody can read. Note what this is NOT: it is not "does the content
 * fit". A column can clear the floor and still wrap its text over four
 * lines — that is ugly, not illegible, and it is the author's call.
 */
export function fitsWidth(cols: number, totalDxa: number, bodyPt: number): boolean {
  return cols * minColumnDxa(bodyPt) <= totalDxa;
}

/**
 * A column's "demand" — how much of the table it should get, before floors,
 * ceilings, or the page even enter into it — measured in characters, not
 * points. Points need font metrics this renderer does not carry (glyph
 * widths, kerning); a proportion needs only "which column has more text than
 * which other column," and character count answers that well enough to beat
 * the alternative this replaces, which was to ask nothing of the content at
 * all.
 *
 * The longest cell alone was rejected: one outlier cell (a paragraph dropped
 * into an otherwise short column) would then set that column's whole width,
 * starving every other column for one row's sake. The 75th percentile of the
 * column's cell lengths is used instead, floored by the header's own length
 * so a short-but-labelled column (a header like "Currency" over three-letter
 * codes) doesn't collapse to its data's width and clip the label. This still
 * does one thing badly: a table with only one or two rows has too few points
 * to make a percentile meaningful, and a single long cell dominates exactly
 * as the longest-cell measure would — there is no smoothing to be had from a
 * sample that small.
 */
function columnDemand(b: Extract<Block, { t: 'table' }>, cols: number): number[] {
  return Array.from({ length: cols }, (_, i) => {
    const headerLen = flatten(b.head[i] ?? []).length;
    const cellLens = b.rows.map((row) => flatten(row[i] ?? []).length).sort((a, c) => a - c);
    return Math.max(headerLen, percentile(cellLens, 0.75));
  });
}

/** Linear-interpolated percentile of an already-sorted array; 0 for empty. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo]!;
  const hiVal = sorted[hi]!;
  return lo === hi ? loVal : loVal + (hiVal - loVal) * (idx - lo);
}

// A column of one-character values still has to be wide enough to carry its
// own header and to not read as a sliver a cursor can barely land in. The
// floor is derived from the same typographic numbers the cells are actually
// drawn with — the 6pt+6pt left/right cell margins table() sets below, plus
// room for a handful of characters at this theme's body size. Average glyph
// width in a proportional face is commonly estimated at roughly half the
// point size; four characters is enough for a short code ("EUR"), a small
// integer, or a truncated label to still read as a column rather than a
// crack between its neighbours.
const MIN_COL_CHARS = 4;
function minColumnDxa(bodyPt: number): number {
  return dxa(12 + MIN_COL_CHARS * bodyPt * 0.5);
}

// One column's cap, as a fraction of the table. Without one, a single
// long-prose column (exactly the case this rule exists for) can still take
// nearly the whole table and squeeze every sibling down to its floor even
// when it didn't need to — a five-column table with one verbose column
// should still show the other four as columns, not as a thin margin. 45% is
// generous enough that it only ever binds when one column's demand truly
// dwarfs the others combined. It does nothing on a two-column table — two
// columns each capped below 50% can never sum back to the total, so
// distribute() drops the ceiling there entirely rather than force the cap
// onto whichever column loses the tie-break — which means a two-column
// table with one long column has no ceiling at all, only the other
// column's own floor to keep it from disappearing.
const MAX_COL_FRACTION = 0.45;

/**
 * Demand-weighted widths in DXA, subject to a per-column [floor, ceiling],
 * summing to exactly `total`. This is water-filling: columns pinned to a
 * bound are removed from the pool and the remainder is re-shared, by demand,
 * among what's left, repeating until nothing left in the pool would violate
 * its bound. Order of discovery doesn't affect the fixed point, so this
 * produces the same split regardless of column order — required for the
 * same table to render to the same bytes on every machine.
 *
 * If the floors alone don't fit in `total` (a table with more columns than
 * the page has room for 4-character minimums), enforcing them would demand a
 * negative amount from someone; floors are dropped entirely for that table
 * and only the ceiling is enforced, which degrades to a plain demand-weighted
 * split. This is the "table wider than the page" degenerate case — nothing
 * in this function makes the table fit the page, only proportional today.
 */
function distribute(total: number, demand: number[], floor: number, ceilFraction: number): number[] {
  const n = demand.length;
  const ceiling = total * ceilFraction;
  const useFloor = floor * n <= total;
  // A ceiling only has somewhere to send the excess it trims if the *other*
  // columns, all capped at the same fraction, could still cover the rest of
  // `total` between them. With two columns and a 45% cap that's impossible
  // by construction (0.45 + 0.45 < 1) — capping one just hands its entire
  // excess to the other, which is exactly backwards when the other is the
  // column that wanted to be small. So the ceiling is dropped, not merely
  // widened, whenever `n` columns capped at it can't reach `total` between
  // them; a table that narrow is better served by pure demand-weighting.
  const useCeil = ceiling * n >= total;
  const lo = new Array(n).fill(useFloor ? floor : 0);
  const hi = new Array(n).fill(useCeil ? Math.max(ceiling, useFloor ? floor : 0) : Infinity);
  const fixed: number[] = new Array(n).fill(NaN);
  const active = new Set(demand.map((_, i) => i));
  let remaining = total;
  for (;;) {
    if (active.size === 0) break;
    const activeIdx = [...active];
    // The last column standing has nobody left to hand an excess to, or to
    // borrow a shortfall from — every DXA `remaining` has to land somewhere,
    // and this is the only somewhere left. Its own floor/ceiling lose to that
    // requirement rather than leaving `total` short or over by whatever this
    // column got capped away from.
    if (activeIdx.length === 1) {
      fixed[activeIdx[0]!] = remaining;
      break;
    }
    const sumDemand = activeIdx.reduce((s, i) => s + demand[i]!, 0);
    const equalShare = remaining / activeIdx.length;
    const proposal = new Map<number, number>();
    for (const i of activeIdx) {
      proposal.set(i, sumDemand > 0 ? (remaining * demand[i]!) / sumDemand : equalShare);
    }
    // Clamp at most one column per round, not every violator at once: two
    // columns can each individually overshoot `hi` against the *current*
    // `remaining`, but `remaining` only accounts for the first one clamped —
    // clamping both against the same pre-shrink pool double-spends it and
    // the DXA that were "freed" by both clamps stop summing to `total`. The
    // worst violator (furthest past its bound, as a fraction of the bound)
    // is picked so the loop still terminates in at most `n` rounds; the tie
    // break on index keeps the pick — and so the final split — deterministic.
    let worst: { i: number; over: number } | null = null;
    for (const i of activeIdx) {
      const p = proposal.get(i)!;
      const over = p < lo[i]! ? lo[i]! - p : p > hi[i]! ? p - hi[i]! : 0;
      if (over > 1e-9 && (worst === null || over > worst.over)) worst = { i, over };
    }
    if (worst === null) {
      for (const i of activeIdx) fixed[i] = proposal.get(i)!;
      break;
    }
    const bound = proposal.get(worst.i)! < lo[worst.i]! ? lo[worst.i]! : hi[worst.i]!;
    fixed[worst.i] = bound;
    active.delete(worst.i);
    remaining -= bound;
  }
  return roundToDxa(fixed, total);
}

/**
 * Floating widths that sum to `total` exactly, rounded to whole DXA that
 * still sum to `total` exactly — rounding twenty-odd independent floats down
 * would otherwise lose or gain a few DXA to nobody. Largest-remainder: floor
 * everything, then hand the leftover DXA one at a time to whichever column's
 * fractional part was closest to rounding up, ties broken by column index.
 * Both the floors and the tie order are deterministic, so this is the one
 * place floating-point arithmetic feeds into a byte-identical output without
 * being a risk to it.
 */
function roundToDxa(widths: number[], total: number): number[] {
  const floors = widths.map((w) => Math.floor(w));
  let remainder = total - floors.reduce((s, w) => s + w, 0);
  const order = widths
    .map((w, i) => ({ i, frac: w - floors[i]! }))
    .sort((a, c) => c.frac - a.frac || a.i - c.i);
  const out = [...floors];
  for (let k = 0; k < remainder; k++) out[order[k]!.i] = out[order[k]!.i]! + 1;
  return out;
}
