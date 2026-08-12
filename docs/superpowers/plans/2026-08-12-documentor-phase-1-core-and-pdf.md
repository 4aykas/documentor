# documentor Phase 1 — Core and the PDF path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a Markdown file into a reproducible, themed A4 PDF (and a clean Markdown file) through a format-agnostic intermediate representation, proving the whole architecture on the shortest path.

**Architecture:** `ingest/` parses a source file into a flat `Doc` (the IR). `render/` turns a `Doc` plus a resolved `Theme` into bytes. Nothing in `ir/` knows about any file format, and no ingester imports a renderer. The PDF renderer builds one self-contained HTML string — inline CSS, inline SVG, fonts as base64 data-URIs — and hands it to headless Chromium, then rewrites the two date fields in the output so two runs produce identical bytes.

**Tech Stack:** TypeScript (ESM, `"module": "nodenext"`), Node 22+, vitest, `marked` (Markdown lexer), `playwright-core` (Chromium), `@fontsource/arimo` (embedded font), `pdfjs-dist` (text extraction in tests), `pdf-to-img` (rasterising in tests), `pdf-lib` (structural assertions in tests).

## Global Constraints

- **Package name** `@tebin/documentor`. **License MIT.** Public repository.
- **Node engines** `>=22`. Developed on v26.2.0.
- **ESM only.** `"type": "module"` in `package.json`, `"module": "nodenext"` and `"moduleResolution": "nodenext"` in `tsconfig.json`. Relative imports carry the `.js` extension.
- **No external binary except Chromium.** Never add Pandoc, LaTeX, or any Python dependency.
- **The PDF renderer fetches nothing.** Every asset — CSS, font, logo — is inlined into the HTML string before Chromium sees it.
- **No `Date.now()`, no `new Date()` with no argument, anywhere in `src/`.** Timestamps come from `SOURCE_DATE_EPOCH` (seconds, as a string) or the input file's mtime. A test enforces this by grep.
- **Byte-identical output.** `build` run twice on the same input must produce identical bytes. This is a test, not an aspiration.
- **Caches live outside the synced tree.** The repo sits inside `OneDrive - TEBIN`. `vitest.config.ts` sets `cacheDir` to `join(tmpdir(), 'documentor-vite-cache')`. See `onedrive-sync-dev-traps`.
- **`page.pdf()` margins reject `pt`.** Accepted units are `px`, `in`, `cm`, `mm`. The theme stores points; the PDF renderer converts with `pt * 0.352778 → mm`.
- **Never assert on a PDF by searching its bytes for a phrase.** Chromium embeds fonts as Identity-H subsets, so the operands are glyph indices. Text assertions go through `pdfjs-dist/legacy`; appearance assertions go through a raster.
- **Copy is in English.** Code comments explain *why*, not *what*.

---

