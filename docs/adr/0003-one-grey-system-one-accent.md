# ADR 0003 — A diagram is one grey system with one accent

**Status:** accepted (2026-10-17, recording 4068dd6, 6bc05b6 and 9b08756)

## Context

Mermaid's own themes paint a diagram in colours no document theme chose
(lavender nodes, Tableau sankeys, a quadrant point computed as
`hsl(0, 0%, NaN%)`), and a diagram coloured box by box competes with the page
it sits on.

## Decision

- Every colour a diagram uses comes from three of the theme's: the sheet,
  the ink and the brand (`diagramTokens` in `src/render/diagrams/tokens.ts`).
- Structure is ink mixed into the sheet at fixed strengths — a box 3.5 %, its
  outline 22 %, a line 50 %, secondary text 62 % — the scheme beautiful-mermaid
  (lukilabs, MIT) derives its themes from.
- The brand is spent on what carries direction or emphasis: arrowheads, the
  first series, a highlighted point. A mind map, timeline or pie runs one hue
  from the brand toward the sheet; categorical series step through the brand
  and neutrals that differ in lightness.
- Where a Mermaid type ignores theme variables, documentor corrects the
  drawing: a stylesheet rule or a repaint after drawing, kept in that type's
  registry record.

## Consequences

- `test/render/diagram-gallery.test.ts` fails when any gallery type paints a
  Mermaid default colour under `plain`, `tebin` or `haskoning`, so a Mermaid
  upgrade cannot undo a correction silently.
- A focus mark (spec 2026-10-17) uses the brand, and is limited in number
  for the same reason the brand is limited here.
