import { describe, expect, it } from 'vitest';
import { arimoFaceCss } from '../../src/render/fonts.js';

describe('arimoFaceCss', () => {
  it('emits six faces, all as data URIs', async () => {
    const css = await arimoFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(css.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(6);
    // Nothing may reference a file or a network host: the renderer fetches nothing.
    expect(css).not.toMatch(/url\((?!data:)/);
  });

  it('carries a unicode-range on every face so Chromium can pick', async () => {
    const css = await arimoFaceCss();
    expect(css.match(/unicode-range:/g)).toHaveLength(6);
  });

  it('covers Ukrainian and Polish codepoints', async () => {
    const css = await arimoFaceCss();
    const ranges = [...css.matchAll(/unicode-range:([^;}]+)/g)].map((m) => m[1]!);
    const covers = (cp: number) =>
      ranges.some((r) =>
        r.split(',').some((part) => {
          const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim());
          if (!m) return false;
          const lo = parseInt(m[1]!, 16);
          const hi = m[2] ? parseInt(m[2], 16) : lo;
          return cp >= lo && cp <= hi;
        }),
      );
    for (const ch of ['і', 'ї', 'ґ', 'Ж', 'ą', 'ł', 'ż', 'ś']) {
      expect(covers(ch.codePointAt(0)!), `${ch} is not covered`).toBe(true);
    }
  });

  it('returns the same string on a second call', async () => {
    expect(await arimoFaceCss()).toBe(await arimoFaceCss());
  });
});
