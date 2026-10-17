# Proving note: the week's post graphics against the new engines

**2026-10-17.** The spec names the marketing posts as proving material. Two
graphics were drawn by hand for the week of 2026-10-19
(`projects/marketing/posts/`), before the chart and axonometric engines
existed. Checked against them now:

1. **The urea post's chart (2026-10-22) cannot be a ```` ```chart ````.** It
   shows two quantities per project — diesel and urea volume — side by
   side, with one project having urea only. A `dumbbell` says "before and
   after" (one quantity at two moments) and would misdescribe it; a `bar`
   holds one value per row. The missing type is a **grouped bar**: several
   named series per row, each optional. It meets the registry's rule — a
   real document needed it and no type draws it — so it is the next chart
   type, with a test that a missing value draws nothing rather than zero.
2. **The three-gates flow (2026-10-20) is a Mermaid flowchart**, and drawn
   by documentor it raises `D-BUDGET` (10 nodes) and `D-SMALL` (too tall),
   both correct: the hand-drawn graphic splits the gates into a side column,
   which a flowchart cannot. Its branches also leave the diamonds on
   diagonal segments (the first proving note, item 2), still open.
3. **No axonometric material in the week.** A plant-room or site plan post
   would exercise `plan`; worth choosing when the topics for the following
   week are drafted.
