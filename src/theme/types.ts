export type PageSize = 'A4' | 'Letter';

/** A face render/fonts.ts can inline. Free, OFL, and carrying Cyrillic —
 *  itself, or through the face it names as its Cyrillic stand-in. */
export type FaceId = 'arimo' | 'manrope' | 'jetbrains-mono' | 'urbanist' | 'roboto-condensed';

/**
 * A designed layout a theme can ask the PDF to be set in, instead of the
 * ordinary letterhead-and-flow page — see render/layouts/. Each is drawn by
 * hand from one designer's or one house's language, and lays out any
 * document's own blocks; it adds chrome and figures, never text.
 */
export const LAYOUT_IDS = ['rams', 'rodchenko', 'haskoning'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

/** Trim size in points, portrait. Chromium is given millimetres; see toMm. */
export const PAGE_PT: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};

export type Logo = {
  /** Inline SVG markup. Paints by class, never with an inline fill. */
  svg: string;
  heightPt: number;
  /**
   * The same mark as a raster, inline as a data: URI, for formats that cannot
   * be trusted with an SVG — Word's support for one is version-dependent. Null
   * when the theme supplies only a vector: a renderer that needs a raster then
   * prints the letterhead without a mark rather than substituting anything.
   *
   * A PNG is not repainted by a class, so this one does NOT follow the theme's
   * colours. A theme wanting a mark in Word supplies its own raster.
   */
  png: string | null;
};

export type Theme = {
  id: string;
  name: string;
  colors: {
    /** Used for the accent rule and the logo on white. */
    brandOnLight: string;
    /**
     * Null until a theme declares one. A renderer that needs it must fail
     * loudly: no single colour clears AA on both a light and a dark surface,
     * so silently reusing brandOnLight would ship an unreadable document.
     */
    brandOnDark: string | null;
    /**
     * The sheet itself. White unless a theme says otherwise, and a theme
     * that says otherwise prints it: Chromium is asked for backgrounds (see
     * pdf.ts) and Word is handed the same colour as the document background.
     * Marks may paint in it through the `c-paper` class, the way a glyph cut
     * out of a filled square shows the sheet through.
     */
    paper: string;
    ink: string;
    muted: string;
    rule: string;
    /**
     * The document title (meta.title), drawn on a cover/title page. Defaults
     * to the theme's own ink when a theme does not set one — see
     * resolveTheme — so a theme that says nothing about its title colour
     * renders it exactly like any other ink text, not muted.
     */
    title: string;
  };
  font: {
    /** The family name written into DOCX, where fonts are not embedded. */
    document: string;
    /** The body face embedded into PDFs — see render/fonts.ts for the set. */
    embed: FaceId;
    /**
     * Headings and the document title. Defaults to the body face at 700 —
     * see resolveTheme — which is exactly what every theme drew before this
     * existed, so a theme that says nothing about it renders unchanged.
     */
    heading: { document: string; embed: FaceId; weight: number };
    /**
     * The small furniture — letterhead lines, table header cells, the running
     * header — set apart from the text in a face of its own, the way a Swiss
     * layout sets its labels in a monospace. Null keeps them in the body face.
     */
    label: { document: string; embed: FaceId; uppercase: boolean } | null;
  };
  logo: Logo | null;
  /**
   * The brand's corner glyph, drawn only on a cover page (`meta.cover ===
   * true`) — bleeding off the page's physical top-right, and again at the
   * cover panel's own corner. Shares Logo's shape (svg/heightPt/png) because
   * it is drawn the same way a logo is: an inline SVG that paints by class
   * for HTML/PDF, plus a raster for Word, where a class cannot paint an
   * asset. Null when a theme has no such mark — a cover then draws no corner
   * decoration rather than approximating one with CSS borders.
   */
  cornerMark: Logo | null;
  page: { size: PageSize; marginPt: number };
  type: {
    bodyPt: number;
    leading: number;
    /** The size of a document's title (meta.title), drawn on a cover/title
     *  page. Defaults to h1Pt when a theme does not set one — see
     *  resolveTheme — because most themes have no separate cover and want
     *  the title to read exactly like an h1. */
    titlePt: number;
    h1Pt: number;
    h2Pt: number;
    h3Pt: number;
    smallPt: number;
  };
  letterhead: string[];
  /**
   * How a cover's statement band (a quote between the cover's rules) is set
   * apart. 'tint' is a brand-tinted fill behind a thick brand bar; 'line' is a
   * brand hairline down its left edge and nothing behind it, for a theme whose
   * marks are drawn in line too. Defaults to 'tint', what every cover drew
   * before this existed.
   */
  coverStatement: 'tint' | 'line';
  /**
   * How an ordinary document's first page opens. 'band' is the logo on the
   * left, the letterhead ranged right, and the brand tick over a hairline
   * beneath — what every theme drew before this existed, and the default.
   * 'grid' sets the letterhead as numbered columns under a hairline, logo in
   * the first, and gives the title the page's width with the corner mark
   * standing beside it (see html.ts's gridMasthead). A cover draws neither.
   */
  masthead: 'band' | 'grid';
  /**
   * Null for the ordinary page. A layout id sets the PDF in that designed
   * layout (cover, first page, section openings, running foot, the gate
   * figure); Word keeps the ordinary page, in the theme's colours and faces,
   * because a designed page in Word would be a picture of one.
   */
  layout: LayoutId | null;
};

export const PT_TO_MM = 0.352778;

/** page.pdf() rejects `pt`; it accepts px, in, cm and mm. */
export function toMm(pt: number): string {
  return `${(pt * PT_TO_MM).toFixed(2)}mm`;
}
