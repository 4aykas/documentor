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
const RELS_XML = (rels: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;

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
    // Exact, not `.join(' ').toMatch(...)`: a loose match is blind to noise
    // sitting alongside the real entry, which is exactly what let a bug slip
    // through review round 1 — every ordinary run was reporting itself as
    // unread content, and a `.toMatch` assertion couldn't see the flood
    // because it never looked at what else `dropped` contained. The
    // letterhead itself is dropped by design, even though its one piece of
    // content — the date — was carried; nothing else about this document
    // should be unrepresentable.
    expect(dropped).toEqual(['header/footer letterhead dropped (kept the date it carried: "July 20, 2026")']);
  });

  it('lets an explicit title/date override what the header carried', async () => {
    const buf = await renderDocx(doc, theme, { epochSeconds: EPOCH });
    const { doc: back } = await ingestDocx(buf, { title: 'Given Title', date: 'Given Date' });
    expect(back.meta.title).toBe('Given Title');
    expect(back.meta.date).toBe('Given Date');
  });
});

describe('ingestDocx — hand-built fixtures (what the round trip cannot reach)', () => {
  it('produces an empty dropped list for a clean multi-paragraph, multi-run document', async () => {
    // Measured in review round 1: a 4-paragraph document produced 7 drop
    // entries, one per run, because the leftover-content check was testing
    // the run's own `<w:r>`/`</w:r>` wrapper instead of its contents. This is
    // the assertion that would have caught it — `dropped` must be empty, not
    // merely "not obviously wrong" — across several paragraphs and several
    // runs per paragraph (formatting changes mid-paragraph are exactly what
    // splits a paragraph into more than one run in real Word output).
    const body = [
      para(run('First paragraph, one run.')),
      para(`${run('Second paragraph, ')}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">two</w:t></w:r>${run(' runs.')}`),
      para(`${run('Third paragraph, ')}<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">three</w:t></w:r>${run(' runs total.')}`),
      para(run('Fourth paragraph.')),
    ].join('');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(dropped).toEqual([]);
    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'First paragraph, one run.' }] },
      { t: 'para', text: [{ t: 'text', v: 'Second paragraph, ' }, { t: 'strong', children: [{ t: 'text', v: 'two' }] }, { t: 'text', v: ' runs.' }] },
      { t: 'para', text: [{ t: 'text', v: 'Third paragraph, ' }, { t: 'em', children: [{ t: 'text', v: 'three' }] }, { t: 'text', v: ' runs total.' }] },
      { t: 'para', text: [{ t: 'text', v: 'Fourth paragraph.' }] },
    ]);
  });

  it('merges adjacent same-formatted runs instead of leaving Word’s own run-splitting in the IR', async () => {
    // A document that reads **bold** in Word commonly stores it as several
    // adjacent `<w:r>` elements with identical `<w:rPr>` (a spell-check
    // boundary, an editing session's own history) rather than one run.
    const bold = (t: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
    const body = para(`${bold('bo')}${bold('ld')}`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'strong', children: [{ t: 'text', v: 'bold' }] }] }]);
  });

  it('reads a tab as a space instead of silently joining the two words it separated', async () => {
    // Round-2 regression: `s.startsWith('<w:t')` is a plain string-prefix
    // test, blind to the `\b` word-boundary logic that correctly told
    // `<w:tab/>` and `<w:t>` apart as separate regex alternatives — and
    // "<w:tab/>" does start with the four characters "<w:t". With the checks
    // in the wrong order, every tab fell into the `<w:t>` branch, read a
    // capture group that didn't exist as `''`, and vanished: `a<w:tab/>b`
    // ingested as `"ab"`, with nothing in `dropped` to say a tab went
    // anywhere. The IR has no tab of its own — a renderer sets its own
    // spacing — so a space is the closest faithful stand-in.
    const body = para(`${run('a')}<w:r><w:tab/></w:r>${run('b')}`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: 'a b' }] }]);
    expect(dropped).toEqual([]);
  });

  it('reads an ordered and a bulleted list, each at two levels, with opposite formats across levels so an ilvl-fallback bug cannot pass unnoticed', async () => {
    // Review round 1, Important 5: the original fixture gave both abstracts
    // the same "ordered-ness" at ilvl 0 and ilvl 1, so deleting the ilvl-1
    // `<w:lvl>` and letting `resolveLevel` fall back to ilvl 0 produced
    // byte-identical output — the ilvl-specific lookup was untested. Giving
    // the two levels of each abstract *opposite* formats means that fallback
    // now changes the answer: deleting either `<w:lvl w:ilvl="1">` below and
    // re-running this test does turn it red (verified by hand while making
    // this fix; not left in the suite, since a test asserting its own
    // fixture is broken isn't a test).
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="10">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="20">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
    </w:numbering>`;

    const body = [
      para(run('one'), numPr(1, 0)),
      para(run('two'), numPr(1, 0)),
      para(run('sub'), numPr(1, 1)),
      para(run('bullet one'), numPr(2, 0)),
      para(run('nested ordered'), numPr(2, 1)),
    ].join('');

    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
      { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'sub' }]] },
      { t: 'list', ordered: false, depth: 0, items: [[{ t: 'text', v: 'bullet one' }]] },
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'nested ordered' }]] },
    ]);
  });

  it('restarts a nested ordered level whenever a shallower item interrupts it, the OOXML default', async () => {
    // Measured against Word's own default `w:lvlRestart` behaviour: a / a.i /
    // b / b.i numbers the second sub-list "i", not "ii", because `b` at
    // ilvl 0 restarts every deeper level. Only fragments whose resolved
    // start differs from 1 carry an explicit `start` (see md.ts's own
    // `list.start` convention), so a restarted sub-list has no `start` field
    // at all — the same as its first appearance.
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="10">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
    </w:numbering>`;
    const body = [
      para(run('a'), numPr(1, 0)),
      para(run('a.i'), numPr(1, 1)),
      para(run('b'), numPr(1, 0)),
      para(run('b.i'), numPr(1, 1)),
    ].join('');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'a' }]] },
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'a.i' }]] },
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'b' }]], start: 2 },
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'b.i' }]] }, // restarted: no `start`, i.e. back to 1
    ]);
  });

  it('honours an explicit w:lvlRestart that narrows the default (restart only at the named shallower level)', async () => {
    // ilvl 2 declares `<w:lvlRestart w:val="1"/>`: it restarts only when an
    // ilvl-1 item occurs, not any shallower item — unlike the previous
    // test's default. So the ilvl-0 item `y` between `x.a` and `y.a` must
    // NOT restart ilvl 2 (`y.a` continues as item 2), while the next ilvl-1
    // item `z` does restart it (`z.a` goes back to item 1).
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="10">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlRestart w:val="1"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
    </w:numbering>`;
    const body = [
      para(run('x'), numPr(1, 1)),
      para(run('x.a'), numPr(1, 2)),
      para(run('y'), numPr(1, 0)),
      para(run('y.a'), numPr(1, 2)),
      para(run('z'), numPr(1, 1)),
      para(run('z.a'), numPr(1, 2)),
    ].join('');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'x' }]] },
      { t: 'list', ordered: true, depth: 2, items: [[{ t: 'text', v: 'x.a' }]] },
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'y' }]] },
      { t: 'list', ordered: true, depth: 2, items: [[{ t: 'text', v: 'y.a' }]], start: 2 }, // not restarted by ilvl 0
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'z' }]] },
      { t: 'list', ordered: true, depth: 2, items: [[{ t: 'text', v: 'z.a' }]] }, // restarted by ilvl 1
    ]);
  });

  it('honours w:lvlRestart="0" as ECMA-376’s reserved "never restart", not as "restart at ilvl 0"', async () => {
    // Round-2 regression: `resetDeeperCounters` compared the incoming ilvl
    // directly against `lvlRestart` with no special case for 0, so
    // `w:val="0"` — ECMA-376's sentinel for "this level is never restarted"
    // — was read as "restart whenever ilvl 0 occurs", the single most common
    // interruption there is. Kept as its own test rather than folded into
    // the explicit-lvlRestart test above: 0 is a distinct meaning from
    // "restart at level N", and a shared assertion would not say which of
    // the two broke if either regressed.
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="10">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlRestart w:val="0"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
    </w:numbering>`;
    const body = [
      para(run('a'), numPr(1, 0)),
      para(run('a.1'), numPr(1, 1)),
      para(run('b'), numPr(1, 0)),
      para(run('b.?'), numPr(1, 1)),
    ].join('');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'a' }]] },
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'a.1' }]] },
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'b' }]], start: 2 },
      // Never restarted: continues from `a.1`'s 1, i.e. this is item 2, not 1.
      { t: 'list', ordered: true, depth: 1, items: [[{ t: 'text', v: 'b.?' }]], start: 2 },
    ]);
  });

  it('follows a list style’s numStyleLink to the abstract that actually carries its levels', async () => {
    // An ordinary shape for a Word list built from a paragraph/list style
    // (Format ▸ Bullets and Numbering, linked to a style), not the
    // hand-edited corruption `resolveLevel` also has to survive: one
    // abstractNum carries the real `<w:lvl>` definitions under
    // `<w:styleLink w:val="Name">`, and every abstractNum actually used by a
    // `<w:num>` carries no levels of its own, only `<w:numStyleLink
    // w:val="Name"/>` pointing back at it by style name.
    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="1"><w:styleLink w:val="TebinList"/>
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="2"><w:numStyleLink w:val="TebinList"/></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="2"/></w:num>
    </w:numbering>`;
    const body = [para(run('one'), numPr(1, 0)), para(run('two'), numPr(1, 0))].join('');
    const buf = await buildDocx({ 'word/document.xml': documentXml(body), 'word/numbering.xml': numberingXml });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('names tracked insertions and deletions once per paragraph instead of leaving them silent', async () => {
    // Policy: an insertion reads as accepted (Word's own default display) —
    // its `<w:r>` is ordinary content to the run scanner, `<w:ins>` wrapper
    // or not — a deletion reads as rejected and contributes no text. Both are
    // defensible; neither may be invisible in a document under review, so
    // this asserts the paragraph is reported exactly once, naming both
    // counts — and, per round 2, exactly once overall: the deletion's own
    // `<w:delText>` used to also fall through to a second, generic
    // "run content this ingester does not read" entry, undoing part of the
    // round-1 fix that made `dropped` trustworthy. `toEqual` on the whole
    // array (not `.toContain`) is what would catch that duplicate coming back.
    const body = para(
      `${run('kept ')}<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">${run('inserted ')}</w:ins>` +
        `<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">deleted </w:delText></w:r></w:del>${run('text')}`,
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'kept inserted text' }] },
    ]);
    expect(dropped).toEqual([
      'paragraph contains 1 tracked insertion (kept, read as accepted) and 1 tracked deletion (dropped, read as rejected)',
    ]);
  });

  it('keeps the text on either side of a page break inside the same run', async () => {
    // Review round 1, Critical 3: `hasPageBreak` used to test the whole run
    // and short-circuit before any text was read, so `before<break>after` in
    // one run yielded only the break — silently discarding both text atoms.
    const body = para(`<w:r><w:t xml:space="preserve">before</w:t><w:br w:type="page"/><w:t xml:space="preserve">after</w:t></w:r>`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'before' }] },
      { t: 'pagebreak' },
      { t: 'para', text: [{ t: 'text', v: 'after' }] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('keeps the text on either side of a picture inside the same run', async () => {
    const drawing =
      `<w:drawing><wp:inline><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const body = para(`<w:r><w:t xml:space="preserve">before</w:t>${drawing}<w:t xml:space="preserve">after</w:t></w:r>`);
    const relsXml = RELS_XML(
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`,
    );
    const buf = await buildDocx({
      'word/document.xml': documentXml(body),
      'word/_rels/document.xml.rels': relsXml,
      'word/media/image1.png': Buffer.from(PNG_HEX, 'hex'),
    });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'before' }] },
      { t: 'image', src: PNG_DATA_URI, alt: '' },
      { t: 'para', text: [{ t: 'text', v: 'after' }] },
    ]);
    expect(dropped).toEqual([]);
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

  it('silences Word’s own layout/authoring-state marks instead of reporting them as unread content', async () => {
    // Corpus defect: 5 of 86 real documents produced
    // "run content this ingester does not read: <w:lastRenderedPageBreak/>"
    // — Word's own record of where *it* last paginated the document for
    // screen display, meaningless to any other renderer (this project's
    // renderers choose their own pagination) and not visible content by any
    // definition. `<w:proofErr>` (a spell/grammar-check flag on adjacent
    // text) and `<w:bookmarkStart>`/`<w:bookmarkEnd>` (a named anchor with no
    // visible text of its own — see the ingestDocx.ts comment on why a
    // bookmark is silenced rather than reported) are the same kind of thing.
    // `<w:softHyphen/>` was already silenced before this change; kept here
    // so one test demonstrates the whole family together.
    const body = para(
      `<w:r><w:t xml:space="preserve">before</w:t><w:lastRenderedPageBreak/><w:t xml:space="preserve">after</w:t></w:r>` +
        `<w:bookmarkStart w:id="0" w:name="ref1"/>` +
        `<w:proofErr w:type="spellStart"/>${run('tricky')}<w:proofErr w:type="spellEnd"/>` +
        `<w:bookmarkEnd w:id="0"/>` +
        `<w:r><w:t xml:space="preserve">soft</w:t><w:softHyphen/><w:t xml:space="preserve">hyphen</w:t></w:r>`,
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'text', v: 'beforeaftertrickysofthyphen' }] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('still reports genuinely unread run content, so this change cannot be mistaken for a blanket silencer', async () => {
    // A comment reference is real, addressable content (the comment text
    // itself lives in word/comments.xml, which this ingester does not read
    // at all) — nothing like a layout hint, and it must keep surfacing in
    // `dropped` after the additions above.
    const body = para(`<w:r><w:t xml:space="preserve">see</w:t><w:commentReference w:id="0"/></w:r>`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { dropped } = await ingestDocx(buf);

    expect(dropped).toEqual([
      'run content this ingester does not read: <w:commentReference w:id="0"/>',
    ]);
  });

  it('carries a fldSimple HYPERLINK field as a link, with the href from w:instr and the text from its nested runs', async () => {
    // Word wrote a link this way for every version before 2007, and still
    // does for mail-merge and cross-reference fields — ordinary Word output,
    // not a corruption. Before this change, `dropped` came back empty *and*
    // the href was gone: the run-matching regex still found the nested
    // `<w:r>` for "click here" wherever it sat, so the text survived by
    // accident while the attribute carrying the actual link target vanished
    // with no trace anywhere in the ingester's output.
    const body = para(`<w:fldSimple w:instr='HYPERLINK "http://example.com/secret"'>${run('click here')}</w:fldSimple>`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'link', href: 'http://example.com/secret', children: [{ t: 'text', v: 'click here' }] }] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('keeps a switch after the URL in a fldSimple HYPERLINK instruction out of the href', async () => {
    // `\l "frag"` (a bookmark switch) and `\o "tooltip"` are ordinary parts of
    // a HYPERLINK field instruction, sitting after the quoted URL — capturing
    // "everything inside the attribute" instead of "the first quoted span"
    // would fold them straight into the href.
    const body = para(`<w:fldSimple w:instr='HYPERLINK "http://example.com/x" \\l "frag" \\o "tip"'>${run('text')}</w:fldSimple>`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'link', href: 'http://example.com/x', children: [{ t: 'text', v: 'text' }] }] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('reports, once, a fldSimple field that is not a HYPERLINK, keeping its already-computed text', async () => {
    const body = para(`<w:fldSimple w:instr=' PAGE '>${run('3')}</w:fldSimple>`);
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: '3' }] }]);
    expect(dropped).toEqual(['field code this ingester does not carry (kept its text): PAGE']);
  });

  it('carries the complex fldChar/instrText/separate/fldChar-end form of a HYPERLINK the same way as fldSimple, once, not four times', async () => {
    // Decision (see paragraphSegments' own comment on the `cfSpan` branch):
    // the complex form is handled identically to `fldSimple` rather than
    // merely reported, so the same link is not silent in one spelling and
    // noisy in the other. Before this case existed, each of the four
    // `<w:r>`s below (begin/instrText/separate/end) tripped `runAtoms`'s own
    // per-run leftover check independently, so this fixture produced four
    // "run content this ingester does not read" entries — and still lost the
    // href, since nothing turned the instruction text into a link.
    const body = para(
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> HYPERLINK "http://example.com/complex" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        `${run('complex link text')}` +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([
      { t: 'para', text: [{ t: 'link', href: 'http://example.com/complex', children: [{ t: 'text', v: 'complex link text' }] }] },
    ]);
    expect(dropped).toEqual([]);
  });

  it('reports a complex, non-HYPERLINK field once, not once per fldChar/instrText run', async () => {
    const body = para(
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        `${run('3')}` +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: '3' }] }]);
    expect(dropped).toEqual(['complex field code this ingester does not carry (kept its text): PAGE']);
  });

  it('reports an unrecognised paragraph-level wrapper (e.g. w:smartTag) instead of silently discarding what it wraps, while its nested text still survives', async () => {
    // The general defect this change closes: a paragraph-level element that
    // carries meaning outside any run — here, `w:smartTag`'s own
    // `w:uri`/`w:element` attributes naming what Word recognised the text
    // as — was invisible to both the run-level and (previously nonexistent)
    // paragraph-level leftover checks. The nested run's text still survives,
    // the same accident of the run regex matching wherever it sits that the
    // file header describes; what changes is that the wrapper's own vanished
    // meaning is now named in `dropped` instead of leaving no trace at all.
    const body = para(
      `<w:smartTag w:uri="urn:schemas-tebin-com:place" w:element="place">${run('Springfield')}</w:smartTag>`,
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: 'Springfield' }] }]);
    expect(dropped.length).toBe(1);
    expect(dropped[0]).toMatch(/^paragraph content this ingester does not read: /);
    expect(dropped[0]).toMatch(/w:smartTag/);
  });

  it('does not undo the bookmark/proofErr/lastRenderedPageBreak silencing now that a paragraph-level leftover check also runs', async () => {
    // Same fixture as the earlier silencing test, re-asserted after adding
    // the paragraph-level check: that check must recognise exactly the same
    // elements `unitRe` already special-cases (bookmarkStart/bookmarkEnd/
    // proofErr) as consumed, not merely as "matched and then still flagged".
    const body = para(
      `<w:r><w:t xml:space="preserve">before</w:t><w:lastRenderedPageBreak/><w:t xml:space="preserve">after</w:t></w:r>` +
        `<w:bookmarkStart w:id="0" w:name="ref1"/>` +
        `<w:proofErr w:type="spellStart"/>${run('tricky')}<w:proofErr w:type="spellEnd"/>` +
        `<w:bookmarkEnd w:id="0"/>`,
    );
    const buf = await buildDocx({ 'word/document.xml': documentXml(body) });
    const { doc, dropped } = await ingestDocx(buf);

    expect(doc.blocks).toEqual([{ t: 'para', text: [{ t: 'text', v: 'beforeaftertricky' }] }]);
    expect(dropped).toEqual([]);
  });
});
