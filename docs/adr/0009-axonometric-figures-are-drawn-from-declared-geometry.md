# ADR 0009 — Axonometric figures are drawn from declared geometry; a Revit export wins when a model exists

**Status:** accepted (2026-10-17)

## Context

TEBIN's documents describe plant rooms, floors, sites and assemblies. When a
Revit model exists, its own view is the honest picture, exported and placed
as an image. When there is none, an author had no way to draw "the unit,
taken apart" or "the floor, from above" without a drawing tool.
cathrynlavery/diagram-design admits two such grammars (its ADRs 0013 and
0014): an exploded axonometric and an axonometric plan, both drawn from
declared geometry with one projection, and re-verified by reprojection.

## Decision

- An ```` ```axonometric ```` fence is drawn by documentor's own engine
  (`src/render/diagrams/axonometric/`): `exploded` and `plan`, two registry
  records with `engine: 'axonometric'`. Grammar in
  `docs/diagrams/axonometric.md`, its keyword table checked against the
  parser both ways.
- **One projection**, 2:1 dimetric (x right and down, y left and down, z
  up), and **one primitive**, a box. Rounded prisms and cylinders are not
  drawn yet; a figure that needs them waits for the document that does.
- **Geometry stands or is refused:** every element on its plate, no two
  rooms or two blocks sharing floor, a block inside the room it names, sizes
  above zero — refused with the line and the names.
- **Painting is back to front by a topological sort over footprints**, not
  by `x + y`; in a plan, a room paints its floor and back walls, then its
  blocks, then its front walls.
- **Labels are the author's words, all of them.** An exploded part's label
  sits in one column to the right on a horizontal leader that starts on the
  part's outline and crosses no part; when none exists the fence is refused
  with the advice to widen the gap. By default the gap is most of the
  footprint's depth on screen, so a part beside another has a way out. A
  plan tags every room on its floor and every block on its roof, last; an
  overlap of tags is a `D-COLLIDE` finding.
- **Declarations are tested:** every box carries `data-box="x y z w d h"`,
  the figure its scale and origin; a test reprojects every face with its own
  copy of the projection, checks the painting order and that every leader
  is horizontal, on its part and clear of all others. Generated plans and
  stacks in a light and a dark theme draw no clipped, colliding or covered
  label.

## Consequences

- A figure is schematic by design: a box per room, desk or unit. Anything a
  Revit view shows better comes from Revit.
- Spec deviation recorded: blocks are always labelled (an unlabelled block
  would drop the author's word), and `round` is not part of the grammar.

## Amendments

**2026-10-17 (review of 86e595d).** "Geometry that cannot stand is refused"
did not hold everywhere. Refused now: a block standing in a room without
`in` (it painted under the room's floor and vanished), two rooms of one
name, parts on one level standing inside each other, an option given twice.
A part without `level` no longer joins a later `level <n>`: it has a level
of its own. Faces shaded top-lightest on a light sheet only; the tones now
follow the sheet, so a dark theme is lit from above too. A room's tag moves
off the blocks on its floor; a tag on another element's block, or past its
room, is a `D-COVER`. Tests now check painting order between rooms and free
blocks, the walls' geometry, the tone order in a light and a dark theme, and
the tag rules both ways. The spec's "widen the label column" is not done:
the fence is refused with the advice instead.
