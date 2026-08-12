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
