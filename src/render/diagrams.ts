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
import { dirname, join, resolve, sep } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { Block, Doc } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { FACES, familyStack, themeFaceCss } from './fonts.js';
import { readableOn, sheetOf } from './tint.js';
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

/**
 * Every colour a diagram uses, derived from three of the theme's: the sheet,
 * the ink and the brand. Structure is ink mixed into the sheet at fixed
 * strengths — a box is 3.5% ink, its outline 22%, a line 50%, secondary text
 * 62% — so a drawing reads as one calm grey system, and the brand is spent
 * once, on what carries direction or emphasis: arrowheads, the first series,
 * a highlighted point. The fixed-strength scheme is the one beautiful-mermaid
 * (lukilabs, MIT) derives its themes from.
 */
export function diagramTokens(theme: Theme) {
  const c = theme.colors;
  const { dark, brand } = sheetOf(c);
  const paper = c.paper, ink = c.ink;
  const ink_ = (t: number) => mix(ink, paper, t);
  const tint = (t: number) => mix(brand, paper, t);
  return {
    dark, paper, ink, brand, tint,
    surface: ink_(0.035), stroke: ink_(0.22), line: ink_(0.5), textSec: ink_(0.62), faint: ink_(0.08),
    /** Categorical series: the brand, then neutrals and brand shades that
     *  stay apart in lightness, so a series is told by more than hue. */
    series: [brand, ink_(0.62), tint(0.45), ink_(0.3), mix(brand, ink, 0.6), tint(0.22), ink_(0.45), tint(0.7)],
  };
}

/**
 * Mermaid's `base` theme variables, from diagramTokens. The branch scale a
 * mindmap, timeline or pie paints with runs from the brand at full strength
 * toward the sheet, so every diagram in a document is one hue, the way the
 * heatmap is; each fill's label colour is computed by contrast. On a dark
 * sheet the brand is brandOnDark when the theme has one.
 */
export function diagramVars(theme: Theme): Record<string, string> {
  const t = diagramTokens(theme);
  const { paper, ink, brand, tint, dark } = t;
  const label = (fill: string) => readableOn(fill, ink) === ink ? ink : (dark ? '#000000' : '#FFFFFF');
  const v: Record<string, string> = {
    background: paper,
    fontFamily: familyStack(theme.font),
    fontSize: `${(theme.type.bodyPt * 4 / 3).toFixed(1)}px`,
    primaryColor: t.surface, primaryBorderColor: t.stroke, primaryTextColor: ink,
    secondaryColor: tint(0.12), secondaryBorderColor: t.stroke, secondaryTextColor: ink,
    tertiaryColor: t.faint, tertiaryBorderColor: t.stroke, tertiaryTextColor: ink,
    mainBkg: t.surface, nodeBorder: t.stroke, nodeTextColor: ink, textColor: ink, titleColor: ink,
    lineColor: t.line, arrowheadColor: brand, edgeLabelBackground: paper,
    clusterBkg: paper, clusterBorder: t.stroke,
    actorBkg: t.surface, actorBorder: t.stroke, actorTextColor: ink, actorLineColor: t.stroke,
    signalColor: t.line, signalTextColor: t.textSec, labelBoxBkgColor: t.surface, labelBoxBorderColor: t.stroke,
    labelTextColor: ink, loopTextColor: t.textSec, noteBkgColor: tint(0.07), noteBorderColor: tint(0.4), noteTextColor: ink,
    activationBkgColor: t.faint, activationBorderColor: t.stroke,
    // state and ER diagrams
    transitionColor: t.line, transitionLabelColor: t.textSec, stateLabelColor: ink, labelColor: ink,
    attributeBackgroundColorOdd: paper, attributeBackgroundColorEven: t.surface,
    // quadrant chart: Mermaid derives the point colour from a value it never
    // set, and prints hsl(0, 0%, NaN%) — black. Every slot is named here.
    quadrant1Fill: tint(0.1), quadrant2Fill: tint(0.18), quadrant3Fill: t.surface, quadrant4Fill: tint(0.05),
    quadrant1TextFill: ink, quadrant2TextFill: ink, quadrant3TextFill: ink, quadrant4TextFill: ink,
    quadrantPointFill: brand, quadrantPointTextFill: ink, quadrantXAxisTextFill: t.textSec, quadrantYAxisTextFill: t.textSec,
    quadrantInternalBorderStrokeFill: t.stroke, quadrantExternalBorderStrokeFill: t.stroke, quadrantTitleFill: ink,
    // journey faces and git graph labels
    faceColor: t.surface, commitLabelColor: ink, commitLabelBackground: t.surface, tagLabelColor: ink,
    tagLabelBackground: t.surface, tagLabelBorder: t.stroke,
    pieStrokeColor: paper, pieOuterStrokeColor: t.stroke, pieTitleTextColor: ink,
    pieLegendTextColor: ink, pieSectionTextColor: ink,
    // Mermaid draws slices at 70% over the sheet, so a slice never matched
    // its own legend swatch.
    pieOpacity: '1',
  };
  t.series.forEach((s, i) => {
    v[`git${i}`] = s;
    v[`gitBranchLabel${i}`] = label(s);
    v[`gitInv${i}`] = paper;
  });
  // Twelve steps, full brand to its palest, then back up: a long branch list
  // alternates strong and pale neighbours instead of fading into the sheet.
  const steps = [1, 0.62, 0.38, 0.22, 0.82, 0.5, 0.3, 0.16, 0.9, 0.7, 0.44, 0.26];
  steps.forEach((s, i) => {
    const fill = tint(s);
    v[`cScale${i}`] = fill;
    v[`cScaleLabel${i}`] = label(fill);
    v[`cScalePeer${i}`] = brand;
    // The rule a mindmap or timeline draws under each box. Mermaid derives
    // it by inverting the fill, which turns a red into a cyan.
    v[`cScaleInv${i}`] = mix(brand, ink, 0.7);
    v[`pie${i + 1}`] = fill;
  });
  // A journey's task boxes, section by section: faint tints, not Mermaid's
  // navy and purple.
  [0.1, 0.18, 0.06, 0.26, 0.14, 0.04, 0.22, 0.08].forEach((s, i) => { v[`fillType${i}`] = tint(s); });
  return v;
}

