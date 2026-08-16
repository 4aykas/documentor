// IR + theme → a Word document. The same IR the PDF and Markdown renderers
// consume; nothing here knows about Markdown or about HTML.
//
// Every measurement in this file has its own unit, and Word's units are not
// points: run sizes are half-points, table widths and indents are twentieths
// of a point (DXA), border widths are eighths, and an image is described in
// pixels at 96 dpi. The helpers below exist so a number in this file is always
// in points until the moment it stops being.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Header, HorizontalPositionAlign,
  HorizontalPositionRelativeFrom, ImageRun, LevelFormat, LineRuleType, Packer, PageBreak, PageNumber, Paragraph,
  FrameAnchorType, FrameWrap, HeightRule, PageOrientation, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun,
  TextWrappingType, UnderlineType, VerticalPositionAlign,
  VerticalPositionRelativeFrom, WidthType, type IFrameOptions, type ILevelsOptions, type IParagraphOptions,
  type ISectionPropertiesOptions, type ParagraphChild,
} from 'docx';
import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { PANEL_BORDER_PT, coverStatementPt, partitionCoverBlocks, ruleIndexes, splitAtFirstPagebreak } from './cover-zones.js';
import { columnWidthsDxa, fitsWidth, isKeyValue } from './table-width.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from './letterhead.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { normalizeDocx } from './normalize-docx.js';
import { mixToWhite, readableOn, SCALE_STEPS, STATEMENT_TINT, stepOf, weekLabel } from './tint.js';

