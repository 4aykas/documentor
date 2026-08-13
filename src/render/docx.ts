// IR + theme → a Word document. The same IR the PDF and Markdown renderers
// consume; nothing here knows about Markdown or about HTML.
//
// Every measurement in this file has its own unit, and Word's units are not
// points: run sizes are half-points, table widths and indents are twentieths
// of a point (DXA), border widths are eighths, and an image is described in
// pixels at 96 dpi. The helpers below exist so a number in this file is always
// in points until the moment it stops being.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Header, ImageRun, LineRuleType, Packer,
  PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow,
  TextRun, WidthType, type IParagraphOptions, type ParagraphChild,
} from 'docx';
import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from './letterhead.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { normalizeDocx } from './normalize-docx.js';

const halfPt = (pt: number): number => Math.round(pt * 2);
const dxa = (pt: number): number => Math.round(pt * 20);
const eighthPt = (pt: number): number => Math.round(pt * 8);
/** Word takes a colour as six hex digits with no leading hash. */
const hex = (colour: string): string => colour.replace('#', '').toUpperCase();

// html.ts: `table{ margin: 0 0 12pt }` — the gap a table's own spacer
// paragraph (see blocks()'s `case 'table'`) has to add up to. Split across
// two constants, not one, because both numbers are emitted separately and
// have to be read back separately by the test that pins them.
const TABLE_GAP_LINE_PT = 2;
const TABLE_GAP_AFTER_PT = 10;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
/** A borderless table is not the default: every edge has to be named. */
const NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
} as const;

/**
 * Style ids carry a Doc prefix because `docx` always emits its own built-in
 * set — Title, Heading1..6, Strong, ListParagraph, Hyperlink and the footnote
 * styles — and appends ours after it. A style of ours called `Heading1` would
 * be a second element with the same w:styleId, and which one a reader honours
 * is undefined. Measured 2026-08-12: Word 365 took the last, which is a
 * coincidence to design around rather than a rule to rely on.
 */
