# Proposal template and procedure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `documentor proposal` command that assembles a commercial offer from a data file and a template, through the existing IR and renderers, inventing no text.

**Architecture:** `proposal.json` (facts) + a markdown template (skeleton and boilerplate) → a pure assembler that substitutes fields, expands directives into computed IR blocks (budget, schedule, heatmap, annex), and splices them into the ingested markdown → the same `validateDoc` gate and the same PDF/DOCX/MD renderers. One new IR block (`heatmap`) with four styles. The real TEBIN template lives outside git; the repo ships the mechanism and a generic example.

**Tech Stack:** TypeScript (ESM, `nodenext`), Node ≥22, vitest, the existing `marked`/`docx`/`jszip`/`playwright-core` paths. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-proposal-template-design.md`

## Global Constraints

- **Assembles, never writes.** Every sentence in the output comes from the data file or the template, verbatim. A missing piece is a build error naming what is missing — never invented text, never a silent blank.
- **Byte-identical twice.** Same input, same platform → identical bytes. No `Date.now()`, no argument-less `new Date()`; the epoch comes from `resolveEpoch` (SOURCE_DATE_EPOCH or the data file's mtime).
- **The renderer fetches nothing.** No network at assemble or render time. `test/guardrails/` enforces both; do not weaken the greps.
- **Money is integer cents internally.** No float arithmetic on prices anywhere. Output format `€ 4 500,00` (NBSP separators — see Task 1).
- **`colors.brandOnLight` paints fills and large display type only** — never small text. Heatmap digits are `ink` over a tint.
- **Unknown keys refuse the whole file by name** — data file, template directive, heatmap style alike.
- **Errors are collected and reported together**, not one per run.
- **Scratch files stay out of the repo** (OneDrive tree); the real TEBIN template goes to `.input/` (gitignored).
- Language for code, comments and commit messages: English.
- Commit after every task. Do not push.

## File structure

**Created:**

| Path | Responsibility |
|:--|:--|
| `src/proposal/money.ts` | euros→cents at the parse boundary; `€ 4 500,00` formatting |
| `src/proposal/types.ts` | `ProposalData` and friends; `ProposalError` carrying `errors: string[]` |
| `src/proposal/data.ts` | JSON text → validated `ProposalData` + warnings, all errors collected |
| `src/proposal/template.ts` | template text → nodes; nodes + data → flat md/directive items |
| `src/proposal/blocks.ts` | the computed tables: summary, budget (+total in cents), schedule, heatmap |
| `src/proposal/assemble.ts` | the pipeline: flatten → sentinels → ingest → splice → cross-checks → `Doc` |
| `src/render/tint.ts` | `SCALE_STEPS`, `stepOf`, `mixToWhite`, `HEATMAP_LEGEND` — shared by all three renderers |
| `src/cli/proposal.ts` | `runProposal` (build) and `runProposalInspect` |
| `templates/offer.example.md` | generic example template — no TEBIN figure or wording; the test fixture |
| `test/fixtures/offer-example.proposal.json` | generic example data for the fixture template |
| `test/helpers/xlsx-fixture.ts` | minimal in-memory .xlsx builder for annex tests |
| `test/proposal/money.test.ts`, `data.test.ts`, `template.test.ts`, `blocks.test.ts`, `assemble.test.ts` | unit suites |
| `test/cli/proposal.test.ts` | CLI end-to-end, exit codes, byte-identity |

**Modified:**

| Path | Change |
|:--|:--|
| `src/ir/types.ts` | `Block` gains `heatmap` |
| `src/ir/validate.ts` | validates the new block |
| `src/render/md.ts`, `src/render/html.ts`, `src/render/docx.ts` | a `heatmap` case each (the exhaustive switches make skipping one a compile error) |
| `src/ingest/xlsx.ts` | optional `limits` param so only the annex path can raise the row cap |
| `src/bin/documentor.ts` | `proposal` command + USAGE |
| `src/cli/inspect.ts` | routes a `.json` input to `runProposalInspect` |
| `plugin/skills/documentor/SKILL.md`, `README.md` | the procedure |

**Two deviations from the spec, each with its reason:**

1. **The budget table carries no per-week columns.** The spec described it as
   "role × weeks × hours × rate × total"; a 16-week offer would make that a
   20-column table the wide-table policy itself would refuse. The table is
   Role | Hours | Rate | Budget with a grand total; the per-week story is
   `{{@schedule}}`'s and `{{@heatmap}}`'s job — which is exactly how the
   BER01 offer itself splits the two.
2. **No committed pixel baseline for the example offer.** The spec's testing
   section said "a human approves the page once, as with the kitchen sink".
   The human approval happens instead in Tasks 13–14 (the heatmap comparison
   sheet and the real-template review), against the real TEBIN output rather
   than the generic fixture — a pixel baseline of the generic example would
   join the local-only quarantine anyway and pin nothing the markup and
   read-back tests do not already pin.

---

### Task 1: Money — cents in, `€ 4 500,00` out

**Files:**
- Create: `src/proposal/money.ts`
- Test: `test/proposal/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toCents(value: unknown, where: string): number` (throws `Error` naming `where` on a non-number, negative, or more-than-two-decimals value) and `formatMoney(cents: number, currency: 'EUR'): string`. Tasks 2, 8 and 9 use both.

- [ ] **Step 1: Write the failing tests**

Create `test/proposal/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney, toCents } from '../../src/proposal/money.js';

// NBSP ( ), not a plain space: an amount must not wrap mid-figure, and the
// corpus prints "€ 4 500,00" as one visual token.
const NB = ' ';

describe('toCents', () => {
  it('converts whole euros and two-decimal euros exactly', () => {
    expect(toCents(45, 'team[0].rate')).toBe(4500);
    expect(toCents(45.5, 'x')).toBe(4550);
    expect(toCents(0.01, 'x')).toBe(1);
    expect(toCents(88000, 'x')).toBe(8800000);
  });
  it('refuses more than two decimals, naming the field', () => {
    expect(() => toCents(45.555, 'team[0].rate')).toThrow(/team\[0\]\.rate/);
    expect(() => toCents(45.555, 'team[0].rate')).toThrow(/two decimals/);
  });
  it('refuses negatives and non-numbers, naming the field', () => {
    expect(() => toCents(-1, 'p')).toThrow(/p/);
    expect(() => toCents('45' as unknown, 'p')).toThrow(/number/);
    expect(() => toCents(Number.NaN, 'p')).toThrow(/p/);
  });
});

