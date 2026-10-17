# Hostile fences

Fences that found defects in review, or were written to find them: each
is headed with what it must do, and test/render/diagram-hostile.test.ts
holds it to that in a light and a dark theme. `drawn`: drawn, with no
finding. `refused: <text>`: printed as its source, the warning containing
the text. `warned: <codes>`: drawn, with exactly these findings. A defect
a review finds joins this file with its fix (CODING_STANDARDS.md).

## drawn — One row

```chart
bar
title One row
Only row 42
```

## warned: D-BUDGET — Twenty rows

```chart
bar
title Twenty rows
R01 Alpha 12
R02 Beta 15
R03 Gamma 9
R04 Delta 22
R05 Epsilon 18
R06 Zeta 7
R07 Eta 13
R08 Theta 25
R09 Iota 4
R10 Kappa 19
R11 Lambda 11
R12 Mu 16
R13 Nu 8
R14 Xi 21
R15 Omicron 14
R16 Pi 6
R17 Rho 17
R18 Sigma 10
R19 Tau 23
R20 Upsilon 5
```

## drawn — All negative

```chart
bar
title All negative
unit kEUR
Services -1,200
Management -340
Personnel -5,300 focus
```

## drawn — All equal

```chart
bar
title All equal
A 5
B 5
C 5
```

## drawn — Tick step 2.5

```chart
bar
title Tick step 2.5
A 11
B 3
```

## drawn — Before equals after

```chart
dumbbell
title Before equals after
before Plan
after Actual
Design 1,200 1,200
Build 900 1,400
```

## drawn — Decrease ending near the axis

```chart
waterfall
title Decrease ending near the axis
total Start 1,000
step Cut -980
step Back +5
total End 25
```

## drawn — A very long title that keeps going and going so that it w…

```chart
bar
title A very long title that keeps going and going so that it wraps across several lines of the column at the body size of the theme, and a Supercalifragilisticexpialidociousandthensomemorewordsjoinedtogether
Supercalifragilisticexpialidociousandthensomemore 12
Short 5
```

## warned: D-COLLIDE — Mark outside the data

```chart
bar
title Mark outside the data
mark 50 Ceiling
mark 48 Floor
A 10
B 12
```

## drawn — Mark near the middle, long label

```chart
bar
title Mark near the middle, long label
mark 49 A reference line with a long name that runs on
A 100
B 12
```

## drawn — Axis on a dumbbell, not on a step

```chart
dumbbell
title Axis on a dumbbell, not on a step
before Plan
after Actual
axis 1,950
A 2,500 2,900
B 2,100 2,200
```

## drawn — Negative values without an axis

```chart
dumbbell
title Negative values without an axis
before Plan
after Actual
Margin -5 3
Other 2 4
```

## refused: a waterfall that runs below zero is — Dips below zero

```chart
waterfall
title Dips below zero
total Start 10
step Loss -30
total End -20
```

## drawn — Eight wide values

```chart
waterfall
title Eight wide values
total Start 1,234,567.89
step Alpha +111,111.11
step Beta -222,222.22
step Gamma +333,333.33
step Delta -44,444.44
step Epsilon +55,555.55
step Zeta -66,666.66
total End 1,401,234.56
```

## drawn — Long legend names

```chart
dumbbell
title Long legend names
before The approved baseline budget from the original contract award of the project
after The forecast at completion as of the last reporting period of the year
A 10 12
```

## drawn — Values with tabular ones

```chart
bar
title Values with tabular ones
A 1,111,111
B -1,111,111
```

## drawn — Hours & "costs" <by> chapter

```chart
bar
title Hours & "costs" <by> chapter
desc Services rose; management fell & personnel held.
unit h
Services +1.8
Management -9.2 focus
```

## drawn — waterfall

```chart
waterfall
%% a comment line
total Planned 2,700
step Mechanical +78
total Booked 2,778
```

## drawn — Flow title

```mermaid
flowchart LR
  accTitle: Flow title
  accDescr: Flow desc
  A --> B
```

## refused: block "Desk" stands in "Hall" without saying — A block listed before room

```axonometric
plan
title A block listed before room
plate 20 x 12
block Desk 3 3 4 x 2 h 0.8
room Hall 0 0 10 x 8
room Store 10 0 10 x 8
```

## refused: two rooms are called "Hall" — Duplicate room names

```axonometric
plan
title Duplicate room names
plate 20 x 12
room Hall 0 0 10 x 8
room Hall 10 0 10 x 8
block Desk 2 2 3 x 2 h 0.8 in Hall
```

## drawn — Tall block behind short room

```axonometric
plan
title Tall block behind short room
plate 20 x 20
block Tower 0 0 4 x 4 h 6
room Office 4 4 10 x 10 h 3
block Shed 15 15 4 x 4 h 1
```

## drawn — Auto level merges

```axonometric
exploded
title Auto level merges
part A 10 x 8 x 1 level 1
part B 6 x 6 x 3
part C 10 x 8 x 1 level 2
```

## drawn — Lower in front