const halfPt = (pt: number): number => Math.round(pt * 2);
const dxa = (pt: number): number => Math.round(pt * 20);
const eighthPt = (pt: number): number => Math.round(pt * 8);
// English Metric Units, the unit a floating object's offset is measured in:
// 914400 to the inch, so 12700 to the point.
const emu = (pt: number): number => Math.round(pt * 12700);
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
      // Size and colour are h1Pt/c.ink, exactly like any other heading — see
      // html.ts's `.doc-title` comment: a theme applies to every document, so
      // this style must not carry the theme's cover values, or a re-issued
      // report or a memo would inherit a 39pt grey title it never asked for.
      para('DocTitle', 'Doc Title', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, {
        // html.ts: `.doc-title{ margin: 22pt 0 0; }`
        spacing: { before: dxa(22), after: 0 },
      }),
      // Used instead of DocTitle only when `doc.meta.cover === true` (see
      // renderDocx below) — the theme's cover size and colour, see html.ts's
      // `.doc-title--cover` comment: it defaults to the theme's own ink, and
      // TEBIN's generated theme sets it to grey because all three real
      // originals this theme was built from set their cover title in a
      // lighter grey.
      para('DocTitleCover', 'Doc Title Cover', { size: halfPt(ty.titlePt), bold: true, color: hex(c.title) }, {
        // html.ts: `.doc-title{ margin: 22pt 0 0; }` (shared with DocTitle)
        spacing: { before: dxa(22), after: 0 },
      }),
      // The first paragraph of a cover's statement band (see statementTable).
      // html.ts: `.cover-statement-zone > blockquote > p:first-child{
      // font-size: 0.5×titlePt; font-weight: 700; color: var(--brand); }` —
      // large display type, which is what brandOnLight is allowed to paint.
      para('CoverStatement', 'Cover Statement', { size: halfPt(coverStatementPt(ty)), bold: true, color: hex(c.brandOnLight) }, {
        // html.ts: the band's own paragraphs carry `margin-bottom: 0.5×bodyPt`.
        spacing: { before: 0, after: dxa(ty.bodyPt * 0.5) },
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

// A hanging indent, not a flush one: the marker sits in the gap between
// `left - hanging` and `left`, the text starts at `left`. 18pt is Word's own
// usual default hanging width for a first-level list and reads correctly at
// every depth this renderer produces, so one constant serves all of them.
const LIST_HANGING_PT = 18;

/**
 * One numbering reference — and so one `abstractNum` — per list *fragment*,
 * keyed by the fragment's own object identity so `blocks()` can look its
 * reference back up without threading an index through every other case.
 *
 * This is the fix for "a Word list is text, not a list" (see the phase 2
 * residuals note): Word's numbering restarts every fragment at 1 unless told
 * otherwise, and the only lever docx@9.7.1's public numbering API exposes for
 * "otherwise" is a `startOverride` read off the *reference's own* level 0
 * config — one `start` per reference, not per paragraph. A fragment's `start`
 * is therefore a property of its reference, which means distinct starts need
 * distinct references: two fragments cannot share an `abstractNum` and still
 * each carry their own `startOverride` through this API. The one-abstractNum-
 * per-fragment shape below is what that constraint leaves — heavier than the
 * idiomatic "one format, many instances" a hand-authored numbering.xml would
 * use, but the reader-visible result is identical: every fragment is a real,
 * continuable, independently-numbered Word list, and the number a reader
 * checks at item 4 survives regardless of which fragment carries it.
 *
 * Reference names are derived from the document's own block order — the
 * position of each `list` block among `doc.blocks` — never from a counter
 * seeded by anything outside the document, so the same IR renders to the
 * same numbering ids on every run.
 */
function listNumbering(doc: Doc, theme: Theme): { refOf: Map<Block, string>; config: { levels: readonly ILevelsOptions[]; reference: string }[] } {
  const refOf = new Map<Block, string>();
  const config: { levels: readonly ILevelsOptions[]; reference: string }[] = [];
  let n = 0;
  for (const b of doc.blocks) {
    if (b.t !== 'list') continue;
    const reference = `list${n}`;
    n += 1;
    refOf.set(b, reference);
    const left = dxa(16 + b.depth * 14) + dxa(LIST_HANGING_PT);
    const hanging = dxa(LIST_HANGING_PT);
    config.push({
      reference,
      levels: [{
        level: 0,
        format: b.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
        text: b.ordered ? '%1.' : '•',
        alignment: AlignmentType.LEFT,
        // Only `format: DECIMAL` reads `start` as a number a reader would
        // check; docx still requires the field, so a bullet fragment gets
        // the harmless default rather than an optional this type doesn't
        // carry (exactOptionalPropertyTypes: a bare `undefined` here is not
        // the same thing as the property being absent).
        start: b.ordered ? (b.start ?? 1) : 1,
        style: { run: { size: halfPt(theme.type.bodyPt) }, paragraph: { indent: { left, hanging } } },
      }],
    });
  }
  return { refOf, config };
}

/**
 * Inline nodes → Word runs. Emphasis nests, so the formatting is carried down
 * rather than applied at the leaf: `**bold *and italic***` must arrive as one
 * run that is both.
 */
function inline(
  nodes: Inline[],
  fmt: { bold?: boolean; italics?: boolean; code?: boolean; link?: boolean; plainLink?: boolean; muted?: boolean } = {},
  theme: Theme,
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out.push(new TextRun({
          text: n.v,
          ...(fmt.bold ? { bold: true } : {}),
          // The option is `italics`, not `italic`.
          ...(fmt.italics ? { italics: true } : {}),
          // Carried down rather than applied at the ExternalHyperlink, because
          // a link's appearance is a property of its runs and a link's text
          // can need more than one of them — see the `link` case below.
          // `plainLink` keeps the Hyperlink style (so the run is still a
          // link) and cancels the one thing it is borrowed for. A cover's
          // links are contact details a reader copies off paper, not
          // navigation, and html.ts drops the underline there too.
          ...(fmt.link
            ? {
                style: 'Hyperlink', color: hex(theme.colors.ink),
                ...(fmt.plainLink ? { underline: { type: UnderlineType.NONE } } : {}),
              }
            : {}),
          // html.ts: `code{ … font-size: 0.92 × bodyPt; }`. Changing the font
          // and not the size is what makes a monospaced word read as larger
          // than the prose around it — Consolas sets a taller x-height at the
          // same nominal size, which is the whole reason the stylesheet steps
          // it down. The block-level DocCode style already steps down to 0.86,
          // matching html.ts's separate `pre code` rule; these are two rules,
          // not one, in both files.
          ...(fmt.code ? { font: 'Consolas', size: halfPt(theme.type.bodyPt * 0.92) } : {}),
          // html.ts: `table.keyvalue td:first-child{ color: var(--muted) }`.
          ...(fmt.muted ? { color: hex(theme.colors.muted) } : {}),
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
          //
          // The children go through the same recursion as any other inline
          // span, carrying `link: true` down to the leaves. A link whose text
          // is partly emphasised needs more than one run — one string could
          // never hold "half of this is bold" — and every one of them has to
          // be inside this single ExternalHyperlink and wear the Hyperlink
          // style, or half the link stops looking like one.
          const linkRuns = inline(n.children, { ...fmt, link: true }, theme);
          out.push(new ExternalHyperlink({
            link: n.href,
            // A link with no text at all would otherwise pack into a
            // <w:hyperlink> with nothing inside it — legal-looking XML that no
            // reader shows and nobody can click, so the target itself stands
            // in. The IR does not forbid an empty link, so this does not
            // assume it away.
            children: linkRuns.length > 0
              ? linkRuns
              : [new TextRun({ text: n.href, style: 'Hyperlink', color: hex(theme.colors.ink) })],
          }));
        }
        break;
    }
  }
  return out;
}

/**
 * An inline sequence as one string, with every span's formatting discarded.
 * The one caller left is `columnDemand`, which measures how much text a table
 * column carries: how that text is emphasised has no bearing on how wide the
 * column should be.
 *
 * This used to be how a link's text reached Word, which cost the emphasis
 * inside it — a limitation the phase's residuals named. It no longer is; see
 * `inline`'s `link` case.
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

/** The same text column with the sheet turned on its side. */
export function landscapeColumnDxa(theme: Theme): number {
  return dxa(PAGE_PT[theme.page.size].h - theme.page.marginPt * 2);
}


function table(b: Extract<Block, { t: 'table' }>, theme: Theme, opts: BlockOpts = {}): Table {
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
  // A table that cannot give every column a readable minimum in the portrait
  // text column is printed on a landscape sheet of its own, exactly as the
  // PDF does it — see fitsWidth(). It is sized against that sheet, and it
  // announces itself through `opts.wide` so renderDocx can put it in a
  // section of its own with the page turned.
  const wide = !fitsWidth(cols, columnDxa(theme), theme.type.bodyPt);
  const total = wide ? landscapeColumnDxa(theme) : columnDxa(theme);
  // Content-proportional, not equal: see columnDemand() for what's measured
  // and why, and distribute() for how demand becomes DXA. A table whose
  // columns are all the same size in practice still lands on equal widths —
  // proportional-to-demand and equal-split agree exactly when the demand is
  // equal — so this only changes tables that plainly differ.
  const widths = columnWidthsDxa(b, cols, total, theme.type.bodyPt);
  // See html.ts, where this class is picked: a table with no header is a list
  // of labelled values, not a grid, and banded rules under three short pairs
  // read as a table with empty columns.
  const keyValue = isKeyValue(b);
  const cell = (content: Inline[] | undefined, i: number, head: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders: {
        bottom: keyValue
          ? NO_BORDER
          : { style: BorderStyle.SINGLE, size: eighthPt(head ? 1 : 0.5), color: hex(theme.colors.rule) },
        top: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      },
      // html.ts: `th,td{ padding: 4pt 6pt }`. Word's own default cell margins
      // are not this — left/right default close enough to pass unnoticed, but
      // top/bottom default to 0, and a table has no shading to make the gap
      // read as intentional the way the code block's does. Every cell sits
      // tight against the rule above it without this.
      // html.ts: `th,td{ padding: 4pt 6pt }`, and for a key/value block
      // `td{ padding: 2pt 6pt }` with no left padding on the label.
      margins: keyValue
        ? { top: dxa(2), bottom: dxa(2), left: i === 0 ? 0 : dxa(6), right: dxa(6), marginUnitType: WidthType.DXA }
        : { top: dxa(4), bottom: dxa(4), left: dxa(6), right: dxa(6), marginUnitType: WidthType.DXA },
      children: [new Paragraph({
        style: head ? 'DocTableHeader' : 'DocTableCell',
        alignment: ALIGN[b.align[i] ?? 'l'],
        children: inline(content ?? [], { ...opts, ...(keyValue && i === 0 ? { muted: true } : {}) }, theme),
      })],
    });
  const built = new Table({
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
      // A head row with nothing in any cell is not a header, it is a blank
      // banded row with a rule under it. Markdown's table syntax has no way
      // to say "no header", so a template writes an empty one — html.ts drops
      // it for the same reason, and the two have to agree.
      ...(keyValue
        ? []
        : [new TableRow({ tableHeader: true, cantSplit: true, children: widths.map((_, i) => cell(b.head[i], i, true)) })]),
      ...b.rows.map((row) => new TableRow({ cantSplit: true, children: widths.map((_, i) => cell(row[i], i, false)) })),
    ],
  });
  if (wide) opts.wide?.add(built);
  return built;
}

