// Which of a document's own entity and date print beside the letterhead, in
// what order, that an unset or empty one is absent rather than a blank line,
// and how much space opens above the first line printed. Shared, because a
// rule that lives inside one renderer is a rule the other one silently
// breaks: the same document must not name its issuer in the PDF and go
// silent about it in the Word copy, just because one renderer's copy of this
// rule drifted from the other's. It drifted once already — this module is
// what stops it drifting again.

import type { Doc } from '../ir/types.js';
import type { Theme } from '../theme/types.js';

/** The title size under a grid masthead: between an ordinary h1 and a
 *  cover's title. One number for both renderers. */
export function gridTitlePt(type: Theme['type']): number {
  return Math.round((type.h1Pt + type.titlePt) / 2);
}

/** The corner mark's height in column 01 of the title band, and how far it
 *  drops to sit centred on the title's first line (set at 1.04 leading). */
export function gridMark(type: Theme['type']): { heightPt: number; dropPt: number } {
  const titlePt = gridTitlePt(type);
  const heightPt = Math.round(titlePt * 0.82);
  return { heightPt, dropPt: Number(((titlePt * 1.04 - heightPt) / 2).toFixed(1)) };
}

/** The space above a grid masthead's title, and below its subtitle. */
export const GRID_TITLE_BEFORE_PT = 46;
export const GRID_TITLE_AFTER_PT = 26;
/** The gutter between the grid's four columns, in the head and the title band alike. */
export const GRID_GUTTER_PT = 10;

/**
 * The gap above the first line of the document's own entity/date column —
 * where it visibly separates from the theme's own letterhead lines above it.
 * A single source, not two: html.ts spends it as a CSS margin and docx.ts as
 * `spacing.before` in DXA, and letting either file hold its own copy of "5"
 * is exactly how the two files' fives stop being the same number.
 */
export const LETTERHEAD_ENTITY_DATE_GAP_PT = 5;

/**
 * The document's own entity and date, in the order they print beside the
 * letterhead — entity, then the document's own reference number, then the
 * date — with an unset or empty one dropped rather than printed as a blank
 * line. They answer the questions a letterhead does, who, which and when,
 * which is why they sit in its
 * column instead of competing with the title; and because an absent one is
 * dropped rather than left as a gap, a document that sets neither renders
 * byte-identical to one rendered before either field existed.
 */
export function letterheadDocLines(doc: Doc): string[] {
  return [doc.meta.entity, doc.meta.reference, doc.meta.date].filter((v): v is string => v !== undefined && v !== '');
}

/** One column of a grid masthead: its printed index and its lines. */
export type MastheadColumn = { index: string; lines: { text: string; strong: boolean }[] };

/**
 * The text columns of a `masthead: 'grid'` letterhead, in print order, after
 * the logo's own column 01. Shared for the same reason as the rest of this
 * module: the PDF and the Word copy must put the same line in the same
 * column.
 *
 * The theme's letterhead is read as the convention every TEBIN entity
 * already follows: the name, then the address, then contact and registry
 * lines whose items are joined by " | ". Name and address form the issuer's
 * column; the contact lines are split at each "|" into one item per line,
 * which is what a grid column is narrow enough to need, and the address at
 * each comma, so a postcode is never broken at its hyphen; the document's
 * own reference number and date take the last. A column with nothing in it is dropped and
 * the indexes close up, so no document prints a numbered empty cell.
 */
export function mastheadColumns(letterhead: string[], doc: Doc): MastheadColumn[] {
  const [name, address, ...rest] = letterhead;
  const items = (lines: (string | undefined)[], sep: RegExp) =>
    lines.flatMap((l) => (l ?? '').split(sep)).map((t) => t.trim()).filter((t) => t !== '');
  const issuer = [
    ...items([name], /$^/).map((text) => ({ text, strong: true })),
    ...items([address], /,/).map((text) => ({ text, strong: false })),
  ];
  const contact = items(rest, /\|/).map((text) => ({ text, strong: false }));
  // The date is what a reader looks for in this column, so it is the one set
  // strong. The document's entity is not printed here at all: column 02
  // already names who issues the document, and a company name in the
  // document's own column, the same one or another, read as a second issuer.
  // The classic band still prints it (see letterheadDocLines).
  const ownLines = [doc.meta.reference, doc.meta.date].filter((v): v is string => v !== undefined && v !== '');
  const own = ownLines.map((text, i) => ({ text, strong: doc.meta.date !== undefined && doc.meta.date !== '' && i === ownLines.length - 1 }));
  return [issuer, contact, own]
    .filter((lines) => lines.length > 0)
    .map((lines, i) => ({ index: String(i + 2).padStart(2, '0'), lines }));
}
