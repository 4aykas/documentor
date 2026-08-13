# Proposals: a template and a procedure — design

*2026-08-13. Approved section by section in conversation; this document is the
record.*

## What this is

TEBIN issues commercial offers as Word-made PDFs. Three real ones were read
for this design — 0615 (Goehler/Daimler Truck, 3 pages), 0182.1 (BER01 LP5,
13 pages with a deliverables annex), 0637 (QTS ESP01, 11 pages) — and under
very different sizes they share one skeleton:

cover (author contact, TEBIN.PRO block, `COMMERCIAL OFFER` / `COMMERCIAL
PROPOSAL`, `ENGINEERING SERVICE`, `PROJECT – …`, Proposal No. / Doc. No. /
Date / Rev.) → GENERAL → MANAGEMENT SUMMARY (priced lines) → SCOPE OF SERVICE
(a subsection per discipline: a paragraph, then bullets) → SCHEDULE /
involvement (a weeks table, or a heatmap) → RATES AND PRICE (hours × rate ×
budget, with a total) → ASSUMPTIONS → EXCLUSIONS → PROFESSIONAL LIABILITY →
INVOICING & PAYMENT → REPORTING → Contractor signature line → optionally
ANNEX A, a deliverables register.

The differences are systematic too: the small offer skips GENERAL and
LIABILITY and draws its schedule as a plain table; the two large ones agree
almost verbatim on LIABILITY, INVOICING and much of EXCLUSIONS. So part of an
offer is genuine boilerplate that repeats, and part is written fresh every
time. This feature makes that split explicit and mechanical.

`documentor proposal` takes a data file (the facts of one offer) and a
template (the skeleton and the boilerplate), assembles an IR, and renders it
through the existing renderers. Nothing downstream of the assembler is new.

## The promise boundary

documentor's standing promise is "appearance only, never text — it does not
write new documents." `build` keeps that promise unchanged. `proposal` is a
separate entry point with its own, honestly stated boundary: **it assembles,
it does not write.** Every sentence in the output comes either from the data
file or from the template, verbatim. There is no model, no paraphrase, no
filled-in gap. A missing piece is a build error, never invented text.

## Ownership: template in the repo vs. the real one

The repository carries the mechanism and a **generic example template** —
`templates/offer.example.md`, with no TEBIN figure or wording in it, doubling
as the test fixture. The **real TEBIN template**, which embeds actual
commercial terms (the 10% liability cap, 20-day payment, the exclusions
list), lives outside git — in `.input/`, which is gitignored, the same
arrangement as the brand book PDF. The repo stays publishable; the company's
terms stay the company's.

## Data model: `proposal.json`

One file of facts per offer, beside the future document. Only what changes
from offer to offer; everything stable is the template's.

```jsonc
{
  "template": "./tebin-offer.template.md",
  "kind": "COMMERCIAL OFFER",            // or "COMMERCIAL PROPOSAL" — both exist in the corpus
  "project": "BER01. Data Center",
  "stage": "LP5 (Execution Design)",     // optional — the small offer has none
  "number": "0615-10-49C",               // Proposal No.; optional
  "docNumber": "00-GN-1000",             // optional
  "date": "13.04.2026",
  "rev": "0",
  "author": { "name": "…", "phone": "…", "email": "…" },

  "summary": [                            // MANAGEMENT SUMMARY, priced lines
    { "item": "LP5 design works", "price": 88000, "covers": "budget" },
    { "item": "Single site visit, if required", "price": 490 }
  ],

  "team": [                               // one structure feeds budget, schedule and heatmap
    { "role": "BIM Coordinator", "rate": 45, "hoursPerWeek": [4, 4, 4, 4, 4] },
    { "role": "Mechanical Engineer", "rate": 45, "hoursPerWeek": [16, 16, 16, 16, 16] }
  ],
  "currency": "EUR",

  "sections": {                           // written fresh each time, as markdown strings
    "general": "…",
    "scope": "…",
    "assumptions": "…",
    "exclusions": "…"
  },

  "annex": "./deliverables.xlsx"          // optional
}
```

Decisions:

- **`team` is the single source of numbers.** The budget table, the schedule
  and the heatmap are three projections of the same array, so they cannot
  disagree with each other by construction.