/**
 * The involvement matrix. Shading carries the value; any text is ink —
 * brandOnLight paints fills and large display type only, never digits at
 * body size, which is the brand book's own line and the theme's law.
 */
function heatmapBlocks(b: Extract<Block, { t: 'heatmap' }>, theme: Theme): (Paragraph | Table)[] {
  const weeks = b.rows[0]?.values.length ?? 0;
  const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
  const total = columnDxa(theme);
  const labelW = Math.round(total * 0.28);
  const weekW = weeks > 0 ? Math.floor((total - labelW) / weeks) : 0;
  // Largest-remainder is overkill for equal columns: give the rounding slack
  // to the label column so the widths still sum to the text column exactly.
  const widths = [total - weekW * weeks, ...Array.from({ length: weeks }, () => weekW)];

  const run = (text: string, brand: boolean, on?: string) =>
    new TextRun({
      text, size: halfPt(theme.type.bodyPt * 0.95),
      ...(brand ? { color: hex(theme.colors.brandOnLight) } : {}),
      // `on` is the colour the number needs against the fill it sits on;
      // html.ts computes the same one per step. See readableOn.
      ...(on === undefined ? {} : { color: hex(on) }),
    });
  const cell = (children: Paragraph[], width: number, fill?: string) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: NO_BORDERS,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      ...(fill === undefined ? {} : { shading: { type: ShadingType.CLEAR, color: 'auto', fill } }),
      children,
    });
  const centred = (children: TextRun[]) => new Paragraph({ alignment: AlignmentType.CENTER, children });

  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: [
      cell([new Paragraph({ children: [] })], widths[0]!),
      ...Array.from({ length: weeks }, (_, i) => cell([centred([run(weekLabel(i), false)])], weekW)),
    ],
  });
  const bodyRows = b.rows.map((r) => new TableRow({
    cantSplit: true,
    children: [
      cell([new Paragraph({ children: [run(r.label, false)] })], widths[0]!),
      ...r.values.map((v) => {
        if (b.style === 'marks') {
          const marks = stepOf(v, max, 3);
          // brand: true here is a deliberate exemption from "brandOnLight
          // paints fills and large display type only, never small text": a
          // filled square glyph is a fill wearing a text costume, not text,
          // and the greyscale-printing promise this style makes is
          // unaffected (a red square prints as a grey square).
          return cell([centred(marks > 0 ? [run('▪'.repeat(marks), true)] : [])], weekW);
        }
        const step = stepOf(v, max, SCALE_STEPS.length);
        const mixed = step > 0 ? mixToWhite(theme.colors.brandOnLight, SCALE_STEPS[step - 1]!) : undefined;
        const fill = mixed?.slice(1);
        const text = b.style === 'numbers' && v > 0
          // The number reads against its own cell, not against paper: the
          // darkest step is the brand at full strength.
          ? centred([run(String(v), false, mixed === undefined ? undefined : readableOn(mixed, theme.colors.ink))])
          : new Paragraph({ children: [] });
        return cell([text], weekW, fill);
      }),
    ],
  }));

  const table = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: NO_BORDERS,
    rows: [headerRow, ...bodyRows],
  });
  // A trailing spacer paragraph, kept for every style now that the legend
  // sentence is gone: without it the heatmap table sits with no gap before
  // whatever follows, same reasoning as the table case in blocks() below.
  const spacer = new Paragraph({ spacing: { after: dxa(10) }, children: [] });
  return [table, spacer];
}

