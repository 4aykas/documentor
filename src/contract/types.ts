// The facts of one bilingual contract — only what changes from contract to
// contract. Everything stable lives in the template.
//
// This is a different document from a proposal, not a proposal with different
// words, which is why it has its own model rather than bending
// `ProposalData`. A proposal is priced work: its numbers come from a team of
// roles with rates and weekly hours, and every figure in it is derived from
// that one array. A contract has no team, no rates and no budget; what it has
// is a numbered clause structure printed in two languages at once, where the
// two columns are equally authentic versions of the same obligation rather
// than a translation aid. Forcing one into the other's shape would mean
// inventing a team for a power of attorney — which is exactly what
// `documentor proposal` refuses to let anyone do.

/** One clause: the same obligation, in both languages, under its own number. */
export type ContractClause = { n: string; uk: string; en: string };

/**
 * One article — a numbered top-level section and the clauses under it.
 *
 * Articles are a list, so they cannot be expressed in the template language,
 * which has no loops on purpose. They arrive through the `{{@articles}}`
 * directive instead, the same way a proposal's budget table does.
 */
export type ContractArticle = {
  n: string;
  uk: string;
  en: string;
  clauses: ContractClause[];
};

/** A party to the contract, as the contract itself names and describes it. */
export type ContractParty = { uk: string; en: string };

/** A signature block: who signs, on which side. */
export type ContractSignature = { uk: string; en: string };

export type ContractData = {
  template: string;
  /** The contract's own number, printed in both languages' headings. */
  number: string;
  date: string;
  /** Where it was concluded — "м. Київ" / "Kyiv". */
  place: { uk: string; en: string };
  /** The document's own name, e.g. "ДОГОВІР про надання послуг" / "CONTRACT
   *  for service rendering". */
  title: { uk: string; en: string };
  parties: ContractParty[];
  articles: ContractArticle[];
  signatures: ContractSignature[];
  /** Free markdown reachable from the template as {{section:name}}. */
  sections: Record<string, string>;
};

/**
 * Carries every problem found in one pass, exactly as ProposalError does and
 * for the same reason: filling a data file must not be a ping-pong with the
 * build, one error per run.
 */
export class ContractError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'ContractError';
  }
}
