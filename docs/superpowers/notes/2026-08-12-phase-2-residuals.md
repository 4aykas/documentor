# Phase 2 residuals

What phase 2 knowingly left open, and why. Written when the branch was
finished so the reasoning survives the working notes, which are not committed.

## The one that mattered most

**~~`src/cli/build.ts`'s format dispatch falls through to Markdown.~~**
*Found and closed before this branch merged.* The `?:` chain became an
exhaustive `switch` over a `Format` union with a `never`-typed default, so
adding a format to the list without a renderer is now a compile error rather
than a file that opens and holds the wrong bytes. It was argued here that the
fix had to land before phase 3 added `xlsx`; it landed instead of being
written down for a future reader to act on, which is the outcome this section
was asking for.

## Found by integration, not by review

**The generated TEBIN theme was not byte-identical across checkouts.**
`core.autocrlf=true` on a Windows machine, with no `.gitattributes` in the
repository, meant `git checkout` rewrote `brand/tebin/logo-full.svg`'s line
endings to CRLF in the working tree while the committed blob stayed LF.
`src/theme/generate-tebin.ts` embeds that file's content verbatim into
`themes/tebin/theme.json`, so a fresh regeneration on a Windows checkout
produced `\r\n` escapes inside the logo string that the committed,
Linux-generated `theme.json` did not carry — and `test/theme/tebin-in-sync.test.ts`
exists precisely to fail on that kind of drift.

It surfaced only when phase 2 was merged into `main` locally and the full
suite re-run on the merged tree: the merge itself touched nothing about
either file, but the checkout that came with it did, and the in-sync test
failed as designed. No code review of this branch could have caught it —
the diff phase 2 shipped was clean on its own; the defect was in what the
repository's line-ending configuration did to files phase 2 didn't touch,
which only integration exercises.

Fixed at both ends, because either alone leaves a gap: `.gitattributes` now
normalises text to LF for this repository's own checkouts and clones, and
`recolourLogo` in `src/theme/generate.ts` normalises `\r\n` to `\n` on the
SVG it's given before embedding it, so the generator produces the same
bytes regardless of the checkout, export, or editor that handed it the
file. `test/theme/generate.test.ts` feeds it a CRLF copy of the vendored
SVG and asserts byte-identical output against the LF copy — the test that
would have caught this before it ever reached a second machine.

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

## Named work for phase 3

**~~Extract the letterhead's entity/date construction, the way `links.ts` was
extracted.~~** *Found and closed before phase 3 needed it.* `src/render/docx.ts`'s
`firstPageHeader` and `src/render/html.ts`'s `firstPageHeader` built the
document's own entity and date identically: the same `[entity, date]` pair,
the same filter for absent and empty values, the same "the first line gets
5pt above it" rule, and the same comment explaining why the two sit in the
muted column beside the letterhead. It was copied byte-for-byte from one
file to the other.

This was precisely the class of shared decision `src/render/links.ts` exists
for — a rule about *what a document means* that every renderer must answer
the same way, as opposed to a rule about how one format draws it. Two copies
of it was two places for the answer to drift, and the drift would have been
invisible until someone compared a PDF and a .docx of the same document side
by side.

The decision now lives in `src/render/letterhead.ts`: `letterheadDocLines`
(the filtered, ordered `[entity, date]` pair) and
`LETTERHEAD_ENTITY_DATE_GAP_PT` (the 5pt figure both renderers spend in
their own unit). Each renderer kept only its own drawing — html.ts a `<div>`
per line reading the shared gap into its CSS, docx.ts a `Paragraph` per line
reading the same constant into a DXA `spacing.before`. Both were byte-checked
unchanged against a pre-refactor build of the kitchen-sink fixture, PDF and
DOCX, `plain` and `tebin` themes, before this was called done; the
human-approved baseline images in `test/baseline/local-only-pixels.test.ts`
did not move. `test/render/letterhead.test.ts` now covers the shared rule on
its own, the way `test/render/links.test.ts` covers `links.ts`'s.

