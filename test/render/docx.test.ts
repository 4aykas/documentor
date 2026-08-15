import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { columnDxa, renderDocx } from '../../src/render/docx.js';
import { mixToWhite, STATEMENT_TINT } from '../../src/render/tint.js';
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

  it('sizes DocTitle from the theme\'s h1Pt, never titlePt — an ordinary document\'s title must not carry the theme\'s cover size', async () => {
    const titled = resolveTheme({ id: 't', type: { h1Pt: 18, titlePt: 46 } });
    const styles = await docxPart(await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), titled, { epochSeconds: EPOCH }), 'word/styles.xml');
    const docTitle = styles.match(/<w:style[^>]*w:styleId="DocTitle"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docTitle).toContain(`w:sz w:val="${18 * 2}"`);
    expect(docTitle).not.toContain(`w:sz w:val="${46 * 2}"`);
  });

  it('sizes DocTitleCover from the theme\'s titlePt, not h1Pt', async () => {
    const titled = resolveTheme({ id: 't', type: { h1Pt: 18, titlePt: 46 } });
    const styles = await docxPart(await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), titled, { epochSeconds: EPOCH }), 'word/styles.xml');
    const docTitleCover = styles.match(/<w:style[^>]*w:styleId="DocTitleCover"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docTitleCover).toContain(`w:sz w:val="${46 * 2}"`);
    const docH1 = styles.match(/<w:style[^>]*w:styleId="DocH1"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docH1).toContain(`w:sz w:val="${18 * 2}"`);
  });

  it('colours DocTitle from ink, never the theme\'s resolved title colour', async () => {
    const grey = resolveTheme({ id: 't', colors: { ink: '#1A1A1A', title: '#898D8D' } });
    const styles = await docxPart(await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), grey, { epochSeconds: EPOCH }), 'word/styles.xml');
    const docTitle = styles.match(/<w:style[^>]*w:styleId="DocTitle"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docTitle).toContain('w:color w:val="1A1A1A"');
    expect(docTitle).not.toContain('w:color w:val="898D8D"');
  });

  it('colours DocTitleCover from the theme\'s resolved title colour', async () => {
    const grey = resolveTheme({ id: 't', colors: { ink: '#1A1A1A', title: '#898D8D' } });
    const styles = await docxPart(await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), grey, { epochSeconds: EPOCH }), 'word/styles.xml');
    const docTitleCover = styles.match(/<w:style[^>]*w:styleId="DocTitleCover"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docTitleCover).toContain('w:color w:val="898D8D"');
  });

  it('defaults the DocTitleCover colour to ink when the theme sets no title colour', async () => {
    const untitled = resolveTheme({ id: 't', colors: { ink: '#2B2B2B' } });
    const styles = await docxPart(await renderDocx(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }), untitled, { epochSeconds: EPOCH }), 'word/styles.xml');
    const docTitleCover = styles.match(/<w:style[^>]*w:styleId="DocTitleCover"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(docTitleCover).toContain('w:color w:val="2B2B2B"');
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

  // The kitchen-sink fixture only ever exercises inline()'s recursion on one
  // shallow case: one bold run, one italic run, and one link, all in a single
  // top-level paragraph. These cases push emphasis into the other places
  // inline() is reached from — a table cell, a heading, a list item — and
  // into nesting one emphasis inside another, which is the recursion itself.
  // See docs/superpowers/notes/2026-08-12-phase-2-residuals.md, "Coverage the
  // DOCX fixtures leave thin".

  it('carries emphasis inside a table cell, header and body both', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'strong', children: [{ t: 'text', v: 'Bold header' }] }]],
      rows: [[[{ t: 'em', children: [{ t: 'text', v: 'Italic cell' }] }]]],
      align: ['l'],
    }));
    // Scope the assertion to the table itself, not the whole body, so this
    // can't pass by accident on emphasis that leaked in from elsewhere.
    const table = xml.match(/<w:tbl>[\s\S]*<\/w:tbl>/)?.[0];
    expect(table, 'expected a <w:tbl> in the body').toBeDefined();
    expect(table).toContain('<w:b/>');
    expect(table).toContain('<w:i/>');
    expect(table).toContain('Bold header');
    expect(table).toContain('Italic cell');
  });

  it('carries emphasis inside a heading', async () => {
    const xml = await body(doc({
      t: 'heading',
      level: 2,
      text: [
        { t: 'strong', children: [{ t: 'text', v: 'Bold' }] },
        { t: 'text', v: ' and ' },
        { t: 'em', children: [{ t: 'text', v: 'italic' }] },
      ],
    }));
    expect(xml).toContain('DocH2');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('carries emphasis inside a list item, including a nested one', async () => {
    // A nested list arrives as two `list` blocks, one per depth — see the
    // comment on the IR's `start` field and on docx.ts's `listNumbering()`/
    // `blocks()` `case 'list'` for why: the ingester splits an ordered list
    // at every nesting change, and each fragment keeps only its own depth.
    const buf = await render(doc(
      { t: 'list', ordered: false, depth: 0, items: [[{ t: 'strong', children: [{ t: 'text', v: 'top' }] }]] },
      { t: 'list', ordered: false, depth: 1, items: [[{ t: 'em', children: [{ t: 'text', v: 'nested' }] }]] },
    ));
    const xml = await docxPart(buf, 'word/document.xml');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    // Each list item is now real Word numbering, not a written marker: a
    // <w:numPr> naming its fragment's own numId, then the text run — no run
    // carries the bullet character any more. The nested item's own indent
    // (proving it's the depth-1 fragment, not a coincidence of two separate
    // blocks) lives in numbering.xml, on the level the paragraph's numId
    // points at.
    const topNumId = xml.match(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr><w:r><w:rPr><w:b\/>/)?.[1];
    const nestedNumId = xml.match(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr><w:r><w:rPr><w:i\/>/)?.[1];
    expect(topNumId, 'expected the top-level item to carry a numId').toBeDefined();
    expect(nestedNumId, 'expected the nested item to carry its own, distinct numId').toBeDefined();
    expect(nestedNumId).not.toBe(topNumId);

    const numbering = await docxPart(buf, 'word/numbering.xml');
    const leftOf = (numId: string): number => {
      const abstractId = numbering.match(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"`))?.[1];
      const left = numbering.match(new RegExp(`<w:abstractNum w:abstractNumId="${abstractId}"[\\s\\S]*?<w:ind w:left="(\\d+)"`))?.[1];
      expect(left, `expected abstractNum ${abstractId} (numId ${numId}) to carry a left indent`).toBeDefined();
      return Number(left);
    };
    expect(leftOf(nestedNumId!)).toBeGreaterThan(leftOf(topNumId!));
  });

  // A single run carries every rPr child inside one <w:rPr>...</w:rPr>
  // element, in whatever order docx emits them — this doesn't assume an
  // order, only that both properties land on the same run.
  const rPrHasBoth = (xml: string): boolean =>
    [...xml.matchAll(/<w:rPr>[\s\S]*?<\/w:rPr>/g)].some((m) => m[0].includes('<w:b/>') && m[0].includes('<w:i/>'));

  it('nests bold inside italic onto a single run carrying both', async () => {
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'em', children: [{ t: 'strong', children: [{ t: 'text', v: 'both' }] }] }],
    }));
    expect(rPrHasBoth(xml)).toBe(true);
  });

  it('nests italic inside bold onto a single run carrying both', async () => {
    // inline()'s fmt is merged by key, not by nesting order, so this is
    // expected to produce the same run properties as the italic-inside-bold
    // case above — recorded as its own case anyway because the residuals
    // note named both orderings as unexercised, and "the merge doesn't care
    // about order" is exactly the kind of claim that deserves its own test
    // rather than an inference from the other one.
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'strong', children: [{ t: 'em', children: [{ t: 'text', v: 'both' }] }] }],
    }));
    expect(rPrHasBoth(xml)).toBe(true);
  });

  it('gives a document with several links a distinct relationship id per link', async () => {
    const hrefs = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
    const buf = await render(doc(...hrefs.map((href, i): Doc['blocks'][number] => ({
      t: 'para',
      text: [{ t: 'link', href, children: [{ t: 'text', v: `link ${i}` }] }],
    }))));
    const xml = await docxPart(buf, 'word/document.xml');
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    // docx puts w:history before r:id on this element, so the attribute
    // order can't be assumed — [^>]* skips whatever comes first.
    const usedIds = [...xml.matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/g)].map((m) => m[1]!);
    expect(usedIds, 'expected one <w:hyperlink> per link, not one shared between them').toHaveLength(hrefs.length);
    expect(new Set(usedIds).size, 'expected a distinct r:id per link').toBe(hrefs.length);
    const relTarget = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
    for (const [i, id] of usedIds.entries()) {
      expect(relTarget.get(id)).toBe(hrefs[i]);
    }
  });

  it('carries emphasis inside a link, rather than flattening it away', async () => {
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'link', href: 'https://example.com/bold', children: [{ t: 'strong', children: [{ t: 'text', v: 'bold link' }] }] }],
    }));
    const hyperlink = xml.match(/<w:hyperlink[\s\S]*?<\/w:hyperlink>/)?.[0];
    expect(hyperlink, 'expected a <w:hyperlink> in the body').toBeDefined();
    expect(hyperlink).toContain('bold link');
    expect(hyperlink).toContain('<w:b/>');
  });

  it('splits a part-emphasised link into runs, and keeps every one a link', async () => {
    // The case flattening could never express: half the link's text is bold
    // and half is not, so one run cannot carry it. Every run still has to be
    // inside the one <w:hyperlink> and still has to look like a link, or the
    // reader gets a document where half the words are underlined.
    const xml = await body(doc({
      t: 'para',
      text: [{
        t: 'link',
        href: 'https://example.com/mixed',
        children: [{ t: 'strong', children: [{ t: 'text', v: 'read ' }] }, { t: 'text', v: 'the report' }],
      }],
    }));
    const hyperlink = xml.match(/<w:hyperlink[\s\S]*?<\/w:hyperlink>/)?.[0];
    expect(hyperlink).toBeDefined();
    expect(hyperlink!.match(/<w:r>/g) ?? []).toHaveLength(2);
    expect(hyperlink!.match(/<w:rStyle w:val="Hyperlink"\/>/g) ?? []).toHaveLength(2);
    expect(hyperlink!.match(/<w:b\/>/g) ?? []).toHaveLength(1);
  });

  it('keeps a link with nothing but italic text underlined', async () => {
    // The whole link is emphasised, so the emphasis and the link style land on
    // the same single run — the shape most likely to lose one of the two.
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'link', href: 'https://example.com/i', children: [{ t: 'em', children: [{ t: 'text', v: 'go' }] }] }],
    }));
    const hyperlink = xml.match(/<w:hyperlink[\s\S]*?<\/w:hyperlink>/)?.[0];
    expect(hyperlink).toContain('<w:i/>');
    expect(hyperlink).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(hyperlink).toContain('<w:color w:val="1A1A1A"/>');
  });

  it('numbers an ordered list from the IR’s own start', async () => {
    // The number a reader checks at item 4 has to survive as Word's own
    // numbering, not as a written run: this asserts the startOverride in
    // numbering.xml, not text in the body, so it fails if a future change
    // goes back to writing "4. " as a string.
    const buf = await render(doc({ t: 'list', ordered: true, depth: 0, start: 4, items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }));
    const xml = await docxPart(buf, 'word/document.xml');
    const numId = xml.match(/<w:numId w:val="(\d+)"\/>/)?.[1];
    expect(numId, 'expected the list items to carry a numId').toBeDefined();
    // Both items share the one numId — one fragment, one numbering instance —
    // Word supplies 4 and 5 itself from a single startOverride, not two.
    expect([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1])).toEqual([numId, numId]);
    const numbering = await docxPart(buf, 'word/numbering.xml');
    const abstractId = numbering.match(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"`))?.[1];
    expect(numbering).toContain(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num>`);
    expect(numbering).toContain(`<w:abstractNum w:abstractNumId="${abstractId}"`);
    expect(numbering).toMatch(new RegExp(`<w:abstractNum w:abstractNumId="${abstractId}"[\\s\\S]*?<w:numFmt w:val="decimal"/>`));
  });

  it('indents a nested list by its depth', async () => {
    const buf = await render(doc({ t: 'list', ordered: false, depth: 2, items: [[{ t: 'text', v: 'deep' }]] }));
    const numbering = await docxPart(buf, 'word/numbering.xml');
    expect(numbering).toMatch(/<w:ind w:left="\d+"/);
  });

  // Real Word numbering, not a written marker — see listNumbering() in
  // docx.ts. One numId per `list` block (fragment); a fragment's start lives
  // in its own numId's <w:lvlOverride><w:startOverride>, which is the only
  // lever docx@9.7.1's public numbering API exposes for "don't restart at 1
  // here." These cases are the numbers-are-the-whole-point proof the phase's
  // residuals note called for: each asserts the startOverride value and the
  // level a paragraph sits at, not merely that a numbering reference exists.
  describe('real Word numbering, not written text', () => {
    /** Every list paragraph's (ilvl, numId), in document order. */
    const numPrs = (xml: string): { ilvl: string; numId: string }[] =>
      [...xml.matchAll(/<w:numPr><w:ilvl w:val="(\d+)"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g)]
        .map((m) => ({ ilvl: m[1]!, numId: m[2]! }));

    /** A numId's startOverride, or undefined if that numId isn't in numbering.xml at all. */
    const startOverride = (numbering: string, numId: string): string | undefined =>
      numbering.match(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="\\d+"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="(\\d+)"/>`))?.[1];

    /** The numFmt ("decimal" or "bullet") of the abstractNum a numId points at. */
    const numFmt = (numbering: string, numId: string): string | undefined => {
      const abstractId = numbering.match(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"`))?.[1];
      if (abstractId === undefined) return undefined;
      return numbering.match(new RegExp(`<w:abstractNum w:abstractNumId="${abstractId}"[\\s\\S]*?<w:numFmt w:val="(\\w+)"`))?.[1];
    };

    /** The left indent of the abstractNum a numId points at. */
    const leftIndent = (numbering: string, numId: string): number => {
      const abstractId = numbering.match(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"`))?.[1];
      const left = numbering.match(new RegExp(`<w:abstractNum w:abstractNumId="${abstractId}"[\\s\\S]*?<w:ind w:left="(\\d+)"`))?.[1];
      expect(left, `expected abstractNum ${abstractId} (numId ${numId}) to carry a left indent`).toBeDefined();
      return Number(left);
    };

    it('gives a nested ordered list its own numId that does not restart the outer list', async () => {
      // A nested list splits its ordered parent into three fragments — see
      // the IR's `start` comment. The ingester computes the outer fragment's
      // resumed `start` (3, after two outer items); this only proves the
      // renderer carries that number through, not that the ingester's own
      // arithmetic is exercised here.
      const buf = await render(doc(
        { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'outer 1' }], [{ t: 'text', v: 'outer 2' }]] },
        { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'inner 1' }]] },
        { t: 'list', ordered: true, depth: 0, start: 3, items: [[{ t: 'text', v: 'outer 3' }]] },
      ));
      const xml = await docxPart(buf, 'word/document.xml');
      const numbering = await docxPart(buf, 'word/numbering.xml');
      const [outerA1, outerA2, inner1, outerB1] = numPrs(xml);
      expect(outerA1!.numId).toBe(outerA2!.numId); // one fragment, one numId
      expect(inner1!.numId).not.toBe(outerA1!.numId);
      expect(outerB1!.numId).not.toBe(outerA1!.numId); // resumed fragment: its own numId
      expect(outerB1!.numId).not.toBe(inner1!.numId);
      expect(startOverride(numbering, outerA1!.numId)).toBe('1');
      expect(startOverride(numbering, inner1!.numId)).toBe('1');
      // The number that matters: the outer list resumes at 3, not 1.
      expect(startOverride(numbering, outerB1!.numId)).toBe('3');
    });

    it('gives two unrelated ordered lists in one document each their own start', async () => {
      const buf = await render(doc(
        { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] },
        { t: 'para', text: [{ t: 'text', v: 'between the two lists' }] },
        { t: 'list', ordered: true, depth: 0, start: 10, items: [[{ t: 'text', v: 'x' }], [{ t: 'text', v: 'y' }]] },
      ));
      const xml = await docxPart(buf, 'word/document.xml');
      const numbering = await docxPart(buf, 'word/numbering.xml');
      const [first, , third] = numPrs(xml);
      expect(first!.numId).not.toBe(third!.numId);
      expect(startOverride(numbering, first!.numId)).toBe('1');
      expect(startOverride(numbering, third!.numId)).toBe('10');
    });

    it('indents an unordered list and its nested unordered list at the right levels', async () => {
      const buf = await render(doc(
        { t: 'list', ordered: false, depth: 0, items: [[{ t: 'text', v: 'top' }]] },
        { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'nested' }]] },
      ));
      const xml = await docxPart(buf, 'word/document.xml');
      const numbering = await docxPart(buf, 'word/numbering.xml');
      const [top, nested] = numPrs(xml);
      expect(numFmt(numbering, top!.numId)).toBe('bullet');
      expect(numFmt(numbering, nested!.numId)).toBe('bullet');
      expect(leftIndent(numbering, nested!.numId)).toBeGreaterThan(leftIndent(numbering, top!.numId));
    });

    it('nests an ordered list inside an unordered one, each keeping its own format', async () => {
      const buf = await render(doc(
        { t: 'list', ordered: false, depth: 0, items: [[{ t: 'text', v: 'bullet' }]] },
        { t: 'list', ordered: true, depth: 1, start: 1, items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
      ));
      const xml = await docxPart(buf, 'word/document.xml');
      const numbering = await docxPart(buf, 'word/numbering.xml');
      const [outer, inner1, inner2] = numPrs(xml);
      expect(numFmt(numbering, outer!.numId)).toBe('bullet');
      expect(numFmt(numbering, inner1!.numId)).toBe('decimal');
      expect(inner1!.numId).toBe(inner2!.numId);
      expect(startOverride(numbering, inner1!.numId)).toBe('1');
      expect(leftIndent(numbering, inner1!.numId)).toBeGreaterThan(leftIndent(numbering, outer!.numId));
    });

    it('nests an unordered list inside an ordered one, each keeping its own format', async () => {
      const buf = await render(doc(
        { t: 'list', ordered: true, depth: 0, start: 5, items: [[{ t: 'text', v: 'one' }]] },
        { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'sub a' }], [{ t: 'text', v: 'sub b' }]] },
      ));
      const xml = await docxPart(buf, 'word/document.xml');
      const numbering = await docxPart(buf, 'word/numbering.xml');
      const [outer, inner1, inner2] = numPrs(xml);
      expect(numFmt(numbering, outer!.numId)).toBe('decimal');
      expect(startOverride(numbering, outer!.numId)).toBe('5');
      expect(numFmt(numbering, inner1!.numId)).toBe('bullet');
      expect(inner1!.numId).toBe(inner2!.numId);
      expect(leftIndent(numbering, inner1!.numId)).toBeGreaterThan(leftIndent(numbering, outer!.numId));
    });
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

  it('gives table cells the same internal margins html.ts paints', async () => {
    // html.ts: `th,td{ padding: 4pt 6pt }`. Word's own cell-margin default is
    // not this — left/right happen to be close, but top/bottom default to 0 —
    // so it has to be set explicitly, in DXA (twentieths of a point):
    // 4pt = 80, 6pt = 120.
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }]],
      rows: [[[{ t: 'text', v: 'Widget' }]]],
      align: ['l'],
    }));
    const margins = [...xml.matchAll(/<w:tcMar><w:top w:type="dxa" w:w="(\d+)"\/><w:left w:type="dxa" w:w="(\d+)"\/><w:bottom w:type="dxa" w:w="(\d+)"\/><w:right w:type="dxa" w:w="(\d+)"\/><\/w:tcMar>/g)];
    expect(margins, 'expected one <w:tcMar> per cell (header + one row)').toHaveLength(2);
    for (const m of margins) {
      expect(m.slice(1)).toEqual(['80', '120', '80', '120']);
    }
  });

  const gridWidths = (xml: string): number[] =>
    [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));

  it('gives columns unequal widths when their content plainly differs', async () => {
    // A narrow "#" column beside a column carrying full sentences — the
    // shape that motivated content-proportional widths in the first place.
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: '#' }], [{ t: 'text', v: 'Description' }]],
      rows: [
        [[{ t: 'text', v: '1' }], [{ t: 'text', v: 'A short sentence describing the first item in some detail.' }]],
        [[{ t: 'text', v: '2' }], [{ t: 'text', v: 'A second, similarly long sentence describing another item.' }]],
        [[{ t: 'text', v: '3' }], [{ t: 'text', v: 'A third sentence, also long, rounding out the table nicely.' }]],
      ],
      align: ['l', 'l'],
    }));
    const [narrow, wide] = gridWidths(xml);
    expect(narrow).toBeDefined();
    expect(wide).toBeDefined();
    expect(wide!).toBeGreaterThan(narrow!);
  });

  it('gives columns equal widths when the content genuinely is', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Aaa' }], [{ t: 'text', v: 'Bbb' }], [{ t: 'text', v: 'Ccc' }]],
      rows: [
        [[{ t: 'text', v: 'ddd' }], [{ t: 'text', v: 'eee' }], [{ t: 'text', v: 'fff' }]],
        [[{ t: 'text', v: 'ggg' }], [{ t: 'text', v: 'hhh' }], [{ t: 'text', v: 'iii' }]],
      ],
      align: ['l', 'l', 'l'],
    }));
    const widths = gridWidths(xml);
    expect(widths).toHaveLength(3);
    // Not necessarily bit-for-bit identical: the text column doesn't always
    // divide evenly, and the largest-remainder rounding that keeps the sum
    // exact can leave columns a single DXA (1/20pt) apart. "Equal" here means
    // no column visibly differs from another, not floating-point equality.
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  it('sums column widths to exactly the text column, for a table with one column', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Solo' }]],
      rows: [[[{ t: 'text', v: 'A single value' }]]],
      align: ['l'],
    }));
    const widths = gridWidths(xml);
    expect(widths).toHaveLength(1);
    expect(widths[0]).toBe(columnDxa(theme));
  });

  it('sums column widths to exactly the text column, for a table with zero data rows', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Quantity in stock' }]],
      rows: [],
      align: ['l', 'l'],
    }));
    const widths = gridWidths(xml);
    expect(widths).toHaveLength(2);
    expect(widths.reduce((a, w) => a + w, 0)).toBe(columnDxa(theme));
  });

  it('sums column widths to exactly the text column when one column is entirely empty', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: '' }], [{ t: 'text', v: 'Notes, a fairly long column of prose' }]],
      rows: [
        [[{ t: 'text', v: 'Widget' }], [], [{ t: 'text', v: 'Some notes about the widget go here.' }]],
        [[{ t: 'text', v: 'Gadget' }], [], [{ t: 'text', v: 'And some notes about the gadget too.' }]],
      ],
      align: ['l', 'l', 'l'],
    }));
    const widths = gridWidths(xml);
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, w) => a + w, 0)).toBe(columnDxa(theme));
    // The empty column still gets at least the floor, not zero.
    expect(widths[1]!).toBeGreaterThan(0);
  });

  it('sums column widths to exactly the text column for a table wider than the page', async () => {
    const cols = 40;
    const xml = await body(doc({
      t: 'table',
      head: Array.from({ length: cols }, (_, i) => [{ t: 'text' as const, v: `H${i}` }]),
      rows: [Array.from({ length: cols }, (_, i) => [{ t: 'text' as const, v: `v${i}` }])],
      align: Array.from({ length: cols }, () => 'l' as const),
    }));
    const widths = gridWidths(xml);
    expect(widths).toHaveLength(cols);
    expect(widths.reduce((a, w) => a + w, 0)).toBe(columnDxa(theme));
    expect(widths.every((w) => w > 0)).toBe(true);
  });

  it('produces identical table widths on two runs', async () => {
    const d = doc({
      t: 'table',
      head: [[{ t: 'text', v: '#' }], [{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Description' }]],
      rows: [
        [[{ t: 'text', v: '1' }], [{ t: 'text', v: 'Widget' }], [{ t: 'text', v: 'A moderately long descriptive sentence.' }]],
      ],
      align: ['l', 'l', 'l'],
    });
    expect(gridWidths(await body(d))).toEqual(gridWidths(await body(d)));
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

  // Three rules html.ts states, with its reasoning written down, that docx.ts
  // transcribed the spacing of but not the rest of. docx.ts already cites
  // `// html.ts: …` beside every spacing constant, so the convention was
  // established — it simply had not been applied to these.

  it('keeps a horizontal rule with the content it introduces', async () => {
    // html.ts: `hr{ … break-after: avoid; }`. The rule paragraph is the only
    // one in the file with no style of its own, which is how it escaped: the
    // headings get keepNext from their styles, and this gets it here.
    const xml = await body(doc({ t: 'rule' }, { t: 'para', text: [{ t: 'text', v: 'after' }] }));
    expect(xml).toContain('<w:keepNext/>');
  });

  it('does not let a table row split across a page break', async () => {
    // html.ts: `tr{ break-inside: avoid; }`. Both the header row and the body
    // rows — a header row that splits is as unreadable as any other.
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }]],
      rows: [[[{ t: 'text', v: 'Widget' }]]],
      align: ['l'],
    }));
    expect(xml.match(/<w:cantSplit\/>/g)).toHaveLength(2);
  });

  it('leaves exactly 12pt after a table, not the ~24pt an empty paragraph would default to', async () => {
    // html.ts: `table{ margin: 0 0 12pt }`. Invisible in the kitchen-sink
    // fixture because a rule with its own spacing follows the table there;
    // visible immediately with a paragraph right after, which is what a real
    // document had. A table itself has no spacing to give it, so docx.ts
    // inserts a spacer paragraph after every table — but a *default* empty
    // paragraph is not a 12pt gap, it is close to 24pt, because it still
    // occupies a full line at the document's own body size before
    // `spacing.after` is even added (measured over COM: ~23.6pt without the
    // fix below, ~12.1pt with it). So the assertion pins all three emitted
    // values that make the total 12pt rather than ~24pt: the line pinned to
    // a near-zero height with `w:lineRule="exact"` (dropping either the line
    // value or the exact rule lets the line grow back to automatic), the
    // shortened `w:after`, and the run size that keeps the paragraph mark's
    // own properties explicit. Losing any one of the three would pass a test
    // that only checked for *a* `<w:spacing>` element, which is exactly the
    // gap between the html.ts citation and the actual gap that this test
    // exists to catch.
    const xml = await body(doc(
      { t: 'table', head: [[{ t: 'text', v: 'Item' }]], rows: [[[{ t: 'text', v: 'Widget' }]]], align: ['l'] },
      { t: 'para', text: [{ t: 'text', v: 'after' }] },
    ));
    expect(xml).toMatch(
      /<\/w:tbl><w:p><w:pPr><w:spacing w:after="200" w:line="40" w:lineRule="exact"\/><\/w:pPr><w:r><w:rPr><w:sz w:val="4"\/><w:szCs w:val="4"\/><\/w:rPr><w:t xml:space="preserve"><\/w:t><\/w:r><\/w:p>/,
    );
  });

  it('sets inline code smaller than the prose around it, as the stylesheet does', async () => {
    // html.ts: `code{ font-size: 0.92 × bodyPt; }`. Changing the font without
    // the size is what made a monospaced word read as larger than its
    // neighbours. 18 half-points is 9.2pt: the test theme's 10pt body times
    // 0.92, written as a literal rather than recomputed with the renderer's own
    // formula — deriving it the same way would make this agree by construction
    // and stop testing anything, the same argument the letterhead's logo height
    // makes below.
    const xml = await body(doc({ t: 'para', text: [
      { t: 'text', v: 'prose ' },
      { t: 'code', children: [{ t: 'text', v: 'ident' }] },
    ] }));
    expect(theme.type.bodyPt, 'the literal below assumes a 10pt body').toBe(10);
    expect(xml).toMatch(/<w:rFonts w:ascii="Consolas"[^>]*\/><w:sz w:val="18"\/>/);
  });

  describe('a code block', () => {
    // html.ts: `pre{ padding: 8pt 10pt; }`, on a block Word paginates as one
    // paragraph per line (see the comment in docx.ts's `blocks()`). 10pt is
    // 200 DXA, and it has to repeat on every line — indent is per-paragraph,
    // there is no single "block" node to hang it on once.
    it('indents every line of the block by the horizontal padding', async () => {
      const xml = await body(doc({ t: 'code', text: 'one\ntwo\nthree' }));
      const indents = [...xml.matchAll(/<w:ind w:left="(\d+)" w:right="(\d+)"\/>/g)];
      expect(indents, 'expected one indent per code line').toHaveLength(3);
      for (const m of indents) expect(m.slice(1)).toEqual(['200', '200']);
    });

    it('puts the vertical padding on the first and last line only, not every line', async () => {
      // This is the assertion that would pass even if the vertical padding
      // were wrongly applied per-line: a naive `toContain('w:before="160"')`
      // stays true whether one paragraph carries it or three do. Counting the
      // non-zero spacing paragraphs is what tells them apart.
      const xml = await body(doc({ t: 'code', text: 'one\ntwo\nthree' }));
      const spacings = [...xml.matchAll(/<w:spacing w:after="(\d+)" w:before="(\d+)" w:line="240"\/>/g)]
        .map((m) => ({ after: Number(m[1]), before: Number(m[2]) }));
      expect(spacings).toHaveLength(3);
      // First line: html.ts's 8pt top padding (160 DXA), no bottom spacing.
      expect(spacings[0]).toEqual({ before: 160, after: 0 });
      // Middle line: neither — a middle line carrying either would mean the
      // padding leaked into the run instead of staying at the block's ends.
      expect(spacings[1]).toEqual({ before: 0, after: 0 });
      // Last line: html.ts's 8pt bottom padding, plus the same gap a
      // paragraph leaves after itself (DocBody's `after`, 0.7 × the test
      // theme's 10pt body = 7pt) so the block does not sit tighter to what
      // follows than prose does. (8 + 7)pt = 300 DXA.
      expect(theme.type.bodyPt, 'the literal above assumes a 10pt body').toBe(10);
      expect(spacings[2]).toEqual({ before: 0, after: 300 });
    });

    it('leaves no vertical padding at all on a single-line block’s spacing before', async () => {
      // A one-line block is its own first and last paragraph at once: before
      // carries the top padding, after carries the bottom padding plus the
      // trailing gap, and there is no line in between to leak into.
      const xml = await body(doc({ t: 'code', text: 'solo' }));
      expect(xml).toContain('<w:spacing w:after="300" w:before="160" w:line="240"/>');
    });
  });

  it('does not ask Word to update fields on open', async () => {
    // Measured over COM (2026-08-12): Word resolves PAGE/NUMPAGES in the
    // running header on pagination regardless of this setting, so
    // `<w:updateFields/>` buys nothing — it only costs every recipient the
    // "update fields?" prompt on open. Pinned here so the flag cannot come
    // back silently; see the comment beside `features` in docx.ts for the
    // measurement this asserts.
    const settings = await docxPart(await render(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] })), 'word/settings.xml');
    expect(settings).not.toContain('<w:updateFields');
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

  /**
   * A JPEG built marker by marker, so each test says exactly which shape it is
   * exercising. `lead` goes between the start-of-image and the frame — that is
   * where a real file keeps its EXIF, its thumbnail and its colour profile, and
   * where a size reader that trusts a fixed offset goes wrong.
   */
  const jpegBytes = (sofMarker: number, w: number, h: number, lead: number[] = []): Buffer => {
    const frame = [0xff, sofMarker, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    return Buffer.from([0xff, 0xd8, ...lead, ...frame, 0xff, 0xd9]);
  };
  const asJpeg = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;
  const APP0 = [0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]; // A JFIF header, four bytes of payload.

  it('embeds a baseline JPEG at its own aspect ratio', async () => {
    // 200pt wide and twice as tall as it is wide: the height can only come
    // from the frame header, so a wrong reader shows up as a wrong height
    // rather than as a missing picture.
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asJpeg(jpegBytes(0xc0, 50, 100)), alt: 'a photo', widthPt: 200 })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
    expect(xml).not.toContain('a photo'); // The alt text is the placeholder's, and there is no placeholder.
    // 200pt wide → 400pt tall → px at 96dpi → EMU.
    expect(xml).toContain(`cx="${Math.round((200 * 4) / 3 * 9525)}"`);
    expect(xml).toContain(`cy="${Math.round((400 * 4) / 3 * 9525)}"`);
  });

  it('embeds a progressive JPEG, which is what most cameras write', async () => {
    // 0xC2, not 0xC0. A reader accepting only the baseline marker would send
    // the common case to the placeholder and look correct in every test using
    // a hand-made baseline fixture.
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asJpeg(jpegBytes(0xc2, 40, 20)), alt: 'p' })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
  });

  it('walks past the segments a real JPEG carries before its frame', async () => {
    // A JFIF header, then a restart marker that carries no length at all —
    // reading a length after that one walks into the middle of the next
    // segment and the frame is never found.
    const lead = [...APP0, 0xff, 0xd0];
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asJpeg(jpegBytes(0xc0, 30, 30, lead)), alt: 'x' })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
  });

  it('does not mistake a Huffman table for a frame', async () => {
    // 0xC4 sits inside the 0xC0-0xCF range but is a table, not a frame. Read
    // as one, its payload yields a nonsense size instead of the real picture's.
    const lead = [0xff, 0xc4, 0x00, 0x06, 0x00, 0x01, 0x02, 0x03];
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asJpeg(jpegBytes(0xc0, 60, 30, lead)), alt: 'x' })),
      'word/document.xml',
    );
    expect(xml).toContain(`cx="${Math.round((45 * 4) / 3 * 9525)}"`); // 60px → 45pt, from the real frame.
  });

  it('falls back to a placeholder for a JPEG whose frame never arrives', async () => {
    // Start-of-image and a scan, no frame — truncated or corrupt. One bad
    // picture degrades to a placeholder rather than taking the document down.
    const headerOnly = Buffer.from([0xff, 0xd8, ...APP0, 0xff, 0xda, 0x00, 0x02]);
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asJpeg(headerOnly), alt: 'a photo', widthPt: 200 })),
      'word/document.xml',
    );
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('a photo');
  });

  it('reads the bytes, not the label, when the two disagree', async () => {
    // Declared PNG, actually a JPEG. The declared type only decides whether to
    // try; handing these bytes to the PNG reader would produce a placeholder
    // for a picture this renderer can carry perfectly well.
    const mislabelled = `data:image/png;base64,${jpegBytes(0xc0, 10, 10).toString('base64')}`;
    const xml = await docxPart(
      await render(doc({ t: 'image', src: mislabelled, alt: 'x' })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
  });

  /**
   * A GIF header: the signature, then the logical screen width and height as
   * little-endian 16-bit integers. `version` is a parameter because both 87a
   * and 89a are in the wild and a reader accepting only one refuses half of
   * them for no reason a reader could explain.
   */
  const gifBytes = (w: number, h: number, version = '89a'): Buffer =>
    Buffer.concat([
      Buffer.from(`GIF${version}`, 'ascii'),
      Buffer.from([w & 0xff, w >> 8, h & 0xff, h >> 8, 0x00, 0x00, 0x00]),
    ]);
  const asGif = (b: Buffer): string => `data:image/gif;base64,${b.toString('base64')}`;

  it('embeds a GIF at its own aspect ratio', async () => {
    // Not hypothetical: ingest/docx.ts reads GIF out of a source .docx and
    // hands it on as a data: URI, so a .docx → .docx round trip turned a
    // picture Word had carried perfectly well into a placeholder.
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asGif(gifBytes(50, 100)), alt: 'an animation', widthPt: 200 })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
    expect(xml).not.toContain('an animation');
    expect(xml).toContain(`cy="${Math.round(((400 * 4) / 3) * 9525)}"`); // Twice as tall as wide.
  });

  it('embeds the older GIF version too', async () => {
    expect(
      await docxPart(await render(doc({ t: 'image', src: asGif(gifBytes(10, 10, '87a')), alt: 'x' })), 'word/document.xml'),
    ).toContain('<w:drawing>');
  });

  it('falls back to a placeholder for a GIF with nothing but a signature', async () => {
    const truncated = `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`;
    const xml = await docxPart(await render(doc({ t: 'image', src: truncated, alt: 'an animation' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('an animation');
  });

  /**
   * A BMP: the file header, then a BITMAPINFOHEADER whose width and height are
   * signed 32-bit. `height` is signed on purpose — a negative one means the
   * rows are stored top-down, which says nothing about how tall the picture is,
   * and a reader that forgets the sign scales it to a negative height.
   */
  const bmpBytes = (w: number, h: number): Buffer => {
    const buf = Buffer.alloc(54);
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(54, 2); // File size, near enough for a header-only fixture.
    buf.writeUInt32LE(54, 10); // Pixel data offset.
    buf.writeUInt32LE(40, 14); // BITMAPINFOHEADER.
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    return buf;
  };
  const asBmp = (b: Buffer): string => `data:image/bmp;base64,${b.toString('base64')}`;

  it('embeds a BMP, which ingest/docx.ts also produces', async () => {
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asBmp(bmpBytes(50, 100)), alt: 'a scan', widthPt: 200 })),
      'word/document.xml',
    );
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain(`cy="${Math.round(((400 * 4) / 3) * 9525)}"`);
  });

  it('reads a top-down BMP as tall as it really is', async () => {
    // Negative height, same picture. Taken at face value it scales to a
    // negative height, which Word writes out as a picture nobody can see.
    const xml = await docxPart(
      await render(doc({ t: 'image', src: asBmp(bmpBytes(50, -100)), alt: 'a scan', widthPt: 200 })),
      'word/document.xml',
    );
    expect(xml).toContain(`cy="${Math.round(((400 * 4) / 3) * 9525)}"`);
  });

  it('refuses a WebP, because the library cannot label one', async () => {
    // The last format html.ts embeds and this renderer does not, and the
    // reason is not a missing size reader: `docx`'s ImageRun takes
    // jpg | png | gif | bmp and has no content type for WebP, so there is
    // nothing to write into [Content_Types].xml for it. Adding a reader for
    // its VP8 chunk would produce a size and still no way to carry the bytes.
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'), Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 ', 'ascii'),
    ]);
    const xml = await docxPart(
      await render(doc({ t: 'image', src: `data:image/webp;base64,${webp.toString('base64')}`, alt: 'a photo' })),
      'word/document.xml',
    );
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('a photo');
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

