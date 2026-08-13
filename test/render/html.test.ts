import { describe, expect, it } from 'vitest';
import { buildHtml, escapeHtml } from '../../src/render/html.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { HEATMAP_LEGEND } from '../../src/render/tint.js';
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
const build = () => buildHtml(doc, theme);

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

  it('uses the theme\'s own margin on every side — no extra band for the header', async () => {
    // The running header no longer reserves any extra top-margin band (see
    // the comment above the `margin` object in src/render/pdf.ts): the
    // @page rule this renders is just the theme's marginPt, once, applied
    // to all four sides, rather than a bigger value for top alone.
    // 48pt = 16.93mm.
    expect(await build()).toContain('@page{ size: A4; margin: 16.93mm; }');
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
    const html = await buildHtml(withList, theme);
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
    const html = await buildHtml(withImg, theme);
    expect(html).not.toContain('<img');
    expect(html).toContain('Sales chart');
    expect(html).toContain('example.com');
  });

  it('still renders a data: image as a real <img>', async () => {
    const withImg: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'image', src: 'data:image/png;base64,AAAA', alt: 'Inline chart' }],
    };
    const html = await buildHtml(withImg, theme);
    expect(html).toMatch(/<img src="data:image\/png;base64,AAAA"/);
  });

  it('treats an unparseable src (e.g. a relative path) as a placeholder without throwing', async () => {
    const withImg: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'image', src: './chart.png', alt: 'Relative chart' }],
    };
    await expect(buildHtml(withImg, theme)).resolves.not.toThrow();
    const html = await buildHtml(withImg, theme);
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
    const html = await buildHtml(mixed, theme);
    assertNoExternalResource(html);
  });

  it('prints the entity and the date beside the letterhead when meta carries them', async () => {
    const withMeta: Doc = {
      meta: { title: 'T', lang: 'en', entity: 'Acme Sp. z o.o.', date: '2026-08-12' },
      blocks: [],
    };
    const html = await buildHtml(withMeta, theme);
    expect(html).toContain('Acme Sp. z o.o.');
    expect(html).toContain('2026-08-12');
    // Inside the muted letterhead column, not floating somewhere else.
    expect(html).toMatch(/<div class="letterhead">[\s\S]*Acme Sp\. z o\.o\.[\s\S]*<\/div><\/header>/);
  });

  it('adds nothing to the header when meta carries neither entity nor date', async () => {
    // The committed baseline images are rendered from a fixture that sets
    // neither, so this is what keeps them from moving.
    expect(await build()).not.toContain('class="lh-doc');
    expect(await build()).toContain('<div class="letterhead"></div>');
  });
});

describe('link schemes', () => {
  const linked = async (href: string) => {
    const d: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'link', href, children: [{ t: 'text', v: 'Click me' }] }] }],
    };
    return buildHtml(d, theme);
  };

  // A link is followed by a reader, not loaded by the renderer, so the bar is
  // "can this execute or carry a payload", not "is this local".
  for (const href of ['https://example.com/a', 'http://example.com/a', 'mailto:a@example.com', './other.md', '/absolute/path']) {
    it(`keeps ${href} live`, async () => {
      expect(await linked(href)).toContain(`<a href="${href.replace(/&/g, '&amp;')}">Click me</a>`);
    });
  }

  for (const href of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'vbscript:MsgBox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ]) {
    it(`refuses ${JSON.stringify(href)} and shows where it pointed`, async () => {
      const html = await linked(href);
      expect(html).not.toContain('<a href');
      expect(html).toContain('Click me');
      expect(html).toContain('link-refused-target');
    });
  }

  it('names the host of a refused link that has one', async () => {
    // Not reachable through the Markdown ingester today, but the IR is not
    // only ever filled by it — the check belongs to the renderer.
    const html = await linked('data:text/html,<b>x</b>');
    expect(html).toContain('data:');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('heatmap', () => {
  const doc = (style: 'fill' | 'scale' | 'numbers' | 'marks'): Doc => ({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] }],
  });

  it('scale: tints by step class and prints no digits', async () => {
    const html = await buildHtml(doc('scale'), theme);
    expect(html).toContain('<table class="heatmap">');
    expect(html).toContain('<th>W01</th>');
    expect(html).toMatch(/<td class="hm hm-s4"><\/td>/);   // 16 of max 16
    expect(html).toMatch(/<td class="hm hm-s2"><\/td>/);   // 8 of 16
    expect(html).toMatch(/<td class="hm hm-s0"><\/td>/);   // 0
    expect(html).toContain(HEATMAP_LEGEND);
  });

  it('numbers: prints the hours over the tint', async () => {
    const html = await buildHtml(doc('numbers'), theme);
    expect(html).toMatch(/<td class="hm hm-s4">16<\/td>/);
    expect(html).not.toContain(HEATMAP_LEGEND);
  });

  it('marks: prints marks and no tint class above s0', async () => {
    const html = await buildHtml(doc('marks'), theme);
    expect(html).toMatch(/<td class="hm hm-marks">▪▪▪<\/td>/);
  });

  it('fill: binary brand fill', async () => {
    const html = await buildHtml(doc('fill'), theme);
    expect(html).toMatch(/<td class="hm hm-fill"><\/td>/);
    expect(html).toMatch(/<td class="hm hm-s0"><\/td>/);
  });

  it('the stylesheet computes tints from the theme and survives print', async () => {
    const html = await buildHtml(doc('scale'), theme);
    expect(html).toContain('color-mix(in srgb, var(--brand) 32%, white)');
    expect(html).toContain('print-color-adjust: exact');
  });

  it('sizes the label column from the header row, where table-layout: fixed actually reads it', async () => {
    // table-layout: fixed takes every column's width from the FIRST row's
    // cells only. That first row is <thead>'s row, whose first cell is an
    // empty <th> — so the label column's width has to live there, not on
    // <td class="hm-label"> in the body, or the browser ignores it entirely
    // and all columns come out equal, spilling long labels into week 1.
    const html = await buildHtml(doc('scale'), theme);
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).toMatch(/table\.heatmap\s+thead\s+th:first-child\s*\{[^}]*width:\s*28%/);
  });
});