describe('formatMoney', () => {
  it('formats every digit-group size', () => {
    expect(formatMoney(0, 'EUR')).toBe(`€${NB}0,00`);
    expect(formatMoney(4500, 'EUR')).toBe(`€${NB}45,00`);
    expect(formatMoney(90000, 'EUR')).toBe(`€${NB}900,00`);
    expect(formatMoney(450000, 'EUR')).toBe(`€${NB}4${NB}500,00`);
    expect(formatMoney(8800000, 'EUR')).toBe(`€${NB}88${NB}000,00`);
    expect(formatMoney(123456789, 'EUR')).toBe(`€${NB}1${NB}234${NB}567,89`);
  });
  it('keeps the cents column two digits wide', () => {
    expect(formatMoney(4505, 'EUR')).toBe(`€${NB}45,05`);
    expect(formatMoney(4550, 'EUR')).toBe(`€${NB}45,50`);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/proposal/money.test.ts`
Expected: FAIL — `src/proposal/money.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/proposal/money.ts`:

```ts
// Money for proposals. Integer cents everywhere past this boundary: the one
// place "almost right" reliably looks right is a price, so no float survives
// into any arithmetic that a reader will check against their own.

const NB = ' '; // an amount must not wrap mid-figure

/**
 * Euros as JSON wrote them → integer cents. Two decimals at most: a rate of
 * 45.555 is not a price anyone quoted, it is a mistake, and rounding it
 * silently would print a figure nobody wrote.
 */
export function toCents(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: expected a number of euros, got ${JSON.stringify(value)}`);
  }
  if (value < 0) throw new Error(`${where}: a negative amount (${value}) is not accepted`);
  const cents = value * 100;
  const rounded = Math.round(cents);
  // Float slack from the JSON parse (45.55 * 100 === 4555.000000000001) is
  // tolerated; a genuine third decimal is not.
  if (Math.abs(cents - rounded) > 1e-6) {
    throw new Error(`${where}: ${value} carries more than two decimals — a price has cents, not fractions of one`);
  }
  return rounded;
}

/** `€ 4 500,00` — the corpus's own format: NBSP thousands groups, comma decimals. */
export function formatMoney(cents: number, currency: 'EUR'): string {
  if (currency !== 'EUR') throw new Error(`unknown currency ${JSON.stringify(currency)} — only EUR is known`);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const digits = String(whole);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `€${NB}${groups.join(NB)},${frac}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/proposal/money.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proposal/money.ts test/proposal/money.test.ts
git commit -m "Give proposals money that cannot drift: cents in, corpus format out"
```

---

### Task 2: Read and validate `proposal.json`

**Files:**
- Create: `src/proposal/types.ts`, `src/proposal/data.ts`
- Test: `test/proposal/data.test.ts`

**Interfaces:**
- Consumes: `toCents` from Task 1 (validation of rates/prices only; the parsed data keeps euros as given — cents are computed where used).
- Produces:
  - `types.ts`: `ProposalRole = { role: string; rate: number; hoursPerWeek: number[] }`, `ProposalSummaryLine = { item: string; price: number; covers?: 'budget' }`, `ProposalAuthor = { name: string; email: string; phone?: string }`, `ProposalData = { template: string; kind: string; project: string; date: string; author: ProposalAuthor; team: ProposalRole[]; currency: 'EUR'; sections: Record<string, string>; stage?: string; number?: string; docNumber?: string; rev?: string; summary?: ProposalSummaryLine[]; annex?: string }`, and `class ProposalError extends Error { errors: string[] }`.
  - `data.ts`: `readProposalData(jsonText: string): { data: ProposalData; warnings: string[] }` — throws `ProposalError` with **all** errors collected.
- Tasks 3, 8, 9, 10, 11 consume these.

- [ ] **Step 1: Write the failing tests**

Create `test/proposal/data.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/proposal/data.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement the types**

Create `src/proposal/types.ts`:

```ts
// The facts of one offer — only what changes from offer to offer. Everything
// stable lives in the template. See the spec's "Data model".

export type ProposalRole = { role: string; rate: number; hoursPerWeek: number[] };
export type ProposalSummaryLine = { item: string; price: number; covers?: 'budget' };
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
```

- [ ] **Step 4: Implement the reader**

Create `src/proposal/data.ts`:

```ts
// JSON text → a validated ProposalData. Collects every error before throwing:
// the message is the checklist for fixing the file, not the first line of it.

import { toCents } from './money.js';
import { ProposalError, type ProposalAuthor, type ProposalData, type ProposalRole, type ProposalSummaryLine } from './types.js';

const TOP_KEYS = new Set([
  'template', 'kind', 'project', 'date', 'author', 'team', 'currency', 'sections',
  'stage', 'number', 'docNumber', 'rev', 'summary', 'annex',
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
      try {
        toCents(r['rate'], `${at}.rate`);
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
      if (role !== undefined && typeof r['rate'] === 'number' && Array.isArray(hours)) {
        team.push({ role, rate: r['rate'], hoursPerWeek: hours as number[] });
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
        try {
          toCents(s['price'], `${at}.price`);
        } catch (e) {
          errors.push((e as Error).message);
        }
        if (s['covers'] !== undefined && s['covers'] !== 'budget') {
          errors.push(`${at}.covers: the only known value is "budget", got ${JSON.stringify(s['covers'])}`);
        }
        if (item !== undefined && typeof s['price'] === 'number') {
          summary!.push({ item, price: s['price'], ...(s['covers'] === 'budget' ? { covers: 'budget' as const } : {}) });
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
    },
    warnings,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/proposal/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/proposal/types.ts src/proposal/data.ts test/proposal/data.test.ts
git commit -m "Read a proposal's facts, refusing what the model does not know"
```

---

### Task 3: The template language — three constructions, nothing else

**Files:**
- Create: `src/proposal/template.ts`
- Test: `test/proposal/template.test.ts`

**Interfaces:**
- Consumes: `ProposalData`, `ProposalError` from Task 2.
- Produces:
  - `type TplNode = { t: 'text'; text: string } | { t: 'field'; path: string } | { t: 'presence'; positive: boolean; path: string; children: TplNode[] } | { t: 'directive'; name: string; args: Record<string, string> }`
  - `parseTemplate(src: string): TplNode[]` — throws `ProposalError` with all parse errors.
  - `type FlatItem = { t: 'md'; text: string } | { t: 'directive'; name: string; args: Record<string, string> }`
  - `flattenTemplate(nodes: TplNode[], data: ProposalData): FlatItem[]` — resolves fields and presence blocks; `{{section:name}}` becomes an `{ t: 'md' }` item holding the section's markdown; throws `ProposalError` on a missing field/section. Adjacent md items are merged.
- Task 9 consumes both functions.

- [ ] **Step 1: Write the failing tests**

Create `test/proposal/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flattenTemplate, parseTemplate } from '../../src/proposal/template.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';

const DATA: ProposalData = {
  template: 't.md', kind: 'COMMERCIAL OFFER', project: 'BER01', date: '13.04.2026',
  author: { name: 'A. Sheronov', email: 'a@tebin.pro' },
  team: [{ role: 'Electrical', rate: 45, hoursPerWeek: [8, 8] }],
  currency: 'EUR',
  sections: { general: 'The general text.' },
  stage: 'LP5',
};

const flat = (src: string, data: ProposalData = DATA) => flattenTemplate(parseTemplate(src), data);
const errorsOf = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof ProposalError) return e.errors; throw e; }
  return [];
};

describe('parseTemplate', () => {
  it('reads text, fields, presence blocks and directives', () => {
    const nodes = parseTemplate('# {{kind}}\n{{?stage}}Stage: {{stage}}{{/?}}\n{{@budget}}\n');
    expect(nodes.map((n) => n.t)).toEqual(['text', 'field', 'text', 'presence', 'text', 'directive', 'text']);
  });

  it('refuses an unclosed presence block', () => {
    expect(errorsOf(() => parseTemplate('{{?stage}}never closed')).join('\n')).toMatch(/\{\{\?stage\}\}.*not closed/s);
  });

  it('refuses a stray close', () => {
    expect(errorsOf(() => parseTemplate('text {{/?}} more')).join('\n')).toMatch(/\{\{\/\?\}\}.*no open/s);
  });

  it('refuses a token it cannot read, quoting it', () => {
    expect(errorsOf(() => parseTemplate('{{not a field!}}')).join('\n')).toMatch(/not a field!/);
  });

  it('requires a directive to stand alone on its line', () => {
    expect(errorsOf(() => parseTemplate('Total: {{@budget}}')).join('\n')).toMatch(/own line/);
  });

  it('collects several errors in one pass', () => {
    const errs = errorsOf(() => parseTemplate('{{bad token}} and {{another one}}'));
    expect(errs).toHaveLength(2);
  });
});

describe('flattenTemplate', () => {
  it('substitutes fields, including dotted paths', () => {
    const items = flat('By {{author.name}} for {{project}}.');
    expect(items).toEqual([{ t: 'md', text: 'By A. Sheronov for BER01.' }]);
  });

  it('keeps a present presence block and drops an absent one', () => {
    expect(flat('{{?stage}}Stage: {{stage}}. {{/?}}End.')).toEqual([{ t: 'md', text: 'Stage: LP5. End.' }]);
    const noStage: ProposalData = { ...DATA };
    delete (noStage as Partial<ProposalData>).stage;
    expect(flat('{{?stage}}Stage: {{stage}}. {{/?}}End.', noStage)).toEqual([{ t: 'md', text: 'End.' }]);
  });

  it('renders an absence block only when the field is absent', () => {
    const src = '{{^sections.assumptions}}Default assumptions.{{/^}}';
    expect(flat(src)).toEqual([{ t: 'md', text: 'Default assumptions.' }]);
    expect(flat(src, { ...DATA, sections: { ...DATA.sections, assumptions: 'Mine.' } })).toEqual([]);
  });

  it('turns {{section:name}} into that section’s own markdown', () => {
    expect(flat('Before.\n{{section:general}}\nAfter.')).toEqual([
      { t: 'md', text: 'Before.\nThe general text.\nAfter.' },
    ]);
  });

  it('fails on a field with no value, naming the field', () => {
    expect(errorsOf(() => flat('{{docNumber}}')).join('\n')).toMatch(/docNumber/);
  });

  it('fails on a section the data does not carry, naming it', () => {
    expect(errorsOf(() => flat('{{section:exclusions}}')).join('\n')).toMatch(/exclusions/);
  });

  it('keeps a directive as its own item between merged text', () => {
    const items = flat('Above.\n\n{{@heatmap style=marks}}\n\nBelow.');
    expect(items).toEqual([
      { t: 'md', text: 'Above.\n\n' },
      { t: 'directive', name: 'heatmap', args: { style: 'marks' } },
      { t: 'md', text: '\n\nBelow.' },
    ]);
  });

  it('refuses an object-valued field as not printable', () => {
    expect(errorsOf(() => flat('{{author}}')).join('\n')).toMatch(/author.*not a printable value/s);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/proposal/template.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/proposal/template.ts`:

```ts
// The template language. Three constructions — a field, a presence/absence
// block, a directive — and nothing else: no loops, no expressions, no
// helpers. Anything needing logic lives in the assembler under tests, not in
// a template where nothing checks it.

import { ProposalError, type ProposalData } from './types.js';

export type TplNode =
  | { t: 'text'; text: string }
  | { t: 'field'; path: string }
  | { t: 'presence'; positive: boolean; path: string; children: TplNode[] }
  | { t: 'directive'; name: string; args: Record<string, string> };

export type FlatItem =
  | { t: 'md'; text: string }
  | { t: 'directive'; name: string; args: Record<string, string> };

const TOKEN = /\{\{(.*?)\}\}/g;
const FIELD = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*$/;

export function parseTemplate(src: string): TplNode[] {
  const errors: string[] = [];
  // Stack of open presence blocks; the root list is the bottom entry.
  const root: TplNode[] = [];
  const stack: { node?: Extract<TplNode, { t: 'presence' }>; list: TplNode[]; opener: string }[] = [
    { list: root, opener: '' },
  ];
  const top = () => stack[stack.length - 1]!;

  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index! > last) top().list.push({ t: 'text', text: src.slice(last, m.index) });
    last = m.index! + m[0].length;
    const inner = (m[1] ?? '').trim();

    if (inner.startsWith('?') || inner.startsWith('^')) {
      const positive = inner.startsWith('?');
      const path = inner.slice(1).trim();
      if (!FIELD.test(path)) { errors.push(`cannot read ${JSON.stringify(m[0])} — a presence block opens with a field path`); continue; }
      const node: Extract<TplNode, { t: 'presence' }> = { t: 'presence', positive, path, children: [] };
      top().list.push(node);
      stack.push({ node, list: node.children, opener: m[0] });
    } else if (inner === '/?' || inner === '/^') {
      const open = top().node;
      if (open === undefined || open.positive !== (inner === '/?')) {
        errors.push(`${m[0]} has no open ${inner === '/?' ? '{{?…}}' : '{{^…}}'} block to close`);
      } else {
        stack.pop();
      }
    } else if (inner.startsWith('@')) {
      // One per line: a directive expands to whole blocks, and half a
      // sentence around a table is not something the assembler can honour.
      const lineStart = src.lastIndexOf('\n', m.index! - 1) + 1;
      const lineEnd = ((i) => (i === -1 ? src.length : i))(src.indexOf('\n', last));
      const around = src.slice(lineStart, m.index!) + src.slice(last, lineEnd);
      if (around.trim() !== '') {
        errors.push(`${m[0]} must stand alone on its own line — it expands to whole blocks, not to words`);
      }
      const [head, ...rest] = inner.slice(1).split(/\s+/);
      const args: Record<string, string> = {};
      for (const part of rest) {
        const eq = part.indexOf('=');
        if (eq <= 0) { errors.push(`${m[0]}: cannot read argument ${JSON.stringify(part)} — expected key=value`); continue; }
        args[part.slice(0, eq)] = part.slice(eq + 1);
      }
      top().list.push({ t: 'directive', name: head ?? '', args });
    } else if (inner.startsWith('section:')) {
      top().list.push({ t: 'directive', name: 'section', args: { name: inner.slice('section:'.length).trim() } });
    } else if (FIELD.test(inner)) {
      top().list.push({ t: 'field', path: inner });
    } else {
      errors.push(`cannot read ${JSON.stringify(m[0])} — a token is a {{field}}, a {{?presence}}/{{^absence}} block, a {{@directive}}, or {{section:name}}`);
    }
  }
  if (last < src.length) top().list.push({ t: 'text', text: src.slice(last) });
  while (stack.length > 1) {
    errors.push(`${stack.pop()!.opener} is not closed`);
  }
  if (errors.length > 0) throw new ProposalError(errors);
  return root;
}

/** Dotted lookup over the data. Absent, '' and [] all count as "absent" for a
 *  presence block; a real value that is an object or array is not printable. */
function lookup(data: ProposalData, path: string): unknown {
  let v: unknown = data;
  for (const part of path.split('.')) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

const isAbsent = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function flattenTemplate(nodes: TplNode[], data: ProposalData): FlatItem[] {
  const errors: string[] = [];
  const out: FlatItem[] = [];
  const push = (text: string) => {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.t === 'md') prev.text += text;
    else out.push({ t: 'md', text });
  };
  const walk = (list: TplNode[]): void => {
    for (const n of list) {
      switch (n.t) {
        case 'text': push(n.text); break;
        case 'field': {
          const v = lookup(data, n.path);
          if (isAbsent(v)) errors.push(`{{${n.path}}} has no value — supply it in the data file, or wrap the block in {{?${n.path}}}…{{/?}}`);
          else if (typeof v !== 'string' && typeof v !== 'number') errors.push(`{{${n.path}}} is not a printable value — it is an object or a list`);
          else push(String(v));
          break;
        }
        case 'presence':
          if (isAbsent(lookup(data, n.path)) !== n.positive) walk(n.children);
          break;
        case 'directive':
          if (n.name === 'section') {
            const name = n.args['name'] ?? '';
            const v = data.sections[name];
            if (v === undefined) errors.push(`{{section:${name}}} — the data file's sections carry no ${JSON.stringify(name)}`);
            else push(v);
          } else {
            out.push({ t: 'directive', name: n.name, args: n.args });
          }
          break;
      }
    }
  };
  walk(nodes);
  if (errors.length > 0) throw new ProposalError(errors);
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/proposal/template.test.ts && npm run typecheck`
Expected: PASS. If the "keeps a directive as its own item" case disagrees about exact whitespace, fix the *test's* expectation to the parser's actual split — the contract is "text, directive, text", not a byte-exact whitespace shape.

- [ ] **Step 5: Commit**

```bash
git add src/proposal/template.ts test/proposal/template.test.ts
git commit -m "Parse the proposal template: three constructions, all substitutions"
```

---

### Task 4: The heatmap block — IR, validation, tint math, Markdown rendering

**Files:**
- Create: `src/render/tint.ts`
- Modify: `src/ir/types.ts` (the `Block` union), `src/ir/validate.ts`, `src/render/md.ts`
- Test: `test/render/tint.test.ts`, additions to `test/ir/validate.test.ts` (or create beside the existing validate tests — check `test/` for where validateDoc is tested and put them there), additions to `test/render/md.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Block` gains `| { t: 'heatmap'; style: 'fill' | 'scale' | 'numbers' | 'marks'; rows: { label: string; values: number[] }[] }` — the week count is `rows[0].values.length`, deliberately not stored twice.
  - `tint.ts`: `SCALE_STEPS: readonly number[]` (`[0.12, 0.32, 0.6, 1]`), `stepOf(value: number, max: number, steps: number): number` (0 = empty, 1..steps), `mixToWhite(hex: string, t: number): string`, `HEATMAP_LEGEND: string`, `weekLabel(i: number): string` (`W01`…).
- Tasks 5, 6, 8 consume all of these.

- [ ] **Step 1: Write the failing tint tests**

Create `test/render/tint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mixToWhite, stepOf, weekLabel, SCALE_STEPS } from '../../src/render/tint.js';

