# Reading a spreadsheet — what the corpus actually is

Date: 2026-08-13
Status: approved, ready for planning

The other half of phase 3's ingest work. Scoped, like the DOCX slice, by
measuring the files that need it rather than by imagining a spreadsheet.

## What was measured

68 `.xlsx` files in a real data room, read straight from the OOXML:

| | |
|:--|--:|
| Files | 68 |
| Single-sheet | 57 · multi-sheet 11 (largest: 17 sheets) |
| Rows | median 107 · **maximum 94,309** · over 200 rows: 17 files |
| With merged cells | **54 of 68** (largest: 3,656 merges) |
| With formulas | 12 (largest: 3,551) |
| With rich-text runs | 3 |

Two of those numbers decide the shape of this work, and both point the same way.

**Merged cells are the norm, not the exception.** The IR's `table` is a
rectangle of cells with no concept of a span, and 54 of 68 files use one.
Pretending otherwise would silently misalign the columns of the majority of the
corpus.

**A 94,309-row sheet is not a document.** Neither is a 17-sheet weekly status
report with 612 formulas. These are working spreadsheets — instruments people
compute with — and re-issuing them as a typeset document is a category error,
not a rendering problem.

So the useful subset is narrow and worth naming: **small tabular registers**.
A shareholders' register of 12 rows, a list of insurances of 4, a legal
structure of 41. Those are evidence, they are meant to be read, and they are
what re-issuing serves.

## What it reads

`ingestXlsx(bytes, opts)` returns `{ doc, dropped }`, the same contract the
other two ingesters have.

- **Each worksheet becomes a heading followed by one table.** The sheet's name
  is the heading; a workbook of one sheet named `Sheet1` gets no heading,
  because "Sheet1" tells a reader nothing.
- **Values, not formulas.** A cell carrying a formula also carries the value
  Excel last computed, and that cached value is what a reader saw. It is used
  directly, and the fact is reported once per document — a workbook last saved
  by something that did not compute could carry a stale number, and the person
  re-issuing it should know that is possible.
- **The first row is the header** when it looks like one — every cell filled
  and no cell numeric. Otherwise the table has no header row and that is
  reported, because a table whose first data row is styled as a heading is a
  quiet misreading.
- **Empty leading rows and columns are trimmed**, and fully empty rows inside
  the used range are kept: a blank row inside a register usually separates
  groups, and deleting it changes what the table says.
- **Dates.** A date in a spreadsheet is a number wearing a format. The number
  format decides, so the styles part must be read; a date rendered as `45107`
  is worse than useless. Where the format cannot be resolved, the raw value is
  carried and the cell is reported.

## What it refuses, and why refusing is the feature

- **A sheet with any merged cell is refused**, naming the sheet and the count.
  Flattening a merge — value in the first cell, blanks in the rest — produces a
  table that looks right and says something different from the original, which
  is the worst available outcome for a document that is evidence. The IR cannot
  hold a span, so the honest answer is to decline and say so.
- **A sheet beyond a row or column limit is refused**, naming the size. The
  limit is a page's worth of reading, not a technical ceiling: a table nobody
  can read on paper has not been re-issued, it has been reformatted into
  uselessness.
- A workbook where **every** sheet is refused fails the build rather than
  producing an empty document.

Both refusals name the sheet and the number, so the message tells the person
what to do: extract the range that matters into a small sheet, and re-issue
that.

## Why not ExcelJS

The design's phase-3 note names ExcelJS for *writing* spreadsheets, and that
choice stands for output. For reading, this slice takes the same route the DOCX
ingester took: the parts out of the zip with `jszip`, which is already a
dependency. The corpus does not need a spreadsheet engine — it needs shared
strings, cell values, and the number formats that distinguish a date from a
number. Adding a full engine to read four columns of a register is weight the
consumer pays for at install.

This is a decision to revisit if the refusals above ever soften: merges and
large sheets are where a real engine earns its place.

## Verification

- A generated fixture per behaviour — shared strings, an inline string, a
  number, a date, a formula with a cached value, an empty leading column, a
  fully empty row — built as a zip in the test rather than committed as a
  binary nobody can diff.
- Both refusals: a merged sheet and an oversized one, each naming its sheet.
- A multi-sheet workbook produces headings in sheet order.
- The corpus itself: all 68 files ingested, with `dropped` and refusals
  collected, so the real distribution of what this cannot carry is visible as a
  list rather than as a surprise. That run is evidence for the report, not a
  committed test — the files are confidential.

## Out of scope

Writing `.xlsx`. Charts, images, conditional formatting, filters, defined
names, and anything else that makes a spreadsheet an application rather than a
table.
