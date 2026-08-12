// IR + theme → a Word document. The same IR the PDF and Markdown renderers
// consume; nothing here knows about Markdown or about HTML.
//
// Every measurement in this file has its own unit, and Word's units are not
// points: run sizes are half-points, table widths and indents are twentieths
// of a point (DXA), border widths are eighths, and an image is described in
// pixels at 96 dpi. The helpers below exist so a number in this file is always
// in points until the moment it stops being.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Header, ImageRun, Packer, PageBreak,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun,
  WidthType, type IParagraphOptions, type ParagraphChild,
} from 'docx';
import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { normalizeDocx } from './normalize-docx.js';

const halfPt = (pt: number): number => Math.round(pt * 2);
const dxa = (pt: number): number => Math.round(pt * 20);
const eighthPt = (pt: number): number => Math.round(pt * 8);
/** Word takes a colour as six hex digits with no leading hash. */
const hex = (colour: string): string => colour.replace('#', '').toUpperCase();

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
          ...(fmt.code ? { font: 'Consolas' } : {}),
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

/** The usable text column, in DXA — what a full-width table spans. */
function columnDxa(theme: Theme): number {
  return dxa(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2);
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
  // Equal columns, deliberately. The HTML renderer lets the browser lay the
  // table out; Word has no equivalent that is reproducible across versions,
  // and a width computed from the text would depend on font metrics this
  // renderer does not have. Named in the phase's residuals.
  const width = Math.floor(total / cols);
  const widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? total - width * (cols - 1) : width));
  const cell = (content: Inline[] | undefined, i: number, head: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders: {
        bottom: { style: BorderStyle.SINGLE, size: eighthPt(head ? 1 : 0.5), color: hex(theme.colors.rule) },
        top: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      },
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
    rows: [
      new TableRow({ tableHeader: true, children: widths.map((_, i) => cell(b.head[i], i, true)) }),
      ...b.rows.map((row) => new TableRow({ children: widths.map((_, i) => cell(row[i], i, false)) })),
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
    case 'table': return [table(b, theme)];
    case 'code':
      // One paragraph per line: a single paragraph with soft breaks would
      // shade as one block in Word but wrap differently from the PDF.
      return b.text.split('\n').map((line) => new Paragraph({ style: 'DocCode', children: [new TextRun({ text: line })] }));
    case 'quote':
      return b.paras.map((p) => new Paragraph({ style: 'DocQuote', children: inline(p, {}, theme) }));
    case 'rule':
      return [new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(theme.colors.rule), space: 6 } },
        // html.ts: `hr{ … margin: 14pt 0; … }` — copied, not re-derived; see
        // the comment on styles()'s paragraphStyles for why.
        spacing: { before: dxa(14), after: dxa(14) },
      })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image': {
      if (!RASTER.test(b.src)) return [imagePlaceholder(b, theme)];
      const bytes = Buffer.from(b.src.slice(b.src.indexOf(',') + 1), 'base64');
      const natural = pngSize(bytes);
      if (natural === null) return [imagePlaceholder(b, theme)];
      const widthPt = b.widthPt ?? Math.min(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2, natural.w * 0.75);
      const heightPt = (widthPt * natural.h) / natural.w;
      return [new Paragraph({
        children: [new ImageRun({ data: bytes, type: 'png', transformation: { width: px96(widthPt), height: px96(heightPt) } })],
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

/** Word describes a picture in pixels at 96 dpi; the theme thinks in points. */
const px96 = (pt: number): number => (pt * 4) / 3;

/**
 * PNG only, because pngSize() is the only decoder in this file and a picture
 * needs its natural aspect ratio even when the block supplies `widthPt` — the
 * height has nothing else to come from. This regex used to accept jpeg and gif
 * as well, which changed nothing except where the placeholder came from: both
 * fell through to it anyway, one branch further down. Accepting a format and
 * then never embedding it is the shape of promise this project exists to stop
 * making, so the promise is narrowed to what the code can carry.
 *
 * The cost is a renderer disagreement, named in the phase's residuals: HTML
 * and PDF embed any raster `data:` URI, and Word embeds only a PNG.
 */
const RASTER = /^data:image\/png;base64,/;

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
  // The document's own entity and date answer the same two questions the
  // letterhead does — who, and when — so they sit in the same muted column.
  const docLines = [doc.meta.entity, doc.meta.date]
    .filter((v): v is string => v !== undefined && v !== '')
    .map((v, i) => new Paragraph({
      style: 'DocLetterheadLine',
      spacing: i === 0 ? { before: dxa(5) } : {},
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
    // Ask Word to resolve PAGE and NUMPAGES when it opens the file; docx
    // writes the field instruction but no cached result.
    features: { updateFields: true },
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