function blocks(b: Block, theme: Theme, listRefs: Map<Block, string>, opts: BlockOpts = {}): (Paragraph | Table)[] {
  switch (b.t) {
    case 'heading': {
      const style = (['DocH1', 'DocH2', 'DocH3'] as const)[b.level - 1]!;
      // outlineLevel is what puts a heading in Word's navigation pane; the
      // style alone does not, because the style id is ours and not Heading1.
      return [new Paragraph({ style, outlineLevel: b.level - 1, children: inline(b.text, opts, theme), ...framed(opts) })];
    }
    case 'para':
      return [new Paragraph({ style: 'DocBody', children: inline(b.text, opts, theme), ...framed(opts) })];
    case 'list': {
      // The reference — and so the abstractNum/num pair — was assigned once
      // per fragment in listNumbering(), keyed by this exact block. It is
      // there, not looked up again here, because a fragment's `start` lives
      // on its reference's own level 0 config; see listNumbering()'s comment
      // for why one fragment needs one reference.
      const reference = listRefs.get(b);
      if (reference === undefined) throw new Error('list block missing its numbering reference — listNumbering() did not see this block');
      return b.items.map((it) => new Paragraph({
        ...framed(opts),
        style: 'DocList',
        numbering: { reference, level: 0 },
        children: inline(it, opts, theme),
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
    case 'table': return [table(b, theme, opts), new Paragraph({
      // The run carries no text — it exists only to make the paragraph
      // mark's own size explicit rather than inherited from `Normal`, in
      // case some reader takes the run's font size into account for the
      // mark's height the way Word itself does not once `lineRule` is EXACT.
      children: [new TextRun({ text: '', size: halfPt(TABLE_GAP_LINE_PT) })],
      spacing: { line: dxa(TABLE_GAP_LINE_PT), lineRule: LineRuleType.EXACT, after: dxa(TABLE_GAP_AFTER_PT) },
    })];
    case 'heatmap': return heatmapBlocks(b, theme);
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
      return b.paras.map((p) => new Paragraph({ style: 'DocQuote', children: inline(p, opts, theme) }));
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
 * A GIF says how big it is in the ten bytes it opens with: the signature, then
 * the logical screen width and height as little-endian 16-bit integers. Both
 * `GIF87a` and `GIF89a` are in the wild and put them in the same place.
 *
 * The logical screen, not the first frame, is the right measurement: an
 * animation's frames may each be smaller than the canvas and sit at an offset
 * inside it, and the canvas is the size every reader lays the picture out at.
 * Word shows the first frame and does not animate, but it shows it at the
 * canvas size, so this is the number that matches what a reader sees.
 *
 * `null` means the same thing it means for PNG, and the caller decides — see
 * pngSize's comment, which owns that contract.
 */
function gifSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 10) return null;
  const signature = bytes.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const w = bytes.readUInt16LE(6);
  const h = bytes.readUInt16LE(8);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A BMP's size lives in its DIB header, which follows a fixed 14-byte file
 * header. Two shapes of DIB header are worth reading: the original
 * `BITMAPCOREHEADER` (12 bytes, unsigned 16-bit dimensions) and
 * `BITMAPINFOHEADER` and its successors (40 bytes or more, signed 32-bit).
 * They are told apart by the header's own declared length, which is the first
 * field in it.
 *
 * The sign matters. A negative height means the rows are stored top-down
 * rather than bottom-up — a statement about storage order, not about the
 * picture — so taking it at face value scales the picture to a negative
 * height, which Word writes out and nobody can see.
 *
 * `null` means the same thing it means for PNG.
 */
function bmpSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 26 || bytes.readUInt16LE(0) !== 0x4d42) return null; // "BM", little-endian.
  const headerLength = bytes.readUInt32LE(14);
  const [w, h] =
    headerLength === 12
      ? [bytes.readUInt16LE(18), bytes.readUInt16LE(20)]
      : [bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22))];
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * The picture's natural size and the format tag Word needs for it, or `null`
 * when this renderer cannot carry the bytes at all. Sniffing the bytes rather
 * than trusting the `data:` URI's declared type is deliberate: the type is
 * whatever produced the document said it was, and a picture labelled PNG that
 * is really a JPEG would otherwise be handed to the wrong reader.
 *
 * The four formats here are exactly the four `docx`'s ImageRun can label
 * (`jpg | png | gif | bmp`), and the same four ingest/docx.ts's `sniffRaster`
 * reads out of a source document — so a .docx → .docx round trip carries
 * through every picture it carried in. WebP is the one html.ts embeds and this
 * does not, and the obstacle is the library, not a missing reader: there is no
 * content type to declare for it. See the RASTER comment.
 */
function rasterSize(bytes: Buffer): { w: number; h: number; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  const png = pngSize(bytes);
  if (png !== null) return { ...png, type: 'png' };
  const jpeg = jpegSize(bytes);
  if (jpeg !== null) return { ...jpeg, type: 'jpg' };
  const gif = gifSize(bytes);
  if (gif !== null) return { ...gif, type: 'gif' };
  const bmp = bmpSize(bytes);
  if (bmp !== null) return { ...bmp, type: 'bmp' };
  return null;
}

/** Word describes a picture in pixels at 96 dpi; the theme thinks in points. */
const px96 = (pt: number): number => (pt * 4) / 3;

/**
 * The four formats this file can both size and label: PNG, JPEG, GIF and BMP.
 * A picture needs its natural aspect ratio even when the block supplies
 * `widthPt` — the height has nothing else to come from — and it needs a type
 * `docx` can write into `[Content_Types].xml`, whose ImageRun takes exactly
 * `jpg | png | gif | bmp`. The rule stays "what the code can carry", not "what
 * the format list looks like": this regex once accepted GIF while nothing
 * could size one, which changed nothing except which branch produced the
 * placeholder. Accepting a format and then never embedding it is the shape of
 * promise this project exists to stop making.
 *
 * The declared type only decides whether to try; `rasterSize` then sniffs the
 * bytes and has the final say, so a mislabelled picture still lands in the
 * right reader or in the placeholder.
 *
 * A WebP is still a placeholder in Word while HTML and PDF embed any raster
 * `data:` URI — the last of the renderer disagreement named in the phase's
 * residuals, and the only one whose obstacle is not a size reader: `docx` has
 * no content type for WebP, so writing one out means hand-editing the package
 * after it is built, and Word's own support for it is version-dependent
 * besides. A reader for its VP8 chunk would produce a number and still no way
 * to carry the bytes.
 */
const RASTER = /^data:image\/(png|jpeg|gif|bmp);base64,/;

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
 * A cover panel: a single-cell, single-row table whose four sides carry the
 * hairline border html.ts's `.cover-panel` draws with CSS — a table, not a
 * paragraph border, because the panel holds several paragraphs (the title,
 * the subtitle, and every block before the cover's first `rule`), and a
 * paragraph's own `border` option (see the `rule` case in blocks() below)
 * draws around one paragraph, not a group. docx.ts already builds bordered
 * and borderless tables elsewhere in this file (see `table()` and
 * `tickRow()`); this is the same technique turned to a new end.
 */
function panelTable(children: (Paragraph | Table)[], theme: Theme): Table {
  const total = columnDxa(theme);
  const border = { style: BorderStyle.SINGLE, size: eighthPt(PANEL_BORDER_PT), color: hex(theme.colors.rule) };
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: [total],
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [new TableRow({ children: [
      new TableCell({
        width: { size: total, type: WidthType.DXA },
        // html.ts: `.cover-panel{ padding: 20pt 24pt; }`
        margins: { top: dxa(20), bottom: dxa(20), left: dxa(24), right: dxa(24), marginUnitType: WidthType.DXA },
        children,
      }),
    ] })],
  });
}

/** A paragraph with no content and no height worth measuring: one twentieth
 *  of a point, no spacing above or below. Used wherever the format needs a
 *  paragraph to exist without the page showing one. */
function hairlineParagraph(children: ParagraphChild[] = []): Paragraph {
  return new Paragraph({ children, spacing: { before: 0, after: 0, line: 1, lineRule: LineRuleType.EXACT } });
}

/** An empty paragraph of an exact height, for the gaps CSS opens with a
 *  margin and Word has nowhere else to put — a table cannot carry one. The
 *  run is sized to match for the same reason blocks()'s table spacer sizes
 *  its own: so the paragraph mark's height is stated rather than inherited. */
function spacerParagraph(heightPt: number): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '', size: halfPt(heightPt) })],
    spacing: { before: 0, after: 0, line: dxa(heightPt), lineRule: LineRuleType.EXACT },
  });
}

