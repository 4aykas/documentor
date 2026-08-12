# Phase 2 residuals

What phase 2 knowingly left open, and why. Written when the branch was
finished so the reasoning survives the working notes, which are not committed.

## The one that matters most

**`src/cli/build.ts`'s format dispatch falls through to Markdown.** The
choice among renderers is an `?:` chain: `pdf`, then `docx`, then an `else`
that writes Markdown bytes — not an exhaustive `switch` over `format`. Adding
a format to `FORMATS` without adding its own branch compiles clean, runs
clean, and exits 0 while writing Markdown into a file with the new extension.
Phase 3 adds `xlsx` to that same set. Unless the dispatch becomes an
exhaustive check first — a `switch` with no default, or an explicit
`never`-typed guard — the day `xlsx` is added is the day this trap fires,
silently, in the one place a reader has no reason to suspect the bytes are
wrong: the file opens, just not as a spreadsheet.

## Parked findings

**A Word list is text, not a list.** `src/render/docx.ts` writes the marker
(`1. `, `• `) itself rather than using Word's numbering machinery, because
Word's numbering restarts at 1 for every fragment a nested list splits off,
and the IR's `start` — what a reader checks when they look at item 4 — is the
thing that has to survive. The cost is that a reader cannot continue the list
by pressing Enter at its end; it is prose that looks like a list, not one.

**Word tables have equal columns.** The HTML renderer lets the browser lay a
table out; there is no Word equivalent reproducible across versions, and a
width computed from the text would need font metrics this renderer does not
have. Every DOCX table column is the same width regardless of content.

**Word embeds a PNG and nothing else, where HTML and PDF embed any
raster.** `src/render/docx.ts` reads a picture's natural dimensions from
PNG's IHDR chunk, and that is the only decoder it has. A picture needs its
aspect ratio even when the block supplies `widthPt`, because the height has
nothing else to come from — so a JPEG or a GIF cannot be scaled at all, with
or without a width. `src/render/html.ts` embeds any `data:` URI, and a JPEG
is one, so the same document is a picture in the PDF and a bordered
placeholder in the .docx. This was already the behaviour; what changed this
phase is that the `RASTER` regex stopped *accepting* jpeg and gif, whose only
effect was to route them to the same placeholder from one branch further
down, while the comment beside it claimed the block could rescue them by
saying how wide it is. Closing the gap means a JPEG decoder — enough of one
to read SOF0's height and width — which is a phase-3-sized piece of work, not
a merge-eve one.

**No visual baseline for DOCX.** Word cannot be driven headlessly here, and
rasterising through a converter would test the converter, not the renderer.
The agreement test (below) is what stands in for it.

**The duplicate-`w:styleId` question is answered by avoidance, not by
measurement.** `styles.xml` gives every custom style a distinct id, which
sidesteps the question of whether Word — or another reader — tolerates a
collision. Whether it does was never measured; LibreOffice is not installed
on this machine.

**`theme.logo.png` does not follow the theme.** A raster is not repainted by
a class. This was already true of the HTML/PDF renderer and stays true of
DOCX — restated here because DOCX makes the same choice for the same reason,
not because it is new.

**A broken `logo.png` in a theme fails every render that uses that theme**,
not only the ones that inspect the letterhead. That is the intended
behaviour, not a bug: a theme is authored, not untrusted input, so failing
loud on a bad asset is preferable to a render that silently omits the logo.
Worth stating because the blast radius is wider than "the letterhead is
wrong" — it is "the build fails," for every format, until the theme is fixed.

**Emphasis inside a link is flattened in Word.** `ExternalHyperlink` takes
runs, and the renderer passes the link's text as a single run, so the IR can
express `[**bold** link](…)` and this renderer cannot reproduce the bold. The
kitchen-sink fixture has no such link today; the moment one is added, the
agreement test's emphasis comparison fails, because it compares Word's bold
runs against the IR's. That is the right outcome — a limitation that
announces itself the first time it is exercised, rather than a silent loss
that would have shipped unnoticed. (`src/render/docx.ts`'s `flatten()`
comment points here; this is that promise kept.)

## What the agreement test still cannot see

`docs/superpowers/notes/2026-08-12-phase-1-residuals.md` tracks this list;
phase 2 closed two of its four items for DOCX (inline emphasis, link
targets) and left two open. Of those two, one changed shape this phase:

