// One source of truth for a brand glyph's shape: its SVG.
//
// The corner mark used to be vendored twice — `corner-mark.svg` for the PDF
// and `corner-mark.png` for Word — and the two disagreed. The raster was
// short: its canvas was 256x260 but the ink stopped at y=203, so the vertical
// bar never reached the bottom edge and Word printed a glyph the brand does
// not have. Nothing could catch it, because a vendored binary is nobody's
// output; it is just a file somebody put there. Deriving the raster from the
// vector removes the disagreement rather than testing for it.
//
// Chromium does the drawing because Chromium already draws this project's
// PDFs (see render/pdf.ts) — the raster and the vector are then the same
// engine's reading of the same file, which is the property that matters. No
// network: the SVG is passed in as a string and the page loads nothing.

import { chromium, type Browser } from 'playwright-core';

/**
 * `svg` rasterised to `heightPx` tall on a transparent background, at whatever
 * width its own aspect ratio implies. Pass a `browser` to reuse one; otherwise
 * one is launched and closed here.
 */
export async function rasteriseSvg(svg: string, heightPx: number, browser?: Browser): Promise<Buffer> {
  const own = browser ?? (await chromium.launch());
  try {
    const page = await own.newPage();
    try {
      // width:auto lets the viewBox's aspect ratio pick the width, the same
      // way the stylesheet sizes the mark on a cover page.
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;padding:0;background:transparent}` +
          `svg{height:${heightPx}px;width:auto;display:block}</style>${svg}`,
        { waitUntil: 'load' },
      );
      const el = await page.$('svg');
      if (el === null) throw new Error('rasteriseSvg: the markup passed in contains no <svg> element');
      return await el.screenshot({ omitBackground: true, type: 'png' });
    } finally {
      await page.close();
    }
  } finally {
    if (browser === undefined) await own.close();
  }
}
