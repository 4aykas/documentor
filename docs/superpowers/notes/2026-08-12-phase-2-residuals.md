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

**~~A Word list is text, not a list.~~** *Closed on 2026-08-13.* `blocks()`'s
`case 'list'` in `src/render/docx.ts` no longer writes a marker run — every
list paragraph carries a real `<w:numPr>`, and `listNumbering()` builds one
numbering reference per IR `list` block (fragment), each its own
`abstractNum`/`num` pair in `word/numbering.xml`. A fragment's `start`
becomes that pair's own `<w:lvlOverride><w:startOverride>`, so the number a
reader checks at item 4 survives the same way it always did, but now as
Word's own numbering rather than typed text — the list is continuable by
pressing Enter, and Word renumbers it if an item is inserted.

The original plan here was one shared `abstractNum` per format (ordered,
unordered), reused by many `num` instances each carrying its own
`startOverride` — the idiomatic shape a hand-authored `numbering.xml` would
use. `docx@9.7.1`'s public numbering API doesn't reach that shape: a
paragraph's `numbering: { reference, level }` option triggers an *automatic*
concrete-numbering instance whose `startOverride` is read off that
reference's own level-0 config, one `start` per reference — there is no
parameter to give two instances of the same reference two different starts.
Distinct starts therefore need distinct references, which means distinct
`abstractNum`s: one per fragment, not one per format. Reader-visible, this
is the same list — same numId per fragment, same non-restarting behaviour,
same `startOverride` value — it just costs `numbering.xml` a small
`abstractNum` per fragment instead of two large shared ones. Not attempted:
reaching past the public API (building `AbstractNumbering`/`ConcreteNumbering`
directly and injecting them) to get the sharing back — the library gives no
documented hook for it short of rewriting `numbering.xml` after the fact,
which is a bigger and riskier change than the byte count it would save.

Numbering ids are as reproducible as every other part of this renderer:
`abstractNumId`/`numId` come from `docx`'s own per-Document counter
(`uniqueNumericIdCreator`, plain increment, no `Math.random`, no wall
clock), seeded and walked in the same order on every render of the same IR.
See `normalize-docx.ts`'s comment for the check that confirmed this — no
normalization pass was needed for numbering, unlike hyperlink relationship
ids.

`test/render/docx.test.ts`'s "real Word numbering, not written text" cases
cover the shapes that matter: an ordered list starting somewhere other than
1, a nested ordered list whose outer fragment resumes without restarting,
two unrelated ordered lists each with their own start, an unordered list and
its nested unordered list at the right indent levels, and an ordered list
nested inside an unordered one and the reverse — each asserting the actual
`startOverride` value and the level a paragraph's `numId` points at, not
merely that a numbering reference exists. Forcing a fragment's `start` to 1
regardless of the IR (reverted immediately after) failed four of those cases
loudly, with the wrong number quoted in the assertion diff, which is the
shape of failure this change exists to make possible.

**~~Word tables have equal columns.~~** *Narrowed after this note was
written.* The original reasoning was half true and got over-applied: an
*exact* width needs font metrics this renderer doesn't have, but a
*proportion* doesn't — knowing that one column carries more text than
another needs nothing more than counting characters. `src/render/docx.ts`'s
`table()` now gives each column a share of the text column weighted by
`columnDemand()`: the 75th percentile of a column's cell lengths, floored by
its header's own length so a short-but-labelled column (`Currency` over
three-letter codes) doesn't collapse to its data's width. `distribute()`
turns that demand into DXA subject to a floor (~4 characters, so a
one-character column still fits its header) and a 45% ceiling (so one
long-prose column can't flatten every sibling to its floor), water-filling
whichever columns hit a bound and re-sharing the remainder among the rest,
then rounds to whole DXA by largest remainder so the widths still sum to
the text column exactly, byte-identically, on every machine.

This still does two things badly, both left as the next residual rather
than chased further here. A table with only one or two data rows has too
few points for a percentile to smooth anything — a single long cell in a
short table dominates its column just as the rejected longest-cell measure
would have. And the ceiling is a no-op on any two-column table: two columns
each capped below 50% can never sum back to 100%, so `distribute()` drops
the cap there rather than force it onto one column by tie-break, which
means a two-column table with one verbose column has no ceiling at all,
only the other column's floor to keep it from disappearing. Measured on the
kitchen-sink fixture's `Item/Quantity/Unit price/Currency/Total` table (A4,
499.3pt text column): equal split put every column at 99.85pt and wrapped
`Item`'s "Sprocket, extra-long…" cell onto five lines; content-proportional
gives `Item` 224.7pt, `Quantity` 69.75pt, `Unit price` 87.15pt, `Currency`
69.75pt, `Total` 47.95pt, and the same cell wraps onto two.

