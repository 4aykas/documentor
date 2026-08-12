import { chromium, type Browser, type Page } from 'playwright-core';
import type { Doc } from '../ir/types.js';
import { toMm, type Theme } from '../theme/types.js';
import { buildHtml, escapeHtml } from './html.js';
import { arimoFaceCss } from './fonts.js';
import { normalizePdfDates } from './normalize-pdf.js';

/**
 * How much of the top margin the running header occupies.
 *
 * Chromium draws header and footer templates in the page margin, in a context
 * that has none of the page's CSS. If the margin is smaller than the header,
 * the header is not dropped — it is drawn **over the body text**, and text
 * extraction cannot see the collision because both PDFs extract identically.
 * Measured 2026-08-12; it is why this constant exists rather than a guess at
 * the call site, and why the baseline test rasterises.
 */
export const RUNNING_HEADER_PT = 26;

/**
 * The second guard on "this renderer fetches nothing".
 *
 * `html.ts` already refuses to emit a remote `<img>`, but a promise enforced in
 * one place is enforced nowhere: a future stylesheet, favicon or redirect would
 * leak out silently, and the only symptom would be a PDF that quietly depends on
 * somebody else's server — and appears in their logs. Aborting at the browser
 * makes the property true rather than intended.
 *
 * Exported so a test can apply it to a page it owns and watch what happens.
 */
export async function blockNonDataRequests(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    return route.abort();
  });
}

/**
 * Inline styles only: the header context cannot see the document's stylesheet.
 *
 * Chromium renders header/footer templates through its own print-preview path,
 * which resolves `font-family: Arial` to whatever the OS provides — on this
 * machine that's a real ArialMT face with no Cyrillic or Polish-diacritic
 * coverage, so a non-Latin title silently fell back to a second, unembedded
 * font (visible as an extra /BaseFont, and as spurious inter-glyph spaces
 * once pdfjs pulls the header run out through a different font than the
 * body). The header template is still just HTML+CSS though, so embedding the
 * same @font-face data URIs used in the body fixes it the same way.
 */
async function runningHeader(doc: Doc, theme: Theme): Promise<string> {
  const faces = await arimoFaceCss();
  const pad = `${(theme.page.marginPt * 1.333).toFixed(0)}px`;
  return `<style>${faces}</style>
<div style="width:100%;padding:0 ${pad};font-family:Arimo,Arial,sans-serif;font-size:7pt;color:${theme.colors.muted};display:flex;justify-content:space-between;">
<span>${escapeHtml(doc.meta.title)}</span>
<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

export async function renderPdf(
  doc: Doc,
  theme: Theme,
  opts: { epochSeconds: number; browser?: Browser },
): Promise<Buffer> {
  const html = await buildHtml(doc, theme, { headerHeightPt: RUNNING_HEADER_PT });
  const browser = opts.browser ?? (await chromium.launch());
  const ownsBrowser = opts.browser === undefined;
  try {
    const page = await browser.newPage();
    await blockNonDataRequests(page);
    // 'load' is safe with the route guard active: an aborted request fires
    // 'requestfailed' rather than hanging the load event, since Chromium
    // treats an aborted request as a completed (failed) one, not a pending
    // one. What load does NOT guarantee is that @font-face has finished
    // decoding, so the explicit document.fonts.ready wait below is what
    // actually keeps the first page from rasterising with a fallback face.
    await page.setContent(html, { waitUntil: 'load' });
    // A string, not a closure: this project's tsconfig has no "dom" lib (it's
    // a Node CLI), so `document` is not a type it knows about. Playwright
    // evaluates a string in the page's own context regardless.
    await page.evaluate('document.fonts.ready');
    const raw = await page.pdf({
      format: theme.page.size === 'A4' ? 'A4' : 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: await runningHeader(doc, theme),
      footerTemplate: '<span></span>',
      margin: {
        // page.pdf() rejects `pt`; mm is the unit the theme converts into.
        top: toMm(theme.page.marginPt + RUNNING_HEADER_PT),
        bottom: toMm(theme.page.marginPt),
        left: toMm(theme.page.marginPt),
        right: toMm(theme.page.marginPt),
      },
    });
    await page.close();
    return normalizePdfDates(Buffer.from(raw), opts.epochSeconds);
  } finally {
    if (ownsBrowser) await browser.close();
  }
}
