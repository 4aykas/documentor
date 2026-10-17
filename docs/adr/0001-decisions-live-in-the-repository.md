# ADR 0001 — Decisions live in the repository, as ADRs

**Status:** accepted (2026-10-17)

## Context

documentor's decisions were written in three places: README prose (which
describes behaviour, and says why only in passing), commit messages (which say
why, but are found only by someone who already knows which commit to read),
and the owner's personal wiki (which is outside the repository, so a
contributor or a fresh agent session never sees it). The diagram colour
system, for one, was decided across four commits and survived in none of
these as one statement.

cathrynlavery/diagram-design keeps its decisions as numbered ADRs beside the
code, amended in the same change that moves them; its ADR 0002 notes that
the counters a test checks are that ADR's enforcement.

## Decision

Decisions are ADRs in `docs/adr/`, in the form and under the rules in
`docs/adr/README.md`. A specification stays a spec (`docs/superpowers/specs/`)
and may produce ADRs; the wiki keeps lessons that are not this project's.

## Consequences

- `CODING_STANDARDS.md` asks a reviewer whether a change moves a recorded
  decision, and if so whether it amends the ADR in the same change.
- `CLAUDE.md` points here, so an agent reads the decision before changing
  what it governs.
- The first ADRs record decisions already taken, citing the commits that took
  them; they describe, they do not decide anew.
