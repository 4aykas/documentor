// TEBIN drawn in the Schweiz manner (see themes/schweiz): the same brand
// snapshot, set as a Swiss document — geometric type, uppercase monospace
// labels, black hairlines — with the wordmark and the corner glyph traced in
// a red hairline instead of filled.
//
// The outline is what makes the rest possible: a filled red block is the
// loudest thing on any page, and a page built around it has to be arranged
// around it too. A hairline weighs what a table rule weighs, so the mark sits
// in the same system as everything else and the page can stay bare.
//
// Generated like themes/tebin, from brand/tebin/ only, and guarded by the
// same in-sync test. The shapes come from the vendored vectors, never from
// coordinates typed here: the corner glyph's outline is computed from the
// two rectangles the asset draws, so a brand refresh that moves the glyph
// moves the outline with it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARK_LINE_PT, paintLines } from '../render/line-mark.js';
import { findInlinePaint } from './resolve.js';
import { readTokens, themeJson, type ThemeEntity } from './generate.js';
import { rasteriseSvg } from './rasterise.js';

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** The raster heights Word gets, ~30x the printed size for a crisp scale. */
const LOGO_PX = 480;
const CORNER_PX = 512;
const LOGO_PT = 16;
const CORNER_PT = 40;

/**
 * The rectangle an axis-aligned path draws. Refuses anything else — a curve,
 * a diagonal, a fifth corner — because the outline below is only correct for
 * rectangles, and a brand refresh that changed the glyph's shape must stop
 * the generator rather than trace something the brand never drew.
 */
export function rectOf(d: string): Rect {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let x = 0;
  let y = 0;
  let cmd = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      if (cmd === 'Z' || cmd === 'z') continue;
      i++;
    }
    const n = () => Number(tokens[i]);
    switch (cmd) {
      case 'M': x = n(); y = Number(tokens[++i]); break;
      case 'H': x = n(); break;
      case 'h': x += n(); break;
      case 'V': y = n(); break;
      case 'v': y += n(); break;
      case 'Z': case 'z': continue;
      default: throw new Error(`corner mark path uses "${cmd}"; only M, H, V, h, v and Z describe a rectangle`);
    }
    pts.push([x, y]);
  }
  const xs = [...new Set(pts.map((p) => p[0].toFixed(2)))];
  const ys = [...new Set(pts.map((p) => p[1].toFixed(2)))];
  if (xs.length !== 2 || ys.length !== 2) throw new Error(`corner mark path ${JSON.stringify(d)} is not a rectangle`);
  const [xa, xb] = xs.map(Number) as [number, number];
  const [ya, yb] = ys.map(Number) as [number, number];
  return { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
}

/**
 * The corner glyph's outline: its two bars (a horizontal one along the top,
 * a vertical one down the right) as one closed shape, so the hairline runs
 * round the L and not through the square where the bars overlap.
 */
export function cornerOutline(rects: Rect[]): string {
  if (rects.length !== 2) throw new Error(`corner mark draws ${rects.length} shapes, expected its two bars`);
  const [a, b] = rects as [Rect, Rect];
  const [bar, post] = a.x1 - a.x0 > b.x1 - b.x0 ? [a, b] : [b, a];
  const f = (n: number) => +n.toFixed(2);
  if (f(bar.y0) !== f(post.y0) || f(bar.x1) !== f(post.x1)) {
    throw new Error('corner mark bars do not share the top-right corner; the outline would not be the glyph');
  }
  return `M${f(bar.x0)},${f(bar.y0)}H${f(bar.x1)}V${f(post.y1)}H${f(post.x0)}V${f(bar.y1)}H${f(bar.x0)}Z`;
}

function pathsIn(svg: string): { d: string; cls: string | null; fill: string | null }[] {
  return [...svg.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => ({
    d: m[1]!.match(/\bd="([^"]+)"/)?.[1] ?? '',
    cls: m[1]!.match(/\bclass="([^"]+)"/)?.[1] ?? null,
    fill: m[1]!.match(/\bfill="([^"]+)"/)?.[1] ?? null,
  }));
}

/**
 * Drops a subpath's last straight segment when it ends (all but) where the
 * subpath began, so `Z` closes the shape by itself. A filled shape does not
 * care, but a stroked one does: the logo's E ends 0.81 units short of its
 * start, `Z` closes that gap with a sliver of a segment, and the mitre on a
 * sliver shoots out as a visible spur. `tolerance` is in the path's own units
 * — the logo is 166 units tall, so the default is a tenth of a printed point.
 */
