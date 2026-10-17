# Diagram system, phase 1 — checks on every drawn diagram

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every drawn diagram is measured in the page and judged by pure
functions; what fails a rule reaches the build as a coded warning. The
gallery builds with none.

**Spec:** `docs/superpowers/specs/2026-10-17-diagram-system-design.md`, Checks.
**Inputs:** `docs/superpowers/notes/2026-10-17-proving-three-gates.md`.

## What the probe of the gallery showed (2026-10-17)

- `:::focus` reaches the SVG as a class on the node's `g` without a
  `classDef` (flowchart and, via `class X focus`, state). A stylesheet rule
  can style it; an author's own `classDef focus` still wins, being inline.
- Journey writes six zero-size `text` elements at the origin: measuring must
  skip texts with no area.
- Two quadrant points at nearly the same place give overlapping labels — a
  real collision Mermaid produces, usable as a fixture.
- The gallery's journey (four tasks) is 941 px wide and prints at 7.1 pt: the
  gallery itself raises `D-SMALL`. Mermaid ignores journey configuration
  (render.ts note), so the fixture drops to three tasks (741 px, fits).
- Budget selectors that count on the gallery: flowchart `g.node` /
  `path.flowchart-link`; sequence `line.actor-line`; state
  `g.node.statediagram-state`; ER and class `g.node`; Gantt `rect.task`; pie
  `path.pieCircle`; quadrant `.data-point`; journey `line.task-line`; sankey
  `g.node` / `g.link`.

## Global constraints

- Findings warn; they never refuse or change a drawing.
- Measuring (in the page) and judging (pure, in Node) are separate, so every
  rule is unit-tested on synthetic boxes in both directions.
- A selector or a rule that matches nothing on the gallery is a test failure,
  not a pass (CODING_STANDARDS, "A guard test is shown red once").
- Message form: `diagram N (<kind>) D-CODE: <what>; <what would help>`. The
  two existing non-finding messages ("could not be drawn", "is drawn
  top-down") keep their wording.

## File structure

| Path | Responsibility |
|:--|:--|
| `src/render/diagrams/checks.ts` | `Measured` type, `measureScript` (the in-page collector), pure rules, `findings()` |
| `src/render/diagrams/registry.ts` | `budget` becomes `{ max, count }` per key |
| `src/render/diagrams/mermaid/render.ts` | `.focus` rules in the shared stylesheet |
| `src/render/diagrams/index.ts` | measure after the kept drawing is in the host; `D-UNRECORDED` |
| `src/render/diagrams/place.ts` | `D-SMALL` by the binding dimension |
| `test/fixtures/diagram-faults.md` | one section per Mermaid-reproducible finding, headed with its code |
| `test/render/diagram-checks.test.ts` | pure rules both ways; faults raise exactly their code; gallery raises none; every budget selector counts > 0 on the gallery |

## Tasks

### Task 1: Gallery fixture

- [ ] Journey down to three tasks. Record `npm run diagrams:hash` before and
      after; only the journey differs.

### Task 2: Measure and judge

- [ ] `measureScript(selectors)` returns, for the SVG in `#host`: its size;
      every text with area (box, string, owning group: the nearest
      `g.node`, `g.edgeLabel`, `g.cluster`, `g.actor`, `g.label` or the text
      itself); every node box (`g.node`); every edge-label box
      (`g.edgeLabel` with area); a count per budget selector; the number of
      `.focus` elements.
- [ ] Rules, each `(m: Measured, t: DiagramType | undefined) => Finding[]`:
      `D-CLIP` (a text box past the SVG by more than 1 px), `D-COLLIDE` (two
      texts of different owners overlapping more than 1 px both ways),
      `D-COVER` (an edge-label box overlapping a node box by more than 1 px),
      `D-BUDGET` (a count above its max), `D-FOCUS` (focus count above
      `focusMax`), `D-UNRECORDED` (no type).
- [ ] Unit tests on synthetic `Measured`: each rule fires on its fault and
      not on the near miss.

### Task 3: Wire it

- [ ] `drawDiagrams` measures the kept drawing (after a top-down retry, the
      host already holds it) and passes findings to `onWarn`.
- [ ] `place` words `D-SMALL` by what binds: the column ("fewer side-by-side
      boxes or shorter labels"; top-down advice as today for an untried LR
      flow) or the page height ("a shorter chain, split in two, or a
      left-to-right direction").
- [ ] `.node.focus` (rect, polygon, circle, path) takes a brand outline and a
      faint brand fill in the shared stylesheet.

### Task 4: Fixtures and gallery

- [ ] `diagram-faults.md`: `D-COLLIDE` (two quadrant points together),
      `D-BUDGET` (a flowchart of 12 nodes), `D-FOCUS` (three focus nodes),
      `D-UNRECORDED` (`packet-beta`), `D-SMALL` (the three-gates chain, which
      is height-bound). `D-CLIP` and `D-COVER` have no reliable Mermaid
      reproduction; their synthetic tests stand.
- [ ] The test: each section raises exactly its heading's code; the gallery
      under plain, tebin and haskoning raises no `D-` code; every budget
      selector counts more than zero on its gallery diagram.
- [ ] Show the focus test red once (drop the stylesheet rule).

### Task 5: Records

- [ ] ADR 0006, "Diagrams are checked by machine, and checks warn": the rules,
      the measure/judge split, the fixture discipline, why `D-CLIP` and
      `D-COVER` are synthetic-only.
- [ ] README Diagrams: one paragraph on the findings and `:::focus`; the skill
      tells the assistant what a `D-` warning asks of the author.
