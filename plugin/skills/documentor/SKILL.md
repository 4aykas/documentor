---
name: documentor
description: Re-issue an existing Markdown, Word or Excel document as a well-typeset PDF, Word, or Markdown file using the documentor CLI. Use when the user has a written .md, .docx or .xlsx file and wants it re-typeset, branded, or exported to PDF/Word — not for writing new documents from scratch, not for .pdf sources (documentor cannot read PDF), and not for changing what a document says — except a commercial proposal, which `documentor proposal` assembles from a data file and a template (still writing no text of its own).
---

# documentor

`documentor` re-issues a document someone already wrote as a well-typeset one.
It reads the content into an intermediate representation and draws that
representation with a theme. **It never touches the text** — only how the
document looks. If a document's wording needs to change, that is a separate,
human request; do not fold it into a documentor run. The one exception is a
commercial proposal, which does not exist yet when this flow starts:
`documentor proposal` assembles it from a data file and a template, but it
still never *invents* text — every sentence comes from one of those two
inputs, and a missing piece is an error, never a sentence documentor made up.

## When to use this skill

Use it when the user hands you (or names) an existing `.md`, `.docx` or
`.xlsx` file and wants a polished PDF, Word, or Markdown re-issue of it — a
report, a memo, a proposal, a small register, something already written that
needs to look better or come out in another format.

Do **not** use it when:
- the document doesn't exist yet **and is not a proposal** — write it first,
  with no theming; for a proposal, use the proposal flow below;
- the source is `.pdf` — documentor cannot read PDF;
- the source is a working spreadsheet rather than a register — see the
  spreadsheet limit below; most `.xlsx` files are refused, and offering to
  re-issue one before inspecting it sets up a promise that will not hold;
- the ask is to change wording, structure, or content — documentor carries
  content through verbatim; rewriting is a separate, explicit task;
- the ask is just "make a document" with no re-typesetting angle — invoking
  this skill on every mention of "document" is exactly the kind of
  over-triggering that gets a skill disabled.

## What documentor refuses to do

Know these before promising anything to the user:

- **Appearance only, never text.** Content is carried through verbatim. If a
  sentence looks weak, that is not this skill's call to fix — propose it to
  the user as a separate, visible edit; never silently rewrite.
- **Reads `.md`, `.markdown`, `.docx` and `.xlsx`.** No `.pdf` in.
- **A spreadsheet has to be a register, not a workbook.** A merge confined to
  one row is flattened and reported by range; a merge spanning more than one
  row refuses the sheet by name, and so does a sheet past 200 rows or 25
  columns. Over a real set of 68 spreadsheets, 22 were read. Run
  `inspect` before promising anything, and when a sheet is refused, relay the
  message rather than working around it — it names the sheet and the number so
  the user knows which range to extract and re-issue instead.
- **Writes PDF, Word (`.docx`), and Markdown.** No `.xlsx` out (a table
  renderer exists in the design but has not shipped). Assembles proposals too
  — see "The proposal flow" below — but that path still writes no text of
  its own; documentor assembles proposals, it does not write them.
- **Word gets no table from a `.docx` source.** Reading a `.docx`, tables are
  *reported*, not carried — a lost table is loud, not silent.
  Paragraphs, headings, lists, emphasis, links, page breaks, and PNG, JPEG,
  GIF and BMP images all carry through.
- **Word embeds PNG, JPEG, GIF and BMP.** An SVG or a WebP becomes a visible
  placeholder naming what it was; the PDF path embeds any raster.

## The flow

### 1. Inspect

```
documentor inspect <file> --json
```

This renders nothing and writes nothing — it reports what the document
contains and what a build would do with it. Other flags it accepts, matching
`build`'s own: `--theme <id>`, `--title <s>`, `--date <s>`, `--entity <s>`,
`--config <file>`, `--no-config`, `--recursive` (for a directory).

Read the JSON. The fields that matter:

- `documents[].title` / `.subtitle` / `.date` / `.entity` — exactly what
  will print in the header. `.subtitle` and `.entity` are absent unless
  something already supplied them, because neither has a source inside a
  document at all.
- `documents[].counts` — what survived into the document: headings,
  paragraphs, lists, tables, images, code blocks, quotes, rules, page breaks.
- `documents[].dropped` — what could not be carried, named plainly (e.g. a
  `.docx` table, reviewer comments, tracked changes).
- `documents[].warnings` — things that are not losses but will surprise
  whoever opens the result (no title found, a heading level skipped a step,
  a table too wide for the page, an image that cannot embed in Word).
- `documents[].status` — `"ok"`, `"refused"` (documentor would refuse to
  build this — table too wide even after documentor's own landscape/shrink
  steps, for instance), or `"failed"` (unreadable file).

**Show `dropped` and `warnings` to the user as reported — do not summarise
them away, and do not offer to patch a loss by rewriting content.** A missing
table or a dropped comment is the user's decision to act on, not something to
paper over.