/**
 * Word merges two tables that touch. With no paragraph between them the
 * reader treats them as a single table over a shared grid, and that is not
 * cosmetic: the seam becomes an *inside* horizontal border, which every table
 * built here sets to none. A cover's panel lost its bottom edge entirely the
 * moment the metadata table followed it — the frame printed open at the
 * bottom, in Word only, while the PDF drew all four sides. Word also reported
 * the two as one 6x2 table, which is how it was finally caught.
 *
 * Applied to the whole body rather than at the one place it was noticed:
 * anywhere two tables can land next to each other, they will, and nothing
 * about the block list makes that visible to the code emitting it.
 */
/**
 * Per-call options that travel down through blocks() to the runs and
 * paragraphs it builds. Both members exist for a cover: its links are not
 * underlined, and its foot is pinned to the page's bottom edge.
 */
type BlockOpts = { plainLink?: boolean; muted?: boolean; frame?: IFrameOptions; wide?: Set<Table> };

/** Spreads a paragraph's frame, or nothing at all when there is none. */
const framed = (opts: BlockOpts): { frame?: IFrameOptions } => (opts.frame ? { frame: opts.frame } : {});

/** See html.ts's `.cover-top a, .cover-foot a{ text-decoration: none }`. */
const COVER_LINKS = { plainLink: true } as const;

/**
 * The cover foot's page-bottom pin: `w:framePr`, the legacy text-frame
 * mechanism, with every paragraph of the foot carrying identical frame
 * properties — which is what makes Word treat them as one frame rather than
 * several.
 *
 * This was refused once, as a gamble on behaviour that could not be checked.
 * It is checked now: driven over COM, Word 365 lays the foot on the page's
 * bottom margin, and the risk is bounded in a way the original judgement
 * could not assume. A reader that ignores `framePr` renders the paragraphs in
 * ordinary flow — which is exactly what every reader did before this existed.
 * The change can only improve the result, never worsen it, so the remaining
 * uncertainty costs nothing.
 *
 * `HeightRule.AUTO` lets the frame grow to whatever the foot's own lines
 * need, rather than pinning a height somebody would have to keep in step
 * with the template.
 */