describe('stepOf', () => {
  it('maps zero to the empty step and the maximum to the top step', () => {
    expect(stepOf(0, 16, 4)).toBe(0);
    expect(stepOf(16, 16, 4)).toBe(4);
  });
  it('spreads intermediate values across the steps by ceiling', () => {
    expect(stepOf(1, 16, 4)).toBe(1);
    expect(stepOf(4, 16, 4)).toBe(1);
    expect(stepOf(5, 16, 4)).toBe(2);
    expect(stepOf(8, 16, 4)).toBe(2);
    expect(stepOf(12, 16, 4)).toBe(3);
    expect(stepOf(13, 16, 4)).toBe(4);
  });
  it('survives a zero maximum without dividing by it', () => {
    expect(stepOf(0, 0, 4)).toBe(0);
  });
});

describe('mixToWhite', () => {
  it('is the identity at t=1 and white at t=0', () => {
    expect(mixToWhite('#DA291C', 1)).toBe('#DA291C');
    expect(mixToWhite('#DA291C', 0)).toBe('#FFFFFF');
  });
  it('blends per channel with rounding, deterministically', () => {
    // 0xDA=218 → 218*0.32 + 255*0.68 = 243.16 → 243 = F3
    // 0x29=41  → 41*0.32 + 255*0.68  = 186.52 → 187 = BB (wait: 41*0.32=13.12, +173.4=186.52 → 187)
    // 0x1C=28  → 28*0.32 + 255*0.68  = 182.36 → 182 = B6
    expect(mixToWhite('#DA291C', 0.32)).toBe('#F3BBB6');
  });
  it('exposes the same steps every renderer uses', () => {
    expect(SCALE_STEPS).toEqual([0.12, 0.32, 0.6, 1]);
  });
});

describe('weekLabel', () => {
  it('pads to two digits and grows past 99 without truncating', () => {
    expect(weekLabel(0)).toBe('W01');
    expect(weekLabel(15)).toBe('W16');
    expect(weekLabel(99)).toBe('W100');
  });
});
```

Before Step 3, verify the `#F3BBB6` arithmetic by hand once more against the implementation below; if a channel disagrees by one due to rounding, correct the *expected value in the test* from the printed actual — the contract is "deterministic per-channel rounding", not a specific pre-computed constant.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/render/tint.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement tint.ts**

Create `src/render/tint.ts`:

```ts
// The heatmap's shared numbers: how a value becomes a step, and how a step
// becomes a colour. One module, because three renderers draw the same matrix
// and two of them computing tints two different ways is exactly the drift the
// agreement suite exists to catch — cheaper to make it impossible.

/** Tint fractions for the scale/numbers styles, palest to full. Four steps:
 *  few enough to tell apart on paper, and an odd middle is not needed. */
export const SCALE_STEPS: readonly number[] = [0.12, 0.32, 0.6, 1];

/** 0 for an empty cell, else 1..steps by ceiling against the matrix maximum. */
export function stepOf(value: number, max: number, steps: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(steps, Math.ceil((value / max) * steps));
}

/** `#RRGGBB` blended toward white: t=1 is the colour itself, t=0 is white.
 *  Plain per-channel srgb interpolation — the same arithmetic CSS
 *  `color-mix(in srgb, C p%, white)` performs, which is what lets the HTML
 *  renderer use color-mix with these fractions and still match Word's
 *  computed fills. */
export function mixToWhite(hex: string, t: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (shift: number): string => {
    const c = (n >> shift) & 0xff;
    return Math.round(c * t + 255 * (1 - t)).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

/** The one legend sentence, shared so PDF, DOCX and Markdown print the same
 *  words. Only the scale style earns a legend — fill is binary, numbers show
 *  their own values, marks are their own legend. */
export const HEATMAP_LEGEND = 'Shading scales with hours per week; the darkest cell is the busiest.';

export const weekLabel = (i: number): string => `W${String(i + 1).padStart(2, '0')}`;
```

- [ ] **Step 4: Run the tint tests**

Run: `npx vitest run test/render/tint.test.ts`
Expected: PASS (correct the blend expectation from actual output if a channel is off by one — see Step 1's note).

- [ ] **Step 5: Extend the IR and its validator (failing tests first)**

Find where `validateDoc` is tested: `Grep pattern="validateDoc" path="test" output_mode="files_with_matches"`. Add to that file (call it the validate suite):

```ts
it('accepts a well-formed heatmap block', () => {
  expect(() => validateDoc({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style: 'scale', rows: [{ label: 'Electrical', values: [8, 8, 0] }] }],
  })).not.toThrow();
});

it('refuses a heatmap whose rows disagree about the week count', () => {
  expect(() => validateDoc({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style: 'scale', rows: [
      { label: 'A', values: [1, 2] }, { label: 'B', values: [1] },
    ] }],
  })).toThrow(/week/);
});

it('refuses an unknown heatmap style, a negative value, and an empty matrix', () => {
  const mk = (over: object) => ({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style: 'scale', rows: [{ label: 'A', values: [1] }], ...over }],
  });
  expect(() => validateDoc(mk({ style: 'rainbow' }))).toThrow(/style/);
  expect(() => validateDoc(mk({ rows: [{ label: 'A', values: [-1] }] }))).toThrow(/values\[0\]/);
  expect(() => validateDoc(mk({ rows: [] }))).toThrow(/at least one row/);
});
```

Run them: FAIL (`unknown block type "heatmap"`).

In `src/ir/types.ts`, add to the `Block` union after `table`:

```ts
  // A discipline-by-week involvement matrix — hours, not colours: colour
  // belongs to the theme, and the renderers map a value to a fill or a mark.
  // `style` travels in the block because the template chooses it per matrix.
  // The week count is rows[0].values.length, deliberately not stored twice.
  | { t: 'heatmap'; style: 'fill' | 'scale' | 'numbers' | 'marks'; rows: { label: string; values: number[] }[] }
