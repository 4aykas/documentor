# documentor

Take a document somebody already wrote and re-issue it as a well-typeset one.

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

`documentor` reads a source document into a small, format-agnostic
representation, then draws that representation with a theme. The look lives in
one place, so a PDF and a Word file made from the same source cannot drift
apart.

## What it reads and writes

| from ↓ &nbsp; to → | PDF | Word `.docx` | Markdown | Excel `.xlsx` |
|:--|:--:|:--:|:--:|:--:|
| **Markdown `.md`** | yes | yes | yes | — |
| **Word `.docx`** | yes | yes | yes | — |
| **Excel `.xlsx`** | yes | yes | yes | — |
| **PDF** | — | — | — | — |

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
- **Writing Word embeds a PNG, a JPEG, a GIF or a BMP** — the same four reading
  a `.docx` carries, so a `.docx` in gives you every picture back in the
  `.docx` out. A picture needs its natural proportions, and those come from
  reading the file, so anything else becomes a visible placeholder naming what
  it was. That includes SVG, whose Word support is version-dependent and which
  would need a raster shipped alongside it that cannot be produced
  reproducibly, and WebP, which Word's own file format has no content type for.
  The PDF path embeds any raster.

## Proposals

`documentor proposal <data.json>` assembles a commercial offer from two
inputs: a data file holding the facts of this one offer (project, team,
rates, hours, the sections written fresh each time) and a markdown template
holding the skeleton and the boilerplate. Every sentence in the output comes
from one of the two, verbatim — the command assembles, it does not write.

The budget is computed, never typed: hours × rate per role, summed, printed
as `€ 4 500,00`. A summary line marked `"covers": "budget"` must equal that
total or the build fails quoting both figures. The involvement heatmap is
drawn from the same team array (`{{@heatmap style=scale|fill|numbers|marks}}`,
`scale` by default), and a deliverables register named by `"annex"` joins as
an annex through the spreadsheet reader — with its row cap raised to 2000 for
this one path, because a reference register is searched, not read.

`templates/offer.example.md` is a generic example; a real template carries a
company's own commercial terms and belongs outside a public repository, the
way this repository keeps its own brand book out of git.

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
