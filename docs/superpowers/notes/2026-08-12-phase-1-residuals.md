# Phase 1 residuals

What phase 1 knowingly left open, and why. Written when the branch was
finished so the reasoning survives the working notes, which are not committed.

Nothing here blocks phase 2. The first two are worth doing early in it.

## Parked findings

**A refused link carries a class with no rule.** `src/render/html.ts` wraps a
link whose scheme was refused in `class="link-refused"`, but only
`.link-refused-target` has a CSS rule. This is the same shape as the
`table.landscape` class that phase 1 deleted for being a promise nothing kept —
either style the wrapper or drop the class.

**The link scheme filter is HTML-only.** `src/render/html.ts` refuses
`javascript:`, `vbscript:` and `data:` in a link and renders the text plus host
instead. `src/render/md.ts` still writes `[text](javascript:…)` verbatim. So the
two renderers disagree about the same document, which is exactly the drift the
agreement test exists to catch — and cannot, because link *targets* are outside
its reach. Markdown output is inert until something else renders it, which is
why this is small rather than urgent, but the asymmetry should not outlive
phase 2's first week.

**`validateDoc` runs before the `dropped` report.** A document that both loses
content at ingest and fails validation tells the user only about the refusal.
Defensible — the refusal is the actionable half — but worth revisiting when the
sidecar arrives and `dropped` becomes something the user answers rather than
merely reads.

## What the agreement test cannot see

`test/baseline/kitchen-sink.test.ts` renders one document through both
renderers and compares what a reader would compare. Three things are outside it
by construction, and a fourth by choice:

- **Inline emphasis.** PDF text extraction carries no weight or style, so
  dropping `<strong>` from the HTML renderer would not fail it.
- **Table alignment.** Same reason.
- **Link targets.** Only the visible text is compared.
- **Table cells are compared as a value sequence**, not per cell, because an
  untagged PDF has no readable cell boundaries. A value landing in the wrong
  column with unchanged reading order would pass. The baseline image answers
  geometry instead.

Phases 2 and 3 add two more renderers over the same IR. Each of these gaps gets
wider with every renderer added, so the agreement test deserves strengthening
before the fourth one lands, not after.

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

## Not yet verified anywhere

CI is configured for Linux, macOS and Windows but has never run: the workflow
triggers on pushes to `main` and on pull requests, and this work was done on a
branch with no remote. Everything reported green was measured on Windows. The
byte-identical gate in particular is a per-platform promise — the README says
so — and the Linux and macOS halves of it are configured, not confirmed.
