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

The second is a judgement about what a sheet means and deserves its own
measurement across the corpus before it is written — how many sheets have a
preamble, how many rows deep it goes, and whether "fewer than two filled cells"
separates preamble from data everywhere or only here.

## Why this is here

Every test in `test/ingest/xlsx.test.ts` passes, and each one is a fixture
built to exercise a rule the design named. None of them look like these files,
because the design was written from aggregate counts — sheets, rows, merges —
and an aggregate cannot show you that a table starts on row three. Running the
finished thing over the real corpus and reading its own report is what did.
