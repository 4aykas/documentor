import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { validateDoc } from '../../src/ir/validate.js';
import { renderDocx } from '../../src/render/docx.js';
import { buildHtml } from '../../src/render/html.js';
import { renderMarkdown } from '../../src/render/md.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_700_000_000;
const SOURCE = 'Liability is ~~statutory and unlimited~~ **capped at the fee**.\n';

describe('struck-through text', () => {
  it('is carried into the IR, not dropped', () => {
    const { doc, dropped } = ingestMarkdown(SOURCE, { title: 'T' });
    expect(dropped).toEqual([]);
    const para = doc.blocks[0];
    expect(para?.t).toBe('para');
    expect(para?.t === 'para' && para.text).toContainEqual({ t: 'del', children: [{ t: 'text', v: 'statutory and unlimited' }] });
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('prints as a deletion in the PDF, in Word and in Markdown', async () => {
    const { doc } = ingestMarkdown(SOURCE, { title: 'T' });
    const theme = await loadTheme('tebin');
    expect(await buildHtml(doc, theme)).toContain('<del>statutory and unlimited</del>');
    const body = await docxPart(await renderDocx(doc, theme, { epochSeconds: EPOCH }), 'word/document.xml');
    const run = body.slice(body.lastIndexOf('<w:r>', body.indexOf('statutory and unlimited')), body.indexOf('statutory and unlimited'));
    expect(run).toContain('<w:strike/>');
    expect(run).toContain(`w:val="${theme.colors.brandOnLight.slice(1).toUpperCase()}"`);
    expect(renderMarkdown(doc)).toContain('~~statutory and unlimited~~');
  });
});
