import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import type { Doc } from '../ir/types.js';
import { toMm, type Theme } from '../theme/types.js';
import { buildHtml, escapeHtml } from './html.js';
import { arimoFaceCss } from './fonts.js';

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
/**
 * Two lines, hard-clamped, ellipsis on the rest — a title long enough to need
 * a third line is truncated instead of being handed the room to grow into.
 *
 * The comment on `margin` below already establishes why this has to exist:
 * Chromium does not clip an oversized header template, it paints straight
 * through the body's own ink, and no margin value changes that — the header
 * grows downward from a fixed point near the page's physical top no matter
 * how much room the margin gives it. The only guard left is bounding the
 * title itself.
 *
 * Two is not an arbitrary number. Measured on this machine (kitchen-sink
 * fixture, a synthetic ~1000-character title, raster decoded for real ink,
 * not pdfjs text — see docs/superpowers/notes/2026-08-13-header-bound-repro.md):
 * a single wrapped header line is ~7.5pt tall, a one-line header's own ink
 * already sits 15.75–22.25pt from the page's physical top (the sweep behind
 * `margin` below), and the body's first line starts at ~55.25pt on this
 * project's default 48pt page margin — a 33pt gap for one line. A second
 * line adds one more ~7.5pt row (ink to ~29.75pt), leaving ~25.5pt of gap —
 * still well clear of the 12pt legibility floor that sweep was judged
 * against. A third line would leave ~18pt, a fourth ~10.5pt — under the
 * floor — so two lines is the most this header can safely claim without the
 * margin doing any of the work: it holds even on a page whose own content
 * starts closer to the top than this project's default.
 *
 * `-webkit-line-clamp` was tried first and rejected by measurement, not by
 * taste: in Chromium's header-template sub-document it added the ellipsis
 * glyph to line two but did not actually clip the box — a third line of
 * ink still painted below it, raster-confirmed
 * (docs/superpowers/notes/2026-08-13-header-bound-repro.md). A plain fixed
 * `max-height` + `overflow:hidden` has no such box-model surprise: it clips
 * at an exact pixel height regardless of how many lines the text wanted, so
 * that is what this uses instead — a title that needs a third line loses it
 * outright (mid-glyph on whatever partial line peeks through), rather than
 * an ellipsis, but "clipped" is the property that matters here, not "tidy."
 *
 * Even `overflow:hidden` + `max-height` on their own, applied unconditionally,
 * were not free: giving the title `<span>` any non-`visible` overflow value
 * changes how Chromium's flexbox layout stretches it — `align-items:stretch`
 * is the flex row's default, and a flex item with `overflow: hidden` no
 * longer stretches to the row's cross-size the way a plain `visible` one
 * does, which nudged the whole running header a fraction of a point and
 * failed test/baseline/local-only-pixels.test.ts on the kitchen-sink
 * fixture's own, perfectly ordinary, single-line title (caught by running
 * that file, exactly as it exists to catch — see
 * docs/superpowers/notes/2026-08-13-header-bound-repro.md). Explicit
 * `line-height` was tried and rejected for the same reason first.
 *
 * The fix is to never hand a normal title this styling at all: the clamp
 * only gets added once the title is long enough that it could plausibly
 * need it, so a title that never comes near the limit — every title this
 * project has rendered before this, including the kitchen-sink fixture's —
 * gets the exact unstyled `<span>` it always got, byte-for-byte. Measured
 * on this machine (kitchen-sink theme/margins, `Word `-repeated titles of
 * increasing length, page 2's own text bucketed by y-coordinate — a cheap
 * proxy for line count, good enough to place a threshold well clear of any
 * boundary, not to prove the boundary's exact value): a title wraps to a
 * second header line somewhere around 105-110 characters and a third
 * somewhere around 135-140. `HEADER_TITLE_CLAMP_THRESHOLD_CHARS` (100) sits
 * comfortably below both — a handful of titles between 100 and ~135
 * characters that would actually still have fit on two lines unclamped get
 * the styling anyway, which is harmless (the clamp only clips what doesn't
 * already fit), while nothing anywhere near an ordinary title's length ever
 * reaches it.
 */
const HEADER_TITLE_LINE_HEIGHT_PT = 7.5;
const HEADER_TITLE_MAX_LINES = 2;
const HEADER_TITLE_CLAMP_THRESHOLD_CHARS = 100;

async function runningHeader(doc: Doc, theme: Theme): Promise<string> {
  const faces = await arimoFaceCss();
  const pad = `${(theme.page.marginPt * 1.333).toFixed(0)}px`;
  const maxHeight = `${HEADER_TITLE_LINE_HEIGHT_PT * HEADER_TITLE_MAX_LINES}pt`;
  const titleStyle = doc.meta.title.length > HEADER_TITLE_CLAMP_THRESHOLD_CHARS ? ` style="max-height:${maxHeight};overflow:hidden;"` : '';
  return `<style>${faces}</style>
<div style="width:100%;padding:0 ${pad};font-family:Arimo,Arial,sans-serif;font-size:7pt;color:${theme.colors.muted};display:flex;justify-content:space-between;">
<span${titleStyle}>${escapeHtml(doc.meta.title)}</span>
<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

/**
 * Turns an epoch into the `Date` pdf-lib's `setCreationDate`/`setModificationDate`
 * want, guarded because an out-of-range or non-integer epoch produces an Invalid Date
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
  const html = await buildHtml(doc, theme);
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
      // The top margin is the theme's own — no extra band reserved for the
      // running header, and none is needed. Chromium draws the header
      // template from a fixed offset near the page's *physical* top edge,
      // independent of the margin passed here: a sweep over 0, 4, 8 and
      // 12pt of extra band (2026-08-12, kitchen-sink fixture, TEBIN theme,
      // page 2 rasterised and decoded by hand for real ink) found the
      // header's own ink holding at 15.75–22.25pt from the top at every
      // value, while the body's first ink already started at 55.25pt with
      // no extra band at all — a 33pt gap, comfortably past the 12pt
      // legibility floor the sweep was judged against. That is why this is
      // just `theme.page.marginPt`, on all four sides, rather than a
      // constant added to top alone.
      //
      // What no margin value can fix: an oversized header is not clipped,
      // it **overprints the body** — proved by forcing a ~1000-character
      // mixed-script title to wrap onto 7 lines and watching it overlap a
      // later page's own heading. Text extraction cannot see this collision
      // (a good and a broken file extract identically); only rasterising
      // can, which is why the baseline test does. The risk belongs to a
      // pathologically long document title, not to this margin — the header
      // grows downward from a fixed point near the physical page top no
      // matter how much room the margin gives it, so no margin value here
      // guards against a title long enough to wrap multiple times.
      const margin = {
        // page.pdf() rejects `pt`; mm is the unit the theme converts into.
        top: toMm(theme.page.marginPt),
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