function styles(theme: Theme) {
  const { colors: c, type: ty } = theme;
  const para = (id: string, name: string, run: object, paragraph: object = {}) => ({
    id, name, basedOn: 'Normal', next: 'DocBody', quickFormat: true, run, paragraph,
  });
  return {
    default: {
      document: { run: { font: theme.font.document, size: halfPt(ty.bodyPt), color: hex(c.ink) } },
    },
    paragraphStyles: [
      // Spacing below is copied from html.ts's CSS margins, not re-derived,
      // because Word does not collapse adjacent margins the way a browser
      // does — a `before`/`after` pair that merely approximated the CSS
      // numbers would silently drift from the PDF/HTML rendering of the same
      // document. `before` mirrors the rule's top margin, `after` its bottom
      // margin; where the CSS sets only one side, the other stays 0 here too.
      para('DocTitle', 'Doc Title', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, {
        // html.ts: `.doc-title{ margin: 22pt 0 0; }`
        spacing: { before: dxa(22), after: 0 },
      }),
      para('DocSubtitle', 'Doc Subtitle', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, {
        // html.ts: `.doc-subtitle{ margin: 4pt 0 0; }`
        spacing: { before: dxa(4), after: 0 },
      }),
      // DocH1 (level-1 headings inside the body, distinct from DocTitle) has
      // no matching html.ts rule to copy — html.ts styles only h2 and h3
      // explicitly and leaves a bare <h1> to the browser's UA default, which
      // has no fixed point value — so its spacing is left as originally set.
      para('DocH1', 'Doc Heading 1', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(11), after: dxa(3) }, keepNext: true }),
      para('DocH2', 'Doc Heading 2', { size: halfPt(ty.h2Pt), bold: true, color: hex(c.ink) }, {
        // html.ts: `h2{ margin: 18pt 0 4pt; }`
        spacing: { before: dxa(18), after: dxa(4) }, keepNext: true,
      }),
      para('DocH3', 'Doc Heading 3', { size: halfPt(ty.h3Pt), bold: true, color: hex(c.ink) }, {
        // html.ts: `h3{ margin: 14pt 0 3pt; }`
        spacing: { before: dxa(14), after: dxa(3) }, keepNext: true,
      }),
      para('DocBody', 'Doc Body', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(ty.bodyPt * 0.7) } }),
      para('DocList', 'Doc List Item', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(2) } }),
      para('DocQuote', 'Doc Quote', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, {
        indent: { left: dxa(12) },
        border: { left: { style: BorderStyle.SINGLE, size: eighthPt(2), color: hex(c.rule), space: 6 } },
        // html.ts: `blockquote{ margin: 0 0 10pt; … }`
        spacing: { after: dxa(10) },
      }),
      para('DocCode', 'Doc Code', { font: 'Consolas', size: halfPt(ty.bodyPt * 0.86) }, {
        shading: { type: ShadingType.CLEAR, fill: 'F6F6F4', color: 'auto' },
        spacing: { line: 240, after: 0 },
      }),
      para('DocPlaceholder', 'Doc Placeholder', { size: halfPt(ty.bodyPt * 0.95), color: hex(c.muted) }, {
        border: { top: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  bottom: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  left: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  right: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 } },
        spacing: { after: dxa(8) },
      }),
      para('DocTableHeader', 'Doc Table Header', { size: halfPt(ty.bodyPt * 0.95), bold: true }, { spacing: { after: 0 } }),
      para('DocTableCell', 'Doc Table Cell', { size: halfPt(ty.bodyPt * 0.95) }, { spacing: { after: 0 } }),
      para('DocLetterheadName', 'Doc Letterhead Name', { size: halfPt(ty.smallPt + 0.5), bold: true, color: hex(c.muted) }, { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
      para('DocLetterheadLine', 'Doc Letterhead Line', { size: halfPt(ty.smallPt - 0.5), color: hex(c.muted) }, { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
      para('DocRunningHeader', 'Doc Running Header', { size: halfPt(ty.smallPt - 1), color: hex(c.muted) }, { spacing: { after: 0 } }),
    ],
  };
}

/**
 * Inline nodes → Word runs. Emphasis nests, so the formatting is carried down
 * rather than applied at the leaf: `**bold *and italic***` must arrive as one
 * run that is both.
 */
function inline(nodes: Inline[], fmt: { bold?: boolean; italics?: boolean; code?: boolean } = {}, theme: Theme): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out.push(new TextRun({
          text: n.v,
          ...(fmt.bold ? { bold: true } : {}),
          // The option is `italics`, not `italic`.
          ...(fmt.italics ? { italics: true } : {}),
          // html.ts: `code{ … font-size: 0.92 × bodyPt; }`. Changing the font
          // and not the size is what makes a monospaced word read as larger
          // than the prose around it — Consolas sets a taller x-height at the
          // same nominal size, which is the whole reason the stylesheet steps
          // it down. The block-level DocCode style already steps down to 0.86,
          // matching html.ts's separate `pre code` rule; these are two rules,
          // not one, in both files.
          ...(fmt.code ? { font: 'Consolas', size: halfPt(theme.type.bodyPt * 0.92) } : {}),
        }));
        break;
      case 'strong': out.push(...inline(n.children, { ...fmt, bold: true }, theme)); break;
      case 'em': out.push(...inline(n.children, { ...fmt, italics: true }, theme)); break;
      case 'code': out.push(...inline(n.children, { ...fmt, code: true }, theme)); break;
      case 'link':
        if (schemeIsRefused(n.href)) {
          // The same rule the HTML and Markdown renderers ask, and the same
          // shape of answer: the text, then where it pointed, in muted type.
          out.push(...inline(n.children, fmt, theme));
          out.push(new TextRun({ text: ` (${refusedLinkTarget(n.href)})`, color: hex(theme.colors.muted), size: halfPt(theme.type.bodyPt * 0.85) }));
        } else {
          // `Hyperlink` is a character style docx always emits, so this is the
          // one style id in the file without a Doc prefix: it is theirs, not
          // ours, and naming it is how the link text looks like a link — it
          // supplies the underline. Its colour is not borrowed along with it:
          // the built-in style paints `#0563C1`, a blue that appears in no
          // theme here, while html.ts deliberately paints link text in the
          // theme's ink with only the underline (in the rule colour) marking
          // it as a link. The run's own `color` below overrides the style's,
          // so the theme keeps owning link colour in every renderer.
          out.push(new ExternalHyperlink({
            link: n.href,
            children: [new TextRun({
              text: flatten(n.children),
              style: 'Hyperlink',
              color: hex(theme.colors.ink),
              ...(fmt.bold ? { bold: true } : {}),
              ...(fmt.italics ? { italics: true } : {}),
            })],
          }));
        }
        break;
    }
  }
  return out;
}

