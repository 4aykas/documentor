# Writing a ```` ```chart ```` fence

A chart documentor draws itself, from the numbers you write: a **bar**
chart, a **dumbbell** (two values per row) or a **waterfall** (a total
bridged to another by signed steps). Use it where a Mermaid `xychart` would
start its bars at the axis bottom instead of zero, or where a budget bridge
must add up. Why it exists: [ADR 0008](../adr/0008-charts-are-drawn-from-declared-numbers.md).

```chart
bar
title Variance against the approved budget, by chapter
desc Services rose 1.8 %, management 9.2 %, personnel fell 5.3 %.
unit %
mark +10 Ceiling
Services to beneficiaries  +1.8
Management and support     +9.2  focus
Personnel                  -5.3
```

## The grammar

The first line names the type. Every other line is a setting or a row. A
line starting with a setting word is a setting, wherever it stands, so a
row's label never begins with one. Blank lines and lines starting `%%` are
skipped. Anything else that cannot be read refuses the whole fence: it
prints as its source, and the build names the line and why.

A row's **label is everything before its trailing numbers**, so labels need
no quotes and may contain digits ("Phase 2 delivery 1,000"). Ending a row
with `focus` gives it the accent; one row at most.

| Keyword | Types | Meaning |
|:--|:--|:--|
| `bar` | — | first line: horizontal bars from zero, negative to the left |
| `dumbbell` | — | first line: two values per row, joined by a line |
| `waterfall` | — | first line: totals bridged by signed steps |
| `title` | all | printed above the chart, and its accessible title |
| `desc` | all | the accessible description (alt text); not printed |
| `unit` | all | printed under the axis |
| `mark` | bar | `mark <number> <label>`: a dashed reference line, two at most |
| `axis` | dumbbell, waterfall | `axis <number>`: start the value axis above zero; the chart then shows a break mark |
| `before` | dumbbell | the name of the first value (hollow dot) |
| `after` | dumbbell | the name of the second value (filled dot) |
| `total` | waterfall | `total <label> <number>`: stands on the axis; first, last and at most one between |
| `step` | waterfall | `step <label> <+/−number>`: floats between the running totals |
| `focus` | all | ends a row: the accent, one row at most |

## Numbers

Printed exactly as you write them; documentor never reformats them. Read
under one convention: an optional sign (`+`, `-` or `−`), digits with
thousands in groups of three separated by one of `,` `'` or a thin space,
and a `.` before decimals. `1,5` is not a number here and refuses the fence
rather than being guessed at. Sums are exact.

Axis ticks are computed, in the convention of the chart's first number.

## A waterfall must add up

```chart
waterfall
title From planned to booked hours
unit h
axis 2,000
total Planned        2,700
step  Mechanical      +78
step  Electrical      +96  focus
step  Structural      -26
total Booked         2,848
```

The fence is refused when a total is not the exact running sum (the build
says by how much), a step has no sign or is zero, the chart does not open
and close on a total, or `axis` lies above a level the chart must show.

## What the build may say

The chart is checked like every diagram (README, "Every drawing is
checked"): `D-BUDGET` above 12 bars, 10 dumbbell rows or 8 waterfall bars;
`D-FOCUS` above one focus row.
