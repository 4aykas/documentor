// Which of a document's own entity and date print beside the letterhead, in
// what order, that an unset or empty one is absent rather than a blank line,
// and how much space opens above the first line printed. Shared, because a
// rule that lives inside one renderer is a rule the other one silently
// breaks: the same document must not name its issuer in the PDF and go
// silent about it in the Word copy, just because one renderer's copy of this
// rule drifted from the other's. It drifted once already — this module is
// what stops it drifting again.

import type { Doc } from '../ir/types.js';

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
 * letterhead — entity first, date second — with an unset or empty one
 * dropped rather than printed as a blank line. Both answer the same two
 * questions a letterhead does, who and when, which is why they sit in its
 * column instead of competing with the title; and because an absent one is
 * dropped rather than left as a gap, a document that sets neither renders
 * byte-identical to one rendered before either field existed.
 */
export function letterheadDocLines(doc: Doc): string[] {
  return [doc.meta.entity, doc.meta.date].filter((v): v is string => v !== undefined && v !== '');
}
