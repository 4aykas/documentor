# documentor

Take a document somebody already wrote and re-issue it as a well-typeset
one — or, for a commercial proposal, assemble one from a data file and a
template. Re-issuing is still the main thing this tool does; proposals are
the one case where the document does not exist yet.

```bash
documentor build report.md --to pdf
```

The result lands beside the input as `report.plain.pdf`. Pass `--to docx` for
a Word file instead — `report.plain.docx`, built from the same intermediate
representation as the PDF, so the two cannot drift apart:

```bash
documentor build report.md --to docx
```

## Getting it

Not on npm yet. Until it is, install it from the repository — npm builds it as
part of the install, so there is no separate build step:

```bash
npm install github:4aykas/documentor
npx playwright install chromium
npx documentor doctor
```

From a clone, `npm install` and then `npm run documentor -- build report.md`
runs the same code without installing anything.

## What it does

`documentor` builds a small, format-agnostic representation — from a source
document it reads, or, for a proposal, assembled from a data file and a
template — then draws that representation with a theme. The look lives in
one place, so a PDF and a Word file made from the same representation cannot
drift apart.

## What it reads and writes

| from ↓ &nbsp; to → | PDF | Word `.docx` | Markdown | Excel `.xlsx` |
|:--|:--:|:--:|:--:|:--:|
| **Markdown `.md`** | yes | yes | yes | — |
| **Word `.docx`** | yes | yes | yes | — |
| **Excel `.xlsx`** | yes | yes | yes | — |
| **PDF** | — | — | — | — |

This table is about re-issuing a single existing source. Proposals sit
outside it: `documentor proposal` takes two inputs, a data `.json` file and
a `.md` template, and writes PDF, Word or Markdown from the pair — see
"Proposals" below.

Markdown out is not a second design — it is the intermediate representation in
a form a human reads, which makes it the cheapest way to see what an ingester
understood.

Three limits are worth knowing before you rely on them, because all three are
deliberate rather than unfinished:

- **Reading `.xlsx` serves small tabular registers, and refuses the rest.** A
  merge confined to one row is flattened — the value moves to its leftmost
  cell and the flattening is reported by range — because that is what the
  sheet already shows a reader; a merge that spans more than one row is
  refused by name, because a table has no way to express which rows it
  grouped, and flattening one would look right while saying something the
  source did not. So is a sheet past 200 rows or 25 columns, which is a limit
  on what a person reads on paper rather than on what the code can build.
  Expect this to still refuse most working spreadsheets — over a real set of
  68, it read 22. The message names the sheet and the number, so it tells you
  which range to extract and re-issue instead.
- **Reading `.docx` carries paragraphs, headings, lists, emphasis, links, page
  breaks and PNG, JPEG, GIF and BMP images. It does not carry tables** — it
  reports them instead, by size, so a lost table is loud rather than silent.
  Nothing else is silently dropped either: comments, tracked changes,
  footnotes, text boxes and the old letterhead are all named in the run's
  report.
- **A table's columns are sized from their content, by one solver both
  renderers call** (src/render/table-width.ts). Widths are proportional to
  what each column actually carries, with a floor so a one-character column
  is still a column and a ceiling so one verbose column cannot swallow the
  table. The two used to answer this separately — Word computed it, the PDF
  left it to Chromium — and the same register wrapped to a second line in one
  and left a wide unused strip in the other.
- **A table too wide for the portrait text column is printed on a landscape
  sheet of its own**, and only that table: the page turns back for whatever
  follows. "Too wide" means the columns cannot each have a readable minimum,
  not merely that the text wraps. Word has no equivalent — it keeps such a
  table portrait, with the same proportions — so a schedule with a column per
  week is the one place the two documents genuinely differ.
- **Writing Word embeds a PNG, a JPEG, a GIF or a BMP** — the same four reading
  a `.docx` carries, so a `.docx` in gives you every picture back in the
  `.docx` out. A picture needs its natural proportions, and those come from
  reading the file, so anything else becomes a visible placeholder naming what
  it was. That includes SVG, whose Word support is version-dependent and which
  would need a raster shipped alongside it that cannot be produced
  reproducibly, and WebP, which Word's own file format has no content type for.
  The PDF path embeds any raster.
- **A cover page reaches Word intact, except for one measurement it cannot
  compute.** On a cover (`meta.cover: true`) with two or more `rule` blocks,
  both renderers draw the same three zones (see src/render/cover-zones.ts):
  the hairline-bordered panel at the top, the brand's corner mark seated in
  the panel's top-right corner, and the blocks after the last rule pinned to
  the page's bottom margin — in Word through a `w:framePr` text frame, which
  a reader that ignores it simply renders in normal flow. What does not carry
  is the statement band's vertical centring: the PDF gives the band the
  flowing zone's slack through an auto margin, and Word, having no
  page-relative box for growing content, gets a fixed gap above and below
  instead. The band is a little higher on the Word page than on the PDF one.

## Proposals

`documentor proposal <data.json>` assembles a commercial offer from two
inputs: a data file holding the facts of this one offer (project, team,
rates, hours, the sections written fresh each time) and a markdown template
holding the skeleton and the boilerplate. Every sentence in the output comes
from one of the two, verbatim — the command assembles, it does not write.

