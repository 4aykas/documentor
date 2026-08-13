import { describe, expect, it } from 'vitest';
import { budgetTable, budgetTotalCents, heatmapOf, scheduleTable, summaryTable } from '../../src/proposal/blocks.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';
import type { Inline } from '../../src/ir/types.js';

const NB = ' ';
const DATA: ProposalData = {
  template: 't.md', kind: 'COMMERCIAL PROPOSAL', project: 'Daimler Truck', date: '13.04.2026',
  author: { name: 'M. Mionchynsky', email: 'm@tebin.pro' },
  team: [
    { role: 'BIM Coordinator', rateCents: 4500, hoursPerWeek: [4, 4, 4, 4, 4] },
    { role: 'Mechanical Engineer', rateCents: 4500, hoursPerWeek: [16, 16, 16, 16, 16] },
  ],
  currency: 'EUR',
  sections: {},
  summary: [{ item: 'Engineering works', priceCents: 450000, covers: 'budget' }],
};

const text = (cell: Inline[]): string => cell.map((n) => (n.t === 'text' ? n.v : '')).join('');

describe('budgetTotalCents', () => {
  it('is hours × rate summed over the team, in cents', () => {
    // 20 h and 80 h at €45 → €900 + €3 600 = €4 500 = 450000 cents.
    expect(budgetTotalCents(DATA)).toBe(450000);
  });
});

describe('budgetTable', () => {
  it('is the corpus table: role, hours, rate, budget, and a grand total', () => {
    const b = budgetTable(DATA);
    if (b.t !== 'table') throw new Error('expected a table');
    expect(b.head.map(text)).toEqual(['DESCRIPTION', 'Hours', 'Rate', 'Budget']);
    expect(b.align).toEqual(['l', 'r', 'r', 'r']);
    expect(b.rows.map((r) => r.map(text))).toEqual([
      ['BIM Coordinator', '20', `€${NB}45,00`, `€${NB}900,00`],
      ['Mechanical Engineer', '80', `€${NB}45,00`, `€${NB}3${NB}600,00`],
      ['TOTAL', '', '', `€${NB}4${NB}500,00`],
    ]);
  });
});

describe('summaryTable', () => {
  it('prints the priced lines', () => {
    const b = summaryTable(DATA);
    if (b.t !== 'table') throw new Error('expected a table');
    expect(b.rows.map((r) => r.map(text))).toEqual([['Engineering works', `€${NB}4${NB}500,00`]]);
  });
  it('throws when the data has no summary at all', () => {
    const d = { ...DATA };
    delete (d as Partial<ProposalData>).summary;
    expect(() => summaryTable(d)).toThrow(ProposalError);
  });
});

describe('scheduleTable', () => {
  it('speaks in days per week, the small-offer style', () => {
    const b = scheduleTable(DATA);
    if (b.t !== 'table') throw new Error('expected a table');
    expect(b.head.map(text)).toEqual(['Discipline', 'W01', 'W02', 'W03', 'W04', 'W05']);
    expect(b.rows[0]!.map(text)).toEqual(['BIM Coordinator', '0.5 day / week', '0.5 day / week', '0.5 day / week', '0.5 day / week', '0.5 day / week']);
    expect(b.rows[1]!.map(text)).toEqual(['Mechanical Engineer', '2 days / week', '2 days / week', '2 days / week', '2 days / week', '2 days / week']);
  });
  it('writes a dash for a zero week and the singular at one day or less', () => {
    const d: ProposalData = { ...DATA, team: [{ role: 'X', rateCents: 4500, hoursPerWeek: [0, 8, 6] }] };
    const b = scheduleTable(d);
    if (b.t !== 'table') throw new Error('expected a table');
    expect(b.rows[0]!.map(text)).toEqual(['X', '—', '1 day / week', '0.75 day / week']);
  });
});

describe('heatmapOf', () => {
  it('builds the block from the team, defaulting to scale', () => {
    const b = heatmapOf(DATA, undefined);
    expect(b).toEqual({
      t: 'heatmap', style: 'scale',
      rows: [
        { label: 'BIM Coordinator', values: [4, 4, 4, 4, 4] },
        { label: 'Mechanical Engineer', values: [16, 16, 16, 16, 16] },
      ],
    });
  });
  it('honours a chosen style and refuses an unknown one by name', () => {
    expect(heatmapOf(DATA, 'marks')).toMatchObject({ style: 'marks' });
    expect(() => heatmapOf(DATA, 'rainbow')).toThrow(/rainbow/);
  });
});
