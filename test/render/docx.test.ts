import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';
import { docxEntries, docxPart } from '../helpers/docx-parts.js';

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

  it('refuses a table with no columns rather than writing an empty grid', async () => {
    // ir/validate.ts rejects this before the CLI could deliver it, so the only
    // way here is hand-built IR — which is exactly the caller that gets no
    // second check. The alternative is a <w:tbl> with an empty <w:tblGrid/>
    // and a row with no cells: structurally a table, visibly nothing.
    await expect(render(doc({ t: 'table', head: [], rows: [], align: [] }))).rejects.toThrow(/no columns/);
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

  it('sizes the page from the theme, not a fixed default', async () => {
    // docx defaults to A4 when no size is given, which would silently mismatch
    // a Letter theme — both shipped themes are A4, so only a Letter theme
    // exercises this.
    const letterTheme = resolveTheme({ id: 'l', page: { size: 'Letter' }, colors: { brandOnLight: '#DA291C' } });
    const xml = await docxPart(
      await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), letterTheme, { epochSeconds: EPOCH }),
      'word/document.xml',
    );
    // 612pt and 792pt in DXA (twentieths of a point): 12240, 15840.
    expect(xml).toContain('<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>');
  });

  it('colours a link with the theme’s ink, not Word’s built-in blue', async () => {
    const xml = await body(doc({ t: 'para', text: [{ t: 'link', href: 'https://example.com', children: [{ t: 'text', v: 'go' }] }] }));
    // theme.colors.ink defaults to #1A1A1A when unset by the test fixture.
    expect(xml).toContain('<w:color w:val="1A1A1A"/>');
    expect(xml).not.toContain('0563C1');
  });
});

// A 2×1 red PNG. Small enough to read in the diff, real enough to embed.
const PNG_2x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC';

// PNG_2x1 with its IHDR width overwritten to 0. Same signature and byte
// length, so it only fails on the field that matters here.
const PNG_ZERO_WIDTH =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAAAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC';

