import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderDocx } from '../../src/render/docx.js';
import { FACE_IDS, FACES, themeFaceCss } from '../../src/render/fonts.js';
import { buildHtml } from '../../src/render/html.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_700_000_000;
const { doc } = ingestMarkdown(
  '## Wie wir arbeiten\n\n| Posten | Betrag |\n|:--|--:|\n| A | 1 |\n',
  { title: 'Titel' },
);

describe('font roles in a theme', () => {
  it('default to the body face at 700 with no label face', () => {
    const t = resolveTheme({ id: 'x' });
    expect(t.font.heading).toEqual({ document: 'Arial', embed: 'arimo', weight: 700 });
    expect(t.font.label).toBeNull();
  });

  it('refuse a face the renderer cannot inline, naming the ones it can', () => {
    expect(() => resolveTheme({ font: { embed: 'canela' } })).toThrow(/font\.embed.*arimo, manrope, jetbrains-mono/);
    expect(() => resolveTheme({ font: { heading: { embed: 'euclid' } } })).toThrow(/font\.heading\.embed/);
    expect(() => resolveTheme({ font: { label: { document: 'X', embed: 'aeonik' } } })).toThrow(/font\.label\.embed/);
  });

  it('refuse a heading weight no face is inlined at', () => {
    expect(() => resolveTheme({ font: { heading: { weight: 300 } } })).toThrow(/font\.heading\.weight/);
  });

  it('refuse a heading weight the heading face does not ship', () => {
    expect(() => resolveTheme({ font: { heading: { weight: 800 } } })).toThrow(/font\.heading\.weight.*arimo is inlined at 400, 700/);
    expect(() => resolveTheme({ font: { heading: { embed: 'jetbrains-mono', weight: 800 } } })).toThrow(/jetbrains-mono/);
    expect(resolveTheme({ font: { heading: { embed: 'manrope', weight: 800 } } }).font.heading.weight).toBe(800);
  });
});

describe('every inlinable face', () => {
  it('carries Ukrainian and Polish letters', async () => {
    for (const id of FACE_IDS) {
      const theme = resolveTheme({ font: { embed: id } });
      const css = await themeFaceCss(theme);
      expect(css.match(/@font-face/g), id).toHaveLength(3 * FACES[id].weights.length);
      expect(css, id).not.toMatch(/url\((?!data:)/);
      const ranges = [...css.matchAll(/unicode-range:([^;}]+)/g)].map((m) => m[1]!);
      const covers = (cp: number) =>
        ranges.some((r) =>
          r.split(',').some((part) => {
            const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim());
            if (!m) return false;
            const lo = parseInt(m[1]!, 16);
            return cp >= lo && cp <= (m[2] ? parseInt(m[2], 16) : lo);
          }),
        );
      for (const ch of ['і', 'ї', 'ґ', 'Ж', 'ą', 'ł', 'ż']) expect(covers(ch.codePointAt(0)!), `${id}: ${ch}`).toBe(true);
    }
  });
});

describe('the schweiz theme', () => {
  it('inlines its body, heading and label faces, each once', async () => {
    const html = await buildHtml(doc, await loadTheme('schweiz'));
    expect(html.match(/@font-face\{font-family:Manrope;/g)).toHaveLength(9);
    expect(html.match(/@font-face\{font-family:'JetBrains Mono';/g)).toHaveLength(6);
    expect(html).not.toMatch(/font-family:Arimo/);
    expect(html).toMatch(/h1,h2,h3,\.doc-title\{ font-family: Manrope, Manrope, sans-serif; font-weight: 800; \}/);
    expect(html).toMatch(/th\{ font-family: 'JetBrains Mono', JetBrains Mono, monospace; text-transform: uppercase;/);
  });

  it('names the same faces in Word, where nothing is embedded', async () => {
    const styles = await docxPart(await renderDocx(doc, await loadTheme('schweiz'), { epochSeconds: EPOCH }), 'word/styles.xml');
    const style = (id: string) => styles.match(new RegExp(`<w:style[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] ?? '';
    expect(style('DocH2')).toMatch(/w:ascii="Manrope"/);
    expect(style('DocTableHeader')).toMatch(/w:ascii="JetBrains Mono"/);
    expect(style('DocTableHeader')).toMatch(/<w:caps\/>/);
    expect(style('DocTableHeader')).not.toMatch(/<w:b\/>/);
  });

  it('leaves a theme without roles exactly as it was', async () => {
    const plain = await loadTheme('plain');
    const html = await buildHtml(doc, plain);
    expect(html).not.toMatch(/h1,h2,h3,\.doc-title\{/);
    expect(html).toMatch(/font-family: Arimo, Arial, sans-serif;/);
    const styles = await docxPart(await renderDocx(doc, plain, { epochSeconds: EPOCH }), 'word/styles.xml');
    expect(styles).not.toMatch(/Manrope|JetBrains/);
  });
});
