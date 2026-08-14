import { describe, expect, it } from 'vitest';
import { readProposalData } from '../../src/proposal/data.js';
import { ProposalError } from '../../src/proposal/types.js';

const VALID = {
  template: './offer.template.md',
  kind: 'COMMERCIAL OFFER',
  project: 'BER01. Data Center',
  date: '13.04.2026',
  author: { name: 'A. Sheronov', email: 'a@tebin.pro' },
  team: [
    { role: 'BIM Coordinator', rate: 45, hoursPerWeek: [4, 4, 4, 4, 4] },
    { role: 'Mechanical Engineer', rate: 45, hoursPerWeek: [16, 16, 16, 16, 16] },
  ],
  sections: { general: 'Some scope.' },
};

const errorsOf = (mut: (d: Record<string, unknown>) => void): string[] => {
  const d = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
  mut(d);
  try {
    readProposalData(JSON.stringify(d));
  } catch (e) {
    if (e instanceof ProposalError) return e.errors;
    throw e;
  }
  return [];
};

describe('readProposalData', () => {
  it('accepts the valid shape and defaults currency to EUR', () => {
    const { data, warnings } = readProposalData(JSON.stringify(VALID));
    expect(data.currency).toBe('EUR');
    expect(data.team).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('refuses an unknown top-level key by name', () => {
    expect(errorsOf((d) => { d['discunt'] = 5; }).join('\n')).toMatch(/discunt/);
  });

  it('refuses an unknown key inside a team member by name', () => {
    expect(errorsOf((d) => {
      (d['team'] as Record<string, unknown>[])[0]!['hourly'] = 45;
    }).join('\n')).toMatch(/team\[0\].*hourly/s);
  });

  it('refuses hoursPerWeek arrays of different lengths, naming both', () => {
    const errs = errorsOf((d) => {
      (d['team'] as { hoursPerWeek: number[] }[])[1]!.hoursPerWeek = [16, 16, 16];
    });
    expect(errs.join('\n')).toMatch(/5 week/);
    expect(errs.join('\n')).toMatch(/3 week/);
  });

  it('refuses negative and non-integer hours', () => {
    expect(errorsOf((d) => {
      (d['team'] as { hoursPerWeek: number[] }[])[0]!.hoursPerWeek = [4, -1, 4, 4, 4];
    }).join('\n')).toMatch(/team\[0\].*hoursPerWeek\[1\]/s);
    expect(errorsOf((d) => {
      (d['team'] as { hoursPerWeek: number[] }[])[0]!.hoursPerWeek = [4, 4.5, 4, 4, 4];
    }).join('\n')).toMatch(/whole hours/);
  });

  it('refuses a rate with more than two decimals, via toCents', () => {
    expect(errorsOf((d) => {
      (d['team'] as { rate: number }[])[0]!.rate = 45.555;
    }).join('\n')).toMatch(/two decimals/);
  });

  it('refuses a currency it does not know', () => {
    expect(errorsOf((d) => { d['currency'] = 'PLN'; }).join('\n')).toMatch(/PLN/);
  });

  it('allows at most one summary line covering the budget', () => {
    const errs = errorsOf((d) => {
      d['summary'] = [
        { item: 'Design works', price: 4500, covers: 'budget' },
        { item: 'Also works', price: 1, covers: 'budget' },
      ];
    });
    expect(errs.join('\n')).toMatch(/covers/);
  });

  it('collects every error in one pass instead of stopping at the first', () => {
    const errs = errorsOf((d) => {
      d['bogus'] = 1;
      d['currency'] = 'PLN';
      delete d['project'];
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it('warns, not errors, on a role with zero hours across all weeks', () => {
    const d = JSON.parse(JSON.stringify(VALID)) as typeof VALID;
    d.team[0]!.hoursPerWeek = [0, 0, 0, 0, 0];
    const { warnings } = readProposalData(JSON.stringify(d));
    expect(warnings.join('\n')).toMatch(/BIM Coordinator/);
  });

  it('refuses malformed JSON with a message that says so', () => {
    expect(() => readProposalData('{not json')).toThrow(ProposalError);
  });

  it('accepts clientLogo, absent by default', () => {
    const { data } = readProposalData(JSON.stringify(VALID));
    expect(data.clientLogo).toBeUndefined();
    expect('clientLogo' in data).toBe(false);
    const withLogo = readProposalData(JSON.stringify({ ...VALID, clientLogo: './client-logo.png' })).data;
    expect(withLogo.clientLogo).toBe('./client-logo.png');
  });

  it('refuses a non-string or empty clientLogo', () => {
    expect(errorsOf((d) => { d['clientLogo'] = 5; }).join('\n')).toMatch(/clientLogo.*non-empty string/s);
    expect(errorsOf((d) => { d['clientLogo'] = ''; }).join('\n')).toMatch(/clientLogo.*non-empty string/s);
  });
});