/**
 * A link's text as one string. Nested emphasis inside a link is flattened
 * rather than carried: `ExternalHyperlink` takes runs, and the formatting
 * that survives is the formatting the link itself sits in. Named in the
 * phase's residuals — the IR can express it and this renderer cannot.
 */
function flatten(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : flatten(n.children))).join('');
}

const ALIGN = { l: AlignmentType.LEFT, r: AlignmentType.RIGHT, c: AlignmentType.CENTER } as const;

/**
 * The usable text column, in DXA — what a full-width table spans. Exported
 * only for the table-width tests, which need this same number to assert
 * "the widths sum to exactly the text column" without recomputing it and
 * risking the assertion and the code drifting apart.
 */
export function columnDxa(theme: Theme): number {
  return dxa(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2);
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
function minColumnDxa(theme: Theme): number {
  return dxa(12 + MIN_COL_CHARS * theme.type.bodyPt * 0.5);
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

function table(b: Extract<Block, { t: 'table' }>, theme: Theme): Table {
  const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
  // A table with neither head nor rows makes `cols` 0, which lays out as an
  // empty <w:tblGrid/> and a row with no cells — structurally a table, visibly
  // nothing, and Word's own reaction to it is not something this renderer can
  // vouch for. ir/validate.ts refuses such a table before it can reach here,
  // so this guard is unreachable through the CLI; it stays because hand-built
  // IR skips the validator, and because failing closed is what this renderer
  // already does with a PNG whose dimensions it cannot read rather than
  // scaling by NaN.
  if (cols < 1) throw new Error('table has no columns — nothing to draw a grid from');
  const total = columnDxa(theme);
  // Content-proportional, not equal: see columnDemand() for what's measured
  // and why, and distribute() for how demand becomes DXA. A table whose
  // columns are all the same size in practice still lands on equal widths —
  // proportional-to-demand and equal-split agree exactly when the demand is
  // equal — so this only changes tables that plainly differ.
  const demand = columnDemand(b, cols);
  const widths = distribute(total, demand, minColumnDxa(theme), MAX_COL_FRACTION);
  const cell = (content: Inline[] | undefined, i: number, head: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders: {
        bottom: { style: BorderStyle.SINGLE, size: eighthPt(head ? 1 : 0.5), color: hex(theme.colors.rule) },
        top: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      },
      // html.ts: `th,td{ padding: 4pt 6pt }`. Word's own default cell margins
      // are not this — left/right default close enough to pass unnoticed, but
      // top/bottom default to 0, and a table has no shading to make the gap
      // read as intentional the way the code block's does. Every cell sits
      // tight against the rule above it without this.
      margins: { top: dxa(4), bottom: dxa(4), left: dxa(6), right: dxa(6), marginUnitType: WidthType.DXA },
      children: [new Paragraph({
        style: head ? 'DocTableHeader' : 'DocTableCell',
        alignment: ALIGN[b.align[i] ?? 'l'],
        children: inline(content ?? [], {}, theme),
      })],
    });
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: NO_BORDERS,
    // html.ts: `tr{ break-inside: avoid; }` — cantSplit is Word's word for it.
    // A row split across a page break loses its meaning: the reader sees cells
    // under a column heading two pages back, with no way to tell which row
    // they belonged to. A whole table too tall for one page still has to
    // break, which is why this protects rows and not the table.
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: widths.map((_, i) => cell(b.head[i], i, true)) }),
      ...b.rows.map((row) => new TableRow({ cantSplit: true, children: widths.map((_, i) => cell(row[i], i, false)) })),
    ],
  });
}

