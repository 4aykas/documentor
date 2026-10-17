# Diagram system, phase 0 — canon without a behaviour change

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/render/diagrams.ts` becomes a directory around one type
registry; the registry, the gallery, README and the ADRs are held in step by
tests. Every drawing stays byte-identical.

**Spec:** `docs/superpowers/specs/2026-10-17-diagram-system-design.md`
(Architecture, Canon, ADRs; Phase 0).

## Global constraints

- **No drawing changes.** The gallery's SVG under `plain`, `tebin` and
  `haskoning` is hashed before Task 2 and must hash the same after Task 3.
  A difference is a bug in the move, not a new baseline.
- Code moves verbatim, comments with it. A function changes only where a
  per-kind switch is replaced by a registry lookup.
- Public names (`drawDiagrams`, `hasDiagrams`, `isDiagramSource`,
  `DIAGRAM_LANGS`, `kindOf`, `leftToRight`, `diagramTokens`, `diagramVars`,
  `diagramCss`, `drawable`, `distinct`, `headerLine`) stay exported from
  `src/render/diagrams/index.ts`; callers change only the import path.
- `npm run typecheck` and `npm test` green after every task; commit after
  every task; do not push.
- Parity tests read the code's own source of truth (`REGISTRY`), never a
  second hand-kept list (the house rule in `docs-parity.test.ts`).

## File structure

**Created:**

| Path | Responsibility |
|:--|:--|
| `src/render/diagrams/index.ts` | `drawDiagrams`, `hasDiagrams`, `isDiagramSource`, `DIAGRAM_LANGS`; re-exports |
| `src/render/diagrams/registry.ts` | `DiagramType`, `REGISTRY`, `typeOf(source)` |
| `src/render/diagrams/tokens.ts` | `mix`, `diagramTokens`, `distinct`, `diagramVars`, `DiagramTokens` |
| `src/render/diagrams/page.ts` | `ORIGIN`, `packageRoot`, `openDiagramPage` (guard, routing, faces, Mermaid import) |
| `src/render/diagrams/place.ts` | `place`, `round` |
| `src/render/diagrams/mermaid/source.ts` | `headerLine`, `kindOf`, `drawable`, `leftToRight` |
| `src/render/diagrams/mermaid/render.ts` | `MERMAID_CONFIG(theme, colPt)`, `diagramCss`, `renderOne` |
| `test/render/diagram-registry.test.ts` | registry ⇄ gallery, registry self-consistency |
| `test/guardrails/adr.test.ts` | ADR numbering, index, status |
| `docs/adr/README.md`, `docs/adr/0001…0005-*.md` | the seeded decisions |

**Modified:** `src/cli/build.ts`, `src/cli/inspect.ts`,
`scripts/diagrams-proof.mts`, `test/render/diagrams.test.ts`,
`test/render/diagram-gallery.test.ts` (import paths); `src/ir/types.ts`,
`src/ir/validate.ts` (`kind`); `test/guardrails/docs-parity.test.ts`
(Diagrams table); `README.md`, `CODING_STANDARDS.md`, `CLAUDE.md`.

**Deleted:** `src/render/diagrams.ts`.

---

### Task 1: Baseline hashes

- [ ] A scratch script (outside the repo) draws `test/fixtures/diagram-gallery.md`
      under the three themes with `drawDiagrams` and writes
      `kind → sha256(svg)` and `sha256(png)` per diagram to a JSON file.
- [ ] Run it twice; the two outputs are identical (determinism holds before
      anything moves). Keep the file.

### Task 2: The registry

`registry.ts`:

```ts
export interface DiagramType {
  id: string; engine: 'mermaid'; heads: readonly string[]; label: string;
  budget: Readonly<Record<string, number>>; focusMax: number;
  mermaid?: { config?: (t: DiagramTokens, vars: Record<string, string>) => object;
              css?: (t: DiagramTokens) => string; repaint?: 'journey' | 'gantt' | 'sankey';
              widthCap?: number; turnsDown?: boolean };
}
export const REGISTRY: readonly DiagramType[];
export function typeOf(source: string): DiagramType | undefined; // by kindOf(source)
```

- [ ] Fifteen records, one per gallery section, `label` = the gallery
      heading: Flowchart, Sequence, Class, State, Entity relationship, Mind
      map, Timeline, Gantt, Pie, Quadrant, XY chart, Journey, Sankey, Git
      graph, Block. `heads` lists every header word that selects the type
      (`flowchart`/`graph`, `stateDiagram`/`stateDiagram-v2`,
      `xychart`/`xychart-beta`, `sankey`/`sankey-beta`, `block`/`block-beta`, …).
- [ ] `kindConfig`'s cases move into `mermaid.config` (xychart, gitGraph);
      `diagramCss`'s `extra` into `mermaid.css` (timeline, gantt, gitGraph,
      journey); `place`'s caps into `widthCap` (pie, quadrantChart);
      `renderOne`'s kind tests into `repaint`; `leftToRight`'s two grammars
      into `turnsDown` (flowchart, timeline) — `leftToRight` itself keeps its
      regexes, and the registry test checks the two agree.
- [ ] Budgets and `focusMax` are recorded now (spec, Checks) and read by
      nothing until phase 1.
- [ ] Tests: no two records share an id, a label or a head word; `typeOf`
      finds every gallery fence; an unknown head gives `undefined`.

### Task 3: The directory

- [ ] Move the code into the files above. `renderOne` reads the repaint step
      from the record (`fix.repaint === 'journey'` instead of
      `fix.kind === 'journey'`, and so on); `diagramCss(t, kind)` appends
      `typeOf`'s css; `place` reads `widthCap`.
- [ ] An unrecorded header word behaves as today: drawn with the shared
      configuration, no extra css, no cap.
- [ ] Delete `src/render/diagrams.ts`; fix the import paths.
- [ ] Rerun the Task 1 script: identical JSON. Then the full suite.

### Task 4: `kind` on the diagram block

- [ ] `types.ts`: the `diagram` block gains `kind: string` — the registry id,
      or `''` for a header word no record claims. `place` sets it.
- [ ] `validate.ts`: `kind` must be a string, and either `''` or a registry id.
- [ ] Renderers ignore it; Markdown still writes the fence from `source`.
- [ ] A test: every gallery diagram comes back with the id of its section's record.

### Task 5: Parity

- [ ] `diagram-registry.test.ts`: the gallery's `##` headings equal the
      registry labels, same order, both directions; each section's fence
      resolves (`typeOf`) to the record its heading names.
