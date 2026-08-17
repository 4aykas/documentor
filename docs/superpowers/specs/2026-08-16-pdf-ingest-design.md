# Reading PDF — design

**Status:** approved 2026-08-16. Approach A (lines-first) with a token
round-trip gate; the three questions left open at review are settled at the
foot of this document.

## Why this exists, and what would make it a mistake

`documentor` re-issues a document somebody already wrote. Its README closes
the door on PDF for a good reason: a PDF has no structure. It is positioned
glyphs and drawn paths, with no headings, no lists and no cell boundaries.
Everything a reader would want back has to be *inferred*, and this project's
standing rule is to refuse rather than guess.

The case that reopened it: two of TEBIN's own financial documents
(`TEBIN P&L ACCOUNT.pdf`, `2026 Revenue Estimation.pdf`) had to be re-issued
in the house theme, and the only way to do it was to extract their text by
hand outside the tool. Both are almost entirely tables.

That last fact decides the scope. A text-only PDF reader — paragraphs and
headings, tables refused — would be the honest, cheap thing to build, and it
would refuse both documents it exists for. So this reads tables or it is not
worth building.

**What would make it a mistake:** a number landing in the wrong column, in a
document that looks perfectly typeset. That failure is worse than refusing
the file, because nothing about the output says it happened. The whole design
below is arranged around making that outcome impossible to ship silently
rather than unlikely.

## The premise, checked before committing to it

Approach A rests on the claim that these documents *draw* their tables. They
do. Page one of the P&L constructs **145 rectangles**, and their vertical
edges repeat: x ≈ 252, 1431, 1605, 1774, 1877, 2074, 2244, each appearing
24–26 times — once per row. The whole page has only **38 distinct x edges**
and 81 distinct y edges. That is a grid the document contains, not a pattern
we imposed on it.

One complication found in the same check: path coordinates arrive in the
current transformation matrix's space (edges near 1431, 2244) while text
positions arrive in page space (starts near 61, 412). The reader must apply
the CTM to path coordinates before the two can be compared. This is ordinary
work, but it is real work and it is where an off-by-a-transform bug would
hide.

## Scope

**In:**

- Portrait and landscape pages. The Revenue document is landscape (842×595),
  and `documentor` already prints landscape sheets for wide tables, so a
  landscape source round-trips into a landscape sheet.
- Single-column page layout.
- Tables whose grid is drawn — rows and columns taken from the drawn
  rectangles, text assigned to cells by position.
- A table continuing across a page break. The P&L is one table split over two
  pages (page one ends at "Total CTC", page two resumes at "CTC result"), so
  joining is a requirement, not a refinement.
- Headings and paragraphs. Heading level comes from type size — a PDF has no
  other signal — but *how* size becomes a level is open question 3 below, and
  the two candidate answers differ in whether the IR carries sizes at all.
- Repeated page furniture — letterhead, address block, document number,
  footer, page numbers — identified and dropped, because the theme draws its
  own and carrying the source's would print it twice.

**Out, and refused by name:** images, multi-column text, rotated text,
tables with no drawn grid, forms, annotations. Each is reported the way
`ingestDocx` reports a table it will not carry: what it was, how many, and
where.

Unruled tables are the one deliberate omission worth restating. Clustering
text by x-position would read them, and that is exactly the guessing the
gate below exists to prevent. If a real document needs it, it gets its own
design.

## Architecture

A new ingester beside the three that exist, with the same shape:

```
ingestPdf(bytes: Buffer, opts: PdfOpts, limits: PdfLimits)
  → Promise<{ doc: Doc; dropped: string[] }>
```

`dropped` names everything the file contained and the IR cannot hold. Silent
loss is the failure this signature exists to prevent, and PDF gives it more
chances than any other input.

Four units, each testable alone:

| Unit | Responsibility |
|:--|:--|
| `src/ingest/pdf/geometry.ts` | Operator list → rectangles and text runs in one coordinate space. Owns the CTM. |
| `src/ingest/pdf/chrome.ts` | Reports which blocks repeat across pages, and removes the ones the caller declared. Pure: takes runs per page, returns the body runs and what it removed. Decides nothing. |
| `src/ingest/pdf/grid.ts` | Rectangles → a column/row grid; text runs → cells. Refuses rather than guesses. |
| `src/ingest/pdf.ts` | Assembles the IR: headings, paragraphs, tables; joins a table across pages; produces `dropped`. |

Splitting them is not ceremony. The CTM, the chrome rule and the grid rule
each have their own failure mode, and each needs its own fixtures to be
argued about.

## The token gate

The reader is allowed to infer geometry; it is not allowed to be believed.
After the IR is assembled, the source PDF's text and the IR's text are
reduced to token sequences and compared. Any difference fails the build,
naming the first divergence:

```
documentor: refusing TEBIN P&L ACCOUNT.pdf — the reader's own output does not
match the source
  token 47: source says "608", the assembled document says "806"
```

**Tokens** are whitespace-separated, after normalising non-breaking spaces,
soft hyphens and ligatures. Order matters: a value moved to a neighbouring
column changes the row-major sequence, which is precisely the failure this
catches. So does a dropped row, a merged pair of cells and a duplicated
header.

