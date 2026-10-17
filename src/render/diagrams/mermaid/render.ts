// One Mermaid source drawn in the diagram page.

import type { Page } from 'playwright-core';
import type { Theme } from '../../../theme/types.js';
import { familyStack } from '../../fonts.js';
import { typeByHead, type Repaint } from '../registry.js';
import type { DiagramTokens } from '../tokens.js';

/**
 * The stylesheet Mermaid scopes into each SVG, after its own. What it changes
 * is what makes a default Mermaid drawing look like one: hairline boxes with
 * square corners at one weight, edge labels in the body size on a white box,
 * a stick figure for every actor. Strokes get one weight per role, corners a
 * small radius on a square box only (a rounded or stadium node keeps the
 * corners its author chose), and edge and message labels the theme's muted
 * ink at the nodes' size but not their weight.
 */
export function diagramCss(t: DiagramTokens, kind = ''): string {
  const base = `
.node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }
.node rect:not([rx]) { rx: 4px; ry: 4px; }
.flowchart-link, .edgePath .path, .transition, .relationshipLine { stroke-width: 1px; }
.marker, .arrowheadPath, marker path { fill: ${t.brand}; stroke: ${t.brand}; }
.edgeLabel text, .edgeLabel tspan, .messageText, .loopText, .loopText tspan, .labelText, .labelText tspan { fill: ${t.textSec} !important; }
.edgeLabel rect, .labelBkg { fill: ${t.paper}; stroke: ${t.faint}; stroke-width: 1px; rx: 2px; ry: 2px; opacity: 1; }
.cluster rect { stroke-dasharray: 3 3; rx: 4px; ry: 4px; }
rect.actor { stroke-width: 1px; rx: 4px; ry: 4px; }
.actor-line { stroke-dasharray: 2 3; }
.note { stroke-width: 1px; rx: 2px; ry: 2px; }
.labelBox { stroke-width: 1px; }
.messageLine0, .messageLine1 { stroke-width: 1px; }
.node.focus > :is(rect, polygon, circle, ellipse, path), .node.focus > :is(g.basic, g.outer-path) path { stroke: ${t.brand}; stroke-width: 1.5px; fill: ${t.tint(0.1)}; }
`;
  // A type that draws with hard-coded colours rather than theme variables
  // carries its own rules in its registry record.
  return base + (typeByHead(kind)?.mermaid?.css?.(t) ?? '');
}

/**
 * Mermaid's configuration for one document, before a type adds its own
 * (`config` in its registry record).
 */
export function mermaidConfig(theme: Theme, vars: Record<string, string>, colPt: number, bodyPx: number) {
  return {
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
    // three. Edges are right-angled elbows (docs/adr/0010): the default
    // spline reads as sketched, and straight lines leave a decision's corner
    // on a diagonal to the box beside it.
    flowchart: { htmlLabels: false, wrappingWidth: 260, nodeSpacing: 36, rankSpacing: 46, padding: 12, curve: 'step' },
    // A message as long as a sentence would otherwise set the gap between
    // two lifelines to its full length; wrapped, the diagram keeps the
    // column and its labels the body size.
    sequence: { actorMargin: 90, boxMargin: 8, messageMargin: 30, mirrorActors: true, wrap: true, width: 130 },
    fontFamily: familyStack(theme.font), themeVariables: vars,
    // A Gantt chart is laid out to a width it is told, not to its content:
    // left alone it draws for a browser window and lands on the page at a
    // third of the body size. Told the column, its labels stay legible.
    gantt: { axisFormat: '%d.%m', useWidth: Math.round(colPt * 4 / 3), fontSize: Math.round(bodyPx), sectionFontSize: Math.round(bodyPx), barHeight: 22, barGap: 6, topPadding: 44, leftPadding: 90, gridLineStartPadding: 30 },
    timeline: { padding: 8 },
    // A state diagram is laid out tighter than its transition labels: at
    // Mermaid's spacing a label sits on the line of its neighbour.
    state: { nodeSpacing: 70, rankSpacing: 60, padding: 12 },
  };
}