### Task 1: Project scaffold and the IR

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`
- Create: `src/ir/types.ts`
- Create: `src/ir/validate.ts`
- Test: `test/ir/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `Inline`, `Block`, `Doc`, `Ingested` types and `validateDoc(doc: unknown): asserts doc is Doc`. Every later task imports from `src/ir/types.js`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@tebin/documentor",
  "version": "0.1.0",
  "description": "Re-issue existing documents as well-typeset, themed PDF, Word, Excel and Markdown",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": { "documentor": "./dist/bin/documentor.js" },
  "files": ["dist", "themes", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "documentor": "tsx src/bin/documentor.ts"
  },
  "dependencies": {
    "@fontsource/arimo": "^5.2.5",
    "marked": "^15.0.0",
    "playwright-core": "^1.62.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "pdf-lib": "^1.17.1",
    "pdf-to-img": "^4.4.0",
    "pdfjs-dist": "^4.10.38",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Then run `npm install`. If a version above does not resolve, install the nearest published version and record what you used in the commit message — do not silently drop a dependency.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

The `cacheDir` line is not optional — see the Global Constraints note on OneDrive.

```ts
import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  // OneDrive holds file handles while it syncs and breaks Vite's atomic
  // directory renames, corrupting the dep cache. Keep it out of the synced tree.
  cacheDir: join(tmpdir(), 'documentor-vite-cache'),
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000, // launching Chromium and rasterising is not fast
  },
});
```

- [ ] **Step 4: Create `.gitignore` and `LICENSE`**

`.gitignore`:

```
node_modules/
dist/
*.log
test/**/__actual__/
```

`LICENSE`: the standard MIT text, copyright holder `TEBIN`, year `2026`.

- [ ] **Step 5: Write the failing test**

Create `test/ir/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateDoc } from '../../src/ir/validate.js';

const good = {
  meta: { title: 'T', lang: 'en' },
  blocks: [{ t: 'para', text: [{ t: 'text', v: 'hello' }] }],
};

describe('validateDoc', () => {
  it('accepts a minimal document', () => {
    expect(() => validateDoc(good)).not.toThrow();
  });

  it('rejects a document with no meta.title', () => {
    expect(() => validateDoc({ meta: { lang: 'en' }, blocks: [] }))
      .toThrow(/meta\.title/);
  });

  it('rejects an unknown block type', () => {
    expect(() => validateDoc({ ...good, blocks: [{ t: 'marquee' }] }))
      .toThrow(/marquee/);
  });

  it('rejects a heading level outside 1..3', () => {
    const doc = { ...good, blocks: [{ t: 'heading', level: 4, text: [] }] };
    expect(() => validateDoc(doc)).toThrow(/level/);
  });

  it('names the index of the offending block', () => {
    const doc = { ...good, blocks: [good.blocks[0], { t: 'nope' }] };
    expect(() => validateDoc(doc)).toThrow(/blocks\[1\]/);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run test/ir/validate.test.ts`
Expected: FAIL — cannot resolve `../../src/ir/validate.js`.

- [ ] **Step 7: Write `src/ir/types.ts`**

```ts
// The intermediate representation every ingester produces and every renderer
// consumes. Flat on purpose: DOCX is a paragraph sequence, XLSX is rows and PDF
// is a flow, so a tree would only be unwound again in each of the four.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'code'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export type Align = 'l' | 'r' | 'c';

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { t: 'para'; text: Inline[] }
  | { t: 'list'; ordered: boolean; depth: number; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: Align[]; landscape?: boolean }
  | { t: 'image'; src: string; alt: string; widthPt?: number }
  | { t: 'code'; lang?: string; text: string }
  | { t: 'quote'; paras: Inline[][] }
  | { t: 'rule' }
  | { t: 'pagebreak' };

export type Meta = {
  title: string;
  subtitle?: string;
  date?: string;   // ISO 8601 date, rendered by the theme's locale rules
  entity?: string;
  lang: string;    // BCP 47; drives hyphenation and quotation marks
};

export type Doc = { meta: Meta; blocks: Block[] };

/**
 * What an ingester returns. `dropped` names everything the source contained
 * that the IR cannot hold, so the CLI can print it. Silent loss is the failure
 * mode this type exists to prevent.
 */
export type Ingested = { doc: Doc; dropped: string[] };
```

Note the `table.rows` type: a table row is `Inline[][]` (a row of cells, each cell a run of inlines), so `rows` is `Inline[][][]`. `head` is one row, hence `Inline[][]`.

- [ ] **Step 8: Write `src/ir/validate.ts`**

```ts
import type { Align, Block, Doc, Inline } from './types.js';

const BLOCK_TYPES = new Set([
  'heading', 'para', 'list', 'table', 'image', 'code', 'quote', 'rule', 'pagebreak',
]);
const INLINE_TYPES = new Set(['text', 'strong', 'em', 'code', 'link']);
const ALIGNS = new Set<Align>(['l', 'r', 'c']);

function fail(where: string, why: string): never {
  throw new Error(`invalid document at ${where}: ${why}`);
}

function checkInlines(v: unknown, where: string): void {
  if (!Array.isArray(v)) fail(where, 'expected an array of inlines');
  v.forEach((node, i) => {
    const at = `${where}[${i}]`;
    if (typeof node !== 'object' || node === null) fail(at, 'expected an object');
    const n = node as Record<string, unknown>;
    if (typeof n['t'] !== 'string' || !INLINE_TYPES.has(n['t'])) {
      fail(at, `unknown inline type ${JSON.stringify(n['t'])}`);
    }
    if (n['t'] === 'text') {
      if (typeof n['v'] !== 'string') fail(at, 'text inline needs a string v');
      return;
    }
    if (n['t'] === 'link' && typeof n['href'] !== 'string') {
      fail(at, 'link inline needs a string href');
    }
    checkInlines(n['children'], `${at}.children`);
  });
}

function checkBlock(b: unknown, where: string): void {
  if (typeof b !== 'object' || b === null) fail(where, 'expected an object');
  const n = b as Record<string, unknown>;
  const t = n['t'];
  if (typeof t !== 'string' || !BLOCK_TYPES.has(t)) {
    fail(where, `unknown block type ${JSON.stringify(t)}`);
  }
  switch (t) {
    case 'heading': {
      const lvl = n['level'];
      if (lvl !== 1 && lvl !== 2 && lvl !== 3) fail(where, `level must be 1, 2 or 3, got ${String(lvl)}`);
      checkInlines(n['text'], `${where}.text`);
      return;
    }
    case 'para':
      checkInlines(n['text'], `${where}.text`);
      return;
    case 'list': {
      if (typeof n['ordered'] !== 'boolean') fail(where, 'list needs a boolean ordered');
      if (typeof n['depth'] !== 'number' || n['depth'] < 0) fail(where, 'list needs a non-negative depth');
      if (!Array.isArray(n['items'])) fail(`${where}.items`, 'expected an array');
      n['items'].forEach((it, i) => checkInlines(it, `${where}.items[${i}]`));
      return;
    }
    case 'table': {
      if (!Array.isArray(n['head'])) fail(`${where}.head`, 'expected an array');
      n['head'].forEach((c, i) => checkInlines(c, `${where}.head[${i}]`));
      if (!Array.isArray(n['align'])) fail(`${where}.align`, 'expected an array');
      n['align'].forEach((a, i) => {
        if (!ALIGNS.has(a as Align)) fail(`${where}.align[${i}]`, `expected l, r or c, got ${String(a)}`);
      });
      if (n['align'].length !== n['head'].length) {
        fail(where, `align has ${n['align'].length} entries for ${n['head'].length} columns`);
      }
      if (!Array.isArray(n['rows'])) fail(`${where}.rows`, 'expected an array');
      n['rows'].forEach((row, r) => {
        if (!Array.isArray(row)) fail(`${where}.rows[${r}]`, 'expected an array of cells');
        if (row.length !== (n['head'] as unknown[]).length) {
          fail(`${where}.rows[${r}]`, `has ${row.length} cells for ${(n['head'] as unknown[]).length} columns`);
        }
        row.forEach((c, i) => checkInlines(c, `${where}.rows[${r}][${i}]`));
      });
      return;
    }
    case 'image': {
      if (typeof n['src'] !== 'string' || n['src'] === '') fail(where, 'image needs a non-empty src');
      if (typeof n['alt'] !== 'string') fail(where, 'image needs a string alt (empty is allowed)');
      return;
    }
    case 'code':
      if (typeof n['text'] !== 'string') fail(where, 'code needs a string text');
      return;
    case 'quote': {
      if (!Array.isArray(n['paras'])) fail(`${where}.paras`, 'expected an array');
      n['paras'].forEach((p, i) => checkInlines(p, `${where}.paras[${i}]`));
      return;
    }
    default: // rule, pagebreak carry no payload
      return;
  }
}

/** Throws with a path to the offending node. A validator that only says "invalid" costs more than it saves. */
export function validateDoc(doc: unknown): asserts doc is Doc {
  if (typeof doc !== 'object' || doc === null) fail('document', 'expected an object');
  const d = doc as Record<string, unknown>;
  const meta = d['meta'];
  if (typeof meta !== 'object' || meta === null) fail('meta', 'expected an object');
  const m = meta as Record<string, unknown>;
  if (typeof m['title'] !== 'string' || m['title'] === '') fail('meta.title', 'expected a non-empty string');
  if (typeof m['lang'] !== 'string' || m['lang'] === '') fail('meta.lang', 'expected a non-empty string');
  if (!Array.isArray(d['blocks'])) fail('blocks', 'expected an array');
  d['blocks'].forEach((b, i) => checkBlock(b, `blocks[${i}]`));
}

export type { Block, Doc, Inline };
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run test/ir/validate.test.ts`
Expected: PASS, 5 tests.

Also run `npm run typecheck`. Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add project scaffold and the document IR

The IR is flat because all four renderers are flat, and the validator
reports a path to the offending node rather than a bare refusal."
```

---

### Task 2: Markdown ingest

**Files:**
- Create: `src/ingest/md.ts`
- Test: `test/ingest/md.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Ingested`, `Inline`, `Block` from `src/ir/types.js`.
- Produces: `ingestMarkdown(source: string, opts?: { title?: string }): Ingested`.

The title is taken, in order: `opts.title`, then the first level-1 heading (which is then **removed** from the blocks, because the theme's header prints it), then the string `Untitled`.

- [ ] **Step 1: Write the failing test**

Create `test/ingest/md.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { validateDoc } from '../../src/ir/validate.js';

describe('ingestMarkdown', () => {
  it('lifts the first h1 into meta.title and drops it from the body', () => {
    const { doc } = ingestMarkdown('# Report\n\nHello.');
    expect(doc.meta.title).toBe('Report');
    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: 'Hello.' }] }]);
  });

  it('falls back to Untitled', () => {
    expect(ingestMarkdown('Just text.').doc.meta.title).toBe('Untitled');
  });

  it('prefers an explicit title and keeps the h1 as a heading block', () => {
    const { doc } = ingestMarkdown('# Report\n\nHello.', { title: 'Given' });
    expect(doc.meta.title).toBe('Given');
    expect(doc.blocks[0]).toEqual({ t: 'heading', level: 1, text: [{ t: 'text', v: 'Report' }] });
  });

  it('clamps heading levels below h3 and reports the clamp', () => {
    const { doc, dropped } = ingestMarkdown('# T\n\n##### Deep');
    expect(doc.blocks[0]).toEqual({ t: 'heading', level: 3, text: [{ t: 'text', v: 'Deep' }] });
    expect(dropped.join(' ')).toMatch(/h5/i);
  });

  it('parses emphasis, code spans and links', () => {
    const { doc } = ingestMarkdown('# T\n\nA **b** and `c` and [d](https://e.f).');
    expect(doc.blocks[0]).toEqual({
      t: 'para',
      text: [
        { t: 'text', v: 'A ' },
        { t: 'strong', children: [{ t: 'text', v: 'b' }] },
        { t: 'text', v: ' and ' },
        { t: 'code', children: [{ t: 'text', v: 'c' }] },
        { t: 'text', v: ' and ' },
        { t: 'link', href: 'https://e.f', children: [{ t: 'text', v: 'd' }] },
        { t: 'text', v: '.' },
      ],
    });
  });

  it('parses a table with its alignments', () => {
    const md = '# T\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n';
    const table = ingestMarkdown(md).doc.blocks[0];
    expect(table).toMatchObject({ t: 'table', align: ['l', 'r'] });
    expect(table).toMatchObject({ rows: [[[{ t: 'text', v: '1' }], [{ t: 'text', v: '2' }]]] });
  });

  it('parses lists, quotes, code blocks and rules', () => {
    const { doc } = ingestMarkdown('# T\n\n- one\n- two\n\n> quoted\n\n```js\nx\n```\n\n---\n');
    expect(doc.blocks.map((b) => b.t)).toEqual(['list', 'quote', 'code', 'rule']);
    expect(doc.blocks[0]).toMatchObject({ ordered: false, depth: 0 });
    expect(doc.blocks[2]).toMatchObject({ lang: 'js', text: 'x' });
  });

  it('flattens a nested list into depth-tagged blocks', () => {
    const { doc } = ingestMarkdown('# T\n\n- one\n  - deeper\n');
    expect(doc.blocks.map((b) => (b as { depth: number }).depth)).toEqual([0, 1]);
  });

  it('records HTML it cannot represent instead of dropping it silently', () => {
    const { dropped } = ingestMarkdown('# T\n\n<div>raw</div>\n');
    expect(dropped.join(' ')).toMatch(/html/i);
  });

  it('always produces a document the validator accepts', () => {
    const { doc } = ingestMarkdown('# T\n\n| a |\n|---|\n| 1 |\n\n- x\n\n> q\n');
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('keeps Ukrainian and Polish text intact', () => {
    const { doc } = ingestMarkdown('# T\n\nПривіт, ґуля. Zażółć gęślą jaźń.');
    expect(doc.blocks[0]).toEqual({
      t: 'para',
      text: [{ t: 'text', v: 'Привіт, ґуля. Zażółć gęślą jaźń.' }],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ingest/md.test.ts`
Expected: FAIL — cannot resolve `../../src/ingest/md.js`.

- [ ] **Step 3: Write `src/ingest/md.ts`**

```ts
// Markdown → IR. `marked`'s lexer gives an almost-flat token stream, which is
// why it is the cheapest of the four ingesters and therefore the one the whole
// architecture is proven on first.

import { marked, type Token, type Tokens } from 'marked';
import type { Align, Block, Ingested, Inline } from '../ir/types.js';

type Sink = { blocks: Block[]; dropped: string[] };

function inlinesOf(tokens: Token[] | undefined, sink: Sink): Inline[] {
  const out: Inline[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text':
      case 'escape': {
        const t = tok as Tokens.Text;
        // marked nests tokens under a text token when the text contains markup.
        if (t.tokens?.length) out.push(...inlinesOf(t.tokens, sink));
        else out.push({ t: 'text', v: t.text });
        break;
      }
      case 'strong':
        out.push({ t: 'strong', children: inlinesOf((tok as Tokens.Strong).tokens, sink) });
        break;
      case 'em':
        out.push({ t: 'em', children: inlinesOf((tok as Tokens.Em).tokens, sink) });
        break;
      case 'codespan':
        out.push({ t: 'code', children: [{ t: 'text', v: (tok as Tokens.Codespan).text }] });
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        out.push({ t: 'link', href: l.href, children: inlinesOf(l.tokens, sink) });
        break;
      }
      case 'br':
        out.push({ t: 'text', v: '\n' });
        break;
      case 'del':
        // The IR has no strikethrough. Keep the words, say the styling went.
        sink.dropped.push('strikethrough styling (the text was kept)');
        out.push(...inlinesOf((tok as Tokens.Del).tokens, sink));
        break;
      case 'html':
        sink.dropped.push(`inline html: ${truncate((tok as Tokens.HTML).text)}`);
        break;
      case 'image': {
        // An image inside a paragraph becomes its own block; see blockOf.
        const im = tok as Tokens.Image;
        sink.blocks.push({ t: 'image', src: im.href, alt: im.text });
        break;
      }
      default:
        if ('raw' in tok && typeof tok.raw === 'string' && tok.raw.trim() !== '') {
          sink.dropped.push(`inline ${tok.type}: ${truncate(tok.raw)}`);
        }
    }
  }
  return out;
}

function truncate(s: string, n = 40): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

const ALIGN_OF: Record<string, Align> = { left: 'l', right: 'r', center: 'c' };

function pushList(tok: Tokens.List, depth: number, sink: Sink): void {
  // A nested list becomes a sibling block carrying a greater depth, because the
  // IR is flat. The renderers indent from `depth`.
  const items: Inline[][] = [];
  const deferred: { list: Tokens.List; depth: number }[] = [];
  for (const item of tok.items) {
    const own: Token[] = [];
    for (const child of item.tokens) {
      if (child.type === 'list') deferred.push({ list: child as Tokens.List, depth: depth + 1 });
      else if (child.type === 'text' || child.type === 'paragraph') own.push(child);
      else deferred.push({ list: child as unknown as Tokens.List, depth: depth + 1 });
    }
    items.push(inlinesOf(own, sink));
  }
  sink.blocks.push({ t: 'list', ordered: Boolean(tok.ordered), depth, items });
  for (const d of deferred) {
    if ((d.list as Token).type === 'list') pushList(d.list, d.depth, sink);
    else blockOf(d.list as unknown as Token, sink);
  }
}

function blockOf(tok: Token, sink: Sink): void {
  switch (tok.type) {
    case 'space':
      return;
    case 'heading': {
      const h = tok as Tokens.Heading;
      const level = (h.depth > 3 ? 3 : h.depth) as 1 | 2 | 3;
      if (h.depth > 3) {
        sink.dropped.push(`h${h.depth} clamped to h3: ${truncate(h.text)}`);
      }
      sink.blocks.push({ t: 'heading', level, text: inlinesOf(h.tokens, sink) });
      return;
    }
    case 'paragraph': {
      const p = tok as Tokens.Paragraph;
      const before = sink.blocks.length;
      const text = inlinesOf(p.tokens, sink);
      // inlinesOf may have pushed image blocks; a paragraph that was only an
      // image must not also emit an empty paragraph.
      const onlyImages = text.every((n) => n.t === 'text' && n.v.trim() === '');
      if (sink.blocks.length > before && onlyImages) return;
      if (text.length) sink.blocks.push({ t: 'para', text });
      return;
    }
    case 'list':
      pushList(tok as Tokens.List, 0, sink);
      return;
    case 'table': {
      const t = tok as Tokens.Table;
      sink.blocks.push({
        t: 'table',
        head: t.header.map((c) => inlinesOf(c.tokens, sink)),
        rows: t.rows.map((row) => row.map((c) => inlinesOf(c.tokens, sink))),
        align: t.align.map((a) => (a ? ALIGN_OF[a] ?? 'l' : 'l')),
      });
      return;
    }
    case 'code': {
      const c = tok as Tokens.Code;
      sink.blocks.push(c.lang ? { t: 'code', lang: c.lang, text: c.text } : { t: 'code', text: c.text });
      return;
    }
    case 'blockquote': {
      const q = tok as Tokens.Blockquote;
      const paras: Inline[][] = [];
      for (const child of q.tokens) {
        if (child.type === 'paragraph') paras.push(inlinesOf((child as Tokens.Paragraph).tokens, sink));
        else if (child.type !== 'space') sink.dropped.push(`inside a quote: ${child.type}`);
      }
      sink.blocks.push({ t: 'quote', paras });
      return;
    }
    case 'hr':
      sink.blocks.push({ t: 'rule' });
      return;
    case 'html':
      sink.dropped.push(`block html: ${truncate((tok as Tokens.HTML).text)}`);
      return;
    default:
      if ('raw' in tok && typeof tok.raw === 'string' && tok.raw.trim() !== '') {
        sink.dropped.push(`${tok.type}: ${truncate(tok.raw)}`);
      }
  }
}

function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plain(n.children))).join('');
}

export function ingestMarkdown(source: string, opts: { title?: string } = {}): Ingested {
  const sink: Sink = { blocks: [], dropped: [] };
  for (const tok of marked.lexer(source)) blockOf(tok, sink);

  let title = opts.title;
  if (title === undefined) {
    const i = sink.blocks.findIndex((b) => b.t === 'heading' && b.level === 1);
    if (i !== -1) {
      const h = sink.blocks[i] as Extract<Block, { t: 'heading' }>;
      title = plain(h.text);
      // The theme's header prints the title, so leaving it in the body would
      // set it twice.
      sink.blocks.splice(i, 1);
    }
  }

  return {
    doc: { meta: { title: title ?? 'Untitled', lang: 'en' }, blocks: sink.blocks },
    dropped: sink.dropped,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ingest/md.test.ts`
Expected: PASS, 10 tests.

If `marked`'s token shapes differ from the code above (v15 renamed some fields historically), fix the mapping — **do not weaken a test to match a wrong mapping.** The tests encode the intended IR, and the IR is the contract every later task builds on.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the Markdown ingester

Nested lists flatten into depth-tagged sibling blocks because the IR is
flat, and anything the IR cannot hold is recorded in dropped rather than
discarded quietly."
```

---

### Task 3: Markdown renderer and the round-trip test

**Files:**
- Create: `src/render/md.ts`
- Test: `test/render/md.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Block`, `Inline` from `src/ir/types.js`; `ingestMarkdown` from `src/ingest/md.js` (test only).
- Produces: `renderMarkdown(doc: Doc): string`.

- [ ] **Step 1: Write the failing test**

Create `test/render/md.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderMarkdown } from '../../src/render/md.js';

const roundTrip = (md: string) => renderMarkdown(ingestMarkdown(md).doc);

describe('renderMarkdown', () => {
  it('writes the title as an h1 and the body after it', () => {
    expect(roundTrip('# Report\n\nHello.')).toBe('# Report\n\nHello.\n');
  });

  it('is idempotent — rendering its own output changes nothing', () => {
    const once = roundTrip('# T\n\n- a\n  - b\n\n| x | y |\n|:--|--:|\n| 1 | 2 |\n');
    expect(roundTrip(once)).toBe(once);
  });

  it('escapes pipes inside table cells so the table survives a round trip', () => {
    const out = roundTrip('# T\n\n| a |\n|---|\n| x \\| y |\n');
    expect(out).toContain('x \\| y');
    expect(roundTrip(out)).toBe(out);
  });

  it('indents a nested list by its depth', () => {
    expect(roundTrip('# T\n\n- one\n  - deeper\n')).toBe('# T\n\n- one\n  - deeper\n');
  });

  it('renders emphasis, code spans and links', () => {
    const md = '# T\n\nA **b** and `c` and [d](https://e.f).';
    expect(roundTrip(md)).toBe('# T\n\nA **b** and `c` and [d](https://e.f).\n');
  });

  it('renders quotes, fenced code and rules', () => {
    const md = '# T\n\n> quoted\n\n```js\nx\n```\n\n---\n';
    expect(roundTrip(md)).toBe('# T\n\n> quoted\n\n```js\nx\n```\n\n---\n');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render/md.test.ts`
Expected: FAIL — cannot resolve `../../src/render/md.js`.

- [ ] **Step 3: Write `src/render/md.ts`**

```ts
// IR → Markdown. Also the cheapest way to see what an ingester understood:
// `--to md` is "show me the IR in a form a human reads".

import type { Block, Doc, Inline } from '../ir/types.js';

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text': return n.v;
        case 'strong': return `**${inline(n.children)}**`;
        case 'em': return `*${inline(n.children)}*`;
        case 'code': return `\`${inline(n.children)}\``;
        case 'link': return `[${inline(n.children)}](${n.href})`;
      }
    })
    .join('');
}

