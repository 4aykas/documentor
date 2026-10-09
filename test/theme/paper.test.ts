import { describe, expect, it } from 'vitest';
import { buildHtml } from '../../src/render/html.js';
import { familyStack, themeFaceCss } from '../../src/render/fonts.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';

describe('a theme\'s paper', () => {
  it('is white unless the theme says otherwise, and must be a hex colour', async () => {
    expect(resolveTheme({}).colors.paper).toBe('#FFFFFF');
    expect(resolveTheme({ colors: { paper: '#FAF2E3' } }).colors.paper).toBe('#FAF2E3');
    expect(() => resolveTheme({ colors: { paper: 'cream' } })).toThrow(/colors\.paper/);
    expect((await loadTheme('haskoning')).colors.paper).toBe('#FAF2E3');
  });

  it('colours the sheet only for a theme that asks, so a white theme\'s stylesheet is untouched', async () => {
    const { doc } = await ingestMarkdown('# A note\n\nOne paragraph.\n');
    const cream = await buildHtml(doc, await loadTheme('haskoning'));
    expect(cream).toContain('--paper: #FAF2E3');
    expect(cream).toMatch(/html\{ background: var\(--paper\)/);
    expect(cream).toContain('.c-paper{ fill: var(--paper); }');
    const white = await buildHtml(doc, await loadTheme('plain'));
    expect(white).not.toMatch(/html\{ background/);
    expect(white).not.toContain('c-paper');
  });
});

describe('a face with a Cyrillic stand-in', () => {
  it('inlines the stand-in beside itself and names it next in the stack', async () => {
    const theme = resolveTheme({ font: { embed: 'urbanist', document: 'Urbanist' } });
    const css = await themeFaceCss(theme);
    expect(css).toContain('font-family:Urbanist');
    expect(css).toContain('font-family:Manrope');
    expect(familyStack(theme.font)).toBe('Urbanist, Manrope, Urbanist, sans-serif');
  });
});
