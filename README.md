# documentor

Take a document somebody already wrote and re-issue it as a well-typeset one.

```bash
npx @tebin/documentor build report.md --to pdf
```

The result lands beside the input as `report.plain.pdf`. Pass `--to docx` for
a Word file instead — `report.plain.docx`, built from the same intermediate
representation as the PDF, so the two cannot drift apart:

```bash
npx @tebin/documentor build report.md --to docx
```

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
| **Excel `.xlsx`** | — | — | — | — |
| **PDF** | — | — | — | — |

Markdown out is not a second design — it is the intermediate representation in
a form a human reads, which makes it the cheapest way to see what an ingester
understood.

Two limits are worth knowing before you rely on them, because both are
deliberate rather than unfinished:

- **Reading `.docx` carries paragraphs, headings, lists, emphasis, links, page
  breaks and PNG images. It does not carry tables** — it reports them instead,
  by size, so a lost table is loud rather than silent. Nothing else is
  silently dropped either: comments, tracked changes, footnotes, text boxes and
  the old letterhead are all named in the run's report.
- **Writing Word embeds a PNG and nothing else.** Word's SVG support is
  version-dependent and embedding one properly means shipping a raster
  alongside it, which cannot be produced reproducibly — so an SVG becomes a
  visible placeholder naming what it was. The PDF path embeds any raster.

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

Node 22+ and Chromium:

```bash
npx playwright install chromium
documentor doctor
```

`doctor` reports what is missing and the command that fixes it.

## License

MIT. See `LICENSE`.