/** The diagram type a source declares: its first word after any frontmatter. */
export function kindOf(source: string): string {
  const lines = source.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') i = lines.findIndex((l, j) => j > 0 && l.trim() === '---') + 1;
  while (i < lines.length && (lines[i]!.trim() === '' || lines[i]!.trim().startsWith('%%'))) i++;
  return (lines[i] ?? '').trim().split(/[\s;]/)[0] ?? '';
}

/** Configuration a type takes outside themeVariables. */
function kindConfig(kind: string, theme: Theme): Record<string, unknown> {
  const t = diagramTokens(theme);
  switch (kind) {
    case 'xychart-beta':
    case 'xychart':
      return { themeVariables: { ...diagramVars(theme), xyChart: {
        // Bars are the brand tinted, so a line drawn over them in the full
        // brand stays the one thing that reads first.
        backgroundColor: t.paper, titleColor: t.ink, plotColorPalette: [t.tint(0.5), t.brand, ...t.series.slice(1)].join(', '),
        xAxisLabelColor: t.textSec, xAxisTitleColor: t.textSec, xAxisTickColor: t.stroke, xAxisLineColor: t.stroke,
        yAxisLabelColor: t.textSec, yAxisTitleColor: t.textSec, yAxisTickColor: t.stroke, yAxisLineColor: t.stroke,
      } } };
    case 'journey':
      return { journey: { actorColours: t.series, sectionFills: [0.1, 0.18, 0.06, 0.26].map(t.tint), sectionColours: [t.ink] } };
    case 'gitGraph':
      return { gitGraph: { rotateCommitLabel: false } };
    default:
      return {};
  }
}

/**
 * The stylesheet Mermaid scopes into each SVG, after its own. What it changes
 * is what makes a default Mermaid drawing look like one: hairline boxes with
 * square corners at one weight, edge labels in the body size on a white box,
 * a stick figure for every actor. Strokes get one weight per role, corners a
 * small radius on a square box only (a rounded or stadium node keeps the
 * corners its author chose), and edge and message labels the theme's muted
 * ink at the nodes' size but not their weight.
 */
