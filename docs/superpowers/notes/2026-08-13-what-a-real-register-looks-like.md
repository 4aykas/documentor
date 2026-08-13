# What a real register actually looks like

Found by running the finished spreadsheet reader over the corpus it was
designed from, rather than by reading its tests. Recorded before acting on it
because the file it changes was being edited at the time.

## The symptom

Both of the design document's own named examples — the shareholders register
and the legal-structure sheet — ingest successfully and both report *first row
is not a header*. A shareholders register plainly has a header. The rule was
not what was wrong.

## What the sheets are shaped like

Read as shape only, no cell text, because the corpus is confidential:

```
1.1 Shareholders register
  row 1 (6 cells): A:text B:empty C:empty D:empty E:empty F:empty
  row 2 (6 cells): all empty
  row 3 (6 cells): A:text B:text C:text D:text E:text F:empty
  row 4 (6 cells): A:text B:text C:text D:text E:num  F:empty

1.9.1 Legal Structure, Locations
  row 2 (4 cells): A:num B:text T:empty U:empty
  row 4 (4 cells): A:num B:text C:text T:empty

PoA October2024
  rows 2 and 5 hold one cell each; the table's own rows start at row 7
```

Three things, none of which the design anticipated:

1. **A preamble sits above the table.** A one-cell title row, often a blank row
   under it, sometimes a section caption further down. The reader starts its
   rectangle at the first row that exists, so the title becomes row one of the
   table, the header rule looks at *that* and correctly says it is not a
   header, and the real header two rows down is carried as data. Nothing is
   lost and the table is still wrong.

2. **Columns far to the right extend the rectangle while holding nothing.**
   `T` and `U` above are empty in every row, and present in the XML because
   they carry a style. They become real, empty table columns, taking width from
   the columns that have something to say. The implementer named this as a
   known edge case not observed in the corpus; it is observed, in one of the
   two files the design used as its examples.

3. **Rows are sparse.** `PoA` has no row 1, 3, 4 or 6 at all. Any logic that
   assumes row *n* is the *n*th row present will be wrong on a third of these
   files.

## What to do about it

- **Trim columns that are empty across the whole used range**, not only leading
  ones. This one is unambiguous: a column with no value in any row carries
  nothing and costs width.
- **Recognise the preamble.** The first rows holding fewer than two non-empty
  cells are not table rows — they are a title or a caption. The natural
  handling is to lift them out as text above the table, and start the header
  rule at the first row that looks like a row. That also gives the register its
  real header back.

The second is a judgement about what a sheet means, so it was measured before
being written. Across all 112 worksheets in the corpus, counting rows before
the first row holding two or more filled cells:

| preamble depth | sheets |
|:--|--:|
| 0 rows | 48 |
| 1 row | 44 |
| 2 rows | 3 |
| 3 rows | 15 |
| 25 rows | 1 |
| 51 rows | 1 |

**Sixty-four of 112 sheets — 57% — have something above their table**, and one
row is by far the commonest shape. So the rule is worth having, and "fewer than
two filled cells" does separate preamble from data on all but two sheets.

Those two are the warning. A sheet that is genuinely a single-column list has
*no* row with two filled cells, so the rule would consume the entire sheet and
leave an empty table. **A preamble that swallows every row is not a preamble** —
the rule has to stop and treat the sheet as one column of data instead. The 25-
and 51-row cases are the same shape caught early; both eventually find a wide
row, but a reader would want to know that much was lifted out, so the count
belongs in the report rather than passing silently.

The empty-column trim was measured too: **62 of 112 sheets carry at least one
column that is empty in every row, 642 such columns in total.** This is not an
edge case in the corpus; it is the majority of sheets.

Neither rule may discard what it removes. A preamble row is a title or a
caption — it becomes text above the table, not a deletion.

## A second thing the same run showed

The lift was reported through `dropped`, and the CLI prints that list as
*things the document format cannot hold were left out*. So a register with
nothing missing announced two losses: a flattened merge, which is real, and
"preamble row 1 lifted and used as the document title", which is not — that
row is on the page, as the title, exactly where a reader wants it.

`dropped` is what `inspect` puts in front of somebody deciding whether a
conversion is safe. Every line in it is read as something to go and check, so a
line naming content that arrived safely spends the reader's attention and
teaches them to skim — which is how the line that matters gets skimmed too.
Both pushes are gone; the move is still visible, because `inspect` prints the
title it understood and the paragraph sits above its table.

Every other `dropped.push` in `src/` was then read, all of them: they name a
style, a merge's span, a link, a field code, a formula — things genuinely not
carried. This was the only pure success notice. The rule the rest already
follow, now written down: **a message belongs in `dropped` when something did
not arrive, not when something arrived somewhere else.**

## Why this is here

Every test in `test/ingest/xlsx.test.ts` passes, and each one is a fixture
built to exercise a rule the design named. None of them look like these files,
because the design was written from aggregate counts — sheets, rows, merges —
and an aggregate cannot show you that a table starts on row three. Running the
finished thing over the real corpus and reading its own report is what did.
