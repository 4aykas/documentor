// JSON text → a validated ProposalData. Collects every error before throwing:
// the message is the checklist for fixing the file, not the first line of it.

import { toCents } from './money.js';
import { ProposalError, type ProposalAuthor, type ProposalData, type ProposalRole, type ProposalSummaryLine } from './types.js';

const TOP_KEYS = new Set([
  'template', 'kind', 'project', 'date', 'author', 'team', 'currency', 'sections',
  'stage', 'number', 'docNumber', 'rev', 'summary', 'annex', 'clientLogo', 'letterhead',
]);
const AUTHOR_KEYS = new Set(['name', 'email', 'phone']);
const ROLE_KEYS = new Set(['role', 'rate', 'hoursPerWeek']);
const SUMMARY_KEYS = new Set(['item', 'price', 'covers']);

export function readProposalData(jsonText: string): { data: ProposalData; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new ProposalError([`the data file is not valid JSON: ${(e as Error).message}`]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProposalError(['the data file must hold one JSON object']);
  }
  const d = parsed as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of Object.keys(d)) {
    if (!TOP_KEYS.has(key)) errors.push(`unknown key ${JSON.stringify(key)} — this file accepts ${[...TOP_KEYS].join(', ')}`);
  }
  const str = (key: string, required: boolean): string | undefined => {
    const v = d[key];
    if (v === undefined || v === null) {
      if (required) errors.push(`${key} is required`);
      return undefined;
    }
    if (typeof v !== 'string' || v === '') {
      errors.push(`${key}: expected a non-empty string`);
      return undefined;
    }
    return v;
  };

  const template = str('template', true);
  const kind = str('kind', true);
  const project = str('project', true);
  const date = str('date', true);
  const stage = str('stage', false);
  const number = str('number', false);
  const docNumber = str('docNumber', false);
  const rev = str('rev', false);
  const annex = str('annex', false);
  const clientLogo = str('clientLogo', false);

  let letterhead: boolean | undefined;
  if (d['letterhead'] !== undefined) {
    if (typeof d['letterhead'] !== 'boolean') {
      errors.push(`letterhead: expected a boolean, got ${JSON.stringify(d['letterhead'])}`);
    } else {
      letterhead = d['letterhead'];
    }
  }

  let currency: 'EUR' = 'EUR';
  if (d['currency'] !== undefined) {
    if (d['currency'] === 'EUR') currency = 'EUR';
    else errors.push(`currency: only EUR is known, got ${JSON.stringify(d['currency'])} — the data model refuses what it does not know rather than guessing a format for it`);
  }

  let author: ProposalAuthor | undefined;
  const rawAuthor = d['author'];
  if (typeof rawAuthor !== 'object' || rawAuthor === null || Array.isArray(rawAuthor)) {
    errors.push('author is required: { name, email, phone? }');
  } else {
    const a = rawAuthor as Record<string, unknown>;
    for (const key of Object.keys(a)) {
      if (!AUTHOR_KEYS.has(key)) errors.push(`author: unknown key ${JSON.stringify(key)}`);
    }
    const name = typeof a['name'] === 'string' && a['name'] !== '' ? a['name'] : undefined;
    const email = typeof a['email'] === 'string' && a['email'] !== '' ? a['email'] : undefined;
    if (name === undefined) errors.push('author.name: expected a non-empty string');
    if (email === undefined) errors.push('author.email: expected a non-empty string');
    const phone = a['phone'];
    if (phone !== undefined && (typeof phone !== 'string' || phone === '')) errors.push('author.phone: expected a non-empty string, or omit it');
    if (name !== undefined && email !== undefined) {
      author = { name, email, ...(typeof phone === 'string' ? { phone } : {}) };
    }
  }

  const team: ProposalRole[] = [];
  const rawTeam = d['team'];
  if (!Array.isArray(rawTeam) || rawTeam.length === 0) {
    errors.push('team is required and must hold at least one role — it is the single source of the budget, the schedule and the heatmap');
  } else {
    rawTeam.forEach((raw, i) => {
      const at = `team[${i}]`;
      if (typeof raw !== 'object' || raw === null) { errors.push(`${at}: expected an object`); return; }
      const r = raw as Record<string, unknown>;
      for (const key of Object.keys(r)) {
        if (!ROLE_KEYS.has(key)) errors.push(`${at}: unknown key ${JSON.stringify(key)}`);
      }
      const role = typeof r['role'] === 'string' && r['role'] !== '' ? r['role'] : undefined;
      if (role === undefined) errors.push(`${at}.role: expected a non-empty string`);
      let rateCents: number | undefined;
      try {
        rateCents = toCents(r['rate'], `${at}.rate`);
      } catch (e) {
        errors.push((e as Error).message);
      }
      const hours = r['hoursPerWeek'];
      if (!Array.isArray(hours) || hours.length === 0) {
        errors.push(`${at}.hoursPerWeek: expected a non-empty array of whole hours`);
      } else {
        hours.forEach((h, w) => {
          if (typeof h !== 'number' || !Number.isInteger(h) || h < 0) {
            errors.push(`${at}.hoursPerWeek[${w}]: expected whole hours ≥ 0, got ${JSON.stringify(h)}`);
          }
        });
        if (hours.every((h) => h === 0) && role !== undefined) {
          warnings.push(`${role} has zero hours across all weeks — deliberate, or a line that should not be in the team at all?`);
        }
      }
      if (role !== undefined && rateCents !== undefined && Array.isArray(hours)) {
        team.push({ role, rateCents, hoursPerWeek: hours as number[] });
      }
    });
    // The common length *is* the week count — @schedule and @heatmap have no
    // other source for it, so two roles disagreeing about how many weeks the
    // project has is not a formatting question.
    const lengths = new Set(team.map((r) => r.hoursPerWeek.length));
    if (lengths.size > 1) {
      const named = team.map((r) => `${r.role}: ${r.hoursPerWeek.length} week(s)`).join('; ');
      errors.push(`every hoursPerWeek must cover the same weeks — ${named}`);
    }
  }

  let summary: ProposalSummaryLine[] | undefined;
  const rawSummary = d['summary'];
  if (rawSummary !== undefined) {
    if (!Array.isArray(rawSummary)) {
      errors.push('summary: expected an array of { item, price, covers? }');
    } else {
      summary = [];
      rawSummary.forEach((raw, i) => {
        const at = `summary[${i}]`;
        if (typeof raw !== 'object' || raw === null) { errors.push(`${at}: expected an object`); return; }
        const s = raw as Record<string, unknown>;
        for (const key of Object.keys(s)) {
          if (!SUMMARY_KEYS.has(key)) errors.push(`${at}: unknown key ${JSON.stringify(key)}`);
        }
        const item = typeof s['item'] === 'string' && s['item'] !== '' ? s['item'] : undefined;
        if (item === undefined) errors.push(`${at}.item: expected a non-empty string`);
        let priceCents: number | undefined;
        try {
          priceCents = toCents(s['price'], `${at}.price`);
        } catch (e) {
          errors.push((e as Error).message);
        }
        if (s['covers'] !== undefined && s['covers'] !== 'budget') {
          errors.push(`${at}.covers: the only known value is "budget", got ${JSON.stringify(s['covers'])}`);
        }
        if (item !== undefined && priceCents !== undefined) {
          summary!.push({ item, priceCents, ...(s['covers'] === 'budget' ? { covers: 'budget' as const } : {}) });
        }
      });
      const covering = summary.filter((s) => s.covers === 'budget');
      if (covering.length > 1) {
        errors.push(`summary: ${covering.length} lines claim covers:"budget" — at most one can equal the budget total`);
      }
    }
  }

  const sections: Record<string, string> = {};
  const rawSections = d['sections'];
  if (rawSections !== undefined) {
    if (typeof rawSections !== 'object' || rawSections === null || Array.isArray(rawSections)) {
      errors.push('sections: expected an object of markdown strings');
    } else {
      for (const [key, v] of Object.entries(rawSections as Record<string, unknown>)) {
        if (typeof v !== 'string') errors.push(`sections.${key}: expected a markdown string`);
        else sections[key] = v;
      }
    }
  }

  if (errors.length > 0) throw new ProposalError(errors);
  return {
    data: {
      template: template!, kind: kind!, project: project!, date: date!, author: author!,
      team, currency, sections,
      ...(stage === undefined ? {} : { stage }),
      ...(number === undefined ? {} : { number }),
      ...(docNumber === undefined ? {} : { docNumber }),
      ...(rev === undefined ? {} : { rev }),
      ...(summary === undefined ? {} : { summary }),
      ...(annex === undefined ? {} : { annex }),
      ...(clientLogo === undefined ? {} : { clientLogo }),
      ...(letterhead === undefined ? {} : { letterhead }),
    },
    warnings,
  };
}
