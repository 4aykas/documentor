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
  what the engine needs for it. Nothing else in the code lists types.
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
