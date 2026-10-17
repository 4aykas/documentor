# Diagram system — design

**Status:** draft 2026-10-17, for review.

## Why this exists, and what would make it a mistake

documentor draws every ```` ```mermaid ```` fence in the theme's own colours
(`src/render/diagrams.ts`, 517 lines). It works, and two limits now show:

1. **Some figures Mermaid cannot draw honestly.** The Ukraine NCE budget report
   (2026-10-16) needed approved-vs-revised variance by chapter. A Mermaid
   `xychart` starts its bars at the bottom of the axis, not at zero, so a
   −5.3 % bar printed as a short positive one; the chart was dropped from the
   report. A budget bridge (approved → changes → revised) has no Mermaid type
   at all.
2. **The diagram code has no canon.** What a type needs is spread over four
   switches (`kindConfig`, `diagramCss` extras, the repaint inside
   `renderOne`, the size caps in `place`). Decisions live in README prose and
   in the personal wiki. A new type has no checklist, and nothing says which
   claims about diagrams are enforced and which are hopes.

The reference is cathrynlavery/diagram-design (MIT, v2.6), an agent skill
that hand-draws 45 diagram types as SVG. Its code is not usable here — it is
instructions to an agent, not a renderer — but four of its ideas are, and
they are what this design takes:

- **every type is a complete record** (reference, gallery example, budget,
  verifier) and a test counts the records;
- **geometry is checked by a machine, with tests in both directions** (their
  ADR 0005: "a rule that only lives in prose is a rule that ships broken
  examples");
- **figures that carry numbers declare them,** and the check re-derives the
  drawing from the declaration (their waterfall and axonometric verifiers);
- **decisions are ADRs in the repository,** amended in the same change that
  moves them.

**What would make it a mistake:**

- a chart that looks right while its numbers do not reconcile — worse than no
  chart, because nothing on the page says so. The chart engine refuses such a
  fence rather than draws it;
- the restructuring changing a drawing nobody asked to change. Phase 0 is
  behaviour-identical, proved by byte-identical gallery SVGs before and after;
- warnings nobody reads. The gallery must build with zero findings in every
  proofed theme, so a finding on a real document means something;
- a canon that is paperwork. Every canonical claim below is enforced by a
  test, or it is not stated as canonical.

## Scope

**In:**

- A diagram **type registry** replacing the per-kind switches, with one
  record per type, and parity tests over it.
- `docs/adr/`, seeded with the decisions already taken.
- **Geometry checks** on every drawn SVG, a **complexity budget** and a
  **focus** marker, all as warnings.
- **Accessible figures:** a title and description per diagram, carried into
  the SVG, the Word alt text, and — if it survives post-processing — a tagged
  PDF.
- A **chart engine** for ```` ```chart ```` fences: `bar`, `dumbbell`,
  `waterfall`.
- An **axonometric engine** for ```` ```axonometric ```` fences: `exploded`
  (one object, parts lifted apart) and `plan` (a floor or site seen from
  above at an angle).
- Authoring references for both new fences, and the skill pointing at them.

**Out:**

- diagram-design's other types. Mermaid already draws the ones documents need;
  a type is added here only for a figure a real document could not get.
- Motion, dark/light "variants" (themes already decide the sheet), icon sets,
  the hand-drawn filter, brand onboarding, client profiles.
- Plugin manifests for hosts other than Claude Code: documentor is used, not
  distributed to agent marketplaces; `plugin/` stays the one adapter.
- Redrawing Mermaid by hand ("import, redraw, never render"). documentor is a
  build; it renders.
- Reading Revit. When a Revit model exists, its own view is exported and
  placed as an image; the axonometric fence is the tool when there is no
  model. A Revit-export reader can be a later spec.

## Architecture

`src/render/diagrams.ts` becomes a directory. The public surface
(`drawDiagrams`, `hasDiagrams`, `isDiagramSource`, `DIAGRAM_LANGS`) keeps its
names and moves to `index.ts`, so callers change one import path.

```
src/render/diagrams/
  index.ts          drawDiagrams: fences → engine by fence language → checks → place
  registry.ts       DiagramType records; the only list of what documentor draws
  tokens.ts         diagramTokens, diagramVars, distinct, mix (unchanged code)
  page.ts           the offline Chromium page, faces loaded, origin routing
  place.ts          scale to the column, size caps from the registry
  checks.ts         geometry, budget and focus findings over a drawn SVG
  mermaid/          engine: headerLine, kindOf, drawable, leftToRight, renderOne
  chart/            engine: parse.ts, layout.ts, svg.ts
  axonometric/      engine: parse.ts, project.ts, depth.ts, layout.ts, svg.ts
