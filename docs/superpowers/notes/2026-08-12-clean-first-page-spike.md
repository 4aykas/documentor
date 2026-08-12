# Clean first-page spike

Date: 2026-08-12

The measurement the "clean page one" design needs before it is built: whether
two Chromium renders of the same HTML (real header template vs. an empty one)
paginate identically, whether stitching page 1 from one and pages 2..N from
the other with `pdf-lib` is deterministic, what it costs, and what a negative
`margin-top` on the first-page letterhead actually does. **Measurement only —
nothing under `src/` or `test/` changed.**

Everything below was run on this machine. Where something could not be
measured it says so.

## Versions

| | |
|:--|:--|
| Node | v26.2.0 |
| npm | 11.13.0 |
| `playwright-core` | 1.62.1 |
| `pdf-lib` | 1.17.1 (already a devDependency) |
| `pdfjs-dist` | 4.10.38 |

```
node --version
npm --version
node -p "require('./node_modules/playwright-core/package.json').version"
node -p "require('./node_modules/pdf-lib/package.json').version"
```

## 1. Do the two renders paginate identically?

Yes. Built the kitchen-sink fixture's HTML once via `buildHtml` (the same
call `renderPdf` makes), opened one Chromium page, and called `page.pdf()`
twice against that same page with identical `margin` (top =
`marginPt + RUNNING_HEADER_PT`, same as production) — once with a real
header template, once with `headerTemplate: '<span></span>'`.

```
real header page count  : 2
empty header page count : 2
page counts equal       : true
page 1 body-text equal: true
page 2 body-text equal: true
ALL PAGES BODY-EQUAL: true
```

Body text was compared with `pdf-text.ts` after stripping each render's own
header text (the repeated title and the `N / M` counter — expected to differ
between the two by design). Every remaining glyph run matched. This confirms
the premise the whole design leans on: **the header template does not
influence where Chromium breaks the body**, at least for identical margins.
That is expected — `headerTemplate` renders in Chromium's own header
box, outside the body's layout box entirely — but the alternative (some
shared reflow pass) would have killed the design outright, so it was worth
checking rather than assuming.

Script: `q1-pagination.ts` in the scratchpad, run with
`npx tsx q1-pagination.ts`.

## 2. Is stitching deterministic?

**Not with `PDFDocument.create()`'s defaults — deterministic once
`updateMetadata: false` is passed to every `PDFDocument.create()` and
`PDFDocument.load()` call in the stitch.**

First pass, with `pdf-lib` used exactly as its README shows (no options):

```ts
const empty = await PDFDocument.load(emptyBuf);
const real = await PDFDocument.load(realBuf);
const out = await PDFDocument.create();
const [p1] = await out.copyPages(empty, [0]);
out.addPage(p1);
const rest = await out.copyPages(real, [1 /* .. n-1 */]);
for (const p of rest) out.addPage(p);
const bytes = await out.save();
```

Two calls, 1.1s apart: **not** byte-identical (`Buffer.compare !== 0`).
Diffing the two documents' indirect objects (`context.enumerateIndirectObjects()`,
comparing `.toString()` per object) isolates it to exactly one object — the
document's own `/Info` dict:

```
--- DIFFERS: 3 0 R ---
A: << /Producer <FEFF...pdf-lib...> /ModDate (D:20260812124058Z)
      /Creator <FEFF...pdf-lib...> /CreationDate (D:20260812124016Z) >>
B: << /Producer <FEFF...pdf-lib...> /ModDate (D:20260812124058Z)
      /Creator <FEFF...pdf-lib...> /CreationDate (D:20260812124017Z) >>
```

**This is not the project's existing instrument's problem to fix, and it
cannot fix it as written.** `normalize-pdf.ts`'s regex matches
`/(?:Creation|Mod)Date \(D:)(\d{14})(\+00'00'\))` against the raw PDF bytes.
Two things make that regex blind here: `pdf-lib` writes no `+00'00'` suffix
(`D:20260812124016Z` — bare `Z`, different width), and by default `pdf-lib`
groups most indirect objects — including this one — into a compressed
`/ObjStm` (object stream), so `/CreationDate` never appears as literal ASCII
in the saved bytes at all. A plain-text regex over the buffer finds nothing
to substitute even where the field does exist.

