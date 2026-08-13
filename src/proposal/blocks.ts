// The computed blocks — three projections of `team`, plus the priced summary.
// They cannot disagree with each other by construction, which is the whole
// reason `team` is the single source of numbers.

import type { Block, Inline } from '../ir/types.js';
import { weekLabel } from '../render/tint.js';
import { formatMoney } from './money.js';
import { ProposalError, type ProposalData } from './types.js';

const cell = (v: string): Inline[] => [{ t: 'text', v }];

/** Hours booked for one role, summed over every week. */
const roleHours = (r: ProposalData['team'][number]): number => r.hoursPerWeek.reduce((a, b) => a + b, 0);

/** Hours × rate for one role, in cents — the one expression every budget
 *  figure for a role is built from, so the per-row and grand-total numbers
 *  cannot drift apart. */
const roleBudgetCents = (r: ProposalData['team'][number]): number => roleHours(r) * r.rateCents;

export function budgetTotalCents(data: ProposalData): number {
  return data.team.reduce((sum, r) => sum + roleBudgetCents(r), 0);
}

export function summaryTable(data: ProposalData): Block {
  if (data.summary === undefined || data.summary.length === 0) {
    throw new ProposalError(['{{@summary}} needs a "summary" array in the data file — the directive prints priced lines, and there are none to print']);
  }
  return {
    t: 'table',
    head: [cell('DESCRIPTION'), cell('PRICE')],
    align: ['l', 'r'],
    rows: data.summary.map((s) => [cell(s.item), cell(formatMoney(s.priceCents, data.currency))]),
  };
}

export function budgetTable(data: ProposalData): Block {
  const rows = data.team.map((r) => [
    cell(r.role),
    cell(String(roleHours(r))),
    cell(formatMoney(r.rateCents, data.currency)),
    cell(formatMoney(roleBudgetCents(r), data.currency)),
  ]);
  rows.push([cell('TOTAL'), cell(''), cell(''), cell(formatMoney(budgetTotalCents(data), data.currency))]);
  return { t: 'table', head: [cell('DESCRIPTION'), cell('Hours'), cell('Rate'), cell('Budget')], align: ['l', 'r', 'r', 'r'], rows };
}

/** "2 days / week" — hours become days at the corpus's own 8-hour day. */
function daysLabel(hours: number): string {
  if (hours === 0) return '—';
  const d = hours / 8;
  return `${d} ${d <= 1 ? 'day' : 'days'} / week`;
}

export function scheduleTable(data: ProposalData): Block {
  const weeks = data.team[0]?.hoursPerWeek.length ?? 0;
  return {
    t: 'table',
    head: [cell('Discipline'), ...Array.from({ length: weeks }, (_, i) => cell(weekLabel(i)))],
    align: ['l', ...Array.from({ length: weeks }, () => 'c' as const)],
    rows: data.team.map((r) => [cell(r.role), ...r.hoursPerWeek.map((h) => cell(daysLabel(h)))]),
  };
}

const HEATMAP_STYLES = new Set(['fill', 'scale', 'numbers', 'marks']);

export function heatmapOf(data: ProposalData, style: string | undefined): Block {
  const chosen = style ?? 'scale';
  if (!HEATMAP_STYLES.has(chosen)) {
    throw new ProposalError([`{{@heatmap}}: unknown style ${JSON.stringify(chosen)} — expected fill, scale, numbers or marks`]);
  }
  return {
    t: 'heatmap',
    style: chosen as 'fill' | 'scale' | 'numbers' | 'marks',
    rows: data.team.map((r) => ({ label: r.role, values: [...r.hoursPerWeek] })),
  };
}
