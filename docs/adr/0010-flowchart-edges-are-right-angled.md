# ADR 0010 — A flowchart's edges are right-angled

**Status:** accepted (2026-10-17)

## Context

Flowcharts were drawn with `curve: 'linear'`: straight segments, chosen over
Mermaid's default spline because a spline reads as sketched. Straight
segments join a decision's corner to an off-axis box on a diagonal; the
three-gates proving run (2026-10-17 note, item 2) had both its decisions
leave that way. cathrynlavery/diagram-design treats a diagonal connector as
an automatic fail and draws every off-axis connection as a right-angled
elbow.

## Decision

- Flowcharts are drawn with `curve: 'step'`: every edge is horizontal and
  vertical segments, turning at the midpoint between its ranks
  (`mermaidConfig` in `src/render/diagrams/mermaid/render.ts`).
- `test/render/diagram-checks.test.ts` reads every edge path of the
  gallery's flowchart and the three-gates chain and fails on a curve command
  or a segment that moves along both axes (red with `linear`, checked).
- ELK, on request (`layout: elk`), routes orthogonally by itself.
- Class diagrams share the setting and read well with it. State diagrams do
  not: elbows put a transition's arrowhead on a state's corner and fold its
  loops onto each other, so the state record keeps `curve: 'linear'`.

## Consequences

- Every flowchart's bytes changed when this landed.
- An elbow sometimes takes a short jog where an edge meets a box off its
  centre; that is the price of never drawing a diagonal.
- Not a finding for authors: the author cannot route an edge, so the guard
  is a test on documentor, not a warning on a document.
