import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ingestDocx } from '../../src/ingest/docx.js';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });

// A 1×1 PNG — the smallest input pngSize() in src/render/docx.ts (and this
// ingester's own raster sniffer) will accept.
const PNG_HEX =
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009077530000000a49444154789c6300010000050001a5f645400000000049454e44ae426082';
const PNG_DATA_URI = `data:image/png;base64,${Buffer.from(PNG_HEX, 'hex').toString('base64')}`;

/**
 * Zips a handful of XML strings into a minimal .docx, for the fixtures the
 * round trip can't reach: this project's own renderer never writes
 * `<w:numPr>` (its lists are literal marker text — see the comment in
 * src/render/docx.ts explaining why), so numbering can only be exercised by
 * a package built by hand. A committed binary would be undiffable; this
 * isn't, and it only needs the parts ingestDocx.ts actually reads —
 * `[Content_Types].xml` and `_rels/.rels` are irrelevant to it and omitted.
 */
async function buildDocx(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const documentXml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
const para = (inner: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${inner}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const numPr = (numId: number, ilvl = 0) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

describe('ingestDocx — round trip through this project’s own renderer', () => {
  const doc: Doc = {
    meta: { title: 'Reply to Request 4.2', subtitle: 'Confidential', lang: 'en', date: 'July 20, 2026' },
    blocks: [
      { t: 'heading', level: 1, text: [{ t: 'text', v: 'Background' }] },
      { t: 'heading', level: 2, text: [{ t: 'text', v: 'Detail' }] },
      { t: 'heading', level: 3, text: [{ t: 'text', v: 'Further detail' }] },
      {
        t: 'para',
        text: [
          { t: 'text', v: 'A ' },
          { t: 'strong', children: [{ t: 'text', v: 'bold' }] },
          { t: 'text', v: ' and ' },
          { t: 'em', children: [{ t: 'text', v: 'italic' }] },
          { t: 'text', v: ' and ' },
          { t: 'strong', children: [{ t: 'em', children: [{ t: 'text', v: 'both' }] }] },
          { t: 'text', v: ' word.' },
        ],
      },
      { t: 'para', text: [{ t: 'link', href: 'https://example.com/a', children: [{ t: 'text', v: 'go' }] }] },
      { t: 'pagebreak' },
      // The renderer never writes an image's alt text (see docx.ts's own
      // comment on it), so an ingester reading this project's own output back
      // can only ever recover an empty string here — this is not a round
      // trip gap ingestDocx.ts introduces.
      { t: 'image', src: PNG_DATA_URI, alt: '' },
    ],
  };

  it('recovers everything the renderer emits: headings, emphasis, a hyperlink, a page break and an image', async () => {
    const buf = await renderDocx(doc, theme, { epochSeconds: EPOCH });
    const { doc: back, dropped } = await ingestDocx(buf);

    expect(back.meta.title).toBe(doc.meta.title);
    expect(back.meta.subtitle).toBe(doc.meta.subtitle);
    expect(back.meta.date).toBe(doc.meta.date);
    expect(back.blocks).toEqual(doc.blocks);
    // The letterhead itself (dropped by design) still shows up as a loud
    // drop, even though its one piece of content — the date — was carried.
    expect(dropped.join(' ')).toMatch(/letterhead dropped/);
  });

  it('lets an explicit title/date override what the header carried', async () => {
    const buf = await renderDocx(doc, theme, { epochSeconds: EPOCH });
    const { doc: back } = await ingestDocx(buf, { title: 'Given Title', date: 'Given Date' });
    expect(back.meta.title).toBe('Given Title');
    expect(back.meta.date).toBe('Given Date');
  });
});

describe('ingestDocx — hand-built fixtures (what the round trip cannot reach)', () => {
  it('reads a numbered and a bulleted list, each at two levels, via the two-hop numId → abstractNum lookup', async () => {
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="10">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="20">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
    </w:numbering>`;

    const body = [
      para(run('one'), numPr(1, 0)),
      para(run('two'), numPr(1, 0)),
      para(run('sub'), numPr(1, 1)),
      para(run('bullet one'), numPr(2, 0)),
      para(run('bullet sub'), numPr(2, 1)),
    ].join('');

    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'sub' }]] },
      { t: 'list', ordered: false, depth: 0, items: [[{ t: 'text', v: 'bullet one' }]] },
      { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'bullet sub' }]] },
    ]);
  });

  it('degrades a numId with no numbering definition to a plain paragraph, loudly, instead of crashing', async () => {
    const body = para(run('orphan'), numPr(999, 0));
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: 'orphan' }] }]);
    expect(dropped.join(' ')).toMatch(/numbering unresolved/);
  });

  it('resolves a hyperlink through word/_rels/document.xml.rels by the run’s r:id', async () => {
    const body = para(
      `<w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">click here</w:t></w:r></w:hyperlink>`,
    );
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://tebin.example/reply" TargetMode="External"/>
    </Relationships>`;
    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/_rels/document.xml.rels': relsXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'link', href: 'https://tebin.example/reply', children: [{ t: 'text', v: 'click here' }] }] },
    ]);
  });

  it('reads a header carrying the date the corpus actually uses', async () => {
    const headerXml = `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}>
      <w:p><w:r><w:t>TEBIN Legal</w:t></w:r></w:p>
      <w:p><w:r><w:t>July 20, 2026</w:t></w:r></w:p>
    </w:hdr>`;
    const buf = await buildDocx({ 'word/document.xml': documentXml(para(run('body'))), 'word/header1.xml': headerXml });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.meta.date).toBe('July 20, 2026');
    expect(dropped.join(' ')).toMatch(/kept the date it carried: "July 20, 2026"/);
  });

  it('yields no date from a header that does not carry one, without dropping silently', async () => {
    const headerXml = `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}><w:p><w:r><w:t>TEBIN Legal, 1 Example Street</w:t></w:r></w:p></w:hdr>`;
    const buf = await buildDocx({ 'word/document.xml': documentXml(para(run('body'))), 'word/header1.xml': headerXml });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.meta.date).toBeUndefined();
    expect(dropped.join(' ')).toMatch(/no date found/);
  });

  it('drops a table loudly, naming its size, instead of reading it', async () => {
    const tbl = `<w:tbl><w:tr><w:tc><w:p>${run('a')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('b')}</w:p></w:tc></w:tr></w:tbl>`;
    const buf = await buildDocx({ 'word/document.xml': documentXml(para(run('before')) + tbl + para(run('after'))) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'before' }] },
      { t: 'para', text: [{ t: 'text', v: 'after' }] },
    ]);
    expect(dropped).toContain('table with 2 rows');
  });

  it('clamps a Heading5 to level 3 and reports the clamp', async () => {
    const body = para(run('Deep heading'), '<w:pStyle w:val="Heading5"/>');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'heading', level: 3, text: [{ t: 'text', v: 'Deep heading' }] }]);
    expect(dropped.join(' ')).toMatch(/h5 clamped to h3/);
  });

  it('falls back to Untitled when nothing supplies a title', async () => {
    const buf = await buildDocx({ 'word/document.xml': documentXml(para(run('just text'))) });
    expect((await ingestDocx(buf)).doc.meta.title).toBe('Untitled');
  });
});