The actual source: `PDFDocument.prototype.updateInfoDict` (called from the
constructor whenever the `updateMetadata` option is true, which is the
default for both `.create()` and `.load()`) always calls
`this.setModificationDate(new Date())`, and sets `CreationDate` to `new
Date()` whenever the document has no `/Info` dict yet — true for a fresh
`PDFDocument.create()`. `pdf-lib`'s own `PDFContext.rng` (`SimpleRNG.withSeed(1)`)
is deterministic, so this `new Date()` call is the only variable input to the
whole stitch when `pdf-lib`'s own object-copying is otherwise pure — see
below.

Fix: pass `{ updateMetadata: false }` to `PDFDocument.create()` **and**
both `PDFDocument.load()` calls (a first attempt that passed it only to
`.save()` — which has no such option — silently did nothing; `.save()`'s
options are `{ useObjectStreams, addDefaultPage, objectsPerTick,
updateFieldAppearances }`, not `updateMetadata`). With that:

```
updateMetadata:false -> byte identical: true 51303 51303
```

Verified twice, 1.1s apart, and confirmed by re-diffing every indirect
object between the two outputs — zero differences. **The resulting stitched
PDF carries no `/Info` dict at all** (`getProducer()`, `getCreationDate()`,
`getModificationDate()` all return `undefined`), because a fresh
`PDFDocument.create({ updateMetadata: false })` never populates one and
`copyPages` only copies pages, not document-level `Info`.

**Answer to the "does the existing instrument still apply" question: no.**
`normalize-pdf.ts` is not needed on the stitched output and would not work
on it even if invoked — the fields it targets don't exist in the stitch's
output at all once `updateMetadata: false` is used, and even without that
option the fields are wrong-shaped and compressed out of a plain-text
regex's reach. The correct instrument for the stitch step is the
`updateMetadata: false` option, not a post-processing pass.

Scripts: `q2-stitch.ts` (produces both PDFs, both stitch variants, and the
byte comparison), `q2b-diff-objects.ts` (per-object diff), `q2c-info.ts`
(reads back `/Info` fields) — all in the scratchpad.

## 3. Does the stitched file survive?

**Text**: identical per page to the single-render output. `pdf-text.ts`
against the stitched buffer and against a plain single (real-header) render
produced matching text for both pages (compared with the header/counter
excluded, same as Q1).

**Fonts**: nothing lost. Walking every indirect object in both PDFs
(`pdf-lib`, filtering `PDFDict` with a `/BaseFont` key — a raw-bytes regex
found none, because these too live inside a compressed `/ObjStm`, same as
the `/Info` dict) gives:

```
real.pdf    -> font count: 10  (all /Arimo-Bold or /Arimo-Regular subsets)
nometa1.pdf -> font count: 14  (same subset tags, all Arimo)
```

14 rather than 10 because page 1 and pages 2..N come from **two separate
source documents**, each with its own independently-subsetted embedded
fonts — `pdf-lib`'s `copyPages` does not deduplicate identical font programs
across two different source `PDFDocument`s, so the fonts used on page 1
(subsets `CAAAAA`/`EAAAAA`) get embedded a second time even though
byte-identical copies already arrived via the other source document. Nothing
is dropped; it is duplicated. All names still match `/Arimo/`.