export function diagramCss(theme: Theme, kind = ''): string {
  const t = diagramTokens(theme);
  const base = `
.node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }
.node rect:not([rx]) { rx: 4px; ry: 4px; }
.flowchart-link, .edgePath .path, .transition, .relationshipLine { stroke-width: 1px; }
.marker, .arrowheadPath, marker path { fill: ${t.brand}; stroke: ${t.brand}; }
.edgeLabel text, .edgeLabel tspan, .messageText, .loopText, .loopText tspan, .labelText, .labelText tspan { fill: ${t.textSec} !important; font-size: 0.86em; }
.edgeLabel rect, .labelBkg { fill: ${t.paper}; stroke: ${t.faint}; stroke-width: 1px; rx: 2px; ry: 2px; opacity: 1; }
.cluster rect { stroke-dasharray: 3 3; rx: 4px; ry: 4px; }
rect.actor { stroke-width: 1px; rx: 4px; ry: 4px; }
.actor-line { stroke-dasharray: 2 3; }
.note { stroke-width: 1px; rx: 2px; ry: 2px; }
.labelBox { stroke-width: 1px; }
.messageLine0, .messageLine1 { stroke-width: 1px; }
`;
  // Types that draw with hard-coded colours rather than theme variables.
  const extra: Record<string, string> = {
    // Mermaid sets a timeline's title at 4ex and its axis 4px black.
    timeline: `line { stroke: ${t.line} !important; stroke-width: 1.25px !important; } path { stroke-width: 1px; }
      text[font-size="4ex"] { font-size: 1.35em; }`,
    gantt: `.grid .tick line { stroke: ${t.faint}; } .grid path { stroke: ${t.stroke}; } .task { stroke-width: 1px; } .today { display: none; }`,
    gitGraph: `.branch { stroke-width: 1px; stroke-dasharray: 2 3; } .commit-label-bkg { stroke: ${t.stroke}; }`,
    journey: `.task-line { stroke: ${t.stroke}; } .face { stroke: ${t.line}; } .mouth { stroke: ${t.line}; }`,
  };
  return base + (extra[kind] ?? '');
}

/**
 * Mermaid and its ELK layout ship as ES modules, which a page loads from a
 * URL. The page is therefore served from an origin that does not exist —
 * `.invalid` is reserved for exactly that — and every request to it is
 * answered from the installed packages; anything else is refused by the
 * same guard the PDF page uses. Nothing leaves the machine.
 */
