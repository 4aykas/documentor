// The computed blocks of a bilingual contract: the parties, the articles and
// the signatures, each a projection of the data rather than anything this
// file writes.
//
// The visual decision this module owns, and the reason it exists rather than
// the template emitting one big markdown table: **one table per article, not
// one table for the contract.** A single table spanning twenty pages repeats
// its "Українська | English" header on every one of them, gives the reader no
// hierarchy to navigate by — an article heading arrives as just another row —
// and lets a page break fall anywhere. Per-article tables put the language
// header where it is actually informative (once, under the article it
// belongs to), let each article open with a real heading, and give the
// renderers a seam to break pages on.

import type { Block, Inline } from '../ir/types.js';
import { ContractError, type ContractData } from './types.js';

const text = (v: string): Inline[] => [{ t: 'text', v }];

/** A clause cell: its own number in bold, then the clause. The number is
 *  repeated in both columns because each column is a complete version of the
 *  contract — a reader following only one language must still see it. */
const clauseCell = (n: string, body: string): Inline[] => [
  { t: 'strong', children: [{ t: 'text', v: `${n} ` }] },
  { t: 'text', v: body },
];

/** The two columns are equal, so they are set equal: neither language is the
 *  original and neither is the gloss. */
const BILINGUAL_ALIGN = ['l', 'l'] as const;

export function partiesBlock(data: ContractData): Block {
  if (data.parties.length === 0) {
    throw new ContractError(['{{@parties}} needs a "parties" array — a contract with no parties is not a contract']);
  }
  return {
    t: 'table',
    head: [text('Сторони'), text('Parties')],
    align: [...BILINGUAL_ALIGN],
    rows: data.parties.map((p) => [text(p.uk), text(p.en)]),
  };
}

export function articleBlocks(data: ContractData): Block[] {
  if (data.articles.length === 0) {
    throw new ContractError(['{{@articles}} needs an "articles" array — there is nothing to print']);
  }
  const out: Block[] = [];
  for (const a of data.articles) {
    // The heading carries both languages on one line, separated by a middle
    // dot. Two headings — one per language — would double the contents list
    // and make every article look like two.
    out.push({
      t: 'heading',
      level: 2,
      text: text(`${a.n} ${a.uk} · ${a.en}`),
    });
    if (a.clauses.length > 0) {
      out.push({
        t: 'table',
        head: [text('Українська'), text('English')],
        align: [...BILINGUAL_ALIGN],
        rows: a.clauses.map((c) => [clauseCell(c.n, c.uk), clauseCell(c.n, c.en)]),
      });
    }
  }
  return out;
}

export function signaturesBlock(data: ContractData): Block {
  if (data.signatures.length === 0) {
    throw new ContractError(['{{@signatures}} needs a "signatures" array — an unsigned contract has no signature block to print']);
  }
  return {
    t: 'table',
    head: [text('Підписи'), text('Signatures')],
    align: [...BILINGUAL_ALIGN],
    rows: data.signatures.map((s) => [text(s.uk), text(s.en)]),
  };
}
