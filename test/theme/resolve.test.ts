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
});