/** A cell may not contain a bare pipe or a newline, or the row stops being a row. */
function cell(nodes: Inline[]): string {
  return inline(nodes).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fence(text: string): string {
  // A fence must be longer than the longest run of backticks it contains.
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function block(b: Block): string {
  switch (b.t) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${inline(b.text)}`;
    case 'para':
      return inline(b.text);
    case 'list': {
      const pad = '  '.repeat(b.depth);
      return b.items
        .map((it, i) => `${pad}${b.ordered ? `${i + 1}.` : '-'} ${inline(it)}`)
        .join('\n');
    }
    case 'table': {
      const sep = b.align.map((a) => (a === 'l' ? ':--' : a === 'r' ? '--:' : ':-:'));
      const row = (cells: Inline[][]) => `| ${cells.map(cell).join(' | ')} |`;
      return [row(b.head), `| ${sep.join(' | ')} |`, ...b.rows.map(row)].join('\n');
    }
    case 'image':
      return `![${b.alt}](${b.src})`;
    case 'code': {
      const f = fence(b.text);
      return `${f}${b.lang ?? ''}\n${b.text}\n${f}`;
    }
    case 'quote':
      return b.paras.map((p) => `> ${inline(p)}`).join('\n>\n');
    case 'rule':
      return '---';
    case 'pagebreak':
      // No Markdown syntax for this. The comment survives a round trip through
      // the ingester as dropped html, which is honest: Markdown cannot hold it.
      return '<!-- pagebreak -->';
  }
}

export function renderMarkdown(doc: Doc): string {
  // Each part is paired with the block that produced it (null for the title and
  // subtitle, which come from meta), so the separator rule below can ask about
  // the real neighbours instead of guessing from an index offset.
  const parts: { text: string; block: Block | null }[] = [
    { text: `# ${doc.meta.title}`, block: null },
  ];
  if (doc.meta.subtitle) parts.push({ text: `*${doc.meta.subtitle}*`, block: null });
  for (const b of doc.blocks) parts.push({ text: block(b), block: b });

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += parts[i]!.text;
    const next = parts[i + 1];
    if (!next) break;
    // Consecutive list blocks are one list to a reader — a blank line between
    // them would end the list and restart the numbering.
    const bothLists = parts[i]!.block?.t === 'list' && next.block?.t === 'list';
    out += bothLists ? '\n' : '\n\n';
  }
  return `${out}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/render/md.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the Markdown renderer and its round-trip tests

Idempotence is the property worth testing here: rendering the renderer's
own output must change nothing, which catches escaping bugs that a single
pass hides."
```

---

### Task 4: Theme resolution and the `plain` theme

**Files:**
- Create: `src/theme/types.ts`
- Create: `src/theme/resolve.ts`
- Create: `themes/plain/theme.json`
- Test: `test/theme/resolve.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Theme` (the resolved, fully-populated type), `resolveTheme(input: unknown, opts?: { id?: string }): Theme`, and `loadTheme(idOrPath: string): Promise<Theme>`.

`loadTheme` resolves a bare id against `themes/<id>/theme.json` relative to the package root, and anything containing a path separator or ending in `.json` as a filesystem path.

- [ ] **Step 1: Create `themes/plain/theme.json`**

Brand-neutral by design: the core carries no logo and no brand colour, so the public package is usable by anyone and ships nobody's trademark.

```json
{
  "id": "plain",
  "name": "Plain",
  "colors": {
    "brandOnLight": "#1A1A1A",
    "brandOnDark": null,
    "ink": "#1A1A1A",
    "muted": "#6B6B6B",
    "rule": "#D8D8D8"
  },
  "font": { "document": "Arial", "embed": "arimo" },
  "logo": null,
  "page": { "size": "A4", "marginPt": 48 },
  "type": {
    "bodyPt": 10,
    "leading": 1.45,
    "h1Pt": 18,
    "h2Pt": 13,
    "h3Pt": 11,
    "smallPt": 8
  },
  "letterhead": []
}
```

- [ ] **Step 2: Write the failing test**

Create `test/theme/resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';

describe('resolveTheme', () => {
  it('fills defaults for everything a theme omits', () => {
    const t = resolveTheme({ id: 'x', colors: { ink: '#000000' } });
    expect(t.page.marginPt).toBe(48);
    expect(t.type.bodyPt).toBe(10);
    expect(t.colors.ink).toBe('#000000');
  });

  it('rejects a colour that is not a six-digit hex', () => {
    expect(() => resolveTheme({ id: 'x', colors: { ink: 'red' } })).toThrow(/colors\.ink/);
    expect(() => resolveTheme({ id: 'x', colors: { ink: '#abc' } })).toThrow(/colors\.ink/);
  });

  it('keeps brandOnDark null rather than falling back to the light value', () => {
    const t = resolveTheme({ id: 'x', colors: { brandOnLight: '#DA291C' } });
    expect(t.colors.brandOnDark).toBeNull();
  });

  it('rejects a page size it cannot lay out', () => {
    expect(() => resolveTheme({ id: 'x', page: { size: 'B7' } })).toThrow(/page\.size/);
  });

  it('rejects a margin that leaves no text column', () => {
    expect(() => resolveTheme({ id: 'x', page: { marginPt: 400 } })).toThrow(/marginPt/);
  });

  it('loads the bundled plain theme by id', async () => {
    const t = await loadTheme('plain');
    expect(t.id).toBe('plain');
    expect(t.logo).toBeNull();
    expect(t.page.size).toBe('A4');
  });

  it('says which theme it could not find', async () => {
    await expect(loadTheme('nope')).rejects.toThrow(/nope/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/theme/resolve.test.ts`
Expected: FAIL — cannot resolve `../../src/theme/resolve.js`.

- [ ] **Step 4: Write `src/theme/types.ts`**

```ts
export type PageSize = 'A4' | 'Letter';

/** Trim size in points, portrait. Chromium is given millimetres; see toMm. */
export const PAGE_PT: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};

export type Logo = {
  /** Inline SVG markup. Paints by class, never with an inline fill. */
  svg: string;
  heightPt: number;
  /** Optional square mark for the running header. */
  cornerMarkSvg?: string;
};

export type Theme = {
  id: string;
  name: string;
  colors: {
    /** Used for the accent rule and the logo on white. */
    brandOnLight: string;
    /**
     * Null until a theme declares one. A renderer that needs it must fail
     * loudly: no single colour clears AA on both a light and a dark surface,
     * so silently reusing brandOnLight would ship an unreadable document.
     */
    brandOnDark: string | null;
    ink: string;
    muted: string;
    rule: string;
  };
  font: {
    /** The family name written into DOCX, where fonts are not embedded. */
    document: string;
    /** The family embedded into PDFs. Only 'arimo' exists in phase 1. */
    embed: 'arimo';
  };
  logo: Logo | null;
  page: { size: PageSize; marginPt: number };
  type: {
    bodyPt: number;
    leading: number;
    h1Pt: number;
    h2Pt: number;
    h3Pt: number;
    smallPt: number;
  };
  letterhead: string[];
};

export const PT_TO_MM = 0.352778;

/** page.pdf() rejects `pt`; it accepts px, in, cm and mm. */
export function toMm(pt: number): string {
  return `${(pt * PT_TO_MM).toFixed(2)}mm`;
}
```

- [ ] **Step 5: Write `src/theme/resolve.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_PT, type PageSize, type Theme } from './types.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const PAGE_SIZES = new Set<PageSize>(['A4', 'Letter']);

function bad(where: string, why: string): never {
  throw new Error(`invalid theme at ${where}: ${why}`);
}

function hex(v: unknown, where: string, fallback: string): string {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !HEX.test(v)) {
    bad(where, `expected a six-digit hex colour like #1A1A1A, got ${JSON.stringify(v)}`);
  }
  return v;
}

