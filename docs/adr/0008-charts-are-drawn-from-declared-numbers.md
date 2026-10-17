# ADR 0008 — Charts that carry numbers are drawn by documentor, from the numbers the author declared

**Status:** accepted (2026-10-17)

## Context

The Ukraine NCE budget report (2026-10-16) needed the variance of three
chapters against the approved budget: +1.8 %, +9.2 %, −5.3 %. Mermaid's
`xychart` starts every bar at the bottom of the axis, not at zero, so the
negative chapter printed as a short positive bar, and the chart was dropped
from the report. A budget bridge — approved, the changes, revised — has no
Mermaid type at all. A chart that looks right while its numbers do not add
up is worse than no chart: nothing on the page says so.

cathrynlavery/diagram-design draws such figures from declared values
(`data-role`, `data-value`) and its `verify-waterfall.py` re-derives the
geometry from the declarations, failing on any drift.

## Decision

- A ```` ```chart ```` fence is drawn by documentor's own engine
  (`src/render/diagrams/chart/`): `bar`, `dumbbell`, `waterfall`. Each is a
  registry record with `engine: 'chart'`, a gallery section and a README row.
- **The grammar** is a line grammar in Mermaid's manner, documented in
  `docs/diagrams/chart.md`; its keyword table is checked against the
  parser's own tables in both directions.
- **Numbers are carried, not written.** Every value prints exactly as the
  author typed it. It is parsed under one convention (sign, thousands in
  threes with one separator, a point for decimals), and anything else —
  `1,5` — refuses the fence instead of being guessed at. Sums are exact
  (scaled integers).
- **A waterfall reconciles or is refused**, naming the line and the
  difference; steps carry their sign and are never zero; `axis` starts the
  value axis above zero only below every level, and the chart then shows a
  break mark.
- **Honest scales:** a bar chart's domain always contains zero; ticks are
  computed chrome in the convention of the chart's first number.
- **Sign by fill weight**, not hue: increase filled with a faint brand tint,
  decrease hollow, both outlined, plus geometry and the printed sign. One
  focus row takes the brand.
- **Laid out, not scaled:** measured in the page with the theme's faces, laid
  out by pure functions at the column's width and the body size.
- **Declarations are tested:** each bar carries `data-role`, `data-value`,
  `data-name`, each carry `data-carry`; a test re-derives the scale, levels
  and carries from them. Charts generated across the grammar must draw no
  `D-CLIP`, `D-COLLIDE` or `D-COVER`.

## Consequences

- A chart written as a ```` ```chart ```` fence round-trips through Markdown
  like a Mermaid fence, and is refused rather than misdrawn.
- New chart types join as records under the same rules; each needs a
  declaration a test can re-derive, or it is not a chart this engine draws.
- `xychart` stays available for what it draws honestly (lines, all-positive
  bars), and is not corrected.

## Amendments

**2026-10-17 (review of d266e48).** "Refused rather than misdrawn" did not
hold: a dumbbell's scale ignored negative values and a waterfall could run
below zero, both drawn off the chart with no warning. A dumbbell's scale now
runs through zero like a bar chart's, and a waterfall below zero is refused.
Thousands with a plain space (`12 500`) were read as a label digit and a
value; such a row is refused. Text was measured without the tabular figures
it is drawn with, so dark-theme ticks clipped; widths are now measured as SVG
text set exactly as drawn. `D-COVER` now covers charts: a text on any
declared bar or dot. Tick labels for a 2.5 step printed wrong values; they
now carry the step's decimals. Generated charts are tested in a light and a
dark theme with marks, axes, focus rows, negative dumbbells and decreases
that reach the axis.