/** The configuration one source is drawn with: the document's, its type's
 *  own, and the stylesheet. */
export function configFor(kind: string, base: Record<string, unknown>, t: DiagramTokens, vars: Record<string, string>) {
  const m = typeByHead(kind)?.mermaid;
  const curve = m?.curve ? { flowchart: { ...(base['flowchart'] as object), curve: m.curve } } : {};
  return { ...base, ...curve, ...(m?.config?.(t, vars) ?? {}), themeCSS: diagramCss(t, kind) };
}

/** A drawing trimmed to its ink, with the accTitle and accDescr Mermaid wrote
 *  into it as <title> and <desc> ("" when the source has none). */
export type Rendered = { svg: string; w: number; h: number; title: string; desc: string } | { error: string };

export type Recolor = { repaint: Repaint | undefined; series: string[]; paper: string };

/**
 * One source drawn into the page's host, trimmed to its ink. `recolor` fixes
 * what no theme variable reaches, by type: a sankey's distinct node fills
 * mapped in order onto the series (links and gradient stops with them), a
 * journey's actor dots, a gantt axis thinned to about nine labels.
 */
export async function renderOne(page: Page, config: object, id: string, source: string, recolor: Recolor | null = null): Promise<Rendered> {
      // A string, not a closure: this project's tsconfig has no DOM lib.
      return await page.evaluate(`(async () => {
        const m = globalThis.mermaid;
        // Mermaid draws some shapes (a cylinder, a stadium, an ER box) through
        // rough.js, which places a straight edge's curve control points with
        // Math.random: the same picture, different bytes on every build. A
        // seeded generator (mulberry32), reset for each diagram, makes a
        // diagram's bytes depend on its source alone.
        let seed = 0x9e3779b9;
        Math.random = () => {
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        m.initialize(${JSON.stringify(config)});
        const host = document.getElementById('host');
        host.innerHTML = '';
        try {
          const { svg } = await m.render(${JSON.stringify(id)}, ${JSON.stringify(source)});
          host.innerHTML = svg;
          const el = host.querySelector('svg');
          const fix = ${JSON.stringify(recolor)};
          const palette = fix && fix.repaint === 'sankey' ? fix.series : null;
          if (fix && fix.repaint === 'journey') {
            for (const c of el.querySelectorAll('circle[class*="actor-"]')) {
              const n = Number((c.getAttribute('class').match(/actor-(\\d+)/) || [0, 0])[1]);
              c.setAttribute('fill', fix.series[n % fix.series.length]);
              c.setAttribute('stroke', fix.paper);
            }
          }
          if (fix && fix.repaint === 'gantt') {
            const ticks = [...el.querySelectorAll('.grid .tick text')];
            const every = Math.ceil(ticks.length / 9);
            if (every > 1) ticks.forEach((t, i) => { if (i % every) t.remove(); });
          }
          if (palette) {
            // Each node its own slot, in order; a link's gradient stops name
            // the colours of its two nodes, so they follow through the map.
            // (Two nodes Mermaid gave one colour keep sharing it in links.)
            const map = new Map();
            el.querySelectorAll('.nodes .node rect').forEach((r, n) => {
              const f = (r.getAttribute('fill') || '').toLowerCase();
              const to = palette[n % palette.length];
              if (!map.has(f)) map.set(f, to);
              r.setAttribute('fill', to);
            });
            for (const s of el.querySelectorAll('.links stop')) {
              const f = (s.getAttribute('stop-color') || '').toLowerCase();
              if (map.has(f)) s.setAttribute('stop-color', map.get(f));
            }
            for (const p of el.querySelectorAll('.links .link path')) {
              const f = (p.getAttribute('stroke') || '').toLowerCase();
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
          const own = (tag) => (el.querySelector(':scope > ' + tag)?.textContent ?? '').trim();
          return { svg: el.outerHTML, w, h, title: own('title'), desc: own('desc') };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e).split('\\n').slice(0, 3).join(' ') };
        }
      })()`) as Rendered;
}
