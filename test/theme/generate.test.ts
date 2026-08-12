import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recolourLogo, type Tokens } from '../../src/theme/generate.js';
import { findInlinePaint } from '../../src/theme/resolve.js';

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
