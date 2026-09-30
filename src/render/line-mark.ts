// A mark drawn as a line rather than a fill — a logo or corner glyph traced
// in a hairline, with nothing inside it.
//
// It paints by class like every other mark (see theme/resolve.ts's
// findInlinePaint): `c-line`, `c-line-muted` and `c-line-ink` stroke in the
// theme's brand, muted and ink colours. The stroke does not scale with the
// mark, so one hairline weight holds from a 16pt letterhead logo to a 40pt
// cover glyph — which is the point of drawing it this way at all.
//
// Inside the line is paper, not nothing: the fill is white. A cover seats the
// corner glyph on the panel's own border, and a filled glyph hid that border
// where they overlap. A truly empty one let the border run straight through
// the L, which read as a drawing error rather than as a mark.
//
// Word cannot be handed a class, so its raster is drawn from the same vector
// with the paint written in (see paintLines): same shape, same colours, and a
// stroke width worked out for the size the raster will print at.

export const MARK_LINE_PT = 0.75;

const ROLE = { 'c-line': 'brand', 'c-line-muted': 'muted', 'c-line-ink': 'ink' } as const;

/** Whether an SVG draws anything through the line classes. */
export function usesLines(svg: string | undefined): boolean {
  return svg !== undefined && /class="c-line(?:-muted|-ink)?"/.test(svg);
}

/** The stylesheet rules for the line classes inside `scopes`, or nothing. */
export function lineRules(scopes: string[]): string {
  const colour = { brand: 'var(--brand)', muted: 'var(--muted)', ink: 'var(--ink)' };
  return Object.entries(ROLE)
    .map(([cls, role]) =>
      `${scopes.map((s) => `${s} .${cls}`).join(', ')}{ fill: #FFFFFF; stroke: ${colour[role]}; ` +
        `stroke-width: ${MARK_LINE_PT}pt; vector-effect: non-scaling-stroke; stroke-linejoin: miter; }`,
    )
    .join('\n');
}

/**
 * The same SVG with its line classes turned into inline paint, for a raster.
 * `pxPerPt` is the raster's pixels per printed point, so the hairline in the
 * picture Word prints is the hairline the PDF draws.
 */
export function paintLines(
  svg: string,
  colours: { brand: string; muted: string; ink: string },
  pxPerPt: number,
): string {
  const width = (MARK_LINE_PT * pxPerPt).toFixed(2);
  return svg.replace(/class="(c-line(?:-muted|-ink)?)"/g, (_, cls: keyof typeof ROLE) =>
    `fill="#FFFFFF" stroke="${colours[ROLE[cls]]}" stroke-width="${width}" vector-effect="non-scaling-stroke" stroke-linejoin="miter"`,
  );
}