function blocks(b: Block, theme: Theme): (Paragraph | Table)[] {
  switch (b.t) {
    case 'heading': {
      const style = (['DocH1', 'DocH2', 'DocH3'] as const)[b.level - 1]!;
      // outlineLevel is what puts a heading in Word's navigation pane; the
      // style alone does not, because the style id is ours and not Heading1.
      return [new Paragraph({ style, outlineLevel: b.level - 1, children: inline(b.text, {}, theme) })];
    }
    case 'para':
      return [new Paragraph({ style: 'DocBody', children: inline(b.text, {}, theme) })];
    case 'list': {
      const start = b.start ?? 1;
      return b.items.map((it, i) => new Paragraph({
        style: 'DocList',
        indent: { left: dxa(16 + b.depth * 14) },
        children: [
          // The marker is written, not generated. Word's numbering machinery
          // would restart at 1 for every fragment a nested list splits off,
          // and the IR's `start` is the thing that must survive — it is what a
          // reader checks when they look at item 4. Named in the residuals: in
          // Word this is text, not a list.
          new TextRun({ text: b.ordered ? `${start + i}. ` : '• ' }),
          ...inline(it, {}, theme),
        ],
      }));
    }
    // html.ts: `table{ margin: 0 0 12pt }`. `<w:tbl>` has no spacing property
    // of its own in OOXML — unlike a paragraph, a table cannot carry
    // `w:spacing` — so the space has to come from a paragraph instead.
    // `blocks()` maps one IR block to Word nodes at a time, with no view of
    // the sibling before or after it — that is a property of this function's
    // per-block mapping, not of the IR itself, which has no trouble saying
    // "the block before this one was a table." Threading that fact through
    // every other case just for this one gap would be a bigger change than
    // the gap is worth, so a standalone spacer paragraph carries it instead,
    // keeping this the only case that has to know about it.
    //
    // A default empty paragraph is not a 12pt gap — it is close to 24pt,
    // because an empty paragraph still occupies a full line at the
    // document's own body size before any `spacing.after` is even added
    // (measured over COM: ~23.6pt from the table's bottom edge to the next
    // paragraph's first line, with `spacing: { after: dxa(12) }` and nothing
    // else, on this file's 10pt document default). Citing html.ts's 12pt and
    // then emitting something else is exactly the gap between comment and
    // code this file exists not to have. So the paragraph's own line is
    // pinned to a fixed, near-zero height with `lineRule: EXACT` instead of
    // Word's automatic (font-derived) one, and `after` is shortened by the
    // same amount, so the two add back up to what html.ts asks for:
    // TABLE_GAP_LINE_PT (the line) + TABLE_GAP_AFTER_PT (`after`) === 12.
    // Re-measured the same way with this paragraph: ~12.0pt.
    case 'table': return [table(b, theme), new Paragraph({
      // The run carries no text — it exists only to make the paragraph
      // mark's own size explicit rather than inherited from `Normal`, in
      // case some reader takes the run's font size into account for the
      // mark's height the way Word itself does not once `lineRule` is EXACT.
      children: [new TextRun({ text: '', size: halfPt(TABLE_GAP_LINE_PT) })],
      spacing: { line: dxa(TABLE_GAP_LINE_PT), lineRule: LineRuleType.EXACT, after: dxa(TABLE_GAP_AFTER_PT) },
    })];
    case 'code': {
      // One paragraph per line: a single paragraph with soft breaks would
      // shade as one block in Word but wrap differently from the PDF.
      //
      // html.ts: `pre{ padding: 8pt 10pt; }`, on a block whose shading is a
      // per-paragraph fill with no interior of its own. The 10pt horizontal
      // half repeats on every line — indent moves the text in from a shaded
      // rectangle that Word draws to the full column width regardless of
      // indent, which is what makes it read as padding rather than a margin
      // that dragged the shading in with it. The 8pt vertical half belongs
      // only to the first and last paragraph: applied to every line it would
      // open a gap between each one and the block would read as separate
      // shaded lines rather than one block.
      const lines = b.text.split('\n');
      const last = lines.length - 1;
      return lines.map((line, i) => new Paragraph({
        style: 'DocCode',
        indent: { left: dxa(10), right: dxa(10) },
        // Every attribute spelled out on every line, not merged with the
        // style's own `{ line: 240, after: 0 }` — whether Word resolves a
        // partial `w:spacing` override attribute-by-attribute against the
        // style or replaces the element outright is not this file's call to
        // rely on.
        spacing: {
          line: 240,
          before: i === 0 ? dxa(8) : 0,
          // html.ts: `pre{ padding-bottom: 8pt; }`, then the same gap a
          // paragraph leaves after itself (`p{ margin: 0 0 0.7×bodyPt; }`,
          // DocBody's own `after`) so the block does not sit tighter to what
          // follows it than ordinary prose would.
          after: i === last ? dxa(8) + dxa(theme.type.bodyPt * 0.7) : 0,
        },
        children: [new TextRun({ text: line })],
      }));
    }
    case 'quote':
      return b.paras.map((p) => new Paragraph({ style: 'DocQuote', children: inline(p, {}, theme) }));
    case 'rule':
      return [new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(theme.colors.rule), space: 6 } },
        // html.ts: `hr{ … margin: 14pt 0; … }` — copied, not re-derived; see
        // the comment on styles()'s paragraphStyles for why.
        spacing: { before: dxa(14), after: dxa(14) },
        // html.ts: `hr{ … break-after: avoid; }` — keepNext is Word's word for
        // it. A rule introduces what follows it, so a rule stranded alone at
        // the foot of a page with its content pushed over reads as a divider
        // between nothing and nothing; the pair moves together instead.
        keepNext: true,
      })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image': {
      if (!canEmbedInDocx(b.src)) return [imagePlaceholder(b, theme)];
      const bytes = Buffer.from(b.src.slice(b.src.indexOf(',') + 1), 'base64');
      const natural = rasterSize(bytes);
      if (natural === null) return [imagePlaceholder(b, theme)];
      const widthPt = b.widthPt ?? Math.min(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2, natural.w * 0.75);
      const heightPt = (widthPt * natural.h) / natural.w;
      return [new Paragraph({
        children: [new ImageRun({ data: bytes, type: natural.type, transformation: { width: px96(widthPt), height: px96(heightPt) } })],
        spacing: { after: dxa(8) },
      })];
    }
  }
}

