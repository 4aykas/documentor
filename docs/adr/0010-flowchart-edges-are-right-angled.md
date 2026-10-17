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
- State and class diagrams keep `curve: 'linear'` on their records: elbows
  put a state transition's arrowhead on a corner and fold its loops, and
  leave a class's inheritance triangle short of the class it points at.

## Consequences

- Every flowchart's and block diagram's bytes changed when this landed.

## Amendments

**2026-10-17 (review of 0c67f49).** A step edge ends on a repeated point, a
segment of no length, and Chromium then lays the arrowhead sideways: every
arrowhead in flowcharts, class and block diagrams pointed along the wrong
axis, and the edge test, which looked only for diagonals, passed. Repeated
points are now dropped after drawing, and the test fails on an edge that
ends on no length; it covers the gallery's block diagram too. The first
wording said class diagrams read well with elbows; they do not (see above).
An edge that runs through a box it does not join, or through another edge's
label, is now the finding `D-CROSS`.
- An elbow sometimes takes a short jog where an edge meets a box off its
  centre; that is the price of never drawing a diagonal.
- Not a finding for authors: the author cannot route an edge, so the guard
  is a test on documentor, not a warning on a document.
