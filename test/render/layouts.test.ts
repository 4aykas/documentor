import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Block, Inline } from '../../src/ir/types.js';
import { buildHtml, layoutKit } from '../../src/render/html.js';
import { asGates, coverParts, plain } from '../../src/render/layouts/common.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';
import { LAYOUT_IDS } from '../../src/theme/types.js';

const COVER = readFileSync(fileURLToPath(new URL('../fixtures/cover.md', import.meta.url)), 'utf8');

const PROGRAMME = `# DELIVERY APPROACH

COASTAL PROGRAMME

Phase 2 — Adaptive design

---

| | |
|---|---|
| Document No. | DA-0007 |
| Date | 10.10.2026 |

> A statement the cover sets large.
>
> A second statement paragraph.

Prepared by the team

---

Client line one

<!-- pagebreak -->

# 1. Purpose

A paragraph with **bold** words.

- A bullet
- Another bullet

# 2. Gates

| Gate | Decision | Evidence | Date |
|:--|:--|:--|:--|
| G0 | Mobilise | This document | Nov 2026 |
| G1 | Freeze the model | Calibration report | Mar 2027 |
| G2 | Consent | Application | Sep 2027 |

1. First step
2. Second step
`;

/** Every run of text the document carries, as the words a reader would see. */
function words(blocks: Block[]): string[] {
  const out: string[] = [];
  const add = (n: Inline[]) => out.push(...plain(n).split(/\s+/).filter(Boolean));
  for (const b of blocks) {
    if (b.t === 'heading' || b.t === 'para') add(b.text);
    else if (b.t === 'list') b.items.forEach(add);
    else if (b.t === 'quote') b.paras.forEach(add);
    else if (b.t === 'table') [b.head, ...b.rows].forEach((r) => r.forEach(add));
  }
  return out;
}

const visible = (html: string) =>
  html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

describe('a theme\'s layout', () => {
  it('is null unless named, and must be one the renderer has', () => {
    expect(resolveTheme({}).layout).toBeNull();
    expect(resolveTheme({ layout: 'rams' }).layout).toBe('rams');
    expect(() => resolveTheme({ layout: 'bauhaus' })).toThrow(/layout.*rams, rodchenko, haskoning/);
  });

  it('is what the three designed themes name', async () => {
    for (const id of LAYOUT_IDS) expect((await loadTheme(id)).layout).toBe(id);
    expect((await loadTheme('plain')).layout).toBeNull();
  });
});

describe('taking a cover apart', () => {
  it('puts every cover block in exactly one piece', async () => {
    const { doc } = await ingestMarkdown(PROGRAMME, { cover: true });
    const p = coverParts(doc);
    expect(p.title).toBe('DELIVERY APPROACH');
    expect(p.lines.map(plain)).toEqual(['COASTAL PROGRAMME', 'Phase 2 — Adaptive design']);
    expect(p.pairs.map(([k, v]) => `${plain(k)}=${plain(v)}`)).toEqual(['Document No.=DA-0007', 'Date=10.10.2026']);
    expect(p.statement.map(plain)).toEqual(['A statement the cover sets large.', 'A second statement paragraph.']);
    expect(p.contacts.map(plain)).toEqual(['Prepared by the team']);
    expect(p.foot.map(plain)).toEqual(['Client line one']);
    expect(p.extra).toEqual([]);
    expect(p.rest[0]).toMatchObject({ t: 'heading', level: 1 });
  });
});

describe('the gate figure', () => {
  it('recognises a short table of gate codes and places dated gates in months', async () => {
    const { doc } = await ingestMarkdown(PROGRAMME);
    const table = doc.blocks.find((b) => b.t === 'table' && !b.head.every((h) => h.length === 0))!;
    const g = asGates(table, layoutKit(await loadTheme('rams')))!;
    expect(g.rows.map((r) => r.code)).toEqual(['G0', 'G1', 'G2']);
    expect(g.rows.map((r) => r.month)).toEqual([0, 4, 10]);
  });

  it('leaves an ordinary table a table', async () => {
    const { doc } = await ingestMarkdown('| Item | Qty |\n|---|---|\n| Widget | 1 |\n| Gadget | 2 |\n');
    expect(asGates(doc.blocks[0]!, layoutKit(await loadTheme('rams')))).toBeNull();
  });
});

describe.each(LAYOUT_IDS)('the %s layout', (id) => {
  it('sets every word of a covered programme document', async () => {
    const { doc } = await ingestMarkdown(PROGRAMME, { cover: true });
    const html = visible(await buildHtml(doc, await loadTheme(id)));
    const missing = [doc.meta.title, ...words(doc.blocks)].filter((w) => !html.includes(w));
    expect(missing).toEqual([]);
  });

  it('sets every word of a document with no cover, and of the cover fixture', async () => {
    for (const [src, opts] of [[PROGRAMME, {}], [COVER, { cover: true }]] as const) {
      const { doc } = await ingestMarkdown(src, opts);
      const html = visible(await buildHtml(doc, await loadTheme(id)));
      expect([doc.meta.title, ...words(doc.blocks)].filter((w) => !html.includes(w))).toEqual([]);
    }
  });

  it('fetches nothing', async () => {
    const { doc } = await ingestMarkdown(PROGRAMME, { cover: true });
    const html = await buildHtml(doc, await loadTheme(id));
    expect(html).not.toMatch(/(?:src|href)="https?:|url\((?!data:)['"]?https?:/);
  });
});
