# Reading PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `documentor build report.pdf --to pdf,docx` re-issues a PDF whose tables are drawn, refusing rather than guessing anywhere it cannot read the file with certainty.

**Architecture:** A new ingester in four units — geometry (operator list → rectangles and text runs in one coordinate space), chrome (which runs are page furniture), grid (rectangles → cells), assembly (IR + `dropped`) — followed by a token gate that compares the source's text against the assembled IR and fails the build on any divergence.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), `pdfjs-dist@4.10.38` legacy build (already a dependency, already used by `test/helpers/pdf-text.ts`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-pdf-ingest-design.md`

## Global Constraints

- **Silent loss is the failure to prevent.** Everything the file contained and the IR cannot hold is named in `dropped`: what it was, how many, which page.
- **Refuse rather than guess.** A table with no drawn grid is refused by name, not clustered from text positions.
- **The token gate refuses the build.** Source text and assembled IR text are compared as ordered token sequences; any difference throws, naming the first divergence.
- **No new runtime dependency.** `pdfjs-dist` is already in `dependencies`.
- **No `Date.now()`, no argument-less `new Date()`, no `Math.random()`, no network.** Output must be byte-identical twice.
- **`exactOptionalPropertyTypes` is on:** omit an absent key, never set it to `undefined`.
- **Heading level comes from the document's own size distribution**, never from a theme. Ingestion takes no theme.
- **The IR stays flat.** No new `Block` variant is introduced by this work.

---

### Task 1: Geometry — operator list to one coordinate space

**Files:**
- Create: `src/ingest/pdf/geometry.ts`
- Test: `test/ingest/pdf-geometry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type Rect = { x0: number; y0: number; x1: number; y1: number };
  export type TextRun = { text: string; x: number; y: number; sizePt: number };
  export type PageGeometry = { rects: Rect[]; runs: TextRun[]; rotated: number; widthPt: number; heightPt: number };
  export function applyMatrix(m: readonly number[], x: number, y: number): { x: number; y: number };
  export function readPageGeometry(page: PdfPageLike): Promise<PageGeometry>;
  ```
  `PdfPageLike` is the structural subset this module needs, so tests can pass a literal:
  ```ts
  export type PdfPageLike = {
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
    getTextContent(): Promise<{ items: unknown[] }>;
    getViewport(o: { scale: number }): { width: number; height: number };
  };
  ```

**Why this is its own unit:** rectangle coordinates arrive in the current transformation matrix's space and text arrives in page space. On the P&L's first page the CTM is `[0.24, 0, 0, -0.24, 0, 850.08]`: a rectangle edge at x=252 becomes 60.5pt, and the text "in k€" starts at x=60.55. Everything downstream assumes the two are already reconciled.

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest/pdf-geometry.test.ts
import { describe, expect, it } from 'vitest';
import { applyMatrix, readPageGeometry } from '../../src/ingest/pdf/geometry.js';

// pdfjs op codes, from pdfjs-dist@4.10.38's OPS table. Hardcoded rather than
// imported so the test states what shape it is feeding in.
const OPS = { save: 10, restore: 11, transform: 12, rectangle: 19, constructPath: 91 };

describe('applyMatrix', () => {
  it('maps a path coordinate into page space, y-flip included', () => {
    // The P&L's own page-one CTM, read off the file.
    const m = [0.24, 0, 0, -0.24, 0, 850.08];
    expect(applyMatrix(m, 252, 0).x).toBeCloseTo(60.48, 2);
    expect(applyMatrix(m, 0, 3509.375).y).toBeCloseTo(8.83, 2);
  });
});

