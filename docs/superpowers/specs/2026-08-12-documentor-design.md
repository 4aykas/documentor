# documentor — design

Date: 2026-08-12
Status: approved, ready for planning

## What it is

A tool that takes a document someone already wrote — Markdown, Word, Excel, or
PDF — and re-issues it as a well-typeset, branded document in any of those four
formats. Two doors onto one engine: a CLI (`npx @tebin/documentor`) and a Claude
Code plugin (`/documentor`) that runs a short interview before invoking the CLI.

Public repository, MIT. The core carries no brand; TEBIN is a theme, and any
other brand plugs in through one JSON file.

## Decisions taken

| Question | Decision |
|---|---|
| Form | CLI core + Claude Code skill wrapping it |
| Existing file | Re-author by default (content → IR → branded output); restyle-in-place is a later mode |
| Output formats (v1) | PDF, DOCX, XLSX, Markdown |
| Look | One universal look; presets only if real use demands them |
| PDF engine | HTML/CSS rendered by headless Chromium |
| Word engine | `docx` npm library — **not** Pandoc |
| Excel engine | ExcelJS — **not** SheetJS |
| Audience | Public GitHub; brand-neutral default theme, TEBIN as a plugin theme |

### Why not Pandoc

Pandoc is not installed on the target machine, and an earlier post-mortem
records what an extra runtime costs here: a Store-managed Python venv burned a
session on an opaque exit code. Routing IR → Markdown → Pandoc → DOCX also
round-trips through a lossier format than the IR. The `docx` library gives full
style control in-process with no external binary. Chromium remains the only
external dependency, installed by one command and reported on by
`documentor doctor`.

### Why not pdf-lib

A sibling internal project's PDF helper is a **form** renderer with a fixed
layout. Flowing prose needs pagination, nested lists, table breaking, and image
placement — all of which CSS already does. Its header ports to roughly forty
lines of CSS.

## Architecture

```
input (.md/.docx/.xlsx/.pdf)
  → ingest/            → IR (Doc)
      ↓
  ← sidecar overrides (report.documentor.json)
      ↓
  → render/
      ├ pdf   HTML+CSS → Chromium → PDF
      ├ docx  docx library
      ├ xlsx  ExcelJS
      └ md    deterministic serializer
```

```
documentor/                       public repo, MIT
  src/
    ingest/    md.ts  docx.ts (mammoth)  xlsx.ts (ExcelJS)  pdf.ts (pdfjs)
    ir/        types.ts  validate.ts
    render/    pdf.ts  docx.ts  xlsx.ts  md.ts
    theme/     resolve.ts  themes/plain/
  themes/tebin/                   example theme, generated from brand tokens
  fonts/arimo/                    embedded into PDFs, Apache-2.0
  bin/documentor.ts               CLI: inspect · build · doctor
  plugin/skill/documentor/        SKILL.md — the interview
  test/
```

`ir/` knows nothing about any file format; every ingester and every renderer
depends on it and never on each other.

### Out of scope for v1

PowerPoint. Restyle-in-place via `office-mcp`. A web interface. Multi-language
editions of one document. Content rewriting (see "The line", below).

## The IR

A flat array of blocks, not a tree — all four renderers are flat (DOCX is a
paragraph sequence, XLSX is rows, PDF is a flow), so a tree would be unwound
four times.

```ts
type Inline =
  | { t:'text'; v:string }
  | { t:'strong'|'em'|'code'; children:Inline[] }
  | { t:'link'; href:string; children:Inline[] }

type Block =
  | { t:'heading'; level:1|2|3; text:Inline[] }
  | { t:'para'; text:Inline[] }
  | { t:'list'; ordered:boolean; depth:number; items:Inline[][] }
  | { t:'table'; head:Inline[][]; rows:Inline[][]; align:('l'|'r'|'c')[] }
  | { t:'image'; src:string; alt:string; widthPt?:number }
  | { t:'code'; lang?:string; text:string }
  | { t:'quote'; paras:Inline[][] }
  | { t:'rule' }
  | { t:'pagebreak' }

type Doc = {
  meta: { title:string; subtitle?:string; date?:string; entity?:string; lang:string }
  blocks: Block[]
}
```

