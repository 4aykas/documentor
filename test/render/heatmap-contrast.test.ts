// The heatmap's darkest step is the brand at full strength, and the number in
// that cell used to be drawn in the theme's ink whatever the fill turned out
// to be. For TEBIN that is near-black on dark red — legible, barely. For
// `plain`, whose brandOnLight IS its ink by design (#1A1A1A), it was black on
// black: the value was not on the page at all. Nothing saw it, because every
// heatmap anyone had looked at was a TEBIN one.

import { describe, expect, it } from 'vitest';
import { buildHtml } from '../../src/render/html.js';
import { renderDocx } from '../../src/render/docx.js';
import { docxPart } from '../helpers/docx-parts.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { mixToWhite, readableOn, SCALE_STEPS } from '../../src/render/tint.js';
import type { Doc } from '../../src/ir/types.js';

const EPOCH = 1_000_000_000;
const doc: Doc = {
  meta: { title: 'T', lang: 'en' },
  blocks: [{
    t: 'heatmap', style: 'numbers',
    rows: [{ label: 'Lead', values: [40, 30, 20, 8] }, { label: 'Support', values: [4, 8, 16, 40] }],
  }],
};
/** A theme whose brand is as dark as its ink — `plain` is exactly this. */
const dark = resolveTheme({ id: 'd', colors: { brandOnLight: '#1A1A1A', ink: '#1A1A1A' } });
const light = resolveTheme({ id: 'l', colors: { brandOnLight: '#DA291C', ink: '#1A1A1A' } });

describe('readableOn', () => {
  it('picks whichever of ink and white actually contrasts with the fill', () => {
    expect(readableOn('#FFFFFF', '#1A1A1A')).toBe('#1A1A1A');
    expect(readableOn('#1A1A1A', '#1A1A1A')).toBe('#FFFFFF');
    // The case that started it: the brand at full strength, both themes.
    expect(readableOn('#DA291C', '#1A1A1A')).toBe('#FFFFFF');
  });

  it('never leaves a step drawing ink on a fill as dark as the ink', () => {
    for (const t of SCALE_STEPS) {
      const fill = mixToWhite('#1A1A1A', t);
      const text = readableOn(fill, '#1A1A1A');
      expect(text === '#FFFFFF' || t < 0.5, `step ${t} on ${fill} chose ${text}`).toBe(true);
    }
  });
});

describe('the heatmap carries its own text colour', () => {
  it('gives every step a colour in the stylesheet, and white to the darkest', async () => {
    const html = await buildHtml(doc, dark);
    for (const [i, t] of SCALE_STEPS.entries()) {
      const want = readableOn(mixToWhite('#1A1A1A', t), '#1A1A1A');
      expect(html, `step ${i + 1}`).toContain(`color: ${want};`);
    }
    expect(html).toContain('color: #FFFFFF;');
  });

  it('Word says the same thing about the same cell', async () => {
    const xml = await docxPart(await renderDocx(doc, dark, { epochSeconds: EPOCH }), 'word/document.xml');
    // The darkest fill and a white run have to appear together — the number
    // in that cell is the one that was invisible.
    const darkest = mixToWhite('#1A1A1A', SCALE_STEPS[SCALE_STEPS.length - 1]!).slice(1);
    expect(xml).toContain(`w:fill="${darkest}"`);
    expect(xml).toContain('w:val="FFFFFF"');
  });

  it('leaves a light theme its ink on the pale steps', async () => {
    const html = await buildHtml(doc, light);
    // The palest step is nearly white; ink must stay ink there.
    expect(html).toContain(`color: ${readableOn(mixToWhite('#DA291C', SCALE_STEPS[0]!), '#1A1A1A')};`);
    expect(readableOn(mixToWhite('#DA291C', SCALE_STEPS[0]!), '#1A1A1A')).toBe('#1A1A1A');
  });
});
