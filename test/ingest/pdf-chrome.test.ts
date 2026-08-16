import { describe, expect, it } from 'vitest';
import { splitChrome } from '../../src/ingest/pdf/chrome.js';
import type { TextRun } from '../../src/ingest/pdf/geometry.js';

const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

// A4 portrait, matching what this project's own geometry reader hands back
// for a real document (see test/ingest/pdf-geometry.test.ts).
const HEIGHT = 842;

describe('splitChrome', () => {
  it('drops a letterhead and a footer that repeat outside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),                              // letterhead, same place both pages
      run('NIP: 9552562516', 400, 788),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),        // body, different content
      run(`${n} / 2`, 500, 40),                                           // footer: repeats in POSITION only
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover February']);
    expect(dropped.join('\n')).toMatch(/page furniture/);
    // 3 positions * 2 pages: the report counts across the whole document,
    // not per page.
    expect(dropped.join('\n')).toMatch(/6 run/);
  });

  it('keeps a column that repeats position but sits inside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('Labor', 60, 600),                          // same x AND y on every page, but body content
      run(n === 1 ? 'Jan' : 'Feb', 300, 600),
      run('Other cost', 60, 580),
      run(n === 1 ? 'Jan' : 'Feb', 300, 580),
    ];
    const { body } = splitChrome([page(1), page(2)], HEIGHT);
    // 'Labor' and 'Other cost' repeat position on every page, exactly as the
    // letterhead does. What separates them is the body band: they sit inside
    // it, so they stay.
    expect(body[0]!.map((r) => r.text)).toEqual(['Labor', 'Jan', 'Other cost', 'Jan']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Labor', 'Feb', 'Other cost', 'Feb']);
  });

  it('keeps everything on a single-page document and says so', () => {
    const { body, dropped } = splitChrome([[run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Turnover', 60, 600)]], HEIGHT);
    expect(body[0]).toHaveLength(2);
    expect(dropped.join('\n')).toMatch(/single page/);
  });

  it('treats positions within 2pt as the same place, not a grid cell apart', () => {
    // A 0.5pt page rule produced x=661 on one page and x=662 on the next in
    // this project's own output. Rounding to a 1pt grid keeps those as two
    // positions; the fix is to cluster and use the mean instead.
    const page = (n: number, x: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),
      run(`${n} / 2`, x, 40),
    ];
    const { body, dropped } = splitChrome([page(1, 661), page(2, 662)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover February']);
    expect(dropped.join('\n')).toMatch(/4 run/);
  });

  it('drops a letterhead AND a footer on the same page, not just whichever tie-break used to win', () => {
    const page = (n: number): TextRun[] => [
      run('ACME SUPPLIES', 300, 800),                          // letterhead, identical text every page
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'}`, 60, 600),         // body, varies
      run(`${n} / 2`, 500, 40),                                 // footer, numeric template
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row Alpha']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row Beta']);
    // The report now lists what was actually dropped, so both furniture
    // texts must be named — this is a stronger check than "letterhead text
    // is absent from the report" ever was.
    expect(dropped.join('\n')).toMatch(/ACME SUPPLIES/);
    expect(dropped.join('\n')).toMatch(/4 run/); // 2 positions * 2 pages
  });

  it('keeps a repeated column header that sits between two body rows', () => {
    const page = (n: number): TextRun[] => [
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'} top`, 60, 670),
      run('Description', 60, 650),                              // identical text and position every page, but mid-band
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'} bottom`, 60, 630),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row Alpha top', 'Description', 'Row Alpha bottom']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row Beta top', 'Description', 'Row Beta bottom']);
    expect(dropped).toEqual([]);
  });

  it('keeps everything and says why when every run is a candidate', () => {
    // Same position, same text, on every page — there is no non-candidate
    // content anywhere to draw a body band from. Guessing which candidate
    // is furniture would be a coin-flip; this reader refuses instead.
    const page = (): TextRun[] => [run('Static disclaimer', 300, 500)];
    const { body, dropped } = splitChrome([page(), page()], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(dropped.join('\n')).toMatch(/no body content/);
  });

  it('keeps a realistic totals row: a static caption far from the edge stays body even though it is a candidate', () => {
    // "Total:" is a static caption, identical on every page, exactly like a
    // letterhead line — no text-only rule can tell them apart. What tells
    // them apart is that this one sits at 76% of the sheet from the bottom
    // edge, nowhere near the outer margin a real footer lives in.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Widget Alpha' : 'Widget Beta', 60, 700),
      run(n === 1 ? '$10.00' : '$20.00', 400, 700),
      run(n === 1 ? 'Gadget Alpha' : 'Gadget Beta', 60, 680),
      run(n === 1 ? '$15.00' : '$25.00', 400, 680),
      run('Total:', 300, 640),
      run(n === 1 ? '$100.00' : '$200.00', 400, 640),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Widget Alpha', '$10.00', 'Gadget Alpha', '$15.00', 'Total:', '$100.00']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Widget Beta', '$20.00', 'Gadget Beta', '$25.00', 'Total:', '$200.00']);
    expect(dropped).toEqual([]);
  });

  it('drops a letterhead, a footer caption, AND a bare page number together', () => {
    // The bare page number is the case that used to slip through under a
    // text-only rule: not a candidate under either round-1 guard, so it
    // counted as body and stretched the band down to swallow the real
    // footer above it. Caught directly here (both position AND margin), it
    // never gets the chance to do that.
    const page = (n: number): TextRun[] => [
      run('ACME SUPPLIES', 300, 800),
      run(n === 1 ? 'Report for January' : 'Report for February', 60, 600),
      run('Confidential - internal use', 300, 35),
      run(`${n}`, 300, 20),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Report for January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Report for February']);
    expect(dropped.join('\n')).toMatch(/6 run/); // 3 positions * 2 pages
  });

  it('drops a "Page 1 of 12" footer, even though its stripped template holds letters', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Report body January' : 'Report body February', 60, 600),
      run(`Page ${n} of 12`, 300, 30),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Report body January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Report body February']);
    expect(dropped.join('\n')).toMatch(/2 run/);
  });

  it('keeps a quantity column of bare digits sitting mid-table', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Item Alpha' : 'Item Beta', 60, 650),
      run(`${n}`, 300, 650),
      run(n === 1 ? 'Item Gamma' : 'Item Delta', 60, 630),
      run(`${n}`, 300, 630),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Item Alpha', '1', 'Item Gamma', '1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Item Beta', '2', 'Item Delta', '2']);
    expect(dropped).toEqual([]);
  });

  // --- Fix round 3: furniture needs BOTH the band and the margin ---

  it('drops a letterhead block even when a varying line sits close beneath it', () => {
    // Under the "nearer to content" rule this replaces, the letterhead was
    // only 24pt from the varying invoice line and 42pt from the top edge,
    // so "nearer the content" kept it — the address printed twice. The band
    // (this line is above the entire content range) and the margin (42pt is
    // 5% of an 842pt sheet) now agree, so it goes.
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('NIP: 9552562516', 400, 788),
      run(`Invoice ${n === 1 ? 'January' : 'February'}`, 400, 776),
      run(n === 1 ? 'Body row January' : 'Body row February', 60, 600),
      run(`${n} / 2`, 300, 30),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Invoice January', 'Body row January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Invoice February', 'Body row February']);
    expect(dropped.join('\n')).toMatch(/TEBIN\.PRO/);
    expect(dropped.join('\n')).toMatch(/NIP:/);
  });

  it('drops a landscape title: the margin is a fraction of a short page, not a fixed number of points', () => {
    // At heightPt=595 (landscape), 15% of the sheet is 89.25pt — a title
    // 35pt from the top edge is comfortably inside that, though it would
    // not be on a taller, portrait sheet.
    const page = (n: number): TextRun[] => [
      run('Revenue Estimation', 300, 560),
      run(n === 1 ? 'Row January' : 'Row February', 60, 540),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], 595);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row February']);
    expect(dropped.join('\n')).toMatch(/Revenue Estimation/);
  });

  it('keeps a candidate that sits close to a landscape edge but outside the margin fraction', () => {
    // Same 595pt sheet: a caption 95pt from the nearer edge is outside the
    // 89.25pt (15%) margin, even though 95pt would read as "close to the
    // edge" on an absolute scale. This is the case a fixed-points margin
    // (rather than a fraction of the page) gets wrong.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Body January' : 'Body February', 60, 300),
      run('Side Caption', 400, 95),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], 595);
    expect(body[0]!.map((r) => r.text)).toEqual(['Body January', 'Side Caption']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Body February', 'Side Caption']);
    expect(dropped).toEqual([]);
  });

  it('drops a footer that sits nearer the last body row than the edge, on a dense page', () => {
    // The last body row reaches y=42, only 14pt above the footer at y=28 —
    // nearer to that content than to the bottom edge (28pt). Distance to
    // content alone (the previous, superseded rule) kept this footer.
    // Distance to the edge as a fraction of the page (28 / 842 = 3.3%) is
    // what actually says "footer", regardless of how close the body itself
    // runs to the bottom margin.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Last row January' : 'Last row February', 60, 42),
      run('Confidential', 300, 28),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Last row January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Last row February']);
    expect(dropped.join('\n')).toMatch(/Confidential/);
  });

  it('protects a subtotal caption sitting inside the margin, because the body band reaches that far down too', () => {
    // Both non-candidate rows sit inside the outer margin themselves (a
    // dense table running close to the bottom edge). The candidate caption
    // between them is inside the margin fraction as well, but it is also
    // inside the band those two rows define — the band is what keeps it,
    // not the margin, which would drop it on its own.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Item Alpha' : 'Item Beta', 60, 140),
      run('Subtotal:', 300, 120),
      run(n === 1 ? 'Item Gamma' : 'Item Delta', 60, 100),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Item Alpha', 'Subtotal:', 'Item Gamma']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Item Beta', 'Subtotal:', 'Item Delta']);
    expect(dropped).toEqual([]);
  });

  it('lands in the every-run-is-a-candidate fallback when body content varies only by a trailing amount', () => {
    // "Turnover 1000" / "Turnover 2000" strip to the identical "Turnover "
    // template, exactly as a real page number would — this is the
    // documented, accepted gap in pass one's text rule. Paired with a
    // repeating title, every run on this page is a candidate, so there is
    // no non-candidate content anywhere to measure a band or margin
    // against. This must land in the refusal-to-guess fallback, not be
    // silently mishandled by whatever the band/margin code happens to do
    // with an empty content set.
    const page = (n: number): TextRun[] => [
      run('Revenue Estimation', 300, 560),
      run(n === 1 ? 'Turnover 1000' : 'Turnover 2000', 60, 500),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], 595);
    expect(body[0]!.map((r) => r.text)).toEqual(['Revenue Estimation', 'Turnover 1000']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Revenue Estimation', 'Turnover 2000']);
    expect(dropped.join('\n')).toMatch(/no body content/);
  });

  it('drops a letterhead while keeping a bare-digit value column on the same page', () => {
    // Restores the combination the "keeps a column" test above no longer
    // covers on its own: a bare-digit column (candidate by text, since "1"
    // and "2" strip to the same empty template) sitting next to a genuine
    // letterhead. A varying notes line anchors the body band; without it,
    // every run here would be a candidate and the whole page would fall
    // into the refusal-to-guess fallback instead of exercising the rule.
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(n === 1 ? 'Notes for January' : 'Notes for February', 60, 620),
      run('Labor', 60, 600),
      run(`${n}`, 300, 600),
      run('Other cost', 60, 580),
      run(`${n}`, 300, 580),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Notes for January', 'Labor', '1', 'Other cost', '1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Notes for February', 'Labor', '2', 'Other cost', '2']);
    expect(dropped.join('\n')).toMatch(/TEBIN\.PRO/);
  });

  it('keeps a candidate that sits exactly on the margin boundary: a tie is not furniture', () => {
    // At heightPt=1000, 15% is exactly 150pt. A candidate at y=150 is
    // min(150, 850) = 150pt from its nearer edge — equal to the threshold,
    // not less than it. This project keeps on a tie, deliberately: the
    // comparison is strict, so an exact match on the boundary stays body.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Body January' : 'Body February', 60, 500),
      run('Tied Caption', 300, 150),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], 1000);
    expect(body[0]!.map((r) => r.text)).toEqual(['Body January', 'Tied Caption']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Body February', 'Tied Caption']);
    expect(dropped).toEqual([]);
  });

  it('throws on a non-finite or non-positive page height instead of silently mis-classifying every run', () => {
    const page: TextRun[] = [run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Turnover', 60, 600)];
    expect(() => splitChrome([page, page], 0)).toThrow(/finite positive number/);
    expect(() => splitChrome([page, page], -842)).toThrow(/finite positive number/);
    expect(() => splitChrome([page, page], Number.NaN)).toThrow(/finite positive number/);
  });
});
