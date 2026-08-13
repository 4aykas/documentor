// The heatmap's shared numbers: how a value becomes a step, and how a step
// becomes a colour. One module, because three renderers draw the same matrix
// and two of them computing tints two different ways is exactly the drift the
// agreement suite exists to catch — cheaper to make it impossible.

/** Tint fractions for the scale/numbers styles, palest to full. Four steps:
 *  few enough to tell apart on paper, and an odd middle is not needed. */
export const SCALE_STEPS: readonly number[] = [0.12, 0.32, 0.6, 1];

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

export const weekLabel = (i: number): string => `W${String(i + 1).padStart(2, '0')}`;
