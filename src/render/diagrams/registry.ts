// Every diagram type documentor draws, one record each (docs/adr/0005). What
// a type needs beyond the shared configuration lives in its record, not in a
// switch somewhere in the engine; the gallery and README are checked against
// this list. Mermaid's own per-type configuration keys and theme variables
// stay where Mermaid's vocabulary is (mermaid/render.ts, tokens.ts).

import { kindOf } from './mermaid/source.js';
import { distinct, type DiagramTokens } from './tokens.js';

export type Engine = 'mermaid';

/** A step renderOne runs in the page after Mermaid has drawn, for what no
 *  theme variable reaches. */
export type Repaint = 'journey' | 'gantt' | 'sankey';

export interface DiagramType {
  /** Stable id, carried on the diagram block as `kind`. */
  id: string;
  engine: Engine;
  /** The header words that select this type, the canonical one first. */
  heads: readonly string[];
  /** The name README's Diagrams table and the gallery's heading use. */
  label: string;
  /** Per-type limits a drawing should stay within (warned about, never refused). */
  budget: Readonly<Record<string, number>>;
  /** How many elements may be marked as the focus. */
  focusMax: number;
  mermaid?: {
    /** Configuration outside the shared themeVariables. */
    config?: (t: DiagramTokens, vars: Record<string, string>) => Record<string, unknown>;
    /** Stylesheet appended to the shared one, for a type that draws with
     *  hard-coded colours rather than theme variables. */
    css?: (t: DiagramTokens) => string;
    repaint?: Repaint;
    /** The share of the column a chart drawn at a fixed size may take. */
    widthCap?: number;
    /** A left-to-right drawing too wide for the column may be drawn top-down. */
    turnsDown?: boolean;
  };
}

const xyChart = (t: DiagramTokens, vars: Record<string, string>) => ({ themeVariables: { ...vars, xyChart: {
  // Bars are the brand tinted, so a line drawn over them in the full
  // brand stays the one thing that reads first.
  backgroundColor: t.paper, titleColor: t.ink, plotColorPalette: distinct([t.tint(0.5), t.brand, ...t.series.slice(1)], 8).join(', '),
  xAxisLabelColor: t.textSec, xAxisTitleColor: t.textSec, xAxisTickColor: t.stroke, xAxisLineColor: t.stroke,
  yAxisLabelColor: t.textSec, yAxisTitleColor: t.textSec, yAxisTickColor: t.stroke, yAxisLineColor: t.stroke,
} } });

export const REGISTRY: readonly DiagramType[] = [
  { id: 'flowchart', engine: 'mermaid', heads: ['flowchart', 'graph'], label: 'Flowchart',
    budget: { nodes: 9, edges: 12 }, focusMax: 2, mermaid: { turnsDown: true } },
  { id: 'sequence', engine: 'mermaid', heads: ['sequenceDiagram'], label: 'Sequence',
    budget: { lifelines: 5 }, focusMax: 2 },
  { id: 'class', engine: 'mermaid', heads: ['classDiagram', 'classDiagram-v2'], label: 'Class',
    budget: { classes: 7 }, focusMax: 2 },
  { id: 'state', engine: 'mermaid', heads: ['stateDiagram-v2', 'stateDiagram'], label: 'State',
    budget: { states: 9 }, focusMax: 2 },
  { id: 'er', engine: 'mermaid', heads: ['erDiagram'], label: 'Entity relationship',
    budget: { entities: 8 }, focusMax: 2 },
  { id: 'mindmap', engine: 'mermaid', heads: ['mindmap'], label: 'Mind map',
    budget: {}, focusMax: 2 },
  { id: 'timeline', engine: 'mermaid', heads: ['timeline'], label: 'Timeline',
    budget: {}, focusMax: 2, mermaid: {
      turnsDown: true,
      // Mermaid sets a timeline's title at 4ex and its axis 4px black.
      css: (t) => `line { stroke: ${t.line} !important; stroke-width: 1.25px !important; } path { stroke-width: 1px; }
      text[font-size="4ex"] { font-size: 1.35em; }`,
    } },
  { id: 'gantt', engine: 'mermaid', heads: ['gantt'], label: 'Gantt',
    budget: { tasks: 12 }, focusMax: 2, mermaid: {
      repaint: 'gantt',
      css: (t) => `.grid .tick line { stroke: ${t.faint}; } .grid path { stroke: ${t.stroke}; } .task { stroke-width: 1px; } .today { display: none; }`,
    } },
  { id: 'pie', engine: 'mermaid', heads: ['pie'], label: 'Pie',
    budget: { slices: 8 }, focusMax: 2, mermaid: { widthCap: 0.6 } },
  { id: 'quadrant', engine: 'mermaid', heads: ['quadrantChart'], label: 'Quadrant',
    budget: { points: 12 }, focusMax: 2, mermaid: { widthCap: 0.72 } },
  { id: 'xychart', engine: 'mermaid', heads: ['xychart-beta', 'xychart'], label: 'XY chart',
    budget: {}, focusMax: 2, mermaid: { config: xyChart } },
  { id: 'journey', engine: 'mermaid', heads: ['journey'], label: 'Journey',
    budget: { stages: 6 }, focusMax: 2, mermaid: {
      repaint: 'journey',
      css: (t) => `.task-line { stroke: ${t.stroke}; } .face { stroke: ${t.line}; } .mouth { stroke: ${t.line}; }`,
    } },
  { id: 'sankey', engine: 'mermaid', heads: ['sankey-beta', 'sankey'], label: 'Sankey',
    budget: { nodes: 8, flows: 12 }, focusMax: 2, mermaid: { repaint: 'sankey' } },
  { id: 'gitgraph', engine: 'mermaid', heads: ['gitGraph'], label: 'Git graph',
    budget: {}, focusMax: 2, mermaid: {
      config: () => ({ gitGraph: { rotateCommitLabel: false } }),
      css: (t) => `.branch { stroke-width: 1px; stroke-dasharray: 2 3; } .commit-label-bkg { stroke: ${t.stroke}; }`,
    } },
  { id: 'block', engine: 'mermaid', heads: ['block-beta', 'block'], label: 'Block',
    budget: {}, focusMax: 2 },
];

const BY_HEAD = new Map(REGISTRY.flatMap((d) => d.heads.map((h) => [h, d] as const)));

/** The type a header word selects, or undefined when no record claims it. */
export const typeByHead = (head: string): DiagramType | undefined => BY_HEAD.get(head);

/** The type a source declares, or undefined when no record claims its header. */
export const typeOf = (source: string): DiagramType | undefined => typeByHead(kindOf(source));