```

In `src/ir/validate.ts`: add `'heatmap'` to `BLOCK_TYPES`, and a case in `checkBlock` before `default`:

```ts
    case 'heatmap': {
      const styles = new Set(['fill', 'scale', 'numbers', 'marks']);
      if (typeof n['style'] !== 'string' || !styles.has(n['style'])) {
        fail(where, `unknown heatmap style ${JSON.stringify(n['style'])} — expected fill, scale, numbers or marks`);
      }
      const rows = n['rows'];
      if (!Array.isArray(rows) || rows.length === 0) fail(`${where}.rows`, 'a heatmap needs at least one row');
      let weeks = -1;
      rows.forEach((row, r) => {
        const at = `${where}.rows[${r}]`;
        if (typeof row !== 'object' || row === null) fail(at, 'expected an object');
        const rr = row as Record<string, unknown>;
        if (typeof rr['label'] !== 'string' || rr['label'] === '') fail(at, 'row needs a non-empty label');
        const values = rr['values'];
        if (!Array.isArray(values) || values.length === 0) fail(`${at}.values`, 'expected a non-empty array of numbers');
        values.forEach((v, i) => {
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${at}.values[${i}]`, `expected a number ≥ 0, got ${JSON.stringify(v)}`);
        });
        if (weeks === -1) weeks = values.length;
        else if (values.length !== weeks) fail(at, `has ${values.length} week(s) where the first row has ${weeks}`);
      });
      return;
    }
```

The compiler now fails on `src/render/md.ts`, `html.ts`, `docx.ts` (exhaustive switches missing a case) and possibly `src/cli/inspect.ts` (a `Counts` switch). This task closes only `md.ts`; add **temporary** `case 'heatmap':` stubs to `html.ts` and `docx.ts` is NOT allowed — instead do Tasks 4, 5, 6 as one commit chain without a broken intermediate commit: finish this task's md.ts case, then leave the tree uncommitted if html/docx still fail typecheck, and only commit after Task 6's step completes them. **Correction for executors:** to keep each task independently committable, close all three renderers' compile errors in THIS task with real minimal implementations where cheap (md) and move the substantive html/docx work to Tasks 5–6 as *improvements with their own tests* — concretely: in this task give `html.ts` and `docx.ts` a minimal-but-honest case (html: a plain `numbers`-style table with no tint; docx: same via a plain IR-table-shaped rendering), and let Tasks 5–6 replace them with the styled versions. If `inspect.ts` fails to compile (a `Counts` union walk), add a `heatmaps: number` count there and a `heatmaps` line to its renderer — its parity test walks the structure and will demand the line.

- [ ] **Step 6: Markdown rendering (failing test first)**

Add to `test/render/md.test.ts`:

```ts
describe('heatmap in Markdown', () => {
  const doc = (style: 'fill' | 'scale' | 'numbers' | 'marks'): Doc => ({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] }],
  });

  it('writes numbers (and scale) as an hours table with week headers', () => {
    const md = renderMarkdown(doc('numbers'));
    expect(md).toContain('| W01 | W02 | W03 |');
    expect(md).toContain('| Electrical | 16 | 8 |  |');
    expect(md).toContain('| BIM | 4 | 4 | 4 |');
  });

  it('writes marks as marks, stepped against the matrix maximum', () => {
    const md = renderMarkdown(doc('marks'));
    expect(md).toContain('| Electrical | ▪▪▪ | ▪▪ |  |');
  });

  it('writes fill as filled-or-empty', () => {
    const md = renderMarkdown(doc('fill'));
    expect(md).toContain('| Electrical | ■ | ■ |  |');
  });

  it('prints the legend sentence for scale only', () => {
    expect(renderMarkdown(doc('scale'))).toContain(HEATMAP_LEGEND);
    expect(renderMarkdown(doc('numbers'))).not.toContain(HEATMAP_LEGEND);
  });
});
```

(Imports: `HEATMAP_LEGEND` from `../../src/render/tint.js`, `Doc` from `../../src/ir/types.js` — match the file's existing import style.)

In `src/render/md.ts`, add the case to `block()` (import `HEATMAP_LEGEND`, `stepOf`, `weekLabel` from `./tint.js`):

```ts
    case 'heatmap': {
      const weeks = b.rows[0]?.values.length ?? 0;
      const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
      // Markdown is the readable intermediate, so scale — tint-only on paper —
      // shows its hours here rather than an empty grid.
      const cellFor = (v: number): string =>
        b.style === 'marks' ? '▪'.repeat(stepOf(v, max, 3))
        : b.style === 'fill' ? (v > 0 ? '■' : '')
        : v > 0 ? String(v) : '';
      const head = ['', ...Array.from({ length: weeks }, (_, i) => weekLabel(i))];
      const sep = [':--', ...Array.from({ length: weeks }, () => ':-:')];
      const lines = [
        `| ${head.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...b.rows.map((r) => `| ${[r.label, ...r.values.map(cellFor)].join(' | ')} |`),
      ];
      return (b.style === 'scale' ? [...lines, '', HEATMAP_LEGEND] : lines).join('\n');
    }
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS — including the minimal html/docx cases from Step 5's correction and any inspect `Counts` addition.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Teach the IR an involvement heatmap, and Markdown to write it"
```

---

### Task 5: The heatmap in HTML/PDF

**Files:**
- Modify: `src/render/html.ts`
- Test: additions to `test/render/html.test.ts` (if that file does not exist, find where `buildHtml` is tested — `Grep pattern="buildHtml" path="test"` — and add there)

**Interfaces:**
- Consumes: the `heatmap` block (Task 4), `SCALE_STEPS`, `stepOf`, `weekLabel`, `HEATMAP_LEGEND` from `tint.js`.
- Produces: nothing later tasks import; the markup shape below is pinned by tests.

- [ ] **Step 1: Write the failing tests**

Add to the buildHtml suite:

```ts
describe('heatmap', () => {
  const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
  const doc = (style: 'fill' | 'scale' | 'numbers' | 'marks'): Doc => ({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] }],
  });

  it('scale: tints by step class and prints no digits', async () => {
    const html = await buildHtml(doc('scale'), theme);
    expect(html).toContain('<table class="heatmap">');
    expect(html).toContain('<th>W01</th>');
    expect(html).toMatch(/<td class="hm hm-s4"><\/td>/);   // 16 of max 16
    expect(html).toMatch(/<td class="hm hm-s2"><\/td>/);   // 8 of 16
    expect(html).toMatch(/<td class="hm hm-s0"><\/td>/);   // 0
    expect(html).toContain(HEATMAP_LEGEND);
  });

  it('numbers: prints the hours over the tint', async () => {
    const html = await buildHtml(doc('numbers'), theme);
    expect(html).toMatch(/<td class="hm hm-s4">16<\/td>/);
    expect(html).not.toContain(HEATMAP_LEGEND);
  });

  it('marks: prints marks and no tint class above s0', async () => {
    const html = await buildHtml(doc('marks'), theme);
    expect(html).toMatch(/<td class="hm hm-marks">▪▪▪<\/td>/);
  });

  it('fill: binary brand fill', async () => {
    const html = await buildHtml(doc('fill'), theme);
    expect(html).toMatch(/<td class="hm hm-fill"><\/td>/);
    expect(html).toMatch(/<td class="hm hm-s0"><\/td>/);
  });

  it('the stylesheet computes tints from the theme and survives print', async () => {
    const html = await buildHtml(doc('scale'), theme);
    expect(html).toContain('color-mix(in srgb, var(--brand) 32%, white)');
    expect(html).toContain('print-color-adjust: exact');
  });
});
```

- [ ] **Step 2: Run and watch the new cases fail**

Run: `npx vitest run test/render/html.test.ts` (or the located file)
Expected: FAIL — the Task-4 minimal case has no classes/tints.

- [ ] **Step 3: Implement**

In `src/render/html.ts` (import `HEATMAP_LEGEND`, `SCALE_STEPS`, `stepOf`, `weekLabel` from `./tint.js`), replace the minimal `heatmap` case in `block()`:

```ts
    case 'heatmap': {
      const weeks = b.rows[0]?.values.length ?? 0;
      const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
      const td = (v: number): string => {
        if (b.style === 'marks') return `<td class="hm hm-marks">${'▪'.repeat(stepOf(v, max, 3))}</td>`;
        if (b.style === 'fill') return v > 0 ? '<td class="hm hm-fill"></td>' : '<td class="hm hm-s0"></td>';
        const cls = `hm hm-s${stepOf(v, max, SCALE_STEPS.length)}`;
        const text = b.style === 'numbers' && v > 0 ? String(v) : '';
        return `<td class="${cls}">${text}</td>`;
      };
      const head = `<tr><th></th>${Array.from({ length: weeks }, (_, i) => `<th>${weekLabel(i)}</th>`).join('')}</tr>`;
      const rows = b.rows
        .map((r) => `<tr><td class="hm-label">${escapeHtml(r.label)}</td>${r.values.map(td).join('')}</tr>`)
        .join('');
      const legend = b.style === 'scale' ? `<p class="hm-legend">${escapeHtml(HEATMAP_LEGEND)}</p>` : '';
      return `<table class="heatmap"><thead>${head}</thead><tbody>${rows}</tbody></table>${legend}`;
    }
```

And add to the stylesheet in `buildHtml`, beside the existing table rules (note `print-color-adjust`: Chromium drops backgrounds in print without it, which would make every style but `marks` invisible in the actual PDF — the whole reason these two lines exist):

```ts
table.heatmap{ table-layout: fixed; }
table.heatmap td, table.heatmap th{ border-bottom: none; text-align: center; padding: 3pt 2pt; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
table.heatmap td.hm-label{ text-align: left; width: 28%; }
${SCALE_STEPS.map((t, i) => `.hm-s${i + 1}{ background: color-mix(in srgb, var(--brand) ${Math.round(t * 100)}%, white); }`).join('\n')}
.hm-fill{ background: var(--brand); }
.hm-marks{ color: var(--brand); letter-spacing: 1pt; }
.hm-legend{ color: var(--muted); font-size: ${(ty.bodyPt * 0.85).toFixed(1)}pt; margin: 2pt 0 10pt; }
```

(`hm-s0` needs no rule — an empty cell is the page. The `color-mix` percentages are *derived from* `SCALE_STEPS`, not typed beside them, so the two renderers cannot disagree by a copy-paste.)

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Paint the heatmap in HTML: theme-owned tints that survive print"
```

---

### Task 6: The heatmap in Word

**Files:**
- Modify: `src/render/docx.ts`
- Test: additions to `test/render/docx.test.ts`, one agreement case in `test/agreement/agree.test.ts`

**Interfaces:**
- Consumes: the `heatmap` block, `mixToWhite`, `SCALE_STEPS`, `stepOf`, `weekLabel`, `HEATMAP_LEGEND` from `tint.js`; docx.ts's own `columnDxa`, `NO_BORDERS`, `hex`, `halfPt`, `dxa` helpers.
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing tests**

Add to `test/render/docx.test.ts` (reusing the file's `doc`/`render`/`body` helpers and `docxPart`):

```ts
describe('heatmap', () => {
  const hm = (style: 'fill' | 'scale' | 'numbers' | 'marks') =>
    doc({ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] });

  it('scale: shades cells with tints computed from the theme', async () => {
    const xml = await body(hm('scale'));
    // 16/16 → step 4 → t=1 → the brand colour itself; 8/16 → step 2 → t=0.32.
    expect(xml).toContain('w:fill="DA291C"');
    expect(xml).toContain(`w:fill="${mixToWhite('#DA291C', 0.32).slice(1)}"`);
    // The zero cell is not shaded at all.
    const cells = [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
    expect(cells.some((c) => !c.includes('w:fill'))).toBe(true);
  });

  it('numbers: prints the hours in ink, never in the brand red', async () => {
    const xml = await body(hm('numbers'));
    expect(xml).toContain('>16<');
    // brandOnLight paints fills only — a digit run must not carry the brand colour.
    const runs = [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
    expect(runs.filter((r) => r.includes('>16<')).every((r) => !r.includes('DA291C'))).toBe(true);
  });

  it('marks: steps marks against the matrix maximum', async () => {
    const xml = await body(hm('marks'));
    expect(xml).toContain('▪▪▪');
    expect(xml).toContain('>▪▪<');
  });

  it('prints the legend for scale only', async () => {
    expect(await body(hm('scale'))).toContain(HEATMAP_LEGEND);
    expect(await body(hm('numbers'))).not.toContain(HEATMAP_LEGEND);
  });

  it('labels the weeks W01.. in the header row', async () => {
    const xml = await body(hm('fill'));
    expect(xml).toContain('W01');
    expect(xml).toContain('W03');
  });

  it('is byte-identical twice with a heatmap in it', async () => {
    const d = hm('scale');
    expect((await render(d)).equals(await render(d))).toBe(true);
  });
});
```

(Imports to add at the top of the test file: `mixToWhite`, `HEATMAP_LEGEND` from `../../src/render/tint.js`.)

And in `test/agreement/agree.test.ts`, at the end of the `Word says what the others say` describe:

```ts
  it('shades the heatmap exactly where the IR puts the hours', async () => {
    // Hand-built IR rather than wordFrom(): markdown cannot express a heatmap,
    // and the offer assembler is the only producer — this pins the renderer
    // against the IR directly, the same reference the other comparisons use.
    const ir: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'heatmap', style: 'numbers', rows: [
        { label: 'Electrical', values: [16, 8, 0] },
        { label: 'BIM', values: [4, 0, 4] },
      ] }],
    };
    const xml = await docxPart(await renderDocx(ir, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const table = tablesFromDocx(xml)[0]!;
    const values = table.slice(1).map((row) => row.slice(1).map((c) => (c.text === '' ? 0 : Number(c.text))));
    expect(values).toEqual([[16, 8, 0], [4, 0, 4]]);
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/render/docx.test.ts -t heatmap`
Expected: FAIL — the Task-4 minimal case has no shading.

- [ ] **Step 3: Implement**

In `src/render/docx.ts` (imports: add `mixToWhite, SCALE_STEPS, stepOf, weekLabel, HEATMAP_LEGEND` from `./tint.js`; `ShadingType` is already imported), replace the minimal case in `blocks()` with `return heatmapBlocks(b, theme);` and add:

```ts
/**
 * The involvement matrix. Shading carries the value; any text is ink —
 * brandOnLight paints fills and large display type only, never digits at
 * body size, which is the brand book's own line and the theme's law.
 */
function heatmapBlocks(b: Extract<Block, { t: 'heatmap' }>, theme: Theme): (Paragraph | Table)[] {
  const weeks = b.rows[0]?.values.length ?? 0;
  const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
  const total = columnDxa(theme);
  const labelW = Math.round(total * 0.28);
  const weekW = weeks > 0 ? Math.floor((total - labelW) / weeks) : 0;
  // Largest-remainder is overkill for equal columns: give the rounding slack
  // to the label column so the widths still sum to the text column exactly.
  const widths = [total - weekW * weeks, ...Array.from({ length: weeks }, () => weekW)];

  const run = (text: string, brand: boolean) =>
    new TextRun({ text, size: halfPt(theme.type.bodyPt * 0.95), ...(brand ? { color: hex(theme.colors.brandOnLight) } : {}) });
  const cell = (children: Paragraph[], width: number, fill?: string) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: NO_BORDERS,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      ...(fill === undefined ? {} : { shading: { type: ShadingType.CLEAR, color: 'auto', fill } }),
      children,
    });
  const centred = (children: TextRun[]) => new Paragraph({ alignment: AlignmentType.CENTER, children });

  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: [
      cell([new Paragraph({ children: [] })], widths[0]!),
      ...Array.from({ length: weeks }, (_, i) => cell([centred([run(weekLabel(i), false)])], weekW)),
    ],
  });
  const bodyRows = b.rows.map((r) => new TableRow({
    cantSplit: true,
    children: [
      cell([new Paragraph({ children: [run(r.label, false)] })], widths[0]!),
      ...r.values.map((v) => {
        if (b.style === 'marks') return cell([centred(['▪'.repeat(stepOf(v, max, 3))].filter(Boolean).map((t) => run(t, true)))], weekW);
        if (b.style === 'fill') return cell([new Paragraph({ children: [] })], weekW, v > 0 ? hex(theme.colors.brandOnLight) : undefined);
        const step = stepOf(v, max, SCALE_STEPS.length);
        const fill = step > 0 ? mixToWhite(theme.colors.brandOnLight, SCALE_STEPS[step - 1]!).slice(1) : undefined;
        const text = b.style === 'numbers' && v > 0 ? [centred([run(String(v), false)])] : [new Paragraph({ children: [] })];
        return cell(Array.isArray(text) ? text : [text], weekW, fill);
      }),
    ],
  }));

  const table = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: NO_BORDERS,
    rows: [headerRow, ...bodyRows],
  });
  const legend = b.style === 'scale'
    ? [new Paragraph({
        spacing: { before: dxa(2), after: dxa(10) },
        children: [new TextRun({ text: HEATMAP_LEGEND, color: hex(theme.colors.muted), size: halfPt(theme.type.bodyPt * 0.85) })],
      })]
    : [new Paragraph({ spacing: { after: dxa(10) }, children: [] })];
  return [table, ...legend];
}
```

(Adjust the `marks` cell line if TypeScript objects to the filter-map dance — the intent is: an empty marks cell gets an empty paragraph, a non-empty one gets one brand-coloured run. Write it as a plain `if` if clearer; the tests are the contract, not this exact expression.)

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, including the agreement case and byte-identity.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Shade the heatmap in Word from the theme's own colour"
```

---

### Task 7: Let only the annex raise the spreadsheet row cap

**Files:**
- Modify: `src/ingest/xlsx.ts`
- Create: `test/helpers/xlsx-fixture.ts`
- Test: additions to `test/ingest/xlsx.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ingestXlsx(bytes: Buffer, opts?: IngestOpts, limits?: { maxRows?: number }): Promise<Ingested>` — the third parameter is new and optional; omitted, behaviour is byte-for-byte what it is today. `makeXlsx(rows: string[][], sheetName?: string): Promise<Buffer>` from the new helper. Task 9's annex path passes `{ maxRows: 2000 }`.

- [ ] **Step 1: Write the fixture helper**

`test/ingest/xlsx.test.ts` already builds workbooks for its own cases — read its top first. If it has a reusable builder, lift that into `test/helpers/xlsx-fixture.ts` and re-export; if its construction is inline per test, create the helper fresh:

```ts
// A minimal in-memory .xlsx: one sheet, shared strings, no styles. Enough for
// the ingester's happy path; tests needing merges or number formats keep
// building their own richer packages.
import JSZip from 'jszip';

export async function makeXlsx(rows: string[][], sheetName = 'Sheet1'): Promise<Buffer> {
  const strings: string[] = [];
  const indexOf = (s: string): number => {
    const i = strings.indexOf(s);
    if (i !== -1) return i;
    strings.push(s);
    return strings.length - 1;
  };
  const colRef = (c: number): string => {
    let ref = '';
    for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) ref = String.fromCharCode(65 + (n % 26)) + ref;
    return ref;
  };
  const sheetXml = rows
    .map((row, r) => `<row r="${r + 1}">${row
      .map((v, c) => (v === '' ? '' : `<c r="${colRef(c)}${r + 1}" t="s"><v>${indexOf(v)}</v></c>`))
      .join('')}</row>`)
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`);
  return await zip.generateAsync({ type: 'nodebuffer' });
}
```

Sanity-check it against the real ingester before relying on it: `ingestXlsx(await makeXlsx([['A', 'B'], ['1', '2'], ['3', '4']]))` must produce one table block. If it does not, read `readWorksheet` in `src/ingest/xlsx.ts` and adjust the XML shape to what the ingester actually reads (it was written from a corpus of real files; shared strings with `t="s"` is that corpus's common shape).

- [ ] **Step 2: Write the failing tests**

Add to `test/ingest/xlsx.test.ts`:

```ts
import { makeXlsx } from '../helpers/xlsx-fixture.js';

describe('the row cap, and who may move it', () => {
  const rowsOf = (n: number): string[][] => [['Name', 'Value'], ...Array.from({ length: n }, (_, i) => [`item ${i}`, String(i)])];

  it('refuses past the cap by default, exactly as before', async () => {
    const { dropped } = await ingestXlsx(await makeXlsx(rowsOf(201)));
    expect(dropped.join('\n')).toMatch(/refused/);
    expect(dropped.join('\n')).toMatch(/200/);
  });

  it('honours a raised cap when the caller supplies one', async () => {
    const { doc, dropped } = await ingestXlsx(await makeXlsx(rowsOf(201)), {}, { maxRows: 2000 });
    expect(dropped.join('\n')).not.toMatch(/refused/);
    expect(doc.blocks.some((b) => b.t === 'table')).toBe(true);
  });

  it('still refuses past even a raised cap, naming the raised number', async () => {
    const { dropped } = await ingestXlsx(await makeXlsx(rowsOf(11)), {}, { maxRows: 10 });
    expect(dropped.join('\n')).toMatch(/refused/);
    expect(dropped.join('\n')).toMatch(/10/);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run test/ingest/xlsx.test.ts -t "row cap"`
Expected: the first case may already pass; the second and third FAIL — `ingestXlsx` takes no third parameter.

- [ ] **Step 4: Thread the limit through**

In `src/ingest/xlsx.ts`: find the exported `ingestXlsx` signature and the place `MAX_ROWS` is compared (the module header names `MAX_ROWS`/`MAX_COLS`). Add the optional third parameter:

```ts
export async function ingestXlsx(
  bytes: Buffer, opts: IngestOpts = {}, limits: { maxRows?: number } = {},
): Promise<Ingested> {
```

(match the existing parameter names — change only what is needed), compute `const maxRows = limits.maxRows ?? MAX_ROWS;` once, and use `maxRows` in the comparison **and in the refusal message**, so a raised cap names the number that actually applied. `MAX_COLS` is untouched — the annex register is long, not wide. Add one comment where the parameter lands:

```ts
// `limits` exists for exactly one caller: the proposal assembler's annex
// path, where a deliverables register is a reference list that is searched,
// not read, and long is its nature. Neither `build` nor a sidecar can reach
// this parameter — the promise "a spreadsheet has to be a register a person
// reads on paper" weakens nowhere else.
```

- [ ] **Step 5: Run everything**

Run: `npx vitest run test/ingest/xlsx.test.ts && npm run typecheck`
Expected: PASS, including every pre-existing xlsx case (the default path must be unchanged).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Let a caller raise the spreadsheet row cap, and only the annex will"
```

---

### Task 8: The computed tables — summary, budget, schedule, heatmap

**Files:**
- Create: `src/proposal/blocks.ts`
- Test: `test/proposal/blocks.test.ts`

**Interfaces:**
- Consumes: `ProposalData`, `ProposalError` (Task 2), `toCents`, `formatMoney` (Task 1), the `heatmap` Block (Task 4), `weekLabel` from `tint.js`.
- Produces, all from `blocks.ts`:
  - `budgetTotalCents(data: ProposalData): number`
  - `summaryTable(data: ProposalData): Block` — throws `ProposalError` if `data.summary` is absent or empty.
  - `budgetTable(data: ProposalData): Block`
  - `scheduleTable(data: ProposalData): Block`
  - `heatmapOf(data: ProposalData, style: string | undefined): Block` — default style `'scale'`; throws on an unknown style.
- Task 9 consumes all five.

- [ ] **Step 1: Write the failing tests**

Create `test/proposal/blocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { budgetTable, budgetTotalCents, heatmapOf, scheduleTable, summaryTable } from '../../src/proposal/blocks.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';
import type { Inline } from '../../src/ir/types.js';

const NB = ' ';
const DATA: ProposalData = {
  template: 't.md', kind: 'COMMERCIAL PROPOSAL', project: 'Daimler Truck', date: '13.04.2026',
  author: { name: 'M. Mionchynsky', email: 'm@tebin.pro' },
  team: [
    { role: 'BIM Coordinator', rate: 45, hoursPerWeek: [4, 4, 4, 4, 4] },
    { role: 'Mechanical Engineer', rate: 45, hoursPerWeek: [16, 16, 16, 16, 16] },
  ],
  currency: 'EUR',
  sections: {},
  summary: [{ item: 'Engineering works', price: 4500, covers: 'budget' }],
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
    const d: ProposalData = { ...DATA, team: [{ role: 'X', rate: 45, hoursPerWeek: [0, 8, 6] }] };
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/proposal/blocks.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/proposal/blocks.ts`:

```ts
// The computed blocks — three projections of `team`, plus the priced summary.
// They cannot disagree with each other by construction, which is the whole
// reason `team` is the single source of numbers.

import type { Block, Inline } from '../ir/types.js';
import { weekLabel } from '../render/tint.js';
import { formatMoney, toCents } from './money.js';
import { ProposalError, type ProposalData } from './types.js';

const cell = (v: string): Inline[] => [{ t: 'text', v }];

export function budgetTotalCents(data: ProposalData): number {
  return data.team.reduce((sum, r) => {
    const hours = r.hoursPerWeek.reduce((a, b) => a + b, 0);
    return sum + hours * toCents(r.rate, `${r.role}.rate`);
  }, 0);
}

export function summaryTable(data: ProposalData): Block {
  if (data.summary === undefined || data.summary.length === 0) {
    throw new ProposalError(['{{@summary}} needs a "summary" array in the data file — the directive prints priced lines, and there are none to print']);
  }
  return {
    t: 'table',
    head: [cell('DESCRIPTION'), cell('PRICE')],
    align: ['l', 'r'],
    rows: data.summary.map((s) => [cell(s.item), cell(formatMoney(toCents(s.price, `summary "${s.item}"`), data.currency))]),
  };
}

export function budgetTable(data: ProposalData): Block {
  const rows = data.team.map((r) => {
    const hours = r.hoursPerWeek.reduce((a, b) => a + b, 0);
    const rateCents = toCents(r.rate, `${r.role}.rate`);
    return [cell(r.role), cell(String(hours)), cell(formatMoney(rateCents, data.currency)), cell(formatMoney(hours * rateCents, data.currency))];
  });
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/proposal/blocks.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proposal/blocks.ts test/proposal/blocks.test.ts
git commit -m "Compute the offer's tables from the one source of numbers"
```

---

### Task 9: The assembler, and the generic example that proves it

**Files:**
- Create: `src/proposal/assemble.ts`, `templates/offer.example.md`, `test/fixtures/offer-example.proposal.json`
- Test: `test/proposal/assemble.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8; `ingestMarkdown(source, opts): Ingested` from `src/ingest/md.js`; `ingestXlsx(bytes, opts, limits)` from Task 7. `validateDoc` is NOT called here — the CLI owns that gate, same as `build`.
- Produces: `assembleProposal(args: { data: ProposalData; template: string; annex?: Buffer }): Promise<{ doc: Doc; dropped: string[] }>` and `ANNEX_MAX_ROWS = 2000`, both from `assemble.ts`. Tasks 10 and 11 consume both.

- [ ] **Step 1: Write the generic example template**

Create `templates/offer.example.md` — no TEBIN figure or wording anywhere in it; every commercial sentence is placeholder prose a template owner replaces:

```markdown
# {{kind}} — {{project}}

ENGINEERING SERVICE

{{?stage}}Stage: {{stage}}{{/?}}
{{?number}}Proposal No.: {{number}}{{/?}}
{{?docNumber}}Doc. No.: {{docNumber}}{{/?}}
Date: {{date}}{{?rev}} | Rev.: {{rev}}{{/?}}

Contact: {{author.name}}{{?author.phone}}, {{author.phone}}{{/?}}, {{author.email}}

## GENERAL

{{section:general}}

{{?summary}}
## MANAGEMENT SUMMARY

{{@summary}}
{{/?}}

## SCOPE OF SERVICE

{{section:scope}}

## SCHEDULE

{{@heatmap}}

## RATES AND PRICE

{{@budget}}

All services are provided on a reimbursable basis according to the approved
time sheet.

{{?sections.assumptions}}
## ASSUMPTIONS

{{section:assumptions}}
{{/?}}

{{?sections.exclusions}}
## EXCLUSIONS

{{section:exclusions}}
{{/?}}

## INVOICING AND PAYMENT

- All prices are stated and shall be paid without VAT.
- Invoices are issued monthly against the approved scope of services.
- Payment is due within the agreed number of calendar days of the invoice date.

## REPORTING

- Progress reports — monthly.
- Activities are planned and agreed with the client's responsible persons.

{{?annex}}
## ANNEX A — DELIVERABLES

{{@annex}}
{{/?}}

Contractor: {{author.name}} {{author.email}}
```

Two checks before committing to this exact text: (1) how a page break is spelled — `Grep pattern="pagebreak" path="src/ingest/md.ts" output_mode="content" -C 3` — and if the ingester reads one from markdown at all, put it on its own line before `## ANNEX A` inside the `{{?annex}}` block, spelled exactly as the ingester reads it (the kitchen-sink fixture contains one; copy its spelling). If markdown has no page-break spelling the ingester accepts, leave the annex heading to flow naturally and note it in the template as a comment-free omission. (2) That `{{?annex}}`/`{{?summary}}` blank lines do not glue headings to paragraphs — Step 5's tests will catch it if they do.

Create `test/fixtures/offer-example.proposal.json`:

```json
{
  "template": "../../templates/offer.example.md",
  "kind": "COMMERCIAL PROPOSAL",
  "project": "Example Project",
  "stage": "Detail Design",
  "number": "0001-00-01",
  "date": "01.09.2026",
  "rev": "0",
  "author": { "name": "A. Author", "phone": "+48 000 000 000", "email": "author@example.com" },
  "summary": [
    { "item": "Engineering works", "price": 4500, "covers": "budget" },
    { "item": "Single site visit, if required", "price": 490 }
  ],
  "team": [
    { "role": "BIM Coordinator", "rate": 45, "hoursPerWeek": [4, 4, 4, 4, 4] },
    { "role": "Mechanical Engineer", "rate": 45, "hoursPerWeek": [16, 16, 16, 16, 16] }
  ],
  "sections": {
    "general": "The scope of services covers an example engineering assignment, described here in the client's own terms.",
    "scope": "The contractor provides dedicated engineering resources for the assignment:\n\n- modelling and layouts\n- coordination and validation",
    "assumptions": "- All works are carried out in coordination with the client's responsible engineers.",
    "exclusions": "- Business trips are not included and are agreed separately."
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/proposal/assemble.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleProposal } from '../../src/proposal/assemble.js';
import { readProposalData } from '../../src/proposal/data.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';
import { validateDoc } from '../../src/ir/validate.js';
import { makeXlsx } from '../helpers/xlsx-fixture.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'offer.example.md'), 'utf8');
const DATA = readProposalData(readFileSync(join(ROOT, 'test', 'fixtures', 'offer-example.proposal.json'), 'utf8')).data;

const errorsOf = async (fn: () => Promise<unknown>): Promise<string[]> => {
  try { await fn(); } catch (e) { if (e instanceof ProposalError) return e.errors; throw e; }
  return [];
};

describe('assembleProposal', () => {
  it('assembles the example into a Doc the validator accepts', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    expect(() => validateDoc(doc)).not.toThrow();
    expect(doc.meta.title).toBe('COMMERCIAL PROPOSAL — Example Project');
    expect(doc.meta.date).toBe('01.09.2026');
    const types = doc.blocks.map((b) => b.t);
    expect(types).toContain('heatmap');
    expect(types.filter((t) => t === 'table').length).toBeGreaterThanOrEqual(2); // summary + budget
  });

  it('splices each directive exactly where its line stood', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    const i = doc.blocks.findIndex((b) => b.t === 'heading' && JSON.stringify(b.text).includes('SCHEDULE'));
    expect(i).toBeGreaterThan(-1);
    expect(doc.blocks[i + 1]?.t).toBe('heatmap');
  });

  it('carries no sentinel into the document', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    expect(JSON.stringify(doc)).not.toContain('@@documentor-directive-');
  });

  it('fails when the covering summary line and the budget disagree, quoting both figures', async () => {
    const data: ProposalData = { ...DATA, summary: [{ item: 'Engineering works', price: 5000, covers: 'budget' }] };
    const errs = await errorsOf(() => assembleProposal({ data, template: TEMPLATE }));
    expect(errs.join('\n')).toContain('5 000,00');
    expect(errs.join('\n')).toContain('4 500,00');
  });

  it('refuses an unknown directive by name', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n{{@discount}}\n' }));
    expect(errs.join('\n')).toMatch(/discount/);
  });

  it('refuses {{@annex}} with no annex supplied', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n{{@annex}}\n' }));
    expect(errs.join('\n')).toMatch(/annex/);
  });

  it('carries an annex register through the raised cap', async () => {
    const rows = [['No', 'Document'], ...Array.from({ length: 400 }, (_, i) => [String(i + 1), `DOC-${i + 1}`])];
    const annex = await makeXlsx(rows, 'Deliverables');
    const data: ProposalData = { ...DATA, annex: './deliverables.xlsx' };
    const { doc } = await assembleProposal({ data, template: TEMPLATE, annex });
    const tables = doc.blocks.filter((b) => b.t === 'table');
    expect(tables.some((t) => t.t === 'table' && t.rows.length >= 400)).toBe(true);
  });

  it('relays an annex refusal as a build failure, not half an offer', async () => {
    const rows = [['No', 'Document'], ...Array.from({ length: 2001 }, (_, i) => [String(i), 'x'])];
    const annex = await makeXlsx(rows);
    const data: ProposalData = { ...DATA, annex: './d.xlsx' };
    const errs = await errorsOf(() => assembleProposal({ data, template: TEMPLATE, annex }));
    expect(errs.join('\n')).toMatch(/refused/);
  });

  it('reports a directive that could not stand alone as its own paragraph', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n- a list item\n{{@budget}}\n' }));
    // Inside a tight list the sentinel is swallowed into the list block and
    // never becomes its own paragraph — the assembler must say so, not
    // silently drop the budget table.
    expect(errs.join('\n')).toMatch(/own paragraph|own line/);
  });
});
```

(NBSP note: the two `toContain` figure assertions use a literal NBSP between the digit groups — type `5 000,00` with an escape if the editor normalises it: `expect(errs.join('\n')).toContain('5 000,00')`.)

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run test/proposal/assemble.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

Create `src/proposal/assemble.ts`:

```ts
// The pipeline: template + data → Doc. Fields and boilerplate become one
// markdown source with a sentinel paragraph standing where each directive
// stood; the whole source goes through ingestMarkdown once (so the title is
// lifted and every markdown rule applies across the whole document, not per
// fragment); then each sentinel paragraph is replaced by its directive's
// computed blocks. Nothing here writes a sentence of its own — every word
// in the output came from the data file or the template, verbatim.

import { ingestMarkdown } from '../ingest/md.js';
import { ingestXlsx } from '../ingest/xlsx.js';
import type { Block, Doc } from '../ir/types.js';
import { budgetTable, budgetTotalCents, heatmapOf, scheduleTable, summaryTable } from './blocks.js';
import { formatMoney, toCents } from './money.js';
import { flattenTemplate, parseTemplate, type FlatItem } from './template.js';
import { ProposalError, type ProposalData } from './types.js';

/** A reference register is searched, not read; long is its nature. A sanity
 *  ceiling, not physics — and reachable from nowhere but this path. */
export const ANNEX_MAX_ROWS = 2000;

const SENTINEL = (i: number): string => `@@documentor-directive-${i}@@`;
const SENTINEL_RE = /^@@documentor-directive-(\d+)@@$/;

export async function assembleProposal(
  args: { data: ProposalData; template: string; annex?: Buffer },
): Promise<{ doc: Doc; dropped: string[] }> {
  const { data } = args;
  const items = flattenTemplate(parseTemplate(args.template), data);
  const errors: string[] = [];
  const dropped: string[] = [];

  // The one cross-check the data cannot make alone: the summary line that
  // claims to cover the budget must equal the budget. A wrong figure in an
  // offer costs more than a failed build.
  const covering = data.summary?.find((s) => s.covers === 'budget');
  if (covering !== undefined) {
    const claimed = toCents(covering.price, `summary "${covering.item}"`);
    const computed = budgetTotalCents(data);
    if (claimed !== computed) {
      errors.push(
        `summary line "${covering.item}" says ${formatMoney(claimed, data.currency)} but the team's hours × rates come to ${formatMoney(computed, data.currency)} — one of the two is wrong, and this build will not choose which`,
      );
    }
  }

  // Expand every directive up front, collecting errors rather than stopping.
  const directives = items.filter((it): it is Extract<FlatItem, { t: 'directive' }> => it.t === 'directive');
  const expanded = new Map<number, Block[]>();
  for (const [i, d] of directives.entries()) {
    try {
      expanded.set(i, await expand(d));
    } catch (e) {
      if (e instanceof ProposalError) errors.push(...e.errors);
      else throw e;
    }
  }
  if (errors.length > 0) throw new ProposalError(errors);

  // One markdown source, sentinels standing where the directives stood.
  let di = 0;
  const mdSource = items
    .map((it) => (it.t === 'md' ? it.text : `\n\n${SENTINEL(di++)}\n\n`))
    .join('');
  const ingested = ingestMarkdown(mdSource, { date: data.date });
  dropped.push(...ingested.dropped);

  // Splice: a sentinel is a paragraph whose sole content is its own marker.
  const blocks: Block[] = [];
  const spliced = new Set<number>();
  for (const b of ingested.doc.blocks) {
    const marker =
      b.t === 'para' && b.text.length === 1 && b.text[0]!.t === 'text'
        ? SENTINEL_RE.exec(b.text[0]!.v)
        : null;
    if (marker === null) {
      blocks.push(b);
      continue;
    }
    const idx = Number(marker[1]);
    blocks.push(...(expanded.get(idx) ?? []));
    spliced.add(idx);
  }
  if (spliced.size !== directives.length) {
    // A directive swallowed into a list item or a table cell never becomes
    // its own paragraph, so its blocks would silently vanish. Loud instead.
    const missing = directives.filter((_, i) => !spliced.has(i)).map((d) => `{{@${d.name}}}`);
    throw new ProposalError(missing.map((m) => `${m} did not stand alone as its own paragraph — put it on its own line with a blank line above and below`));
  }

  return { doc: { meta: ingested.doc.meta, blocks }, dropped };

  async function expand(d: Extract<FlatItem, { t: 'directive' }>): Promise<Block[]> {
    switch (d.name) {
      case 'summary': return [summaryTable(data)];
      case 'budget': return [budgetTable(data)];
      case 'schedule': return [scheduleTable(data)];
      case 'heatmap': return [heatmapOf(data, d.args['style'])];
      case 'annex': {
        if (args.annex === undefined) {
          throw new ProposalError(['{{@annex}} — no annex bytes were supplied; the data file must name one ("annex": "./deliverables.xlsx"), or the template must wrap the block in {{?annex}}…{{/?}}']);
        }
        const result = await ingestXlsx(args.annex, {}, { maxRows: ANNEX_MAX_ROWS });
        const refusals = result.dropped.filter((m) => /refused/.test(m));
        if (refusals.length > 0) {
          // Half an offer without its annex is not an offer.
          throw new ProposalError(refusals.map((m) => `annex: ${m}`));
        }
        dropped.push(...result.dropped.map((m) => `annex: ${m}`));
        return result.doc.blocks;
      }
      default:
        throw new ProposalError([`unknown directive {{@${d.name}}} — this template language knows @summary, @budget, @schedule, @heatmap, @annex and {{section:name}}`]);
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/proposal/ && npm run typecheck`
Expected: PASS. Two likely adjustments, both to the *template or test*, never to the assembler's contract: (a) if the title arrives as `Untitled`, the template's `# {{kind}} — {{project}}` line is not the first markdown content — check what the ingester lifted; (b) if the heatmap lands one block off in the splice test, the `{{?summary}}` block's blank lines merged two paragraphs — adjust the template's blank lines.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Assemble an offer from its facts and its template, inventing nothing"
```

---

### Task 10: The `proposal` command

**Files:**
- Create: `src/cli/proposal.ts`
- Modify: `src/bin/documentor.ts` (command routing + USAGE)
- Test: `test/cli/proposal.test.ts`

**Interfaces:**
- Consumes: `assembleProposal` (Task 9), `readProposalData` (Task 2), `ProposalError` (Task 2), `checkFormats`, `FORMATS`, `type Format` from `src/cli/build.js`, `validateDoc`, `loadTheme`, `resolveEpoch`, `DEFAULT_THEME` from `src/cli/config.js`, and the three renderers via build.ts's own pattern (write a local `renderTo`-shaped switch or import; build.ts's `renderTo` is module-private — write the same exhaustive switch here, with the same `never` default, and a comment naming build.ts as the sibling).
- Produces: `runProposal(argv: string[], io: Io): Promise<number>` and `runProposalInspect(input: string, json: boolean, io: Io): Promise<number>` (the latter implemented in Task 11 — this task exports a stub is NOT allowed; Task 11 adds it whole).

Exit codes follow the documented contract in `src/bin/documentor.ts`: 2 for usage and for a data/template file that does not resolve (the sidecar precedent: `SidecarResolutionError` → 2), 3 for `validateDoc` refusal or an output that would overwrite an input, 1 for anything thrown, 0 for success.

- [ ] **Step 1: Write the failing tests**

Create `test/cli/proposal.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runProposal } from '../../src/cli/proposal.js';
import { docxPart } from '../helpers/docx-parts.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (s: string) => out.push(s), err: (s: string) => err.push(s), out, errs: err };
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'documentor-proposal-'));
  // The fixture data names the template relative to the data file; copy both
  // into the temp dir so the test exercises exactly the path resolution the
  // CLI promises (relative to the data file's own directory).
  const template = readFileSync(join(ROOT, 'templates', 'offer.example.md'), 'utf8');
  await writeFile(join(dir, 'offer.template.md'), template, 'utf8');
  const data = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'offer-example.proposal.json'), 'utf8')) as Record<string, unknown>;
  data['template'] = './offer.template.md';
  await writeFile(join(dir, 'example.proposal.json'), JSON.stringify(data, null, 2), 'utf8');
});

