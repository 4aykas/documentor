# ADR 0005 — Every diagram type is one registry record, and the canon is tested

**Status:** accepted (2026-10-17, 794efef)

## Context

What one diagram type needed beyond the shared configuration was spread over
four switches in one 517-line file: Mermaid configuration, stylesheet rules,
repaints after drawing, size caps. Adding a type had no checklist, and the
documentation's claims about types (a type count, the list in README) were
kept in step by hand.

cathrynlavery/diagram-design ships every type as a complete set — reference,
examples, budget, verifier — and counts its types in a test.

## Decision

- `src/render/diagrams/registry.ts` holds one `DiagramType` record per type
  documentor draws: id, engine, header words, label, budget, focus limit, and
  what the engine needs for it (see Amendments for what stays outside).
- The drawn block carries the record's id as `kind`.
- The canon — what must agree with the registry — is held by tests that read
  the registry, never a second hand-kept list:
  - the gallery has one section per record, in order, headed with its label
    (`test/render/diagram-registry.test.ts`);
  - README's diagram table has one row per record naming its canonical
    header (`test/guardrails/docs-parity.test.ts`);
  - a record says it turns top-down exactly where the code does.

## Consequences

- A new type is a record, a gallery section and a README row; the tests fail
  until all three exist. Whether the type should exist at all is a review
  question (`CODING_STANDARDS.md`, "Recorded decisions").
- A Mermaid type with no record is still drawn, with the shared settings and
  `kind: ''`; it is simply not proofed or corrected.

## Amendments

**2026-10-17 (review of 794efef).** "Nothing else in the code lists types"
claimed too much. The four switches are gone, but four type-specific places
remain outside the registry, each because it is Mermaid's own vocabulary
rather than documentor's: the per-type keys of `mermaidConfig` (flowchart,
sequence, gantt, timeline, state), the per-type theme variables in
`diagramVars` (quadrant, journey, git graph), the Gantt `todayMarker` rewrite
in `drawable`, and the flowchart and timeline patterns in `leftToRight`. The
last is held in step with the records' `turnsDown` by
`diagram-registry.test.ts`. A future change that adds per-type behaviour puts
it in the record, not in a new list.
