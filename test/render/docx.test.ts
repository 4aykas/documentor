import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });
const render = (doc: Doc) => renderDocx(doc, theme, { epochSeconds: EPOCH });
const body = async (doc: Doc) => docxPart(await render(doc), 'word/document.xml');
const doc = (...blocks: Doc['blocks']): Doc => ({ meta: { title: 'T', lang: 'en' }, blocks });

describe('renderDocx', () => {
  it('produces identical bytes on two runs', async () => {
    const d = doc(
      { t: 'para', text: [{ t: 'link', href: 'https://example.com', children: [{ t: 'text', v: 'x' }] }] },
      { t: 'para', text: [{ t: 'text', v: 'y' }] },
    );
    expect((await render(d)).equals(await render(d))).toBe(true);
  });

  it('styles headings with ids of its own, not the ones docx already defines', async () => {
    const styles = await docxPart(await render(doc({ t: 'heading', level: 2, text: [{ t: 'text', v: 'H' }] })), 'word/styles.xml');
    // docx always emits a built-in Heading1..6. A style of ours with the same
    // id would be a duplicate w:styleId and which one wins is undefined.
    expect(styles).toContain('w:styleId="DocH2"');
    expect(styles.match(/w:styleId="Heading2"/g)?.length ?? 0).toBe(1);
  });

  it('keeps a heading in Word’s outline', async () => {
    expect(await body(doc({ t: 'heading', level: 2, text: [{ t: 'text', v: 'H' }] }))).toContain('<w:outlineLvl w:val="1"/>');
  });

  it('carries emphasis as structure', async () => {
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'strong', children: [{ t: 'text', v: 'b' }] }, { t: 'em', children: [{ t: 'text', v: 'i' }] }],
    }));
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('numbers an ordered list from the IR’s own start', async () => {
    const xml = await body(doc({ t: 'list', ordered: true, depth: 0, start: 4, items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }));
    expect(xml).toContain('4.');
    expect(xml).toContain('5.');
  });

  it('indents a nested list by its depth', async () => {
    const xml = await body(doc({ t: 'list', ordered: false, depth: 2, items: [[{ t: 'text', v: 'deep' }]] }));
    expect(xml).toMatch(/<w:ind w:left="\d+"/);
  });

  it('breaks the page where the IR says to', async () => {
    expect(await body(doc({ t: 'pagebreak' }))).toContain('<w:br w:type="page"/>');
  });

  it('writes a table with an explicit grid and a cell width for every column', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Qty' }]],
      rows: [[[{ t: 'text', v: 'Widget' }], [{ t: 'text', v: '12' }]]],
      align: ['l', 'r'],
    }));
    expect(xml).toContain('<w:tblGrid>');
    expect(xml).toMatch(/<w:gridCol w:w="\d+"\/><w:gridCol w:w="\d+"\/>/);
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('Widget');
  });

  it('links out, and puts the target only in the relationships', async () => {
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'https://example.com/a', children: [{ t: 'text', v: 'go' }] }] }));
    expect(await docxPart(buf, 'word/document.xml')).not.toContain('example.com');
    expect(await docxPart(buf, 'word/_rels/document.xml.rels')).toContain('Target="https://example.com/a"');
  });

  it('refuses an executable link scheme, the same as the other two renderers', async () => {
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'go' }] }] }));
    const xml = await docxPart(buf, 'word/document.xml');
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    expect(xml).not.toContain('<w:hyperlink');
    expect(rels).not.toContain('javascript');
    expect(xml).toContain('go');
    expect(xml).toContain('javascript:');
  });

  it('sets the document up for a different first page', async () => {
    const xml = await body(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }));
    expect(xml).toContain('<w:titlePg/>');
  });

  it('declares every relationship it references', async () => {
    // The failure this catches is not hypothetical: a part that references an
    // r:id its own .rels does not declare makes Word ask to repair the file,
    // for everyone it was sent to, on every open.
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'https://example.com/a', children: [{ t: 'text', v: 'go' }] }] }));
    const part = await docxPart(buf, 'word/document.xml');
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    const declared = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]!));
    for (const m of part.matchAll(/r:(?:id|embed)="([^"]+)"/g)) {
      expect(declared.has(m[1]!), `word/document.xml references ${m[1]} but its .rels does not declare it`).toBe(true);
    }
  });

  it('prints the title, and the subtitle when there is one', async () => {
    const xml = await docxPart(
      await renderDocx({ meta: { title: 'Report', subtitle: 'Q3', lang: 'en' }, blocks: [] }, theme, { epochSeconds: EPOCH }),
      'word/document.xml',
    );
    expect(xml).toContain('Report');
    expect(xml).toContain('Q3');
  });
});