```axonometric
exploded
title Lower in front
gap 2
part Upper 10 x 10 x 4 at 0 0
part Lower 10 x 10 x 4 at 14 14
```

## drawn — Long labels

```axonometric
exploded
title Long labels
part Roof panel with integrated photovoltaic modules and drainage 120 x 80 x 6
part Base 120 x 80 x 12
```

## warned: D-COVER — Tiny rooms

```axonometric
plan
title Tiny rooms
plate 40 x 20
room WC 0 0 1.5 x 1.5
room Corridor connecting east wing 1.5 0 2 x 20
room Main hall 3.5 0 36.5 x 20
block Reception desk counter 30 2 4 x 2 h 1.1 in Main hall
```

## drawn — Single column

```axonometric
exploded
title Single column
part Column 2 x 2 x 60
```

## drawn — Block at front wall

```axonometric
plan
title Block at front wall
plate 12 x 12
room Lab 0 0 12 x 12 h 2.4
block Fume hood 9 9 3 x 3 h 2 in Lab
block Bench 0 9 3 x 3 h 0.9 in Lab
```

## drawn — flowchart TD

```mermaid
flowchart TD
  subgraph Intake[Client intake and qualification]
    A[Lead arrives] --> B{Qualified?}
  end
  B -->|yes, budget confirmed| C[Proposal drafted]
  B -->|no| D[Polite decline]
  C --> E[Review by partner]
  E -->|changes requested| C
  E -->|approved| F[Sent to client]
```

## drawn — sequenceDiagram

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant D as Database
  U->>A: Request report
  Note over U,A: Authenticated session with a long explanatory note text
  alt cache hit
    A-->>U: Cached report
  else cache miss
    A->>D: Query rows
    Note right of D: Slow query
    D-->>A: Rows
    A-->>U: Fresh report
  end
  loop every minute
    U->>A: Poll status
  end
```

## drawn — classDiagram

```mermaid
classDiagram
  class Order {
    +id: string
    +total(): number
  }
  class Customer {
    +name: string
  }
  class Line {
    +qty: int
  }
  class Product {
    +sku: string
  }
  class Invoice {
    +number: string
  }
  class Payment {
    +amount: number
  }
  Customer "1" --> "*" Order : places
  Order "1" *-- "*" Line : contains
  Line --> Product : refers to
  Order --> Invoice : billed by
  Invoice --> Payment : settled by
```

## drawn — stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  state Review {
    [*] --> Legal
    Legal --> Finance : cleared
    Finance --> [*]
  }
  Review --> Approved : all signed
  Review --> Draft : rejected
  Approved --> [*]
```