- **`summary` is entered by hand** — in the corpus it is not always the budget
  total (BER01 prices a site visit as its own line outside the hours table).
  The line that is *meant* to equal the budget says so explicitly with
  `"covers": "budget"`, and the assembler verifies it (see arithmetic below).
- Validation follows the house rules: an unknown key refuses the whole file
  by name; `hoursPerWeek` arrays of different lengths refuse (their common
  length *is* the week count); negative or non-integer hours refuse; a role
  with no rate refuses; a role with zero hours across all weeks warns (it may
  be deliberate).

## Template language

The template is a plain markdown file. It executes nothing; it carries
exactly three constructions, all substitutions:

- **Fields**: `{{project}}`, `{{date}}`, `{{author.name}}` — values from the
  data file. A referenced field with no value is a build error naming the
  field, never a blank in the offer.
- **Presence blocks**: `{{?stage}}…{{/?}}` disappears entirely when the field
  is absent; `{{^sections.assumptions}}…{{/^}}` appears only when the field
  is absent. Together they cover the Goehler/BER01 structural differences
  with one template, and let the template own its own defaults (boilerplate
  assumptions that a filled `sections.assumptions` replaces).
- **Directives**, one per line, each expanding to a computed block:

  | Directive | Expands to |
  |---|---|
  | `{{@summary}}` | MANAGEMENT SUMMARY table with formatted prices |
  | `{{@budget}}` | role × weeks × hours × rate × total, with a grand total |
  | `{{@schedule}}` | involvement in words ("2 days / week"), the small-offer style |
  | `{{@heatmap style=…}}` | the involvement matrix (styles below) |
  | `{{@annex}}` | the deliverables register from `annex` |
  | `{{section:general}}` | `sections.general` from the data, ingested as markdown |

A directive with no material behind it (`{{@annex}}` with no `annex` in the
data) is a build error; a template where the annex is optional wraps it in a
presence block. An unknown directive refuses by name.

Everything else in the template is boilerplate and goes into the document
verbatim — LIABILITY, INVOICING, REPORTING, headings, the signature line. The
boundary between "asked every time" and "never asked" is thus drawn in the
template, not in code, and the template's owner moves it without us.

Deliberately not Handlebars/Jinja: no loops, no expression conditionals, no
helpers. Anything needing logic lives in the assembler under tests, not in a
template where nothing checks it.

## Assembler and arithmetic

Pipeline: `documentor proposal <data.json>` → read and validate data and
template (collecting *all* errors and reporting them together, not one per
run) → substitute fields, expand directives → an IR — from there the
existing renderers draw it: `--to pdf,docx,md`. `--to md` is the readable
intermediate artifact: assemble to markdown to eyeball what was built.

Money is integer cents internally — no floats anywhere; `45.50` in JSON
becomes `4550` at the parse boundary. Output format matches the corpus:
`€ 4 500,00` — space as thousands separator, comma before decimals — pinned
by a formatter test per digit group, because this is exactly where "almost
right" looks right.

Cross-checks, each failing with both figures in the message:

- the `summary` line marked `"covers": "budget"` must equal the budget
  grand total;
- all `hoursPerWeek` lengths equal (also the week count for `@schedule` and
  `@heatmap`).

What the assembler does not do: rewrap sentences, fix language, shorten
anything. `sections.*` strings pass through the same markdown ingest as any
file, with the same `dropped`/`warnings` if they carry something the IR
cannot hold.

## Heatmap: a new IR block, four styles

The IR gains a `heatmap` block: row labels (discipline/role), the week count,
and a numeric value per cell (hours). Numbers, not colours — colour belongs
to the theme. Both renderers can fill a cell (CSS background; `w:shd` in
Word), so the block draws the same in PDF and DOCX, and the agreement test
compares cell values against the IR the way it already compares tables.

The style is chosen in the template: `{{@heatmap style=…}}`. All four share
one code path — they differ only in how a value becomes a fill or a mark:

1. **`fill`** — the BER01 look: a cell is filled (theme brand colour) or
   empty. Presence only, no intensity.