export function dropClosingSegment(d: string, tolerance = 1): string {
  // How many numbers each command takes, and which of them are the end point.
  const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 };
  return d.replace(/M[^Z]*Z/gi, (sub) => {
    const tokens = sub.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let x = 0;
    let y = 0;
    let start: [number, number] = [0, 0];
    let lastCmdAt = -1;
    let commands = 0;
    for (let i = 0; i < tokens.length;) {
      const cmd = tokens[i]!;
      if (!/[A-Za-z]/.test(cmd)) return sub; // implicit repeats: not worth guessing
      if (cmd === 'Z' || cmd === 'z') break;
      const n = ARITY[cmd.toUpperCase()];
      if (n === undefined) return sub; // an arc or anything else: leave it alone
      const args = tokens.slice(i + 1, i + 1 + n).map(Number);
      if (args.length !== n || args.some(Number.isNaN)) return sub;
      lastCmdAt = i;
      commands++;
      const rel = cmd === cmd.toLowerCase();
      const up = cmd.toUpperCase();
      if (up === 'H') x = rel ? x + args[0]! : args[0]!;
      else if (up === 'V') y = rel ? y + args[0]! : args[0]!;
      else {
        const ex = args[n - 2]!;
        const ey = args[n - 1]!;
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
      }
      if (up === 'M') start = [x, y];
      i += 1 + n;
    }
    const last = tokens[lastCmdAt]?.toUpperCase();
    const back = Math.hypot(x - start[0], y - start[1]) <= tolerance;
    const straight = last === 'H' || last === 'V' || last === 'L';
    // Only a straight final segment: a curve that returns to the start is
    // part of the shape, and dropping it would flatten it.
    if (!back || !straight || commands < 2) return sub;
    // Cut the source text at the last command's letter, so everything kept is
    // byte-for-byte the brand's own path.
    const letters = [...sub.matchAll(/[A-Za-z]/g)];
    const at = letters[commands - 1]?.index;
    return at === undefined ? sub : `${sub.slice(0, at)}${sub.slice(-1)}`;
  });
}

/** The SVG namespace, carried over from the asset rather than typed here. */
function namespaceOf(svg: string): string {
  const ns = svg.match(/<svg\b[^>]*\bxmlns="([^"]+)"/)?.[1];
  if (!ns) throw new Error('brand SVG declares no xmlns');
  return ns;
}

/** Grows a viewBox so a stroke centred on the shape's edge is not clipped. */
function padded(viewBox: string, pad: number): string {
  const [x, y, w, h] = viewBox.trim().split(/[\s,]+/).map(Number) as [number, number, number, number];
  const f = (n: number) => +n.toFixed(2);
  return `${f(x - pad)} ${f(y - pad)} ${f(w + 2 * pad)} ${f(h + 2 * pad)}`;
}

/** Half the hairline, in the viewBox's own units at `heightPt`, plus a hair. */
function padFor(viewBox: string, heightPt: number): number {
  const h = Number(viewBox.trim().split(/[\s,]+/)[3]);
  return +((MARK_LINE_PT / 2 / (heightPt / h)) * 1.5).toFixed(2);
}

export function outlineCornerMark(svg: string, heightPt: number): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error('corner mark has no viewBox');
  const d = cornerOutline(pathsIn(svg).map((p) => rectOf(p.d)));
  return `<svg xmlns="${namespaceOf(svg)}" viewBox="${padded(viewBox, padFor(viewBox, heightPt))}"><path class="c-line" d="${d}"/></svg>`;
}

/**
 * The wordmark traced: the brand-red letters in the brand line, the grey ones
 * in the muted line, and the trailing corner glyph (the logo's last two
 * paths, drawn in its `<g>`) replaced by the same single outline the cover
 * uses, so the two marks cannot disagree.
 */
