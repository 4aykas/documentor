import { describe, expect, it } from 'vitest';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';

describe('resolveTheme', () => {
  it('fills defaults for everything a theme omits', () => {
    const t = resolveTheme({ id: 'x', colors: { ink: '#000000' } });
    expect(t.page.marginPt).toBe(48);
    expect(t.type.bodyPt).toBe(10);
    expect(t.colors.ink).toBe('#000000');
  });

  it('rejects a colour that is not a six-digit hex', () => {
    expect(() => resolveTheme({ id: 'x', colors: { ink: 'red' } })).toThrow(/colors\.ink/);
    expect(() => resolveTheme({ id: 'x', colors: { ink: '#abc' } })).toThrow(/colors\.ink/);
  });

  it('keeps brandOnDark null rather than falling back to the light value', () => {
    const t = resolveTheme({ id: 'x', colors: { brandOnLight: '#DA291C' } });
    expect(t.colors.brandOnDark).toBeNull();
  });

  it('rejects a page size it cannot lay out', () => {
    expect(() => resolveTheme({ id: 'x', page: { size: 'B7' } })).toThrow(/page\.size/);
  });

  it('rejects a margin that leaves no text column', () => {
    expect(() => resolveTheme({ id: 'x', page: { marginPt: 400 } })).toThrow(/marginPt/);
  });

  it('loads the bundled plain theme by id', async () => {
    const t = await loadTheme('plain');
    expect(t.id).toBe('plain');
    expect(t.logo).toBeNull();
    expect(t.page.size).toBe('A4');
  });

  it('says which theme it could not find', async () => {
    await expect(loadTheme('nope')).rejects.toThrow(/nope/);
  });

  it('accepts a logo svg that paints by class only', () => {
    const t = resolveTheme({
      id: 'x',
      logo: { svg: '<svg><path class="mark" d="M0 0" /></svg>' },
    });
    expect(t.logo?.svg).toContain('class="mark"');
  });

  it('rejects a logo with an inline fill attribute, including fill="none"', () => {
    expect(() =>
      resolveTheme({ id: 'x', logo: { svg: '<svg><path fill="none" d="M0 0" /></svg>' } }),
    ).toThrow(/logo\.svg/);
  });

  it('rejects a logo with an inline stroke attribute', () => {
    expect(() =>
      resolveTheme({ id: 'x', logo: { svg: '<svg><path stroke="#000000" d="M0 0" /></svg>' } }),
    ).toThrow(/logo\.svg/);
  });

  it('rejects a logo with fill smuggled through a style attribute', () => {
    expect(() =>
      resolveTheme({ id: 'x', logo: { svg: '<svg><path style="fill:#000000" d="M0 0" /></svg>' } }),
    ).toThrow(/logo\.svg/);
  });

  it('rejects a logo with paint declared in an embedded <style> element', () => {
    expect(() =>
      resolveTheme({
        id: 'x',
        logo: { svg: '<svg><style>.mark { fill: #000000; }</style><path class="mark" d="M0 0" /></svg>' },
      }),
    ).toThrow(/logo\.svg/);
  });
});