## What the agreement test still cannot see

`docs/superpowers/notes/2026-08-12-phase-1-residuals.md` tracks this list;
phase 2 closed two of its four items for DOCX (inline emphasis, link
targets), and table alignment was closed for DOCX after phase 2 the same
way: a small extractor reading `w:jc` off each cell's paragraph, compared
against the IR's per-column `align`, broadcast down every row so a value on
the wrong column fails. PDF text extraction still carries no alignment, so
the PDF half of this gap remains, the same shape as inline emphasis.

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
  verbatim in `test/agreement/agree.test.ts`, `test/baseline/kitchen-sink.test.ts`,
  and (since `ci-local-baselines` split the byte-compared pixel checks out
  of that file) `test/baseline/local-only-pixels.test.ts`. Three places to
  keep in sync if pdf.js's worker-reset requirement ever changes.
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
- Three of the minors first parked here were fixed before the branch
  merged: the horizontal-rule paragraph now carries `keepNext` (html.ts's
  `hr{ break-after: avoid; }`), table rows carry `cantSplit` (its
  `tr{ break-inside: avoid; }`), and inline code is set at 0.92× the body
  size (its `code{ font-size: … }`). Each is a rule html.ts states with its
  reasoning written down, and docx.ts already cites `// html.ts: …` beside
  every spacing constant it copied — the convention was established, it had
  simply not been applied to these.
- Still parked, and judged not worth a fix this phase: `styles.xml` gives
  every custom style `basedOn: 'Normal'` though no `Normal` style is
  defined, making that inheritance a no-op; the relationship-integrity test
  passes vacuously if it finds zero `r:id` attributes; and
  `td{ vertical-align: top; }` has no Word counterpart either.
  (Table cells not carrying html.ts's `th,td{ padding: 4pt 6pt; }` was
  parked alongside these for the same reason — moving table geometry felt
  like a deliberate change, not a merge-eve one — but a person opening the
  rendered .docx afterward found the gap read worse on the page than the
  numbers suggested, and asked for it. `table()`'s `cell()` now sets
  `margins: { top: 80, bottom: 80, left: 120, right: 120 }` DXA, matching
  html.ts's rule exactly; see `test/render/docx.test.ts`'s "gives table
  cells the same internal margins html.ts paints".)
- This list previously claimed an unused `IParagraphOptions` type import
  survived in `src/render/docx.ts`. It is used — `runningHeader` types its
  `alignment` parameter as `IParagraphOptions['alignment']`. The claim is
  removed rather than corrected in place: a note whose purpose is keeping
  the record honest cannot afford to carry a false entry of its own, and
  the finding was never true, so there is nothing to record but its
  withdrawal.

## Not a defect, but it will look like one

**The Word and PDF renderings of the same document paginate differently, on
purpose.** Measured on this machine, rendering the kitchen-sink fixture with
the `tebin` theme: the PDF is 2 pages, the Word document is 1. This is not
drift between the two renderers producing the same layout by two different
routes — it is the direct, intended consequence of a design decision
`src/render/docx.ts`'s `firstPageHeader` already states its own reasoning
for: Chromium renders a `@page` header template in a context with none of the
document's stylesheet, so the PDF's letterhead has to live in the body flow,
consuming space from the first page's content area the way any other block
does. Word has no such limitation, so its letterhead moves into an actual
page header — space the body flow never sees at all. The same content is
therefore laid out into a shorter first page in the PDF and a taller effective
first page in Word, and on a document sized close to a page boundary that is
enough to change the page count.

Recorded here because two page counts for one source document is exactly the
shape of thing a future reader opens both outputs, notices they differ, and
files as a bug — without the reasoning in front of them, "the PDF is 2 pages
and the .docx is 1" reads as a rendering bug even though it is what asking two
different engines to solve the same letterhead problem was always going to
produce.

## Clean first page (`pdf-clean-first-page` branch)

Page one no longer carries Chromium's running header — it duplicated the
document title (once as the header, once as the `<h1>` immediately below
it) on every document. `src/render/pdf.ts`'s `renderPdf` now renders the
same HTML twice against one Chromium page (real header template, then an
empty one) and stitches page 1 from the empty-header render onto pages
2..N from the real-header render, via `pdf-lib`. The two renders paginate
identically — `headerTemplate` never reaches the body's layout box — which
is what makes taking page 1 from one and the rest from the other safe; see
`docs/superpowers/notes/2026-08-12-clean-first-page-spike.md` for the
measurement. `RUNNING_HEADER_PT`, the constant that used to reserve extra
top-margin band for the header, is gone entirely: a sweep (0, 4, 8, 12pt,
real ink from a decoded raster, not pdfjs coordinates) found the header's
own ink sitting at a fixed offset from the page's physical top regardless
of the margin it was given, with a 33pt gap to the body's first line even
at zero extra band. The top margin is now just the theme's own
`marginPt`, on all four sides.

**The rendered PDF is about 29% bigger than before this branch** — measured
on the owner's real document (`9.1_external_assessment_reports.md`,
`tebin` theme): 25,110 bytes on `main` (single render, `normalizePdfDates`
patching two date fields in place) versus 32,439 bytes with the stitch. The
cause is not the extra render pass itself — a lone stitched render of the
kitchen-sink fixture came out *smaller* than a lone unstitched one in an
earlier check, because `pdf-lib`'s writer recompresses more densely than
Chromium's own incremental layout — it is that `copyPages` across two
separate source `PDFDocument`s does not deduplicate identical embedded font
subsets: the fonts used on page 1 get embedded a second time even though a
byte-identical copy already arrived via the pages-2..N source document (see
the spike note's Q3). Nothing is lost, nothing is wrong; a document with
more pages, where the duplicated page-1-only subset is a smaller share of
the total, would show less growth than this 3-page fixture did. No dedup
was attempted this branch — it would mean walking both source documents'
font objects and rewriting one to reference the other's, a `pdf-lib`-level
piece of work closer to phase-3 sized than a numbers-only stitch.

**`pdf-lib` is now a runtime dependency**, promoted from `devDependencies`
because `renderPdf` needs it in production, not only in tests. It adds
roughly 23MB to a consumer's `node_modules` (measured in the spike;
`pdf-lib`'s own `dist/` folder is ~14MB of prebuilt browser/UMD/ES5 bundles
the Node entry point never touches, but npm installs the whole package
regardless). `npm audit --omit=dev` stayed at zero after the move.

