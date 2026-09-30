import { describe, expect, it } from 'vitest';
import { summarise, toHex, type TextSample } from '../../src/theme/capture.js';
import { runTheme } from '../../src/cli/theme.js';

const t = (o: Partial<TextSample>): TextSample => ({
  tag: 'p', family: 'Body', sizePx: 16, weight: 400, italic: false, color: 'rgb(0, 0, 0)', chars: 10, ...o,
});

const base = { url: 'https://example.com', capturedAt: null, viewport: { width: 1440, height: 900 }, declaredFaces: [] };

describe('toHex', () => {
  it('reads rgb() and rgba() as the browser serialises them', () => {
    expect(toHex('rgb(246, 191, 223)')).toBe('#F6BFDF');
    expect(toHex('rgba(0, 0, 0, 0.9)')).toBe('#000000');
  });

  it('refuses a colour that is barely painted rather than inventing a blend', () => {
    expect(toHex('rgba(0, 0, 0, 0.1)')).toBeNull();
    expect(toHex('transparent')).toBeNull();
  });
});

describe('summarise', () => {
  it('weights families by the characters they carry, not by element count', () => {
    const c = summarise({
      ...base,
      backgrounds: [],
      text: [t({ family: 'Mono', chars: 5 }), t({ family: 'Mono', chars: 5 }), t({ family: 'Sans', chars: 90 })],
    });
    expect(c.fonts.map((f) => [f.family, f.share])).toEqual([['Sans', 0.9], ['Mono', 0.1]]);
  });

  it('takes the body as one (family, size, colour) combination', () => {
    // Most text is Sans; most text is 30px — but no Sans is 30px. Picking the
    // modal family and the modal size separately would pair them anyway.
    const c = summarise({
      ...base,
      backgrounds: [],
      text: [
        t({ family: 'Sans', sizePx: 16, chars: 40 }),
        t({ family: 'Sans', sizePx: 18, chars: 20 }),
        t({ family: 'Serif', sizePx: 30, chars: 45 }),
      ],
    });
    expect(c.fonts[0]!.family).toBe('Sans');
    expect(c.body).toEqual({ family: 'Serif', sizePx: 30, color: '#000000' });
  });

  it('shares backgrounds by painted area and drops transparent fills', () => {
    const c = summarise({
      ...base,
      text: [],
      backgrounds: [
        { color: 'rgb(242, 242, 242)', areaPx: 300 },
        { color: 'rgb(0, 0, 0)', areaPx: 100 },
        { color: 'rgba(0, 0, 0, 0)', areaPx: 10_000 },
      ],
    });
    expect(c.backgrounds).toEqual([{ hex: '#F2F2F2', share: 0.75 }, { hex: '#000000', share: 0.25 }]);
    expect(c.body).toBeNull();
  });

  it('records the first h1..h3 as the page drew them', () => {
    const c = summarise({
      ...base,
      backgrounds: [],
      text: [t({ tag: 'h2', family: 'Display', sizePx: 53, weight: 700 }), t({ tag: 'h2', sizePx: 20 })],
    });
    expect(c.headings['h2']).toEqual({ family: 'Display', sizePx: 53, weight: 700 });
    expect(c.headings['h1']).toBeUndefined();
  });
});

describe('documentor theme', () => {
  const io = () => {
    const err: string[] = [];
    return { err, io: { log: () => {}, err: (s: string) => err.push(s) } };
  };

  it('is a usage error without an http(s) URL', async () => {
    const { err, io: sink } = io();
    expect(await runTheme(['capture', 'rosarot.ch', '--name', 'x'], sink)).toBe(2);
    expect(err.join('\n')).toMatch(/http\(s\) URL/);
  });

  it('is a usage error without a theme id, or with one that is not an id', async () => {
    const { io: sink } = io();
    expect(await runTheme(['capture', 'https://example.com'], sink)).toBe(2);
    expect(await runTheme(['capture', 'https://example.com', '--name', 'Schweiz Theme'], sink)).toBe(2);
  });

  it('is a usage error for an unknown subcommand', async () => {
    const { err, io: sink } = io();
    expect(await runTheme(['generate'], sink)).toBe(2);
    expect(err.join('\n')).toMatch(/unknown theme command/);
  });
});