const ORIGIN = 'https://documentor.invalid';
function packageRoot(name: string): string {
  return dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
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

type Drawn = { svg: string; png: string; wPx: number; hPx: number; triedDown: boolean } | { error: string };

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

  const page = await browser.newPage({ deviceScaleFactor: PNG_SCALE });
  let drawn: Drawn[];
  try {
    await blockNonDataRequests(page);
    const faces = await themeFaceCss(theme);
    const html = `<!doctype html><html><head><style>${faces}
      html,body{margin:0;background:${theme.colors.paper}} #host{display:inline-block}</style></head><body><div id="host"></div></body></html>`;
    const roots = { mermaid: join(packageRoot('mermaid'), 'dist'), elk: join(packageRoot('@mermaid-js/layout-elk'), 'dist') };
    // Registered after the guard, so it is asked first (Playwright tries the
    // newest route first) and answers only its own origin.
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ body: html, contentType: 'text/html' });
      const [, pkg, ...rest] = path.split('/');
      const root = pkg === 'mermaid' || pkg === 'elk' ? roots[pkg] : undefined;
      const file = root === undefined ? undefined : resolve(root, ...rest);
      if (file === undefined || !file.startsWith(root! + sep)) return route.abort();
      try {
        return await route.fulfill({ body: await readFile(file), contentType: 'text/javascript' });
      } catch {
        return route.abort();
      }
    });
    await page.goto(`${ORIGIN}/`);
    // Mermaid measures every label as it lays the diagram out, so the faces
    // must be decoded first or the boxes are sized for the fallback font.
    const families = [...new Set([theme.font.embed, theme.font.heading.embed].map((id) => FACES[id].family))];
    await page.evaluate(`Promise.all(${JSON.stringify(families)}.map((f) => document.fonts.load('16px "' + f + '"'))).then(() => document.fonts.ready)`);
    await page.evaluate(`(async () => {
      const m = (await import('${ORIGIN}/mermaid/mermaid.esm.min.mjs')).default;
      m.registerLayoutLoaders((await import('${ORIGIN}/elk/mermaid-layout-elk.esm.min.mjs')).default);
      globalThis.mermaid = m;
    })()`);
    const config = {
      startOnLoad: false, theme: 'base', look: 'classic', securityLevel: 'strict', deterministicIds: true,
      // SVG text rather than HTML in a foreignObject: the labels stay text a
      // PDF reader can select and search, and the picture needs no HTML
      // layout to be right.
      htmlLabels: false, suppressErrorRendering: true,
      // Named, because once ELK is registered Mermaid makes it the default
      // for every flowchart. dagre stays the default — tighter on a page —
      // and a diagram asks for ELK in its own frontmatter (`layout: elk`).
      layout: 'dagre',
      // Mermaid wraps a label at 200px, which stacks an ordinary sentence
      // five lines deep in a narrow box; 260 keeps most labels to two or
      // three. Straight edges, not the default spline, read as drawn.
      flowchart: { htmlLabels: false, wrappingWidth: 260, nodeSpacing: 36, rankSpacing: 46, padding: 12, curve: 'linear' },
      // A message as long as a sentence would otherwise set the gap between
      // two lifelines to its full length; wrapped, the diagram keeps the
      // column and its labels the body size.
      sequence: { actorMargin: 90, boxMargin: 8, messageMargin: 30, mirrorActors: true, wrap: true, width: 130 },
      fontFamily: familyStack(theme.font), themeVariables: diagramVars(theme), themeCSS: diagramCss(theme),
      // A Gantt chart is laid out to a width it is told, not to its content:
      // left alone it draws for a browser window and lands on the page at a
      // third of the body size. Told the column, its labels stay legible.
      gantt: { axisFormat: '%d.%m', useWidth: Math.round(colPt * 4 / 3), fontSize: Math.round(bodyPx), sectionFontSize: Math.round(bodyPx), barHeight: 22, barGap: 6, topPadding: 44, leftPadding: 90, gridLineStartPadding: 30 },
      timeline: { padding: 8 },
      // A state diagram is laid out tighter than its transition labels: at
      // Mermaid's spacing a label sits on the line of its neighbour.
      state: { nodeSpacing: 70, rankSpacing: 60, padding: 12 },
    };
    drawn = [];
    const fitOf = (r: { w: number; h: number }) => Math.min(1, colPt / (r.w * 0.75), maxHPt / (r.h * 0.75));
    const series = diagramTokens(theme).series;
    for (const [i, b] of sources.entries()) {
      const kind = kindOf(b.text);
      const cfg = { ...config, ...kindConfig(kind, theme), themeCSS: diagramCss(theme, kind) };
      // What no theme variable reaches is fixed in the page after drawing:
      // sankey's nodes and links take their colours from a fixed scheme,
      // journey reads its actor colours before any configuration is applied
      // (a Mermaid bug), and a gantt axis prints one label per tick however
      // close the ticks are.
      const recolor = { kind, series, paper: theme.colors.paper };
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
      const shot = await (await page.$('#host svg'))!.screenshot({ type: 'png', omitBackground: false });
      drawn.push({ svg: result.svg, png: `data:image/png;base64,${shot.toString('base64')}`, wPx: result.w, hPx: result.h, triedDown });
    }
  } finally {
    await page.close();
  }
  return place(doc, drawn, theme, colPt, maxHPt, onWarn);
}

/**
 * The source with a left-to-right flowchart or timeline turned top-down, or
 * null when it is neither. Only the header line's direction word changes.
 */
export function leftToRight(source: string): string | null {
  const lines = source.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === '---');
    if (end === -1) return null;
    i = end + 1;
  }
  while (i < lines.length && (lines[i]!.trim() === '' || lines[i]!.trim().startsWith('%%'))) i++;
  const m = /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b(.*)$/.exec(lines[i] ?? '');
  if (m !== null) {
    lines[i] = `${m[1]}TD${m[3]}`;
    return lines.join('\n');
  }
  // A timeline runs left to right unless its header says TD; Mermaid draws
  // each period 200px apart, so four already outrun an A4 column.
  const t = /^(\s*timeline)(?:\s+LR)?\s*$/.exec(lines[i] ?? '');
  if (t === null) return null;
  lines[i] = `${t[1]} TD`;
  return lines.join('\n');
}