/**
 * A PNG's dimensions come from its IHDR chunk, which is always the first one:
 * an 8-byte signature, a 4-byte length, the type, then width and height as
 * big-endian 32-bit integers. Reading them is thirty bytes of arithmetic and
 * removes the alternative, which is to assume an aspect ratio and stretch
 * somebody's logo to fit it.
 *
 * `null` means "not a usable PNG" — a bad signature, too few bytes to hold an
 * IHDR, or a declared width or height of 0, which would otherwise divide or
 * scale into `NaN` further down. What a `null` should become is the caller's
 * decision, not this function's: a document embedding untrusted input
 * degrades to a placeholder, but a theme's own logo asset failing to parse is
 * an authoring error and should throw naming the asset, not print a
 * letterhead with silently no mark. Do not restore the throw here.
 */
function pngSize(bytes: Buffer): { w: number; h: number } | null {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A JPEG's dimensions live in its start-of-frame segment, and finding that
 * segment means walking the file's markers rather than reading a fixed offset
 * the way PNG allows: a JPEG opens with any number of variable-length
 * segments — thumbnails, colour profiles, EXIF, comments — before the frame
 * header appears, and their order is not fixed.
 *
 * Two details decide whether this walk is correct.
 *
 * **There is more than one start-of-frame marker.** `FFC0` is baseline, but
 * `FFC1`, `FFC2` (progressive — what most photo software writes today) and
 * the rest through `FFCF` are frames too, and all carry height and width in
 * the same place. The two exceptions inside that range are `FFC4` (Huffman
 * tables) and `FFC8`/`FFCC`, which are not frames at all and must be skipped
 * like any other segment. Accepting only `FFC0` would make every progressive
 * JPEG — the common case — silently fall back to a placeholder, which is
 * exactly the failure this function exists to remove.
 *
 * **Standalone markers carry no length.** `FF01` and `FFD0`–`FFD7` are two
 * bytes and nothing more; reading a length after them walks into the middle
 * of somebody else's data. So does treating a fill byte (`FF FF`) as a
 * marker. Both are stepped over explicitly.
 *
 * `null` means the same thing it means for PNG, and the caller decides what
 * to do with it — see pngSize's comment, which owns that contract.
 */
function jpegSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null; // Not where a marker should be.
    const marker = bytes[at + 1]!;
    if (marker === 0xff) { at += 1; continue; } // Fill byte before a marker.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // Scan data or end: no frame found.
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return null; // A segment cannot be shorter than its own length field.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      // Frame header: length, sample precision, then height and width.
      if (at + 9 > bytes.length) return null;
      const h = bytes.readUInt16BE(at + 5);
      const w = bytes.readUInt16BE(at + 7);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    at += 2 + length;
  }
  return null;
}

