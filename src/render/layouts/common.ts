// What every designed layout is handed: the document taken apart into the
// pieces a designed page places by hand — the cover's lines, its labelled
// values, its statement, its contact lines — and the body grouped into
// sections. Every block of the document lands in exactly one piece, so a
// layout that places every piece prints every word; nothing here writes
// text of its own.

import type { Block, Doc, Inline } from '../../ir/types.js';
import type { Theme } from '../../theme/types.js';
import { partitionCoverBlocks, ruleIndexes, splitAtFirstPagebreak } from '../cover-zones.js';
import { isKeyValue } from '../table-width.js';

/** The renderer's own block and inline drawing, handed in rather than
 *  re-implemented, so a layout sets the same text the ordinary page does. */
export type Kit = {
  block: (b: Block) => string;
  inline: (n: Inline[]) => string;
  esc: (s: string) => string;
};

export type CoverParts = {
  title: string;
  /** meta.subtitle and the cover panel's paragraphs, in order. */
  lines: Inline[][];
  /** Labelled values: a cover's key-value table, else the document's own
   *  reference and date. */
  pairs: [Inline[], Inline[]][];
  /** The cover's quote, paragraph by paragraph. */
  statement: Inline[][];
  /** Paragraphs between the cover's rules that are not the statement. */
  contacts: Inline[][];
  /** Paragraphs after the cover's last rule. */
  foot: Inline[][];
  /** Cover blocks no piece above holds — drawn right after the cover. */
  extra: Block[];
  /** Everything after the cover. */
  rest: Block[];
};

export type Section = {
  /** The heading's own leading number ("1."), split off for display, or a
   *  layout-numbered "01" when no heading in the document carries one. */
  num: string | null;
  /** The heading's remaining text, as HTML; empty for the untitled run
   *  before the first heading. */
  title: string;
  titleText: string;
  body: string;
  index: number;
};

export type GateRow = { code: string; month: number | null; cells: string[]; cellText: string[] };
/** `head` is the table's whole header row, the code column's included: a
 *  figure prints it as its caption, so no header word is lost. */
export type Gates = { head: string[]; rows: GateRow[] };

export type Ctx = { theme: Theme; doc: Doc; kit: Kit; gates: Gates | null; sectionTitles: string[]; pageMm: { w: number; h: number } };

export interface Layout {
  /** The stylesheet appended after the ordinary one. */
  css(ctx: Ctx, cover: boolean): string;
  /** A full first page, then whatever the layout sets right after it. */
  cover(p: CoverParts, ctx: Ctx): string;
  /** The opening of a document with no cover. */
  masthead(p: CoverParts, ctx: Ctx): string;
  section(s: Section, ctx: Ctx): string;
  /** A gate table, drawn as this layout's figure. Carries every cell. */
  gates(g: Gates, ctx: Ctx): string;
  /** The close of the document: contact and foot lines, when it has them. */
  end(p: CoverParts, ctx: Ctx): string;
  /** Chromium's footer template for pages 2..N. */
  footer(ctx: Ctx, faces: string): string;
}

export function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plain(n.children))).join('');
}

const isAllCaps = (s: string) => /[A-ZА-ЯІЇЄҐ]/.test(s) && s === s.toUpperCase();
/** A class that sets an all-capitals source line in sentence case, for the
 *  layouts whose voice is quiet; the words are untouched. */
export const capsClass = (s: string) => (isAllCaps(s) ? ' src-caps' : '');

export function coverParts(doc: Doc): CoverParts {
  const p: CoverParts = { title: doc.meta.title, lines: [], pairs: [], statement: [], contacts: [], foot: [], extra: [], rest: [] };
  if (doc.meta.subtitle) p.lines.push([{ t: 'text', v: doc.meta.subtitle }]);
  const metaPairs = () => {
    if (doc.meta.reference) p.pairs.push([[{ t: 'text', v: 'Document' }], [{ t: 'text', v: doc.meta.reference }]]);
    if (doc.meta.date) p.pairs.push([[{ t: 'text', v: 'Date' }], [{ t: 'text', v: doc.meta.date }]]);
  };
  if (doc.meta.cover !== true) {
    metaPairs();
    p.rest = doc.blocks;
    return p;
  }
  const { pageBlocks, restBlocks } = splitAtFirstPagebreak(doc.blocks);
  const { panel, flowing, foot } = partitionCoverBlocks(pageBlocks, ruleIndexes(pageBlocks));
  for (const b of panel) b.t === 'para' ? p.lines.push(b.text) : p.extra.push(b);
  for (const b of flowing) {
    if (b.t === 'table' && isKeyValue(b) && p.pairs.length === 0) {
      for (const r of b.rows) p.pairs.push([r[0] ?? [], r.slice(1).flat()]);
    } else if (b.t === 'quote' && p.statement.length === 0) p.statement = b.paras;
    else if (b.t === 'para') p.contacts.push(b.text);
    else if (b.t !== 'rule') p.extra.push(b);
  }
  for (const b of foot) b.t === 'para' ? p.foot.push(b.text) : b.t === 'rule' ? null : p.extra.push(b);
  if (p.pairs.length === 0) metaPairs();
  // The page break that ended the cover is the cover's own page edge now.
  p.rest = restBlocks[0]?.t === 'pagebreak' ? restBlocks.slice(1) : restBlocks;
  return p;
}