**~~Word embeds a PNG and nothing else, where HTML and PDF embed any
raster.~~** *Narrowed on 2026-08-13: Word now embeds a JPEG too.* This entry
called a JPEG decoder "a phase-3-sized piece of work"; it is not, because
nothing here needs to decode a JPEG — only to find its start-of-frame segment
and read the two integers in it. What made that worth writing down anyway is
what the walk has to get right: there are several start-of-frame markers and
the common one today is `0xC2` (progressive), not `0xC0`; `0xC4` sits inside
the same range and is a Huffman table, not a frame; and `0xD0`–`0xD7` carry no
length field, so reading one walks into the middle of the next segment. A
reader that handles only the baseline case passes every test written against a
hand-made baseline fixture and sends most real photographs to the placeholder.

The size is now sniffed from the bytes rather than taken from the `data:`
URI's declared type, so a picture labelled PNG that is really a JPEG lands in
the right reader.

*Closed for GIF and BMP on 2026-08-13, and the reason to bother was in this
repository the whole time:* `ingest/docx.ts`'s `sniffRaster` reads PNG, JPEG,
GIF **and BMP** out of a source document, so a `.docx` → `.docx` round trip
was turning a picture Word had carried perfectly well into a placeholder. Both
headers are a fixed offset away — a GIF's logical screen size at bytes 6..9
little-endian, a BMP's in its DIB header — and neither needs the marker walk a
JPEG did. Two details are worth keeping: the GIF measurement is the *logical
screen*, not the first frame, because an animation's frames may be smaller
than the canvas and sit at an offset inside it, and a BMP's height is signed,
where a negative value means top-down row order and not a picture with a
negative height. `docx`'s ImageRun takes `jpg | png | gif | bmp`, so those four
are now exactly what this renderer carries, and Word was asked directly: a
document built with a real 1×1 GIF and a real 2×2 BMP opens over COM with no
repair prompt, both as `wdInlineShapePicture` at the requested 60pt.

**WebP stays a placeholder, and it is the one case where a reader would not
help.** `docx` has no content type for it, so there is nothing to declare in
`[Content_Types].xml`; a VP8-chunk reader would produce a number and still no
way to carry the bytes. Word's own WebP support is version-dependent besides.
The original text follows, because its reasoning is what still applies there.

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

**No visual baseline for DOCX**, and the reason first given here was wrong.
It said Word cannot be driven headlessly on this machine. It can: Word is
installed and answers over COM, invisibly, and has now been used twice —
once to measure the table column widths this note records further up, and
once to ask Word what list numbers it draws, which is what settled the
numbering change. Both were the deciding evidence, and neither would have
been attempted by anyone reading this paragraph.

What stands is the second half. Rasterising a `.docx` through a converter
tests the converter; the agreement test is what stands in for a page image.
But COM reaches the thing itself — `ListFormat.ListString`, a cell's width,
a paragraph's style as Word resolves it — and that is a different and better
instrument than a picture for anything with a number in it. It is
Windows-only, so it cannot join CI; it belongs beside the human-approved
page images as a local check, and it is the right first move whenever a
question is really "what does Word do with this".

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

**~~Emphasis inside a link is flattened in Word.~~** *Closed on 2026-08-13.*
The note said `ExternalHyperlink` takes runs and the renderer passes one, so
the IR could express `[**bold** link](…)` and this renderer could not
reproduce the bold. The fix is the recursion the rest of the file already
uses: a `link: true` flag rides down through `inline()` to the leaves, where
it puts the `Hyperlink` style and the theme's ink on each run, and the
children go through `inline()` like any other span instead of through
`flatten()`. `flatten()` survives with one caller — `columnDemand()`, which
counts a column's characters and has no interest in how they are emphasised.

The case worth the trouble is the one a single run could never express:
half a link's text bold and half not. Word was asked directly rather than
inferred from XML — over COM, the document reports **one** hyperlink whose
`TextToDisplay` is the whole phrase, every character underlined and styled
`Hyperlink`, with `Font.Bold` true across the first two words and false
across the rest. Two runs, one link, both halves still looking like one.

An empty link — no children at all — now falls back to printing its own
target rather than packing a `<w:hyperlink>` with nothing inside it, which is
legal-looking XML that no reader shows and nobody can click. The IR does not
forbid one, so the renderer does not assume it away.

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
boundaries, and nothing closes that.

