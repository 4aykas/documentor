# Diagram system, phase 2 — accessible figures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a diagram's title and description, written by the author, reach
every format: the SVG (HTML/PDF), Word's alt text, and `inspect`.

**Spec:** `docs/superpowers/specs/2026-10-17-diagram-system-design.md`,
"Accessible figures".

## What was checked first (2026-10-17)

- Mermaid 12.2 already writes `accTitle:` and `accDescr:` (one line, or a
  `{ … }` block) as `<title id="chart-title-dgN">` and
  `<desc id="chart-desc-dgN">`, with `aria-labelledby`/`aria-describedby` on
  the root, and `role="graphics-document document"`. HTML and PDF inline that
  SVG, so they need nothing more.
- `docx` 9 takes `altText: { name, title?, description? }` on `ImageRun`.
- **A tagged PDF does not survive.** Chromium can print one (`tagged: true`),
  but `stitchCleanFirstPage` in `pdf.ts` builds a new document with
  `PDFDocument.create()` and `copyPages` from two prints, which carries pages
  and not the catalog's structure tree. Keeping it would mean rebuilding that
  tree across two source documents. Deferred, recorded in the ADR.

## Constraints

- Text is carried, never written: the title and description are the
  author's words from the fence. Where there are none, Word's alt text
  carries only the type's name (chrome, like a page number), never an
  invented description.
- A missing description is not a build warning; `inspect` counts it.

## Tasks

### Task 1: Carry title and description onto the block

- [ ] `renderOne` returns the drawn SVG's `<title>` and `<desc>` text.
- [ ] The `diagram` block gains `title?: string; desc?: string`;
      `validate.ts` checks they are strings when present.
- [ ] Test: a fence with `accTitle` and a block `accDescr` gives the block
      those words; one without gives neither.

### Task 2: Word alt text

- [ ] `docx.ts`: `altText: { name: <type label or "Diagram">, title, description }`.
- [ ] Test: the drawing's `wp:docPr` carries the title and description; a
      diagram without them carries only the name. Shown red once.

### Task 3: inspect

- [ ] `inspect` reports `diagramsWithoutDescription` beside `diagrams`,
      counted from the fences (no drawing): a Mermaid fence with no
      `accDescr`.
- [ ] Skill parity: the skill names the field; `skill-docs-parity.test.ts`
      checks it against inspect's output.

### Task 4: Records

- [ ] ADR 0007, "A diagram's description is the author's, and travels with
      it": accTitle/accDescr as the one source, Word alt text, no invented
      text, tagged PDF deferred and why. The spec's ADR list shifts: charts
      become 0008, axonometric 0009.
- [ ] README Diagrams: a bullet on `accTitle`/`accDescr`. The skill: when
      proposing a fence, write `accTitle` and `accDescr` from the document's
      own words.