/**
 * The picture's natural size and the format tag Word needs for it, or `null`
 * when this renderer cannot carry the bytes at all. Sniffing the bytes rather
 * than trusting the `data:` URI's declared type is deliberate: the type is
 * whatever produced the document said it was, and a picture labelled PNG that
 * is really a JPEG would otherwise be handed to the wrong reader.
 */
function rasterSize(bytes: Buffer): { w: number; h: number; type: 'png' | 'jpg' } | null {
  const png = pngSize(bytes);
  if (png !== null) return { ...png, type: 'png' };
  const jpeg = jpegSize(bytes);
  if (jpeg !== null) return { ...jpeg, type: 'jpg' };
  return null;
}

/** Word describes a picture in pixels at 96 dpi; the theme thinks in points. */
const px96 = (pt: number): number => (pt * 4) / 3;

/**
 * PNG and JPEG, because those are the two this file can read a size out of,
 * and a picture needs its natural aspect ratio even when the block supplies
 * `widthPt` — the height has nothing else to come from. The rule stays "what
 * the code can carry", not "what the format list looks like": this regex once
 * accepted GIF too, which changed nothing except which branch produced the
 * placeholder. Accepting a format and then never embedding it is the shape of
 * promise this project exists to stop making.
 *
 * The declared type only decides whether to try; `rasterSize` then sniffs the
 * bytes and has the final say, so a mislabelled picture still lands in the
 * right reader or in the placeholder.
 *
 * A GIF or a WebP is still a placeholder in Word while HTML and PDF embed any
 * raster `data:` URI — the renderer disagreement named in the phase's
 * residuals, now narrowed to the formats nobody photographs in.
 */
const RASTER = /^data:image\/(png|jpeg);base64,/;

/**
 * Whether this renderer can embed `src` as a real picture — the question
 * `documentor inspect` needs answered to warn "this will not embed in
 * Word", exported as a predicate rather than the regex above. `inspect`
 * should depend on *what* counts as embeddable, not *how* this file
 * currently decides that: today it's a `data:` URI prefix test, but
 * ingest/docx.ts's own `sniffRaster` already reads magic bytes for the
 * inverse direction (source → mime), and the day this renderer does the
 * same, a regex exported on its own would leave `inspect`'s warning
 * silently answering a question this file no longer asks that way. One
 * function is one place for that to change.
 */
