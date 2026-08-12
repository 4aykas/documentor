import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTheme, readTokens, recolourLogo, type Tokens } from '../../src/theme/generate.js';
import { findInlinePaint, resolveTheme } from '../../src/theme/resolve.js';

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