## drawn — erDiagram

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE : contains
  PRODUCT ||--o{ LINE : "ordered in"
  CUSTOMER {
    string name
    string email
  }
```

## drawn — flowchart LR

```mermaid
flowchart LR
  A[Start] --> B[Step]
  A --> C[Other]
  B --> D[End]
  C --> D
  B -.-> C
  click A "https://example.com"
```

## drawn — flowchart TD

```mermaid
flowchart TD
  subgraph S[A very long subgraph title that is wider than the nodes inside it]
    A[Short] --> B[Two]
  end
  B -->|retry until the service answers| B
  B --> C[Done]
```

## drawn — sequenceDiagram

```mermaid
sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: This message is long enough that it has to wrap over several lines in the sequence diagram
  Note over A,B: A note that is also long enough to wrap over several lines in the drawing for sure
  alt when the condition text is long enough to run into the alt label box
    B-->>A: Yes
  end
  Note left of A: left note
  A->>A: Self call
```

## drawn — stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> Idle : boot
  Idle --> Busy : job
  Busy --> Idle : done
  Busy --> Failed : error
  Failed --> [*]
  note right of Busy : Retries three times before failing
  class Busy focus
  class Failed focus
```

## drawn — classDiagram

```mermaid
classDiagram
  class A:::focus
  class B:::focus
  A <|-- B
  note for A "A note on A"
```

## warned: D-COLLIDE — pie title Spend

```mermaid
pie title Spend
  "Staff" : 80
  "Rent" : 15
  "Travel" : 2
  "Software" : 2
  "Other" : 1
```

## drawn — Reach and engagement

```mermaid
quadrantChart
  title Reach and engagement
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
  Campaign C: [0.57, 0.69]
  Campaign D: [0.78, 0.34]
  Campaign E: [0.40, 0.34]
  Campaign F: [0.35, 0.78]
```

## drawn — Plan

```mermaid
gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Design
  A very long task name that will overflow its bar :a1, 2026-01-01, 3d
  Short :a2, after a1, 20d
  section Build
  Another long task name overflowing the bar :b1, after a2, 2d
  Final :b2, after b1, 10d
```

## drawn — "Monthly revenue"

```mermaid
xychart-beta
  title "Monthly revenue"
  x-axis [January, February, March, April, May, June, July, August, September, October, November, December]
  y-axis "Revenue" 0 --> 10000
  bar [5000, 6000, 7500, 8200, 9500, 10000, 9000, 8500, 7000, 6000, 5500, 5000]
```

## drawn — mindmap

```mermaid
mindmap
  root((Strategy))
    People
      Hiring
      Training
    Product
      Roadmap
      Quality
    Market
```

## drawn — flowchart TD

```mermaid
flowchart TD
  A[One]:::focus --> B[Two]:::focus --> C[Three]
```

## warned: D-BUDGET, D-SMALL — flowchart LR

```mermaid
flowchart LR
  A[Collect the request] --> B[Check the scope] --> C[Estimate the effort] --> D[Draft the offer] --> E[Review internally] --> F[Send to client] --> G[Negotiate terms] --> H[Sign contract] --> I[Kick off] --> J[Deliver phase one] --> K[Deliver phase two] --> L[Invoice] --> M[Close out] --> N[Archive]
```

## warned: D-BUDGET, D-SMALL — flowchart LR

```mermaid
flowchart LR
  R[Root] --> A1[Branch one] & A2[Branch two] & A3[Branch three] & A4[Branch four] & A5[Branch five] & A6[Branch six] & A7[Branch seven] & A8[Branch eight] & A9[Branch nine] & A10[Branch ten] & A11[Branch eleven] & A12[Branch twelve] & A13[Branch thirteen] & A14[Branch fourteen] & A15[Branch fifteen] & A16[Branch sixteen] & A17[Branch seventeen] & A18[Branch eighteen]
```

## drawn — classDiagram

```mermaid
classDiagram
  class A
  class B
  class C
  class D
  class E
  class F
  A <|-- B
  A <|-- C
  C --> D
  D --> E
  E --> F
  note for A "Root of the hierarchy"
  note for B "Leaf"
  note "A general note"
```

## warned: D-SMALL — stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> S1
  S1 --> S2
  state S2 {
    [*] --> X
    X --> Y
    Y --> [*]
  }
  S2 --> S3
  state fork1 <<fork>>
  S3 --> fork1
  fork1 --> S4
  fork1 --> S5
  state c1 <<choice>>
  S4 --> c1
  c1 --> S6
  c1 --> S7
  S7 --> [*]
  note left of S1 : first
```

## warned: D-SMALL — sequenceDiagram

```mermaid
sequenceDiagram
  box Group
  participant A
  participant B
  end
  actor C
  A->>B: hi
  B->>C: hello
  create participant D
  C->>D: new
```

## drawn — erDiagram

```mermaid
erDiagram
  A ||--o{ B : has
  B ||--|{ C : has
  A ||--|| D : has
```

## drawn — classDiagram

```mermaid
classDiagram
  class Project
  class Task:::focus
  Project --> Task
  note for Task "a note"
  note "free note"
```

## drawn — stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> Draft
  state fork1 <<fork>>
  state ch <<choice>>
  Draft --> fork1
  fork1 --> Review
  fork1 --> Check
  Review --> ch
  ch --> Done
  state Done {
    [*] --> Filed
  }
```

## drawn — erDiagram

```mermaid
erDiagram
  PROJECT ||--o{ TASK : has
  PROJECT:::focus {
    string code
    date start
  }
```

## warned: D-FOCUS — flowchart TD

```mermaid
flowchart TD
  A[Box]:::focus --> B{Decide}:::focus
  B --> C[(Store)]:::focus
  C --> D([Stadium]):::focus
  D --> E((Circle)):::focus
```
## drawn — class inheritance with labelled associations

```mermaid
classDiagram
  Animal <|-- Duck
  Animal <|-- Fish
  Animal <|-- Zebra
  Animal : +int age
  Animal : +isMammal()
  Duck : +swim()
  Fish : +swim()
  Zebra : +run()
  Duck --> Fish : eats sometimes
  Zebra "1" --> "*" Fish : ignores
```

## warned: D-CROSS — an edge through a box it does not join

```mermaid
flowchart TD
  A[Start] --> B[Check]
  B --> B
  B -->|retry| A
  B --> C[Done]
  A --> C
  A --> D[Other]
  A --> E[Third]
```

## drawn — a left-to-right flow with long labels, turned top-down

```mermaid
flowchart LR
  A[Request] --> B{Approved?}
  B -->|yes, after the second review by the steering committee| C[Order]
  B -->|no, returned to the requester with comments| D[Revise]
  D --> A
  B -->|escalate| E[Board]
  E --> C
```

## drawn — four series on a pale palette

```chart
grouped
title Four series
series A
series B
series C
series D
North 5 6 -7 8
South 3 - 4 2
```

## drawn — a grouped legend name longer than the line

```chart
grouped
series Diesel consumption in litres per month across all the construction and maintenance sites that we operate today in Europe Asia and Africa
series Urea
North 300 40
```

## drawn — years as labels

```chart
grouped
series A
series B
2023 5 6
2024 7 8
```

## refused: has no value in any row — a series with no value

```chart
grouped
series A
series B
series C
North 300 - -
South 200 - -
```

## drawn — Cyrillic labels

```chart
bar
Механіка трубопроводів шахти 1,200
Електрика 800
```