function num(v: unknown, where: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    bad(where, `expected a positive number, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function resolveTheme(input: unknown, opts: { id?: string } = {}): Theme {
  if (typeof input !== 'object' || input === null) bad('theme', 'expected an object');
  const t = input as Record<string, unknown>;
  const colors = (t['colors'] ?? {}) as Record<string, unknown>;
  const page = (t['page'] ?? {}) as Record<string, unknown>;
  const type = (t['type'] ?? {}) as Record<string, unknown>;
  const font = (t['font'] ?? {}) as Record<string, unknown>;

  const size = (page['size'] ?? 'A4') as PageSize;
  if (!PAGE_SIZES.has(size)) {
    bad('page.size', `expected one of ${[...PAGE_SIZES].join(', ')}, got ${JSON.stringify(size)}`);
  }
  const marginPt = num(page['marginPt'], 'page.marginPt', 48);
  const trim = PAGE_PT[size];
  if (marginPt * 2 >= trim.w - 72) {
    bad('page.marginPt', `${marginPt}pt margins leave no usable column on ${size}`);
  }

  const embed = (font['embed'] ?? 'arimo') as string;
  if (embed !== 'arimo') bad('font.embed', `only 'arimo' is available, got ${JSON.stringify(embed)}`);

  let logo: Theme['logo'] = null;
  const rawLogo = t['logo'];
  if (rawLogo !== undefined && rawLogo !== null) {
    const l = rawLogo as Record<string, unknown>;
    if (typeof l['svg'] !== 'string' || !l['svg'].includes('<svg')) {
      bad('logo.svg', 'expected inline SVG markup');
    }
    if (/\bfill\s*=/.test(l['svg'])) {
      // The theme recolours the logo through CSS custom properties. An inline
      // fill silently wins over that, so the logo would stop following the
      // theme with nothing to show for it.
      bad('logo.svg', 'inline fill attributes are not allowed; paint by class');
    }
    logo = {
      svg: l['svg'],
      heightPt: num(l['heightPt'], 'logo.heightPt', 11),
      ...(typeof l['cornerMarkSvg'] === 'string' ? { cornerMarkSvg: l['cornerMarkSvg'] } : {}),
    };
  }

  const letterhead = Array.isArray(t['letterhead'])
    ? t['letterhead'].map((l, i) => {
        if (typeof l !== 'string') bad(`letterhead[${i}]`, 'expected a string');
        return l;
      })
    : [];

  const brandOnDark = colors['brandOnDark'];
  if (brandOnDark !== undefined && brandOnDark !== null && (typeof brandOnDark !== 'string' || !HEX.test(brandOnDark))) {
    bad('colors.brandOnDark', 'expected a six-digit hex colour or null');
  }

  return {
    id: String(t['id'] ?? opts.id ?? 'unnamed'),
    name: String(t['name'] ?? t['id'] ?? 'Unnamed'),
    colors: {
      brandOnLight: hex(colors['brandOnLight'], 'colors.brandOnLight', '#1A1A1A'),
      brandOnDark: (brandOnDark as string | null | undefined) ?? null,
      ink: hex(colors['ink'], 'colors.ink', '#1A1A1A'),
      muted: hex(colors['muted'], 'colors.muted', '#6B6B6B'),
      rule: hex(colors['rule'], 'colors.rule', '#D8D8D8'),
    },
    font: { document: String(font['document'] ?? 'Arial'), embed: 'arimo' },
    logo,
    page: { size, marginPt },
    type: {
      bodyPt: num(type['bodyPt'], 'type.bodyPt', 10),
      leading: num(type['leading'], 'type.leading', 1.45),
      h1Pt: num(type['h1Pt'], 'type.h1Pt', 18),
      h2Pt: num(type['h2Pt'], 'type.h2Pt', 13),
      h3Pt: num(type['h3Pt'], 'type.h3Pt', 11),
      smallPt: num(type['smallPt'], 'type.smallPt', 8),
    },
    letterhead,
  };
}

/** The package root, so a bare theme id resolves whether run from src or dist. */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/theme or dist/src/theme
  return resolvePath(here, '..', '..');
}

export async function loadTheme(idOrPath: string): Promise<Theme> {
  const looksLikePath = idOrPath.endsWith('.json') || idOrPath.includes('/') || idOrPath.includes(sep);
  const file = looksLikePath ? idOrPath : join(packageRoot(), 'themes', idOrPath, 'theme.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`theme ${JSON.stringify(idOrPath)} not found (looked in ${file})`);
  }
  return resolveTheme(JSON.parse(raw), { id: idOrPath });
}

export type { Theme } from './types.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/theme/resolve.test.ts`
Expected: PASS, 7 tests.

If `packageRoot()` resolves wrongly when tests run from `src`, adjust the number of `..` segments until `loadTheme('plain')` passes — do not hard-code an absolute path.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add theme resolution and the brand-neutral plain theme

brandOnDark stays null rather than falling back to the light value: no
single colour clears AA on both surfaces, so a silent fallback would ship
an unreadable document. A logo with inline fills is refused, because the
theme recolours it by class."
```

---

### Task 5: Inlining the font

**Files:**
- Create: `src/render/fonts.ts`
- Test: `test/render/fonts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `arimoFaceCss(): Promise<string>` — the `@font-face` rules with base64 `woff2` data-URIs and their `unicode-range`s, cached in module scope after the first call.

Six faces: `latin`, `latin-ext`, `cyrillic` × weights 400 and 700. Verified in the spec's spike as covering Ukrainian, Polish and English in ~141 KB.

- [ ] **Step 1: Write the failing test**

Create `test/render/fonts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { arimoFaceCss } from '../../src/render/fonts.js';

describe('arimoFaceCss', () => {
  it('emits six faces, all as data URIs', async () => {
    const css = await arimoFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(css.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(6);
    // Nothing may reference a file or a network host: the renderer fetches nothing.
    expect(css).not.toMatch(/url\((?!data:)/);
  });

  it('carries a unicode-range on every face so Chromium can pick', async () => {
    const css = await arimoFaceCss();
    expect(css.match(/unicode-range:/g)).toHaveLength(6);
  });

  it('covers Ukrainian and Polish codepoints', async () => {
    const css = await arimoFaceCss();
    const ranges = [...css.matchAll(/unicode-range:([^;}]+)/g)].map((m) => m[1]!);
    const covers = (cp: number) =>
      ranges.some((r) =>
        r.split(',').some((part) => {
          const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim());
          if (!m) return false;
          const lo = parseInt(m[1]!, 16);
          const hi = m[2] ? parseInt(m[2], 16) : lo;
          return cp >= lo && cp <= hi;
        }),
      );
    for (const ch of ['і', 'ї', 'ґ', 'Ж', 'ą', 'ł', 'ż', 'ś']) {
      expect(covers(ch.codePointAt(0)!), `${ch} is not covered`).toBe(true);
    }
  });

  it('returns the same string on a second call', async () => {
    expect(await arimoFaceCss()).toBe(await arimoFaceCss());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render/fonts.test.ts`
Expected: FAIL — cannot resolve `../../src/render/fonts.js`.

- [ ] **Step 3: Write `src/render/fonts.ts`**

```ts
// The font is inlined, never fetched. A renderer that must reach for a resource
// will one day fail to get it, silently substitute a system face, and re-wrap
// the whole document — a defect only a human opening the PDF ever sees.
//
// Arimo rather than Arial: the brand's document face is Arial, which exists on
// Windows and macOS and not on Linux or CI. Arimo is metrically identical, so
// the line breaks match, and it is Apache-2.0, so it can ship in a public repo.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;
const WEIGHTS = [400, 700] as const;

let cached: string | undefined;

export async function arimoFaceCss(): Promise<string> {
  if (cached !== undefined) return cached;

  // unicode.json ships with the package and is the authority on the ranges;
  // hard-coding them here would rot the day the package re-subsets.
  const ranges = require('@fontsource/arimo/unicode.json') as Record<string, string>;
  const filesDir = require
    .resolve('@fontsource/arimo/unicode.json')
    .replace(/unicode\.json$/, 'files');

  const faces: string[] = [];
  for (const subset of SUBSETS) {
    const range = ranges[subset];
    if (!range) throw new Error(`@fontsource/arimo declares no unicode-range for ${subset}`);
    for (const weight of WEIGHTS) {
      const file = `${filesDir}/arimo-${subset}-${weight}-normal.woff2`;
      const b64 = (await readFile(file)).toString('base64');
      faces.push(
        `@font-face{font-family:Arimo;font-style:normal;font-weight:${weight};font-display:block;` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`,
      );
    }
  }
  cached = faces.join('');
  return cached;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/render/fonts.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Inline Arimo as data URIs for the PDF renderer

Six subsets cover Ukrainian, Polish and English in ~141 KB. The ranges
come from the package's own unicode.json rather than being copied, so a
re-subset upstream cannot leave the CSS quietly wrong."
```

---

### Task 6: IR plus theme to HTML

**Files:**
- Create: `src/render/html.ts`
- Test: `test/render/html.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Block`, `Inline`; `Theme`, `toMm`, `PAGE_PT`; `arimoFaceCss`.
- Produces: `buildHtml(doc: Doc, theme: Theme, opts: { headerHeightPt: number }): Promise<string>` — a complete, self-contained HTML document, and `escapeHtml(s: string): string`.

- [ ] **Step 1: Write the failing test**

Create `test/render/html.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHtml, escapeHtml } from '../../src/render/html.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import type { Doc } from '../../src/ir/types.js';

const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
const doc: Doc = {
  meta: { title: 'Report & Co', lang: 'uk' },
  blocks: [
    { t: 'heading', level: 2, text: [{ t: 'text', v: 'Розділ' }] },
    { t: 'para', text: [{ t: 'text', v: '<script>alert(1)</script>' }] },
    { t: 'table', head: [[{ t: 'text', v: 'a' }]], rows: [[[{ t: 'text', v: '1' }]]], align: ['r'] },
  ],
};
const build = () => buildHtml(doc, theme, { headerHeightPt: 40 });