**Scope of the comparison** is source-text against *assembled IR*, not
against the rendered PDF. The risk being defended is the reader's — a
renderer cannot move a number from one cell to another, and renderer
agreement is already held by `test/agreement/`. Comparing against the IR also
costs no browser, so the gate can run on every build rather than being an
opt-in. A later `--verify` against the produced file is possible and is not
in this scope.

**What the gate cannot see:** a value the reader assigned to the wrong column
*and* the source's own reading order happens to match. Column-major documents
would be the case; single-column pages are in scope precisely because their
reading order is unambiguous.

Chrome removed by `chrome.ts` is excluded from both sides of the comparison,
or every document with a letterhead would fail. That exclusion is safe only
because the removal was *declared* — see the next section. The gate never
excludes anything the reader decided on its own, because a gate that ignores
the one component allowed to guess is not a gate.

## Identifying page furniture

**The reader reports repeated blocks. It never decides to delete one.**

This replaces an earlier design in which the reader inferred furniture from
position, and the earlier design is worth recording, because it is the
obvious one and it does not work.

Three position-based rules were built and each was broken by an ordinary
layout. Text repetition mistakes a totals row's static caption for a footer.
"Closer to the page edge than to the nearest body run" is a coin flip,
because a sheet's margin and its leading are the same order of magnitude. A
body band plus a margin fraction deletes a totals row sitting at the foot of
an invoice.

That last failure is the general one, and it ends the argument. A totals row
at y=100 with body at y=500, and a footer at y=100 with body at y=500, are
the same geometry. Nothing on the page separates them. Only meaning does,
and the reader has no access to meaning.

So the reader does two separable things:

1. **`findRepeated`** returns every block whose position and text repeat
   across pages, with its y-range and its text. That is an observation, and
   observations can be trusted. It is what an operator reads to learn what
   their own document contains and where.
2. **`splitChrome`** removes exactly what it was *told* to remove — runs
   above a declared y, or below one. Nothing else. No declaration, no
   removal.

`documentor` re-issues documents its operator already owns, so the operator
knows their own letterhead and can say where it ends. Trading one number in a
config for a whole class of silent deletion is the trade this project makes
everywhere else; there is no reason this component should be the exception.

With nothing declared the reader keeps every run, and its report names the
repeated blocks it found together with the y values that would remove them. A
re-issue that prints the source's letterhead inside the body is then a visible
outcome with an obvious fix, rather than a deletion nobody can see.

A single-page document has no repetition to observe, and says so.

## Limits

In the shape `ingestXlsx`'s row cap already uses, refused by name when
exceeded rather than truncated silently:

- pages per document
- rectangles per page (a drawing-heavy page is not a table)
- cells per table

## Testing

- **Unit**, per module: CTM application against hand-built operator lists;
  the chrome rule against synthetic multi-page runs; the grid rule against a
  drawn grid, a partial grid and no grid at all.
- **Round trip**, the strongest instrument available here: generate a PDF
  with `documentor` itself from a known IR, read it back, and compare the IR
  to the original. Byte-identical output makes the fixture free and stable,
  and any drift in either direction shows up as an IR difference. This is the
  test that would catch a column swap.
- **The two real documents** as fixtures, with their expected token sequence
  committed. They live outside this repository — see `.input/`'s own
  repository — so the committed fixture is the token sequence and a small
  synthetic PDF that reproduces the same grid shape.
- **Refusals**, one case each, asserting the message names what and where.

## Decisions that were open, and how they were settled

Recorded rather than folded silently into the plan, so overturning one is a
one-line change here and a visible one.

**1. The gate compares source text to the assembled IR, not to the rendered
document.** It targets the risk that actually exists — a renderer cannot move
a number from one cell to another, and renderer agreement is already held by
`test/agreement/`. It needs no browser, so it runs on every build instead of
being an opt-in nobody remembers. If a reason appears to check the produced
file too, that is a `--verify` flag and a separate change.

**2. A failed gate refuses the build.** Writing the document and exiting
non-zero would leave a file on disk that looks finished and is wrong, and
somebody would eventually send it. Refusing is what this project does with
half an offer, an unreadable annex and a summary line that disagrees with the
budget; a mis-read table is the same kind of thing. The message names the
first divergence, which is what a person needs to go and look.

**3. Heading level comes from the document's own size distribution**, not
from the theme: the largest distinct body size is h1, the next h2, the next
h3, and anything at or below the modal size is a paragraph. Ingestion has no
theme and should not acquire one — every other ingester produces a Doc that
any theme can draw. Carrying raw point sizes into the IR was the alternative
and is worse: it would put a rendering concern in the representation, and
`Block` has stayed free of those on purpose.

The cost of 3 is a document whose headings are all one size: it has none, and
its prose is paragraphs. That is honest — a PDF with no size contrast carries
no heading structure to recover — and it is reported, so a document that came
out flat says so rather than looking deliberately flat.

**4. Page furniture is declared, not inferred** — added 2026-08-17, after
three position-based rules were built and each was broken by an ordinary
layout. This one was not an open question at review; it was settled the wrong
way and had to be reopened, which is why it is recorded here with its cost
rather than quietly amended above.

The cost is that a first re-issue of an unfamiliar document prints the
source's letterhead inside the body, and somebody has to read the report and
write two numbers into the config before the second run. That is one manual
step per document *shape*, not per document, and it buys the guarantee that
the reader never deletes a line it merely suspected. Given that the failure
being traded away is a totals row vanishing from an invoice with nothing on
the page to say so, it is not a close call.