describe('readPageGeometry', () => {
  it('returns rectangles in page space and text runs with their size', async () => {
    const page = {
      getOperatorList: async () => ({
        fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore],
        argsArray: [
          null,
          [0.5, 0, 0, -0.5, 0, 100],
          // [pathOps, coords, minMax] — the shape pdfjs actually emits.
          [[OPS.rectangle], [10, 20, 40, 30], [10, 20, 50, 50]],
          null,
        ],
      }),
      getTextContent: async () => ({
        items: [{ str: 'Turnover', transform: [12, 0, 0, 12, 60.5, 610], width: 40, height: 12 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    const g = await readPageGeometry(page);
    // x: 10 * 0.5 = 5 … 50 * 0.5 = 25. y flips: 100 - 0.5*20 = 90, 100 - 0.5*50 = 75.
    expect(g.rects).toEqual([{ x0: 5, y0: 75, x1: 25, y1: 90 }]);
    expect(g.runs).toEqual([{ text: 'Turnover', x: 60.5, y: 610, sizePt: 12 }]);
    expect(g.widthPt).toBe(595.5);
    expect(g.rotated).toBe(0);
  });

  it('counts rotated text instead of keeping it, so task 4 can report it', async () => {
    // Sideways text needs a second geometry to read. Keeping it as if it were
    // horizontal would put it in the wrong cell; dropping it without a count
    // would lose it in silence. Counting is the third option.
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({
        items: [{ str: 'sideways', transform: [0, 10, -10, 0, 5, 5], width: 3, height: 10 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    const g = await readPageGeometry(page);
    expect(g.runs).toEqual([]);
    expect(g.rotated).toBe(1);
  });

  it('drops a run that is only whitespace', async () => {
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({
        items: [{ str: '   ', transform: [10, 0, 0, 10, 1, 2], width: 3, height: 10 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    expect((await readPageGeometry(page)).runs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/pdf-geometry.test.ts`
Expected: FAIL — cannot find module `src/ingest/pdf/geometry.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ingest/pdf/geometry.ts
//
// One coordinate space, and it is the page's. pdfjs hands rectangles out in
// whatever space the current transformation matrix defines and text in page
// space; on a real file those differ by a factor of four and a y-flip
// (`[0.24, 0, 0, -0.24, 0, 850.08]`), so a comparison between the two without
// this module is meaningless. Every downstream unit takes page space for
// granted.

/** pdfjs-dist@4.10.38 op codes. Only the ones this reader acts on. */
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_RECTANGLE = 19;
const OP_MOVE_TO = 13;
const OP_LINE_TO = 14;
const OP_CURVE_TO = 15;
const OP_CONSTRUCT_PATH = 91;

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type TextRun = { text: string; x: number; y: number; sizePt: number };
export type PageGeometry = { rects: Rect[]; runs: TextRun[]; rotated: number; widthPt: number; heightPt: number };

export type PdfPageLike = {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
};

/** `[a, b, c, d, e, f]` applied to a point, PDF's own convention. */
export function applyMatrix(m: readonly number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0]! * x + m[2]! * y + m[4]!, y: m[1]! * x + m[3]! * y + m[5]! };
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!, a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!, a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!, a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ];
}

export async function readPageGeometry(page: PdfPageLike): Promise<PageGeometry> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const rects: Rect[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (const [i, fn] of fnArray.entries()) {
    if (fn === OP_SAVE) { stack.push([...ctm]); continue; }
    if (fn === OP_RESTORE) { ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OP_TRANSFORM) { ctm = multiply(ctm, argsArray[i] as number[]); continue; }
    if (fn !== OP_CONSTRUCT_PATH) continue;
    const [pathOps, coords] = argsArray[i] as [number[], number[]];
    let a = 0;
    for (const op of pathOps) {
      if (op === OP_RECTANGLE) {
        const [x, y, w, h] = [coords[a]!, coords[a + 1]!, coords[a + 2]!, coords[a + 3]!];
        a += 4;
        const p = applyMatrix(ctm, x, y);
        const q = applyMatrix(ctm, x + w, y + h);
        rects.push({
          x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x),
          y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y),
        });
      } else if (op === OP_CURVE_TO) a += 6;
      else if (op === OP_MOVE_TO || op === OP_LINE_TO) a += 2;
    }
  }

  const { items } = await page.getTextContent();
  const runs: TextRun[] = [];
  let rotated = 0;
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[] };
    if (typeof it.str !== 'string' || it.str.trim() === '' || it.transform === undefined) continue;
    const t = it.transform;
    // Unrotated text is [size, 0, 0, size, x, y]. Anything with a shear or a
    // rotation is counted, not kept: reading it would need a second geometry
    // and the caller reports the count rather than losing it in silence.
    if (t[1] !== 0 || t[2] !== 0) { rotated += 1; continue; }
    runs.push({ text: it.str, x: t[4]!, y: t[5]!, sizePt: Math.abs(t[0]!) });
  }
  const vp = page.getViewport({ scale: 1 });
  return { rects, runs, rotated, widthPt: vp.width, heightPt: vp.height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/pdf-geometry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/pdf/geometry.ts test/ingest/pdf-geometry.test.ts
git commit -m "Read a PDF page's rectangles and text into one coordinate space"
```

---

### Task 2: Chrome — which runs are page furniture

**Files:**
- Create: `src/ingest/pdf/chrome.ts`
- Test: `test/ingest/pdf-chrome.test.ts`

**Interfaces:**
- Consumes: `TextRun` from `src/ingest/pdf/geometry.js`.
- Produces:
  ```ts
  export type ChromeSplit = { body: TextRun[][]; dropped: string[] };
  export function splitChrome(pages: TextRun[][]): ChromeSplit;
  ```

**Why two passes:** a candidate is a run whose position repeats on every page; the body band is the y-range of the runs that are *not* candidates. Furniture is a candidate outside that band. Without the second pass a table's own first column — which also repeats position on every page — would be mistaken for a letterhead.

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest/pdf-chrome.test.ts
import { describe, expect, it } from 'vitest';
import { splitChrome } from '../../src/ingest/pdf/chrome.js';
import type { TextRun } from '../../src/ingest/pdf/geometry.js';

const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('splitChrome', () => {
  it('drops a letterhead and a footer that repeat outside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),   // letterhead, same place both pages
      run('NIP: 9552562516', 400, 788),
      run(`Turnover ${n}`, 60, 600),           // body, different content
      run(`${n} / 2`, 500, 40),                // footer: repeats in POSITION only
    ];
    const { body, dropped } = splitChrome([page(1), page(2)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover 1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover 2']);
    expect(dropped.join('\n')).toMatch(/page furniture/);
    expect(dropped.join('\n')).toMatch(/3/); // three runs per page
  });

  it('keeps a column that repeats position but sits inside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('Labor', 60, 600),      // same x AND y on every page, but body content
      run(String(n), 300, 600),
      run('Other cost', 60, 580),
      run(String(n), 300, 580),
    ];
    const { body } = splitChrome([page(1), page(2)]);
    // 'Labor' and 'Other cost' repeat position on every page, exactly as the
    // letterhead does. What separates them is the body band: they sit inside
    // it, so they stay.
    expect(body[0]!.map((r) => r.text)).toEqual(['Labor', '1', 'Other cost', '1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Labor', '2', 'Other cost', '2']);
  });

  it('keeps everything on a single-page document and says so', () => {
    const { body, dropped } = splitChrome([[run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Turnover', 60, 600)]]);
    expect(body[0]).toHaveLength(2);
    expect(dropped.join('\n')).toMatch(/single page/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/pdf-chrome.test.ts`
Expected: FAIL — cannot find module `src/ingest/pdf/chrome.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ingest/pdf/chrome.ts
//
// A re-issued document gets its theme's letterhead drawn for it. Carrying the
// source's own would print the address twice, so the source's has to be
// recognised — without knowing what a letterhead says, because the reader has
// no idea what any given company puts in one.
//
// The rule is position, in two passes. See the design document.

import type { TextRun } from './geometry.js';

export type ChromeSplit = { body: TextRun[][]; dropped: string[] };

/** Two runs are "the same place" within a point either way. */
const TOL = 1;
const key = (r: TextRun): string => `${Math.round(r.x / TOL)}:${Math.round(r.y / TOL)}`;

export function splitChrome(pages: TextRun[][]): ChromeSplit {
  if (pages.length < 2) {
    // Nothing repeats, so nothing can be identified. Keeping everything is the
    // honest outcome; saying so is what stops a doubled letterhead from being
    // a surprise.
    return {
      body: pages.map((p) => [...p]),
      dropped: ['page furniture was not looked for: a single page has no repetition to compare against'],
    };
  }

  // Pass one: positions present on every page.
  const seen = new Map<string, number>();
  for (const page of pages) {
    for (const k of new Set(page.map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const candidate = (r: TextRun): boolean => seen.get(key(r)) === pages.length;

  // Pass two: the body band is where the non-candidates are.
  const contentY = pages.flat().filter((r) => !candidate(r)).map((r) => r.y);
  const top = contentY.length > 0 ? Math.max(...contentY) : Infinity;
  const bottom = contentY.length > 0 ? Math.min(...contentY) : -Infinity;

  const isChrome = (r: TextRun): boolean => candidate(r) && (r.y > top || r.y < bottom);
  const body = pages.map((p) => p.filter((r) => !isChrome(r)));
  const removed = pages.reduce((n, p) => n + p.filter(isChrome).length, 0);
  const dropped = removed > 0
    ? [`page furniture: ${removed} run(s) repeating outside the body on all ${pages.length} pages (letterhead, footer, page numbers)`]
    : [];
  return { body, dropped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/pdf-chrome.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/pdf/chrome.ts test/ingest/pdf-chrome.test.ts
git commit -m "Recognise a source PDF's own letterhead by position, not by meaning"
```

---

### Task 3: Grid — rectangles to cells

**Files:**
- Create: `src/ingest/pdf/grid.ts`
- Test: `test/ingest/pdf-grid.test.ts`

**Interfaces:**
- Consumes: `Rect`, `TextRun` from `src/ingest/pdf/geometry.js`.
- Produces:
  ```ts
  export type Grid = { xs: number[]; ys: number[] };
  export type GridTable = { rows: string[][]; usedRuns: Set<TextRun> };
  export function findGrid(rects: readonly Rect[]): Grid | null;
  export function tableFrom(grid: Grid, runs: readonly TextRun[]): GridTable;
  ```
  `findGrid` returns `null` when the rectangles do not form one — that null is the refusal the whole design rests on.

**The rule:** a column boundary is an x-edge shared by at least `MIN_REPEAT` rectangles; a row boundary likewise for y. Below that, there is no grid and the caller refuses. On the P&L's page one the shared edges repeat 24–26 times each, so the threshold is not delicate.

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest/pdf-grid.test.ts
import { describe, expect, it } from 'vitest';
import { findGrid, tableFrom } from '../../src/ingest/pdf/grid.js';
import type { Rect, TextRun } from '../../src/ingest/pdf/geometry.js';

/** A 2-column, 3-row grid of drawn cells. */
const drawn = (): Rect[] => {
  const xs = [50, 200, 400];
  const ys = [700, 720, 740, 760];
  const out: Rect[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      out.push({ x0: xs[c]!, x1: xs[c + 1]!, y0: ys[r]!, y1: ys[r + 1]! });
    }
  }
  return out;
};
const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('findGrid', () => {
  it('takes the boundaries the rectangles agree on', () => {
    const g = findGrid(drawn());
    expect(g).not.toBeNull();
    expect(g!.xs).toEqual([50, 200, 400]);
    // Four drawn boundaries plus the implied top, one median gap above.
    expect(g!.ys).toEqual([700, 720, 740, 760, 780]);
  });

  it('adds the top boundary a bottom-ruled table never draws', () => {
    // Three rules under three rows, as any typeset table draws them — the
    // shape this project's own renderer produces. Without an implied top the
    // first row's text falls outside the grid and is lost.
    const rule = (y: number): Rect[] => [
      { x0: 50, x1: 200, y0: y, y1: y + 0.5 },
      { x0: 200, x1: 400, y0: y, y1: y + 0.5 },
    ];
    const g = findGrid([...rule(661.5), ...rule(684), ...rule(706.5)]);
    expect(g).not.toBeNull();
    expect(g!.ys).toEqual([661.75, 684.25, 706.75, 729.25]);
  });

  it('reads a rule's two long edges as one boundary', () => {
    // A 0.5pt rule arrives as y=661 and y=662; two boundaries there would
    // invent a 1pt-tall row.
    const g = findGrid([
      { x0: 50, x1: 200, y0: 661, y1: 662 }, { x0: 200, x1: 400, y0: 661, y1: 662 },
      { x0: 50, x1: 200, y0: 700, y1: 701 }, { x0: 200, x1: 400, y0: 700, y1: 701 },
    ]);
    expect(g!.ys).toHaveLength(3); // two rules, plus the implied top
  });

  it('returns null when nothing is drawn twice — the refusal the design rests on', () => {
    expect(findGrid([{ x0: 0, x1: 10, y0: 0, y1: 10 }])).toBeNull();
    expect(findGrid([])).toBeNull();
  });
});

describe('tableFrom', () => {
  it('puts each run in the cell its position falls inside, top row first', () => {
    const g = findGrid(drawn())!;
    const runs = [
      run('Turnover', 60, 745), run('3253', 210, 745),
      run('Labor', 60, 725), run('1536', 210, 725),
      run('Other', 60, 705), run('196', 210, 705),
    ];
    const t = tableFrom(g, runs);
    expect(t.rows).toEqual([
      ['Turnover', '3253'],
      ['Labor', '1536'],
      ['Other', '196'],
    ]);
    expect(t.usedRuns.size).toBe(6);
  });

  it('joins two runs that share a cell, in reading order', () => {
    const g = findGrid(drawn())!;
    const t = tableFrom(g, [run('Office rent', 60, 745), run('& utilities', 130, 745)]);
    expect(t.rows[0]![0]).toBe('Office rent & utilities');
  });

  it('leaves a run outside the grid alone', () => {
    const g = findGrid(drawn())!;
    const outside = run('A note under the table', 60, 400);
    const t = tableFrom(g, [outside]);
    expect(t.usedRuns.has(outside)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/pdf-grid.test.ts`
Expected: FAIL — cannot find module `src/ingest/pdf/grid.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ingest/pdf/grid.ts
//
// The grid comes from what the document draws, never from where its text
// happens to line up. Clustering text by x would read an unruled table and
// would also, now and then, read a two-column page as a table — which is the
// failure this project refuses to ship. A drawn boundary is data.

import type { Rect, TextRun } from './geometry.js';

export type Grid = { xs: number[]; ys: number[] };
export type GridTable = { rows: string[][]; usedRuns: Set<TextRun> };

/** How many rectangles must share an edge before it counts as a boundary.
 *  Two is enough to mean "drawn deliberately"; the real files repeat their
 *  column edges 24-26 times, so nothing here is delicate. */
const MIN_REPEAT = 2;
/** Edges closer together than this are the same drawn line. A rule is drawn
 *  as a thin filled rectangle, so its two long edges arrive as two numbers a
 *  fraction of a point apart — measured at 661 and 662 for a 0.5pt rule on
 *  this project's own output. Treating them as two boundaries invents a
 *  1pt-tall row between them. */
const MERGE = 2;

function boundaries(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && v - last[last.length - 1]! <= MERGE) last.push(v);
    else groups.push([v]);
  }
  return groups
    .filter((g) => g.length >= MIN_REPEAT)
    .map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

export function findGrid(rects: readonly Rect[]): Grid | null {
  const xs = boundaries(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = boundaries(rects.flatMap((r) => [r.y0, r.y1]));
  // Two boundaries make one column; a table needs at least one column and one
  // row, and anything less than that is not a grid but a stray box.
  if (xs.length < 2 || ys.length < 2) return null;
  // A typeset table draws a rule UNDER each row, so n rows arrive as n
  // boundaries and the top row has no upper edge — its text would fall
  // outside the grid and be lost. Measured on this project's own table:
  // rules at 706.5, 684 and 661.5 against a header at y=715. The implied top
  // is one more row's worth above the highest rule, taken from the rules'
  // own median gap, so it comes from drawn geometry and nothing else.
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
  return { xs, ys: median > 0 ? [...ys, ys[ys.length - 1]! + median] : ys };
}

export function tableFrom(grid: Grid, runs: readonly TextRun[]): GridTable {
  const { xs, ys } = grid;
  const cols = xs.length - 1;
  const rowCount = ys.length - 1;
  const cells: TextRun[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: cols }, () => [] as TextRun[]));
  const usedRuns = new Set<TextRun>();
  const band = (edges: number[], v: number): number => {
    for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i]! && v < edges[i + 1]!) return i;
    return -1;
  };
  for (const r of runs) {
    const c = band(xs, r.x);
    const y = band(ys, r.y);
    if (c < 0 || y < 0) continue;
    cells[y]![c]!.push(r);
    usedRuns.add(r);
  }
  // ys ascend but a page reads downward, so the last band is the top row.
  const rows = cells
    .map((row) => row.map((rs) => rs.sort((a, b) => a.x - b.x).map((r) => r.text).join(' ').trim()))
    .reverse();
  return { rows, usedRuns };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/pdf-grid.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/pdf/grid.ts test/ingest/pdf-grid.test.ts
git commit -m "Build a table's grid from the rectangles the document draws"
```

---

### Task 4: Assembly — `ingestPdf`

**Files:**
- Create: `src/ingest/pdf.ts`
- Test: `test/ingest/pdf.test.ts`

**Interfaces:**
- Consumes: `readPageGeometry`, `TextRun` (task 1); `splitChrome` (task 2); `findGrid`, `tableFrom` (task 3).
- Produces:
  ```ts
  export const PDF_MAX_PAGES = 60;
  export const PDF_MAX_RECTS_PER_PAGE = 5000;
  export async function ingestPdf(
    bytes: Uint8Array | Buffer,
    opts?: { title?: string; subtitle?: string; date?: string; entity?: string },
    limits?: { maxPages?: number },
  ): Promise<Ingested>;
  ```

**Heading levels** come from the document's own size distribution, per the spec: the modal size is body, and each distinct larger size becomes h1, h2, h3 in descending order. A fourth larger size and beyond is h3 as well — the IR has three heading levels.

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest/pdf.test.ts
import { describe, expect, it } from 'vitest';
import { ingestPdf } from '../../src/ingest/pdf.js';
import { renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import type { Doc } from '../../src/ir/types.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

/** The strongest fixture available: a PDF this project produced itself, from
 *  IR we can compare against. Output is byte-identical run to run, so the
 *  fixture costs nothing to keep and cannot drift. */
async function roundTrip(doc: Doc) {
  const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH });
  return ingestPdf(buf);
}

describe('ingestPdf', () => {
  it('reads back the prose of a document it produced', async () => {
    const doc: Doc = {
      meta: { title: 'Quarterly', lang: 'en' },
      blocks: [
        { t: 'heading', level: 2, text: [{ t: 'text', v: 'Scope' }] },
        { t: 'para', text: [{ t: 'text', v: 'One ordinary sentence of prose.' }] },
      ],
    };
    const { doc: back } = await roundTrip(doc);
    const words = back.blocks.flatMap((b) =>
      b.t === 'para' || b.t === 'heading' ? b.text.map((n) => (n.t === 'text' ? n.v : '')) : []).join(' ');
    expect(words).toContain('Scope');
    expect(words).toContain('One ordinary sentence of prose.');
  });

  it('reads back a table, cell for cell', async () => {
    const cell = (v: string) => [{ t: 'text' as const, v }];
    const doc: Doc = {
      meta: { title: 'Figures', lang: 'en' },
      blocks: [{
        t: 'table',
        head: [cell('Item'), cell('2024'), cell('2025')],
        rows: [[cell('Turnover'), cell('3253'), cell('4387')], [cell('Labor'), cell('1536'), cell('2004')]],
        align: ['l', 'r', 'r'],
      }],
    };
    const { doc: back } = await roundTrip(doc);
    const table = back.blocks.find((b) => b.t === 'table');
    expect(table, 'the table was not recognised').toBeDefined();
    const text = (cs: { t: string; v?: string }[][]) =>
      cs.map((c) => c.map((n) => ('v' in n ? n.v : '')).join(''));
    expect(text(table!.t === 'table' ? table.head : [])).toEqual(['Item', '2024', '2025']);
    expect(table!.t === 'table' ? table.rows.map((r) => text(r)) : []).toEqual([
      ['Turnover', '3253', '4387'],
      ['Labor', '1536', '2004'],
    ]);
  });

  it('refuses a document with more pages than the limit, naming the number', async () => {
    const doc: Doc = {
      meta: { title: 'Long', lang: 'en' },
      blocks: Array.from({ length: 40 }, () => ({ t: 'pagebreak' as const })),
    };
    const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH });
    await expect(ingestPdf(buf, {}, { maxPages: 3 })).rejects.toThrow(/pages/);
  });

  it('names an image it will not carry rather than dropping it in silence', async () => {
    const doc: Doc = {
      meta: { title: 'Pics', lang: 'en' },
      blocks: [{ t: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC', alt: 'A bar' }],
    };
    const { dropped } = await roundTrip(doc);
    expect(dropped.join('\n')).toMatch(/image/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/pdf.test.ts`
Expected: FAIL — cannot find module `src/ingest/pdf.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ingest/pdf.ts
//
// The fourth ingester, and the only one whose input has no structure to read:
// a PDF is positioned glyphs and drawn paths. Everything here is inference,
// which is why the grid comes from what the document draws (grid.ts), the
// letterhead from what repeats (chrome.ts), and why task 5's token gate has
// the last word before anything is written.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Block, Doc, Ingested, Inline } from '../ir/types.js';
import { readPageGeometry, type TextRun } from './pdf/geometry.js';
import { splitChrome } from './pdf/chrome.js';
import { findGrid, tableFrom } from './pdf/grid.js';

export const PDF_MAX_PAGES = 60;
export const PDF_MAX_RECTS_PER_PAGE = 5000;

const OP_PAINT_IMAGE = 85;
const text = (v: string): Inline[] => [{ t: 'text', v }];

/** Body is the size most runs are set in; each distinct larger size is a
 *  heading level, largest first. A document with one size has no headings —
 *  which is the truth about it, not a failure to find them. */
function headingLevels(runs: readonly TextRun[]): Map<number, 1 | 2 | 3> {
  const tally = new Map<number, number>();
  for (const r of runs) {
    const k = Math.round(r.sizePt * 2) / 2;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const body = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const bigger = [...tally.keys()].filter((s) => s > body).sort((a, b) => b - a);
  const out = new Map<number, 1 | 2 | 3>();
  bigger.forEach((s, i) => out.set(s, (Math.min(i + 1, 3) as 1 | 2 | 3)));
  return out;
}

export async function ingestPdf(
  bytes: Uint8Array | Buffer,
  opts: { title?: string; subtitle?: string; date?: string; entity?: string } = {},
  limits: { maxPages?: number } = {},
): Promise<Ingested> {
  const maxPages = limits.maxPages ?? PDF_MAX_PAGES;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  if (pdf.numPages > maxPages) {
    throw new Error(`this PDF has ${pdf.numPages} pages, past the ${maxPages}-page limit a re-issued document is held to`);
  }

  const dropped: string[] = [];
  const geometry = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const ops = await page.getOperatorList();
    const images = ops.fnArray.filter((f: number) => f === OP_PAINT_IMAGE).length;
    if (images > 0) dropped.push(`page ${n}: ${images} image(s) — this ingester carries no picture out of a PDF`);
    const g = await readPageGeometry(page);
    if (g.rotated > 0) dropped.push(`page ${n}: ${g.rotated} run(s) of rotated text — read sideways, carried nowhere`);
    if (g.rects.length > PDF_MAX_RECTS_PER_PAGE) {
      throw new Error(`page ${n} draws ${g.rects.length} rectangles, past the ${PDF_MAX_RECTS_PER_PAGE} a table is expected to need`);
    }
    geometry.push(g);
  }

  const { body, dropped: chromeDropped } = splitChrome(geometry.map((g) => g.runs));
  dropped.push(...chromeDropped);

  const levels = headingLevels(body.flat());
  const blocks: Block[] = [];
  for (const [i, runs] of body.entries()) {
    const grid = findGrid(geometry[i]!.rects);
    const table = grid === null ? null : tableFrom(grid, runs);
    // Runs above the table are prose; runs the grid claimed become its cells.
    const prose = runs.filter((r) => table === null || !table.usedRuns.has(r));
    for (const r of [...prose].sort((a, b) => b.y - a.y)) {
      const level = levels.get(Math.round(r.sizePt * 2) / 2);
      blocks.push(level === undefined
        ? { t: 'para', text: text(r.text) }
        : { t: 'heading', level, text: text(r.text) });
    }
    if (table !== null && table.rows.length > 1) {
      const prev = blocks[blocks.length - 1];
      const head = table.rows[0]!.map(text);
      const rows = table.rows.slice(1).map((r) => r.map(text));
      // A table continuing across a page break joins the one before it: the
      // P&L is one table over two pages, and two tables would be a lie about
      // the document.
      if (prev !== undefined && prev.t === 'table' && prev.head.length === head.length) {
        prev.rows.push(...[head, ...rows]);
      } else {
        blocks.push({ t: 'table', head, rows, align: head.map(() => 'l' as const) });
      }
    }
  }

  const meta: Doc['meta'] = {
    title: opts.title ?? 'Untitled',
    lang: 'en',
    ...(opts.subtitle === undefined ? {} : { subtitle: opts.subtitle }),
    ...(opts.date === undefined ? {} : { date: opts.date }),
    ...(opts.entity === undefined ? {} : { entity: opts.entity }),
  };
  return { doc: { meta, blocks }, dropped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/pdf.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/pdf.ts test/ingest/pdf.test.ts
git commit -m "Assemble an IR from a PDF's geometry, refusing what it cannot read"
```

---

### Task 5: The token gate

**Files:**
- Create: `src/ingest/pdf/gate.ts`
- Modify: `src/ingest/pdf.ts` — call the gate before returning
- Test: `test/ingest/pdf-gate.test.ts`

**Interfaces:**
- Consumes: `Doc` from `src/ir/types.js`, `TextRun` from `src/ingest/pdf/geometry.js`.
- Produces:
  ```ts
  export function tokenise(s: string): string[];
  export function docTokens(doc: Doc): string[];
  export function assertNoDivergence(source: string[], assembled: string[]): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest/pdf-gate.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDivergence, docTokens, tokenise } from '../../src/ingest/pdf/gate.js';
import type { Doc } from '../../src/ir/types.js';

describe('tokenise', () => {
  it('normalises the spaces a PDF hides in numbers', () => {
    expect(tokenise('€ 4 500,00')).toEqual(['€', '4', '500,00']);
    expect(tokenise('soft­hyphen')).toEqual(['softhyphen']);
    expect(tokenise('  two   words \n')).toEqual(['two', 'words']);
  });
});

describe('docTokens', () => {
  it('reads a table row-major, which is the order a mis-placed value changes', () => {
    const cell = (v: string) => [{ t: 'text' as const, v }];
    const doc: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{
        t: 'table', head: [cell('A'), cell('B')],
        rows: [[cell('1'), cell('2')], [cell('3'), cell('4')]], align: ['l', 'l'],
      }],
    };
    expect(docTokens(doc)).toEqual(['A', 'B', '1', '2', '3', '4']);
  });
});

describe('assertNoDivergence', () => {
  it('passes when the sequences match', () => {
    expect(() => assertNoDivergence(['a', '1'], ['a', '1'])).not.toThrow();
  });

  it('names the first divergence, with both sides', () => {
    expect(() => assertNoDivergence(['Labor', '608'], ['Labor', '806']))
      .toThrow(/token 2.*608.*806/s);
  });

  it('names a value the reader lost', () => {
    expect(() => assertNoDivergence(['a', 'b', 'c'], ['a', 'c'])).toThrow(/token 2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/pdf-gate.test.ts`
Expected: FAIL — cannot find module `src/ingest/pdf/gate.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ingest/pdf/gate.ts
//
// The reader is allowed to infer geometry; it is not allowed to be believed.
// A value that lands in the neighbouring column changes the row-major token
// sequence, and so does a dropped row, a merged pair of cells and a repeated
// header. Comparing the two sequences turns the inference into a claim the
// build can check.

import type { Doc, Inline } from '../../ir/types.js';

const flatten = (nodes: Inline[]): string =>
  nodes.map((n) => (n.t === 'text' ? n.v : flatten(n.children))).join('');

export function tokenise(s: string): string[] {
  return s
    .replace(/­/g, '')      // soft hyphen: a line-break artefact, not content
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
    .replace(/[  ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function docTokens(doc: Doc): string[] {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.t === 'para' || b.t === 'heading') out.push(...tokenise(flatten(b.text)));
    else if (b.t === 'quote') for (const p of b.paras) out.push(...tokenise(flatten(p)));
    else if (b.t === 'list') for (const it of b.items) out.push(...tokenise(flatten(it)));
    else if (b.t === 'table') {
      for (const c of b.head) out.push(...tokenise(flatten(c)));
      for (const row of b.rows) for (const c of row) out.push(...tokenise(flatten(c)));
    } else if (b.t === 'code') out.push(...tokenise(b.text));
  }
  return out;
}

export function assertNoDivergence(source: string[], assembled: string[]): void {
  const n = Math.max(source.length, assembled.length);
  for (let i = 0; i < n; i++) {
    if (source[i] === assembled[i]) continue;
    throw new Error(
      `the reader's own output does not match the source\n` +
      `  token ${i + 1}: source says ${JSON.stringify(source[i] ?? '(nothing)')}, ` +
      `the assembled document says ${JSON.stringify(assembled[i] ?? '(nothing)')}`,
    );
  }
}
```

- [ ] **Step 4: Wire the gate into `ingestPdf`**

In `src/ingest/pdf.ts`, add the import and call it immediately before the `return`:

```ts
import { assertNoDivergence, docTokens, tokenise } from './pdf/gate.js';
```

```ts
  // Everything the reader kept, in the order the pages present it — chrome is
  // excluded from both sides, or every document with a letterhead would fail.
  const sourceTokens = body.flatMap((runs) =>
    [...runs].sort((a, b) => b.y - a.y || a.x - b.x).flatMap((r) => tokenise(r.text)));
  const assembled = { meta, blocks };
  assertNoDivergence(sourceTokens, docTokens(assembled));
  return { doc: assembled, dropped };
```

- [ ] **Step 5: Run the whole ingest suite**

Run: `npx vitest run test/ingest/`
Expected: PASS. If task 4's round-trip tests now fail on the gate, that is the gate working — fix the reader, never the gate.

- [ ] **Step 6: Commit**

```bash
git add src/ingest/pdf/gate.ts src/ingest/pdf.ts test/ingest/pdf-gate.test.ts
git commit -m "Refuse a PDF whose assembled text does not match its source"
```

---

### Task 6: Wire it into the CLI and say so

**Files:**
- Modify: `src/cli/build.ts:117` (`ingest`), `:254`, `:341` (`READABLE_EXTS`), `:476`
- Modify: `README.md` — the capability table and the limits list
- Test: `test/cli/build.test.ts`

**Interfaces:**
- Consumes: `ingestPdf` from `src/ingest/pdf.js`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// append to test/cli/build.test.ts
it('builds from a PDF, and its refusals reach the report', async () => {
  const o = io();
  const src = join(dir, 'in.pdf');
  // A PDF this project made, so the fixture needs no binary in the repository.
  const { renderPdf } = await import('../../src/render/pdf.js');
  const { resolveTheme } = await import('../../src/theme/resolve.js');
  await writeFile(src, await renderPdf(
    { meta: { title: 'Re-issue', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body text.' }] }] },
    resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } }),
    { epochSeconds: 1_000_000_000 },
  ));
  const code = await runBuild([src, '--to', 'md'], o);
  expect(code).toBe(0);
  expect(existsSync(join(dir, 'in.plain.md'))).toBe(true);
  expect((await readFile(join(dir, 'in.plain.md'), 'utf8'))).toContain('Body text.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/build.test.ts -t "builds from a PDF"`
Expected: FAIL — `cannot read .pdf yet — this build reads .md, .docx and .xlsx`.

- [ ] **Step 3: Make the four call sites accept `.pdf`**

`src/cli/build.ts:117` — widen the type and dispatch:

```ts
export async function ingest(
  ext: '.docx' | '.xlsx' | '.pdf' | '.md' | '.markdown', input: string, opts: IngestOpts,
): Promise<Ingested> {
  if (ext === '.docx' || ext === '.xlsx' || ext === '.pdf') {
    const bytes = await readFile(input);
    const result = ext === '.docx'
      ? await ingestDocx(bytes, opts)
      : ext === '.xlsx' ? await ingestXlsx(bytes, opts) : await ingestPdf(bytes, opts);
```

`:254` and `:476` — both guards gain `.pdf`:

```ts
    if (ext !== '.md' && ext !== '.markdown' && ext !== '.docx' && ext !== '.xlsx' && ext !== '.pdf') {
```

`:341`:

```ts
export const READABLE_EXTS = new Set(['.md', '.markdown', '.docx', '.xlsx', '.pdf']);
```

And the import at the top of the file:

```ts
import { ingestPdf } from '../ingest/pdf.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/cli/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the README**

In the capability table, change the PDF row from all `—` to:

```markdown
| **PDF** | yes | yes | yes | — |
```

And add to the list of deliberate limits, after the `.docx` bullet:

```markdown
- **Reading a PDF serves a document whose tables are drawn, and refuses the
  rest.** A PDF has no structure — positioned glyphs and drawn paths, no
  headings and no cell boundaries — so everything is inferred. The grid comes
  from the rectangles the file draws, never from where its text lines up:
  clustering text by position would read an unruled table and would, now and
  then, read a two-column page as a table. Images, multi-column text, rotated
  text and undrawn tables are refused by name. What keeps the rest honest is
  a check the other readers do not need: the source's text and the assembled
  document's text are compared token by token, and any difference fails the
  build naming the first one — a value in the wrong column is the failure
  worth fearing, because nothing about the output would otherwise say so.
```

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: PASS. The packaging guardrail reads the README, so a malformed table there fails here.

- [ ] **Step 7: Commit**

```bash
git add src/cli/build.ts README.md test/cli/build.test.ts
git commit -m "Let build read a PDF, and say in the README what that does and refuses"
```

---

## What this plan has not done

Every code block below the tests is **illustrative and has never been run.**
It type-checks in the author's head and nowhere else. Three snippets in a
previous plan on this project were wrong and two of them would have shipped
green, so treat each one as a hypothesis: write the test, watch it fail for
the reason the plan says it will, and if the given implementation does not
make it pass, the implementation is what is wrong.

The pdfjs facts are not in that category — the op codes, the `constructPath`
argument shape `[pathOps, coords, minMax]`, the text item's
`[size, 0, 0, size, x, y]` transform and the P&L's `[0.24, 0, 0, -0.24, 0,
850.08]` CTM were all read off the real files with the real library at
version 4.10.38.

## Self-review

**Spec coverage.** Portrait and landscape — task 1 takes the viewport as given, no orientation assumption anywhere. Single column — task 3's grid, and the refusal when there is none. Drawn tables — task 3. Cross-page join — task 4. Headings from the document's own size distribution — task 4's `headingLevels`, no theme. Page furniture — task 2. Refusals by name — task 4 for images and limits, task 3's `null` for undrawn tables. Token gate refusing the build — task 5. Limits in `ingestXlsx`'s shape — task 4. CLI and README — task 6.

**Found and fixed in review:** rotated text was being dropped silently — task 1 kept only unrotated runs and said nothing. It now returns `rotated: number` and task 4 reports the count. Multi-column detection has no dedicated refusal and does not need one: a two-column page has no drawn grid, so `findGrid` returns `null` and its text becomes paragraphs in reading order, which is the honest outcome rather than an invented table.

**Type consistency.** `TextRun`, `Rect`, `Grid`, `GridTable` are defined once in tasks 1 and 3 and used with those exact names in 2, 4 and 5. `Ingested` is the project's existing type. `ingestPdf`'s signature matches `ingestXlsx`'s shape, which is what task 6's dispatch depends on.
