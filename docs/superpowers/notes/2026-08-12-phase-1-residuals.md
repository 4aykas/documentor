# Phase 1 residuals

What phase 1 knowingly left open, and why. Written when the branch was
finished so the reasoning survives the working notes, which are not committed.

Nothing here blocks phase 2. The first two were done at the start of it.

## Parked findings

**~~A refused link carries a class with no rule.~~** *Closed.* The wrapper is
gone: a refused link's text is ordinary prose once the link is removed, and the
muted target beside it was already the whole visible signal, so the class went
the way `table.landscape` did.

**~~The link scheme filter is HTML-only.~~** *Closed.* The rule moved to
`src/render/links.ts` and both renderers now ask it. Markdown writes
`text (javascript:)` where it used to write `[text](javascript:…)`.
`test/render/links.test.ts` puts the same document through both renderers and
requires the same answer, which is the blind spot below that the agreement test
cannot cover.

**`validateDoc` runs before the `dropped` report.** A document that both loses
content at ingest and fails validation tells the user only about the refusal.
Defensible — the refusal is the actionable half — but worth revisiting when the
sidecar arrives and `dropped` becomes something the user answers rather than
merely reads.

## What the agreement test cannot see

`test/baseline/kitchen-sink.test.ts` renders one document through both
renderers and compares what a reader would compare. Three things are outside it
by construction, and a fourth by choice:

- **~~Inline emphasis.~~** *Closed for DOCX.* `test/agreement/` now renders the
  kitchen sink through Word as well as PDF and compares bold and italic runs
  against the IR. PDF text extraction still carries no weight or style, so the
  gap remains between PDF and the other two.
- **~~Table alignment.~~** *Closed for DOCX.* `test/agreement/` compares every
  cell's `w:jc` against the IR's per-column `align`, broadcast down each row so
  a value landing on the wrong column fails the same way a wrong table cell
  does. PDF text extraction still carries no alignment, so the gap remains
  between PDF and the other two — the same shape as inline emphasis above.
- **~~Link targets.~~** *Closed for DOCX.* `test/agreement/` compares a live
  href between the IR and Word's relationship target, not only the visible
  text. The PDF half of this gap — `test/render/links.test.ts` covers scheme
  refusal, not a live href — remains open.
- **Table cells are compared as a value sequence**, not per cell, because an
  untagged PDF has no readable cell boundaries. A value landing in the wrong
  column with unchanged reading order would pass. The baseline image answers
  geometry instead. DOCX has readable cell boundaries and could be compared
  per cell; not done in phase 2.

Phase 3 adds one more renderer over the same IR. Each of these gaps gets wider
with every renderer added, so the remaining ones deserve strengthening before
the fourth renderer lands, not after.

## Deferred minors from the task reviews

- `arimoFaceCss` assigns its cache after the awaits, so two concurrent first
  callers duplicate the work. Deterministic result; harmless.
- `" data:"` with leading whitespace, and `"DATA:"` in mixed case, degrade to a
  placeholder rather than rendering as an image. No fetch either way, so it
  fails safe; it is a fidelity nit.
- An image's `widthPt` is dropped on the placeholder path. No ingester sets it
  in phase 1.
- `packageRoot()`'s name-mismatch branch has no direct test. The layout risk
  that actually bit — source versus `dist` — is covered from both.
- Exit codes appear as bare literals at call sites. The contract is documented
  centrally in `src/bin/documentor.ts`; `src/cli/build.ts` cross-references it,
  and `test/cli/exit-codes.test.ts` pins all four.
- The wall-clock and network guardrail greps skip whole-line comments only, so
  an inline trailing comment containing `Date.now()` or a URL would be a false
  positive. It fails loud, never silent.
- `"Unit price"` wraps in the table header under auto layout. Cosmetic, and
  baked into a baseline a human approved.

## Before publishing

`npm audit` reports seven vulnerabilities in transitive **dev** dependencies
(three moderate, two high, two critical). `npm audit --omit=dev` reports none,
so nothing reaches a consumer of the package — but this is a publish gate, not
a merge gate, and it should be triaged before the first `npm publish`.

## What the first CI run confirmed, and what it disproved

CI ran for the first time once `main` got a remote (`gh run 31621998165`):
ubuntu-latest and macos-latest went fully green, including the byte-identical
PDF and DOCX reproducibility gates that had only ever been measured on this
machine — the README's per-platform promise now holds on Linux and macOS by
measurement, not only by configuration.

windows-latest failed on exactly two assertions: the byte comparison of a
rendered page against its committed PNG, in both `test/baseline/kitchen-sink.test.ts`
and `test/baseline/tebin.test.ts`. The images CI rendered were downloaded and
inspected by hand — visually identical to the committed baselines, same
layout, same embedded Arimo, same Cyrillic and Polish glyphs — and still
differed byte-for-byte. The workflow had assumed "Windows here equals Windows
there"; the real cause is sub-pixel rasterisation differences between two
Windows machines running different Chromium builds, which is the same
"PNGs from the same SVG differ across renderer versions and platforms" the
design already warns against, just arriving one layer closer to home than
"different platform" — it turns out to include "different machine, same
platform" too.

The byte-comparison tests moved into their own file,
`test/baseline/local-only-pixels.test.ts` — see its header comment — and CI now
excludes only that file, on all three platforms. Everything else those two
test files were checking (the running header not colliding with the body,
the fixture spanning more than one page, ingest dropping nothing, the
Markdown round trip, the TEBIN theme's markup assertions) is not
rasterisation-dependent and runs everywhere, unchanged by this finding.
