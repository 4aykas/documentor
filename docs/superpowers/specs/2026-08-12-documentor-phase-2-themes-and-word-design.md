# documentor phase 2 — themes and Word

Date: 2026-08-12
Status: approved, ready for planning

Phase 2 of the build order in `2026-08-12-documentor-design.md`. The theme
resolver landed early, in phase 1, so what remains is the generator that builds
the TEBIN theme from the brand's own tokens, the DOCX renderer, and the
agreement test that keeps three renderers saying the same thing.

The phase ends with a branded Word document produced by `--to docx`, under the
same byte-identical-twice gate as the PDF.

## What the brand actually publishes

The design system lives in `tebin-style`, reachable as an MCP server and as an
npm package. It carries two themes; the one for documents is **`tebin-classic`**
— mood *print*, `ink #1A1A1A`, `topbar #FFFFFF`. Its token set matches the
example theme in the phase-1 design exactly. The web theme `tebin` is a
different, lighter palette and is not what a printed document should use.

Its licence is split, and the split matters here: **tokens MIT, assets
"© TEBIN — all rights reserved"**. The owner has decided the logo ships inside
this public repository regardless; a `NOTICE` file records that the code is MIT
while the brand assets under `themes/tebin/` are not, so a reader who forks the
repo learns it from the repo rather than from a lawyer.

## The generator

`themes/tebin/.tokens/` holds a vendored snapshot copied out of `tebin-style`:
`tokens.dtcg.json`, `logo-full.svg`, `logo-full.png`. `npm run theme:tebin`
reads only that snapshot and writes `themes/tebin/theme.json`.

Vendored rather than fetched, for the reason the whole project fetches nothing:
a generator that reaches the network cannot run in an offline CI, and the check
that the committed theme still matches its source would be the first thing to
be switched off. Refreshing the brand is an explicit commit that changes the
snapshot, and the diff shows what moved.

The gate is a test that regenerates the theme and requires a zero diff. Editing
`theme.json` by hand therefore fails CI — which is the point of generating it.

### Recolouring the logo is the generator's real work

The published logo already paints by class, but through an embedded
`<style>` element:

```
.cls-1 { fill: #898D8D; }
.cls-2 { fill: #DA291C; }
```

`resolveTheme` refuses exactly this. Phase 1 established that a logo carries no
inline paint in any of its three disguises — attribute, `style="…"`, or an
embedded `<style>` — because inline paint silently beats the class and the logo
stops following the theme with nothing visible to explain why.

So the generator reads that class-to-colour map, matches every colour against
the token set, renames the classes to the semantic `c-brand` and `c-muted`, and
deletes the `<style>` element. `html.ts` already carries `.logo .c-brand` and
`.logo .c-muted` rules, so the recoloured logo works the day it is generated.

A colour that matches no token stops generation and names the colour. Guessing
would reintroduce precisely the drift this whole arrangement exists to prevent.

### What comes from the brand, and what does not

| Theme field | Source | Value |
|:--|:--|:--|
| `colors.brandOnLight` | token `color.brand` | `#DA291C` |
| `colors.brandOnDark` | not published | `null` |
| `colors.ink` | `color.ink` | `#1A1A1A` |
| `colors.muted` | `color.grey` | `#898D8D` |
| `colors.rule` | `color.grey-lighter` | `#CDCDCE` |
| `font.document` | `font.document[0]` | `Arial` |
| `page`, `type` | not published | theme author's, same as `plain` |
| `letterhead` | not published | the owner's, below |
| `logo` | `logo-full.svg` + `logo-full.png` | recoloured SVG, PNG verbatim |

`rule` takes the real `grey-lighter` token rather than the `#E6E6E3` that
appeared in the phase-1 design sketch. That value exists in no brand source, and
an invented colour in a generated file is a lie about provenance.

The generated `theme.json` carries a `$generated` block: the snapshot's theme id
and version, and the list of fields that did **not** come from the brand. The
brand pack itself uses this discipline — its `ink` and `topbar` carry an
explicit "not specified in the 2017 brand book" — and a reader of the file
should not have to guess which half is authority and which is taste.
`resolveTheme` ignores the block.

### The line under brandOnLight

`brandOnLight` paints **fills**, and large display type if a theme ever asks it
to: today the tick and the logo. It is not a small-text colour. The 2026-07-30 contrast work on tebin.pro
proved the general case — no single colour clears AA on both a light and a dark
surface, for any hue — and produced a separate `#C7251A` for red text on light.
documentor has no dark surface and needs no second token, but the DOCX renderer
must not reach for `brandOnLight` to colour body-sized text. Recorded here
because the tempting place to break it is a table header.

### The letterhead

Four lines, in this order, for the Polish entity:

```
TEBIN.PRO Sp. z o.o.
Plac Hołdu Pruskiego 9, 70-550 Szczecin, Poland
www.tebin.pro | info@tebin.pro
NIP: 9552562516 | REGON: 521434962
```

One theme, one entity. TEBIN has three legal entities and the other two get
their own themes when a document needs them; the shape already supports it,
since a theme is one JSON file and only these four lines differ.

