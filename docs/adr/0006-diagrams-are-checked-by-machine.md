# ADR 0006 — Diagrams are checked by machine, and a finding warns

**Status:** accepted (2026-10-17)

## Context

A diagram that reads badly passed every test documentor had: the colour
guard looks at paint, not geometry, and the only size rule was one warning
in `place`. The three-gates proving run (2026-10-17 note) found a tall chain
given width advice and a focus mark silently ignored. cathrynlavery/
diagram-design's ADR 0005 states the lesson: "a rule that only lives in prose
is a rule that ships broken examples", so its label rules are a checker with
adversarial fixtures.

## Decision

- **Measure in the page, judge in Node.** After the kept drawing is in the
  host, `measureScript` (`src/render/diagrams/checks.ts`) collects text
  boxes, node boxes, edge-label boxes, the counts each budget selector
  matches and the focus marks. Pure rules turn that into findings, so every
  rule is unit-tested on synthetic boxes, its fault and its near miss.
- **The findings:** `D-CLIP`, `D-COLLIDE`, `D-COVER` (overlap of more than
  1 px both ways), `D-SMALL` (labels below 0.75 of body size; advice by the
  binding dimension), `D-BUDGET` (per-type `{ max, count }` in the registry,
  counted on the drawn SVG by selector, so no Mermaid grammar is parsed),
  `D-FOCUS` (above the record's `focusMax`), `D-UNRECORDED`.
- **A finding warns.** It reaches the build as `diagram N (kind) D-CODE:
  what; what would help`, and never refuses or changes the drawing. The
  author decides; the skill relays the advice as a proposed edit.
- **Fixtures in both directions.** `test/fixtures/diagram-faults.md` holds
  one diagram per finding Mermaid can be made to produce, each raising
  exactly its heading's code; the gallery under plain, tebin and haskoning
  raises none; every budget selector must count something on the gallery,
  because a selector that matches nothing passes every budget. `D-CLIP` and
  `D-COVER` have no reliable Mermaid reproduction (Mermaid trims its own
  viewBox to its ink, and dagre keeps labels off nodes), so their synthetic
  tests stand alone until a real document produces one.
- **`:::focus` is styled by the shared stylesheet** (brand outline, faint
  brand fill): Mermaid puts the class on the node's group without a
  `classDef`, and an author's own `classDef` still wins, being inline.

## Consequences

- The gallery is part of the contract: its journey dropped to three tasks,
  because at four it was 941 px wide and raised `D-SMALL` itself.
- A new type's record needs budget selectors that count on its gallery
  diagram, or the selector test fails.
- Budget limits start from diagram-design's and are tuned after real
  documents; changing one is a registry edit, not an amendment here.

## Amendments

**2026-10-17 (review of 5bcf342).** A selector must count exactly what its
key names, and a test now pins exact counts, not only "more than zero": a
class diagram's notes are `g.node` too (classes now match `[id*="-classId-"]`),
and a fork or choice is an unlabelled `statediagram-state` (states now need a
label). Two lines of one label share an owner and are never a `D-COLLIDE`
pair. `D-SMALL`'s tall advice offers a left-to-right direction only to a
top-down source, and the limit is compared with a tolerance, since the width
cap lands exactly on it. The focus rule paints a node's outline only, not
the rows of an entity or the members of a class.

**2026-10-17 (review of d266e48).** `D-COVER` also judges documentor's own
charts: any text on a declared bar or dot (`[data-role]`). For charts it is
no longer synthetic-only; generated charts are held to it.