describe('buildHtml', () => {
  it('escapes text so a document cannot inject markup', async () => {
    const html = await build();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes the title in both the <title> and the header', async () => {
    expect(await build()).not.toContain('Report & Co');
    expect(await build()).toContain('Report &amp; Co');
  });

  it('sets the document language from meta.lang', async () => {
    expect(await build()).toMatch(/<html lang="uk"/);
  });

  it('references no external resource', async () => {
    const html = await build();
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\((?!data:)/);
  });

  it('inlines the font faces', async () => {
    expect((await build()).match(/@font-face/g)).toHaveLength(6);
  });

  it('carries the theme colours as custom properties', async () => {
    expect(await build()).toContain('--brand: #DA291C');
  });

  it('aligns a table column from the IR', async () => {
    expect(await build()).toMatch(/text-align:\s*right/);
  });

  it('reserves the header height in the page margin', async () => {
    // 48pt margin + 40pt header = 88pt = 31.04mm
    expect(await build()).toContain('31.04mm');
  });

  it('omits the logo block entirely when the theme has none', async () => {
    expect(await build()).not.toContain('class="logo"');
  });

  it('resumes an ordered list that a sublist interrupted', async () => {
    const withList: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [
        { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'a' }]] },
        { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'x' }]] },
        { t: 'list', ordered: true, depth: 0, start: 2, items: [[{ t: 'text', v: 'b' }]] },
      ],
    };
    const html = await buildHtml(withList, theme, { headerHeightPt: 40 });
    expect(html).toContain('<ol class="d0" start="2">');
    // A first fragment starting at 1 must not carry a redundant attribute.
    expect(html).toContain('<ol class="d0">');
    expect(html).toContain('<ul class="d1">');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render/html.test.ts`
Expected: FAIL — cannot resolve `../../src/render/html.js`.

- [ ] **Step 3: Write `src/render/html.ts`**

```ts
// IR + theme → one self-contained HTML document. Everything the page needs is
// in the string: no <link>, no remote image, no webfont URL. See fonts.ts for
// why that rule is absolute.

import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, toMm, type Theme } from '../theme/types.js';
import { arimoFaceCss } from './fonts.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text': return escapeHtml(n.v);
        case 'strong': return `<strong>${inline(n.children)}</strong>`;
        case 'em': return `<em>${inline(n.children)}</em>`;
        case 'code': return `<code>${inline(n.children)}</code>`;
        case 'link': return `<a href="${escapeHtml(n.href)}">${inline(n.children)}</a>`;
      }
    })
    .join('');
}

const ALIGN_CSS = { l: 'left', r: 'right', c: 'center' } as const;

function block(b: Block): string {
  switch (b.t) {
    case 'heading':
      return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
    case 'para':
      return `<p>${inline(b.text)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((it) => `<li>${inline(it)}</li>`).join('');
      // A list is split into fragments wherever a sublist interrupts it, so an
      // ordered fragment after a sublist must resume its numbering rather than
      // restart at 1.
      const start = b.ordered && b.start !== undefined && b.start !== 1 ? ` start="${b.start}"` : '';
      return `<${tag} class="d${b.depth}"${start}>${items}</${tag}>`;
    }
    case 'table': {
      const head = b.head
        .map((c, i) => `<th style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</th>`)
        .join('');
      const rows = b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => `<td style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table class="${b.landscape ? 'landscape' : ''}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'image':
      return `<figure><img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}"${
        b.widthPt ? ` style="width: ${b.widthPt}pt"` : ''
      }></figure>`;
    case 'code':
      return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'quote':
      return `<blockquote>${b.paras.map((p) => `<p>${inline(p)}</p>`).join('')}</blockquote>`;
    case 'rule':
      return '<hr>';
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
  }
}

function firstPageHeader(doc: Doc, theme: Theme): string {
  // The full letterhead, printed once in the body flow rather than in
  // Chromium's header box — the header box has no access to this stylesheet.
  const logo = theme.logo
    ? `<div class="logo" style="height: ${theme.logo.heightPt}pt">${theme.logo.svg}</div>`
    : '<div></div>';
  const lines = theme.letterhead
    .map((l, i) => `<div class="${i === 0 ? 'lh-name' : 'lh-line'}">${escapeHtml(l)}</div>`)
    .join('');
  return `<header class="sheet-head">${logo}<div class="letterhead">${lines}</div></header>
<div class="tick-row"><span class="tick"></span><span class="hair"></span></div>
<h1 class="doc-title">${escapeHtml(doc.meta.title)}</h1>${
    doc.meta.subtitle ? `<p class="doc-subtitle">${escapeHtml(doc.meta.subtitle)}</p>` : ''
  }`;
}

export async function buildHtml(
  doc: Doc,
  theme: Theme,
  opts: { headerHeightPt: number },
): Promise<string> {
  const faces = await arimoFaceCss();
  const { colors: c, type: ty, page } = theme;
  const trim = PAGE_PT[page.size];
  const colWidthPt = trim.w - page.marginPt * 2;

  const css = `${faces}
:root{
  --brand: ${c.brandOnLight};
  --ink: ${c.ink};
  --muted: ${c.muted};
  --rule: ${c.rule};
}
@page{ size: ${page.size}; margin: ${toMm(page.marginPt + opts.headerHeightPt)} ${toMm(page.marginPt)} ${toMm(page.marginPt)} ${toMm(page.marginPt)}; }
*{ box-sizing: border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family: Arimo, ${theme.font.document}, sans-serif;
  font-size: ${ty.bodyPt}pt;
  line-height: ${ty.leading};
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
/* The logo paints by class, never with an inline fill, so the theme owns its
   colour. A solid-black logo therefore means this stylesheet did not load. */
.logo svg{ height: 100%; width: auto; display: block; }
.logo .c-brand{ fill: var(--brand); }
.logo .c-muted{ fill: var(--muted); }
.sheet-head{ display:flex; align-items:flex-start; justify-content:space-between; gap: 24pt; }
.letterhead{ text-align: right; color: var(--muted); }
.lh-name{ font-size: ${ty.smallPt + 0.5}pt; font-weight: 700; }
.lh-line{ font-size: ${ty.smallPt - 0.5}pt; }
.tick-row{ display:flex; align-items:center; gap: 6pt; margin: 14pt 0 0; }
.tick{ display:block; width: 28pt; height: 3pt; background: var(--brand); }
.hair{ display:block; flex:1; height: 0.75pt; background: var(--rule); }
.doc-title{ font-size: ${ty.h1Pt}pt; font-weight: 700; margin: 22pt 0 0; letter-spacing: -0.01em; }
.doc-subtitle{ color: var(--muted); margin: 4pt 0 0; }
h1,h2,h3{ break-after: avoid; page-break-after: avoid; }
h2{ font-size: ${ty.h2Pt}pt; font-weight: 700; margin: 18pt 0 4pt; }
h3{ font-size: ${ty.h3Pt}pt; font-weight: 700; margin: 14pt 0 3pt; }
p{ margin: 0 0 ${(ty.bodyPt * 0.7).toFixed(1)}pt; orphans: 2; widows: 2; }
ul,ol{ margin: 0 0 ${(ty.bodyPt * 0.7).toFixed(1)}pt; padding-left: 16pt; }
${[0, 1, 2, 3].map((d) => `.d${d}{ margin-left: ${d * 14}pt; }`).join('\n')}
li{ margin: 0 0 2pt; }
blockquote{ margin: 0 0 10pt; padding-left: 12pt; border-left: 2pt solid var(--rule); color: var(--muted); }
pre{ background: #F6F6F4; padding: 8pt 10pt; border-radius: 2pt; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid; }
code{ font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: ${(ty.bodyPt * 0.92).toFixed(1)}pt; }
pre code{ font-size: ${(ty.bodyPt * 0.86).toFixed(1)}pt; }
hr{ border: 0; border-top: 0.75pt solid var(--rule); margin: 14pt 0; }
figure{ margin: 0 0 10pt; break-inside: avoid; }
img{ max-width: 100%; height: auto; }
table{ width: 100%; max-width: ${colWidthPt}pt; border-collapse: collapse; margin: 0 0 12pt; font-size: ${(ty.bodyPt * 0.95).toFixed(1)}pt; }
/* A row that splits across a page break loses its meaning; a whole table that
   cannot fit one page still has to break, so only the rows are protected. */
tr{ break-inside: avoid; }
thead{ display: table-header-group; }
th{ text-align: left; font-weight: 700; border-bottom: 1pt solid var(--rule); padding: 4pt 6pt; }
td{ border-bottom: 0.5pt solid var(--rule); padding: 4pt 6pt; vertical-align: top; }
.pagebreak{ break-after: page; page-break-after: always; }
a{ color: var(--ink); text-decoration: underline; text-decoration-color: var(--rule); }`;

  const body = doc.blocks.map(block).join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(doc.meta.lang)}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.meta.title)}</title>
<style>${css}</style></head>
<body>
${firstPageHeader(doc, theme)}
<main>
${body}
</main>
</body></html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/render/html.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Build a self-contained HTML document from the IR and a theme

Every asset is inlined and every text node escaped, so a document cannot
reach the network and cannot inject markup into its own rendering."
```

---

### Task 7: The PDF renderer, and byte-identical output

**Files:**
- Create: `src/render/pdf.ts`
- Create: `src/render/normalize-pdf.ts`
- Test: `test/render/normalize-pdf.test.ts`
- Test: `test/render/pdf.test.ts`

**Interfaces:**
- Consumes: `Doc`; `Theme`, `toMm`; `buildHtml`.
- Produces:
  - `normalizePdfDates(buf: Buffer, epochSeconds: number): Buffer`
  - `blockNonDataRequests(page: Page): Promise<void>` — aborts every request whose URL is not a `data:` or `about:` URL.
  - `renderPdf(doc: Doc, theme: Theme, opts: { epochSeconds: number; browser?: Browser }): Promise<Buffer>` — passing a `Browser` lets a test suite launch Chromium once instead of per render; when omitted, one is launched and closed internally.
  - `RUNNING_HEADER_PT: number` — the height the running header reserves in the top margin.

The running header is built here, not in `html.ts`, because Chromium renders it in a separate context with none of the page's CSS.

- [ ] **Step 1: Write the failing test for the normaliser**

Create `test/render/normalize-pdf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizePdfDates } from '../../src/render/normalize-pdf.js';

const sample = (stamp: string) =>
  Buffer.from(
    `%PDF-1.4\n<</CreationDate (D:${stamp}+00'00')\n/ModDate (D:${stamp}+00'00')>>\ntrailer\n`,
    'latin1',
  );