**Anything the IR cannot hold is dropped loudly.** Each ingester returns a
`dropped: string[]` beside the `Doc`, and both `inspect` and `build` print it.
Silent loss is worse than loud loss.

## Theme

One JSON resolved into tokens:

```json
{
  "id": "tebin",
  "colors": {
    "brandOnLight": "#DA291C",
    "brandOnDark":  null,
    "ink":   "#1A1A1A",
    "muted": "#898D8D",
    "rule":  "#E6E6E3"
  },
  "font": { "document": "Arial", "embed": "arimo" },
  "logo": { "svg": "…", "heightPt": 11 },
  "page": { "size": "A4", "marginPt": 48 },
  "letterhead": ["TEBIN Sp. z o.o.", "ul. …"]
}
```

The TEBIN theme is **generated** by a build script from the brand's own
design-token file, never hand-written, so brand and documents cannot drift.
Same discipline a previous project applied to the diagrams in its product UI:
one token source, generated consumers.

`brandOnLight` / `brandOnDark` are a pair from day one even though v1 only ever
prints on white. A previous project's contrast audit established that no single
colour clears AA on both a light and a dark surface, so a single `brand` token
would have to be split later, breaking every theme file already in the wild.
The brand's token source currently publishes only one `--color-brand`, so
`brandOnDark` is `null` in the generated TEBIN theme, and a renderer that needs
it must fail loudly rather than fall back to the light value. Nothing in v1
needs it.

## Renderers

### PDF — Chromium

IR → one self-contained HTML string → Playwright `page.pdf()`.

Self-contained literally: CSS inline, logo as inline SVG, Arimo as a base64
data-URI in `@font-face`. **The renderer fetches nothing.** This follows
directly from an earlier post-mortem on verification harnesses, and from a
previous project's work embedding SVG into Word: the moment a renderer must
fetch a resource, one day it will not, will silently substitute a system font,
and will re-wrap the whole document — visible only to a human who opens the
file.

Arimo, not Arial: the brand's `--font-document` is Arial, which exists on
Windows and macOS and not on Linux or CI. Arimo is Apache-2.0, metrically
identical to Arial (the same line breaks), and covers Cyrillic and Polish. DOCX
still declares `Arial` by name, because Word does not embed fonts and the
recipient has their own.

Header: full on page one — logo left, letterhead quiet grey right, red 28×3
tick plus a hairline rule — ported from that sibling project's PDF header as
CSS. A slim running header on later pages: corner mark, document title,
`N / M`.

Known trap to design around: Chromium renders `headerTemplate` /
`footerTemplate` **in a separate context** — no page CSS, no external resources,
its own scale, a default font size. The running header therefore carries its own
inline styles and its own test. Measured on 2026-08-12 (see "Verified by spike"):
when `margin.top` is smaller than the header, the header does not vanish — it is
drawn **over the body text**, and text extraction cannot see the collision
because both PDFs extract identically. Only a raster can. That single fact
decides the shape of the whole test suite.

The logo SVG is painted **by class through CSS custom properties**, with no
inline `fill`. The theme then recolours it, and — as an earlier project's
generated diagrams established — a solid-black logo means "the stylesheet did
not load", not "the drawing is wrong": a diagnosis readable at a glance.

### DOCX — the `docx` library

Styles (`Heading1`, `Body`, `TableHeader`, …) are built from the theme in code.
Font declared as `Arial` by name. Logo embedded as a 2× PNG from the theme, not
SVG, because Word's SVG support is version-dependent while PNG works everywhere.
Column widths set explicitly in DXA — without them `docx` produces tables that
spread.

### XLSX — ExcelJS

Each `table` block becomes a worksheet; text blocks go into the first sheet as
context above its table. Three things from an earlier post-mortem on styled
spreadsheets are built in from the start, each having already cost days:

- The import is CJS/UMD — take `(mod as {default?}).default ?? mod`.
- **A column `width: 9` is silently dropped.** Widths are read back from the
  produced file, never assumed.
- **Overlapping merged ranges** make Excel prompt *"We found a problem with some
  content… recover?"* on **every** open, for everyone the file was sent to. The
  writer carries a ~15-line assertion that no cell is covered twice.

If the document contains **no table at all**, `--to xlsx` refuses with an
explanation rather than dumping prose into column A. The condition is
deliberately narrow — an earlier post-mortem records that the first
version of a refusal always catches too much.

