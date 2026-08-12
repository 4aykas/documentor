// The intermediate representation every ingester produces and every renderer
// consumes. Flat on purpose: DOCX is a paragraph sequence, XLSX is rows and PDF
// is a flow, so a tree would only be unwound again in each of the four.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'code'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export type Align = 'l' | 'r' | 'c';

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { t: 'para'; text: Inline[] }
  // `start` is the number the first item carries (absent = 1). It exists because a
  // nested list splits its ordered parent into several `list` blocks (see
  // src/ingest/md.ts), and each fragment after the first must remember where
  // numbering resumes — the fragment itself has no other way to know.
  | { t: 'list'; ordered: boolean; depth: number; items: Inline[][]; start?: number }
  // No `landscape` flag: turning a page sideways needs a differently-sized
  // page, which is the wide-table policy's job and arrives with the ingesters
  // that can actually produce a wide table. A flag both renderers appear to
  // honour and neither does is worse than no flag at all.
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { t: 'image'; src: string; alt: string; widthPt?: number }
  | { t: 'code'; lang?: string; text: string }
  | { t: 'quote'; paras: Inline[][] }
  | { t: 'rule' }
  | { t: 'pagebreak' };

export type Meta = {
  title: string;
  subtitle?: string;
  date?: string;   // ISO 8601 date, rendered by the theme's locale rules
  entity?: string;
  lang: string;    // BCP 47; drives hyphenation and quotation marks
};

export type Doc = { meta: Meta; blocks: Block[] };

/**
 * What an ingester returns. `dropped` names everything the source contained
 * that the IR cannot hold, so the CLI can print it. Silent loss is the failure
 * mode this type exists to prevent.
 */
export type Ingested = { doc: Doc; dropped: string[] };