```

Every engine has the same shape: **parse** (pure, in Node) → **measure**
(label widths, in the page, with the theme's faces) → **layout** (pure) →
**emit SVG** (pure). Mermaid's measure+layout+emit is Mermaid itself. Pure
stages are unit-tested without a browser; the page is used only to measure
text and to run the checks.

### The registry

```ts
type Engine = 'mermaid' | 'chart' | 'axonometric';

interface DiagramType {
  id: string;              // 'flowchart', 'waterfall', 'plan'
  engine: Engine;
  heads: string[];         // header words that select it: ['flowchart', 'graph']
  label: string;           // the name README and the gallery use
  budget: Budget;          // per-type limits, see Checks
  focusMax: number;        // 2 for Mermaid types, 1 for chart and axonometric
  mermaid?: {              // what the four switches held, per type
    config?: (t: DiagramTokens, vars: Vars) => object;
    css?: (t: DiagramTokens) => string;
    repaint?: string;      // name of an in-page repaint step (sankey, journey, gantt)
    widthCap?: number;     // pie 0.6, quadrantChart 0.72
    turnsDown?: boolean;   // flowchart, timeline: may be redrawn top-down
  };
}
```

A fence whose header word no record claims is still handed to Mermaid (an
unknown type is Mermaid's to accept or refuse, as today) and drawn with the
shared configuration; the build notes that the type has no record.

### IR

```ts
| { t: 'diagram'; lang: 'mermaid' | 'chart' | 'axonometric'; kind: string;
    source: string; svg: string; png: string; wPt: number; hPt: number;
    title?: string; desc?: string }
```

`kind` is the registry id. `validate.ts` checks `lang` and that `kind` is a
registered id (or `''` for an unrecorded Mermaid type). Markdown writes the
fence back verbatim, so every new fence round-trips like a Mermaid one.

## Canon

What is canonical, and the test that holds it:

| Claim | Enforced by |
|---|---|
| Every registry type has exactly one gallery section, headed with its `label` | `diagram-gallery.test.ts`: sections ⇄ registry, both directions |
| Every registry type has a README row in the Diagrams table | `docs-parity.test.ts`: table rows ⇄ registry labels |
| Every number README states about diagrams (type count) is the registry's | `docs-parity.test.ts` derives it from `REGISTRY.length` |
| Every chart and axonometric keyword the authoring reference shows is one the parser accepts, and every parser keyword is documented | `skill-docs-parity.test.ts`, against each parser's keyword table |
| Every check has a fixture that must raise it and the gallery raises none | `diagram-checks.test.ts` |
| ADR numbers are unique, each is listed in `docs/adr/README.md`, each has a status | `adr.test.ts` |

`CODING_STANDARDS.md` gains the two judgement calls no test can make:

- **A change that moves a recorded decision amends or supersedes its ADR in
  the same change.**
- **A new diagram type earns its record:** it is a figure a real document
  needed and no existing type draws. Name the document in the ADR.

`CLAUDE.md` gains one pointer: decisions are in `docs/adr/`, read the one a
change touches.

### ADRs

`docs/adr/README.md` holds the index, the template (Status, Context,
Decision, Consequences, Amendments) and the rule that an accepted ADR is
amended or superseded, never rewritten. Seeded with what is already decided,
then one per phase below:

1. ADRs live in the repository; specs and plans stay in `docs/superpowers/`;
   the wiki records lessons, not this project's decisions.
2. Diagrams are drawn offline in the Chromium the PDF already needs, from
   installed packages under `https://documentor.invalid`.
3. One grey system, one accent (the fixed-strength token scheme).
4. Layout may change, words never: top-down redraw, scaling, size warnings.
5. Every type is a registry record; the canon table above.
6. Geometry is checked by machine, with fixtures in both directions; findings
   warn, never refuse a Mermaid diagram.
7. Figures that carry numbers are drawn by documentor from declared values,
   and a fence that does not reconcile is refused.
8. Axonometric figures are drawn from declared geometry; a Revit export wins
   when a model exists.

## Checks

Run in the page on every drawn SVG, whatever the engine, before placing.
Each finding has a code and goes through `onWarn` as
`diagram 3 (flowchart) D-OVERLAP: …`.

| Code | Finding |
|---|---|
| `D-CLIP` | a text's box extends outside the viewBox |
| `D-COLLIDE` | two texts' boxes intersect (lines of one label excepted) |
| `D-COVER` | an edge or message label overlaps a node shape it does not belong to |
| `D-SMALL` | labels print below three quarters of body size (today's warning, moved here) |
| `D-BUDGET` | the drawing exceeds its type's budget |
| `D-FOCUS` | more focus marks than the type allows |

**Budget.** Limits live in the registry. Mermaid types are counted on the
drawn SVG by selector (`.node`, `.edgePath`, `.actor`…), so the count does not
depend on parsing Mermaid's grammar; chart and axonometric types count their
model. Starting values are diagram-design's (flowchart 9 nodes / 12 edges,
sequence 5 lifelines, state 9 states, ER 8 entities, Gantt 12 tasks, pie 8
slices, bar 12 bars, waterfall 8 bars with one subtotal, exploded 6 parts,
plan 8 tagged rooms and 40 boxes) and are tuned after proofing real
documents; a change of a limit is a registry edit, not an ADR.

