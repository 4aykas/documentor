import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLASS_FOR_TOKEN, buildTheme, readTokens, recolourCornerMark, recolourLogo, type Tokens } from '../../src/theme/generate.js';
import { findInlinePaint, resolveTheme } from '../../src/theme/resolve.js';
import { buildHtml } from '../../src/render/html.js';

const BRAND = join(fileURLToPath(new URL('../../', import.meta.url)), 'brand', 'tebin');
const TOKENS: Tokens = { brand: '#DA291C', grey: '#898D8D', ink: '#1A1A1A' };

describe('recolourLogo', () => {
  const published = readFileSync(join(BRAND, 'logo-full.svg'), 'utf8');

  it('replaces the published classes with semantic ones', () => {
    const out = recolourLogo(published, TOKENS);
    expect(out).toContain('class="c-brand"');
    expect(out).toContain('class="c-muted"');
    expect(out).not.toContain('cls-1');
    expect(out).not.toContain('cls-2');
  });

  it('leaves nothing resolveTheme would refuse', () => {
    // The generator applies the resolver's own check rather than a copy of it:
    // a logo that the generator accepts and the resolver rejects is the worst
    // of both, because it fails at load time in someone else's project.
    expect(findInlinePaint(recolourLogo(published, TOKENS))).toBeNull();
  });

  it('drops the XML prolog, which is invalid inside an HTML document', () => {
    expect(recolourLogo(published, TOKENS)).not.toContain('<?xml');
  });

  it('is deterministic', () => {
    expect(recolourLogo(published, TOKENS)).toBe(recolourLogo(published, TOKENS));
  });

  it('names a colour it cannot attribute to a token, instead of guessing', () => {
    const svg = '<svg><defs><style>.cls-1 { fill: #00FF00; }</style></defs><path class="cls-1" d="M0 0"/></svg>';
    expect(() => recolourLogo(svg, TOKENS)).toThrow(/#00FF00/);
  });

  it('matches a token colour whatever case it is written in', () => {
    const svg = '<svg><defs><style>.cls-1 { fill: #da291c; }</style></defs><path class="cls-1" d="M0 0"/></svg>';
    expect(recolourLogo(svg, TOKENS)).toContain('class="c-brand"');
  });

  it('produces byte-identical output whether the source SVG has CRLF or LF line endings', () => {
    // This is what catches a checkout, an export, or an editor handing the
    // generator CRLF: without the normalisation in recolourLogo, a CRLF
    // source embeds \r\n escapes into the theme's JSON string that an LF
    // source does not, so the same brand assets produce different bytes
    // depending on how they reached disk. See
    // docs/superpowers/notes/2026-08-12-phase-2-residuals.md.
    const crlf = published.replace(/\n/g, '\r\n');
    expect(recolourLogo(crlf, TOKENS)).toBe(recolourLogo(published, TOKENS));
  });
});

describe('recolourCornerMark', () => {
  const published = readFileSync(join(BRAND, 'corner-mark.svg'), 'utf8');

  it('replaces the fill attribute with a semantic class', () => {
    const out = recolourCornerMark(published, TOKENS);
    expect(out).toContain('class="c-brand"');
    expect(out).not.toContain('fill=');
  });

  it('leaves nothing resolveTheme would refuse', () => {
    expect(findInlinePaint(recolourCornerMark(published, TOKENS))).toBeNull();
  });

  it('names a colour it cannot attribute to a token, instead of guessing', () => {
    const svg = '<svg><path fill="#00FF00" d="M0 0"/></svg>';
    expect(() => recolourCornerMark(svg, TOKENS)).toThrow(/#00FF00/);
  });

  it('is deterministic', () => {
    expect(recolourCornerMark(published, TOKENS)).toBe(recolourCornerMark(published, TOKENS));
  });
});

describe('the generator and the stylesheet', () => {
  it('emits no logo class the stylesheet leaves unpainted', async () => {
    // The two halves of one contract: generate.ts decides which class a brand
    // token becomes, html.ts decides what that class paints. Nothing in the
    // type system connects them, and the failure is invisible in every check
    // that does exist — an unpainted class is valid SVG that renders in the
    // initial fill, solid black, which is exactly what html.ts's own comment
    // says means the stylesheet did not load.
    //
    // Both sides are derived, never listed: a test naming the three classes by
    // hand would go stale the same way the stylesheet did, and would then
    // agree with itself while the two files disagreed.
    const emitted = new Set(Object.values(CLASS_FOR_TOKEN));
    const css = await buildHtml(
      { meta: { title: 'T', lang: 'en' }, blocks: [] },
      resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } }),
    );
    const painted = new Set([...css.matchAll(/\.logo\s+\.([\w-]+)\s*\{/g)].map((m) => m[1]!));
    expect(painted.size, 'no .logo rules found — the extraction, not the stylesheet, is what broke').toBeGreaterThan(0);
    for (const cls of emitted) {
      expect(
        painted.has(cls),
        `the generator can emit class="${cls}" but render/html.ts paints no .logo .${cls} rule — a brand asset using it would print solid black`,
      ).toBe(true);
    }
  });
});