**Table alignment is now the cheapest of the open gaps to close.** It was
already unclosed in phase 1, for the same reason inline emphasis was — PDF
text extraction carries no styling, only text. DOCX does carry alignment, as
`w:jc` on each cell's paragraph, and the kitchen-sink fixture already has
three distinct column alignments (left, center, right) sitting unused by the
agreement test. Closing it is a small extractor next to the ones the
emphasis and link comparisons already added, and one comparison against the
IR's `align` array — smaller than either of the two comparisons phase 2 did
add. Left open only because it was found late in the phase's review, not
because it is hard.

**Table cells are still compared as a value sequence, not per cell**, in the
PDF half of the agreement test — an untagged PDF has no readable cell
boundaries. DOCX does have readable cell boundaries and could be compared per
cell instead of as a flat sequence; phase 2 did not do this. A value landing
in the wrong DOCX column with unchanged reading order would still pass.

## Coverage the DOCX fixtures leave thin

**Emphasis and link coverage in the kitchen-sink fixture is thin**: one bold
run, one italic run, and one link, all inside a single paragraph.
`emphasisFromIr`'s recursion — the part of the renderer that walks nested
inline spans — is exercised on exactly that one shallow case. Emphasis
inside a table cell, inside a heading, inside a list item, and a document
carrying more than one link, are all unexercised. None of these are known to
be broken; none of them have been checked either.

**The `DocH1` branch of `headingsFromDocx` is dead in practice.**
`ingestMarkdown` lifts the document's one `h1` into `meta.title` before any
heading reaches the renderer, so a Markdown source can never produce a
level-1 heading in the DOCX output today. The branch exists for a future
ingester that does not make that promise, or for hand-built IR that skips
`ingestMarkdown` entirely; it has no path to it from the CLI as shipped.

## Small things worth naming

- `resetPdfjsWorkerGlobal` and its explanatory comment are duplicated
  verbatim in `test/agreement/agree.test.ts` and
  `test/baseline/kitchen-sink.test.ts`. Two places to keep in sync if pdf.js's
  worker-reset requirement ever changes.
- The CLI test asserting "writes a Word document" only checks that the
  output file exists. An empty buffer would pass it; the buffer's actual
  content is covered separately, by the renderer's own tests, not by this
  one.
- `test/render/normalize-docx.test.ts`'s timestamp assertion names the
  offending zip entry by its array index in a failure message
  (`` `entry ${i} carries …` ``), not by the entry's own name. A failure
  points at "entry 4," which a reader then has to go look up.
- The per-cell agreement test compares only the first `table` block against
  every `<w:tc>` in the document. That's fine as long as a fixture has one
  table — it fails loudly, not silently, the day a second one is added and
  the counts stop lining up — but the test itself doesn't say that's the
  assumption, so the next reader has to work it out from the failure rather
  than being told up front.
- The link-target comparison in the agreement test carries no comment
  explaining why the IR is its reference point — unlike its two sibling
  comparisons (emphasis, table alignment), which do say why. The one
  comparison whose reasoning is least obvious — a live href, not just text,
  compared against a relationship target — is the one that doesn't explain
  itself.
- Several minors surfaced in task reviews and were judged not worth a fix
  this phase: `styles.xml` gives every custom style `basedOn: 'Normal'`
  though no `Normal` style is defined, making that inheritance a no-op;
  the horizontal-rule paragraph is the only one with no style and no
  `keepNext`, unlike HTML's `break-after: avoid`; inline code changes font
  but not size, where HTML sets it to 0.92× the body size; the
  relationship-integrity test passes vacuously if it finds zero `r:id`
  attributes; table cells set no margins against Word's 108-dxa default,
  and rows do not set `cantSplit` against HTML's `break-inside: avoid`;
  and one unused `IParagraphOptions` type import
  survives because no lint script exists to catch it.

## Before publishing

`npm audit --omit=dev` reports zero vulnerabilities at the end of this
phase, unchanged from phase 1's finding. `docx` and its transitive
dependencies (`jszip`, `nanoid`, `hash.js`, `xml`, `xml-js`) added nothing to
that count. The dev-dependency count from phase 1's note was not re-checked
here; it is a publish gate, not a merge gate.