**Focus.** In Mermaid, a node marked `:::focus` takes the accent (brand
outline, faint brand fill) through the shared stylesheet; whether Mermaid
needs a `classDef focus` declared for the class to reach the SVG is settled
in Phase 1, and if so `drawable()` adds one to the source it hands Mermaid
(the block keeps the source as written, as with `todayMarker`). In chart and
axonometric fences the word `focus` ends a row.

**Fixtures.** `test/fixtures/diagram-faults.md` holds one diagram per check
that must raise exactly that finding. The gallery, built under `plain`,
`tebin` and `haskoning`, must raise none. Chart and axonometric layouts must
never raise `D-CLIP`, `D-COLLIDE` or `D-COVER` for any fence their parser
accepts: a property test feeds generated fences through layout and checks.

## Accessible figures

- **Mermaid:** `accTitle:` and `accDescr:` are Mermaid's own; it already
  writes `<title>`/`<desc>` and `aria-labelledby`. documentor reads them out
  of the SVG into the block's `title`/`desc`.
- **Chart and axonometric:** `title` prints above the figure and becomes the
  SVG `<title>`; `desc` is the `<desc>` and is not printed. Both engines emit
  `role="img"` and ids prefixed by the diagram's own id.
- **Word:** the `ImageRun` carries `altText` (name, title, description).
- **PDF:** Playwright 1.62 can print a tagged PDF (`tagged: true`). Whether
  the structure tree survives the pdf-lib post-processing in `pdf.ts` is
  checked in Phase 2; it ships only if it does, else it is noted in the ADR.
- `inspect` counts diagrams without a description. A build does not warn
  about it.

The carry test covers both: every word of a fence reaches the SVG text, its
`<title>`/`<desc>`, or the Word alt text.

## Chart engine — ```` ```chart ````

A line grammar in the manner of Mermaid: the first line names the type, then
settings, then one row per line. A row's **label is everything before its
trailing numbers**, so labels need no quotes. Any line the parser does not
understand refuses the fence: it prints as code and the build says which line
and why, as an unparseable Mermaid fence does.

**Numbers.** A value is printed **exactly as written** — documentor does not
reformat the author's figures (text is carried, never written). It is parsed
under one convention: optional sign (`+`, `-`, `−`), digits with optional
thousands groups (`,`, `'`, thin space, each group three digits), optional
`.` decimals. `1,5` is not a number and refuses the fence rather than being
guessed at. Arithmetic is exact decimal (scaled integers), never binary
floating point. Axis ticks are computed — they are chrome, like page numbers
— and print in the convention of the fence's own first value.

**Common settings:** `title`, `desc`, `unit` (printed with the axis and
values), `axis <n>` (dumbbell and waterfall: start the value axis above zero,
see below).

**Shared drawing rules:** width is the text column and labels are laid out at
body size, so a chart never scales and never raises `D-SMALL`. Colours come
from `diagramTokens`. Value labels use tabular figures. Sign is encoded by
fill weight — increase filled with the faint brand tint, decrease hollow,
both outlined — plus geometry and the printed sign, never by red and green.
`focus` (at most one row) takes the brand.

### `bar`

```chart
bar
title Variance against approved, by chapter
unit %
Services to beneficiaries  +1.8
Management and support     +9.2  focus
Personnel                  -5.3
mark +10 Ceiling for management and personnel
```

Horizontal bars, labels in a left column, a zero line; negative values extend
left of zero and positive right, with the value printed outside the bar end.
The domain always contains zero. `mark <value> <label>` draws up to two
reference lines.

### `dumbbell`

```chart
dumbbell
title Approved and revised, by chapter
unit CHF
before Approved
after Revised
Services to beneficiaries    985,421  1,002,750
Management and support       141,857    154,841
Personnel                    577,267    546,955
```

Two values per row joined by a line; the `before` dot hollow, the `after`
dot filled; both printed, and the two names form the legend. The axis starts
at zero unless `axis <n>` starts it higher, in which case it carries a break
mark and prints its start.

### `waterfall`

```chart
waterfall
title From approved to revised budget
unit CHF
axis 1,500,000
total Approved budget             1,704,545
step  Services to beneficiaries     +17,329
step  Management and support        +12,984  focus
step  Personnel                     -30,313
total Revised budget              1,704,545
```