describe('documentor proposal', () => {
  it('assembles and writes Word and Markdown beside the data file', async () => {
    const o = io();
    const code = await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx,md'], o);
    expect(o.errs.join('\n')).toBe('');
    expect(code).toBe(0);
    // The stem drops the '.proposal' marker: example.proposal.json → example.plain.docx.
    expect(existsSync(join(dir, 'example.plain.docx'))).toBe(true);
    expect(existsSync(join(dir, 'example.plain.md'))).toBe(true);
    const xml = await docxPart(await readFile(join(dir, 'example.plain.docx')), 'word/document.xml');
    expect(xml).toContain('COMMERCIAL PROPOSAL');
  });

  it('is byte-identical across two runs', async () => {
    const a = io();
    await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx'], a);
    const first = await readFile(join(dir, 'example.plain.docx'));
    await new Promise((r) => setTimeout(r, 1100)); // cross a DOS-timestamp second
    await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx'], a);
    expect(first.equals(await readFile(join(dir, 'example.plain.docx')))).toBe(true);
  });

  it('exits 2 on a data file whose errors it lists — all of them', async () => {
    const o = io();
    await writeFile(join(dir, 'bad.proposal.json'), JSON.stringify({ template: './offer.template.md', bogus: 1 }), 'utf8');
    const code = await runProposal([join(dir, 'bad.proposal.json')], o);
    expect(code).toBe(2);
    const text = o.errs.join('\n');
    expect(text).toMatch(/bogus/);
    expect(text).toMatch(/kind is required/);
  });

  it('exits 2 on a missing template, naming the path it tried', async () => {
    const o = io();
    const data = JSON.parse(readFileSync(join(dir, 'example.proposal.json'), 'utf8')) as Record<string, unknown>;
    data['template'] = './no-such.template.md';
    await writeFile(join(dir, 'orphan.proposal.json'), JSON.stringify(data), 'utf8');
    const code = await runProposal([join(dir, 'orphan.proposal.json')], o);
    expect(code).toBe(2);
    expect(o.errs.join('\n')).toMatch(/no-such\.template\.md/);
  });

  it('exits 2 on a non-.json input and on an unknown format', async () => {
    const o = io();
    expect(await runProposal([join(dir, 'offer.template.md')], o)).toBe(2);
    expect(await runProposal([join(dir, 'example.proposal.json'), '--to', 'xlsx'], o)).toBe(2);
  });

  it('prints the data file warnings without failing the build', async () => {
    const o = io();
    const data = JSON.parse(readFileSync(join(dir, 'example.proposal.json'), 'utf8')) as { team: { hoursPerWeek: number[] }[] };
    data.team[0]!.hoursPerWeek = [0, 0, 0, 0, 0];
    // Zero hours also moves the budget away from the covering summary line —
    // adjust the summary so only the warning, not the cross-check, fires.
    (data as unknown as Record<string, unknown>)['summary'] = [{ item: 'Engineering works', price: 3600, covers: 'budget' }];
    await writeFile(join(dir, 'warn.proposal.json'), JSON.stringify(data), 'utf8');
    const code = await runProposal([join(dir, 'warn.proposal.json'), '--to', 'md'], o);
    expect(code).toBe(0);
    expect(o.errs.join('\n')).toMatch(/zero hours/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/cli/proposal.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/cli/proposal.ts`:

```ts
// `documentor proposal` — assemble a commercial offer from a data file and a
// template, then render it through the same pipeline `build` uses. The
// boundary this command lives behind: it assembles, it does not write — every
// sentence comes from the data file or the template, and a missing piece is
// an error naming what is missing, never invented text.
//
// No sidecar: the data file *is* the decisions file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { assembleProposal } from '../proposal/assemble.js';
import { readProposalData } from '../proposal/data.js';
import { ProposalError } from '../proposal/types.js';
import { validateDoc, type Doc } from '../ir/validate.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { renderDocx } from '../render/docx.js';
import { loadTheme, type Theme } from '../theme/resolve.js';
import { checkFormats, FORMATS, type Format } from './build.js';
import { DEFAULT_THEME } from './config.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

const USAGE_LINE = `  documentor proposal <data.json> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>]`;

/** The same exhaustive switch build.ts keeps as its own `renderTo` — that one
 *  is module-private, and sharing it would thread a Browser parameter through
 *  an export for no caller but this. The `never` default keeps the two in
 *  step: a format added to FORMATS breaks both files until both render it. */
async function renderTo(format: Format, doc: Doc, theme: Theme, epochSeconds: number, browser?: Browser): Promise<Buffer> {
  switch (format) {
    case 'pdf': return renderPdf(doc, theme, { epochSeconds, ...(browser === undefined ? {} : { browser }) });
    case 'docx': return renderDocx(doc, theme, { epochSeconds });
    case 'md': return Buffer.from(renderMarkdown(doc), 'utf8');
    default: {
      const unhandled: never = format;
      throw new Error(`no renderer for format ${JSON.stringify(unhandled)}`);
    }
  }
}

function parseArgs(argv: string[]): { input?: string; to?: string[]; theme?: string; out?: string } {
  const out: { input?: string; to?: string[]; theme?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--to') out.to = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--theme') out.theme = next();
    else if (a === '--out') out.out = next();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/** Reads the data file and everything it names, all paths relative to the
 *  data file's own directory. Exported for Task 11's inspect path, which must
 *  read exactly what this build would read. */
export async function loadProposal(input: string): Promise<{
  data: ReturnType<typeof readProposalData>['data'];
  warnings: string[];
  template: string;
  annex?: Buffer;
}> {
  const dataText = await readFile(input, 'utf8').catch((e: Error) => {
    throw new ProposalError([`cannot read ${input}: ${e.message}`]);
  });
  const { data, warnings } = readProposalData(dataText);
  const base = dirname(input);
  const templatePath = resolve(base, data.template);
  const template = await readFile(templatePath, 'utf8').catch((e: Error) => {
    throw new ProposalError([`cannot read the template ${templatePath}: ${e.message}`]);
  });
  let annex: Buffer | undefined;
  if (data.annex !== undefined) {
    const annexPath = resolve(base, data.annex);
    annex = await readFile(annexPath).catch((e: Error) => {
      throw new ProposalError([`cannot read the annex ${annexPath}: ${e.message}`]);
    });
  }
  return { data, warnings, template, ...(annex === undefined ? {} : { annex }) };
}

/** The output stem: `ber01.proposal.json` → `ber01`, `offer.json` → `offer`.
 *  The `.proposal` marker is the data file's own naming convention, not the
 *  document's name, so it does not survive into the output. */
export function proposalStem(input: string): string {
  return basename(input, extname(input)).replace(/\.proposal$/, '');
}

export async function runProposal(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err(`documentor: proposal needs a data file\n\n${USAGE_LINE}`);
    return 2;
  }
  const input = resolve(args.input);
  if (extname(input).toLowerCase() !== '.json') {
    io.err(`documentor: proposal reads a .json data file, got ${extname(input) || 'a file with no extension'}`);
    return 2;
  }
  const formatCheck = checkFormats(args.to ?? ['pdf']);
  if ('error' in formatCheck) {
    io.err(`documentor: ${formatCheck.error}`);
    return 2;
  }
  const formats = formatCheck;

  let doc: Doc;
  let dropped: string[];
  try {
    const loaded = await loadProposal(input);
    for (const w of loaded.warnings) io.err(`documentor: warning — ${w}`);
    ({ doc, dropped } = await assembleProposal({
      data: loaded.data, template: loaded.template,
      ...(loaded.annex === undefined ? {} : { annex: loaded.annex }),
    }));
  } catch (e) {
    if (e instanceof ProposalError) {
      io.err(`documentor: the proposal cannot be assembled — ${e.errors.length} problem(s):`);
      for (const msg of e.errors) io.err(`  - ${msg}`);
      return 2;
    }
    throw e;
  }

  try {
    validateDoc(doc);
  } catch (e) {
    io.err(`documentor: refusing to render — ${(e as Error).message}`);
    return 3; // refused — see the exit code contract in src/bin/documentor.ts
  }

  if (dropped.length) {
    io.err(`documentor: ${dropped.length} thing(s) the document format cannot hold were left out:`);
    for (const d of dropped) io.err(`  - ${d}`);
  }

  const theme = await loadTheme(args.theme ?? DEFAULT_THEME);
  const epochSeconds = await resolveEpoch(process.env, input);
  const dir = args.out === undefined ? dirname(input) : resolve(args.out);
  await mkdir(dir, { recursive: true });
  const stem = proposalStem(input);

  const needsBrowser = formats.includes('pdf');
  const browser = needsBrowser ? await chromium.launch() : undefined;
  let refused = false;
  try {
    for (const format of formats) {
      const target = join(dir, `${stem}.${theme.id}.${format}`);
      if (resolve(target) === input) {
        io.err(`documentor: refusing to overwrite the input file ${input}`);
        refused = true;
        continue;
      }
      const bytes = await renderTo(format, doc, theme, epochSeconds, browser);
      await writeFile(target, bytes);
      io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
    }
  } finally {
    if (browser !== undefined) await browser.close();
  }
  return refused ? 3 : 0;
}
```

- [ ] **Step 4: Wire the command into the bin**

In `src/bin/documentor.ts`: import `runProposal` from `../cli/proposal.js`, add before the `--help` branch:

```ts
  else if (command === 'proposal') code = await runProposal(rest, io);
```

and add to USAGE, after the `build` line:

```
  documentor proposal <data.json> [--to pdf,md,docx] [--theme plain] [--out <dir>]
```

with one sentence below the existing paragraph:

```
proposal assembles a commercial offer from a data file and the template it
names — every sentence comes from one of the two; a missing piece is an
error, never invented text.
```

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add documentor proposal: data plus template in, offer out"
```

---

### Task 11: `inspect` learns the data file

**Files:**
- Modify: `src/cli/proposal.ts` (add `runProposalInspect`), `src/cli/inspect.ts` (route `.json` there)
- Test: additions to `test/cli/proposal.test.ts`

**Interfaces:**
- Consumes: `loadProposal`, `assembleProposal`, `budgetTotalCents`, `formatMoney`, `toCents`.
- Produces: `runProposalInspect(input: string, json: boolean, io: Io): Promise<number>` — 0 when the proposal would assemble, 2 when it would not (the same class as a bad data file at build time), with every error listed either way.

- [ ] **Step 1: Write the failing tests**

Add to `test/cli/proposal.test.ts` (the `runInspect` import comes from `../../src/cli/inspect.js`):

```ts
describe('documentor inspect <data.json>', () => {
  it('reports what would be assembled, without writing anything', async () => {
    const o = io();
    const code = await runInspect([join(dir, 'example.proposal.json'), '--json'], o);
    expect(code).toBe(0);
    const parsed = JSON.parse(o.out.join('\n')) as {
      status: string; title: string; weeks: number; roles: string[];
      budgetTotal: string; sections: string[]; annex: boolean; warnings: string[];
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.title).toBe('COMMERCIAL PROPOSAL — Example Project');
    expect(parsed.weeks).toBe(5);
    expect(parsed.roles).toEqual(['BIM Coordinator', 'Mechanical Engineer']);
    expect(parsed.budgetTotal).toContain('4');
    expect(parsed.annex).toBe(false);
    expect(existsSync(join(dir, 'example.plain.pdf'))).toBe(false);
  });

  it('lists every validation error and exits 2', async () => {
    const o = io();
    await writeFile(join(dir, 'broken.proposal.json'), JSON.stringify({ template: './offer.template.md', bogus: 1 }), 'utf8');
    const code = await runInspect([join(dir, 'broken.proposal.json'), '--json'], o);
    expect(code).toBe(2);
    const parsed = JSON.parse(o.out.join('\n')) as { status: string; errors: string[] };
    expect(parsed.status).toBe('failed');
    expect(parsed.errors.join('\n')).toMatch(/bogus/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/cli/proposal.test.ts -t inspect`
Expected: FAIL — `inspect` rejects `.json` as unreadable.

- [ ] **Step 3: Implement**

In `src/cli/proposal.ts`, add:

```ts
/**
 * `documentor inspect <data.json>` — what `proposal` would assemble, and
 * every problem in its way, rendering nothing. Its own small report rather
 * than build-inspect's DocInspection: that structure answers "what does this
 * document contain", this one answers "will this data file assemble" — the
 * counts a Doc inspection carries would all be derivable but say nothing a
 * decision needs that the fields below do not.
 */
export async function runProposalInspect(input: string, json: boolean, io: Io): Promise<number> {
  try {
    const loaded = await loadProposal(input);
    const { doc } = await assembleProposal({
      data: loaded.data, template: loaded.template,
      ...(loaded.annex === undefined ? {} : { annex: loaded.annex }),
    });
    const report = {
      file: input,
      status: 'ok' as const,
      title: doc.meta.title,
      weeks: loaded.data.team[0]?.hoursPerWeek.length ?? 0,
      roles: loaded.data.team.map((r) => r.role),
      budgetTotal: formatMoney(budgetTotalCents(loaded.data), loaded.data.currency),
      sections: Object.keys(loaded.data.sections),
      annex: loaded.data.annex !== undefined,
      warnings: loaded.warnings,
    };
    if (json) {
      io.log(JSON.stringify(report, null, 2));
    } else {
      io.log(`${basename(input)}: ok — "${report.title}"`);
      io.log(`  team: ${report.roles.join(', ')} over ${report.weeks} week(s)`);
      io.log(`  budget total: ${report.budgetTotal}`);
      io.log(`  sections: ${report.sections.join(', ') || '(none)'}`);
      io.log(`  annex: ${report.annex ? 'yes' : 'no'}`);
      for (const w of report.warnings) io.log(`  warning: ${w}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof ProposalError) {
      if (json) {
        io.log(JSON.stringify({ file: input, status: 'failed', errors: e.errors }, null, 2));
      } else {
        io.log(`${basename(input)}: failed — ${e.errors.length} problem(s):`);
        for (const msg of e.errors) io.log(`  - ${msg}`);
      }
      return 2;
    }
    throw e;
  }
}
```

(Imports to add: `budgetTotalCents` from `../proposal/blocks.js`, `formatMoney` from `../proposal/money.js`.)

In `src/cli/inspect.ts`, find where a single file's extension is checked against `READABLE_EXTS` (the "cannot read" branch) and add **before** it:

```ts
  // A .json input is a proposal data file — its own small report, because it
  // answers a different question ("will this assemble?") than a document
  // inspection does ("what does this contain?"). See runProposalInspect.
  if (ext === '.json') return runProposalInspect(input, jsonFlag, io);
```

adapting the two local names (`ext`, and whatever the parsed `--json` flag is called there) to the file's own; import `runProposalInspect` from `./proposal.js`. Directory walks are untouched — a folder of data files is not a batch this phase defines.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, including inspect's own existing suite (its structure-parity test must not pick up the proposal report — it walks `DocInspection`, which this path never produces).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Let inspect answer whether a proposal would assemble"
```

---

### Task 12: The procedure — skill and README

**Files:**
- Modify: `plugin/skills/documentor/SKILL.md`, `README.md`

**Interfaces:** none — prose only, but it must match the shipped behaviour exactly (field names, directive names, exit codes as implemented in Tasks 2–11).

- [ ] **Step 1: Extend the skill**

In `plugin/skills/documentor/SKILL.md`:

1. In the frontmatter `description`, extend the trigger: after "not for writing new documents from scratch", add "— except a commercial proposal, which `documentor proposal` assembles from a data file and a template (still writing no text of its own)".
2. Replace the "the document doesn't exist yet — write it first, with no theming" bullet under "Do **not** use it when" with: "the document doesn't exist yet **and is not a proposal** — write it first, with no theming; for a proposal, use the proposal flow below".
3. Add a section after "The flow":

```markdown
## The proposal flow

When the user wants a commercial offer that does not exist yet:

1. Ask where the offer template lives (a `.md` file, usually outside the
   repo). No template, no flow — do not improvise one.
2. Interview for the data file's fields — only what changes the output:
   project, kind (COMMERCIAL OFFER / COMMERCIAL PROPOSAL), date, author,
   the team (role, rate, hours per week — one array per role, all the same
   length), the priced summary lines, which sections the template expects
   (`documentor inspect <data.json>` lists errors naming anything missing),
   and the annex spreadsheet if the template carries `{{@annex}}`.
3. Write `<name>.proposal.json` beside the future document and **show it**.
   The `sections.*` values are the user's words verbatim — never rewrite,
   tighten, or expand them.
4. Run `documentor inspect <name>.proposal.json` and relay every error and
   warning as reported.
5. Build: `documentor proposal <name>.proposal.json --to pdf,docx --theme tebin`.

The command assembles, it does not write: every sentence comes from the data
file or the template. A missing piece is a build error naming what is
missing — relay it and ask, never fill the gap yourself.
```

4. Update the "Writes PDF, Word (`.docx`), and Markdown" bullet's surroundings if any sentence claims documentor never produces new documents — the boundary sentence is now "documentor assembles proposals but still writes no text of its own".

- [ ] **Step 2: Extend the README**

In `README.md`, add a section after the existing build/inspect documentation (match the file's heading style and voice):

```markdown
## Proposals

`documentor proposal <data.json>` assembles a commercial offer from two
inputs: a data file holding the facts of this one offer (project, team,
rates, hours, the sections written fresh each time) and a markdown template
holding the skeleton and the boilerplate. Every sentence in the output comes
from one of the two, verbatim — the command assembles, it does not write.

The budget is computed, never typed: hours × rate per role, summed, printed
as `€ 4 500,00`. A summary line marked `"covers": "budget"` must equal that
total or the build fails quoting both figures. The involvement heatmap is
drawn from the same team array (`{{@heatmap style=scale|fill|numbers|marks}}`),
and a deliverables register named by `"annex"` joins as an annex through the
spreadsheet reader — with its row cap raised to 2000 for this one path,
because a reference register is searched, not read.

`templates/offer.example.md` is a generic example; a real template carries a
company's own commercial terms and belongs outside a public repository, the
way this repository keeps its own brand book out of git.

`documentor inspect <data.json>` reports what would be assembled — the
title, the team, the computed budget total, every validation error — and
writes nothing.
```

- [ ] **Step 3: Verify the prose against the code**

Run: `npx vitest run test/cli/proposal.test.ts` — then cross-check each claim written above against the tests (field names, directive names, the 2000 cap, the NBSP money format). A README that names a flag the CLI does not have fails the next reader, and there is no test for prose.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/documentor/SKILL.md README.md
git commit -m "Write the proposal procedure down where the users of it look"
```

---

### Task 13: The comparison sheet — a human picks the heatmap default

**Files:**
- Scratch only (no repo files; the script is throwaway, per the global constraint it lives outside the repo tree).

- [ ] **Step 1: Build the sheet**

Write a scratch script (in the session scratchpad directory, not the repo) that renders ONE document to PDF with the `tebin` theme, containing four heatmap blocks — one per style, each under an `h2` naming the style — using a BER01-shaped team: six disciplines (Electrical, Fire Alarm & Detection, BMS, Security, ICT, BIM Coordinator), 16 weeks, hours varying from 0 to 24 so every tint step actually appears. Use `renderPdf` directly with a fixed epoch and its own `chromium.launch()`.

- [ ] **Step 2: STOP — the owner chooses**

Show the PDF to the owner. Ask two questions and wait for both answers:
1. Which style should be the default (`scale` is the plan's guess)?
2. Are the four tint steps distinguishable enough on paper, or should `SCALE_STEPS` move?

Do not proceed to Task 14 without answers.

- [ ] **Step 3: Apply the answers**

If the default changes: in `src/proposal/blocks.ts`, change `const chosen = style ?? 'scale'` to the chosen style, and update the one test in `test/proposal/blocks.test.ts` that pins the default. If `SCALE_STEPS` moves: change it in `src/render/tint.ts` and correct the pinned blend expectation in `test/render/tint.test.ts` from the printed actual. Run `npx vitest run` — everything else derives from those constants.

- [ ] **Step 4: Commit (only if something changed)**

```bash
git add -A
git commit -m "Set the heatmap default the owner chose from the comparison sheet"
```

---

### Task 14: The real TEBIN template, outside git

**Files:**
- Create: `.input/tebin-offer.template.md`, `.input/example.proposal.json` (both gitignored — verify: `git check-ignore .input/tebin-offer.template.md` must name the file; if `.input/` is not ignored, STOP and ask the owner before writing anything there).

- [ ] **Step 1: Assemble the template from the three PDFs**

Sources (read them with the pdfjs extraction script pattern used during the design, or from the design conversation's extracts):
- `.input/0615_TEBIN Goehler Daimler Truck Offer.pdf` — the small-offer shape.
- `.input/0182.1-10-49С_Tebin_BER01 LP5 Offer.pdf` — GENERAL, PROFESSIONAL LIABILITY, INVOICING & PAYMENT (the newest wording), the heatmap shape, Annex A.
- `.input/0637-10-34С_Tebin_QTS–ESP01 Offer (1).pdf` — REPORTING and cross-checks of the shared boilerplate.

Structure the template exactly like `templates/offer.example.md`, with these substitutions:
- The boilerplate sections carry the BER01/QTS wording **verbatim** — PROFESSIONAL LIABILITY (good engineering practice; corrective services on written request within a one-year warranty; reimbursement of documented direct damages only; total aggregate liability capped at 10% of the Total Contract Price, covered by professional liability insurance; no indirect/consequential damages), INVOICING & PAYMENT (without VAT; monthly against approved scope; EUR to the Contractor's account; 20 calendar days; billing details before the first invoice), REPORTING (progress reports; planning period one/two weeks; monthly reports and forecast).
- ASSUMPTIONS and EXCLUSIONS are `{{section:…}}` with `{{^…}}` fallbacks carrying the *recurring* items from BER01/QTS (frozen inputs, consolidated comments, vendor shop drawings excluded, as-built documentation excluded, construction supervision excluded) — the project-specific items stay in the data file.
- The signature line: `Contractor: {{author.name}} {{author.email}}`.

Copy sentences from the PDFs by extraction, not from memory — a paraphrased liability clause is a changed liability clause.

- [ ] **Step 2: Write a real-shaped example data file**

`.input/example.proposal.json`, Goehler-shaped (the smallest real offer): the Daimler Truck project's actual roles, rates and weeks as extracted during the design (BIM Coordinator €45 at 4 h/week × 5; Mechanical Engineer €45 at 16 h/week × 5; summary €4 500 covering the budget), pointing at `./tebin-offer.template.md`.

- [ ] **Step 3: Build it and STOP — the owner reviews**

Run: `npx tsx src/bin/documentor.ts proposal .input/example.proposal.json --to pdf,docx --theme tebin`

Show the PDF beside the original `0615` PDF. Ask the owner: does the assembled offer carry everything the real one carries, and is the boilerplate wording acceptable as the standing template? Record the answer; apply requested wording changes to `.input/tebin-offer.template.md` (the owner's file, edited on their word only).

- [ ] **Step 4: Clean up and close**

Delete the generated sample outputs from `.input/` (they are scratch, and `.input/` must hold only sources and the template). Confirm `git status` shows nothing from `.input/`. Nothing to commit in this task unless Task 13's constants changed — the deliverable lives outside git by design. Note the completion in the plan checkboxes and tell the owner where the template lives and how to edit it.
