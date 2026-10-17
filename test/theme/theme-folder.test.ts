import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { familyStack, themeFaceCss } from '../../src/render/fonts.js';
import { buildHtml } from '../../src/render/html.js';
import { loadTheme, locateTheme } from '../../src/theme/resolve.js';

// ADR 0011: a theme is a folder, found by path or, by id, in the package's
// themes/ and then in DOCUMENTOR_THEMES. The folder under test is the example
// the package ships, so the example stays working.

const FIXTURE = fileURLToPath(new URL('../../templates/theme-example/', import.meta.url));
const SAVED = process.env['DOCUMENTOR_THEMES'];
afterEach(() => { process.env['DOCUMENTOR_THEMES'] = SAVED; });

/** A copy of the fixture folder, its theme.json edited, to test a refusal. */
function variant(edit: (t: Record<string, unknown>) => void, name = 'variant'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'documentor-theme-')), name);
  cpSync(FIXTURE, dir, { recursive: true });
  const t = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) as Record<string, unknown>;
  t['id'] = name;
  edit(t);
  writeFileSync(join(dir, 'theme.json'), JSON.stringify(t));
  return dir;
}

describe('a theme folder', () => {
  it('is found by id in DOCUMENTOR_THEMES, by its folder, and by its theme.json', async () => {
    process.env['DOCUMENTOR_THEMES'] = join(FIXTURE, '..');
    for (const ref of ['theme-example', FIXTURE, join(FIXTURE, 'theme.json')]) {
      const t = await loadTheme(ref);
      expect(t.id).toBe('theme-example');
    }
  });

  it('embeds a face of its own from its fonts/, with the Cyrillic stand-in it names', async () => {
    const t = await loadTheme(FIXTURE);
    expect(t.font.label?.face.family).toBe('Example Mono');
    expect(familyStack(t.font.label!, 'monospace')).toBe("'Example Mono', Manrope, Courier New, monospace");
    const css = await themeFaceCss(t);
    const own = readFileSync(join(FIXTURE, 'fonts/example-mono-400.woff2')).toString('base64');
    expect(css).toContain(`font-family:'Example Mono';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${own}) format('woff2')}`);
    expect(css).toContain('font-family:Manrope;');
  });

  it('reads its logo from a file in the folder', async () => {
    expect((await loadTheme(FIXTURE)).logo?.svg).toContain('class="c-brand"');
  });

  it('sets the PDF in its own layout module, handed the kit and the context', async () => {
    const { doc } = ingestMarkdown('# T\n\nA line.\n\n<!-- pagebreak -->\n\n## 1. Alpha\n\nx\n\n## 2. Beta\n\ny\n', { cover: true });
    const html = await buildHtml(doc, await loadTheme(FIXTURE));
    expect(html).toContain('<li><b>1.</b><span>Alpha</span></li><li><b>2.</b><span>Beta</span></li>');
    expect(html).toContain('.ft-cover{ min-height: 100mm }');
  });

  it('refuses a face with no licence, or no word on its Cyrillic', async () => {
    await expect(loadTheme(variant((t) => { delete (t['faces'] as any)['example-mono'].license; }))).rejects.toThrow(/faces\.example-mono\.license/);
    await expect(loadTheme(variant((t) => { delete (t['faces'] as any)['example-mono'].cyrillic; }))).rejects.toThrow(/faces\.example-mono\.cyrillic/);
    await expect(loadTheme(variant((t) => { (t['faces'] as any)['example-mono'].cyrillic = 'urbanist'; }))).rejects.toThrow(/carries its Cyrillic/);
  });

  it('refuses a face that takes a built-in face\'s id', async () => {
    await expect(loadTheme(variant((t) => { t['faces'] = { inter: (t['faces'] as any)['example-mono'] }; }))).rejects.toThrow(/inter is a built-in face/);
  });

  it('refuses a path that leaves the folder, or names a file that is not there', async () => {
    await expect(loadTheme(variant((t) => { (t['logo'] as any).svg = '../logo.svg'; }))).rejects.toThrow(/leaves the theme's folder/);
    await expect(loadTheme(variant((t) => { (t['faces'] as any)['example-mono'].files = { 400: 'fonts/none.woff2' }; }))).rejects.toThrow(/is not in the theme's folder/);
  });

  it('refuses an id that is not its folder\'s name', async () => {
    const dir = variant(() => {}, 'named');
    const t = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
    writeFileSync(join(dir, 'theme.json'), JSON.stringify({ ...t, id: 'other' }));
    await expect(loadTheme(dir)).rejects.toThrow(/"other" is not the name of its folder, "named"/);
  });

  it('refuses a layout written for another kit', async () => {
    const dir = variant(() => {}, 'old-kit');
    const file = join(dir, 'layout.mts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('layoutApi = 1', 'layoutApi = 0'));
    await expect(loadTheme(dir)).rejects.toThrow(/written for layout kit 0, and this documentor hands kit 1/);
  });

  it('refuses an id found in more than one place, rather than choosing', () => {
    const dir = variant(() => {}, 'plain');
    process.env['DOCUMENTOR_THEMES'] = join(dir, '..');
    expect(() => locateTheme('plain')).toThrow(/is in more than one place/);
  });
});
