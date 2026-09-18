// The Ukrainian entity theme, proved end to end rather than in the theme file
// alone. The defect it exists to close was never "the JSON is wrong" — it was
// that a Ukraine-scope document printed the *Polish* company's NIP above text
// that did not apply to it. A theme that carries the right letterhead and a
// renderer that does not print it is the same defect with a green unit test.
//
// Both renderers, because they have drifted from each other on the letterhead
// once already (see src/render/letterhead.ts's own module comment): a document
// that names its issuer in the PDF and goes silent about it in the Word copy
// is exactly the failure this pair of assertions is here to catch.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderDocx } from '../../src/render/docx.js';
import { renderPdf } from '../../src/render/pdf.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';
import { pdfText } from '../helpers/pdf-text.js';
import { resetPdfjsWorkerGlobal } from '../helpers/pdfjs-worker.js';

const EPOCH = 1_000_000_000;

// The registration numbers are the point: they are what says which of the
// three companies issued the document, so they are asserted as text a reader
// would see, not as a property of the theme object.
const UA_LINES = [
  'ТОВ «ТЕБІН.ПРО»',
  'Ярославська 58, Київ 04071, Україна',
  'ЄДРПОУ: 43655986 | ІНН: 436559826565',
];
const PL_REGISTRATION = 'NIP: 9552562516';

const SOURCE = '# ДОВІРЕНІСТЬ\n\nМісто Київ\n';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe('a document built with the tebin-ua theme', () => {
  it('prints the Ukrainian entity, and never the Polish registration, in the PDF', async () => {
    resetPdfjsWorkerGlobal();
    const theme = await loadTheme('tebin-ua');
    const pdf = await renderPdf(ingestMarkdown(SOURCE).doc, theme, { epochSeconds: EPOCH, browser });
    const text = (await pdfText(pdf)).join(' ');
    for (const line of UA_LINES) expect(text).toContain(line);
    expect(text).not.toContain(PL_REGISTRATION);
  });

  it('prints the Ukrainian entity, and never the Polish registration, in the Word copy', async () => {
    const theme = await loadTheme('tebin-ua');
    const docx = await renderDocx(ingestMarkdown(SOURCE).doc, theme, { epochSeconds: EPOCH });
    // The letterhead lives in the header part, not the body — asserting on
    // word/document.xml would pass for a document that prints no letterhead
    // at all.
    const header = await docxPart(docx, 'word/header2.xml');
    for (const line of UA_LINES) expect(header).toContain(line);
    expect(header).not.toContain(PL_REGISTRATION);
  });

  it('leaves the Polish theme printing the Polish registration', async () => {
    // The refactor that made the letterhead an argument could just as easily
    // have given both entities the same one. This is the other half of that
    // guard: parameterising must not have quietly moved the default.
    const theme = await loadTheme('tebin');
    const docx = await renderDocx(ingestMarkdown(SOURCE).doc, theme, { epochSeconds: EPOCH });
    const header = await docxPart(docx, 'word/header2.xml');
    expect(header).toContain(PL_REGISTRATION);
    expect(header).not.toContain('ЄДРПОУ');
  });
});
