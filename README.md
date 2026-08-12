# documentor

Take a document somebody already wrote and re-issue it as a well-typeset one.

```bash
npx @tebin/documentor build report.md --to pdf
```

The result lands beside the input as `report.plain.pdf`.

## What it does

`documentor` reads a source document into a small, format-agnostic
representation, then draws that representation with a theme. The look lives in
one place, so a PDF and a Word file made from the same source cannot drift
apart.

Phase 1 reads Markdown and writes PDF and Markdown. Word, Excel, and reading
`.docx` / `.xlsx` / `.pdf` follow.

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

## Requirements

Node 22+ and Chromium:

```bash
npx playwright install chromium
documentor doctor
```

`doctor` reports what is missing and the command that fixes it.

## License

MIT. See `LICENSE`.
