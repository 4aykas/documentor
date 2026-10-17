# Diagram faults

One diagram per finding Mermaid can be made to produce, headed with the code
it must raise and nothing else (test/render/diagram-checks.test.ts).
D-CLIP and D-COVER have no reliable Mermaid reproduction; their rules are
tested on synthetic boxes.

## D-COLLIDE

```mermaid
quadrantChart
  title Two points in one place
  Alpha: [0.5, 0.5]
  Beta: [0.51, 0.5]
```

## D-BUDGET

```mermaid
flowchart LR
  A1[One] --> A2[Two]
  B1[Three] --> B2[Four]
  C1[Five] --> C2[Six]
  D1[Seven] --> D2[Eight]
  E1[Nine] --> E2[Ten]
```

## D-FOCUS

```mermaid
flowchart TD
  A[Start]:::focus --> B[Check]:::focus
  B --> C[Decide]:::focus
```

## D-UNRECORDED

```mermaid
flowchart-elk TD
  P[Port] --> Q[Queue]
```

## D-SMALL

```mermaid
flowchart TD
  A[Recall first, cheapest source first: the notes of this session, then the knowledge base, then the rules, and it says so in one plain sentence]
  B[Inspect the model read-only first, then state the scope, the change and the risk of the change, and it says so in one plain sentence]
  C[Ask for an explicit go-ahead before deletes, mass parameter writes and workset moves, and it says so in one plain sentence]
  D[Act in small batches of forty to fifty elements per call, never the whole model at once, and it says so in one plain sentence]
  E[Read every batch back and compare each value with the value that was intended, and it says so in one plain sentence]
  F[Fix what does not match and read it back again before retrying the batch, and it says so in one plain sentence]
  G[Report real counts, with every unfinished item said out loud in the report, and it says so in one plain sentence]
  H[Write the decision down, every time, or say that nothing durable was learned, and it says so in one plain sentence]
  I[Idle until the next task arrives, from a new terminal or from the same one, and it says so in one plain sentence]
  A --> B --> C --> D --> E --> F --> G --> H --> I
```