### Markdown

A deterministic serializer from the IR. It doubles as the cheapest way to see
what the ingester understood: `--to md` is "show me the IR in human form".

## The skill, and why the dialogue is written to a file

Any "assistant that asks" has the same defect: the decisions live in a chat and
vanish with it. The next run produces a different file and nobody knows why. For
a tool that must be reproducible, that is disqualifying.

So **the dialogue materialises as a sidecar file**:

```
1. documentor inspect report.docx
     understood: title, 14 sections, 3 tables, 2 images
     dropped:    4 reviewer comments, a nested date field
     warnings:   heading levels jump H1→H3; table 3 has 11 columns
                 (will not fit A4 portrait)

2. the skill shows this and asks only what changes the output:
     title and date for the header · theme · formats ·
     table 3 — landscape, or narrow it?

3. the answers are written to report.documentor.json, beside the source, in git

4. documentor build report.docx --config report.documentor.json --to pdf,docx
```

That sidecar *is* the reproducibility. It holds header metadata, the theme
choice, and explicit overrides ("promote section 5's heading to H2", "table 3
landscape"). A month later `documentor build` reproduces the file byte for byte
with no dialogue at all; a year later a colleague reads in git why the document
looks the way it does. The skill accelerates filling that file in; it is never a
second execution path — a lesson from an earlier verification post-mortem.

### The line

documentor changes **appearance**, not **text**. Content is carried through
verbatim. Where the skill thinks a sentence is weak it may propose a change, but
the change lands in the sidecar as an explicit `override`, visible in the diff.
Quietly rewriting someone else's document is not "prettier", it is substitution,
and it surfaces at the worst possible moment.

### Output naming

Beside the input, as `report.tebin.pdf` — the theme id in the name, so an input
`report.pdf` can never overwrite itself. `--out` overrides.

## Verification

Four tests the project has from day one, each answering a failure that has
already happened.

**Somebody opened the artefact.** In an earlier internal project, ~500 tests
missed a defect in **every one** of five generated documents, because they
asserted figures were *present* and never that they *fit*. So: a reference
document is rendered into all four formats, the PDF is rasterised to PNG, and
compared against a baseline snapshot — "the page looks like this", not "the
text is in there".

**The renderers still agree.** One document through all four renderers,
comparing what a human would compare: the same headings in the same order, the
same numbers in the same cells. It fails the day one renderer learns a rule the
others have not.

**Read the PDF's own drawing operators.** When the eye is the wrong
instrument — a rule crossing text by a fraction of a millimetre — decompress the
content stream and read `m`/`l` for rules and `Tm` for text baselines. This is
the instrument that settled a rule that appeared to strike through a total in
an earlier project.

**Read the file back** for XLSX and DOCX: sheet order, column widths, fills,
merges, which rows carry which font. This is how the dropped `width: 9` was
found.

**What not to do:** byte-compare rasterised output. PNGs from the same SVG
differ across renderer versions and platforms, and a check that cries wolf stops
being read. Compare snapshots within one platform in CI, or compare structure.

## Reproducibility, mechanically

- Dates come from `SOURCE_DATE_EPOCH`, falling back to the input file's mtime —
  never `Date.now()`.
- DOCX and XLSX zip envelopes are stamped with a fixed mtime; `zipSync`
  otherwise writes different bytes on every run
  (the same spreadsheet post-mortem).
- The font is embedded, not resolved from the system.
- The theme id and version are written into the document's metadata.
- The gate: `build` run twice produces identical bytes, on Linux in CI and on
  Windows locally.

## Environment constraints

**OneDrive.** The repo lives inside a synced OneDrive folder, and an earlier
post-mortem on that setup records what it costs. From the first commit:
`dist/`, the Playwright browser cache, and all scratch files live **outside**
the synced tree. Otherwise the
build one day fails with *"The property 'options.recursive' is no longer
supported"* — which reads as a Node/Astro version incompatibility and is nothing
of the kind; it is OneDrive having turned `dist/` into a cloud placeholder.

**"Easy for everyone."** `npx @tebin/documentor` with no install;
`documentor doctor` names what is missing and the command that fixes it; CI on
Linux, macOS and Windows; a README with before/after images.

## Three details settled

**The visual baseline is a synthetic fixture, not a real document.** The repo is
public, so no TEBIN document can serve as a test fixture. `test/fixtures/
kitchen-sink.md` exercises every block type deliberately: all three heading
levels, a nested ordered list, a five-column table and an eleven-column one, an
image, a code block, a quote, a forced page break, and text in Ukrainian,
Polish and English so font coverage is proven rather than assumed. A fixture
that lacks what the feature is gated on tests nothing
(the same verification post-mortem).

**`inspect` prints Markdown; `--json` prints the machine form.** The Markdown is
for the human reading the terminal; the JSON is what the skill parses. Both are
rendered from one structure, so they cannot disagree.

**A table too wide for the page is handled in three steps, in order:** turn the
page landscape; if it still overflows, scale the table's font down to a floor of
7 pt; if it still overflows, refuse the build and name the table and its column
count. Silently shrinking past legibility is the failure mode worth designing
out — the point of the tool is that the result can be read.

The landscape step arrives with the ingesters that can produce a wide table: it
needs a differently-sized page, not a flag on the block, so until something can
actually draw one the IR carries no `landscape` field.

## Build order

Each phase ends with something usable, and the reproducibility gate applies from
the first one.

1. **Core and the PDF path.** IR types, Markdown ingest, Markdown and PDF
   renderers, the `plain` theme, `build`, byte-identical-twice gate, CI on three
   platforms. This is the whole architecture proven on the shortest path.
2. **Themes and Word.** The theme resolver, the generator that builds the TEBIN
   theme from the brand's tokens, the DOCX renderer, the renderers-agree test.
3. **Spreadsheets and the other ingesters.** XLSX renderer, DOCX and XLSX
   ingest, the read-the-file-back tests.
4. **The interview and distribution.** `inspect`, the sidecar format, the Claude
   Code skill, PDF ingest with its honest "this was reconstructed by guesswork"
   warning, `doctor`, npm and plugin publication, README.

## Verified by spike (2026-08-12)

Everything below was measured on this machine, not assumed. Node v26.2.0,
`playwright-core` 1.62.1, Chromium build 1234 (already installed).

**Reproducibility is achievable and cheap.** Two `page.pdf()` calls a second
apart differ in exactly two places — `/CreationDate` and `/ModDate` — and the
timestamps are fixed width, so overwriting them in the raw bytes keeps every
xref offset valid. Chromium emits no `/ID` array. After that substitution the
two buffers are byte-identical and `pdf-lib` still parses the result.

```
/(\/(?:Creation|Mod)Date \(D:)\d{14}(\+00'00'\))/g  →  $1<SOURCE_DATE_EPOCH>$2
```

**`page.pdf()` margins reject `pt`.** `Failed to parse parameter value: 70pt`.
Only `px`, `in`, `cm`, `mm` are accepted, so the theme's 48 pt margin is passed
as `16.9mm`. The theme keeps points; the PDF renderer converts.

**Font coverage.** `@fontsource/arimo` ships per-subset woff2 with the ranges in
`unicode.json`. Ukrainian is fully inside the `cyrillic` subset (`і` U+0456, `ї`
U+0457, `ґ` U+0491 all fall in `U+0400-045F` / `U+0490-0491`) and Polish inside
`latin-ext`. Six files — `latin`, `latin-ext`, `cyrillic` × 400, 700 — total
~141 KB and cover UA/PL/EN. Inlined as data-URIs with their `unicode-range`,
Chromium embeds them as subsets: `AAAAAA+Arimo-Bold`, `CAAAAA+Arimo-Regular`, …

**Text in the PDF is glyph indices, not characters.** Because those fonts embed
as Identity-H subsets, a substring search for a phrase plainly visible on the
page finds **nothing** — the naive check the verification post-mortem warns
about, reproduced here on the first try. Extraction goes through
`pdfjs-dist/legacy` (which walks `ToUnicode`), never a regex over the bytes.

**The header trap is a collision, not an absence.** With `margin.top` too small,
`KITCHEN SINK` was drawn on top of the document's `<h1>`. Both PDFs — good
margin and bad — extracted *identical text*. The defect exists only in pixels.
This is that same failure in one experiment, and it is why the baseline test
rasterises with `pdf-to-img` and compares images rather than asserting on
strings.
