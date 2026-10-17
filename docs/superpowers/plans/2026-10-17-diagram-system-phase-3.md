# Diagram system, phase 3 — the chart engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ```` ```chart ```` fences (`bar`, `dumbbell`, `waterfall`) drawn by
documentor from declared numbers, refused when they cannot be read exactly
or do not reconcile.

**Spec:** `docs/superpowers/specs/2026-10-17-diagram-system-design.md`,
"Chart engine". **ADR:** 0008.

## Shape

parse (Node, pure) → measure text widths (page, theme faces) → lay out and
emit SVG (Node, pure) → the shared checks, screenshot and placement. A
chart is laid out at the column's width and the body size, so it never
scales.

| Path | Responsibility |
|:--|:--|
| `src/render/diagrams/chart/parse.ts` | grammar, numbers (exact, verbatim), waterfall reconciliation; keyword tables |
| `src/render/diagrams/chart/draw.ts` | ticks, word wrap, the three layouts, `data-*` declarations, accessible SVG |
| `src/render/diagrams/chart/measure.ts` | widths from a canvas in the diagram page |
| `src/render/diagrams/registry.ts` | `engine: 'chart'` records; heads per engine; `ENGINE_LANG`, `engineOf` |
| `docs/diagrams/chart.md` | the authoring reference, keyword table checked against the parser |
| `test/render/chart.test.ts` | numbers and refusals both ways; carry; waterfall re-derivation; zero baseline; generated charts draw no clipped, colliding or covered label |

## Tasks (done 2026-10-17)

- [x] Parser with refusals naming the line; settings before or after rows.
- [x] Layouts: bar from zero with marks; dumbbell with legend and break mark;
      waterfall with carries, break marks, values above or below by sign.
- [x] Wiring: `DIAGRAM_LANGS` from the engines; the IR's `lang` takes
      `chart`; inspect counts a chart without `desc` as undescribed.
- [x] Gallery sections, README table (`Type | Fence | Header`), parity tests
      generalised to every engine.
- [x] Shown red once: the generated-charts test with the unit set back on the
      tick line (it needed realistic, long units to see it); the keyword
      parity with a row removed.
- [x] Dark themes: the SVG has no background of its own (lionfocus proof).
