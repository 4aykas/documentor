# Architecture decision records

A decision that shapes more than one change — why the code is the way it is,
in a way the code itself cannot say — is written here, one file each.

- **When.** A change that makes such a decision adds an ADR. A change that
  moves one amends it (a dated entry under Amendments) or supersedes it (a new
  ADR, and the old one's status says by which). An accepted ADR is never
  rewritten: what it said is part of why things are as they are.
- **What goes elsewhere.** A design for a piece of work is a spec and its
  plan in `docs/superpowers/`; how to use documentor is README; a lesson
  about a tool outside this project goes to the personal wiki.
- **Names.** `NNNN-slug.md`, numbered in order with no gaps.
  `test/guardrails/adr.test.ts` checks the numbers, the status line and that
  this index lists every file.

## Template

```markdown
# ADR NNNN — The decision, as a sentence

**Status:** accepted (YYYY-MM-DD) | superseded by ADR NNNN | proposed

## Context
What forced the decision: the problem, the evidence, what was tried.

## Decision
What was decided, precisely enough to check a change against.

## Consequences
What it costs and what it makes possible; what a later change must respect.

## Amendments
**YYYY-MM-DD.** What changed and why.
```

## Index

| ADR | Decision | Status |
|:--|:--|:--|
| [0001](0001-decisions-live-in-the-repository.md) | Decisions live in the repository, as ADRs | accepted |
| [0002](0002-diagrams-are-drawn-offline.md) | Diagrams are drawn offline, in the Chromium the PDF already needs | accepted |
| [0003](0003-one-grey-system-one-accent.md) | A diagram is one grey system with one accent | accepted |
| [0004](0004-layout-may-change-words-never.md) | A diagram's layout may change to fit the page; its words never do | accepted |
| [0005](0005-every-type-is-a-registry-record.md) | Every diagram type is one registry record, and the canon is tested | accepted |
