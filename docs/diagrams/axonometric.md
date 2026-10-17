# Writing an ```` ```axonometric ```` fence

A figure seen from above at an angle, drawn by documentor from the geometry
you declare: an **exploded** view (one object, its parts lifted apart, in
assembly order) or a **plan** (a floor or a site, its rooms and blocks
standing on one plate). When a Revit model exists, export its view and
place it as an image instead; this is for when there is none. Why:
[ADR 0009](../adr/0009-axonometric-figures-are-drawn-from-declared-geometry.md).

```axonometric
exploded
title Air handling unit, exploded
part Roof panel       120 x 80 x 6
part Fan section      60 x 70 x 30  level 2  at 0 5
part Coil section     50 x 70 x 30  level 2  at 65 5  focus
part Base frame      120 x 80 x 12
```

## The grammar

The first line names the type; every other line is a setting or an
element. Blank lines and lines starting `%%` are skipped. A line that
cannot be read, or geometry that cannot stand, refuses the whole fence: it
prints as its source, and the build names the line and why.

Sizes are in your own model units (a plan reads them as metres); only
their proportions matter. An element's **label is everything before its
size** — `<w> x <d> x <h>` for a part, `<x> <y> <w> x <d>` for a room or a
block — so a label may hold numbers ("Pump 3", "Bay 2"). An option is given
once; `in` takes the rest of the line (a trailing `focus` excepted) as the
room's name.

| Keyword | Types | Meaning |
|:--|:--|:--|
| `exploded` | — | first line: one object, parts lifted apart along the vertical |
| `plan` | — | first line: a floor or a site on one plate |
| `title` | all | printed above the figure, and its accessible title |
| `desc` | all | the accessible description (alt text); not printed |
| `gap` | exploded | `gap <n>`: the lift between levels; by default about the depth of the footprint on screen |
| `part` | exploded | `part <label> <w> x <d> x <h>`: listed top first |
| `level` | exploded | `level <n>`: parts with one level sit side by side and lift together |
| `at` | exploded | `at <x> <y>`: a part's place in the footprint; centred without it |
| `plate` | plan | `plate <w> x <d>`: the floor or the site, required |
| `room` | plan | `room <label> <x> <y> <w> x <d>`: a floor with walls cut at desk height |
| `block` | plan | `block <label> <x> <y> <w> x <d> h <h>`: a solid box — furniture, plant, a building |
| `h` | plan | `h <n>`: a room's wall height (1.2 by default), a block's height (required) |
| `in` | plan | `in <room label>`: a block inside a room, drawn between its back and front walls |
| `focus` | all | ends a line: the accent, one element at most |

## What stands, and what is refused

- **Exploded:** every part has a size above zero. Levels stack in the
  order they first appear, top first, whatever their numbers; `level <n>`
  only says which parts share one, and a part without it is a level of its
  own. Parts sharing a level must not stand inside each other (place them
  with `at`). Each part's label sits in a column to the right on a horizontal
  leader that starts on the part and crosses nothing. When no such leader
  exists the fence is refused: give the parts a larger `gap`, or fewer side
  by side.
- **Plan:** every room and block stands on the plate; no two rooms share
  floor, nor two blocks, nor two rooms a name; a block `in` a room lies
  inside it, and the room exists; a block without `in` stands off every room
  (one inside a room would vanish under its floor). Each is refused with the
  names involved.
- Boxes paint back to front by their footprints (a topological sort, not
  `x + y`). Blocks are tagged on their roofs; a room's tag sits on its
  floor at the point nearest the centre where it stays on the floor and off
  every block. Tags paint last. Two tags that overlap are a `D-COLLIDE`
  finding; a tag on a block it does not name, or running past its room, is a
  `D-COVER` — shorten a name or give the room more floor.
- `D-BUDGET` above 6 parts, 8 rooms or 40 blocks; `D-FOCUS` above one focus.
