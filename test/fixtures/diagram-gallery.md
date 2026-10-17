# Diagram gallery

Every Mermaid type documentor draws, one per section.

## Flowchart

```mermaid
flowchart TD
  A[Request received] --> B{Within scope?}
  B -->|yes| C[Estimate effort]
  B -->|no| D[Decline politely]
  C --> E[(Project register)]
  C --> F([Send offer])
```

## Sequence

```mermaid
sequenceDiagram
  participant C as Client
  participant P as Portal
  participant D as Database
  C->>P: submit the form
  P->>D: store the request
  D-->>P: request id
  P-->>C: confirmation with the id
  Note over P,D: retries three times on failure
```

## Class

```mermaid
classDiagram
  class Project {
    +String code
    +Date start
    +close()
  }
  class Task {
    +String title
    +int hours
  }
  Project "1" --> "*" Task : contains
```

## State

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Approved : approve
  Review --> Draft : request changes
  Approved --> [*]
```

## Entity relationship

```mermaid
erDiagram
  CLIENT ||--o{ PROJECT : commissions
  PROJECT ||--|{ TASK : contains
  CLIENT {
    string name
    string country
  }
  PROJECT {
    string code
    date start
  }
```

## Mind map

```mermaid
mindmap
  root((Delivery))
    Design
      Concept
      Detail
    Build
      Site
      Commissioning
    Handover
      Training
      Records
```

## Timeline

```mermaid
timeline
  title Programme
  2026 Q1 : Brief : Concept
  2026 Q2 : Detail design
  2026 Q3 : Tender
  2026 Q4 : Construction start
```

## Gantt

```mermaid
gantt
  title Re-issue programme
  dateFormat YYYY-MM-DD
  section Design
  Brief        :a1, 2026-10-01, 7d
  Layouts      :a2, after a1, 10d
  section Build
  Renderer     :b1, after a2, 12d
  Review       :b2, after b1, 5d
```

## Pie

```mermaid
pie title Hours by discipline
  "Mechanical" : 42
  "Electrical" : 31
  "Plumbing" : 17
  "Controls" : 10
```

## Quadrant

```mermaid
quadrantChart
  title Effort against impact
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Drop
  quadrant-4 Delegate
  TLS upgrade: [0.2, 0.7]
  Bucket lockdown: [0.3, 0.9]
  Header policy: [0.15, 0.3]
  Credential rotation: [0.7, 0.8]
```

## XY chart

```mermaid
xychart-beta
  title "Monthly hours"
  x-axis [Jan, Feb, Mar, Apr, May, Jun]
  y-axis "Hours" 0 --> 400
  bar [120, 210, 260, 300, 280, 340]
  line [120, 210, 260, 300, 280, 340]
```

## Journey

```mermaid
journey
  title Client onboarding
  section Contact
    First call: 5: Client, Sales
    Proposal: 3: Sales
  section Start
    Kick-off: 4: Client, PM
```

## Sankey

```mermaid
sankey-beta
Budget,Design,40
Budget,Build,50
Budget,Reserve,10
Build,Site,30
Build,Equipment,20
```

## Git graph

```mermaid
gitGraph
  commit id: "brief"
  branch layouts
  commit id: "rams"
  commit id: "blueprint"
  checkout main
  merge layouts
  commit id: "release"
```

## Block

```mermaid
block-beta
  columns 3
  A["Ingest"] B["IR"] C["Render"]
  A --> B
  B --> C
```

## Bar chart

```chart
bar
title Change in hours against the plan, by discipline
unit %
mark +10 Tolerance
Mechanical     +6.5
Electrical     +11.2  focus
Structural     -4.0
Architecture   -8.5
```

## Grouped bar

```chart
grouped
title Diesel and urea storage, by project
unit m³
series Diesel
series Urea (DEF)
Multi-level data centre    300  40
Expansion zone             500  30  focus
Urea distribution            -  50
```

## Dumbbell

```chart
dumbbell
title Planned and booked hours, by discipline
unit h
before Planned
after Booked
Mechanical    1,200  1,278
Electrical      860    956
Structural      640    614
```

## Waterfall

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

## Exploded axonometric

```axonometric
exploded
title Air handling unit, exploded
part Roof panel       120 x 80 x 6
part Fan section      60 x 70 x 30  level 2  at 0 5
part Coil section     50 x 70 x 30  level 2  at 65 5  focus
part Base frame      120 x 80 x 12
```

## Axonometric plan

```axonometric
plan
title Plant room, level 1
plate 30 x 20
room  Switchroom     0  0  12 x 8
room  Plant hall    12  0  18 x 20  focus
room  Store          0  8  12 x 12
block Chiller       16  4   8 x 4  h 2.5  in Plant hall
block Pumps         16 12   6 x 3  h 1    in Plant hall
```