**Size**: `real.pdf` (single render, running header on every page) is
56,613 bytes; the stitched, no-metadata output is 51,303 bytes — smaller,
not larger, despite the font duplication above. This is not the apples-to-
apples number it looks like: `pdf-lib`'s writer recompresses everything into
its own object streams (denser than Chromium's incremental-PDF layout) and
the stitch carries no `/Info` dict, no `/ID`, and no Skia producer strings.
The two numbers aren't measuring the same structural approach, so "stitching
costs N% more" cannot be read off this comparison — only "stitching survives
without inflating unreasonably."

**Rasterisation**: `rasterPages` (the project's own `pdf-to-img` helper)
produced 2 PNGs from the stitched file with no error, sizes 201,779 and
44,531 bytes — in the same order of magnitude as any other page from this
fixture. Visual inspection (read back as images) shows page 1 with **no
running header** and the full letterhead, tick rule, title, and body intact;
page 2 with the running header (`Kitchen Sink — Зразок — Wzorzec`, `2 / 2`)
present and correctly numbered against the *real* render's own page count.
Nothing is visibly broken, clipped, or missing a glyph.

Script: `q3-verify.ts` + `q3b-fonts.ts` in the scratchpad; rendered pages
saved as `stitch-page-1.png` / `stitch-page-2.png` there (visually checked,
not committed anywhere).

## 4. What does the negative margin actually do?

**Correction, added after implementation and owner review (2026-08-12): the
"no clipping" conclusion below is wrong, and wrong because of the
instrument, not the mechanism.** In paged media the body is clipped to the
page's content box; the top margin belongs to the header/footer boxes, not
to the body. A negative `margin-top` on an element inside the body does not
reclaim that band — it pushes the element into a region Chromium's printer
never paints. The actual rendered output (both themes, checked by eye after
implementing this) confirms it: on the TEBIN theme the logo and the first
two letterhead lines are gone and `www.tebin.pro` is clipped mid-glyph; on
the plain theme (no logo, no letterhead lines) the brand tick and its
hairline are gone too, because those were the only elements left in the
pushed-up block to lose.

The check below ("no clipping") only read text items' baseline `y` back
through `pdfjs-dist` and confirmed they had shifted by the expected 26.2pt.
That is true, and it is the wrong question: **a clipped element still has a
layout position and pdfjs still reports its coordinates** — clipping is a
paint-time decision, not a layout-time one, so a coordinate-only read cannot
see it at all. The right check would have been rasterising the page and
looking at it, which is exactly what the two `__actual__` baseline images
did once this was actually wired into `html.ts` and run through the real
renderer. Recorded here rather than deleted, because a claim that was
checked by the wrong instrument and left standing is worse than one that was
never checked — the next reader needs to see both what was measured and why
it didn't answer the real question.

**Conclusion: negative top margin on `.sheet-head` is not a viable way to
raise the letterhead into the reserved header band.** The rest of this
section is preserved as originally written, for the record of what was
actually measured (and what it didn't cover).

Built the kitchen-sink and the DD-report fixture's HTML the normal way, then
produced a second copy with one extra rule appended before `</head>`:

```html
<style>.sheet-head{ margin-top: -26pt; }</style>
```

(`-RUNNING_HEADER_PT`, injected as a plain string edit on the `buildHtml()`
output — not a change to `html.ts`.) Rendered both variants with the
project's real header template and the production margins, then read page 1
back with `pdfjs-dist`, bucketing text items by rounded baseline `y` and
comparing where each labelled row landed.

**Kitchen sink**, title row:

```
base: y=710.9   "Kitchen Sink — Зразок — Wzorzec"
neg : y=737.1   "Kitchen Sink — Зразок — Wzorzec"
```

**DD-report** (`9.1_external_assessment_reports.md`), title row:

```
base: y=710.9   "DD Item 9.1 — Assessment Reports by External Parties"
neg : y=737.1   "DD Item 9.1 — Assessment Reports by External Parties"
```

Both fixtures move by **26.2pt** — `RUNNING_HEADER_PT` (26pt) to within
pdfjs's own rounding noise (page height reported as 842.88pt rather than the
theme's 841.89pt A4 constant; the 0.2pt is that discrepancy, not a defect in
the CSS). The running header itself — the row at `y=821.9` in both variants
— does not move, as expected: it is Chromium's own header-box content, laid
out independently of the body.

No clipping: the shifted title still sits well below the physical page top
(`y=737.1` vs. page height `842.88` — 105.8pt down from the edge), and no
new text appeared above the header row in either render.

Page count and page-1 content, both fixtures: **unchanged** — 2 pages before
and after, same text on page 1 either way. For these two fixtures, 26pt of
extra room at the top wasn't enough to pull an extra line onto page 1. That
is a property of these fixtures' specific content, not a guarantee: the
design note in the prompt ("this changes pagination, but consistently,
because it is still a single layout") is the right framing — a document
whose first heading sits close to the fold could gain a line, and every page
after would then reflow starting from that new break point, identically in
both the real-header and empty-header renders since both use the same HTML.
That consistency was the property worth confirming, and it held: the same
negative-margin HTML fed to both header-template variants (Q1's harness,
with the `-26pt` rule added) still paginated identically between the two —
not re-run as a separate script, but a direct consequence of Q1's result
plus this section's result, since Q1 already showed the header template
never affects body layout regardless of what the body layout is.

Script: `q4-negative-margin.ts` (renders both variants, both fixtures) +
`q4b-ypositions.ts` (the y-position dump) in the scratchpad.

## 5. Cost

**Install size.** `pdf-lib` is already a `devDependency`; nothing was
installed for this spike. Its footprint if promoted to a runtime
`dependency`:

```
du -sh node_modules/pdf-lib        -> 23M
du -sh node_modules/@pdf-lib        -> 1.6M   (@pdf-lib/standard-fonts, @pdf-lib/upng)
du -sh node_modules/pako            -> 849K
npm view pdf-lib dist.unpackedSize  -> 19,461,112 bytes (~18.6M, the published package)
```

`tslib` is a `pdf-lib` dependency too, but it is already installed (the
`docx` dependency chain pulls it in at 1.14.1), so it adds nothing further.
Most of `pdf-lib`'s own 23M is `dist/` (14M) — prebuilt browser/UMD/ES5
bundles the Node build never touches, but npm installs the whole package
regardless of which entry point is used.

**Audit.**

```
npm audit --omit=dev
found 0 vulnerabilities
```

Full `npm audit` (dev included) reports 7 findings (3 moderate, 2 high, 2
critical) — none of them mention `pdf-lib` in the advisory path; they are
the same pre-existing `esbuild`/`vite`/`vitest`/`tar` dev-only findings the
docx spike already recorded. Moving `pdf-lib` from `devDependencies` to
`dependencies` would not change `npm audit --omit=dev`'s zero.

**Render wall-clock.** Timed with a warmed, already-launched `Browser` (the
way both the CLI and every test file use `renderPdf` — comparable to
production batching, not a cold-start number), 5 single renders and 5
back-to-back double renders of the kitchen-sink fixture:

```
single render times (ms): 359 335 335 330 340   -> avg 339.7
double render times (ms): 666 780 727 713 714   -> avg 720.1
implied per-extra-render cost (ms): 380.4
```

So a second render costs roughly what the first one does — about 340–380ms
per document on this machine, dominated by `setContent` +
`document.fonts.ready` + `page.pdf()`, all of which double when the render
doubles. **Stitching itself is cheap by comparison** — 5 runs of
`PDFDocument.load` (×2) + `copyPages` (×2) + `PDFDocument.create` + `save`
averaged 40.0ms (range 18–61ms).

Scripts: `q5-timing.ts`, `q5b-stitch-timing.ts` in the scratchpad.

## 6. What surprised me, and a cheaper alternative considered

**Surprises:**

- `pdf-lib`'s own randomness is seeded and deterministic
  (`PDFContext.rng = SimpleRNG.withSeed(1)`, used for form-field and
  font-name suffixes) — the *only* non-determinism in a stitch comes from
  the info-dict timestamp `updateInfoDict()` writes unconditionally at
  construction time when `updateMetadata` (default `true`) is set. That is
  a much narrower problem than the DOCX spike's (nanoid relationship IDs,
  zip timestamps, three separate causes) — one boolean option, not a
  post-processing pass.
- The option has to go on `.create()`/`.load()`, not `.save()` — `.save()`
  silently accepts and ignores an `updateMetadata` key since it isn't part
  of its options type in this version, which is exactly the kind of mistake
  a plan written from memory rather than measurement would ship.
- Both the `/Info` dict and every `/BaseFont` name are invisible to a
  plain-text regex over the saved bytes by default, because `pdf-lib`
  compresses indirect objects into `/ObjStm` streams. Any future
  instrumentation on a `pdf-lib` output (this project's existing
  `normalize-pdf.ts` pattern, or a similar one) has to walk the object graph
  through `pdf-lib`'s own API, not grep raw bytes — the DOCX spike's
  "rewrite via the library's structure, not the file's text" lesson applies
  here too, for an unrelated reason (compression, not deflate-size drift).
- `copyPages` across two different source `PDFDocument`s does not
  deduplicate identical embedded font programs. Not a correctness problem
  (nothing is dropped, text and rasterisation are correct) but worth
  knowing before sizing this at scale on documents with heavier embedded
  fonts or images used across both renders.

**A cheaper approach, considered and rejected for now:** print the running
header into the body's own flow via CSS `position: fixed` inside an
`@page`-scoped element instead of `headerTemplate`, using a CSS counter for
the page number and `break-before: page` combined with `:first` selectors
to suppress it on page 1. **Not pursued, and not fully measurable without
building it**, because Chromium's print engine does not support
`counter(page)` / `@page :first` margin-box content in `page.pdf()` the way
a browser's own print preview partially does — `headerTemplate` is the only
place Chromium exposes `pageNumber`/`totalPages` tokens at all (see
`runningHeader()`'s own comment: the header context has no access to the
document's stylesheet, which already rules out reusing body CSS for it
directly). A `position: fixed` element inside the body is not repeated by
Chromium's paginator per printed page at all — `position: fixed` in
`page.pdf()` output pins to the first page only, not every page, so this
was not a promising direction and building a throwaway prototype to
confirm that felt like it would have cost more than the two-render
approach it was trying to avoid. **Not measured beyond this reasoning** —
if it matters, it is worth five minutes of its own spike before being ruled
out on paper alone rather than in code.

**Recommendation:** the two-render-and-stitch design works as specified.
Pagination is stable across the two header-template variants (Q1),
stitching is deterministic with one option (`updateMetadata: false` on
every `pdf-lib` document object in the stitch — not the existing
`normalize-pdf.ts` instrument, which does not reach `pdf-lib`'s output),
the result survives text extraction, font embedding, and rasterisation
checks (Q3), and the cost is a second render (~340–380ms) plus a stitch
(~40ms) per document, with `pdf-lib` adding ~23M to `node_modules` if
promoted to a runtime dependency and no new audit findings. Nothing here
argues for a cheaper alternative for the stitch itself; the design is not
over-engineered for what it buys.

**Q4's negative-margin recommendation does not stand — see the correction at
the top of section 4.** Reading text coordinates back through `pdfjs-dist`
cannot detect clipping (clipped content still has a layout position), and
the actual rendered output clips the letterhead, tick and hairline instead
of raising them. The mechanism for reclaiming the header band on page one is
still an open question; it is not the negative margin.

## Not measured

- Byte identity or timing on a non-Windows platform, or under a different
  Node major.
- Behaviour on a document long enough that the negative margin pulls an
  extra line onto page 1, changing the page-1/page-2 split — the two
  fixtures used here didn't happen to sit close enough to that boundary.
- Whether other PDF readers (Acrobat, browsers other than the Chromium this
  project already depends on) render a `pdf-lib`-stitched, `/Info`-less PDF
  without complaint. Only rasterisation via this project's own
  `pdf-to-img`/`pdfjs-dist` path was checked.
- The `position: fixed` / CSS-counter alternative in section 6, beyond the
  reasoning given for not pursuing it — no code was written or run for it.
- Cost of `useObjectStreams` or other `pdf-lib` `.save()` tuning options on
  stitch output size or timing; the default was used throughout.