**A pathologically long document title will overprint later pages' body
text, with no guard against it.** Chromium does not clip an oversized
header template — proved by forcing a ~1000-character mixed-script title to
wrap onto 7 lines and watching it overlap page 2's own heading (see the
comment above the `margin` object in `src/render/pdf.ts`). No margin value
fixes this: the header grows downward from a fixed point near the page's
physical top no matter how much room it's given, so the only real guard
would be bounding the title itself — not attempted this branch, and no
existing validation in `src/ir/validate.ts` touches title length.

**`normalize-pdf.ts` has no caller left in `src/`.** `renderPdf` now gets
determinism from `pdf-lib`'s `updateMetadata: false` and writes the
document's date back in explicitly via `setCreationDate`/
`setModificationDate`, rather than patching Chromium's raw bytes after the
fact — the regex `normalizePdfDates` uses cannot reach `pdf-lib`'s output
anyway (different date format, and the fields it targets are compressed
into object streams a plain-text search can't see). The file was not
deleted: it carries a measured explanation of Chromium's own date-writing
behaviour that has value independent of whether anything currently calls
it, and removing it is the owner's call, not this branch's.

## Before publishing

`npm audit --omit=dev` reports zero vulnerabilities at the end of this
phase, unchanged from phase 1's finding. `docx` and its transitive
dependencies (`jszip`, `nanoid`, `hash.js`, `xml`, `xml-js`) added nothing to
that count. The dev-dependency count from phase 1's note was not re-checked
here; it is a publish gate, not a merge gate.
