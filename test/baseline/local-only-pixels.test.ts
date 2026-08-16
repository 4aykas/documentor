import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Block, Doc } from '../../src/ir/types.js';
import { renderPdf } from '../../src/render/pdf.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { rasterPages } from '../helpers/raster.js';
import { resetPdfjsWorkerGlobal } from '../helpers/pdfjs-worker.js';

// Everything in this file is a byte comparison of a rasterised PNG against a
// committed baseline, and none of it runs in CI. A PNG produced from the
// same PDF differs across platforms and even across Chromium builds on the
// same platform — CI's first real run proved this: the pages it rendered on
// windows-latest were visually identical to the committed baselines (same
// layout, same embedded Arimo, same Cyrillic and Polish glyphs) and still
// failed a byte comparison against images approved on this machine. A
// tolerant pixel-diff threshold was considered and rejected — the design
// says not to byte-compare rasterised output, and a fuzzy version of the
// same check just moves the false-positive rate instead of removing it. A
// check that cries wolf stops being read.
//
// So these images are a local, human-approved instrument: run them here,
// look at the result yourself, and commit the baseline once you agree it's
// right. They are deliberately kept in their own file, separate from
// kitchen-sink.test.ts and tebin.test.ts, so that the checks in those two
// files that are NOT rasterisation-dependent — the running header not
// colliding with the body, the fixture spanning more than one page, ingest
// dropping nothing, the Markdown round trip, the TEBIN theme's markup
// assertions — keep running in CI on all three platforms.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BASELINE = join(HERE, '__baseline__');
const ACTUAL = join(HERE, '__actual__');
const EPOCH = 1_000_000_000;

let browser: Browser;
let source: string;
beforeAll(async () => {
  browser = await chromium.launch();
  source = await readFile(join(HERE, '..', 'fixtures', 'kitchen-sink.md'), 'utf8');
});
afterAll(async () => { await browser.close(); });

describe('kitchen sink baseline (local pixels only)', () => {
  it('every page matches its committed image', async () => {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));

    // Every page is written before any page is compared. The two used to be
    // one loop, and the first mismatch threw — so the later pages were never
    // written at all, and re-approving a change meant running the test once
    // per page. What you review has to be the whole document.
    await mkdir(ACTUAL, { recursive: true });
    const names = pages.map((_, i) => `page-${String(i + 1).padStart(2, '0')}.png`);
    for (const [i, png] of pages.entries()) await writeFile(join(ACTUAL, names[i]!), png);
    for (const [i, png] of pages.entries()) {
      const name = names[i]!;
      const golden = join(BASELINE, name);
      expect(existsSync(golden), `no baseline for ${name} — review test/baseline/__actual__/${name} and copy it into __baseline__ if it is correct`).toBe(true);
      expect(png.equals(await readFile(golden)), `${name} differs from its baseline; compare it with test/baseline/__actual__/${name}`).toBe(true);
    }
  });
});

/**
 * A cover page had no picture in this file for its whole life, and two faults
 * lived in it undetected through 618 passing tests: the panel's corner mark
 * was clipped to a thin hook (bars measured 28% of the glyph against the
 * asset's 49%), and the overhang that clipped it also overflowed the content
 * box horizontally, which made Chromium shrink the entire page to fit — every
 * measurement on the cover came out about 9% small. Neither is expressible as
 * a markup assertion: the markup was correct both times. This is the
 * instrument that sees them.
 *
 * The document is built as IR rather than ingested from a fixture file so the
 * three things under test — the panel, the statement band between the rules,
 * and the foot after the last one — are visible here, in the test, instead of
 * being a property of a Markdown file somebody has to open to understand.
 */
const para = (v: string): Block => ({ t: 'para', text: [{ t: 'text', v }] });

/** One cover, rendered by every theme that gets a picture, so the images are
 *  comparable rather than each showing a different document. */
const COVER: Doc = {
  meta: { title: 'COMMERCIAL PROPOSAL', lang: 'en', cover: true },
  blocks: [
    para('ENGINEERING SERVICE'),
    para('PROJECT — Baseline Fixture'),
    { t: 'rule' },
    para('Reference 0000-00-00A'),
    { t: 'quote', paras: [[{ t: 'text', v: 'Baseline Fixture' }], [{ t: 'text', v: 'The statement band, centred in the cover’s middle.' }]] },
    para('A. Author'),
    { t: 'rule' },
    para('TEBIN.PRO sp. z o.o.'),
  ],
};

/** Renders `doc` with `themeId` and compares page one against `name`. */
async function expectPageOneMatches(doc: Doc, themeId: string, name: string): Promise<void> {
  const theme = await loadTheme(themeId);
  resetPdfjsWorkerGlobal();
  const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
  await mkdir(ACTUAL, { recursive: true });
  await writeFile(join(ACTUAL, name), pages[0]!);
  const golden = join(BASELINE, name);
  expect(existsSync(golden), `no baseline yet — review test/baseline/__actual__/${name} and copy it into __baseline__ if it is correct`).toBe(true);
  expect(pages[0]!.equals(await readFile(golden)), `${name} differs from its baseline; compare it with test/baseline/__actual__/${name}`).toBe(true);
}

describe('a TEBIN cover page (local pixels only)', () => {
  it('page one matches its committed image', async () => {
    await expectPageOneMatches(COVER, 'tebin', 'tebin-cover-01.png');
  });
});

/**
 * The same cover under the other bundled theme, and it is here because of
 * what looking at one only cost. Three defects in a row lived exactly where
 * nobody had rendered anything but TEBIN: the statement band's headline came
 * out at 9pt against a 10pt body, because half of `plain`'s modest titlePt
 * is smaller than its prose; the heatmap's darkest cells drew black numbers
 * on a black fill, because `plain`'s brand IS its ink; and a README pointer
 * that only a packaged install could see. A theme is a configuration this
 * renderer is supposed to serve, not a decoration on one company's document.
 */
describe('the same cover under the plain theme (local pixels only)', () => {
  it('page one matches its committed image', async () => {
    await expectPageOneMatches(COVER, 'plain', 'plain-cover-01.png');
  });
});

/**
 * The heatmap under a theme whose brand is as dark as its ink. Values are
 * chosen to land on every step of the scale, including the darkest, which is
 * the one that printed its number invisibly. A markup assertion cannot see
 * this — the number was in the XML the whole time, in a colour nobody could
 * read.
 */
describe('the heatmap under the plain theme (local pixels only)', () => {
  it('page one matches its committed image', async () => {
    const doc: Doc = {
      meta: { title: 'Involvement', lang: 'en' },
      blocks: [{
        t: 'heatmap', style: 'numbers',
        rows: [
          { label: 'Lead', values: [40, 30, 20, 8, 2] },
          { label: 'Support', values: [4, 8, 16, 32, 40] },
        ],
      }],
    };
    await expectPageOneMatches(doc, 'plain', 'plain-heatmap-01.png');
  });
});

describe('the TEBIN theme (local pixels only)', () => {
  it('page one matches its committed image', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
    await mkdir(ACTUAL, { recursive: true });
    await writeFile(join(ACTUAL, 'tebin-page-01.png'), pages[0]!);
    const golden = join(BASELINE, 'tebin-page-01.png');
    expect(existsSync(golden), 'no baseline yet — review test/baseline/__actual__/tebin-page-01.png and copy it into __baseline__ if it is correct').toBe(true);
    expect(pages[0]!.equals(await readFile(golden))).toBe(true);
  });
});
