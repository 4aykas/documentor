import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import type { Doc } from '../ir/types.js';
import { toMm, type Theme } from '../theme/types.js';
import { buildHtml, escapeHtml } from './html.js';
import { arimoFaceCss } from './fonts.js';

/**
 * How much of the top margin the running header occupies, beyond the
 * theme's own margin.
 *
 * Chromium draws header and footer templates in the page margin, in a context
 * that has none of the page's CSS. If the margin is smaller than the header,
 * the header is not dropped — it is drawn **over the body text**, and text
 * extraction cannot see the collision because both PDFs extract identically.
 * Measured 2026-08-12; it is why this constant exists rather than a guess at
 * the call site, and why the baseline test rasterises.
 *
 * Set to 0 on 2026-08-12 by a sweep, not a guess: 0, 4, 8 and 12 were each
 * rendered on the kitchen-sink fixture (TEBIN theme), page 2 rasterised at
 * 4x, and the PNG decoded by hand (real ink, not pdfjs coordinates — the
 * instrument that got the earlier negative-margin question wrong) to find
 * the header's own inked rows and the body's first inked row:
 *
 *   band(pt) | header ink (pt from top) | body ink starts (pt) | gap (pt)
 *   0        | 15.75–22.25              | 55.25                 | 33.00
 *   4        | 15.75–22.25              | 59.00                 | 36.75
 *   8        | 15.75–22.25              | 62.75                 | 40.50
 *   12       | 15.75–22.25              | 67.25                 | 45.00
 *
 * The header's ink sits at a fixed offset from the page's physical top edge
 * in every row — confirming, rather than assuming, that Chromium anchors the
 * header template independently of the margin box it's given, which is the
 * premise the whole sweep rests on. The chosen value is the smallest band
 * where the header's ink does not touch the body **and** at least 12pt of
 * clear space remains (a legibility floor, not a collision margin) — and
 * that was already true at 0: the theme's own margin alone gives a 33pt gap,
 * so no extra band is needed at all.
 *
 * A header long enough to wrap onto multiple lines was checked separately,
 * because it is the one way a 0pt band could still fail: Chromium does not
 * clip an oversized header template, it lets it **overprint the body** —
 * confirmed by forcing a ~1000-character mixed-script title (30 repeats of
 * the kitchen-sink title) to wrap onto 7 lines, which visibly overlapped
 * page 2's first heading. Each wrapped line adds a consistent ~7.5pt (the
 * spacing measured between stacked header lines in that test); a real title
 * long enough to wrap even once did not occur until roughly 100 mixed-script
 * characters (3 repeats of the kitchen-sink title still fit on one line, ~32
 * characters), far past any title this project's fixtures or the owner's
 * documents use — the kitchen-sink title itself never wraps. If it ever did
 * wrap to two lines, extrapolating the measured 7.5pt/line still leaves
 * 20+pt of clearance at this 0pt band. The real risk is not this constant —
 * it is a pathologically long title, which would eventually overprint the
 * body at *any* band width, because the header grows downward from a fixed
 * point near the page's physical top regardless of how much room it's given.
 * That is a title-length problem, not something this constant can fix.
 */
export const RUNNING_HEADER_PT = 0;

/**
 * The second guard on "this renderer fetches nothing".
 *
 * `html.ts` already refuses to emit a remote `<img>`, but a promise enforced in
 * one place is enforced nowhere: a future stylesheet, favicon or redirect would
 * leak out silently, and the only symptom would be a PDF that quietly depends on
 * somebody else's server — and appears in their logs. Aborting at the browser
 * makes the property true rather than intended.
 *
 * Exported so a test can apply it to a page it owns and watch what happens —
 * but that alone would leave the wiring untested, so test/render/pdf.ts also
 * watches the page renderPdf makes internally, through a caller-supplied
 * context (see the `context` option below).
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

/**
 * Turns an epoch into the `Date` pdf-lib's `setCreationDate`/`setModificationDate`
 * want, with the same guards `normalize-pdf.ts`'s `stampOf` applies for the
 * same reason: an out-of-range or non-integer epoch produces an Invalid Date
 * silently rather than a thrown error, and pdf-lib would happily encode that
 * as a literal "D:NaNNaN…" string into the saved file. `resolveEpoch` already
 * keeps normal callers inside range; this is the backstop for a caller that
 * doesn't go through it (SOURCE_DATE_EPOCH, tests).
 */
function dateFromEpoch(epochSeconds: number): Date {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0) {
    throw new Error(`epoch must be a non-negative whole number of seconds, got ${epochSeconds}`);
  }
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`epoch ${epochSeconds} does not fall within the representable Date range`);
  }
  return d;
}