describe('readTokens', () => {
  it('flattens the DTCG colour and font groups', () => {
    const dtcg = readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8');
    const tokens = readTokens(dtcg);
    expect(tokens['brand']).toBe('#DA291C');
    expect(tokens['grey']).toBe('#898D8D');
    expect(tokens['ink']).toBe('#1A1A1A');
    expect(tokens['grey-lighter']).toBe('#CDCDCE');
    expect(tokens['font-document']).toBe('Arial');
  });

  it('refuses a token file with no brand colour rather than defaulting one', () => {
    expect(() => readTokens('{"color":{"ink":{"$type":"color","$value":"#1A1A1A"}}}')).toThrow(/brand/);
  });
});

describe('buildTheme', () => {
  const built = () =>
    buildTheme({
      tokens: readTokens(readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8')),
      logoSvg: readFileSync(join(BRAND, 'logo-full.svg'), 'utf8'),
      logoPngBase64: readFileSync(join(BRAND, 'logo-full.png')).toString('base64'),
      cornerMarkSvg: readFileSync(join(BRAND, 'corner-mark.svg'), 'utf8'),
      cornerMarkPngBase64: readFileSync(join(BRAND, 'corner-mark.png')).toString('base64'),
      sourceId: 'tebin-classic',
      sourceVersion: '1.0.0',
    });

  it('maps every colour from a brand token, inventing none', () => {
    const t = resolveTheme(built());
    expect(t.colors.brandOnLight).toBe('#DA291C');
    expect(t.colors.ink).toBe('#1A1A1A');
    expect(t.colors.muted).toBe('#898D8D');
    expect(t.colors.rule).toBe('#CDCDCE');
    expect(t.font.document).toBe('Arial');
  });

  it('leaves brandOnDark null, because the brand publishes no second red', () => {
    expect(resolveTheme(built()).colors.brandOnDark).toBeNull();
  });

  it('produces a theme the resolver accepts, logo and all', () => {
    const t = resolveTheme(built());
    expect(t.logo?.svg).toContain('c-brand');
    expect(t.logo?.png?.startsWith('data:image/png;base64,')).toBe(true);
    expect(t.letterhead[0]).toBe('TEBIN.PRO Sp. z o.o.');
  });

  it('records which fields the brand did not decide', () => {
    const t = built() as { $generated: { source: string; version: string; notFromBrand: string[] } };
    expect(t.$generated.source).toBe('tebin-classic');
    expect(t.$generated.version).toBe('1.0.0');
    expect(t.$generated.notFromBrand).toContain('page');
    expect(t.$generated.notFromBrand).toContain('type');
    expect(t.$generated.notFromBrand).toContain('letterhead');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(built())).toBe(JSON.stringify(built()));
  });
});
