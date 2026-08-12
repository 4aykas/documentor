export type PageSize = 'A4' | 'Letter';

/** Trim size in points, portrait. Chromium is given millimetres; see toMm. */
export const PAGE_PT: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};

export type Logo = {
  /** Inline SVG markup. Paints by class, never with an inline fill. */
  svg: string;
  heightPt: number;
  // No corner mark: the running header draws no mark yet, and a field that is
  // validated, carried and never read only looks like a feature. It comes back
  // with the header that draws it.
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
    ink: string;
    muted: string;
    rule: string;
  };
  font: {
    /** The family name written into DOCX, where fonts are not embedded. */
    document: string;
    /**
     * The family embedded into PDFs. Only 'arimo' exists, so nothing consults
     * this yet — it is a forward-compatibility guard, kept and validated so
     * that adding a second embeddable face does not force every theme file
     * already in the wild to change shape.
     */
    embed: 'arimo';
  };
  logo: Logo | null;
  page: { size: PageSize; marginPt: number };
  type: {
    bodyPt: number;
    leading: number;
    h1Pt: number;
    h2Pt: number;
    h3Pt: number;
    smallPt: number;
  };
  letterhead: string[];
};

export const PT_TO_MM = 0.352778;

/** page.pdf() rejects `pt`; it accepts px, in, cm and mm. */
export function toMm(pt: number): string {
  return `${(pt * PT_TO_MM).toFixed(2)}mm`;
}