export function outlineLogo(svg: string, cornerSvg: string, heightPt: number): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error('logo has no viewBox');
  const styles = new Map<string, string>();
  for (const m of svg.matchAll(/\.([\w-]+)\s*\{\s*fill:\s*(#[0-9a-fA-F]{6})/g)) styles.set(m[1]!, m[2]!.toUpperCase());

  const cornerDs = new Set(pathsIn(cornerSvg).map((p) => p.d));
  const letters = pathsIn(svg).filter((p) => !cornerDs.has(p.d));
  if (letters.length !== pathsIn(svg).length - cornerDs.size) {
    throw new Error('the logo does not carry the corner glyph as its own paths; the outline would draw it twice');
  }
  const corner = cornerOutline(pathsIn(cornerSvg).map((p) => rectOf(p.d)));
  const cls = (p: { cls: string | null }) => {
    const colour = p.cls === null ? undefined : styles.get(p.cls);
    if (colour === '#DA291C') return 'c-line';
    if (colour === '#898D8D') return 'c-line-muted';
    throw new Error(`logo path paints ${colour ?? 'nothing'}; expected the brand red or grey`);
  };
  const paths = [
    ...letters.map((p) => `<path class="${cls(p)}" d="${dropClosingSegment(p.d)}"/>`),
    `<path class="c-line" d="${corner}"/>`,
  ];
  return `<svg xmlns="${namespaceOf(svg)}" viewBox="${padded(viewBox, padFor(viewBox, heightPt))}">${paths.join('')}</svg>`;
}

const SCHWEIZ = {
  id: (entity: ThemeEntity) => `${entity.id}-schweiz`,
  name: (entity: ThemeEntity) => entity.name.replace(/^TEBIN/, 'TEBIN Schweiz'),
};

/** One entity's TEBIN Schweiz theme, as the exact JSON text on disk. */
export async function tebinSchweizThemeJson(brandDir: string, entity: ThemeEntity): Promise<string> {
  const [dtcg, logoSrc, cornerSrc] = await Promise.all([
    readFile(join(brandDir, 'tokens.dtcg.json'), 'utf8'),
    readFile(join(brandDir, 'logo-full.svg'), 'utf8'),
    readFile(join(brandDir, 'corner-mark.svg'), 'utf8'),
  ]);
  const tokens = readTokens(dtcg);
  const token = (name: string) => {
    const v = tokens[name];
    if (v === undefined) throw new Error(`brand token ${name} is missing`);
    return v;
  };
  const brand = token('brand');
  const ink = token('ink');
  // The brand's grey (#898D8D) is 3.4:1 on white, under AA for the small
  // monospace labels this theme sets in it. Same hue, darkened to 5.7:1 —
  // a choice of this theme, named in notFromBrand below, not a brand colour.
  const muted = '#666969';
  const colours = { brand, muted, ink };

  const logo = outlineLogo(logoSrc.replace(/\r\n/g, '\n'), cornerSrc, LOGO_PT);
  const corner = outlineCornerMark(cornerSrc.replace(/\r\n/g, '\n'), CORNER_PT);
  for (const [what, svg] of [['logo', logo], ['corner mark', corner]] as const) {
    const paint = findInlinePaint(svg);
    if (paint) throw new Error(`outlined ${what} carries inline paint: ${paint.where}`);
  }
  const [logoPng, cornerPng] = await Promise.all([
    rasteriseSvg(paintLines(logo, colours, LOGO_PX / LOGO_PT), LOGO_PX),
    rasteriseSvg(paintLines(corner, colours, CORNER_PX / CORNER_PT), CORNER_PX),
  ]);

  return themeJson({
    id: SCHWEIZ.id(entity),
    name: SCHWEIZ.name(entity),
    $generated: {
      by: 'npm run theme:tebin',
      source: 'tebin-classic',
      version: '1.0.0',
      variant: 'schweiz',
      notFromBrand: ['colors.muted', 'font', 'page', 'type', 'letterhead', 'logo.heightPt', 'cornerMark.heightPt', 'coverStatement'],
    },
    colors: { brandOnLight: brand, brandOnDark: null, ink, muted, rule: ink, title: ink },
    font: {
      document: 'Manrope',
      embed: 'manrope',
      heading: { document: 'Manrope', embed: 'manrope', weight: 800 },
      label: { document: 'JetBrains Mono', embed: 'jetbrains-mono', uppercase: true },
    },
    logo: { svg: logo, heightPt: LOGO_PT, png: `data:image/png;base64,${logoPng.toString('base64')}` },
    cornerMark: { svg: corner, heightPt: CORNER_PT, png: `data:image/png;base64,${cornerPng.toString('base64')}` },
    page: { size: 'A4', marginPt: 56 },
    type: { bodyPt: 9.5, leading: 1.5, titlePt: 34, h1Pt: 24, h2Pt: 14, h3Pt: 10.5, smallPt: 7.5 },
    letterhead: entity.letterhead,
    // A tinted fill behind the cover's statement would be the one filled
    // shape on a page that otherwise draws only lines.
    coverStatement: 'line',
  });
}

export const tebinSchweizId = SCHWEIZ.id;
