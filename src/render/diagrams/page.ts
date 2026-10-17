// The page every diagram is drawn in: the theme's faces decoded, Mermaid and
// ELK loaded, nothing reachable outside it (docs/adr/0002).

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { Theme } from '../../theme/types.js';
import { themeFaceCss } from '../fonts.js';
import { blockNonDataRequests } from '../pdf.js';

/** Pixels Word and the screenshot are taken at, per CSS pixel. Three keeps a
 *  diagram's smallest label sharp on a printed Word page. */
export const PNG_SCALE = 3;

/**
 * Mermaid and its ELK layout ship as ES modules, which a page loads from a
 * URL. The page is therefore served from an origin that does not exist —
 * `.invalid` is reserved for exactly that — and every request to it is
 * answered from the installed packages; anything else is refused by the
 * same guard the PDF page uses. Nothing leaves the machine.
 */
const ORIGIN = 'https://documentor.invalid';
function packageRoot(name: string): string {
  return dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
}

/** A new page, ready to draw: the caller closes it. */
export async function openDiagramPage(browser: Browser, theme: Theme): Promise<Page> {
  const page = await browser.newPage({ deviceScaleFactor: PNG_SCALE });
  try {
    await blockNonDataRequests(page);
    const faces = await themeFaceCss(theme);
    const html = `<!doctype html><html><head><style>${faces}
      html,body{margin:0;background:${theme.colors.paper}} #host{display:inline-block}</style></head><body><div id="host"></div></body></html>`;
    const roots = { mermaid: join(packageRoot('mermaid'), 'dist'), elk: join(packageRoot('@mermaid-js/layout-elk'), 'dist') };
    // Registered after the guard, so it is asked first (Playwright tries the
    // newest route first) and answers only its own origin.
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ body: html, contentType: 'text/html' });
      const [, pkg, ...rest] = path.split('/');
      const root = pkg === 'mermaid' || pkg === 'elk' ? roots[pkg] : undefined;
      const file = root === undefined ? undefined : resolve(root, ...rest);
      if (file === undefined || !file.startsWith(root! + sep)) return route.abort();
      try {
        return await route.fulfill({ body: await readFile(file), contentType: 'text/javascript' });
      } catch {
        return route.abort();
      }
    });
    await page.goto(`${ORIGIN}/`);
    // Mermaid measures every label as it lays the diagram out, so the faces
    // must be decoded first or the boxes are sized for the fallback font.
    const families = [...new Set([theme.font.face, theme.font.heading.face].map((f) => f.family))];
    await page.evaluate(`Promise.all(${JSON.stringify(families)}.map((f) => document.fonts.load('16px "' + f + '"'))).then(() => document.fonts.ready)`);
    await page.evaluate(`(async () => {
      const m = (await import('${ORIGIN}/mermaid/mermaid.esm.min.mjs')).default;
      m.registerLayoutLoaders((await import('${ORIGIN}/elk/mermaid-layout-elk.esm.min.mjs')).default);
      globalThis.mermaid = m;
    })()`);
    return page;
  } catch (e) {
    await page.close();
    throw e;
  }
}
