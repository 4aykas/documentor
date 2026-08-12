import { describe, expect, it } from 'vitest';
import { buildHtml, escapeHtml } from '../../src/render/html.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import type { Doc } from '../../src/ir/types.js';

const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
const doc: Doc = {
  meta: { title: 'Report & Co', lang: 'uk' },
  blocks: [
    { t: 'heading', level: 2, text: [{ t: 'text', v: 'Розділ' }] },
    { t: 'para', text: [{ t: 'text', v: '<script>alert(1)</script>' }] },
    { t: 'table', head: [[{ t: 'text', v: 'a' }]], rows: [[[{ t: 'text', v: '1' }]]], align: ['r'] },
  ],
};
const build = () => buildHtml(doc, theme, { headerHeightPt: 40 });

describe('buildHtml', () => {
  it('escapes text so a document cannot inject markup', async () => {
    const html = await build();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes the title in both the <title> and the header', async () => {
    expect(await build()).not.toContain('Report & Co');
    expect(await build()).toContain('Report &amp; Co');
  });

  it('sets the document language from meta.lang', async () => {
    expect(await build()).toMatch(/<html lang="uk"/);
  });

  it('references no external resource', async () => {
    const html = await build();
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\((?!data:)/);
  });

  it('inlines the font faces', async () => {
    expect((await build()).match(/@font-face/g)).toHaveLength(6);
  });

  it('carries the theme colours as custom properties', async () => {
    expect(await build()).toContain('--brand: #DA291C');
  });

  it('aligns a table column from the IR', async () => {
    expect(await build()).toMatch(/text-align:\s*right/);
  });

  it('reserves the header height in the page margin', async () => {
    // 48pt margin + 40pt header = 88pt = 31.04mm
    expect(await build()).toContain('31.04mm');
  });

  it('omits the logo block entirely when the theme has none', async () => {
    expect(await build()).not.toContain('class="logo"');
  });

  it('resumes an ordered list that a sublist interrupted', async () => {
    const withList: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [
        { t: 'list', ordered: true, depth: 0, items: [[{ t: 'text', v: 'a' }]] },
        { t: 'list', ordered: false, depth: 1, items: [[{ t: 'text', v: 'x' }]] },
        { t: 'list', ordered: true, depth: 0, start: 2, items: [[{ t: 'text', v: 'b' }]] },
      ],
    };
    const html = await buildHtml(withList, theme, { headerHeightPt: 40 });
    expect(html).toContain('<ol class="d0" start="2">');
    // A first fragment starting at 1 must not carry a redundant attribute.
    expect(html).toContain('<ol class="d0">');
    expect(html).toContain('<ul class="d1">');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