describe('meta.cover', () => {
  const withEntity = (cover?: boolean): Doc => ({
    meta: { title: 'Cover Title', subtitle: 'A cover subtitle', lang: 'en', entity: 'Acme Sp. z o.o.', date: '2026-08-12', ...(cover === undefined ? {} : { cover }) },
    blocks: [{ t: 'para', text: [{ t: 'text', v: 'x' }] }],
  });
  const render2 = async (cover?: boolean) =>
    docxPart(await renderDocx(withEntity(cover), await loadTheme('tebin'), { epochSeconds: EPOCH }), 'word/header2.xml');
  const bodyOf = async (cover?: boolean) =>
    docxPart(await renderDocx(withEntity(cover), await loadTheme('tebin'), { epochSeconds: EPOCH }), 'word/document.xml');

  it('is drawn — mark, letterhead lines, entity/date lines, tick rule, and an ordinary DocTitle — when meta omits the flag', async () => {
    // Provably the existing behaviour, unchanged. This is the regression
    // this whole feature exists to undo, so it is asserted directly rather
    // than relying on a baseline image alone.
    const first = await render2(undefined);
    expect(first).toContain('TEBIN.PRO Sp. z o.o.');
    expect(first).toContain('NIP: 9552562516');
    expect(first).toContain('Acme Sp. z o.o.');
    expect(first).toContain('2026-08-12');
    expect(first).toContain('<w:drawing>');
    const body1 = await bodyOf(undefined);
    expect(body1).toContain('Cover Title');
    expect(body1).toContain('w:val="DocTitle"');
    expect(body1).not.toContain('w:val="DocTitleCover"');
  });

  it('is drawn the same way when meta.cover is explicitly false', async () => {
    const explicit = await render2(false);
    const absentFlag = await render2(undefined);
    expect(explicit).toBe(absentFlag);
    expect(await bodyOf(false)).toBe(await bodyOf(undefined));
  });

  it('suppresses the mark, letterhead lines, entity/date lines and tick rule when true, keeps the title and subtitle in the body, and switches the title to DocTitleCover', async () => {
    const first = await render2(true);
    expect(first).not.toContain('TEBIN.PRO Sp. z o.o.');
    expect(first).not.toContain('NIP: 9552562516');
    expect(first).not.toContain('Acme Sp. z o.o.');
    expect(first).not.toContain('2026-08-12');
    expect(first).not.toContain('<w:drawing>');
    const body2 = await bodyOf(true);
    expect(body2).toContain('Cover Title');
    expect(body2).toContain('A cover subtitle');
    expect(body2).toContain('w:val="DocTitleCover"');
    // Not the ordinary DocTitle — DocTitleCover contains "DocTitle" as a
    // substring, so a plain toContain check would pass either way.
    expect(/w:val="DocTitle"(?!Cover)/.test(body2)).toBe(false);
  });

  it('leaves the running header (pages 2+, word/header1.xml) alone either way', async () => {
    const buf = await renderDocx(withEntity(true), await loadTheme('tebin'), { epochSeconds: EPOCH });
    const running = await docxPart(buf, 'word/header1.xml');
    expect(running).toContain('Cover Title');
    expect(running).toContain('PAGE');
    expect(running).toContain('NUMPAGES');
  });
});