function coverFootFrame(theme: Theme): IFrameOptions {
  return {
    type: 'alignment',
    alignment: { x: HorizontalPositionAlign.LEFT, y: VerticalPositionAlign.BOTTOM },
    anchor: { horizontal: FrameAnchorType.MARGIN, vertical: FrameAnchorType.MARGIN },
    width: columnDxa(theme),
    height: 0,
    rule: HeightRule.AUTO,
    wrap: FrameWrap.NONE,
  };
}

// The two gaps a cover opens with a CSS margin, carried across as fixed
// heights because Word cannot compute either.
//
// html.ts gives the statement band `margin: auto 0` — the flowing zone's
// whole slack, split above and below, which drops it into the optical middle
// of the page. Word has no page-relative box for growing content (see
// coverBody), so there is no slack to hand it. Without something here the
// band's fill runs straight into the contact lines under it and the two read
// as one object; the band's own vertical padding is the value that reads as
// deliberate rather than arbitrary.
const STATEMENT_GAP_PT = 18;
/** html.ts: `.cover-foot{ margin-top: 24pt; }` — copied, not re-derived. */
const COVER_FOOT_GAP_PT = 24;

function separateAdjacentTables(children: (Paragraph | Table)[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const [i, child] of children.entries()) {
    if (i > 0 && children[i - 1] instanceof Table && child instanceof Table) out.push(hairlineParagraph());
    out.push(child);
  }
  return out;
}

/**
 * A cover's statement band: html.ts's `.cover-statement-zone > blockquote`,
 * built the way panelTable above builds the panel — a single-cell table,
 * because the band holds several paragraphs and a paragraph's own shading
 * would stop at each one's text rather than run the width of the page.
 *
 * The fill is the theme's brand mixed toward white by the same
 * STATEMENT_TINT the stylesheet spends, through the same mixToWhite the
 * heatmap's cells use — see tint.ts for why that arithmetic lives in one
 * place. What Word does NOT get is html.ts's `margin: auto 0`: the band sits
 * in ordinary paragraph flow, in reading order, not centred in the page's
 * slack. That is the same limitation, for the same reason, as the cover foot
 * (see coverBody) — Word has no page-relative box for growing content — and
 * it is recorded in README.md's refusal register alongside it.
 */
function statementTable(paras: Inline[][], theme: Theme, opts: BlockOpts = {}): Table {
  const total = columnDxa(theme);
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: [total],
    borders: {
      top: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER,
      insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
      // html.ts: `border-left: 4pt solid var(--brand);`
      left: { style: BorderStyle.SINGLE, size: eighthPt(4), color: hex(theme.colors.brandOnLight) },
    },
    rows: [new TableRow({ children: [
      new TableCell({
        width: { size: total, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex(mixToWhite(theme.colors.brandOnLight, STATEMENT_TINT)) },
        // html.ts: `padding: 18pt 22pt;`
        margins: { top: dxa(18), bottom: dxa(18), left: dxa(22), right: dxa(22), marginUnitType: WidthType.DXA },
        children: paras.map((p, i) => new Paragraph({
          style: i === 0 ? 'CoverStatement' : 'DocBody',
          children: inline(p, opts, theme),
        })),
      }),
    ] })],
  });
}

/**
 * The brand's corner glyph, anchored to the page's own top-right corner —
 * not to the paragraph it is attached to, and not to the margin box. This is
 * the one piece of this feature Word *can* place with genuine page-relative
 * positioning: `w:anchor` (what docx's `floating` option emits) is a normal,
 * well-supported part of the format — the same mechanism behind any Word
 * document with a picture a paragraph can wrap around — and a
 * `horizontalPosition`/`verticalPosition` both relative to `page` pins the
 * picture to the physical page corner regardless of how much text precedes
 * or follows it. `wrap: { type: NONE }` keeps it from pushing surrounding
 * text out of the way, since nothing here wants the panel or the running
 * text to reflow around a decoration in the corner.
 *
 * This is a different mechanism from the foot's (see coverFootFrame): an
 * anchored *picture* has a position the format defines directly, while a
 * page-bottom *group of paragraphs* needs the legacy `w:framePr` text frame.
 * That one was refused for a while as unverifiable; it is verified now, and
 * its downside is bounded — see coverFootFrame.
 *
 * Returns `null` when the theme carries no corner mark, or that mark has no
 * raster — the same "no raster, no mark" rule firstPageHeader's logo
 * follows: an SVG cannot be trusted to embed in Word (see canEmbedInDocx's
 * WebP comment for the general shape of that limitation), so only
 * `cornerMark.png` is ever drawn here.
 */