- [ ] README's Diagrams section gains a table, `| Type | Mermaid header |`,
      one row per record. `docs-parity.test.ts` reads it by its header row
      and checks rows ⇄ `REGISTRY` labels both ways, and that the heads cell
      names the record's first head.
- [ ] Any count README states about diagram types is derived from
      `REGISTRY.length` in the test (the "15-type gallery" in CLAUDE.md is
      reworded to not state a number, or checked too).

### Task 6: ADRs

- [ ] `docs/adr/README.md`: what an ADR is here, the template (Status,
      Context, Decision, Consequences, Amendments), the rule that an accepted
      ADR is amended or superseded and never rewritten, and the index table.
- [ ] 0001 ADRs live in the repository; 0002 diagrams are drawn offline in
      Chromium; 0003 one grey system, one accent; 0004 layout may change,
      words never; 0005 every type is a registry record. Each cites the
      commit or file that already carries the decision.
- [ ] `adr.test.ts`: files are `NNNN-slug.md`, numbers unique and contiguous,
      each has a `**Status:**` line, the index lists exactly the files.

### Task 7: Standards and pointers

- [ ] `CODING_STANDARDS.md`: a "Recorded decisions" section with the two
      judgement rules from the spec.
- [ ] `CLAUDE.md`: one line pointing at `docs/adr/`.
- [ ] README Diagrams prose points at `docs/adr/` for why.
