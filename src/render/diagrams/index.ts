// Diagram source → drawn figure, before any renderer runs.
//
// A ```mermaid fence is the author's own diagram written as text, so drawing
// it is not inventing content: every label in the picture is a word from the
// fence. What this pass adds is the drawing, in the theme's own colours and
// faces, once per document, so all three renderers place the same picture:
// HTML/PDF inline the SVG (vector, its labels real text), Word embeds the PNG
// taken of that same SVG, and Markdown writes the fence back.
//
// Mermaid runs inside the Chromium the PDF already needs, with its bundle
// handed to the page as a string and every request aborted, so a diagram
// fetches nothing — the same promise pdf.ts makes for the page itself.
//
// What each type needs is in registry.ts; why, in docs/adr/.

import type { Browser } from 'playwright-core';
import type { Block, Doc } from '../../ir/types.js';
import { PAGE_PT, type Theme } from '../../theme/types.js';
import { findingLine, findings, measureScript, type Measured } from './checks.js';
import { configFor, mermaidConfig, renderOne } from './mermaid/render.js';
import { drawable, kindOf, leftToRight } from './mermaid/source.js';
import { openDiagramPage } from './page.js';
import { place, type Drawn } from './place.js';
import { typeByHead } from './registry.js';
import { diagramTokens, diagramVars } from './tokens.js';

export { diagramCss } from './mermaid/render.js';
export { drawable, hasDescription, headerLine, kindOf, leftToRight } from './mermaid/source.js';
export { REGISTRY, typeByHead, typeOf, type DiagramType } from './registry.js';
export { diagramTokens, diagramVars, distinct, type DiagramTokens } from './tokens.js';

/** The fence languages this pass draws. Anything else stays a code block. */
export const DIAGRAM_LANGS: ReadonlySet<string> = new Set(['mermaid']);

type Code = Extract<Block, { t: 'code' }>;

export const isDiagramSource = (b: Block): b is Code & { lang: string } =>
  b.t === 'code' && b.lang !== undefined && DIAGRAM_LANGS.has(b.lang.toLowerCase());

export function hasDiagrams(doc: Doc): boolean {
  return doc.blocks.some(isDiagramSource);
}

/**
 * Every diagram source in `doc` drawn and swapped for a `diagram` block; all
 * other blocks are passed through untouched. A source Mermaid cannot parse
 * stays the code block it was — its text still reaches the page — and
 * `onWarn` says which one and why, so a typo never becomes a silent gap.
 */
export async function drawDiagrams(doc: Doc, theme: Theme, browser: Browser, onWarn: (m: string) => void): Promise<Doc> {
  const sources = doc.blocks.filter(isDiagramSource);
  if (sources.length === 0) return doc;

  // The column a diagram may fill, and a page height it must leave room
  // under; a picture wider or taller is scaled down, never cropped.
  const size = PAGE_PT[theme.page.size];
  const colPt = size.w - theme.page.marginPt * 2;
  const maxHPt = (size.h - theme.page.marginPt * 2) * 0.72;
  const bodyPx = theme.type.bodyPt * 4 / 3;

  const page = await openDiagramPage(browser, theme);
  const drawn: Drawn[] = [];
  try {
    // Colours and stylesheet are worked out once per document; each diagram
    // only adds what its own type needs.
    const tokens = diagramTokens(theme);
    const vars = diagramVars(theme);
    const config = mermaidConfig(theme, vars, colPt, bodyPx);
    const fitOf = (r: { w: number; h: number }) => Math.min(1, colPt / (r.w * 0.75), maxHPt / (r.h * 0.75));
    const series = tokens.series;
    for (const [i, b] of sources.entries()) {
      const kind = kindOf(b.text);
      const cfg = configFor(kind, config, tokens, vars);
      // What no theme variable reaches is fixed in the page after drawing:
      // sankey's nodes and links take their colours from a fixed scheme,
      // journey reads its actor colours before any configuration is applied
      // (a Mermaid bug), and a gantt axis prints one label per tick however
      // close the ticks are.
      const recolor = { repaint: typeByHead(kind)?.mermaid?.repaint, series, paper: theme.colors.paper };
      let result = await renderOne(page, cfg, `dg${i}`, drawable(b.text), recolor);
      // A left-to-right flow too wide for the column is drawn again top-down,
      // and kept when that prints its labels larger: the direction is layout,
      // the words are the author's either way.
      const across = leftToRight(b.text);
      let triedDown = false;
      if (!('error' in result) && across !== null && fitOf(result) < 0.85) {
        triedDown = true;
        const down = await renderOne(page, cfg, `dg${i}`, drawable(across), recolor);
        if (!('error' in down) && fitOf(down) > fitOf(result) * 1.15) {
          onWarn(`diagram ${i + 1} (${b.lang}) is drawn top-down: left to right it would print its labels at about `
            + `${(theme.type.bodyPt * fitOf(result)).toFixed(1)}pt, top-down at ${(theme.type.bodyPt * fitOf(down)).toFixed(1)}pt`);
          result = down;
        } else {
          // The first drawing is the one kept: put it back for the screenshot
          // rather than lay it out a third time.
          await page.evaluate(`document.getElementById('host').innerHTML = ${JSON.stringify(result.svg)}`);
        }
      }
      if ('error' in result) { drawn.push(result); continue; }
      // The kept drawing is in the host: measure it as laid out and judge it.
      const type = typeByHead(kind);
      const counts = Object.fromEntries(Object.entries(type?.budget ?? {}).map(([k, b]) => [k, b.count]));
      const measured = await page.evaluate(measureScript(counts)) as Measured;
      for (const f of findings(measured, type, kind)) onWarn(findingLine(i + 1, type?.id ?? (kind || b.lang), f));
      const shot = await (await page.$('#host svg'))!.screenshot({ type: 'png', omitBackground: false });
      drawn.push({ svg: result.svg, png: `data:image/png;base64,${shot.toString('base64')}`, wPx: result.w, hPx: result.h, triedDown });
    }
  } finally {
    await page.close();
  }
  return place(doc, drawn, theme, colPt, maxHPt, onWarn, isDiagramSource);
}
