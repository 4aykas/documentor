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

Pandoc is not installed on the target machine, and `windows-python-traps`
records what an extra runtime costs here: a Store-Python venv burned a session
on an opaque exit code. Routing IR → Markdown → Pandoc → DOCX also round-trips
through a lossier format than the IR. The `docx` library gives full style
control in-process with no external binary. Chromium remains the only external
dependency, installed by one command and reported on by `documentor doctor`.

### Why not pdf-lib

`exp/src/lib/pdf-brand.ts` is a **form** renderer with a fixed layout. Flowing
prose needs pagination, nested lists, table breaking, and image placement — all
of which CSS already does. The header from `pdf-brand.ts` ports to roughly forty
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
  themes/tebin/                   example theme, generated from tebin-style
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
  | { t:'table'; head:Inline[][]; rows:Inline[][]; align:('l'|'r'|'c')[]; landscape?:boolean }
  | { t:'image'; src:string; alt:string; widthPt?:number }
  | { t:'code'; lang?:string; text:string }
  | { t:'quote'; blocks:Block[] }
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
    "brandOnDark":  "#DA291C",
    "ink":   "#1A1A1A",
    "muted": "#898D8D",
    "rule":  "#E6E6E3"
  },
  "font": { "document": "Arial", "embed": "arimo" },
  "logo": { "svg": "…", "heightPt": 11, "cornerMark": "…" },
  "page": { "size": "A4", "marginPt": 48 },
  "letterhead": ["TEBIN Sp. z o.o.", "ul. …"]
}
```

The TEBIN theme is **generated** by a build script from
`tebin-style/themes/tebin-classic/dist/tokens.dtcg.json`, never hand-written, so
brand and documents cannot drift. Same discipline as
`generated-diagrams-in-a-product-ui`: one token source, generated consumers.

`brandOnLight` / `brandOnDark` are a pair from day one even though v1 only ever
prints on white. `accessible-brand-colour` establishes that no single colour
clears AA on both a light and a dark surface, so a single `brand` token would
have to be split later, breaking every theme file already in the wild.

## Renderers

### PDF — Chromium

IR → one self-contained HTML string → Playwright `page.pdf()`.

Self-contained literally: CSS inline, logo as inline SVG, Arimo as a base64
data-URI in `@font-face`. **The renderer fetches nothing.** This follows
directly from `verification-harness-traps` §21 and `svg-clipboard-word-technique`:
the moment a renderer must fetch a resource, one day it will not, will silently
substitute a system font, and will re-wrap the whole document — visible only to
a human who opens the file.

Arimo, not Arial: the brand's `--font-document` is Arial, which exists on
Windows and macOS and not on Linux or CI. Arimo is Apache-2.0, metrically
identical to Arial (the same line breaks), and covers Cyrillic and Polish. DOCX
still declares `Arial` by name, because Word does not embed fonts and the
recipient has their own.

Header: full on page one — logo left, letterhead quiet grey right, red 28×3 tick
plus a hairline rule — ported from `exp/src/lib/pdf-brand.ts` as CSS. A slim
running header on later pages: corner mark, document title, `N / M`.

Known trap to design around: Chromium renders `headerTemplate` /
`footerTemplate` **in a separate context** — no page CSS, no external resources,
its own scale, a default font size — and `margin.top` must exceed the header's
height or the header simply does not appear, with no error. The running header
therefore carries its own inline styles and its own test.

The logo SVG is painted **by class through CSS custom properties**, with no
inline `fill`. The theme then recolours it, and per
`generated-diagrams-in-a-product-ui` a solid-black logo means "the stylesheet
did not load", not "the drawing is wrong" — a diagnosis readable at a glance.

### DOCX — the `docx` library

Styles (`Heading1`, `Body`, `TableHeader`, …) are built from the theme in code.
Font declared as `Arial` by name. Logo embedded as a 2× PNG from the theme, not
SVG, because Word's SVG support is version-dependent while PNG works everywhere.
Column widths set explicitly in DXA — without them `docx` produces tables that
spread.

### XLSX — ExcelJS

Each `table` block becomes a worksheet; text blocks go into the first sheet as
context above its table. Three things from `styled-xlsx-in-the-browser` are
built in from the start, each having already cost days:

- The import is CJS/UMD — take `(mod as {default?}).default ?? mod`.
- **A column `width: 9` is silently dropped.** Widths are read back from the
  produced file, never assumed.
- **Overlapping merged ranges** make Excel prompt *"We found a problem with some
  content… recover?"* on **every** open, for everyone the file was sent to. The
  writer carries a ~15-line assertion that no cell is covered twice.

If the document contains **no table at all**, `--to xlsx` refuses with an
explanation rather than dumping prose into column A. The condition is
deliberately narrow — `verification-harness-traps` §33 records that the first
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
second execution path (`verification-harness-traps` §24).

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

**Somebody opened the artefact** (`verification-harness-traps` §13). In
`tebin-expenses`, ~500 tests missed a defect in **every one** of five generated
documents, because they asserted figures were *present* and never that they
*fit*. So: a reference document is rendered into all four formats, the PDF is
rasterised to PNG, and compared against a baseline snapshot — "the page looks
like this", not "the text is in there".

**The renderers still agree** (§24). One document through all four renderers,
comparing what a human would compare: the same headings in the same order, the
same numbers in the same cells. It fails the day one renderer learns a rule the
others have not.

**Read the PDF's own drawing operators** (§22). When the eye is the wrong
instrument — a rule crossing text by a fraction of a millimetre — decompress the
content stream and read `m`/`l` for rules and `Tm` for text baselines. This is
the instrument that settled the `TOTAL DUE` strike-through in `exp`.

**Read the file back** for XLSX and DOCX: sheet order, column widths, fills,
merges, which rows carry which font. This is how the dropped `width: 9` was
found.

**What not to do:** byte-compare rasterised output (§16). PNGs from the same SVG
differ across renderer versions and platforms, and a check that cries wolf stops
being read. Compare snapshots within one platform in CI, or compare structure.

## Reproducibility, mechanically

- Dates come from `SOURCE_DATE_EPOCH`, falling back to the input file's mtime —
  never `Date.now()`.
- DOCX and XLSX zip envelopes are stamped with a fixed mtime; `zipSync`
  otherwise writes different bytes on every run
  (`styled-xlsx-in-the-browser`).
- The font is embedded, not resolved from the system.
- The theme id and version are written into the document's metadata.
- The gate: `build` run twice produces identical bytes, on Linux in CI and on
  Windows locally.

## Environment constraints

**OneDrive** (`onedrive-sync-dev-traps`). The repo lives inside
`OneDrive - TEBIN`. From the first commit: `dist/`, the Playwright browser
cache, and all scratch files live **outside** the synced tree. Otherwise the
build one day fails with *"The property 'options.recursive' is no longer
supported"* — which reads as a Node/Astro version incompatibility and is nothing
of the kind; it is OneDrive having turned `dist/` into a cloud placeholder.

**"Easy for everyone."** `npx @tebin/documentor` with no install;
`documentor doctor` names what is missing and the command that fixes it; CI on
Linux, macOS and Windows; a README with before/after images.

## Open items for the plan, not for this spec

- Which reference document serves as the visual baseline (needs one real TEBIN
  document with prose, a wide table and an image).
- Whether `inspect` emits its report as Markdown, JSON, or both.
- Table-too-wide policy beyond landscape: shrink font, or split columns across
  pages.
