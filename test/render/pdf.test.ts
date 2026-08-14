import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { Doc } from '../../src/ir/types.js';
import { blockNonDataRequests, renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { pdfText } from '../helpers/pdf-text.js';
import { rasterPages } from '../helpers/raster.js';
import { inkRowsFromPng } from '../helpers/png-ink.js';
import { resetPdfjsWorkerGlobal } from '../helpers/pdfjs-worker.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

const render = (md: string) =>
  renderPdf(ingestMarkdown(md).doc, theme, { epochSeconds: EPOCH, browser });

describe('renderPdf', () => {
  it('produces identical bytes on two runs', async () => {
    // Determinism used to be a post-processing pass' job (substituting the two
    // date fields Chromium's own output carries). It is now a property of the
    // stitch instead: pdf-lib's `updateMetadata: false` on every
    // create()/load() call in stitchCleanFirstPage keeps it from writing
    // `new Date()` into a fresh /Info dict — see the spike note and the
    // comment on stitchCleanFirstPage in pdf.ts.
    const md = '# Report\n\nHello, world.\n';
    const a = await render(md);
    await new Promise((r) => setTimeout(r, 1100)); // cross a second boundary
    const b = await render(md);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('carries the epoch date, even though the stitch leaves pdf-lib no /Info dict to inherit it from', async () => {
    // A fresh PDFDocument.create({ updateMetadata: false }) writes no /Info
    // dict at all — deterministic, but silent about the date this project
    // promises never comes from the wall clock. renderPdf has to set it back
    // explicitly; this reads the produced bytes back through pdf-lib (not a
    // regex — a pdf-lib document compresses its /Info dict into an object
    // stream no plain-text search can reach; see the clean-first-page spike
    // note) to prove it actually
    // landed, not just that the code that means to set it ran.
    const buf = await render('# Report\n\nHello, world.\n');
    const readBack = await PDFDocument.load(buf, { updateMetadata: false });
    const expected = new Date(EPOCH * 1000);
    expect(readBack.getCreationDate()?.getTime()).toBe(expected.getTime());
    expect(readBack.getModificationDate()?.getTime()).toBe(expected.getTime());
  });

  it('renders Ukrainian and Polish with the embedded font', async () => {
    const buf = await render('# Тест\n\nПривіт, ґуля і їжак. Zażółć gęślą jaźń.\n');
    const text = (await pdfText(buf)).join(' ');
    expect(text).toContain('Привіт, ґуля і їжак.');
    expect(text).toContain('Zażółć gęślą jaźń.');
  });

  it('embeds Arimo subsets rather than substituting a system face', async () => {
    // Not a raw-bytes regex any more: pdf-lib's writer (the stitch's output,
    // now every renderPdf output) groups most indirect objects, including
    // /BaseFont dicts, into compressed /ObjStm object streams, so a
    // plain-text search over the buffer finds nothing — see the spike note
    // on why the same is true of the /Info dict. Walking the object graph
    // through pdf-lib's own API is the instrument that still reaches them.
    const buf = await render('# T\n\nПривіт. Zażółć.\n');
    const readBack = await PDFDocument.load(buf, { updateMetadata: false });
    const names: string[] = [];
    for (const [, obj] of readBack.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const baseFont = obj.get(PDFName.of('BaseFont'));
        if (baseFont !== undefined) names.push(baseFont.toString().replace(/^\//, ''));
      }
    }
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /Arimo/.test(n))).toBe(true);
  });

  it('prints the title once — page one carries no running header to duplicate it', async () => {
    // This is the bug the clean-first-page change exists to fix: before it,
    // page one printed the title as its own <h1> *and* Chromium's running
    // header repeated it a few points above, in the same document. Page one
    // is now stitched in from the empty-header render, so a short,
    // single-page document should show the title exactly once.
    const text = (await pdfText(await render('# Report\n\nBody.\n'))).join(' ');
    expect(text.match(/Report/g)?.length).toBe(1);
  });

  it('renders a single-page document with no running-header chrome at all', async () => {
    // The case most likely to be broken by a page-1/page-2..N stitch and
    // least likely to be looked at: there is no "pages 2..N" to copy from
    // the real-header render, so the stitch must still produce a valid
    // one-page document from page 1 of the empty-header render alone.
    const buf = await render('# Solo\n\nOne short paragraph, nothing else.\n');
    const pages = await pdfText(buf);
    expect(pages.length).toBe(1);
    // No "N / M" counter and no repeated title — both are the running
    // header's signature, and page one has none of it.
    expect(pages[0]).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(pages[0]?.match(/Solo/g)?.length).toBe(1);
  });

  it('lets nothing off the machine, even when the document asks', async () => {
    // A document is untrusted input. If this ever fails, a rendered PDF has
    // become dependent on somebody else's server — and on their logs.
    //
    // The listener has to go on a page this test owns, because renderPdf makes
    // its own; so the guard is exported and applied here to the same effect.
    const page = await browser.newPage();
    const attempted: string[] = [];
    page.on('request', (r) => attempted.push(r.url()));
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));

    await blockNonDataRequests(page);
    await page.setContent(
      '<img src="https://example.invalid/chart.png"><link rel="stylesheet" href="https://example.invalid/a.css">',
      { waitUntil: 'load' },
    );
    await page.close();

    const remote = (us: string[]) => us.filter((u) => !u.startsWith('data:') && !u.startsWith('about:'));
    // Chromium still *attempts* them — the point is that every attempt died at
    // the route handler instead of reaching a socket.
    expect(remote(attempted).length).toBeGreaterThan(0);
    expect(remote(failed).sort()).toEqual(remote(attempted).sort());
  });

  it('aborts a remote request made by the page renderPdf opens for itself', async () => {
    // The test above proves the guard works; on its own it does not prove the
    // guard is *wired in* — delete the blockNonDataRequests call from
    // renderPdf and that test still passes, because it watches a page it made
    // itself. This one watches the page renderPdf makes.
    //
    // A BrowserContext reports request events for every page opened inside it,
    // so handing renderPdf a context this test owns is enough to observe its
    // internal page without mocking anything.
    //
    // The remote request is smuggled in through the theme's logo, which is
    // inline SVG spliced into the document verbatim: html.ts refuses a remote
    // `image` block, but it does not parse a theme's SVG, and an <image href>
    // inside one is a fetch. That is exactly the leak this second line of
    // defence exists for, so it is what the test uses.
    const HOST = 'documentor-must-never-fetch.invalid';
    const leaky = resolveTheme({
      id: 'leaky',
      colors: { brandOnLight: '#DA291C' },
      logo: { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="12"><image href="https://${HOST}/mark.png" width="40" height="12"/></svg>`, heightPt: 12 },
    });

    const context = await browser.newContext();
    const seen: { url: string; error: string }[] = [];
    context.on('requestfailed', (r) => seen.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
    context.on('response', (r) => seen.push({ url: r.url(), error: 'RESPONDED' }));
    try {
      await renderPdf(ingestMarkdown('# T\n\nBody.\n').doc, leaky, { epochSeconds: EPOCH, context });
    } finally {
      await context.close();
    }

    const remote = seen.filter((s) => s.url.includes(HOST));
    expect(remote.length, 'the logo image was never requested — this test no longer tests anything').toBeGreaterThan(0);
    for (const r of remote) {
      // net::ERR_FAILED is what route.abort() produces. ERR_NAME_NOT_RESOLVED
      // would mean the request left the process and the guard did nothing.
      expect(r.error, `${r.url} escaped the route guard`).toBe('net::ERR_FAILED');
    }
  });

  it('draws a remote image as a placeholder rather than fetching it', async () => {
    const text = (await pdfText(await render('# T\n\n![A chart](https://example.invalid/chart.png)\n'))).join(' ');
    expect(text).toContain('A chart');
    expect(text).toContain('example.invalid');
  });

  it('closes the page even when the render throws, on a caller-owned browser', async () => {
    // renderPdf never owns this browser (the whole suite shares it via
    // `render`, exactly like a CLI batching many documents through one
    // browser process would), so the only thing that can stop a failed
    // render from leaking a page is renderPdf closing its own page on the
    // error path. Force the failure inside page.pdf(), after the page
    // exists, so a leak here would actually be observable.
    const pagesOf = () => browser.contexts().flatMap((c) => c.pages());
    const before = pagesOf().length;

    const originalNewPage = browser.newPage.bind(browser);
    const spy = vi.spyOn(browser, 'newPage').mockImplementation(async (...args) => {
      const page = await originalNewPage(...args);
      vi.spyOn(page, 'pdf').mockRejectedValue(new Error('forced render failure'));
      return page;
    });

    await expect(render('# T\n\nBody.\n')).rejects.toThrow('forced render failure');
    spy.mockRestore();

    expect(pagesOf().length).toBe(before);
  });

  it('draws the running header on page 2+ the same way whether meta.cover suppresses page one\'s chrome or not', async () => {
    // meta.cover only reaches firstPageHeader() (see html.ts and
    // docx.ts) — pdf.ts's own runningHeader() builds an entirely separate
    // headerTemplate string it never touches. This proves that in a real
    // multi-page PDF: a document long enough to reach page 2, rendered once
    // with the flag absent and once with it true, must show the same
    // title/page-count running header on page 2 either way.
    const longBlocks: Doc['blocks'] = Array.from({ length: 40 }, () => ({
      t: 'para' as const,
      text: [{ t: 'text' as const, v: 'Paragraph text that flows and pushes content onto a later page.' }],
    }));
    const withoutFlag: Doc = { meta: { title: 'Running Header Title', lang: 'en' }, blocks: longBlocks };
    const suppressed: Doc = { meta: { title: 'Running Header Title', lang: 'en', cover: true }, blocks: longBlocks };

    const a = await renderPdf(withoutFlag, theme, { epochSeconds: EPOCH, browser });
    const b = await renderPdf(suppressed, theme, { epochSeconds: EPOCH, browser });
    const pagesA = await pdfText(a);
    const pagesB = await pdfText(b);
    expect(pagesA.length).toBeGreaterThan(1);
    expect(pagesB.length).toBe(pagesA.length);

    // Page 2's running header carries the title and an "N / M" counter in
    // both renders, unaffected by the flag.
    expect(pagesA[1]).toContain('Running Header Title');
    expect(pagesB[1]).toContain('Running Header Title');
    expect(pagesA[1]).toMatch(/2\s*\/\s*\d+/);
    expect(pagesB[1]).toMatch(/2\s*\/\s*\d+/);
  });

  it('paginates a long document and numbers every page', async () => {
    const long = `# Long\n\n${'Paragraph text that flows.\n\n'.repeat(200)}`;
    const pages = await pdfText(await render(long));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[pages.length - 1]).toMatch(new RegExp(`${pages.length} / ${pages.length}`));
  });

  it("keeps a pathologically long title's running header above a later page's own first line, checked in real ink — not text coordinates", async () => {
    // pdfjs text extraction cannot see this defect: a good render and a
    // broken one extract the same text at the same coordinates either way,
    // because the header text is still *there*, just painted through the
    // page's own content underneath it. Only a decoded raster shows two
    // things sharing the same pixels — see
    // docs/superpowers/notes/2026-08-13-header-bound-repro.md, where this
    // exact test failed against the unclamped header (three "Word Word…"
    // lines merging into a single ink band with "Heading on page two").
    //
    // The title below is ~1000 characters of short space-separated words —
    // guaranteed to wrap past HEADER_TITLE_MAX_LINES if nothing clamps it,
    // the same shape of input the phase-2 residuals note recorded the
    // defect against (a ~1000-character title wrapping onto 7 lines).
    const longTitle = 'Word '.repeat(200).trim();
    const md =
      `# ${longTitle}\n\nFirst page paragraph.\n\n` +
      `${'Paragraph text that flows and pushes content onto a later page.\n\n'.repeat(40)}` +
      `# Heading on a later page\n\nBody text right after that heading.\n`;

    const buf = await render(md);
    const textPages = await pdfText(buf);
    const targetIndex = textPages.findIndex((t) => t.includes('Heading on a later page'));
    expect(targetIndex, 'fixture did not paginate the way this test assumes — the heading never landed on its own page').toBeGreaterThan(0);

    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(buf, 2);
    const png = pages[targetIndex]!;

    // Scan the top of the page — comfortably past where even an unclamped
    // 7-line header would end, comfortably short of where unrelated body
    // text further down the page would start. Group ink into contiguous
    // bands, merging gaps up to 15 raster px (~7.5pt at scale 2): the
    // header's own title and its "N / M" counter don't share one exact
    // baseline (measured — the counter's "/" and second digit sit 1-2pt
    // off the title's own two lines), which without a merge this small
    // would fragment a *single*, correctly-clamped header into two or three
    // bands of its own and make the very next comparison meaningless. 15px
    // absorbs that intra-header noise (the largest internal gap measured
    // was 6px) while staying well under the ~39px real gap this test found
    // between the header and the heading once the fix landed — so it still
    // reports one merged band, not two, when a header and the page's own
    // heading genuinely overlap or sit flush with no white space between
    // them, which is the failure this test exists to catch.
    const rows = inkRowsFromPng(png);
    const scanEnd = Math.min(rows.length, 400);
    const bands: { start: number; end: number }[] = [];
    for (let y = 0; y < scanEnd; y++) {
      if (rows[y]! >= 200) continue;
      const last = bands[bands.length - 1];
      if (last && y - last.end <= 15) last.end = y;
      else bands.push({ start: y, end: y });
    }

    // A merged header+heading is invisible to a "2 bands, some gap"
    // assertion on its own: the very first version of this test asserted
    // exactly that and still passed against the broken renderer, because
    // the swallowed heading left the *next* element (the paragraph below
    // it) as band two, with a real gap ahead of *that*. What actually
    // distinguishes "clamped" from "overprinting" is the height of the
    // first band itself: measured on this machine, a correctly clamped
    // 2-line header's own ink band is 71-32=39 raster px (19.5pt) tall; an
    // unclamped header that has swallowed "Heading on a later page" into
    // the same band measures 147-32=115 raster px (57.5pt) — see
    // docs/superpowers/notes/2026-08-13-header-bound-repro.md. 60px (30pt)
    // sits between the two with headroom on both sides.
    expect(bands.length, `expected at least the header, the heading, and the paragraph below it as separate ink bands; got ${JSON.stringify(bands)}`).toBeGreaterThanOrEqual(2);
    const headerBand = bands[0]!;
    expect(headerBand.end - headerBand.start, `the header's own ink band is ${headerBand.end - headerBand.start}px tall — that is wide enough to have swallowed the page's own first heading rather than staying clamped to it own two lines; got bands ${JSON.stringify(bands)}`).toBeLessThan(60);
  });
});