export function canEmbedInDocx(src: string): boolean {
  if (!RASTER.test(src)) return false;
  // And the bytes have to hold a size this file can find, which is the same
  // question `blocks()` asks a moment later. Answering only the declared type
  // here would let `inspect` promise a picture that the build then turns into
  // a placeholder — a truncated photograph, or one labelled PNG that is
  // really something else. This command exists to say what will happen, so it
  // has to do the work the renderer does rather than a cheaper test that
  // usually agrees.
  try {
    return rasterSize(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')) !== null;
  } catch {
    return false; // Undecodable base64 is not a picture either.
  }
}

/**
 * What a picture becomes when it cannot be embedded: a bordered box carrying
 * the alt text and where it pointed — the same shape the HTML renderer draws,
 * for the same reason. Nothing is silently lost.
 */
function imagePlaceholder(b: Extract<Block, { t: 'image' }>, theme: Theme): Paragraph {
  let where = '';
  try { where = new URL(b.src).host; } catch { /* a relative path has no host */ }
  if (where === '' && b.src.startsWith('data:image/svg+xml')) {
    // Word's SVG support is version-dependent, and embedding one means
    // supplying a raster fallback beside it — which this renderer cannot
    // produce reproducibly. Saying so is better than a picture that is there
    // for some readers and missing for others.
    where = 'SVG not embedded';
  } else if (where === '' && b.src.startsWith('data:')) {
    where = b.src.slice(0, Math.max(b.src.indexOf(',') + 1, 20));
  }
  return new Paragraph({
    style: 'DocPlaceholder',
    children: [new TextRun({ text: b.alt }), ...(where ? [new TextRun({ text: `  ${where}`, break: 1 })] : [])],
  });
}

/**
 * The first page's letterhead. In the PDF this is drawn in the body flow,
 * because Chromium renders a header template in a separate context with none
 * of the page's CSS. Word has no such limitation, and a DOCX is a thing people
 * edit: a letterhead in the body flow is pushed down the page by the first
 * paragraph somebody adds, and page two carries nothing.
 *
 * The mark is the theme's raster. A PNG is not repainted by a class, so a
 * theme carrying only a vector prints the letterhead without one rather than
 * substituting a colour nobody chose. A theme that *does* carry a raster and
 * it fails to parse is a different case entirely — that raster was chosen by
 * whoever authored the theme, not supplied by the document, so silently
 * printing the letterhead with no mark would hide an authoring mistake behind
 * every document that theme touches. This throws instead.
 */
function firstPageHeader(doc: Doc, theme: Theme): Header {
  const total = columnDxa(theme);
  const logoWidth = dxa(120);
  const png = theme.logo?.png;
  const mark: ParagraphChild[] = [];
  if (png) {
    const bytes = Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
    const size = pngSize(bytes);
    if (size === null) throw new Error('theme.logo.png is not a usable PNG (bad signature, too few bytes, or a zero dimension)');
    const { w, h } = size;
    const heightPt = theme.logo!.heightPt;
    mark.push(new ImageRun({
      data: bytes, type: 'png',
      transformation: { width: px96((heightPt * w) / h), height: px96(heightPt) },
    }));
  }

  const lines = theme.letterhead.map((l, i) =>
    new Paragraph({ style: i === 0 ? 'DocLetterheadName' : 'DocLetterheadLine', children: [new TextRun({ text: l })] }));
  // Which lines these are, in what order, and which get dropped: a decision
  // shared with html.ts, see letterhead.ts. What's left here is only the
  // drawing — one paragraph per line, with the first pushed down from the
  // letterhead lines above it by that shared gap.
  const docLines = letterheadDocLines(doc).map((v, i) => new Paragraph({
    style: 'DocLetterheadLine',
    spacing: i === 0 ? { before: dxa(LETTERHEAD_ENTITY_DATE_GAP_PT) } : {},
    children: [new TextRun({ text: v })],
  }));

  return new Header({
    children: [
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: total, type: WidthType.DXA },
        columnWidths: [logoWidth, total - logoWidth],
        borders: NO_BORDERS,
        rows: [new TableRow({ children: [
          new TableCell({ width: { size: logoWidth, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ children: mark })] }),
          new TableCell({ width: { size: total - logoWidth, type: WidthType.DXA }, borders: NO_BORDERS, children: [...lines, ...docLines] }),
        ] })],
      }),
      tickRow(theme),
    ],
  });
}

/** The brand tick and the hairline beside it: 28pt of 3pt border, then 0.75pt
 *  across the rest. The same drawing the stylesheet makes, in Word's terms —
 *  nothing scales and it reads back as structure. */
