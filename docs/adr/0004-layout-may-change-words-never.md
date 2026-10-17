# ADR 0004 — A diagram's layout may change to fit the page; its words never do

**Status:** accepted (2026-10-17, recording cf453de and 319f734)

## Context

documentor re-issues what somebody wrote (`CODING_STANDARDS.md`, "Text is
carried, never written"). A diagram drawn for a browser window is often too
wide for an A4 column, and scaled to fit, its labels print far below the body
size.

## Decision

- A diagram is laid out at the theme's body size, so the scale it needs to
  fit the column is the size its labels print at.
- A left-to-right flowchart or timeline that would shrink below 85 % of the
  column is drawn again top-down, and the top-down drawing is kept when it
  prints the labels at least 15 % larger; the build says so.
- A drawing still scaled below three quarters of the body size gets a
  warning naming the size and what would help.
- A chart Mermaid draws at a fixed size (pie, quadrant) is held to part of
  the column, never below three quarters of the body size.
- Only the direction word in the header line is ever changed, and only in
  what Mermaid is handed; the block keeps the source as written. The same
  holds for the Gantt `todayMarker off` line that keeps the wall clock out.

## Consequences

- A diagram is never cropped and never wider than the column.
- Warnings are advice, not refusals: the author decides whether to split the
  diagram or shorten its labels.