describe('normalizePdfDates', () => {
  it('rewrites both date fields to the given epoch', () => {
    const out = normalizePdfDates(sample('20260811233915'), 1_000_000_000).toString('latin1');
    expect(out).toContain("/CreationDate (D:20010909014640+00'00')");
    expect(out).toContain("/ModDate (D:20010909014640+00'00')");
  });

  it('does not change the byte length, so xref offsets stay valid', () => {
    const input = sample('20260811233915');
    expect(normalizePdfDates(input, 1_000_000_000).length).toBe(input.length);
  });

  it('is idempotent', () => {
    const once = normalizePdfDates(sample('20260811233915'), 1_000_000_000);
    expect(normalizePdfDates(once, 1_000_000_000).equals(once)).toBe(true);
  });

  it('leaves a buffer with no date fields untouched', () => {
    const input = Buffer.from('%PDF-1.4\nno dates here\n', 'latin1');
    expect(normalizePdfDates(input, 1_000_000_000).equals(input)).toBe(true);
  });

  it('refuses an epoch it cannot render in fourteen digits', () => {
    expect(() => normalizePdfDates(sample('20260811233915'), -1)).toThrow(/epoch/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/render/normalize-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/render/normalize-pdf.ts`**

```ts
// Two runs of page.pdf() differ in exactly two places: /CreationDate and
// /ModDate. Both are fixed-width, so substituting them in the raw bytes leaves
// every xref offset valid — measured 2026-08-12, and the reason byte-identical
// output costs one regex rather than a PDF rewrite. Chromium emits no /ID.

const DATE_RE = /(\/(?:Creation|Mod)Date \(D:)(\d{14})(\+00'00'\))/g;

function stampOf(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds < 0) {
    throw new Error(`epoch must be a non-negative number of seconds, got ${epochSeconds}`);
  }
  const d = new Date(epochSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  if (year.length !== 4) throw new Error(`epoch ${epochSeconds} does not fit a four-digit year`);
  return `${year}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function normalizePdfDates(buf: Buffer, epochSeconds: number): Buffer {
  const stamp = stampOf(epochSeconds);
  // latin1 is a byte-preserving round trip for every code unit 0..255, which is
  // what makes a string replace safe on binary content here.
  const s = buf.toString('latin1').replace(DATE_RE, `$1${stamp}$3`);
  return Buffer.from(s, 'latin1');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/render/normalize-pdf.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `src/render/pdf.ts`**

```ts
import { chromium, type Browser, type Page } from 'playwright-core';
import type { Doc } from '../ir/types.js';
import { toMm, type Theme } from '../theme/types.js';
import { buildHtml, escapeHtml } from './html.js';
import { normalizePdfDates } from './normalize-pdf.js';

/**
 * How much of the top margin the running header occupies.
 *
 * Chromium draws header and footer templates in the page margin, in a context
 * that has none of the page's CSS. If the margin is smaller than the header,
 * the header is not dropped — it is drawn **over the body text**, and text
 * extraction cannot see the collision because both PDFs extract identically.
 * Measured 2026-08-12; it is why this constant exists rather than a guess at
 * the call site, and why the baseline test rasterises.
 */
export const RUNNING_HEADER_PT = 26;

/**
 * The second guard on "this renderer fetches nothing".
 *
 * `html.ts` already refuses to emit a remote `<img>`, but a promise enforced in
 * one place is enforced nowhere: a future stylesheet, favicon or redirect would
 * leak out silently, and the only symptom would be a PDF that quietly depends on
 * somebody else's server — and appears in their logs. Aborting at the browser
 * makes the property true rather than intended.
 *
 * Exported so a test can apply it to a page it owns and watch what happens.
 */
export async function blockNonDataRequests(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    return route.abort();
  });
}

/** Inline styles only: the header context cannot see the document's stylesheet. */
function runningHeader(doc: Doc, theme: Theme): string {
  const pad = `${(theme.page.marginPt * 1.333).toFixed(0)}px`;
  return `<div style="width:100%;padding:0 ${pad};font-family:Arial,sans-serif;font-size:7pt;color:${theme.colors.muted};display:flex;justify-content:space-between;">
<span>${escapeHtml(doc.meta.title)}</span>
<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

export async function renderPdf(
  doc: Doc,
  theme: Theme,
  opts: { epochSeconds: number; browser?: Browser },
): Promise<Buffer> {
  const html = await buildHtml(doc, theme, { headerHeightPt: RUNNING_HEADER_PT });
  const browser = opts.browser ?? (await chromium.launch());
  const ownsBrowser = opts.browser === undefined;
  try {
    const page = await browser.newPage();
    await blockNonDataRequests(page);
    await page.setContent(html, { waitUntil: 'load' });
    // Without this the first page can rasterise with a fallback face even though
    // the font is embedded, because layout ran before the face was decoded.
    await page.evaluate(() => document.fonts.ready);
    const raw = await page.pdf({
      format: theme.page.size === 'A4' ? 'A4' : 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: runningHeader(doc, theme),
      footerTemplate: '<span></span>',
      margin: {
        // page.pdf() rejects `pt`; mm is the unit the theme converts into.
        top: toMm(theme.page.marginPt + RUNNING_HEADER_PT),
        bottom: toMm(theme.page.marginPt),
        left: toMm(theme.page.marginPt),
        right: toMm(theme.page.marginPt),
      },
    });
    await page.close();
    return normalizePdfDates(Buffer.from(raw), opts.epochSeconds);
  } finally {
    if (ownsBrowser) await browser.close();
  }
}
```

- [ ] **Step 6: Write the PDF test**

Create `test/render/pdf.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { blockNonDataRequests, renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { pdfText } from '../helpers/pdf-text.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

const render = (md: string) =>
  renderPdf(ingestMarkdown(md).doc, theme, { epochSeconds: EPOCH, browser });

describe('renderPdf', () => {
  it('produces identical bytes on two runs', async () => {
    const md = '# Report\n\nHello, world.\n';
    const a = await render(md);
    await new Promise((r) => setTimeout(r, 1100)); // cross a second boundary
    const b = await render(md);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('renders Ukrainian and Polish with the embedded font', async () => {
    const buf = await render('# Тест\n\nПривіт, ґуля і їжак. Zażółć gęślą jaźń.\n');
    const text = (await pdfText(buf)).join(' ');
    expect(text).toContain('Привіт, ґуля і їжак.');
    expect(text).toContain('Zażółć gęślą jaźń.');
  });

  it('embeds Arimo subsets rather than substituting a system face', async () => {
    const buf = await render('# T\n\nПривіт. Zażółć.\n');
    const names = [...buf.toString('latin1').matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /Arimo/.test(n!))).toBe(true);
  });

  it('prints the title once — in the header, not twice in the body', async () => {
    const text = (await pdfText(await render('# Report\n\nBody.\n'))).join(' ');
    expect(text.match(/Report/g)?.length).toBe(2); // the doc title and the running header
  });

  it('lets nothing off the machine, even when the document asks', async () => {
    // A document is untrusted input. If this ever fails, a rendered PDF has
    // become dependent on somebody else's server — and on their logs.
    //
    // The listener has to go on a page this test owns, because renderPdf makes
    // its own; so the guard is exported and applied here to the same effect.
    const page = await browser.newPage();
    const attempted: string[] = [];
    page.on('request', (r) => attempted.push(r.url()));
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));

    await blockNonDataRequests(page);
    await page.setContent(
      '<img src="https://example.invalid/chart.png"><link rel="stylesheet" href="https://example.invalid/a.css">',
      { waitUntil: 'load' },
    );
    await page.close();

    const remote = (us: string[]) => us.filter((u) => !u.startsWith('data:') && !u.startsWith('about:'));
    // Chromium still *attempts* them — the point is that every attempt died at
    // the route handler instead of reaching a socket.
    expect(remote(attempted).length).toBeGreaterThan(0);
    expect(remote(failed).sort()).toEqual(remote(attempted).sort());
  });

  it('draws a remote image as a placeholder rather than fetching it', async () => {
    const text = (await pdfText(await render('# T\n\n![A chart](https://example.invalid/chart.png)\n'))).join(' ');
    expect(text).toContain('A chart');
    expect(text).toContain('example.invalid');
  });

  it('paginates a long document and numbers every page', async () => {
    const long = `# Long\n\n${'Paragraph text that flows.\n\n'.repeat(200)}`;
    const pages = await pdfText(await render(long));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[pages.length - 1]).toMatch(new RegExp(`${pages.length} / ${pages.length}`));
  });
});
```

- [ ] **Step 7: Write the shared text-extraction helper**

Create `test/helpers/pdf-text.ts`. It exists because a substring search over PDF bytes finds nothing: Chromium embeds the font as an Identity-H subset, so the text operands are glyph indices. Extraction must walk `ToUnicode`.

```ts
// Never assert on a PDF by searching its bytes for a phrase — the operands are
// glyph indices, so the search silently finds nothing and the obvious
// conclusion ("the text is missing") is wrong.

