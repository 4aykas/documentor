// Brand tokens + the published assets → a documentor theme. Pure: the caller
// reads the snapshot and writes the result, so this file has no filesystem and
// no network of its own and can be tested with a string.

import { findInlinePaint } from './resolve.js';

/** A flat token name → hex map, lifted out of the DTCG file. */
export type Tokens = Record<string, string>;

/**
 * Which semantic class a brand token becomes in a logo. The host stylesheet
 * (see the .logo rules in render/html.ts) paints these from the theme's own
 * colours, which is what stops the mark drifting from the document around it.
 */
const CLASS_FOR_TOKEN: Record<string, string> = {
  brand: 'c-brand',
  grey: 'c-muted',
  ink: 'c-ink',
};

/**
 * The published logo paints through an embedded <style> element:
 *
 *   .cls-1 { fill: #898D8D; }  .cls-2 { fill: #DA291C; }
 *
 * which is exactly the inline paint a theme may not carry — it silently beats
 * the class, so the mark would stop following the theme with nothing visible to
 * explain why. This reads that map, attributes every colour to a brand token,
 * renames the classes to the semantic ones, and deletes the <style> element.
 *
 * A colour that matches no token throws, naming the colour. Guessing here would
 * reintroduce precisely the drift the generated theme exists to prevent.
 */
export function recolourLogo(svg: string, tokens: Tokens): string {
  const byColour = new Map<string, string>();
  for (const [name, value] of Object.entries(tokens)) {
    const cls = CLASS_FOR_TOKEN[name];
    if (cls) byColour.set(value.toLowerCase(), cls);
  }

  const rename = new Map<string, string>();
  for (const styleEl of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of (styleEl[1] ?? '').matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const declared = rule[2] ?? '';
      const paint = declared.match(/\b(?:fill|stroke)\s*:\s*(#[0-9a-fA-F]{6})/);
      if (!paint) continue;
      const colour = paint[1]!;
      const semantic = byColour.get(colour.toLowerCase());
      if (!semantic) {
        throw new Error(
          `logo colour ${colour} (class .${rule[1]}) matches no brand token — add it to the token source or fix the asset; the generator will not guess a class for it`,
        );
      }
      rename.set(rule[1]!, semantic);
    }
  }

  let out = svg
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<defs>\s*<\/defs>\s*/gi, '');
  for (const [from, to] of rename) {
    out = out.replace(new RegExp(`class="${from}"`, 'g'), `class="${to}"`);
  }
  out = out.trim();

  const leftover = findInlinePaint(out);
  if (leftover) {
    throw new Error(`recoloured logo still carries inline paint: ${leftover.where} (${leftover.found})`);
  }
  return out;
}

/**
 * The DTCG file groups tokens by type; a theme wants a flat lookup. Group and
 * name are joined with a dash for everything but colours, which are the common
 * case and keep their bare names: `brand`, `grey-lighter`, `font-document`.
 */
export function readTokens(dtcgJson: string): Tokens {
  const parsed = JSON.parse(dtcgJson) as Record<string, Record<string, { $value?: unknown }>>;
  const out: Tokens = {};
  for (const [group, members] of Object.entries(parsed)) {
    for (const [name, token] of Object.entries(members)) {
      const value = token.$value;
      const flat = Array.isArray(value) ? value[0] : value;
      if (typeof flat !== 'string') continue;
      out[group === 'color' ? name : `${group}-${name}`] = flat;
    }
  }
  if (!out['brand']) {
    throw new Error('token source carries no color.brand — this is not a brand token file, and the generator will not default a brand colour');
  }
  return out;
}

/** Fails loudly rather than falling back: an absent token is a snapshot problem. */
function token(tokens: Tokens, name: string): string {
  const v = tokens[name];
  if (!v) throw new Error(`token source carries no ${name}`);
  return v;
}

/**
 * The letterhead, the page geometry and the type scale have no brand token
 * behind them — the 2017 brand book does not price them. They are the theme
 * author's, and `$generated.notFromBrand` says so in the file itself, the same
 * way the brand pack marks `ink` and `topbar` as not specified in the book.
 */
const LETTERHEAD = [
  'TEBIN.PRO Sp. z o.o.',
  'Plac Hołdu Pruskiego 9, 70-550 Szczecin, Poland',
  'www.tebin.pro | info@tebin.pro',
  'NIP: 9552562516 | REGON: 521434962',
];

export function buildTheme(args: {
  tokens: Tokens;
  logoSvg: string;
  logoPngBase64: string;
  sourceId: string;
  sourceVersion: string;
}): unknown {
  const { tokens } = args;
  return {
    id: 'tebin',
    name: 'TEBIN',
    $generated: {
      by: 'npm run theme:tebin',
      source: args.sourceId,
      version: args.sourceVersion,
      // Everything the brand does not decide, named here so a reader of this
      // file can tell authority from taste without going to look.
      notFromBrand: ['page', 'type', 'letterhead', 'logo.heightPt'],
    },
    colors: {
      // A fill colour, and large display type. Not a small-text colour: no
      // single red clears AA on both a light and a dark surface, and the brand
      // publishes a separate #C7251A for red text on white.
      brandOnLight: token(tokens, 'brand'),
      // The brand publishes one red. A renderer needing a dark-surface red must
      // fail loudly rather than reuse this one.
      brandOnDark: null,
      ink: token(tokens, 'ink'),
      muted: token(tokens, 'grey'),
      rule: token(tokens, 'grey-lighter'),
    },
    font: { document: token(tokens, 'font-document'), embed: 'arimo' },
    logo: {
      svg: recolourLogo(args.logoSvg, tokens),
      heightPt: 11,
      png: `data:image/png;base64,${args.logoPngBase64}`,
    },
    page: { size: 'A4', marginPt: 48 },
    type: { bodyPt: 10, leading: 1.45, h1Pt: 18, h2Pt: 13, h3Pt: 11, smallPt: 8 },
    letterhead: LETTERHEAD,
  };
}

/** One serialisation, so the writer and the in-sync test cannot disagree. */
export function themeJson(theme: unknown): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}
