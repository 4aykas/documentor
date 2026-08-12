import { Document, ExternalHyperlink, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';
import { normalizeDocx } from '../../src/render/normalize-docx.js';
import { docxEntries, docxEntryDates, docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_000_000_000;

/** Carries a hyperlink on purpose: its relationship id is the one thing that
 *  differs between two packs regardless of how fast they run. */
const build = () =>
  Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: 'A document.' })] }),
            new Paragraph({
              children: [
                new ExternalHyperlink({
                  link: 'https://tebin.pro/',
                  children: [new TextRun({ text: 'tebin.pro', style: 'Hyperlink' })],
                }),
              ],
            }),
          ],
        },
      ],
    }),
  );

describe('normalizeDocx', () => {
  it('two packs of the same document differ before it runs', async () => {
    // If this ever stops being true the normaliser may be unnecessary — but it
    // must not be deleted on the strength of a run inside one second, which is
    // the whole reason this assertion is here rather than assumed.
    const [a, b] = await Promise.all([build(), build()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('and are byte-identical after it', async () => {
    const a = await normalizeDocx(Buffer.from(await build()), EPOCH);
    const b = await normalizeDocx(Buffer.from(await build()), EPOCH);
    expect(a.equals(b)).toBe(true);
  });

  it('writes the epoch into the document properties', async () => {
    const core = await docxPart(await normalizeDocx(Buffer.from(await build()), EPOCH), 'docProps/core.xml');
    expect(core).toContain('2001-09-09T01:46:40Z');
    expect(core).not.toMatch(/20[2-9]\d-/);
  });

  it('renumbers the random hyperlink id in the part and in its relationships', async () => {
    const out = await normalizeDocx(Buffer.from(await build()), EPOCH);
    const part = await docxPart(out, 'word/document.xml');
    const rels = await docxPart(out, 'word/_rels/document.xml.rels');
    expect(part).toContain('r:id="rIdLink1"');
    expect(rels).toContain('Id="rIdLink1"');
    expect(rels).toContain('Target="https://tebin.pro/"');
  });

  it('pins every zip entry to the epoch, not the wall clock', async () => {
    // The DOS timestamp JSZip stores has two-second resolution, so two builds
    // run back to back usually land in the same bucket anyway — the
    // byte-identity test above cannot tell a pinned stamp from an unpinned one
    // that got lucky. This asserts the stamp directly, on every entry.
    const dates = await docxEntryDates(await normalizeDocx(Buffer.from(await build()), EPOCH));
    dates.forEach((d, i) => {
      expect(d.getTime(), `entry ${i} carries ${d.toISOString()} instead of the epoch`).toBe(EPOCH * 1000);
    });
  });

  it('keeps every entry the package had', async () => {
    const before = await docxEntries(Buffer.from(await build()));
    const after = await docxEntries(await normalizeDocx(Buffer.from(await build()), EPOCH));
    expect(after).toEqual(before);
  });
});
