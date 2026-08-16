// The heatmap's shared numbers: how a value becomes a step, and how a step
// becomes a colour. One module, because three renderers draw the same matrix
// and two of them computing tints two different ways is exactly the drift the
// agreement suite exists to catch — cheaper to make it impossible.

/** Tint fractions for the scale/numbers styles, palest to full. Four steps:
 *  few enough to tell apart on paper, and an odd middle is not needed. */
export const SCALE_STEPS: readonly number[] = [0.18, 0.32, 0.6, 1];

/** 0 for an empty cell, else 1..steps by ceiling against the matrix maximum. */
export function stepOf(value: number, max: number, steps: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(steps, Math.ceil((value / max) * steps));
}

/** `#RRGGBB` blended toward white: t=1 is the colour itself, t=0 is white.
 *  Plain per-channel srgb interpolation — the same arithmetic CSS
 *  `color-mix(in srgb, C p%, white)` performs, which is what lets the HTML
 *  renderer use color-mix with these fractions and still match Word's
 *  computed fills. */
export function mixToWhite(hex: string, t: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (shift: number): string => {
    const c = (n >> shift) & 0xff;
    return Math.round(c * t + 255 * (1 - t)).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

/** The tint behind a cover's statement band (see html.ts's `.cover-statement`
 *  and docx.ts's statementTable). It lives here, beside the heatmap's own
 *  fractions, for the one reason this module exists: two renderers computing
 *  the same fill two different ways is drift the agreement suite has to
 *  catch, and one constant makes it impossible. Paler than the palest heatmap
 *  step on purpose — the band carries body text, which the heatmap's cells do
 *  not. */
export const STATEMENT_TINT = 0.08;

/**
 * Which of two candidate text colours actually reads on `fill` — the theme's
 * ink, or white. Chosen by WCAG contrast ratio rather than by a threshold
 * somebody guessed, because the answer depends on the theme's brand and no
 * fixed cut-off is right for every one of them.
 *
 * This exists because the heatmap's darkest step is the brand at full
 * strength, and the number in that cell was drawn in ink regardless. For
 * TEBIN that is near-black on dark red — legible, barely. For `plain`, whose
 * brand IS its ink (#1A1A1A by design), it was black on black: the value
 * simply was not on the page. Note what this does NOT do — it never reaches
 * for colors.brandOnDark, which stays null until a theme declares one for
 * the reason its own comment gives. Ink and white are not brand colours;
 * this is a contrast computation, not a palette guess.
 */
export function readableOn(fill: string, ink: string): string {
  const lum = (hex: string): number => {
    const n = parseInt(hex.replace('#', ''), 16);
    const ch = (shift: number): number => {
      const c = ((n >> shift) & 0xff) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  };
  const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const bg = lum(fill);
  return ratio(bg, lum(ink)) >= ratio(bg, 1) ? ink : '#FFFFFF';
}

export const weekLabel = (i: number): string => `W${String(i + 1).padStart(2, '0')}`;