## The DOCX renderer

`src/render/docx.ts`, built on the `docx` library. Styles — `Heading1`,
`Heading2`, `Heading3`, `Body`, `Quote`, `Code`, `TableHeader` — are constructed
from the theme in code, so the theme remains the single place a colour or a size
is decided. The font is declared as `Arial` by name: Word embeds nothing and the
recipient has their own.

### Word gets Word's headers, not the PDF's workaround

The PDF draws its letterhead in the body flow because Chromium renders
`headerTemplate` in a separate context with no access to the page's stylesheet.
Word has no such limitation, and a DOCX is a thing people edit: a letterhead
sitting in the body flow is shoved down the page by the first paragraph someone
adds, and page two carries nothing at all.

So the section sets different-first-page. The first-page header holds the logo,
the letterhead in muted type on the right, and beneath them the tick and the
hairline. Later pages get a slim running header: the document title, and `N / M`
from Word's own `PAGE` and `NUMPAGES` fields.

The tick and hairline are drawn as a two-cell borderless table — 28pt with a 3pt
brand-coloured bottom border, the remaining width with a 0.75pt border in `rule`
— not as an image. It is the same drawing the CSS makes, in the format's own
terms: nothing scales, and it reads back as structure rather than as pixels.

### The logo is a raster in Word, and does not follow the theme

Word's SVG support is version-dependent, so the theme carries the brand pack's
PNG as well, as a `data:` URI beside the SVG. The theme stays **one file**,
which is the design's own promise about how a brand plugs in.

The consequence is stated rather than discovered: a PNG is not repainted by a
class, so a theme that wants a logo in Word supplies its own raster. There is no
automatic recolour, and a theme that supplies only an SVG gets a Word document
with a letterhead and no mark.

### Blocks

Straightforward, with three decisions worth writing down.

**Tables** carry explicit column widths in DXA. Without them `docx` produces
tables that spread across the page.

**Links** go through `src/render/links.ts` — the same module the HTML and
Markdown renderers ask. A third renderer with its own opinion about
`javascript:` is the exact drift that module was extracted to prevent.

**Images**: a raster `data:` URI is embedded. Everything else — a remote URL, a
relative path, and notably an **SVG `data:` URI** — becomes a visible
placeholder carrying the alt text and where it pointed. Embedding an SVG in Word
means supplying a raster fallback beside it, and rasterising reproducibly is not
something this project can do; the kitchen-sink fixture's image is an SVG data
URI, so this is the fixture's own path, not a corner case. Loud loss over silent
substitution, the same rule the ingesters follow.

## Reproducibility, and why the phase opens with a spike

A DOCX is a zip, and three things in it are candidates for changing between two
runs of the same build: the entry timestamps, the `created` and `modified` dates
in `core.xml`, and `w:docId` in `settings.xml`, which some writers seed randomly.

None of the three has been measured on this machine, and the byte-identical gate
has applied since phase 1. So phase 2 opens with a spike, exactly as phase 1
did: two `Packer.toBuffer` calls, a byte diff, and a written answer to what must
be normalised and how. Its findings go into the implementation plan. The phase-1
spike is what made the PDF path cheap; guessing here would cost the same days it
saved.

## Verification

### The third renderer closes blind spots rather than widening them

The phase-1 residuals note argued that the agreement test should be strengthened
before a fourth renderer lands, because each of its blind spots widens with
every renderer added. DOCX supplies the instrument for three of them:

| Blind spot | Why it existed | What DOCX gives |
|:--|:--|:--|
| Inline emphasis | PDF text extraction carries no weight or style | `<w:b>` / `<w:i>` are structure |
| Table cell boundaries | an untagged PDF has none to read | `<w:tc>` — comparison per cell |
| Link targets | only visible text was compared | the hyperlink is in the relationships |

So `test/baseline/kitchen-sink.test.ts` splits. The comparison logic moves to
`test/agreement/`, as one extractor per renderer producing the same run
sequence, with Markdown as the reference every other renderer is compared
against. PDF is compared on what a PDF can show; DOCX is compared on all three
rows above as well. The baseline image test stays where it is — it answers
geometry, which is a different question.

### Reading the file back

The instrument the design names for DOCX, and the one that found a silently
dropped column width in an earlier project. The DOCX test unzips the produced
package and asserts on: the styles it declares, column widths in DXA, both
header parts and the different-first-page flag, the number of image parts, and
that no relationship id is referenced without being declared.

### The gates that already exist

`build` twice produces identical bytes — extended to cover `--to docx`. The
guardrail greps for wall-clock and network calls apply to the new files by
construction. The link-refusal parity test grows a third renderer.

### What is deliberately not tested

There is no visual baseline for DOCX. Word cannot be driven headlessly here, and
rasterising through a converter would test the converter. The read-back
assertions and the agreement test are what stands in for an eye, and this
limitation is written into the phase's own residuals rather than left for
someone to discover.

## Out of scope

XLSX and the other ingesters (phase 3). The sidecar and `inspect` (phase 4).
The themes for the Irish and Ukrainian entities. Any change to the PDF path
beyond what the agreement refactor touches.
