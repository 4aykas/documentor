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

  A single-sheet workbook whose first row was promoted to the document title
  therefore shows two labels above one table — the title and the sheet's name.
  That was put to the owner on 2026-08-13 with the page in front of them, and
  the answer was to keep it: the two say different things, and dropping the
  heading would lose the sheet's name with nothing to catch it. Do not
  "simplify" this later without asking again.
- **Values, not formulas.** A cell carrying a formula also carries the value
  Excel last computed, and that cached value is what a reader saw. It is used
  directly, and the fact is reported once per document — a workbook last saved
  by something that did not compute could carry a stale number, and the person
  re-issuing it should know that is possible.
- **The first row is the header** when it looks like one. The first rule —
  every cell filled and no cell numeric — was too strict against real sheets:
  after preambles and empty columns were dealt with, 37 sheets still reported
  no header, and the shareholders register is one of them because a single
  column carries no label. A column without a heading is ordinary; a table
  whose real header is carried into the data is not.

  So the rule loosens on the fill requirement and keeps the numeric one, which
  is what actually separates a header from a row of values. How far it loosens
  is a threshold, and a threshold is measured, not chosen: over the corpus,
  compare each candidate row's fill ratio against the rows beneath it and pick
  the value that recognises the registers without promoting a first data row.
  Whatever it is, it is named in the code with the number it was measured at.

  Where no row qualifies, the table has no header and that is reported, because
  a table whose first data row is styled as a heading is a quiet misreading.
- **Empty leading rows and columns are trimmed**, and fully empty rows inside
  the used range are kept: a blank row inside a register usually separates
  groups, and deleting it changes what the table says.
- **A column empty across every row is dropped.** Measured after the first
  version shipped: 62 of the corpus's 112 worksheets carry at least one, 642
  columns in all, present in the file because they carry a style. They are not
  data; they take width from the columns that are.
- **A preamble above the table is lifted out of it.** A sheet's table often
  does not start at its first row — a one-cell title, sometimes a blank row
  under it, sometimes a section caption. Counting rows before the first row
  holding two or more filled cells, 64 of 112 worksheets have one, most often
  a single row. Left in place, the header rule inspects the title, correctly
  reports "not a header", and carries the real header down into the data —
  which is what both of this document's own named examples did.

  Those rows become text above the table, never a deletion. And the rule stops
  short of consuming the sheet: a genuinely single-column list has no row with
  two filled cells at all, so a preamble that would swallow every row is not a
  preamble, and the sheet is read as one column of data. Anything lifted is
  reported, because a reader whose caption moved should be told where it went.
- **Dates.** A date in a spreadsheet is a number wearing a format. The number
  format decides, so the styles part must be read; a date rendered as `45107`
  is worse than useless. Where the format cannot be resolved, the raw value is
  carried and the cell is reported.

## What it refuses, and why refusing is the feature

- **A sheet whose merges span rows is refused**, naming the sheet and the
  count. A span down a column groups the rows it covers, and flattening it —
  value in the first cell, blanks in the rest — deletes which rows belonged to
  the group while leaving a table that looks perfectly well-formed. That is the
  worst available outcome for a document that is evidence.
- **A merge within a single row is flattened and reported**, by sheet and by
  range. Measured over the corpus rather than assumed: of 79 sheets carrying a
  merge, 43 carry only single-row ones, and 23 of the 54 affected files are
  entirely so. A single-row span put in the first cell with blanks after it is
  what the sheet already shows a reader, so refusing those would decline a
  third of the corpus to avoid a loss that does not occur. The report is the
  price — loud, per range, so a reader who cares can check the one row where a
  spanning label now sits under the first column's header.

  This is the project's standing rule applied, not an exception to it: loss
  that is named is acceptable, loss that is silent is not. The first version of
  this design refused both kinds, on the reasoning that the IR has no span; the
  measurement is what separated the case where that costs meaning from the case
  where it costs only a mention.
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
- Both refusals: a row-spanning merge and an oversized sheet, each naming its
  sheet; and a single-row merge flattened, with its range in `dropped`.
- A multi-sheet workbook produces headings in sheet order.
- The corpus itself: all 68 files ingested, with `dropped` and refusals
  collected, so the real distribution of what this cannot carry is visible as a
  list rather than as a surprise. That run is evidence for the report, not a
  committed test — the files are confidential.

## Out of scope

Writing `.xlsx`. Charts, images, conditional formatting, filters, defined
names, and anything else that makes a spreadsheet an application rather than a
table.
