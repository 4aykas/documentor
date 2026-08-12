# DOCX ingest — the slice phase 3 needs first

Date: 2026-08-12
Status: approved, ready for planning

Phase 3 of the build order is "spreadsheets and the other ingesters". This is
the first half of its DOCX half, scoped by measurement rather than by ambition:
a real corpus of 86 documents needs re-issuing through the TEBIN theme, and
what those documents actually contain decides what the ingester must read.

## What the corpus is

A due-diligence data room. Each request item carries a short Word document that
restates the request and answers it — the marker is `TEBIN REPLY`,
`TEBIN EXPLANATION` or `TEBIN COMMENT` — on a letterhead that predates the
current theme. Re-issuing them is exactly the tool's stated purpose: content
carried through verbatim, appearance replaced.

Measured over the 81 documents that carry the marker (read straight from the
OOXML, not through Word, after Word's COM interface returned empty bodies for
several files and had to be abandoned as an instrument):

| | |
|:--|--:|
| Paragraph styles in use | `AODocTxt` 150, `ListParagraph` 69, `Heading5` 3 |
| Documents with a table | **0** |
| Documents with list numbering | 77 |
| Documents with an image | 24 (135 files, **all PNG**) |
| Documents with a hyperlink | 1 |
| Documents with an explicit page break | 3 |
| Headers carrying a date | 57 of 81, all reading `July 20, 2026` |

Two of those numbers set the scope. **No document has a table** — the single
hardest structure to read and the one whose absence makes this a small job. And
**no document has a heading**: `Heading5` appears three times in total, and the
bodies are otherwise flat runs of paragraphs and list items. So the ingester is
not reconstructing a document outline; it is reading paragraphs, lists and
emphasis, and that is nearly all.

## What it reads

`ingestDocx(bytes, opts)` returns `{ doc, dropped }`, the same shape
`ingestMarkdown` returns, so everything downstream is unchanged.

- **Paragraphs** → `para`, whatever their style.
- **List items** — a paragraph with `<w:numPr>` → `list`, with `<w:ilvl>` as
  the depth and the numbering definition deciding `ordered`. Consecutive items
  at the same level merge into one block, the same shape the Markdown ingester
  produces.
- **Runs** — `<w:b>` → `strong`, `<w:i>` → `em`, nested as the IR nests them.
- **Headings** — `Heading1`…`Heading6` map onto the IR's three levels, clamped:
  4, 5 and 6 all become level 3, because the IR has three and a document that
  uses a fifth is not making a distinction the renderers can show.
- **Hyperlinks** → `link`, resolved through the part's relationships. The
  scheme rule in `src/render/links.ts` still applies at render time; ingest
  carries the href as written.
- **Explicit page breaks** → `pagebreak`.
- **Images** → `image`, with the PNG lifted out of `word/media/` and inlined as
  a `data:` URI, because every renderer in this project embeds rather than
  fetches. A non-PNG raster is carried the same way; anything else is dropped
  loudly.

## What it drops, loudly

Every ingester in this project returns `dropped: string[]`, and both `inspect`
and `build` print it. Silent loss is worse than loud loss.

- **The letterhead in the header and footer.** This is the point of the
  exercise — the old brand furniture is replaced by the theme's — so it is
  dropped by design rather than by accident. It is still *reported*, so a
  document whose header carried something other than branding cannot lose it
  without saying so.
- **Tables.** None exist in the corpus, so writing a reader for them now would
  be speculative. A table therefore reports `table with N rows` and is dropped.
  This is the one thing in the slice that a later document is likely to need,
  and it is recorded as such.
- Comments, tracked changes, footnotes, endnotes, fields, text boxes, embedded
  objects, and any drawing that is not a picture.

## The date is content, the letterhead is not

57 of the 81 headers carry `July 20, 2026`, and that date is what the document
says about itself. Dropping it with the rest of the letterhead would lose
content while claiming to change only appearance.

So the ingester reads the header for a date and lifts it into `meta.date`,
which both renderers already print beneath the letterhead. Everything else in
the header is dropped. A header with no date yields no date, and `--date`
overrides whatever was found — the CLI flag added on 2026-08-12 exists for
exactly this.

The date is carried as the **string the document used**. It is not parsed, not
normalised, and has nothing to do with `SOURCE_DATE_EPOCH`, which governs file
timestamps for reproducibility.

## The title

These documents have no title in their body — the first paragraph is the
request text, and no paragraph carries a heading style. The document's name is
its filename, chosen by its author, so that is what `meta.title` takes, with
`--title` overriding it.

This is the one place where ingest supplies something the file did not contain
as text, and it is naming rather than content.

## Verification

- **A fixture that exercises what the corpus has**: paragraphs, a nested
  ordered and unordered list, bold and italic including nested, a PNG, a
  hyperlink, a page break, a `Heading5`, and a header carrying a date. Built by
  the `docx` renderer this project already has, so the fixture is generated
  rather than committed as a binary nobody can diff.
- **A round trip**: that fixture rendered to `.docx`, read back by the
  ingester, and compared against the IR it was rendered from. The two ends are
  written independently and meeting in the middle is the strongest evidence
  available that neither is lying.
- **The corpus itself**: all 86 documents ingested, with `dropped` collected
  across them, so anything the slice cannot carry is visible as a list rather
  than as a surprise in one file.
- The existing agreement and reproducibility gates apply unchanged: the
  ingester feeds the same IR, so the same renderers and the same tests cover it.

## Out of scope

Tables. XLSX ingest. PDF ingest. Styles as anything but a heading level —
colour, font and size in the source are appearance, and appearance is what this
tool replaces.
