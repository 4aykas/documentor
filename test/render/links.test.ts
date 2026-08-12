// The renderers must agree about link targets. test/baseline/kitchen-sink.test.ts
// compares what a reader would compare and so cannot see an href at all; this is
// where that blind spot is covered instead — by asking both renderers the same
// question about the same document and requiring the same answer.

import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { buildHtml } from '../../src/render/html.js';
import { refusedLinkTarget, schemeIsRefused } from '../../src/render/links.js';
import { renderMarkdown } from '../../src/render/md.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
const docxTheme = resolveTheme({ id: 't' });

const linkDoc = (href: string): Doc => ({
  meta: { title: 'T', lang: 'en' },
  blocks: [{ t: 'para', text: [{ t: 'link', href, children: [{ t: 'text', v: 'Click me' }] }] }],
});

const LIVE = [
  'https://example.com/a',
  'http://example.com/a',
  'mailto:a@example.com',
  './other.md',
  '/absolute/path',
];

const REFUSED = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'java\tscript:alert(1)',
  ' javascript:alert(1)',
  'vbscript:MsgBox(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
];

describe('every renderer refuses the same link schemes', () => {
  for (const href of REFUSED) {
    it(`refuses ${JSON.stringify(href)} in HTML and in Markdown`, async () => {
      const html = await buildHtml(linkDoc(href), theme);
      const md = renderMarkdown(linkDoc(href));

      expect(html).not.toContain('<a href');
      expect(md).not.toContain('](');

      // Refused is not the same as deleted: the reader still sees the text and
      // still learns where it pointed, in both outputs.
      expect(html).toContain('Click me');
      expect(md).toContain('Click me');
      expect(html).toContain('link-refused-target');
      expect(md).toContain(`(${refusedLinkTarget(href)})`);

      const docx = await docxPart(await renderDocx(linkDoc(href), docxTheme, { epochSeconds: 1_000_000_000 }), 'word/document.xml');
      expect(docx).not.toContain('<w:hyperlink');
      expect(docx).toContain('Click me');
    });
  }

  for (const href of LIVE) {
    it(`keeps ${href} live in HTML and in Markdown`, async () => {
      const html = await buildHtml(linkDoc(href), theme);
      expect(html).toContain(`<a href="${href}">Click me</a>`);
      expect(renderMarkdown(linkDoc(href))).toContain(`[Click me](${href})`);

      const buf = await renderDocx(linkDoc(href), docxTheme, { epochSeconds: 1_000_000_000 });
      expect(await docxPart(buf, 'word/_rels/document.xml.rels')).toContain(`Target="${href}"`);
    });
  }
});

describe('refusedLinkTarget', () => {
  it('names the host when there is one', () => {
    expect(refusedLinkTarget('data://example.com/x')).toBe('example.com');
  });

  it('names the scheme when there is no host', () => {
    expect(refusedLinkTarget('javascript:alert(1)')).toBe('javascript:');
    expect(refusedLinkTarget('data:text/html,<b>x</b>')).toBe('data:');
  });

  it('names the scheme a disguised href spells, not the disguise', () => {
    // The reader is told "javascript:", not "java\tscript" — the tab is what the
    // document hoped a filter would read, and echoing it back teaches nothing.
    expect(refusedLinkTarget('java\tscript:alert(1)')).toBe('javascript:');
    expect(refusedLinkTarget(' javascript:alert(1)')).toBe('javascript:');
  });
});

describe('schemeIsRefused', () => {
  it('judges a scheme, not a location', () => {
    expect(schemeIsRefused('https://example.com/javascript:x')).toBe(false);
    expect(schemeIsRefused('./javascript:x')).toBe(false);
  });
});