export async function pdfText(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(
      content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return pages;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/render/pdf.test.ts`
Expected: PASS, 5 tests.

If "prints the title once" reports a different count, read the extracted text before changing the assertion — the count encodes a real requirement (the title must not appear twice in the body).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Render the IR to a byte-reproducible PDF via Chromium

Normalising the two date fields is all reproducibility costs, because
they are fixed-width and Chromium emits no /ID. The running header lives
here rather than in the stylesheet: Chromium draws it in a context that
cannot see the page's CSS."
```

---

### Task 8: The visual baseline

**Files:**
- Create: `test/fixtures/kitchen-sink.md`
- Create: `test/helpers/raster.ts`
- Test: `test/baseline/kitchen-sink.test.ts`
- Create: `test/baseline/__baseline__/` (committed PNGs, generated in step 4)

**Interfaces:**
- Consumes: `ingestMarkdown`, `resolveTheme`, `renderPdf`, `pdfText`.
- Produces: `rasterPages(buf: Buffer, scale?: number): Promise<Buffer[]>` in `test/helpers/raster.ts`.

Why this task exists: in `tebin-expenses` roughly 500 tests missed a defect in **every one** of five generated documents, because they asserted figures were *present* and never that they *fit*. The spike reproduced exactly that — a header colliding with the title, with identical extracted text either way.

- [ ] **Step 1: Create the fixture**

`test/fixtures/kitchen-sink.md`. It must exercise every block type and all three languages; a fixture that lacks what the feature is gated on tests nothing.

Two notes before you transcribe it. The image is a `data:` URI, so the fixture stays self-contained and nothing is fetched at render time — keep it exactly as written, on its own line so the ingester emits it as a standalone `image` block rather than recording it as unrepresentable. And the fixture deliberately contains **no** page break: `pagebreak` has no Markdown syntax, so a document containing one cannot round-trip through Markdown, and the round-trip assertion below would fail for a reason that is not a defect.

```markdown
# Kitchen Sink — Зразок — Wzorzec

An opening paragraph in English, with **bold**, *italic*, `inline code`, and a
[link](https://example.com) so every inline type is on the page.

## Розділ українською

Привіт, ґуля і їжак. Ці літери — і, ї, ґ, є — існують лише в українській
абетці, тож якщо шрифт підставився, це видно одразу.

## Sekcja po polsku

Zażółć gęślą jaźń. Śródmieście, łódź, ćma, źrebię, żaba — polskie znaki
diakrytyczne w jednym zdaniu.

### A third-level heading

1. First ordered item
2. Second ordered item
3. Third ordered item

- Unordered item
  - Nested one level deeper
  - And a sibling
- Back to the outer level

> A quoted paragraph, set apart by a rule on its left edge.
>
> A second quoted paragraph, to prove the spacing between them.

```ts
const answer: number = 42;
console.log(`the answer is ${answer}`);
```

![A red square, a grey circle and a black bar](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAyNDAgODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIGZpbGw9IiNGNkY2RjQiLz48cmVjdCB4PSI4IiB5PSI4IiB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiNEQTI5MUMiLz48Y2lyY2xlIGN4PSIxMjAiIGN5PSI0MCIgcj0iMjgiIGZpbGw9IiM4OThEOEQiLz48cmVjdCB4PSIxNjgiIHk9IjI0IiB3aWR0aD0iNjQiIGhlaWdodD0iMzIiIGZpbGw9IiMxQTFBMUEiLz48L3N2Zz4=)

The image above is a `data:` URI on purpose: the renderer fetches nothing, so a
fixture that referenced a file on disk would be testing the wrong thing.

| Item | Quantity | Unit price | Currency | Total |
|:-----|---------:|-----------:|:--------:|------:|
| Widget | 12 | 4.50 | EUR | 54.00 |
| Gadget | 3 | 129.99 | EUR | 389.97 |
| Sprocket, long name to test wrapping | 140 | 0.35 | EUR | 49.00 |

---

A closing paragraph after a horizontal rule, long enough to run onto a second
line so that the leading between wrapped lines is visible in the baseline
image and a change to it cannot pass unnoticed.
```

- [ ] **Step 2: Write `test/helpers/raster.ts`**

```ts
import { pdf } from 'pdf-to-img';

/** One PNG per page. Scale 2 is enough to see a collision and small enough to commit. */
export async function rasterPages(buf: Buffer, scale = 2): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const page of await pdf(buf, { scale })) out.push(Buffer.from(page));
  return out;
}
```

- [ ] **Step 3: Write the baseline test**

Create `test/baseline/kitchen-sink.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderPdf } from '../../src/render/pdf.js';
import { renderMarkdown } from '../../src/render/md.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { pdfText } from '../helpers/pdf-text.js';
import { rasterPages } from '../helpers/raster.js';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = join(HERE, '__baseline__');
const ACTUAL = join(HERE, '__actual__');
const EPOCH = 1_000_000_000;

let browser: Browser;
let source: string;
beforeAll(async () => {
  browser = await chromium.launch();
  source = await readFile(join(HERE, '..', 'fixtures', 'kitchen-sink.md'), 'utf8');
});
afterAll(async () => { await browser.close(); });

describe('kitchen sink baseline', () => {
  it('every page matches its committed image', async () => {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));

    await mkdir(ACTUAL, { recursive: true });
    for (const [i, png] of pages.entries()) {
      const name = `page-${String(i + 1).padStart(2, '0')}.png`;
      await writeFile(join(ACTUAL, name), png);
      const golden = join(BASELINE, name);
      expect(existsSync(golden), `no baseline for ${name} — review test/baseline/__actual__/${name} and copy it into __baseline__ if it is correct`).toBe(true);
      expect(png.equals(await readFile(golden)), `${name} differs from its baseline; compare it with test/baseline/__actual__/${name}`).toBe(true);
    }
  });

  it('renders the fixture in more than one page', async () => {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    const pages = await pdfText(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('the running header does not collide with the body', async () => {
    // The collision is invisible to text extraction, so this asserts on the
    // geometry instead: no glyph may sit above the top margin.
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH, browser });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const page = await pdfDoc.getPage(1);
    const height = page.getViewport({ scale: 1 }).height;
    const items = (await page.getTextContent()).items.filter((it) => 'str' in it && it.str.trim() !== '');
    // Header baseline sits inside the top margin; body text must start below it.
    const headerBand = height - theme.page.marginPt;
    const bodyItems = items.filter((it) => 'str' in it && !doc.meta.title.startsWith(it.str.trim()));
    for (const it of bodyItems) {
      const y = (it as { transform: number[] }).transform[5]!;
      expect(y, `a glyph sits inside the top margin: ${(it as { str: string }).str}`).toBeLessThan(headerBand);
    }
  });

  it('drops nothing from the fixture', async () => {
    expect(ingestMarkdown(source).dropped).toEqual([]);
  });

  it('round-trips through Markdown unchanged', async () => {
    const once = renderMarkdown(ingestMarkdown(source).doc);
    expect(renderMarkdown(ingestMarkdown(once).doc)).toBe(once);
  });
});
```

- [ ] **Step 4: Generate the baseline, then look at it**

Run the test once. It fails with "no baseline for page-01.png". Then:

```bash
mkdir -p test/baseline/__baseline__
cp test/baseline/__actual__/*.png test/baseline/__baseline__/
```

**Before committing, open every generated PNG and look at it.** This step is the point of the task, not a formality. Check specifically: the running header does not touch the title; the table's columns are aligned as the fixture asks (left, right, right, centre, right); no cell's text is clipped; Ukrainian and Polish letters are all drawn, with no boxes or missing glyphs; the code block does not run past the right margin; nothing is orphaned at the foot of a page.

If anything is wrong, fix the renderer and regenerate — **never** accept a baseline that shows a defect. A baseline is a promise that this is what correct looks like.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add the kitchen-sink fixture and its visual baseline

Rendering the artefact and looking at it is the only check that sees a
header colliding with a title: both PDFs extract identical text. The
fixture carries Ukrainian, Polish and English so a substituted font
fails the image comparison instead of passing quietly."
```

---

### Task 9: The CLI

**Files:**
- Create: `src/bin/documentor.ts`
- Create: `src/cli/build.ts`
- Create: `src/cli/doctor.ts`
- Create: `src/cli/timestamp.ts`
- Test: `test/cli/timestamp.test.ts`
- Test: `test/cli/build.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `resolveEpoch(env: NodeJS.ProcessEnv, inputPath: string): Promise<number>`
  - `runBuild(argv: string[], io: { log: (s: string) => void; err: (s: string) => void }): Promise<number>` — returns a process exit code.
  - `runDoctor(io: { log: (s: string) => void }): Promise<number>`

CLI shape:

```
documentor build <file> [--to pdf,md] [--theme plain] [--out <dir>] [--title <s>]
documentor doctor
```

Output files land beside the input as `<basename>.<theme>.<ext>` unless `--out` names a directory. The theme id in the name is what stops an input `report.pdf` from overwriting itself.

- [ ] **Step 1: Write the failing test for the timestamp**

Create `test/cli/timestamp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEpoch } from '../../src/cli/timestamp.js';

async function fileWithMtime(epoch: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-ts-'));
  const file = join(dir, 'a.md');
  await writeFile(file, '# x\n');
  await utimes(file, epoch, epoch);
  return file;
}

describe('resolveEpoch', () => {
  it('prefers SOURCE_DATE_EPOCH', async () => {
    const file = await fileWithMtime(1_600_000_000);
    expect(await resolveEpoch({ SOURCE_DATE_EPOCH: '1000000000' }, file)).toBe(1_000_000_000);
  });

  it("falls back to the input file's mtime", async () => {
    const file = await fileWithMtime(1_600_000_000);
    expect(await resolveEpoch({}, file)).toBe(1_600_000_000);
  });

  it('rejects a SOURCE_DATE_EPOCH that is not a non-negative integer', async () => {
    const file = await fileWithMtime(1_600_000_000);
    await expect(resolveEpoch({ SOURCE_DATE_EPOCH: 'yesterday' }, file)).rejects.toThrow(/SOURCE_DATE_EPOCH/);
    await expect(resolveEpoch({ SOURCE_DATE_EPOCH: '-5' }, file)).rejects.toThrow(/SOURCE_DATE_EPOCH/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/cli/timestamp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/cli/timestamp.ts`**

```ts
import { stat } from 'node:fs/promises';

/**
 * The build's notion of "now". Never Date.now(): a timestamp read from the
 * clock is the one thing that would make output non-reproducible, and it would
 * do so silently.
 */
export async function resolveEpoch(env: NodeJS.ProcessEnv, inputPath: string): Promise<number> {
  const raw = env['SOURCE_DATE_EPOCH'];
  if (raw !== undefined && raw !== '') {
    if (!/^\d+$/.test(raw)) {
      throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer number of seconds, got ${JSON.stringify(raw)}`);
    }
    return Number(raw);
  }
  return Math.floor((await stat(inputPath)).mtimeMs / 1000);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/cli/timestamp.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `src/cli/build.ts`**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ingestMarkdown } from '../ingest/md.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { loadTheme } from '../theme/resolve.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };
const FORMATS = new Set(['pdf', 'md']); // phase 1; docx and xlsx arrive in phases 2 and 3

export function parseArgs(argv: string[]): {
  input?: string; to: string[]; theme: string; out?: string; title?: string;
} {
  const out: { input?: string; to: string[]; theme: string; out?: string; title?: string } = {
    to: ['pdf'], theme: 'plain',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--to') out.to = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--theme') out.theme = next();
    else if (a === '--out') out.out = next();
    else if (a === '--title') out.title = next();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

export async function runBuild(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err('documentor: build needs an input file\n\n  documentor build <file> [--to pdf,md] [--theme plain] [--out <dir>]');
    return 2;
  }
  for (const f of args.to) {
    if (!FORMATS.has(f)) {
      io.err(`documentor: cannot write ${JSON.stringify(f)} yet — this build knows ${[...FORMATS].join(', ')}`);
      return 2;
    }
  }

  const input = resolve(args.input);
  const ext = extname(input).toLowerCase();
  if (ext !== '.md' && ext !== '.markdown') {
    io.err(`documentor: cannot read ${ext || 'a file with no extension'} yet — this build reads .md`);
    return 2;
  }

  const source = await readFile(input, 'utf8');
  const { doc, dropped } = ingestMarkdown(source, args.title === undefined ? {} : { title: args.title });
  const theme = await loadTheme(args.theme);
  const epochSeconds = await resolveEpoch(process.env, input);

  if (dropped.length) {
    io.err(`documentor: ${dropped.length} thing(s) the document format cannot hold were left out:`);
    for (const d of dropped) io.err(`  - ${d}`);
  }

  const dir = args.out === undefined ? dirname(input) : resolve(args.out);
  await mkdir(dir, { recursive: true });
  const stem = basename(input, extname(input));

  for (const format of args.to) {
    const target = join(dir, `${stem}.${theme.id}.${format}`);
    if (resolve(target) === input) {
      io.err(`documentor: refusing to overwrite the input file ${input}`);
      return 1;
    }
    const bytes = format === 'pdf'
      ? await renderPdf(doc, theme, { epochSeconds })
      : Buffer.from(renderMarkdown(doc), 'utf8');
    await writeFile(target, bytes);
    io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
  }
  return 0;
}
```

- [ ] **Step 6: Write `src/cli/doctor.ts`**

```ts
import { chromium } from 'playwright-core';
import { arimoFaceCss } from '../render/fonts.js';
import { loadTheme } from '../theme/resolve.js';

type Check = { name: string; ok: boolean; detail: string; fix?: string };

/**
 * Says what is missing and the command that fixes it. A diagnostic that only
 * reports "not ready" makes the user guess; this one does not.
 */