- The first and last rows are `total`; at most one `total` between them is a
  subtotal.
- **Every `total` must equal the running sum exactly**, or the fence is
  refused with the difference named. Every `step` carries its sign. A zero
  step is refused (it would draw nothing; say it in the text).
- Totals stand on the baseline; steps float between the running levels before
  and after them, joined by carry lines at the level they carry.
- The axis starts at zero. `axis <n>` starts it higher — the only way a
  ±30,000 step on a 1.7 million budget is visible — and then the total bars
  carry a break mark and the axis prints its start. `axis` must lie below
  every running level, or the fence is refused.
- Every emitted bar carries `data-role`, `data-value`, `data-name`; every
  carry `data-carry`. A test re-derives scale, levels and carries from those
  attributes alone and compares them with the drawn geometry (±0.75 px), as
  diagram-design's `verify-waterfall.py` does.

## Axonometric engine — ```` ```axonometric ````

One projection for both types: 2:1 dimetric, model `x` to the right-down,
`y` to the left-down, `z` up; screen `sx = (x − y)·k`, `sy = (x + y)·k/2 −
z·k`, `k` fitted to the column. Model units are abstract (a plan reads them
as metres). One primitive: a prism with a footprint `w × d`, a height `h`
and an optional corner radius `round r` — a slab, a box, and at
`r = min(w, d)/2` a cylinder. Faces take three tones of the grey system
(top lightest); the focus element's top face takes the brand tint. No
shadows. Every element emits its model geometry as `data-*`, and a test
reprojects every silhouette with an independent copy of the projection and
compares.

### `exploded`

```axonometric
exploded
title Rooftop unit, exploded
desc The four parts of the unit in assembly order, cover on top.
gap 12
part Cover           120 x 80 x 6
part Fan module       60 x 70 x 30  level 2
part Filter bank      50 x 70 x 30  level 2  at 65 0
part Chassis         120 x 80 x 40  focus
```

- Parts list top to bottom. Parts with the same `level` sit side by side, at
  `at x y` within the footprint, and lift together.
- Levels are separated by the same `gap`.
- Labels sit in one column to the right, each joined to its part by a
  horizontal leader that starts on the part and crosses no other part; if no
  such leader exists the layout widens the column, and if the column cannot
  fit the fence is refused.

### `plan`

```axonometric
plan
title Second floor, east wing
plate 40 x 24
room  Reception      0  0   10 x 8
room  Meeting room  10  0    8 x 8  focus
room  Open office    0  8   18 x 16
block Server rack   16 20    2 x 1  h 2  in Open office
```

- `plate` is the floor or site. `room` is a floor area with walls cut at
  desk height (default `h 1.2`); `block` is a solid box (furniture, a
  building on a site plan), unlabelled unless it has a name and no `in`.
- Rooms and blocks must stand on the plate; rooms must not overlap each
  other, and blocks must not overlap each other. Each is refused with the two
  names when they do.
- Painting is back to front by a **topological sort over footprints** (A
  before B when A lies wholly behind B and their outlines overlap), not by
  `x + y`, which draws a long wall over the desk in front of it.
- Every room is tagged on its own floor, every named block on its roof; tags
  paint last and must not overlap one another — a collision is a `D-COLLIDE`
  finding, and the author shortens a name or enlarges the plate.

## Phases

Each phase is its own commit, `npm run typecheck` and `npm test` green, and
`npm run diagrams:proof` looked at before it lands.

0. **Canon, no behaviour change.** `docs/adr/` with ADRs 1–5; the directory
   split and the registry; the parity tests. Before the split, the gallery's
   SVGs under `plain`, `tebin` and `haskoning` are hashed; after it, they are
   byte-identical (`deterministicIds` makes that possible).
1. **Checks.** `checks.ts`, the six findings, `diagram-faults.md`, budget
   counts per type, `:::focus`. ADR 6.
2. **Accessible figures.** `accTitle`/`accDescr` read out, Word alt text,
   tagged PDF if it survives, `inspect` count.
3. **Chart engine.** Parser, layout, SVG for the three types; gallery
   sections; the waterfall re-derivation test; `docs/diagrams/chart.md`.
   ADR 7.
4. **Axonometric engine.** Projection, depth sort, the two types; gallery
   sections; the reprojection test; `docs/diagrams/axonometric.md`. ADR 8.
5. **Documents.** README's Diagrams section rewritten around the registry
   table, and the skill pointing at both authoring references.

**Proving material.** Every new type and check is tried on real content, not
only on the gallery: the marketing posts in `projects/marketing/posts/`
(the 2026-10-19 "AI at TEBIN" post and the topics for the week after) and the
Revit–Claude task flow in `Desktop/Docs/yarik/`. The Ukraine NCE report is no
longer a target.
