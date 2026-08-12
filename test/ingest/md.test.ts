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

  it('emits a lone image with no phantom paragraph', () => {
    const { doc } = ingestMarkdown('# T\n\n![a](x.png)\n');
    expect(doc.blocks).toEqual([{ t: 'image', src: 'x.png', alt: 'a' }]);
  });

  it('keeps both text runs around an inline image and puts the image after the paragraph', () => {
    const { doc } = ingestMarkdown('# T\n\nHello ![a](x.png) world.\n');
    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'Hello ' }, { t: 'text', v: ' world.' }] },
      { t: 'image', src: 'x.png', alt: 'a' },
    ]);
  });

  it('preserves the order of two images in one paragraph', () => {
    const { doc } = ingestMarkdown('# T\n\nA ![i1](1.png) B ![i2](2.png) C\n');
    expect(doc.blocks.slice(1)).toEqual([
      { t: 'image', src: '1.png', alt: 'i1' },
      { t: 'image', src: '2.png', alt: 'i2' },
    ]);
  });

  it('drops an image inside a table cell instead of emitting a phantom block', () => {
    const { doc, dropped } = ingestMarkdown('# T\n\n| a |\n|---|\n| ![a](x.png) |\n');
    expect(doc.blocks).toEqual([{ t: 'table', head: [[{ t: 'text', v: 'a' }]], rows: [[[]]], align: ['l'] }]);
    expect(dropped.join(' ')).toMatch(/image/i);
  });

  it('records list item membership loss when a code block is lifted out of a list item', () => {
    const { doc, dropped } = ingestMarkdown('# T\n\n- one\n\n  ```js\n  x\n  ```\n');
    expect(doc.blocks.map((b) => b.t)).toEqual(['list', 'code']);
    expect(doc.blocks[1]).toMatchObject({ lang: 'js', text: 'x' });
    expect(dropped.join(' ')).toMatch(/list item/i);
  });

  it('keeps Ukrainian and Polish text intact', () => {
    const { doc } = ingestMarkdown('# T\n\nПривіт, ґуля. Zażółć gęślą jaźń.');
    expect(doc.blocks[0]).toEqual({
      t: 'para',
      text: [{ t: 'text', v: 'Привіт, ґуля. Zażółć gęślą jaźń.' }],
    });
  });
});