function cornerMarkImage(theme: Theme): ImageRun | null {
  const mark = theme.cornerMark;
  if (!mark?.png) return null;
  const bytes = Buffer.from(mark.png.slice(mark.png.indexOf(',') + 1), 'base64');
  const size = pngSize(bytes);
  if (size === null) throw new Error('theme.cornerMark.png is not a usable PNG (bad signature, too few bytes, or a zero dimension)');
  const heightPt = mark.heightPt;
  const widthPt = (heightPt * size.w) / size.h;
  return new ImageRun({
    data: bytes,
    type: 'png',
    transformation: { width: px96(widthPt), height: px96(heightPt) },
    floating: {
      // Anchored to the text margin, not the page: the top-right corner of
      // the text area is exactly the panel's own top-right corner, because
      // the panel table spans the full column width and is the first thing
      // in the body. So this puts the glyph on the frame, the same seat
      // html.ts's `.corner-mark-panel` gives it, rather than out at the
      // page's physical corner where it sat beside the frame instead of on
      // it. Two aligns rather than two offsets: the aligns are exact, while
      // an offset would have to guess at the cell's own margins.
      // Horizontally this is an offset, not an align, and the difference is
      // one border width. A Word table's border is drawn OUTSIDE the cell's
      // declared width, so the panel's right hairline sits a border past the
      // right margin — and aligning the glyph to the margin left that
      // hairline showing along its outer edge, measured at 7px in a 8px/pt
      // raster. The offset puts the glyph's right edge on the border's outer
      // edge instead, so the corner of the frame disappears under it. The
      // vertical align needs no such correction: a table's top border is
      // drawn from the margin downwards, so TOP already lands on it.
      //
      // Half a border width more than the border itself, because where Word
      // puts that hairline is not something this code can compute: measured
      // at 8px/pt it began a quarter-point past the margin rather than on it.
      // Landing exactly on a computed edge would leave the outcome to two
      // roundings, and one pixel of grey along the glyph's edge is precisely
      // what a reader sees. Overshooting costs nothing — the surplus falls in
      // the page margin, which Word, unlike Chromium, is willing to draw in.
      horizontalPosition: {
        relative: HorizontalPositionRelativeFrom.MARGIN,
        offset: emu(columnDxa(theme) / 20 - widthPt + PANEL_BORDER_PT * 1.5),
      },
      verticalPosition: { relative: VerticalPositionRelativeFrom.MARGIN, align: VerticalPositionAlign.TOP },
      wrap: { type: TextWrappingType.NONE },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  });
}

/**
 * A cover page with at least one `rule` (see cover-zones.ts): the panel
 * (bordered table, title and subtitle inside it alongside every block before
 * the first rule), whatever flows between the first and last rule, and the
 * foot (every block after the last rule).
 *
 * The foot IS pinned to the page's bottom edge, through `w:framePr` — see
 * coverFootFrame, which also records why that stopped being a gamble. What
 * still cannot be reproduced is the statement band's centring: html.ts hands
 * it the flowing zone's slack through an auto margin, and Word has no slack
 * to hand out, so the band gets a fixed gap above and below instead
 * (STATEMENT_GAP_PT). Recorded in README.md, not only here.
 */
function coverBody(doc: Doc, theme: Theme, refOf: Map<Block, string>, pageBlocks: Block[], restBlocks: Block[], ruleIdxs: number[], wide: Set<Table>): (Paragraph | Table)[] {
  const { panel, flowing, foot } = partitionCoverBlocks(pageBlocks, ruleIdxs);
  const mark = cornerMarkImage(theme);
  // The mark hangs off a paragraph of its own, ahead of the panel, rather than
  // off the panel's title paragraph inside it. An anchor inside a table cell
  // is bound to that cell: `relativeFrom="margin"` then means the CELL's
  // margin, so Word seated the glyph 24pt in and 20pt down from the panel's
  // corner — exactly the cell margins panelTable sets — floating inside the
  // frame instead of sitting on it. `layoutInCell="0"` is the attribute that
  // is supposed to opt out, and Word ignores it here (it still reports the
  // shape as laid out in the cell, and still draws it there), so the fix is
  // to not be in the cell. The carrier paragraph is one point tall with no
  // spacing and holds nothing else; the image floats with no wrapping, so it
  // neither moves the panel nor is moved by it.
  const markPara = mark
    ? [hairlineParagraph([mark])]
    : [];
  const titlePara = new Paragraph({
    style: 'DocTitleCover',
    children: [new TextRun({ text: doc.meta.title })],
  });
  const subtitlePara = doc.meta.subtitle
    ? [new Paragraph({ style: 'DocSubtitle', children: [new TextRun({ text: doc.meta.subtitle })] })]
    : [];
  // COVER_LINKS: a cover's links are contact details, not navigation — the
  // same call html.ts makes in CSS. It applies to all three zones, and to
  // nothing after the cover's own page break.
  const panelContent: (Paragraph | Table)[] = [titlePara, ...subtitlePara, ...panel.flatMap((b) => blocks(b, theme, refOf, { ...COVER_LINKS, wide }))];
  // Every foot paragraph carries the same frame, which is what makes Word
  // merge them into one block at the page's bottom margin. A foot block
  // that is not a paragraph — a table — cannot take a frame at all, so such
  // a foot falls back to ordinary flow with the gap html.ts opens above it.
  const framedFoot = foot.flatMap((b) => blocks(b, theme, refOf, { ...COVER_LINKS, wide, frame: coverFootFrame(theme) }));
  const footChildren = framedFoot.every((c) => c instanceof Paragraph)
    ? framedFoot
    : [spacerParagraph(COVER_FOOT_GAP_PT), ...foot.flatMap((b) => blocks(b, theme, refOf, { ...COVER_LINKS, wide }))];

  return [
    ...markPara,
    panelTable(panelContent, theme),
    // A `quote` between the rules is the cover's statement band, exactly as
    // html.ts reads it; every other block in the zone renders as it always
    // does. Only a cover's flowing zone is read this way — an ordinary
    // document's quote never reaches here and stays a DocQuote paragraph.
    ...flowing.flatMap((b) => (b.t === 'quote'
      ? [spacerParagraph(STATEMENT_GAP_PT), statementTable(b.paras, theme, COVER_LINKS), spacerParagraph(STATEMENT_GAP_PT)]
      : blocks(b, theme, refOf, { ...COVER_LINKS, wide }))),
    ...footChildren,
    ...restBlocks.flatMap((b) => blocks(b, theme, refOf, { wide })),
  ];
}


/**
 * The document's body cut into sections, one per run of same-orientation
 * content: a table too wide for the portrait text column gets a section of
 * its own with the sheet turned, and the page turns back for whatever
 * follows. This is Word's only way to change orientation mid-document —
 * orientation is a property of a section, not of a block — which is why the
 * split happens here rather than at the table.
 *
 * Every section after the first carries the running header and drops
 * `titlePage`: the first-page header belongs to the first page of the
 * document, not to the first page of each section, and without this a
 * landscape sheet in the middle would print the letterhead again.
 */
function sectionsFor(
  doc: Doc, theme: Theme, children: (Paragraph | Table)[], wide: Set<Table>,
): { properties: ISectionPropertiesOptions; headers: { default: Header; first?: Header }; children: (Paragraph | Table)[] }[] {
  const size = PAGE_PT[theme.page.size];
  const margin = {
    top: dxa(theme.page.marginPt), right: dxa(theme.page.marginPt),
    bottom: dxa(theme.page.marginPt), left: dxa(theme.page.marginPt),
  };
  const page = (landscape: boolean) => ({
    // The pair is always the portrait one; the library swaps them itself when
    // the orientation is landscape. Passing them pre-swapped gets them swapped
    // back — measured, and the result is a landscape flag on a portrait-shaped
    // page, which Word believes over the flag.
    size: {
      width: dxa(size.w),
      height: dxa(size.h),
      orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
    },
    margin,
  });

  const runs: { landscape: boolean; items: (Paragraph | Table)[] }[] = [];
  for (const child of children) {
    const landscape = child instanceof Table && wide.has(child);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.landscape === landscape) last.items.push(child);
    else runs.push({ landscape, items: [child] });
  }
  if (runs.length === 0) runs.push({ landscape: false, items: [] });

  return runs.map((run, i) => ({
    properties: { ...(i === 0 ? { titlePage: true } : {}), page: page(run.landscape) },
    headers: i === 0
      ? { default: runningHeader(doc, theme), first: firstPageHeader(doc, theme) }
      : { default: runningHeader(doc, theme) },
    children: separateAdjacentTables(run.items),
  }));
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
 *
 * `meta.cover === true` (see html.ts's own copy of this rule) returns an
 * empty Header instead: no logo, no letterhead lines, no entity/date lines,
 * no tick rule. The title and subtitle are unaffected either way — they
 * live in the body's own `head` paragraphs in `renderDocx` below, never in
 * this Header, so there is nothing here to suppress them (though `renderDocx`
 * does switch the title's own style between DocTitle and DocTitleCover on
 * the same flag).
 */
function firstPageHeader(doc: Doc, theme: Theme): Header {
  if (doc.meta.cover === true) return new Header({ children: [] });

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
  const { refOf, config } = listNumbering(doc, theme);
  const cover = doc.meta.cover === true;
  const { pageBlocks, restBlocks } = cover ? splitAtFirstPagebreak(doc.blocks) : { pageBlocks: doc.blocks, restBlocks: [] };
  const ruleIdxs = cover ? ruleIndexes(pageBlocks) : [];

  // >=1 rule on a cover draws the panel/flowing/foot split (see coverBody);
  // every other case — an ordinary document, or a cover with no rule to
  // divide it — renders exactly as this feature's predecessor did, see this
  // feature's "a cover with no rules must render exactly as it does today"
  // rule.
  // Filled in by table(): which of the tables below needed a wider sheet.
  const wideTables = new Set<Table>();
  const bodyChildren: (Paragraph | Table)[] = ruleIdxs.length > 0
    ? coverBody(doc, theme, refOf, pageBlocks, restBlocks, ruleIdxs, wideTables)
    : [
        new Paragraph({ style: cover ? 'DocTitleCover' : 'DocTitle', children: [new TextRun({ text: doc.meta.title })] }),
        ...(doc.meta.subtitle ? [new Paragraph({ style: 'DocSubtitle', children: [new TextRun({ text: doc.meta.subtitle })] })] : []),
        ...doc.blocks.flatMap((b) => blocks(b, theme, refOf, { wide: wideTables })),
      ];

  const packed = await Packer.toBuffer(new Document({
    styles: styles(theme),
    numbering: { config },
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
    // The sheet is named explicitly rather than left to the library's A4
    // default: columnDxa() sizes tables from the theme's own PAGE_PT trim, so
    // a Letter theme would otherwise be Letter as a PDF and A4 as a .docx,
    // with tables sized for one page hanging past the margin of the other.
    sections: sectionsFor(doc, theme, bodyChildren, wideTables),
  }));

  return normalizeDocx(Buffer.from(packed), opts.epochSeconds);
}
