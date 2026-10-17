// Every colour a diagram uses, worked out from the theme: one grey system and
// one accent (docs/adr/0003). Shared by every engine.

import type { Theme } from '../../theme/types.js';
import { familyStack } from '../fonts.js';
import { luminance, readableOn, sheetOf } from '../tint.js';

/** `a` blended toward `b`: t=1 is `a`, t=0 is `b`. Per-channel sRGB, as tint.ts. */
export function mix(a: string, b: string, t: number): string {
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
    /** Categorical series: the brand, then neutrals and brand shades, kept
     *  only where they differ in lightness from every one before — so a
     *  theme whose brand is its ink (plain) still gets eight distinct greys. */
    series: distinct([brand, ink_(0.62), tint(0.45), ink_(0.3), mix(brand, ink, 0.6), tint(0.22), ink_(0.45), tint(0.7),
      ink_(0.8), tint(0.32), ink_(0.18), tint(0.85), ink_(0.55), tint(0.12), ink_(0.7), tint(0.58)], 8),
  };
}

/** The first `n` colours that each differ in luminance from all kept before. */
export function distinct(colours: string[], n: number): string[] {
  const kept: string[] = [];
  for (const c of colours) {
    if (kept.length === n) break;
    if (kept.every((k) => Math.abs(luminance(k) - luminance(c)) >= 0.035)) kept.push(c);
  }
  return kept;
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

export type DiagramTokens = ReturnType<typeof diagramTokens>;