2. **`scale`** — *the default*: 4–5 fixed steps from pale to full, computed
   deterministically as `brandOnLight`→white blends, scaled to the matrix
   maximum, with a legend under the matrix.
3. **`numbers`** — the hours in the cell over a light tint on the same
   scale. The heatmap doubles as the data.
4. **`marks`** — typographic: `▪` / `▪▪` / `▪▪▪` per involvement step. No
   colour dependency; the one style guaranteed to survive greyscale printing
   and bad scans.

One brand-book line is already the theme's law and applies here:
`colors.brandOnLight` paints fills and large display type only, never small
text. For `numbers` that means the digits are `ink` over the tint — never
small red on white.

Acceptance includes a human step: a comparison sheet of all four styles on a
BER01-shaped example, rendered to PDF, for the owner to pick by eye.

## Annex

`{{@annex}}` takes the file named by `annex` and runs it through the existing
xlsx ingest — same code, same rules on merges, sheet preambles, empty
columns. Nothing is duplicated. The directive emits only the tables (one per
sheet); the "ANNEX A" heading and the page break before it are template
boilerplate (a `{{@pagebreak}}` directive was added for it — the ingest
markdown had no page-break syntax of its own).

The 200-row cap is a deliberate exception here. It stands elsewhere as "what
a person reads on paper", and for a document body it is right. An annex is a
reference register: it is searched, not read, and long is its nature (the
BER01 register is 5 columns — №, document number, title EN, title DE, scale —
but runs to hundreds of rows). The annex path calls the ingest with a raised
cap of 2000 rows — a sanity ceiling, not physics — and that parameter is
reachable **only** from `@annex`, not from `build` or the sidecar. The
general promise about spreadsheets weakens nowhere.

Width needs nothing new: content-proportional columns, landscape, font shrink
to the 7pt floor, then refusal — the existing machinery, for which the BER01
register with its long German titles is a natural test.

An ingest refusal (a multi-row merge, an unreadable file) fails the whole
build, relaying the ingest's message: half an offer without its annex is not
an offer.

## CLI surface

```
documentor proposal <data.json> [--to pdf,docx,md] [--theme <id>] [--out <dir>]
```

Default `--to pdf`. Output lands beside the data file as
`<data-stem>.<theme>.<ext>` under the existing naming rules. No sidecar:
`proposal.json` *is* the decisions file.

`documentor inspect proposal.json` learns the format: it reports what would
be assembled — sections present, week count, budget total, annex or not —
plus every validation error, rendering nothing.

## Testing

- **Unit**: template parser (three constructions; unknown directive refuses
  by name), the money formatter per digit group, the summary↔budget check
  (fails with both figures), unequal `hoursPerWeek`.
- **Render**: the heatmap block read back from PDF and DOCX — values against
  the IR, fills from the theme, all four styles; byte-identical double build
  of a full offer.
- **Agreement**: the heatmap joins the renderer-agreement comparison.
- **Fixture**: the generic example offer in the repo builds end to end (with
  an annex fixture), and a human approves the page once, as with the kitchen
  sink.
- **Guardrails unchanged**: no wall clock, no network.

## Procedure

The documentor skill (`plugin/skills/documentor/SKILL.md`) gains a second
flow: "the offer does not exist yet" stops meaning "write it first" and
becomes: take the template, interview for the `proposal.json` fields — only
questions whose answers change the output, the same discipline as the
existing flow — write the file, show it, build. The skill never rewrites
`sections.*`; it records what the user dictated.

The real TEBIN template is assembled once from the three PDFs — boilerplate
verbatim, LIABILITY/INVOICING/REPORTING taken from BER01/QTS as the newer
wording — and placed in `.input/`. Editing it thereafter is the owner's work,
not the repo's.

After implementation, a wiki note is warranted: the boundary "documentor now
assembles but still does not write", and the template-outside-git
arrangement.

## Out of scope

- Any text generation or rephrasing — permanently, not just now.
- XLSX output for the offer itself.
- Multi-currency offers, VAT arithmetic, discounts — none appear in the
  corpus; the data model refuses what it does not know, so adding them later
  is a visible extension, not a silent reinterpretation.
- Reading an existing offer PDF back into `proposal.json` — documentor still
  does not read PDF.
