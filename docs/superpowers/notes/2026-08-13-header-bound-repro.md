# Header-bound: reproduction and clamp measurement

Date: 2026-08-13. Branch: `header-bound`, off `main` at `005c808`, in its own
worktree per the phase-2 residuals note's finding ("A pathologically long
document title will overprint later pages' body text, with no guard against
it").

All measurements below are raster-based (decoded PNG pixels, own scanner —
see `test/helpers/png-ink.ts`), never pdfjs text coordinates: text extraction
reports the same glyphs at the same coordinates whether the header prints
cleanly or overprints the page underneath it, so it cannot see this defect —
the phase-2 residuals note and the clean-first-page spike both already
learned this the hard way.

## Reproduction

Synthetic document: a ~1000-character title of `'Word '` repeated 200 times
(999 characters, plain ASCII — deliberately not the mixed-script Cyrillic
title first tried, which turned out to hit a separate, unrelated timing
issue between Chromium's header-template sub-document and `@font-face`
loading that made the header vanish entirely rather than overprint; not
pursued further since it isn't this task's defect), followed by enough
filler paragraphs to push a second heading (`# Heading on a later page`) onto
its own page.

Rendered with `renderPdf` (unmodified `main` code), `resolveTheme` default
margins (48pt), rasterised at scale 2 (`rasterPages`), decoded with a
project-owned PNG scanner (`test/helpers/png-ink.ts`, written for this
because `@napi-rs/canvas` — the obvious decoder, already in `node_modules`
via `pdf-to-img` — is only an *optional* dependency of a devDependency, not
guaranteed present on every CI platform).

Ink bands (contiguous dark rows, gaps ≤3px merged) on the page carrying the
heading, top 400px:

```
{ start: 32,  end: 71  }   <- header, wrapped to 3 lines unclamped
{ start: 110, end: 147 }   <- "Heading on a later page" — MERGED WITH ABOVE
```

Text extraction on the same page (pdfjs), for comparison — this is what a
coordinate-only check sees, and why it misses the defect entirely:

```
821.9pt  "Word Word Word Word Word Word Word Word Word Word "
814.4pt  "Word Word Word Word Word Word Word Word Word Word "
806.9pt  "3"  "/"  "3"
773.1pt  "Heading on a later page"
740.9pt  "Body text right after that heading."
```

The header's third wrapped line (y≈769pt, one row below the 773pt heading)
sits *below* "Heading on a later page" in the page's own coordinate space —
overlapping ink, confirmed visually: a raster of that page shows
`Word Word Word…` text painted directly through the bold "Heading on a later
page" glyphs.

## The clamp

`HEADER_TITLE_MAX_LINES = 2`, `HEADER_TITLE_LINE_HEIGHT_PT = 7.5`,
`HEADER_TITLE_CLAMP_THRESHOLD_CHARS = 100` — all in `src/render/pdf.ts`,
next to `runningHeader`, with the reasoning inline. Summarised:

- A one-line header's own ink sits 15.75–22.25pt from the page's physical
  top (measured in the earlier `pdf-clean-first-page` branch's own sweep,
  cited in the `margin` comment in the same file) — 33pt of gap to the
  body's own first line at this project's default 48pt margin.
- Each wrapped line measured at ~7.5pt tall on this machine. Two lines:
  ~25.5pt of gap left. Three: ~18pt. Four: ~10.5pt — under the 12pt
  legibility floor that same sweep judged against. Two lines is the largest
  clamp that keeps real headroom.
- `-webkit-line-clamp` was tried first and rejected by measurement: in
  Chromium's header-template sub-document it added the ellipsis glyph to
  line two but did not actually clip the box — a third line of ink still
  painted below it (raster-confirmed, same fixture).
- A plain `max-height` + `overflow:hidden` on the title `<span>` clips
  correctly, but **applying it unconditionally moved the baked-in baseline
  images by a fraction of a point** and failed
  `test/baseline/local-only-pixels.test.ts` on the kitchen-sink fixture's
  own, perfectly ordinary, single-line title. Cause: a flex item with
  `overflow: hidden` no longer participates in `align-items: stretch` the
  way a `visible` one does, which nudges the whole running header a
  fraction of a point regardless of whether anything actually overflows.
- Fix: gate the styling on title length. `HEADER_TITLE_CLAMP_THRESHOLD_CHARS
  = 100`, chosen from a bisection (`Word `-repeated titles, page 2's text
  bucketed by y-coordinate as a line-count proxy) that found the header
  wraps to a second line around 105–110 characters and a third around
  135–140 — 100 sits safely below both, so nothing near an ordinary title's
  length ever reaches the new styling, and the kitchen-sink fixture's own
  title (~32 characters) is nowhere close.

## Verification

- `npx vitest run` — 399/399 passed, including the deliberately-added
  raster-based header/body-overlap test in `test/render/pdf.test.ts`.
- `npx vitest run test/baseline/local-only-pixels.test.ts` — 2/2 passed, no
  baseline image touched.
- Kitchen-sink fixture, both themes (`plain`, `tebin`), rendered before
  (unmodified `main` code, via `git stash`) and after this branch's change:
  byte-identical (`cmp` clean on both PDFs; sizes 51,340 and 58,130 bytes
  respectively, unchanged).
- `npm run typecheck` and `npm run build` — clean.
- Deliberate-failure check: removing the `max-height`/`overflow` styling
  from `runningHeader` reproduces the original defect and fails the new
  test with `the header's own ink band is 115px tall — that is wide enough
  to have swallowed the page's own first heading rather than staying
  clamped to it own two lines`.