*The DOCX half is closed as of 2026-08-13.* It had already moved to
per-`<w:tc>` comparison, which catches a value landing in the wrong column;
what it still could not see was the grid itself. `tablesFromDocx` now returns
table → row → cell, and the comparison runs table by table and row by row
against the IR, each cell carrying its own alignment so the text and the
`<w:jc>` cannot be read out of step. Two failures that used to pass are caught
now: a 5×2 grid emitted as 2×5 — the same cells in the same reading order,
verified by making the renderer emit every body row as one long row, watching
the shape assertion fail, and reverting — and a document with a second table
the comparison had nothing to check against. "This fixture has exactly one
table", which the old test left for the next reader to reconstruct from a
confusing failure, is now its first assertion.

## Coverage the DOCX fixtures leave thin

**~~Emphasis and link coverage in the kitchen-sink fixture is thin~~.**
*Closed by dedicated cases in `test/render/docx.test.ts`, not by growing the
fixture.* The original claim: one bold run, one italic run, and one link, all
inside a single paragraph, meant `inline()`'s recursion — the part of the
renderer in `src/render/docx.ts` that walks nested inline spans (the function
was misnamed `emphasisFromIr` in this note; it is `inline()`) — was exercised
on exactly that one shallow case, with emphasis inside a table cell, inside a
heading, inside a list item, and a document carrying more than one link, all
unexercised and unknown.

Six cases now cover what was unexercised, each asserting on the actual
`w:b`/`w:i` run properties or `w:hyperlink`/relationship XML rather than on
text alone. All six passed on the first attempt against the renderer as it
stood — the two apparent failures during this work were both wrong tests, not
a wrong renderer, and are worth recording so the distinction doesn't blur:

- Emphasis inside a table cell (header and body) and inside a heading needed
  nothing beyond straightforward assertions — `inline()` doesn't care what
  calls it.
- Emphasis inside a list item, including a nested one (two `list` blocks, one
  per depth, matching how an ingester splits nesting), first "failed" because
  the test read the indent as `<w:ind .../></w:pPr>` immediately followed by
  the emphasis run. The actual paragraph is `<w:ind/></w:pPr>`, then the
  hand-written bullet run (`• `), *then* the emphasis run — `blocks()`'s
  `case 'list'` writes the marker as its own leading run, which the original
  regex didn't account for. Not a renderer defect; the test's assumption
  about run order was wrong.
- Nesting bold inside italic and italic inside bold both land every `rPr` on
  a single run carrying both `<w:b/>` and `<w:i/>`, and produce the same
  result regardless of which is outermost — `inline()`'s `fmt` is merged by
  key, not by nesting order, so this was expected rather than discovered.
- A document with three links first "failed" because the test's regex
  assumed `r:id` was the first attribute on `<w:hyperlink>`; docx emits
  `<w:hyperlink w:history="1" r:id="…">`, `w:history` first. Once the regex
  stopped assuming attribute order, three links produced three distinct
  `rIdLink*` relationship ids, each resolving to its own `Target`, plural
  and correct. Not a renderer defect; the test's assumption about attribute
  order was wrong.
- Emphasis inside a link's text was flattened away, and the case written
  here pinned that as observed behaviour rather than treating it as a bug —
  which is what made it cheap to notice when the behaviour was fixed. It has
  since been (see "Emphasis inside a link is flattened in Word" above); the
  case now requires the emphasis to survive, and two more beside it cover a
  part-emphasised link and a wholly italic one.

No defect was found in `inline()`, `flatten()`, or the table/heading/list
paths it's reached from. What both "failures" actually were is the finding
worth keeping: over-specific regexes written against an assumed OOXML shape
rather than the shape docx actually emits — the same trap the existing
suite's comments already warn about elsewhere in this file (see the
attribute-order and run-order notes above), now paid twice more while writing
these six cases.

**The `DocH1` branch of `headingsFromDocx` is dead in practice.**
`ingestMarkdown` lifts the document's one `h1` into `meta.title` before any
heading reaches the renderer, so a Markdown source can never produce a
level-1 heading in the DOCX output today. The branch exists for a future
ingester that does not make that promise, or for hand-built IR that skips
`ingestMarkdown` entirely; it has no path to it from the CLI as shipped.

## Small things worth naming