export async function runDoctor(io: { log: (s: string) => void }): Promise<number> {
  const checks: Check[] = [];

  const [major] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'Node',
    ok: (major ?? 0) >= 22,
    detail: `v${process.versions.node}`,
    fix: 'install Node 22 or newer',
  });

  try {
    const browser = await chromium.launch();
    checks.push({ name: 'Chromium', ok: true, detail: browser.version() });
    await browser.close();
  } catch (e) {
    checks.push({
      name: 'Chromium',
      ok: false,
      detail: (e as Error).message.split('\n')[0] ?? 'failed to launch',
      fix: 'npx playwright install chromium',
    });
  }

  try {
    const css = await arimoFaceCss();
    const faces = css.match(/@font-face/g)?.length ?? 0;
    checks.push({ name: 'Font', ok: faces === 6, detail: `${faces} Arimo faces inlined`, fix: 'npm install' });
  } catch (e) {
    checks.push({ name: 'Font', ok: false, detail: (e as Error).message, fix: 'npm install' });
  }

  try {
    const theme = await loadTheme('plain');
    checks.push({ name: 'Theme', ok: true, detail: `${theme.name} (${theme.page.size})` });
  } catch (e) {
    checks.push({ name: 'Theme', ok: false, detail: (e as Error).message, fix: 'reinstall the package' });
  }

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    io.log(`${c.ok ? 'ok  ' : 'MISS'}  ${c.name.padEnd(width)}  ${c.detail}`);
    if (!c.ok && c.fix) io.log(`      ${' '.repeat(width)}  fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  io.log(failed === 0 ? '\nReady.' : `\n${failed} check(s) need attention.`);
  return failed === 0 ? 0 : 1;
}
```

- [ ] **Step 7: Write `src/bin/documentor.ts`**

```ts
#!/usr/bin/env node
import { runBuild } from '../cli/build.js';
import { runDoctor } from '../cli/doctor.js';

const USAGE = `documentor — re-issue an existing document as a well-typeset one

  documentor build <file> [--to pdf,md] [--theme plain] [--out <dir>] [--title <s>]
  documentor doctor

Output lands beside the input as <name>.<theme>.<ext>.`;

const io = { log: (s: string) => console.log(s), err: (s: string) => console.error(s) };
const [command, ...rest] = process.argv.slice(2);

let code = 0;
try {
  if (command === 'build') code = await runBuild(rest, io);
  else if (command === 'doctor') code = await runDoctor(io);
  else if (command === undefined || command === '--help' || command === '-h') { io.log(USAGE); code = command === undefined ? 2 : 0; }
  else { io.err(`documentor: unknown command ${JSON.stringify(command)}\n\n${USAGE}`); code = 2; }
} catch (e) {
  io.err(`documentor: ${(e as Error).message}`);
  code = 1;
}
process.exit(code);
```

- [ ] **Step 8: Write the CLI test**

Create `test/cli/build.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runBuild } from '../../src/cli/build.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function fixture(md: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-'));
  const file = join(dir, 'report.md');
  await writeFile(file, md);
  return file;
}

describe('parseArgs', () => {
  it('defaults to pdf and the plain theme', () => {
    expect(parseArgs(['a.md'])).toEqual({ input: 'a.md', to: ['pdf'], theme: 'plain' });
  });
  it('splits --to on commas', () => {
    expect(parseArgs(['a.md', '--to', 'pdf, md']).to).toEqual(['pdf', 'md']);
  });
  it('rejects an unknown option', () => {
    expect(() => parseArgs(['a.md', '--colour'])).toThrow(/--colour/);
  });
});

describe('runBuild', () => {
  it('writes the output beside the input, named after the theme', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.plain.md']);
  });

  it('honours --out', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-out-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    expect(await readdir(out)).toEqual(['report.plain.md']);
  });

  it('reports what the ingester had to leave out', async () => {
    const file = await fixture('# Report\n\n<div>raw</div>\n');
    const { io, err } = collect();
    await runBuild([file, '--to', 'md'], io);
    expect(err.join('\n')).toMatch(/html/i);
  });

  it('refuses a format it cannot write yet, naming the ones it can', async () => {
    const file = await fixture('# R\n');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'docx'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/pdf, md/);
  });

  it('refuses an input extension it cannot read yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-x-'));
    const file = join(dir, 'a.docx');
    await writeFile(file, 'not really a docx');
    const { io, err } = collect();
    expect(await runBuild([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.md/);
  });

  it('produces identical bytes on two runs', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    await runBuild([file, '--to', 'pdf'], io);
    const first = await readFile(join(file, '..', 'report.plain.pdf'));
    await new Promise((r) => setTimeout(r, 1100));
    await runBuild([file, '--to', 'pdf'], io);
    const second = await readFile(join(file, '..', 'report.plain.pdf'));
    expect(Buffer.compare(first, second)).toBe(0);
  });
});
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run test/cli/`
Expected: PASS, 9 tests.

- [ ] **Step 10: Try it by hand and look at the result**

```bash
npx tsx src/bin/documentor.ts doctor
npx tsx src/bin/documentor.ts build test/fixtures/kitchen-sink.md --to pdf,md --out /tmp/documentor-demo
```

Open the produced PDF and read it. If it is not a document you would send to somebody, the task is not done.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add the documentor CLI: build and doctor

Output is named <stem>.<theme>.<ext> so an input PDF can never overwrite
itself, and doctor names the command that fixes each missing piece
rather than only reporting that something is missing."
```

---

### Task 10: Guardrails and CI

**Files:**
- Create: `test/guardrails/no-wall-clock.test.ts`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: nothing importable. This task defends the constraints the earlier tasks established.

- [ ] **Step 1: Write the guardrail test**

Create `test/guardrails/no-wall-clock.test.ts`. `resolveEpoch` is the single sanctioned door to a timestamp; a stray `Date.now()` anywhere else silently breaks reproducibility, and no output test would necessarily catch it.

```ts
import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tsFiles(p)));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('reproducibility guardrails', () => {
  it('no source file reads the wall clock', async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles(SRC)) {
      const text = await readFile(file, 'utf8');
      // normalize-pdf.ts constructs a Date from an explicit epoch, which is fine;
      // an argument-less `new Date()` or a Date.now() is not.
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        if (/\bDate\.now\s*\(/.test(line) || /\bnew Date\s*\(\s*\)/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'timestamps must come from resolveEpoch, never the clock').toEqual([]);
  });

  it('no source file fetches over the network', async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles(SRC)) {
      const text = await readFile(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        if (/\bfetch\s*\(/.test(line) || /https?:\/\//.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'the renderer must inline every asset, never fetch one').toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/guardrails/`
Expected: PASS, 2 tests. If it reports an offender, fix the source — not the test.

- [ ] **Step 2b: Write the built-output smoke test**

Create `test/guardrails/dist-smoke.test.ts`. The whole suite runs from `src/`, so nothing else in the project ever exercises the artefact users actually install. Task 4 shipped a `packageRoot()` bug that was invisible from source and only appeared in `dist/`; this test is what stops the next one.

```ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENTRY = join(ROOT, 'dist', 'bin', 'documentor.js');

// `npm run build` is slow, so this suite does not run it — it asserts against
// whatever is already built and skips otherwise. CI builds before testing, so
// there the skip never fires; locally it keeps a fast watch loop fast.
describe.skipIf(!existsSync(ENTRY))('the built CLI', () => {
  it('loads its own bundled theme and reports itself ready', () => {
    const out = execFileSync(process.execPath, [ENTRY, 'doctor'], { encoding: 'utf8' });
    expect(out).toMatch(/^ok\s+Theme/m);
  });
});
```

Note the `skipIf`: a test that silently passes when it did not run is worse than no test. CI runs `npm run build` before `npx vitest run`, so add that step to the workflow below and confirm in the job log that this spec reports as run, not skipped.

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

The baseline image comparison is pinned to **one** platform: PNGs rasterised from the same PDF differ across platforms, so comparing them everywhere would redden CI for its own reasons rather than for a real change. That platform is `windows-latest`, because the baseline is generated on the developer's Windows machine in Task 8 — pinning it to Linux instead would mean the committed images could never match, which is a check that fails for its own reasons in the other direction.

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run typecheck
      # Built before the tests so test/guardrails/dist-smoke.test.ts runs
      # rather than skipping — it is the only check that touches the artefact
      # users actually install.
      - run: npm run build
      - name: Test (excluding the image baseline)
        if: matrix.os != 'windows-latest'
        run: npx vitest run --exclude 'test/baseline/kitchen-sink.test.ts'
      - name: Test (with the image baseline)
        if: matrix.os == 'windows-latest'
        run: npx vitest run
      - name: Upload the rendered pages when they differ
        if: failure() && matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v4
        with:
          name: rendered-pages
          path: test/baseline/__actual__/
```

The committed baseline is generated on Windows in Task 8, so `windows-latest` is the job that compares it. The other two platforms still run every other test, including the byte-identical-output gate — which is the check that actually has to hold everywhere.

If `--exclude` is not honoured by the installed vitest version, use `npx vitest run --project` filtering or move the baseline spec behind an environment variable (`BASELINE=1`) that only the Windows job sets. Do not silently let the baseline run unpinned on three platforms.

- [ ] **Step 4: Write `README.md`**

```markdown
# documentor

Take a document somebody already wrote and re-issue it as a well-typeset one.

```bash
npx @tebin/documentor build report.md --to pdf
```

The result lands beside the input as `report.plain.pdf`.

## What it does

`documentor` reads a source document into a small, format-agnostic
representation, then draws that representation with a theme. The look lives in
one place, so a PDF and a Word file made from the same source cannot drift
apart.

Phase 1 reads Markdown and writes PDF and Markdown. Word, Excel, and reading
`.docx` / `.xlsx` / `.pdf` follow.

## Reproducible by construction

The same input produces byte-identical output, on every platform:

- timestamps come from `SOURCE_DATE_EPOCH` or the input file's mtime, never the
  clock;
- the font is embedded, not resolved from the system, so a machine without
  Arial does not silently re-wrap every line;
- the renderer fetches nothing — CSS, fonts and logos are inlined before the
  browser sees the page.

## Themes

The default theme, `plain`, carries no brand. A theme is one JSON file:

```bash
documentor build report.md --theme ./my-brand/theme.json
```

See `themes/plain/theme.json` for the shape.

## Requirements

Node 22+ and Chromium:

```bash
npx playwright install chromium
documentor doctor
```

`doctor` reports what is missing and the command that fixes it.

## License

MIT. See `LICENSE`.
```

- [ ] **Step 5: Run the whole suite one last time**

Run: `npm run typecheck && npx vitest run`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add reproducibility guardrails, CI and the README

The guardrail tests grep the source for a wall-clock read and for a
network fetch, because both break a promise no output assertion would
necessarily catch. The image baseline runs on Linux only: PNGs from one
PDF differ across platforms, and a check that cries wolf stops being
read."
```

---

## Definition of done for Phase 1

- `documentor build test/fixtures/kitchen-sink.md --to pdf,md` produces a PDF a
  person would be content to send, and running it twice gives identical bytes.
- `documentor doctor` reports every check green on a clean machine after
  `npm ci && npx playwright install chromium`.
- `npm run typecheck && npx vitest run` is green on Linux, macOS and Windows.
- Somebody has **opened** the baseline images and looked at them.