const NUM = /^(\d+(?:\.\d+)*\.?)\s+/;

/** The body grouped by its top-level headings. */
export function sections(blocks: Block[], draw: (b: Block) => string, kit: Kit): Section[] {
  const numbered = blocks.some((b) => b.t === 'heading' && b.level === 1 && NUM.test(plain(b.text)));
  const out: Section[] = [];
  let cur: { head: Inline[] | null; body: string[] } = { head: null, body: [] };
  const flush = () => {
    if (cur.head === null && cur.body.length === 0) return;
    let num: string | null = null;
    let title = '';
    let titleText = '';
    if (cur.head !== null) {
      const first = cur.head[0];
      const m = first?.t === 'text' ? NUM.exec(first.v) : null;
      if (m && first?.t === 'text') {
        num = m[1]!;
        const restFirst = first.v.slice(m[0].length);
        const nodes: Inline[] = [...(restFirst ? [{ t: 'text' as const, v: restFirst }] : []), ...cur.head.slice(1)];
        title = kit.inline(nodes);
        titleText = plain(nodes);
      } else {
        title = kit.inline(cur.head);
        titleText = plain(cur.head);
        if (!numbered) num = String(out.filter((s) => s.title !== '').length + 1).padStart(2, '0');
      }
    }
    out.push({ num, title, titleText, body: cur.body.join('\n'), index: out.length });
  };
  for (const b of blocks) {
    if (b.t === 'heading' && b.level === 1) {
      flush();
      cur = { head: b.text, body: [] };
    } else cur.body.push(draw(b));
  }
  flush();
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (s: string): number | null => {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1]!.toLowerCase());
  return mi === -1 ? null : Number(m[2]) * 12 + mi;
};

/**
 * A table whose first column is a run of gate codes (G0, G1, … or M1, M2 for
 * milestones): what a programme document lists its decision points in. Two
 * to eight rows, so a long register stays a table.
 */
export function asGates(b: Block, kit: Kit): Gates | null {
  if (b.t !== 'table' || isKeyValue(b) || b.rows.length < 2 || b.rows.length > 8) return null;
  const codes = b.rows.map((r) => plain(r[0] ?? []).trim());
  if (!codes.every((c) => /^[A-Z]{1,2}\d{1,2}$/.test(c))) return null;
  const cols = Math.max(...b.rows.map((r) => r.length));
  // a column every row of which is a month and year places the gates in time
  let dateCol = -1;
  for (let c = 1; c < cols && dateCol === -1; c++) if (b.rows.every((r) => monthIndex(plain(r[c] ?? [])) !== null)) dateCol = c;
  const base = dateCol === -1 ? 0 : Math.min(...b.rows.map((r) => monthIndex(plain(r[dateCol] ?? []))!));
  return {
    head: b.head.map((h) => kit.inline(h)),
    rows: b.rows.map((r, i) => ({
      code: codes[i]!,
      month: dateCol === -1 ? null : monthIndex(plain(r[dateCol] ?? []))! - base,
      cells: r.slice(1).map((c) => kit.inline(c)),
      cellText: r.slice(1).map((c) => plain(c)),
    })),
  };
}

/** A gate row's cells, the date column moved first when there is one. */
export function gateLines(g: Gates, row: GateRow): { date: string | null; lead: string | null; rest: string[] } {
  const di = row.cellText.findIndex((t) => monthIndex(t) !== null);
  const cells = row.cells.filter((_, i) => i !== di);
  return { date: di === -1 ? null : row.cells[di]!, lead: cells[0] ?? null, rest: cells.slice(1) };
}

/** A number the cover can set large: "Phase 2" in its lines, else a revision. */
export function bigNumber(p: CoverParts): string | null {
  for (const l of [p.title, ...p.lines.map(plain)]) {
    const m = /\b(?:phase|stage|part|фаза|етап)\s+(\d{1,2})\b/i.exec(l);
    if (m) return m[1]!;
  }
  return null;
}

export const mm = (pt: number) => pt * 0.352778;
