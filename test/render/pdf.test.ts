import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { blockNonDataRequests, renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { pdfText } from '../helpers/pdf-text.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

const render = (md: string) =>
  renderPdf(ingestMarkdown(md).doc, theme, { epochSeconds: EPOCH, browser });

describe('renderPdf', () => {
  it('produces identical bytes on two runs', async () => {
    const md = '# Report\n\nHello, world.\n';
    const a = await render(md);
    await new Promise((r) => setTimeout(r, 1100)); // cross a second boundary
    const b = await render(md);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('renders Ukrainian and Polish with the embedded font', async () => {
    const buf = await render('# Тест\n\nПривіт, ґуля і їжак. Zażółć gęślą jaźń.\n');
    const text = (await pdfText(buf)).join(' ');
    expect(text).toContain('Привіт, ґуля і їжак.');
    expect(text).toContain('Zażółć gęślą jaźń.');
  });

  it('embeds Arimo subsets rather than substituting a system face', async () => {
    const buf = await render('# T\n\nПривіт. Zażółć.\n');
    const names = [...buf.toString('latin1').matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /Arimo/.test(n!))).toBe(true);
  });

  it('prints the title once — in the header, not twice in the body', async () => {
    const text = (await pdfText(await render('# Report\n\nBody.\n'))).join(' ');
    expect(text.match(/Report/g)?.length).toBe(2); // the doc title and the running header
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

  it('paginates a long document and numbers every page', async () => {
    const long = `# Long\n\n${'Paragraph text that flows.\n\n'.repeat(200)}`;
    const pages = await pdfText(await render(long));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[pages.length - 1]).toMatch(new RegExp(`${pages.length} / ${pages.length}`));
  });
});
