# ADR 0007 — A diagram's description is the author's, and travels with it

**Status:** accepted (2026-10-17)

## Context

A diagram is a picture to a reader who cannot see it unless something says
what it shows. documentor re-issues what somebody wrote, so that something
cannot be a sentence documentor composes. Mermaid already has the author's
channel: `accTitle:` and `accDescr:` (a line or a `{ … }` block), which it
writes into the SVG as `<title>` and `<desc>` with `aria-labelledby` and
`aria-describedby`.

## Decision

- **One source:** the fence's `accTitle` and `accDescr`. The drawing pass
  reads them back from the SVG onto the block (`title`, `desc`); a fence
  without them leaves both absent.
- **HTML and PDF** inline the SVG, so its `<title>`, `<desc>` and aria
  attributes reach a reader as Mermaid wrote them.
- **Word** gets them as the picture's alt text (`wp:docPr` title and
  descr). Its required name is the type's label ("Flowchart"), chrome like a
  page number; nothing else is filled in when the author wrote nothing.
- **A missing description is counted, not warned:** `inspect` reports
  `undescribedDiagrams`, and the skill offers to draft an `accDescr` from the
  document's own words for the author to accept.
- **No tagged PDF for now.** Chromium can print one, but `pdf.ts` stitches
  the clean first page from a second print into a new document with
  `copyPages`, which carries pages and not the catalog's structure tree.
  Keeping the tags means rebuilding that tree across two prints; it is
  deferred until a document needs a tagged PDF.

## Consequences

- An accessible diagram is one the author described; documentor makes the
  description travel and makes its absence visible.
- A change to the PDF stitching that keeps the structure tree should
  supersede the last decision here, with a test that a reader finds the
  diagram's description in the PDF's tags.
