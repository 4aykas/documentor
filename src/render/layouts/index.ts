// A designed layout's body: the document taken apart (common.ts), placed by
// the layout the theme names, with every block drawn by the renderer's own
// block() so the words are the ordinary page's words.

import type { Block, Doc } from '../../ir/types.js';
import { PAGE_PT, PT_TO_MM, type LayoutId, type Theme } from '../../theme/types.js';
import { asGates, coverParts, plain, sections, type Ctx, type Kit, type Layout } from './common.js';
import { haskoning } from './haskoning.js';
import { rams } from './rams.js';
import { rodchenko } from './rodchenko.js';

export const LAYOUTS: Record<LayoutId, Layout> = { rams, rodchenko, haskoning };

export function layoutContext(doc: Doc, theme: Theme, kit: Kit): Ctx {
  const p = coverParts(doc);
  let gates = null;
  for (const b of p.rest) if ((gates = asGates(b, kit)) !== null) break;
  const titles = p.rest.filter((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading' && b.level === 1).map((b) => plain(b.text).replace(/^\d+(?:\.\d+)*\.?\s+/, ''));
  const pg = PAGE_PT[theme.page.size];
  return { theme, doc, kit, gates, sectionTitles: titles, pageMm: { w: Math.round(pg.w * PT_TO_MM), h: Math.round(pg.h * PT_TO_MM) } };
}

/** The stylesheet and the body of a document set in its theme's layout. */
export function layoutHtml(doc: Doc, theme: Theme, kit: Kit): { css: string; body: string } {
  const layout = LAYOUTS[theme.layout!];
  const ctx = layoutContext(doc, theme, kit);
  const p = coverParts(doc);
  const cover = doc.meta.cover === true;
  const draw = (b: Block) => {
    const g = asGates(b, kit);
    return g === null ? kit.block(b) : layout.gates(g, ctx);
  };
  const head = cover ? layout.cover(p, ctx) : layout.masthead(p, ctx);
  const extra = p.extra.map((b) => kit.block(b)).join('\n');
  const body = sections(p.rest, draw, kit).map((s) => layout.section(s, ctx)).join('\n');
  return { css: layout.css(ctx, cover), body: `${head}${extra}${body}${layout.end(p, ctx)}` };
}

export function layoutFooter(doc: Doc, theme: Theme, kit: Kit, faces: string): string {
  return LAYOUTS[theme.layout!].footer(layoutContext(doc, theme, kit), faces);
}
