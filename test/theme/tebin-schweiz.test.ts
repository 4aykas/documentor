import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderDocx } from '../../src/render/docx.js';
import { buildHtml } from '../../src/render/html.js';
import { cornerOutline, dropClosingSegment, outlineCornerMark, rectOf } from '../../src/theme/tebin-schweiz.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EPOCH = 1_700_000_000;

describe('tracing the corner glyph', () => {
  it('reads each bar of the vendored asset as a rectangle', () => {
    expect(rectOf('M533.33,0v24.68h-49.51V0h49.51Z')).toEqual({ x0: 483.82, y0: 0, x1: 533.33, y1: 24.68 });
    expect(rectOf('M533.33,50.28h-24.31V0h24.31v50.28Z')).toEqual({ x0: 509.02, y0: 0, x1: 533.33, y1: 50.28 });
  });

  it('refuses a shape that is not a rectangle rather than tracing it', () => {
    expect(() => rectOf('M0,0L10,10H0Z')).toThrow(/only M, H, V/);
    expect(() => rectOf('M0,0H10V10H5V5H0Z')).toThrow(/not a rectangle/);
  });

  it('outlines the two bars as one L, not two overlapping boxes', () => {
    const d = cornerOutline([
      { x0: 483.82, y0: 0, x1: 533.33, y1: 24.68 },
      { x0: 509.02, y0: 0, x1: 533.33, y1: 50.28 },
    ]);
    expect(d).toBe('M483.82,0H533.33V50.28H509.02V24.68H483.82Z');
  });

  it('refuses bars that do not share the top-right corner', () => {
    expect(() => cornerOutline([{ x0: 0, y0: 0, x1: 10, y1: 2 }, { x0: 8, y0: 0, x1: 9, y1: 10 }])).toThrow(/top-right/);
  });

  it('draws the outline from the vendored asset, in line, with no inline paint', () => {
    const svg = outlineCornerMark(readFileSync(join(ROOT, 'brand', 'tebin', 'corner-mark.svg'), 'utf8'), 40);
    expect(svg).toMatch(/<path class="c-line" d="M483.82,0H533.33V50.28H509.02V24.68H483.82Z"\/>/);
    expect(svg).not.toMatch(/fill=|stroke=/);
  });

  it('drops a last segment that ends at the start, or a sliver short of it', () => {
    // Exactly back: `Z` alone draws the same shape.
    expect(dropClosingSegment('M0,0h10v10h-10V0Z')).toBe('M0,0h10v10h-10Z');
    // The logo's E: its V stops 0.81 units short, and Z's sliver made a spur.
    const e = 'M107.55,50.27h91.86v27.33h-60.53v17.56h54.82v25.35h-54.82v18.39h61.35v27.33h-92.67V50.27Z';
    expect(dropClosingSegment(e)).toBe(e.replace('V50.27Z', 'Z'));
  });

  it('keeps a last segment that is part of the shape', () => {
    expect(dropClosingSegment('M0,0h10v10H0Z')).toBe('M0,0h10v10H0Z');
    // A curve that closes is shape, not a sliver.
    expect(dropClosingSegment('M0,0h10c0,5,-5,5,-10,0Z')).toBe('M0,0h10c0,5,-5,5,-10,0Z');
  });
});

describe('the tebin-schweiz theme', () => {
  const { doc } = ingestMarkdown('## Umfang\n\nText.\n', { title: 'Angebot' });

  it('keeps the entity letterhead of the classic theme it varies', async () => {
    for (const [variant, classic] of [['tebin-schweiz', 'tebin'], ['tebin-ua-schweiz', 'tebin-ua']] as const) {
      expect((await loadTheme(variant)).letterhead).toEqual((await loadTheme(classic)).letterhead);
    }
  });

  it('strokes its marks through the line classes, which only it gets', async () => {
    const html = await buildHtml(doc, await loadTheme('tebin-schweiz'));
    expect(html).toMatch(/\.logo \.c-line, \.corner-mark-panel \.c-line, \.corner-mark-grid \.c-line\{ fill: #FFFFFF; stroke: var\(--brand\);/);
    expect(html).toMatch(/vector-effect: non-scaling-stroke/);
    const classic = await buildHtml(doc, await loadTheme('tebin'));
    expect(classic).not.toMatch(/c-line/);
    expect(classic).not.toMatch(/background: none; border-left/);
  });

  it('draws the cover statement as a hairline in both renderers', async () => {
    const cover = ingestMarkdown('Lead\n\n---\n\n> Statement\n\n---\n\nFoot\n', { title: 'Angebot', cover: true }).doc;
    const theme = await loadTheme('tebin-schweiz');
    expect(await buildHtml(cover, theme)).toMatch(/\.cover-statement-zone > blockquote\{ background: none; border-left: 0\.75pt solid var\(--brand\);/);
    const body = await docxPart(await renderDocx(cover, theme, { epochSeconds: EPOCH }), 'word/document.xml');
    expect(body).toMatch(/Statement/);
    expect(body).not.toMatch(/w:fill="FCEBEA"|w:fill="FBEAE9"/i);
    const classic = await docxPart(await renderDocx(cover, await loadTheme('tebin'), { epochSeconds: EPOCH }), 'word/document.xml');
    expect(classic).toMatch(/<w:shd [^>]*w:fill="(?!auto)[0-9A-F]{6}"/i);
    expect(body).not.toMatch(/<w:shd [^>]*w:fill="(?!auto)[0-9A-F]{6}"/i);
  });

  it('refuses a coverStatement it does not know', async () => {
    const { resolveTheme } = await import('../../src/theme/resolve.js');
    expect(() => resolveTheme({ coverStatement: 'glow' })).toThrow(/coverStatement/);
  });
});
