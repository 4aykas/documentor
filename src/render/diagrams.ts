// Mermaid source → drawn figure, before any renderer runs.
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

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright-core';
import type { Block, Doc } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { FACES, familyStack, themeFaceCss } from './fonts.js';
import { readableOn } from './tint.js';
import { blockNonDataRequests } from './pdf.js';

/** The fence languages this pass draws. Anything else stays a code block. */
export const DIAGRAM_LANGS: ReadonlySet<string> = new Set(['mermaid']);

type Code = Extract<Block, { t: 'code' }>;

export const isDiagramSource = (b: Block): b is Code & { lang: string } =>
  b.t === 'code' && b.lang !== undefined && DIAGRAM_LANGS.has(b.lang.toLowerCase());

export function hasDiagrams(doc: Doc): boolean {
  return doc.blocks.some(isDiagramSource);
}

/** Pixels Word and the screenshot are taken at, per CSS pixel. Three keeps a
 *  diagram's smallest label sharp on a printed Word page. */
const PNG_SCALE = 3;

/** `a` blended toward `b`: t=1 is `a`, t=0 is `b`. Per-channel sRGB, as tint.ts. */
function mix(a: string, b: string, t: number): string {
  const n = (h: string) => parseInt(h.replace('#', ''), 16);
  const [x, y] = [n(a), n(b)];
  const ch = (s: number) => Math.round(((x >> s) & 0xff) * t + ((y >> s) & 0xff) * (1 - t)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (s: number) => {
    const c = ((n >> s) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
}

/**
 * Mermaid's `base` theme variables, read off the theme. Nodes are the brand
 * tinted toward the sheet and edged in the brand; lines are the theme's muted
 * ink; the branch scale a mindmap, timeline or pie paints with runs from the
 * brand at full strength toward the sheet, so every diagram in a document is
 * one hue, the way the heatmap is. Each fill's label colour is computed by
 * contrast rather than assumed. On a dark sheet the brand is brandOnDark when
 * the theme has one: the light-sheet brand on near-black is what that field's
 * own comment warns against.
 */
export function diagramVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  const paper = c.paper;
  const dark = luminance(paper) < 0.2;
  const brand = dark ? c.brandOnDark ?? c.brandOnLight : c.brandOnLight;
  const ink = c.ink;
  const tint = (t: number) => mix(brand, paper, t);
  const label = (fill: string) => readableOn(fill, ink) === ink ? ink : (dark ? '#000000' : '#FFFFFF');
  const node = tint(0.12);
  const v: Record<string, string> = {
    background: paper,
    fontFamily: familyStack(theme.font),
    fontSize: `${(theme.type.bodyPt * 4 / 3).toFixed(1)}px`,
    primaryColor: node, primaryBorderColor: brand, primaryTextColor: ink,
    secondaryColor: tint(0.24), secondaryBorderColor: brand, secondaryTextColor: ink,
    tertiaryColor: mix(c.muted, paper, 0.08), tertiaryBorderColor: c.rule, tertiaryTextColor: ink,
    mainBkg: node, nodeBorder: brand, nodeTextColor: ink, textColor: ink, titleColor: ink,
    lineColor: c.muted, edgeLabelBackground: paper,
    clusterBkg: tint(0.05), clusterBorder: c.rule,
    actorBkg: node, actorBorder: brand, actorTextColor: ink, actorLineColor: c.muted,
    signalColor: ink, signalTextColor: ink, labelBoxBkgColor: node, labelBoxBorderColor: brand,
    labelTextColor: ink, loopTextColor: ink, noteBkgColor: tint(0.06), noteBorderColor: brand, noteTextColor: ink,
    activationBkgColor: tint(0.24), activationBorderColor: brand,
    pieStrokeColor: paper, pieOuterStrokeColor: c.rule, pieTitleTextColor: ink,
    pieLegendTextColor: ink, pieSectionTextColor: ink,
    // Mermaid draws slices at 70% over the sheet, so a slice never matched
    // its own legend swatch.
    pieOpacity: '1',
  };
  // Twelve steps, full brand to its palest, then back up: a long branch list
  // alternates strong and pale neighbours instead of fading into the sheet.
  const steps = [1, 0.62, 0.38, 0.22, 0.82, 0.5, 0.3, 0.16, 0.9, 0.7, 0.44, 0.26];
  steps.forEach((t, i) => {
    const fill = tint(t);
    v[`cScale${i}`] = fill;
    v[`cScaleLabel${i}`] = label(fill);
    v[`cScalePeer${i}`] = brand;
    // The rule a mindmap or timeline draws under each box. Mermaid derives
    // it by inverting the fill, which turns a red into a cyan.
    v[`cScaleInv${i}`] = mix(brand, ink, 0.7);
    v[`pie${i + 1}`] = fill;
  });
  v['pieSectionTextColor'] = ink;
  return v;
}

let bundle: Promise<string> | undefined;
/** Mermaid's browser bundle, read once per process. */
function mermaidBundle(): Promise<string> {
  bundle ??= readFile(createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js'), 'utf8');
  return bundle;
}

/**
 * The source as Mermaid is handed it. Only one thing changes: a Gantt chart
 * draws a line at today's date unless its own source says `todayMarker off`
 * (no configuration key turns it off), and a wall-clock line would make a
 * document re-issued tomorrow come out different. So any marker line the
 * author wrote is replaced by that one. The block keeps the source as written.
 */
export function drawable(source: string): string {
  const lines = source.split('\n');
  const head = lines.findIndex((l) => /^\s*gantt\s*$/.test(l));
  if (head === -1) return source;
  const kept = lines.filter((l, i) => i <= head || !/^\s*todayMarker\b/.test(l));
  kept.splice(head + 1, 0, '  todayMarker off');
  return kept.join('\n');
}

type Drawn ={ svg: string; png: string; wPx: number; hPx: number } | { error: string };

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
  const maxHPt = (size.h - theme.page.marginPt * 2) * 0.82;
  const bodyPx = theme.type.bodyPt * 4 / 3;

  const page = await browser.newPage({ deviceScaleFactor: PNG_SCALE });
  let drawn: Drawn[];
  try {
    await blockNonDataRequests(page);
    const faces = await themeFaceCss(theme);
    await page.setContent(`<!doctype html><html><head><style>${faces}
      html,body{margin:0;background:${theme.colors.paper}} #host{display:inline-block}</style></head><body><div id="host"></div></body></html>`);
    // Mermaid measures every label as it lays the diagram out, so the faces
    // must be decoded first or the boxes are sized for the fallback font.
    const families = [...new Set([theme.font.embed, theme.font.heading.embed].map((id) => FACES[id].family))];
    await page.evaluate(`Promise.all(${JSON.stringify(families)}.map((f) => document.fonts.load('16px "' + f + '"'))).then(() => document.fonts.ready)`);
    await page.addScriptTag({ content: await mermaidBundle() });
    const config = {
      startOnLoad: false, theme: 'base', securityLevel: 'strict', deterministicIds: true,
      // SVG text rather than HTML in a foreignObject: the labels stay text a
      // PDF reader can select and search, and the picture needs no HTML
      // layout to be right.
      htmlLabels: false, flowchart: { htmlLabels: false }, suppressErrorRendering: true,
      fontFamily: familyStack(theme.font), themeVariables: diagramVars(theme),
      // A Gantt chart is laid out to a width it is told, not to its content:
      // left alone it draws for a browser window and lands on the page at a
      // third of the body size. Told the column, its labels stay legible.
      gantt: { axisFormat: '%d.%m', useWidth: Math.round(colPt * 4 / 3), fontSize: Math.round(bodyPx), sectionFontSize: Math.round(bodyPx), barHeight: 22, barGap: 6, topPadding: 44, leftPadding: 90, gridLineStartPadding: 30 },
      timeline: { padding: 8 },
    };
    drawn = [];
    for (const [i, b] of sources.entries()) {
      // A string, not a closure: this project's tsconfig has no DOM lib.
      const result = await page.evaluate(`(async () => {
        const m = globalThis.mermaid;
        m.initialize(${JSON.stringify(config)});
        const host = document.getElementById('host');
        host.innerHTML = '';
        try {
          const { svg } = await m.render(${JSON.stringify(`dg${i}`)}, ${JSON.stringify(drawable(b.text))});
          host.innerHTML = svg;
          const el = host.querySelector('svg');
          const box = el.getBBox();
          const pad = 4;
          const w = Math.ceil(box.width + pad * 2), h = Math.ceil(box.height + pad * 2);
          el.setAttribute('viewBox', [box.x - pad, box.y - pad, w, h].join(' '));
          el.removeAttribute('style');
          el.setAttribute('width', String(w));
          el.setAttribute('height', String(h));
          return { svg: el.outerHTML, w, h };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e).split('\\n').slice(0, 3).join(' ') };
        }
      })()`) as { svg: string; w: number; h: number } | { error: string };
      if ('error' in result) { drawn.push(result); continue; }
      const shot = await (await page.$('#host svg'))!.screenshot({ type: 'png', omitBackground: false });
      drawn.push({ svg: result.svg, png: `data:image/png;base64,${shot.toString('base64')}`, wPx: result.w, hPx: result.h });
    }
  } finally {
    await page.close();
  }

  let k = 0;
  const blocks = doc.blocks.map((b): Block => {
    if (!isDiagramSource(b)) return b;
    const d = drawn[k++]!;
    if ('error' in d) {
      onWarn(`diagram ${k} (${b.lang}) could not be drawn and is printed as its source instead: ${d.error}`);
      return b;
    }
    let wPt = d.wPx * 0.75;
    let hPt = d.hPx * 0.75;
    const fit = Math.min(1, colPt / wPt, maxHPt / hPt);
    wPt *= fit; hPt *= fit;
    return { t: 'diagram', lang: 'mermaid', source: b.text, svg: d.svg, png: d.png, wPt: round(wPt), hPt: round(hPt) };
  });
  return { ...doc, blocks };
}

const round = (n: number) => Math.round(n * 100) / 100;
