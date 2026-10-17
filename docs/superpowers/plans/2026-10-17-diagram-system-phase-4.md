# Diagram system, phase 4 — the axonometric engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ```` ```axonometric ```` fences (`exploded`, `plan`) drawn from
declared geometry with one projection, refused when the geometry cannot
stand or a label cannot be placed cleanly.

**Spec:** "Axonometric engine". **ADR:** 0009.

| Path | Responsibility |
|:--|:--|
| `src/render/diagrams/axonometric/parse.ts` | grammar, levels and placement, plan checks; keyword tables |
| `src/render/diagrams/axonometric/project.ts` | the projection, faces, silhouettes, the topological back-to-front sort |
| `src/render/diagrams/axonometric/draw.ts` | scale to the column, boxes with `data-box`, leaders, rooms, tags |
| `docs/diagrams/axonometric.md` | the authoring reference, keyword table checked against the parser |
| `test/render/axonometric.test.ts` | refusals; reprojection of every face; painting order; leaders horizontal, on their part, crossing nothing; carry; generated figures in two themes |

## Tasks (done 2026-10-17)

- [x] Parser, projection, depth sort, both layouts, wiring (registry,
      IR `lang`, inspect's `desc`), gallery sections, README rows.
- [x] Leaders: first try anchored on the right edge refused the common case
      (a part beside another); now any outline point with a clear ray, and
      a default gap of most of the footprint's screen depth.
- [x] Shown red with `npm run red`: a wrong projection constant, a reversed
      paint order, a leader check that lets everything through.

## Deviations from the spec

- No `round` (rounded prisms, cylinders): boxes only until a document needs them.
- Blocks are always labelled: an unlabelled block would drop the author's word.
- No leader is placed by widening the label column: a figure with no clean
  leader is refused with the advice to widen the gap.