- `resetPdfjsWorkerGlobal` and its explanatory comment had drifted to four
  verbatim copies — `test/agreement/agree.test.ts`,
  `test/baseline/kitchen-sink.test.ts`, `test/baseline/local-only-pixels.test.ts`,
  and `test/render/pdf.test.ts` (added after this note was first written; its
  own comment already named itself "the fourth copy"). All four now import
  `resetPdfjsWorkerGlobal` from `test/helpers/pdfjs-worker.ts`, which carries
  the explanation once, beside the code it explains.
- The CLI test asserting "writes a Word document" now also reads
  `word/document.xml` out of the written file via `docxPart` and asserts it's
  non-empty. An empty or truncated buffer fails there — `JSZip.loadAsync`
  throws on it — rather than passing the way a bare existence check did. It
  still doesn't check the part's content, which is the renderer's own tests'
  job.
- `test/render/normalize-docx.test.ts`'s timestamp assertion now names the
  offending zip entry by its own name rather than its array index — a
  failure reads "`word/document.xml` carries …", not "entry 4 carries …".
  `docxEntryDates` in `test/helpers/docx-parts.ts` was changed to return
  `{ name, date }` pairs to make that possible.
- ~~The per-cell agreement test compares only the first `table` block against
  every `<w:tc>` in the document.~~ *Closed on 2026-08-13* — it walks every
  table, and the "this fixture has one" assumption is an assertion in the
  test rather than something the next reader reconstructs from a confusing
  failure. See the DOCX half of "What the agreement test still cannot see"
  above.
- The link-target comparison in the agreement test now carries the same kind
  of comment its two siblings (emphasis, table alignment) already had: an
  untagged PDF's text extraction reads only a run's text and size, never a
  link's target, so the IR's `href` is the only reference a live
  `Target="…"` in Word's relationships can be checked against — not a third
  opinion being reconciled with two others.
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

**~~A pathologically long document title will overprint later pages' body
text, with no guard against it.~~** *Closed on 2026-08-13.* Chromium does not
clip an oversized header template — proved by forcing a ~1000-character title
to wrap and watching its ink merge with page 2's own heading into one
contiguous band. No margin value fixes it: the header grows downward from a
fixed point near the page's physical top no matter how much room it is given,
so the guard had to bound the title.

It does, in `src/render/pdf.ts`: the header's title is clamped to two lines,
which is what the gap allows — a third would leave 18pt to the body's first
line and a fourth 10.5pt, under the 12pt legibility floor the margin sweep was
already judged against. Two facts came out of the measurement and are worth
keeping: `-webkit-line-clamp` does *not* clip in Chromium's header
sub-document (it adds the ellipsis to line two and paints a third line anyway),
and giving that `<span>` any non-`visible` overflow changes how the flex row
stretches it, moving an ordinary header a fraction of a point — which
`test/baseline/local-only-pixels.test.ts` caught, exactly as it exists to. So
the clamp is applied only above a title length that could plausibly need it,
and every title short of that gets the identical unstyled span it always got.

What remains, deliberately: a clamped title is cut off mid-glyph with no
ellipsis. "Clipped" was the property worth buying; "tidy" was not, and
`src/ir/validate.ts` still says nothing about title length.
`docs/superpowers/notes/2026-08-13-header-bound-repro.md` holds the raster
measurements.

**~~`normalize-pdf.ts` has no caller left in `src/`.~~** *Deleted on
2026-08-13,* with its test. Tested, exported, shipped in `dist`, and reachable
from nothing — a module in that state reads as load-bearing to everyone who
finds it, which is the cost the entry below was weighing against keeping its
measurement. The measurement is kept here instead, where it costs nobody a
wrong assumption:

> Measured 2026-08-12 on Chromium's own `page.pdf()`: two runs of the same
> page differ in exactly two places, `/CreationDate` and `/ModDate`. Both are
> fixed-width (`D:` + 14 digits + `+00'00'`), which is what made substituting
> them in the raw bytes leave every xref offset valid — byte-identical output
> for one regex rather than a PDF rewrite. Chromium emits no `/ID`.

That shape is Chromium's, not `pdf-lib`'s, and the difference is the whole
reason the instrument stopped applying — `docs/superpowers/notes/2026-08-12-clean-first-page-spike.md`
records the rest: `pdf-lib` writes a bare `Z` suffix of a different width and
compresses the `/Info` dict into an object stream where no plain-text regex
can see it. `src/render/normalize-docx.ts`'s header comment still contrasts
itself with the in-place approach, which is a description of a technique and
survives the file it was named after.

The original entry follows, because it is the reasoning the deletion answers.

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
