# ADR 0002 — Diagrams are drawn offline, in the Chromium the PDF already needs

**Status:** accepted (2026-10-17, recording 591abf9 and cf453de)

## Context

A diagram fence has to become a picture in three formats: vector in HTML and
PDF, a raster in Word, the fence again in Markdown. Mermaid draws in a
browser; documentor already ships one (Chromium, through Playwright) for the
PDF, and promises that a build fetches nothing.

## Decision

- Every diagram is drawn once per document, before any renderer runs, in a
  page of that Chromium (`src/render/diagrams/page.ts`). HTML and PDF inline
  the SVG; Word embeds a PNG taken of the same SVG at three times its size;
  Markdown writes the fence back verbatim.
- The page is served from `https://documentor.invalid`, an origin that cannot
  resolve, and every request to it is answered from the installed `mermaid`
  and `@mermaid-js/layout-elk` packages; any other request is refused by the
  guard the PDF page uses.
- Labels are SVG text (`htmlLabels: false`), so a PDF reader can select and
  search them.
- A diagram's bytes depend on its source and theme alone:
  `deterministicIds`, and a seeded `Math.random` per diagram (rough.js,
  which Mermaid draws some shapes with, otherwise varies its control points
  on every build — dc76c62).

## Consequences

- A Word-only build of a document with a diagram launches Chromium.
- A fence Mermaid cannot parse prints as its source and the build says why;
  it never becomes a silent gap.
- `test/guardrails/no-wall-clock.test.ts` allows a URL only under `.invalid`;
  the gallery is checked byte-identical across two pages.