The budget is computed, never typed: hours × rate per role, summed, printed
as `€ 4 500,00`. A summary line marked `"covers": "budget"` must equal that
total or the build fails quoting both figures. The involvement heatmap is
drawn from the same team array (`{{@heatmap style=scale|numbers|marks}}`,
`scale` by default), and a deliverables register named by `"annex"` joins as
an annex through the spreadsheet reader — with its row cap raised to 2000 for
this one path, because a reference register is searched, not read.

`templates/offer.example.md` is a generic example; a real template carries a
company's own commercial terms and belongs outside a public repository, the
way this repository keeps its own brand book out of git.

**On a cover page (`meta.cover: true`), a template's `rule` blocks lay out
the page.** The first `rule` closes a bordered panel holding the title and
everything above it; the last `rule` opens a foot holding everything below
it — one at the top, one at the bottom, and whatever falls between flows as
ordinary content. No `rule` at all leaves the cover as plain flow, title then
blocks, unchanged from before this existed. Exactly one `rule` gives you a
panel and nothing to pin against, so only the panel appears. Two or more is
what produces all three zones. Word pins the foot to the page bottom too,
through a text frame.

**A blockquote between those rules becomes the cover's statement band** — a
tinted brand panel with the first line set as large display type, dropped
into the middle of the page by giving it the zone's slack, half above and
half below. It exists because the middle of a cover is otherwise empty, and
a page that is a panel, four lines and an address reads as unfinished. Its
text is still the template's own, verbatim: this is a place to put a
sentence, not a sentence documentor writes. Elsewhere in a document — and on
a cover with no rules — a blockquote stays a blockquote. Word draws the same
band, with a fixed gap above and below rather than centred: the PDF centres
it by handing it the zone's slack, and Word has no slack to hand out.

Two more things this refuses rather than fakes. **The corner mark does not
bleed off the PDF's page corner.** The real offers show the brand glyph in
the very corner of the sheet; Chromium clips a page's content to the content
box, and the print margin is where the running header lives, so page content
cannot paint there. An offset large enough to look like a bleed put the glyph
entirely outside the page — and, because the overflow made the layout wider
than the sheet, made Chromium shrink the whole cover about 9% to fit. The
mark is seated in the panel's own top-right corner instead, overlapping
inwards — which is where the real offers put the second of their two marks
anyway — and Word seats it in the same corner, so the two renderers agree.

**And the mark reaches Word as a raster derived from its vector, not as a
second vendored file.** Word cannot be relied on to draw an SVG, so it needs
a PNG; a PNG vendored beside the SVG drifted from it, silently, and printed a
glyph whose vertical bar stopped short of the corner. `npm run theme:tebin`
now rasterises `corner-mark.svg` through the same Chromium that prints the
PDFs. Do not re-vendor a raster.

`documentor inspect <data.json>` reports what would be assembled — the
title, the team, the computed budget total, every validation error — and
writes nothing.

## The decisions live in a file, not in a conversation

A build's decisions — the title, the date, the entity on the letterhead, the
theme, which formats to write — go in `<name>.documentor.json` beside the
source, and are picked up automatically:

```json
{ "title": "Q3 Review", "date": "July 20, 2026", "theme": "tebin", "to": ["pdf", "docx"] }
```

A month later the same command reproduces the same bytes with nobody
remembering anything, and a year later the diff says why the document looks
the way it does. That is the whole point: a decision that lives only in
somebody's memory of a conversation is a decision already lost.

A flag on the command line outranks the sidecar, which outranks whatever the
document says about itself — the order in which each was deliberately decided.
`--config <file>` names one explicitly, `--no-config` ignores it. An unknown
key is refused by name rather than skipped, because a typo that quietly does
nothing would let you believe a decision was recorded when it was not.

## Reproducible by construction

The same input produces byte-identical output on the same platform:

- timestamps come from `SOURCE_DATE_EPOCH` or the input file's mtime, never the
  clock;
- the font is embedded, not resolved from the system, so a machine without
  Arial does not silently re-wrap every line;
- the renderer fetches nothing — CSS, fonts and logos are inlined before the
  browser sees the page.

Output may still differ between platforms, because the renderer does: PDFs are
drawn by Chromium, and Chromium's build, its text shaping and its rasteriser
are not identical on Windows, macOS and Linux. That is why the visual baseline
images in this repository are pinned to one platform. Reproducibility here
means "the same machine, twice", which is what a rebuild a year later actually
needs; it is not a promise of a byte-for-byte match across operating systems.

## Themes

The default theme, `plain`, carries no brand. A theme is one JSON file:

```bash
documentor build report.md --theme ./my-brand/theme.json
```

See `themes/plain/theme.json` for the shape.

### Refreshing the TEBIN brand theme

`themes/tebin/theme.json` is generated, not hand-edited. Its only input is
`brand/tebin/`, vendored from the `tebin-style` design system rather than
fetched, so the generator runs offline and a brand refresh is an explicit
commit whose diff shows what moved. To pull in a brand change:

1. Replace the files under `brand/tebin/` from the same source (see
   `brand/tebin/SOURCE.md` for what that source is and what each file is for).
2. Run `npm run theme:tebin`.
3. Commit `brand/tebin/` and the regenerated `themes/tebin/theme.json`
   together.

## Requirements

Node 22+ and Chromium — the two the install commands above cover. `documentor
doctor` reports what is missing and the exact command that fixes it, which is
the first thing to run when something behaves oddly.

## License

MIT. See `LICENSE`.