describe('cover zones', () => {
  const rule: Doc['blocks'][number] = { t: 'rule' };
  const para = (v: string): Doc['blocks'][number] => ({ t: 'para', text: [{ t: 'text', v }] });
  // PNG_2x1 (see the `images` suite above): small enough to embed as a real
  // theme.cornerMark.png without a network fetch or a large fixture.
  const markedTheme = resolveTheme({
    id: 't', colors: { brandOnLight: '#DA291C' },
    cornerMark: { svg: '<svg viewBox="0 0 10 10"><rect class="c-brand"/></svg>', png: PNG_2x1 },
  });

  it("an ordinary document's rule renders as a paragraph border, never a panel table — the regression this feature must not leak into", async () => {
    const d = doc(para('before'), rule, para('after'));
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).not.toContain('<w:drawing>');
  });

  it('a cover with no rule renders exactly as before this feature — no panel table, no anchored mark', async () => {
    const d: Doc = { meta: { title: 'Cover', lang: 'en', cover: true }, blocks: [para('a'), para('b')] };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(xml).toContain('w:val="DocTitleCover"');
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).not.toContain('<w:drawing>');
  });

  it('a cover with one rule wraps the title and the leading blocks in a bordered single-cell table', async () => {
    const d: Doc = { meta: { title: 'Cover', lang: 'en', cover: true }, blocks: [para('lead'), rule, para('tail')] };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0];
    expect(table, 'expected a <w:tbl> panel').toBeDefined();
    expect(table).toContain('Cover');
    expect(table).toContain('lead');
    expect(table).not.toContain('tail');
    // "tail" flows after the table, in plain paragraphs, not inside another table.
    expect(xml.slice(xml.indexOf('</w:tbl>'))).toContain('tail');
    // A panel exists, so the anchored corner mark is drawn — once, in the
    // panel's own title paragraph (see cornerMarkImage/coverBody).
    expect(xml.match(/<w:drawing>/g)?.length).toBe(1);
    expect(xml).toContain('<wp:anchor');
  });

  it('the mark is anchored outside the panel table, or Word seats it against the cell instead of the frame', async () => {
    const d: Doc = { meta: { title: 'Cover', lang: 'en', cover: true }, blocks: [para('lead'), rule, para('tail')] };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    // An anchor inside a table cell is bound to that cell, so `relativeFrom
    // ="margin"` means the cell's margin: Word drew the glyph 24pt in and
    // 20pt down from the panel's corner, floating inside the frame. It
    // ignores `layoutInCell="0"`, so the only fix is to anchor elsewhere.
    const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0] ?? '';
    expect(table).toContain('Cover');
    expect(table, 'the mark must not be inside the panel table').not.toContain('<w:drawing>');
    expect(xml.indexOf('<w:drawing>')).toBeLessThan(xml.indexOf('<w:tbl>'));
    expect(xml).toContain('<wp:anchor');
    expect(xml.match(/<w:drawing>/g)?.length).toBe(1);
  });

  it("a cover's links keep the Hyperlink style but drop its underline; elsewhere they keep it", async () => {
    const link: Doc['blocks'][number] = {
      t: 'para', text: [{ t: 'link', href: 'https://tebin.pro', children: [{ t: 'text', v: 'www.tebin.pro' }] }],
    };
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [para('lead'), rule, para('mid'), rule, link],
    };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    // Still a link, still the built-in character style — only the decoration
    // the style is borrowed for is cancelled. html.ts does the same in CSS.
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('w:val="Hyperlink"');
    expect(xml).toContain('<w:u w:val="none"/>');

    // The same link in an ordinary document keeps the underline.
    const plain = await docxPart(await renderDocx(doc(link), markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(plain).toContain('w:val="Hyperlink"');
    expect(plain).not.toContain('<w:u w:val="none"/>');
  });

  it('separates two tables that would otherwise touch, because Word merges them into one', async () => {
    // The metadata table follows the panel directly. Merged, the seam becomes
    // an inside horizontal border — which every table here sets to none — so
    // the panel printed with no bottom edge in Word while the PDF drew four.
    const table: Doc['blocks'][number] = {
      t: 'table', head: [[{ t: 'text', v: 'k' }], [{ t: 'text', v: 'v' }]],
      rows: [[[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]]], align: ['l', 'l'],
    };
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [para('lead'), rule, table, rule, para('foot content')],
    };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(xml).not.toContain('</w:tbl><w:tbl>');

    // And the same guard on an ordinary document, where two tables can also
    // land next to each other with no heading between them.
    const plainDoc = doc(table, table);
    const plainXml = await docxPart(await renderDocx(plainDoc, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(plainXml).not.toContain('</w:tbl><w:tbl>');
    expect(plainXml.match(/<w:tbl>/g)?.length).toBe(2);
  });

  it('a quote in a cover flowing zone becomes a shaded statement table; the same quote elsewhere stays a DocQuote', async () => {
    const quote: Doc['blocks'][number] = {
      t: 'quote',
      paras: [[{ t: 'text', v: 'Big line' }], [{ t: 'text', v: 'small line' }]],
    };
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [para('lead'), rule, quote, rule, para('foot content')],
    };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
    // Two single-cell tables now: the panel, then the statement band.
    expect(tables).toHaveLength(2);
    const band = tables[1]!;
    expect(band).toContain('Big line');
    expect(band).toContain('small line');
    expect(band).toContain('w:val="CoverStatement"');
    // The fill is brandOnLight mixed 8% toward white — the same arithmetic and
    // the same constant html.ts spends, so the two renderers cannot drift.
    expect(band).toContain(`w:fill="${mixToWhite('#DA291C', STATEMENT_TINT).replace('#', '')}"`);

    // An ordinary document's quote is untouched: no table, still DocQuote.
    const ordinary = doc(quote);
    const plain = await docxPart(await renderDocx(ordinary, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(plain).not.toContain('<w:tbl>');
    expect(plain).toContain('w:val="DocQuote"');
  });

  it('a cover with two rules puts the foot in plain document flow — Word carries no page-bottom pin here', async () => {
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [para('lead'), rule, para('mid'), rule, para('foot content')],
    };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    // Reading order: panel table, then "mid", then "foot content" — the foot
    // is present and in the right place, just not pinned to the page bottom.
    const tableEnd = xml.indexOf('</w:tbl>');
    const midAt = xml.indexOf('mid');
    const footAt = xml.indexOf('foot content');
    expect(tableEnd).toBeGreaterThan(-1);
    expect(midAt).toBeGreaterThan(tableEnd);
    expect(footAt).toBeGreaterThan(midAt);
    expect(xml).toContain('<w:drawing>');
  });

  it('draws no anchored mark at all when the theme carries no cornerMark, even with a panel', async () => {
    const noMark = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
    const d: Doc = { meta: { title: 'Cover', lang: 'en', cover: true }, blocks: [para('lead'), rule, rule, para('foot')] };
    const xml = await docxPart(await renderDocx(d, noMark, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('<w:drawing>');
  });

  it("a multi-page cover's content after the first pagebreak renders unaffected, in plain flow after the foot", async () => {
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [
        para('lead'), rule, para('mid'), rule, para('foot content'),
        { t: 'pagebreak' },
        { t: 'heading', level: 2, text: [{ t: 'text', v: 'Section 2' }] },
      ],
    };
    const xml = await docxPart(await renderDocx(d, markedTheme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('Section 2');
    expect(xml.indexOf('Section 2')).toBeGreaterThan(xml.indexOf('foot content'));
  });

  it('produces byte-identical output on two runs of the same cover document', async () => {
    const d: Doc = {
      meta: { title: 'Cover', lang: 'en', cover: true },
      blocks: [para('lead'), rule, para('mid'), rule, para('foot content')],
    };
    const a = await renderDocx(d, markedTheme, { epochSeconds: EPOCH });
    const b = await renderDocx(d, markedTheme, { epochSeconds: EPOCH });
    expect(a.equals(b)).toBe(true);
  });
});

describe('heatmap', () => {
  const hm = (style: 'scale' | 'numbers' | 'marks') =>
    doc({ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] });

  it('scale: shades cells with tints computed from the theme', async () => {
    const xml = await body(hm('scale'));
    // 16/16 → step 4 → t=1 → the brand colour itself; 8/16 → step 2 → t=0.32.
    expect(xml).toContain('w:fill="DA291C"');
    expect(xml).toContain(`w:fill="${mixToWhite('#DA291C', 0.32).slice(1)}"`);
    // The zero cell is not shaded at all.
    const cells = [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
    expect(cells.some((c) => !c.includes('w:fill'))).toBe(true);
  });

  it('numbers: prints the hours in ink, never in the brand red', async () => {
    const xml = await body(hm('numbers'));
    expect(xml).toContain('>16<');
    // brandOnLight paints fills only — a digit run must not carry the brand colour.
    const runs = [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
    expect(runs.filter((r) => r.includes('>16<')).every((r) => !r.includes('DA291C'))).toBe(true);
  });

  it('marks: steps marks against the matrix maximum', async () => {
    const xml = await body(hm('marks'));
    expect(xml).toContain('▪▪▪');
    expect(xml).toContain('>▪▪<');
  });

  it('marks: deliberately paints the glyph runs in the brand colour', async () => {
    const xml = await body(hm('marks'));
    // A filled-square glyph is a fill wearing a text costume, not text, so
    // it is exempt from "brandOnLight paints fills and large display type
    // only, never small text" — unlike the numbers style above. A future
    // change flipping marks to plain ink must update this test knowingly.
    const runs = [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
    expect(runs.some((r) => r.includes('▪') && r.includes('DA291C'))).toBe(true);
  });

  it('scale: renders the matrix with no trailing prose appended', async () => {
    const xml = await body(hm('scale'));
    // No legend sentence hardcoded into the renderer — that explanation is
    // the template's to write, not this renderer's. The block still ends
    // in the shared spacer paragraph, not a text run.
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*Shading[^<]*<\/w:t>/);
  });

  it('labels the weeks W01.. in the header row', async () => {
    const xml = await body(hm('scale'));
    expect(xml).toContain('W01');
    expect(xml).toContain('W03');
  });

  it('is byte-identical twice with a heatmap in it', async () => {
    const d = hm('scale');
    expect((await render(d)).equals(await render(d))).toBe(true);
  });
});
