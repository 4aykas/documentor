// The facts of one offer — only what changes from offer to offer. Everything
// stable lives in the template. See the spec's "Data model".

export type ProposalRole = { role: string; rateCents: number; hoursPerWeek: number[] };
export type ProposalSummaryLine = { item: string; priceCents: number; covers?: 'budget' };
export type ProposalAuthor = { name: string; email: string; phone?: string };

export type ProposalData = {
  template: string;
  kind: string;
  project: string;
  date: string;
  author: ProposalAuthor;
  team: ProposalRole[];
  currency: 'EUR';
  sections: Record<string, string>;
  stage?: string;
  number?: string;
  docNumber?: string;
  rev?: string;
  summary?: ProposalSummaryLine[];
  annex?: string;
  clientLogo?: string;
  // Absent means true — the theme's usual letterhead. `false` asks for a
  // cover page with no theme chrome (see ir/types.ts's `Meta.letterhead`),
  // which the template must then supply the equivalent of as ordinary
  // content instead.
  letterhead?: boolean;
};

/**
 * Carries every problem found in one pass. Filling a data file must not be a
 * ping-pong with the build — one error per run is the failure mode this class
 * exists to prevent.
 */
export class ProposalError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'ProposalError';
  }
}
