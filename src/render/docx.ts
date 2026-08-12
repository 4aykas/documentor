// IR + theme → a Word document. The same IR the PDF and Markdown renderers
// consume; nothing here knows about Markdown or about HTML.
//
// Every measurement in this file has its own unit, and Word's units are not
// points: run sizes are half-points, table widths and indents are twentieths
// of a point (DXA), border widths are eighths, and an image is described in
// pixels at 96 dpi. The helpers below exist so a number in this file is always
// in points until the moment it stops being.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Packer, PageBreak,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun,
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
      para('DocTitle', 'Doc Title', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(11), after: dxa(2) } }),
      para('DocSubtitle', 'Doc Subtitle', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, { spacing: { after: dxa(8) } }),
      para('DocH1', 'Doc Heading 1', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(11), after: dxa(3) }, keepNext: true }),
      para('DocH2', 'Doc Heading 2', { size: halfPt(ty.h2Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(9), after: dxa(2) }, keepNext: true }),
      para('DocH3', 'Doc Heading 3', { size: halfPt(ty.h3Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(7), after: dxa(1.5) }, keepNext: true }),
      para('DocBody', 'Doc Body', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(ty.bodyPt * 0.7) } }),
      para('DocList', 'Doc List Item', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(2) } }),
      para('DocQuote', 'Doc Quote', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, {
        indent: { left: dxa(12) },
        border: { left: { style: BorderStyle.SINGLE, size: eighthPt(2), color: hex(c.rule), space: 6 } },
        spacing: { after: dxa(5) },
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
          // ours, and naming it is how the link text looks like a link.
          out.push(new ExternalHyperlink({
            link: n.href,
            children: [new TextRun({
              text: flatten(n.children),
              style: 'Hyperlink',
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
        spacing: { before: dxa(7), after: dxa(7) },
      })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image':
      // Task 7 replaces this with an embed for a raster data: URI. Everything
      // else stays exactly here.
      return [imagePlaceholder(b, theme)];
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
  if (where === '' && b.src.startsWith('data:')) where = b.src.slice(0, b.src.indexOf(',') + 1 || 20);
  return new Paragraph({
    style: 'DocPlaceholder',
    children: [new TextRun({ text: b.alt }), ...(where ? [new TextRun({ text: `  ${where}`, break: 1 })] : [])],
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
        page: { margin: {
          top: dxa(theme.page.marginPt), right: dxa(theme.page.marginPt),
          bottom: dxa(theme.page.marginPt), left: dxa(theme.page.marginPt),
        } },
      },
      children: [...head, ...doc.blocks.flatMap((b) => blocks(b, theme))],
    }],
  }));

  return normalizeDocx(Buffer.from(packed), opts.epochSeconds);
}