### 2. Ask only what changes the output

Every question below earns its place by changing what the CLI actually
produces. If the answer to a question wouldn't change the sidecar, don't ask
it — that's the design's whole complaint about assistants that generate
dialogue instead of decisions.

| Ask | Only when | Goes to sidecar as |
|---|---|---|
| Which output formats? (PDF, Word, Markdown — any combination) | Always — the default is PDF only, and a Word or Markdown copy is a real, common choice | `to` |
| Which theme? | More than one theme is available (at minimum `plain`, the brand-neutral default; a project may add its own, e.g. `tebin`) | `theme` |
| What title should the header carry? | `warnings` contains "no title found", or the source is a `.docx` with no in-body title (so its filename is standing in) | `title` |
| What date should the header carry? | No `date` came back from inspect at all (nothing in the source, no scan hit) | `date` |
| What entity/letterhead line? | Only if a theme with a letterhead was chosen (e.g. `tebin`) — `entity` has no source inside any document, so under `plain` (no letterhead) asking is noise | `entity` |
| A subtitle line? | Only if the user is already choosing a title/theme and a themed letterhead is in play — optional, skip silently if declined | `subtitle` |

Do **not** ask about table width, landscape orientation, or narrowing a wide
table — documentor already handles that automatically at build time
(landscape, then font shrink to a 7pt floor, then refuse), and the sidecar
has no field to override it yet. Just surface the warning; there is no
decision for the sidecar to record here.

Do **not** ask about `--plain-names` (dropping the theme id from the output
filename) unless the user is running a batch and explicitly cares about the
resulting names — it changes nothing about the document itself, only its
filename, and the default already prevents an input from ever colliding with
its own output.

### 3. Write the sidecar, and show it

Write the answers to `<stem>.documentor.json`, beside the source — e.g.
`report.docx` → `report.documentor.json`. This file, not the conversation, is
the deliverable of the interview: it is what makes the build reproducible and
what a colleague reads in git a year later to know why the document looks the
way it does.

```json
{
  "title": "Q3 Review",
  "date": "July 20, 2026",
  "entity": "Example Sp. z o.o.",
  "theme": "tebin",
  "to": ["pdf", "docx"]
}
```

Every field is optional; a sidecar holding only `{"theme": "tebin"}` is valid.
Fields this file accepts: `title`, `subtitle`, `date`, `entity`, `theme`,
`to`, `plainNames` — `to` is an array of format names, `plainNames` is a
boolean, the rest are strings. An unknown key refuses the whole file by
name, so do not invent field names.

**Show the sidecar's contents to the user before building.** The decisions
must be visible — that is the point of the file existing. If the user is
working in a git repo, mention that this file is meant to be committed
alongside the source.

### 4. Build

```
documentor build <file> --to pdf,docx
```

With the sidecar in place beside the input, `--to` on the command line is
optional — it is already the same value most of the time — but pass it
explicitly if you want a flag-level guarantee. Other flags: `--theme <id>`,
`--out <dir>`, `--title <s>`, `--date <s>`, `--entity <s>`, `--plain-names`,
`--recursive` (for a directory), `--config <file>`, `--no-config`. A flag on
the command line outranks the sidecar, which outranks whatever the document
says about itself.

Output lands beside the input as `<name>.<theme>.<ext>` (or `<name>.<ext>`
with `--plain-names`) — never overwriting the input.

## The proposal flow

When the user wants a commercial offer that does not exist yet:

1. Ask where the offer template lives (a `.md` file, usually outside the
   repo). No template, no flow — do not improvise one.
2. Interview for the data file's fields — only what changes the output:
   project, kind (COMMERCIAL OFFER / COMMERCIAL PROPOSAL), date, author,
   the team (role, rate, hours per week — one array per role, all the same
   length), the priced summary lines, which sections the template expects
   (`documentor inspect <data.json>` lists errors naming anything missing),
   and the annex spreadsheet if the template carries `{{@annex}}`.
3. Write `<name>.proposal.json` beside the future document and **show it**.
   The `sections.*` values are the user's words verbatim — never rewrite,
   tighten, or expand them.
4. Run `documentor inspect <name>.proposal.json` and relay every error and
   warning as reported.
5. Build: `documentor proposal <name>.proposal.json --to pdf,docx --theme tebin`.

The command assembles, it does not write: every sentence comes from the data
file or the template. A missing piece is a build error naming what is
missing — relay it and ask, never fill the gap yourself.

## What this skill is not

A second execution path. It never re-implements ingesting, rendering,
naming, or validation — every one of those stays in the CLI. This skill has
two jobs, and each writes a different file: for an existing document, run
`inspect`, ask the few questions whose answers change the sidecar, write and
show the sidecar, run `build`; for a proposal that does not exist yet, run
the proposal flow above, which writes a *data file*, not a sidecar — the
data file is not layered over some other source of truth, it is the
decisions file itself, which is why `proposal` reads no sidecar at all.