describe('images', () => {
  it('embeds a raster data: URI as a real picture', async () => {
    const buf = await render(doc({ t: 'image', src: PNG_2x1, alt: 'a red bar' }));
    // JSZip's own folder entry ("word/media/", no basename) also starts with
    // this prefix — a document with no image at all still has one for every
    // other folder in the package — so it has to be excluded here or the
    // count of *files* is off by one, and would stay off by one silently.
    expect((await docxEntries(buf)).filter((n) => n.startsWith('word/media/') && !n.endsWith('/'))).toHaveLength(1);
    expect(await docxPart(buf, 'word/document.xml')).toContain('<w:drawing>');
  });

  it('reads the picture’s own dimensions rather than guessing them', async () => {
    const xml = await docxPart(await render(doc({ t: 'image', src: PNG_2x1, alt: 'a' })), 'word/document.xml');
    // 2×1 pixels, so whatever the width, the height is half of it.
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    expect(extent).not.toBeNull();
    expect(Number(extent![2])).toBe(Math.round(Number(extent![1]) / 2));
  });

  it('will not embed an SVG, and says so where the picture would have been', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const xml = await docxPart(await render(doc({ t: 'image', src: svg, alt: 'a diagram' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('a diagram');
    expect(xml).toContain('SVG');
  });

  it('falls back to a placeholder rather than emit a zero-sized or NaN-sized picture', async () => {
    const xml = await docxPart(await render(doc({ t: 'image', src: PNG_ZERO_WIDTH, alt: 'blank' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('blank');
  });

  it('does not fail the whole document over a payload whose mime label lied', async () => {
    // Labelled image/png but the bytes are not a PNG at all — pngSize must
    // report failure rather than throw, or one bad picture takes the
    // document down with it.
    const notReallyPng = `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`;
    const xml = await docxPart(await render(doc({ t: 'image', src: notReallyPng, alt: 'mislabelled' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('mislabelled');
  });

  it('will not embed a JPEG, and says so where the picture would have been', async () => {
    // A deliberate divergence, recorded in the phase-2 residuals: html.ts
    // embeds any raster `data:` URI and a JPEG is one, but this renderer reads
    // natural dimensions from PNG's IHDR only, and a picture needs its aspect
    // ratio even when the block supplies widthPt. Accepting `image/jpeg` and
    // then always falling through to the placeholder is what this used to do;
    // the placeholder is the same, the promise is no longer false.
    const jpeg = `data:image/jpeg;base64,${Buffer.from('\xFF\xD8\xFF\xE0 not really decoded', 'binary').toString('base64')}`;
    const xml = await docxPart(await render(doc({ t: 'image', src: jpeg, alt: 'a photo', widthPt: 200 })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('a photo');
    // Even with widthPt supplied — the branch whose old comment claimed the
    // block could rescue a JPEG by saying how wide it is.
    expect(xml).toContain('data:image/jpeg;');
  });

  it('turns a remote image into a placeholder naming its host', async () => {
    const xml = await docxPart(await render(doc({ t: 'image', src: 'https://cdn.example.com/x.png', alt: 'chart' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('chart');
    expect(xml).toContain('cdn.example.com');
  });

  it('is still byte-identical twice with a picture in it', async () => {
    const d = doc({ t: 'image', src: PNG_2x1, alt: 'a' });
    expect((await render(d)).equals(await render(d))).toBe(true);
  });
});

describe('the letterhead', () => {
  const branded = async () =>
    renderDocx(
      { meta: { title: 'Report', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'x' }] }] },
      await loadTheme('tebin'),
      { epochSeconds: EPOCH },
    );

  it('puts the full letterhead on the first page and the slim one on the rest', async () => {
    const buf = await branded();
    // headers.default becomes header1.xml and headers.first becomes
    // header2.xml — the numbering follows the option order, not the page
    // order, so asserting this the other way round would pass for the wrong
    // reason.
    const first = await docxPart(buf, 'word/header2.xml');
    const running = await docxPart(buf, 'word/header1.xml');
    expect(first).toContain('TEBIN.PRO Sp. z o.o.');
    expect(first).toContain('NIP: 9552562516');
    expect(running).toContain('Report');
    expect(running).not.toContain('NIP');
  });

  it('counts the pages with Word’s own fields', async () => {
    const running = await docxPart(await branded(), 'word/header1.xml');
    expect(running).toContain('PAGE');
    expect(running).toContain('NUMPAGES');
  });

  it('draws the tick in the brand colour and the hairline in the rule colour', async () => {
    const first = await docxPart(await branded(), 'word/header2.xml');
    expect(first).toContain('w:color="DA291C"');
    expect(first).toContain(`w:sz="${8 * 3}"`);
    expect(first).toContain('w:color="CDCDCE"');
  });

  it('places the mark, at the height the theme asks for', async () => {
    const buf = await branded();
    expect(await docxPart(buf, 'word/header2.xml')).toContain('<w:drawing>');
    // 177800 EMU is the tebin theme's logo.heightPt (14pt, see theme.json's
    // $generated.notFromBrand — a human looked at the printed page and asked
    // for a larger mark, 11 -> 14) converted at pt * 4/3 * 9525. Written as a
    // literal, not recomputed from theme.logo.heightPt: deriving it with the
    // same formula the renderer uses would make this test agree with the
    // renderer by construction and stop testing anything. Changing the
    // theme's logo height means recomputing this number on purpose.
    expect(await docxPart(buf, 'word/header2.xml')).toContain('cy="177800"');
  });

  it('prints a document’s own entity and date under the letterhead', async () => {
    const buf = await renderDocx(
      { meta: { title: 'R', lang: 'en', entity: 'TEBIN Limited', date: '2026-08-12' }, blocks: [] },
      await loadTheme('tebin'),
      { epochSeconds: EPOCH },
    );
    const first = await docxPart(buf, 'word/header2.xml');
    expect(first).toContain('TEBIN Limited');
    expect(first).toContain('2026-08-12');
  });

  it('prints a letterhead with no mark when the theme carries only a vector', async () => {
    const vectorOnly = resolveTheme({
      id: 'v', letterhead: ['Someone Ltd'],
      logo: { svg: '<svg><path class="c-brand" d="M0 0"/></svg>', heightPt: 11 },
    });
    const first = await docxPart(
      await renderDocx({ meta: { title: 'R', lang: 'en' }, blocks: [] }, vectorOnly, { epochSeconds: EPOCH }),
      'word/header2.xml',
    );
    expect(first).toContain('Someone Ltd');
    expect(first).not.toContain('<w:drawing>');
  });

  it('refuses to print a letterhead whose theme raster is not a usable PNG', async () => {
    // Labelled as a PNG data URI but the bytes are not PNG at all. In the
    // document body this degrades to a placeholder (see the `images` suite);
    // in the theme's own letterhead it is an authoring error, not untrusted
    // input, so it must fail loudly and name the field.
    const brokenLogo = resolveTheme({
      id: 'broken', letterhead: ['Someone Ltd'],
      logo: { svg: '<svg><path class="c-brand" d="M0 0"/></svg>', heightPt: 11, png: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}` },
    });
    await expect(
      renderDocx({ meta: { title: 'R', lang: 'en' }, blocks: [] }, brokenLogo, { epochSeconds: EPOCH }),
    ).rejects.toThrow(/theme\.logo\.png/);
  });
});