/**
 * Page 1 from `withoutHeader`, pages 2..N from `withHeader` — both renders of
 * the same HTML at the same margins (see the pagination-equality measurement
 * in docs/superpowers/notes/2026-08-12-clean-first-page-spike.md), so "page 2
 * onward" means the same content either way.
 *
 * `updateMetadata: false` on every `PDFDocument.create()`/`.load()` call is
 * load-bearing, not cosmetic: pdf-lib's default writes `new Date()` into a
 * fresh document's `/Info` dict at construction time, which would make this
 * function — and therefore renderPdf — non-deterministic on every call. The
 * option only exists on `create`/`load`; passing it to `.save()` instead
 * compiles but does nothing, which is how the spike caught it. With the
 * option, the merged document carries no `/Info` dict at all, so the date
 * this project promises (SOURCE_DATE_EPOCH or the input's mtime, never the
 * wall clock) has to be written back in explicitly — hence the two
 * `set*Date` calls below, rather than trusting pdf-lib's own default.
 */
async function stitchCleanFirstPage(withHeader: Buffer, withoutHeader: Buffer, epochSeconds: number): Promise<Buffer> {
  const empty = await PDFDocument.load(withoutHeader, { updateMetadata: false });
  const real = await PDFDocument.load(withHeader, { updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });

  const [firstPage] = await out.copyPages(empty, [0]);
  if (firstPage === undefined) throw new Error('the empty-header render produced no page 1 to stitch');
  out.addPage(firstPage);

  // A single-page document has no "pages 2..N" — copyPages with an empty
  // index array is a no-op, but skipping the call entirely says so directly
  // rather than relying on that being true of an edge case nobody asked for.
  const pageCount = real.getPageCount();
  if (pageCount > 1) {
    const rest = await out.copyPages(real, Array.from({ length: pageCount - 1 }, (_, i) => i + 1));
    for (const p of rest) out.addPage(p);
  }

  const date = dateFromEpoch(epochSeconds);
  out.setCreationDate(date);
  out.setModificationDate(date);

  return Buffer.from(await out.save());
}

/**
 * `browser` and `context` are both ways for a caller to supply the Chromium it
 * already has, rather than paying a launch per document — the CLI will batch
 * that way, and every test file already does. `context` is the more specific
 * of the two: a BrowserContext emits `page`, `request` and `requestfailed` for
 * every page opened inside it, which is the only way an outside observer can
 * watch the page this function creates for itself. `browser.newPage()` hides
 * its context, so a guard applied to that page is unobservable — and an
 * unobservable guard is an untestable one.
 */
export async function renderPdf(
  doc: Doc,
  theme: Theme,
  opts: { epochSeconds: number; browser?: Browser; context?: BrowserContext },
): Promise<Buffer> {
  const html = await buildHtml(doc, theme, { headerHeightPt: RUNNING_HEADER_PT });
  const browser = opts.context !== undefined ? undefined : opts.browser ?? (await chromium.launch());
  const ownsBrowser = opts.context === undefined && opts.browser === undefined;
  try {
    const page = opts.context !== undefined ? await opts.context.newPage() : await browser!.newPage();
    // Own try/finally around the page, nested inside the browser's: when the
    // caller supplies the browser (every test file, and how a CLI would
    // batch many documents through one browser process), the outer finally
    // only closes what this call opened — the browser survives on purpose.
    // Without closing the page here too, a thrown setContent/pdf() leaves
    // that page and its renderer process alive for the browser's lifetime.
    try {
      await blockNonDataRequests(page);
      // 'load' is safe with the route guard active: an aborted request fires
      // 'requestfailed' rather than hanging the load event, since Chromium
      // treats an aborted request as a completed (failed) one, not a pending
      // one. What load does NOT guarantee is that @font-face has finished
      // decoding, so the explicit document.fonts.ready wait below is what
      // actually keeps the first page from rasterising with a fallback face.
      await page.setContent(html, { waitUntil: 'load' });
      // A string, not a closure: this project's tsconfig has no "dom" lib
      // (it's a Node CLI), so `document` is not a type it knows about.
      // Playwright evaluates a string in the page's own context regardless.
      await page.evaluate('document.fonts.ready');
      const margin = {
        // page.pdf() rejects `pt`; mm is the unit the theme converts into.
        top: toMm(theme.page.marginPt + RUNNING_HEADER_PT),
        bottom: toMm(theme.page.marginPt),
        left: toMm(theme.page.marginPt),
        right: toMm(theme.page.marginPt),
      };
      // Two renders of the one page already loaded with the one HTML string:
      // same body layout both times (headerTemplate never reaches the body's
      // layout box — measured in the spike), so pagination is identical and
      // only the header band differs. That equality is what makes it safe to
      // take page 1 from one render and pages 2..N from the other below.
      const withHeader = await page.pdf({
        format: theme.page.size === 'A4' ? 'A4' : 'Letter',
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: true,
        headerTemplate: await runningHeader(doc, theme),
        footerTemplate: '<span></span>',
        margin,
      });
      const withoutHeader = await page.pdf({
        format: theme.page.size === 'A4' ? 'A4' : 'Letter',
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<span></span>',
        margin,
      });
      return await stitchCleanFirstPage(Buffer.from(withHeader), Buffer.from(withoutHeader), opts.epochSeconds);
    } finally {
      await page.close();
    }
  } finally {
    if (ownsBrowser) await browser!.close();
  }
}
