# The sidecar — a build's decisions, written down

Date: 2026-08-12
Status: approved, ready for planning

The first slice of phase 4. The phase-1 design states the problem it solves:

> Any "assistant that asks" has the same defect: the decisions live in a chat
> and vanish with it. The next run produces a different file and nobody knows
> why. For a tool that must be reproducible, that is disqualifying.

So the dialogue materialises as a file beside the document, in git. A month
later `documentor build` reproduces the same output with no dialogue at all,
and a year later a colleague reads in the diff why the document looks the way
it does. The sidecar *is* the reproducibility; the skill that phase 4 adds only
fills it in faster.

## The file

`<stem>.documentor.json`, beside the source. `report.docx` → `report.documentor.json`.

```json
{
  "title": "Q3 Review",
  "subtitle": "Confidential",
  "date": "July 20, 2026",
  "entity": "TEBIN.PRO Sp. z o.o.",
  "theme": "tebin",
  "to": ["pdf", "docx"],
  "plainNames": true
}
```

Every field is optional. A sidecar holding only `{"theme": "tebin"}` is valid
and useful.

**Content overrides are deliberately not in this slice.** The phase-1 design
imagines entries like "promote section 5's heading to H2". Addressing a block
inside a document is a design problem of its own — a stable identity for
something the IR currently numbers only by position — and shipping a fragile
version of it would poison the file format that everything later depends on.
This slice carries what the CLI can already express, and nothing it cannot.

## Discovery

Found automatically beside the input, because the case that matters is a folder
of 86 documents and passing 86 paths defeats the purpose.

- `--config <file>` names one explicitly. Only meaningful for a single input.
- `--no-config` ignores any that exist, for the "what would this look like
  untouched" question.

**A sidecar that was used must be named in the output.** A file that silently
changes what is produced is the same failure as a silent drop: the run must say
`using report.documentor.json`, and the batch summary must count how many
inputs had one. Reproducibility that nobody can see is indistinguishable from
luck.

## Precedence

An explicit flag beats the sidecar; the sidecar beats what the document says
about itself.

    --title "X"   >   sidecar's title   >   the document's own title

The reasoning is about *when* each was decided. A flag is a deliberate act at
the moment of running and must not be silently overruled by a file. The sidecar
is a decision recorded earlier and deliberately, so it outranks the raw
material. The document's own metadata is the least considered of the three — it
is what the source happened to contain.

This is also why the sidecar cannot hold `--out`: where a build writes is a
property of the invocation, not of the document.

## Refusing a bad sidecar

An unknown key is refused, naming the key. A typo like `"tittle"` that silently
does nothing would be the worst possible behaviour for a file whose entire
purpose is that decisions are not lost — the user would believe a decision was
recorded when it was not.

A malformed sidecar is a usage error, not a document error: exit 2, like an
unknown option, since the fix is to correct what the operator wrote.

Values are validated the way the CLI validates the same values today, in one
place, so a theme id or format that the sidecar accepts and the CLI rejects
cannot exist.

## Verification

- The same input, the same sidecar, twice, produces byte-identical output —
  the existing gate, now with the sidecar in the path.
- Each precedence rule has a test: flag over sidecar, sidecar over document,
  and the absence of each.
- A sidecar with an unknown key refuses and names it; a sidecar that is not
  valid JSON refuses and says so.
- A batch reports how many inputs had a sidecar, and `--no-config` makes a run
  that had one produce what it would have produced without.
- `inspect` reads the sidecar too, and by the same rules — otherwise the two
  commands would answer the same question differently, which is the defect
  `inspect` exists to prevent.

## Out of scope

Content overrides, as above. Writing the sidecar — this slice reads one; the
skill in the next slice is what writes it, and until then a person writes it by
hand, which is a fair test of whether the format is legible.