type Rendered = { svg: string; w: number; h: number } | { error: string };

/**
 * One source drawn into the page's host, trimmed to its ink. `recolor` fixes
 * what no theme variable reaches, by type: a sankey's distinct node fills
 * mapped in order onto the series (links and gradient stops with them), a
 * journey's actor dots, a gantt axis thinned to about nine labels.
 */
async function renderOne(page: Page, config: object, id: string, source: string, recolor: { kind: string; series: string[]; paper: string } | null = null): Promise<Rendered> {
      // A string, not a closure: this project's tsconfig has no DOM lib.
      return await page.evaluate(`(async () => {
        const m = globalThis.mermaid;
        m.initialize(${JSON.stringify(config)});
        const host = document.getElementById('host');
        host.innerHTML = '';
        try {
          const { svg } = await m.render(${JSON.stringify(id)}, ${JSON.stringify(source)});
          host.innerHTML = svg;
          const el = host.querySelector('svg');
          const fix = ${JSON.stringify(recolor)};
          const palette = fix && fix.kind.startsWith('sankey') ? fix.series : null;
          if (fix && fix.kind === 'journey') {
            for (const c of el.querySelectorAll('circle[class*="actor-"]')) {
              const n = Number((c.getAttribute('class').match(/actor-(\\d+)/) || [0, 0])[1]);
              c.setAttribute('fill', fix.series[n % fix.series.length]);
              c.setAttribute('stroke', fix.paper);
            }
          }
          if (fix && fix.kind === 'gantt') {
            const ticks = [...el.querySelectorAll('.grid .tick text')];
            const every = Math.ceil(ticks.length / 9);
            if (every > 1) ticks.forEach((t, i) => { if (i % every) t.remove(); });
          }
          if (palette) {
            const map = new Map();
            for (const r of el.querySelectorAll('rect[fill]')) {
              const f = r.getAttribute('fill').toLowerCase();
              if (!map.has(f)) map.set(f, palette[map.size % palette.length]);
              r.setAttribute('fill', map.get(f));
            }
            for (const s of el.querySelectorAll('stop')) {
              const f = (s.getAttribute('stop-color') || '').toLowerCase();
              if (map.has(f)) s.setAttribute('stop-color', map.get(f));
            }
            for (const p of el.querySelectorAll('path[stroke]')) {
              const f = p.getAttribute('stroke').toLowerCase();
              if (map.has(f)) p.setAttribute('stroke', map.get(f));
              p.setAttribute('stroke-opacity', '0.4');
            }
          }
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
      })()`) as Rendered;
}

/** The drawings swapped in for their sources, each scaled to the page. */
function place(doc: Doc, drawn: Drawn[], theme: Theme, colPt: number, maxHPt: number, onWarn: (m: string) => void): Doc {
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
    // A chart Mermaid draws at a fixed size, whatever it holds, would
    // otherwise take the whole column: a pie of four slices half a page.
    const cap = { pie: 0.6, quadrantChart: 0.72 }[kindOf(b.text)];
    if (cap !== undefined && wPt > colPt * cap) {
      const s = (colPt * cap) / wPt;
      wPt *= s; hPt *= s;
    }
    // Labels are laid out at the body size; a picture scaled far below it
    // prints them smaller than anything else on the page.
    if (fit < 0.75) {
      // Top-down is advice only for a flow that has not already been tried
      // that way; a sequence or an already-vertical flow needs fewer boxes.
      const advice = leftToRight(b.text) !== null && !d.triedDown
        ? 'a top-down direction or fewer side-by-side boxes would keep them readable'
        : 'fewer side-by-side boxes or shorter labels would keep them readable';
      onWarn(`diagram ${k} (${b.lang}) is scaled to fit the page, so its labels print at about ${(theme.type.bodyPt * fit).toFixed(1)}pt `
        + `against ${theme.type.bodyPt}pt body text; ${advice}`);
    }
    return { t: 'diagram', lang: 'mermaid', source: b.text, svg: d.svg, png: d.png, wPt: round(wPt), hPt: round(hPt) };
  });
  return { ...doc, blocks };
}

const round = (n: number) => Math.round(n * 100) / 100;