function tickRow(theme: Theme): Table {
  const total = columnDxa(theme);
  const tick = dxa(28);
  const cell = (width: number, size: number, colour: string) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: eighthPt(size), color: hex(colour) } },
      children: [new Paragraph({ children: [] })],
    });
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: [tick, total - tick],
    borders: NO_BORDERS,
    rows: [new TableRow({ children: [
      cell(tick, 3, theme.colors.brandOnLight),
      cell(total - tick, 0.75, theme.colors.rule),
    ] })],
  });
}

/** Pages two onward: the title, and where the reader is. */
function runningHeader(doc: Doc, theme: Theme): Header {
  const total = columnDxa(theme);
  const right = dxa(60);
  const plain = (children: ParagraphChild[], alignment?: IParagraphOptions['alignment']) =>
    new Paragraph({ style: 'DocRunningHeader', ...(alignment ? { alignment } : {}), children });
  return new Header({
    children: [new Table({
      layout: TableLayoutType.FIXED,
      width: { size: total, type: WidthType.DXA },
      columnWidths: [total - right, right],
      borders: NO_BORDERS,
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: total - right, type: WidthType.DXA }, borders: NO_BORDERS, children: [plain([new TextRun({ text: doc.meta.title })])] }),
        new TableCell({ width: { size: right, type: WidthType.DXA }, borders: NO_BORDERS, children: [plain([
          new TextRun({ children: [PageNumber.CURRENT] }),
          new TextRun({ text: ' / ' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
        ], AlignmentType.RIGHT)] }),
      ] })],
    })],
  });
}

export async function renderDocx(doc: Doc, theme: Theme, opts: { epochSeconds: number }): Promise<Buffer> {
  const head: Paragraph[] = [
    new Paragraph({ style: 'DocTitle', children: [new TextRun({ text: doc.meta.title })] }),
    ...(doc.meta.subtitle ? [new Paragraph({ style: 'DocSubtitle', children: [new TextRun({ text: doc.meta.subtitle })] })] : []),
  ];

  const packed = await Packer.toBuffer(new Document({
    styles: styles(theme),
    // Deliberately NOT `features: { updateFields: true }`. That flag writes
    // `<w:updateFields/>` into settings.xml, which is what makes Word greet
    // every recipient with "This document contains fields that may refer to
    // other files. Do you want to update the fields in this document?" on
    // open — a real cost, paid by everyone the file is sent to, every time.
    // It was added on the belief that PAGE/NUMPAGES (see runningHeader())
    // would otherwise show as blank, because docx writes the field
    // instruction with no cached result between `fldChar separate` and
    // `fldChar end`. Measured 2026-08-12 with Word 365 over COM, opening a
    // two-page build of the kitchen-sink fixture both with and without the
    // flag and exporting each to PDF: the running header on page 2 reads
    // "2 / 2" in both cases, byte-for-byte the same raster. Word recalculates
    // header/footer page-number fields as part of pagination itself, on
    // every open, regardless of this setting — the flag was never doing the
    // work it was added for. See test/render/docx.test.ts, "does not ask
    // Word to update fields on open".
    sections: [{
      properties: {
        titlePage: true,
        page: {
          // Without an explicit size, docx defaults to A4 regardless of the
          // theme, while columnDxa() below already sizes tables from the
          // theme's own PAGE_PT trim — a Letter theme would then be Letter as
          // a PDF and A4 as a .docx, with tables sized for one page hanging
          // past the margin of the other.
          size: { width: dxa(PAGE_PT[theme.page.size].w), height: dxa(PAGE_PT[theme.page.size].h) },
          margin: {
            top: dxa(theme.page.marginPt), right: dxa(theme.page.marginPt),
            bottom: dxa(theme.page.marginPt), left: dxa(theme.page.marginPt),
          },
        },
      },
      headers: { default: runningHeader(doc, theme), first: firstPageHeader(doc, theme) },
      children: [...head, ...doc.blocks.flatMap((b) => blocks(b, theme))],
    }],
  }));

  return normalizeDocx(Buffer.from(packed), opts.epochSeconds);
}
