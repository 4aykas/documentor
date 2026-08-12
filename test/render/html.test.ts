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

/**
 * The property under test is "the renderer fetches nothing", not merely
 * "no <link> tag". Any src= or href= whose value is not a data: URI is a
 * network request Chromium would make at print time — except the href of
 * an <a>, which is a link a reader may follow, not a resource the renderer
 * loads on their behalf.
 */
function assertNoExternalResource(html: string): void {
  expect(html).not.toMatch(/<link\b/);
  expect(html).not.toMatch(/url\((?!data:)/);
  const tagRe = /<(\w+)((?:\s+[^<>]*)?)>/g;
  for (const tagMatch of html.matchAll(tagRe)) {
    const tag = tagMatch[1];
    const attrs = tagMatch[2] ?? '';
    for (const attrMatch of attrs.matchAll(/\b(src|href)="([^"]*)"/g)) {
      const attr = attrMatch[1];
      const value = attrMatch[2] ?? '';
      if (tag === 'a' && attr === 'href') continue;
      expect(value.startsWith('data:')).toBe(true);
    }
  }
}

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
    assertNoExternalResource(html);
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

  it('renders a non-data image as a placeholder, not a fetched <img>', async () => {
    const withImg: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'image', src: 'https://example.com/chart.png', alt: 'Sales chart' }],
    };
    const html = await buildHtml(withImg, theme, { headerHeightPt: 40 });
    expect(html).not.toContain('<img');
    expect(html).toContain('Sales chart');
    expect(html).toContain('example.com');
  });

  it('still renders a data: image as a real <img>', async () => {
    const withImg: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'image', src: 'data:image/png;base64,AAAA', alt: 'Inline chart' }],
    };
    const html = await buildHtml(withImg, theme, { headerHeightPt: 40 });
    expect(html).toMatch(/<img src="data:image\/png;base64,AAAA"/);
  });

  it('treats an unparseable src (e.g. a relative path) as a placeholder without throwing', async () => {
    const withImg: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'image', src: './chart.png', alt: 'Relative chart' }],
    };
    await expect(buildHtml(withImg, theme, { headerHeightPt: 40 })).resolves.not.toThrow();
    const html = await buildHtml(withImg, theme, { headerHeightPt: 40 });
    expect(html).not.toContain('<img');
    expect(html).toContain('Relative chart');
  });

  it('guards the no-fetch property even when the document mixes remote, data and relative images', async () => {
    const mixed: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [
        { t: 'image', src: 'https://example.com/chart.png', alt: 'Remote' },
        { t: 'image', src: 'data:image/png;base64,AAAA', alt: 'Inline' },
        { t: 'image', src: './chart.png', alt: 'Relative' },
      ],
    };
    const html = await buildHtml(mixed, theme, { headerHeightPt: 40 });
    assertNoExternalResource(html);
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
