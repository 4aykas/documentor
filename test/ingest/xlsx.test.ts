import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ingestXlsx } from '../../src/ingest/xlsx.js';

/**
 * Zips a handful of XML strings into a minimal .xlsx, the same pattern
 * test/ingest/docx.test.ts uses for .docx: readable, diffable fixtures built
 * in the test rather than a committed binary nobody can diff. Only the parts
 * ingestXlsx.ts actually reads are included — `[Content_Types].xml` and the
 * package-level `_rels/.rels` are irrelevant to it, same omission docx's own
 * helper makes.
 */
async function buildXlsx(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const workbookXml = (sheets: { name: string; rId: string }[], date1904 = false) =>
  `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  (date1904 ? '<workbookPr date1904="1"/>' : '') +
  `<sheets>${sheets.map((s) => `<sheet name="${s.name}" sheetId="1" r:id="${s.rId}"/>`).join('')}</sheets></workbook>`;

const relsXml = (rels: { rId: string; target: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map((r) => `<Relationship Id="${r.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${r.target}"/>`)
    .join('')}</Relationships>`;

const sheetXml = (rows: string, merges: string[] = []) =>
  `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>` +
  (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
  `</worksheet>`;

const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
const num = (ref: string, v: number | string, s?: number) => `<c r="${ref}"${s !== undefined ? ` s="${s}"` : ''}><v>${v}</v></c>`;
const shared = (ref: string, idx: number) => `<c r="${ref}" t="s"><v>${idx}</v></c>`;
const inlineStr = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const formula = (ref: string, f: string, cached: number | string, s?: number) =>
  `<c r="${ref}"${s !== undefined ? ` s="${s}"` : ''}><f>${f}</f><v>${cached}</v></c>`;

const sharedStringsXml = (strings: (string | string[])[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
  strings.map((s) => (Array.isArray(s) ? `<si>${s.map((run) => `<r><t>${run}</t></r>`).join('')}</si>` : `<si><t>${s}</t></si>`)).join('') +
  `</sst>`;

const stylesXml = (cellXfNumFmtIds: number[], numFmts: { id: number; code: string }[] = []) =>
  `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${n.code}"/>`).join('')}</numFmts>` : '') +
  `<cellXfs count="${cellXfNumFmtIds.length}">${cellXfNumFmtIds.map((id) => `<xf numFmtId="${id}"/>`).join('')}</cellXfs>` +
  `</styleSheet>`;

/** One sheet named "Data" (not "Sheet1"), so a heading always prints — the
 *  Sheet1-suppression rule is its own dedicated test below. */
async function oneSheetXlsx(rows: string, opts: { merges?: string[]; sharedStrings?: (string | string[])[]; styles?: string; sheetName?: string } = {}): Promise<Buffer> {
  const files: Record<string, string> = {
    'xl/workbook.xml': workbookXml([{ name: opts.sheetName ?? 'Data', rId: 'rId1' }]),
    'xl/_rels/workbook.xml.rels': relsXml([{ rId: 'rId1', target: 'worksheets/sheet1.xml' }]),
    'xl/worksheets/sheet1.xml': sheetXml(rows, opts.merges ?? []),
  };
  if (opts.sharedStrings) files['xl/sharedStrings.xml'] = sharedStringsXml(opts.sharedStrings);
  if (opts.styles) files['xl/styles.xml'] = opts.styles;
  return buildXlsx(files);
}

describe('ingestXlsx — one sheet, the vocabulary of values a cell can carry', () => {
  it('reads a shared string, producing a heading (sheet not named Sheet1) and a header-detected table', async () => {
    const rows = row(1, `${shared('A1', 0)}${shared('B1', 1)}`) + row(2, `${shared('A2', 2)}${num('B2', 3)}`);
    const buf = await oneSheetXlsx(rows, { sharedStrings: ['Name', 'Count', 'Alice'] });
    const { doc, dropped } = await ingestXlsx(buf);

    expect(doc.blocks).toEqual([
      { t: 'heading', level: 1, text: [{ t: 'text', v: 'Data' }] },
      {
        t: 'table',
        head: [[{ t: 'text', v: 'Name' }], [{ t: 'text', v: 'Count' }]],
        rows: [[[{ t: 'text', v: 'Alice' }], [{ t: 'text', v: '3' }]]],
        align: ['l', 'l'],
      },
    ]);
    expect(dropped).toEqual([]);
  });

  it('suppresses the heading for a single sheet literally named "Sheet1"', async () => {
    const rows = row(1, `${inlineStr('A1', 'Header')}`) + row(2, `${inlineStr('A2', 'value')}`);
    const buf = await oneSheetXlsx(rows, { sheetName: 'Sheet1' });
    const { doc } = await ingestXlsx(buf);
    expect(doc.blocks[0]).toEqual({ t: 'table', head: [[{ t: 'text', v: 'Header' }]], rows: [[[{ t: 'text', v: 'value' }]]], align: ['l'] });
  });

  it('reads an inline string (t="inlineStr")', async () => {
    const rows = row(1, inlineStr('A1', 'Column')) + row(2, inlineStr('A2', 'plain inline value'));
    const buf = await oneSheetXlsx(rows);
    const { doc, dropped } = await ingestXlsx(buf);
    expect((doc.blocks[1] as { rows: unknown }).rows).toEqual([[[{ t: 'text', v: 'plain inline value' }]]]);
    expect(dropped).toEqual([]);
  });

  it('reads a shared string built from several rich-text runs, not just its first run', async () => {
    // Measured in the corpus: 3 of 68 files store a shared string as several
    // <r><t>…</t></r> runs (mixed formatting inside one cell) rather than one
    // plain <t>. Losing every run after the first would be a silent loss of
    // exactly the kind this project refuses to ship.
    const rows = row(1, inlineStr('A1', 'Note')) + row(2, shared('A2', 0));
    const buf = await oneSheetXlsx(rows, { sharedStrings: [['bold part ', 'and the rest of the sentence']] });
    const { doc } = await ingestXlsx(buf);
    expect((doc.blocks[1] as { rows: unknown }).rows).toEqual([[[{ t: 'text', v: 'bold part and the rest of the sentence' }]]]);
  });

  it('reads a formula cell by its cached value, and reports once (not per cell) that formulas were used', async () => {
    const rows =
      row(1, `${inlineStr('A1', 'A')}${inlineStr('B1', 'B')}${inlineStr('C1', 'Total')}`) +
      row(2, `${num('A2', 2)}${num('B2', 3)}${formula('C2', 'A2+B2', 5)}`) +
      row(3, `${num('A3', 10)}${num('B3', 20)}${formula('C3', 'A3+B3', 30)}`);
    const buf = await oneSheetXlsx(rows);
    const { doc, dropped } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { rows: unknown[][][] };
    expect(table.rows[0]![2]).toEqual([{ t: 'text', v: '5' }]);
    expect(table.rows[1]![2]).toEqual([{ t: 'text', v: '30' }]);
    expect(dropped.filter((d) => d.includes('formula'))).toHaveLength(1);
  });
});

describe('ingestXlsx — dates: a number wearing a format', () => {
  it('resolves a built-in date number format (numFmtId 14) through xl/styles.xml, not printing the raw serial', async () => {
    const rows = row(1, inlineStr('A1', 'Signed')) + row(2, num('A2', 45107, 1));
    const styles = stylesXml([0, 14]); // cellXf index 1 -> numFmtId 14 (a built-in date format)
    const buf = await oneSheetXlsx(rows, { styles });
    const { doc, dropped } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { rows: unknown[][][] };
    // Serial 45107 is 2023-06-30 in the ordinary (1900) date system — this
    // assertion is the one that would go red if the styles hop were skipped
    // and the raw "45107" were printed instead, which is exactly the "worse
    // than useless" outcome the design calls out by name.
    expect(table.rows[0]![0]).toEqual([{ t: 'text', v: '2023-06-30' }]);
    expect(dropped).toEqual([]);
  });

  it('resolves a custom date format code (numFmtId >= 164) via <numFmts>', async () => {
    const rows = row(1, inlineStr('A1', 'Signed')) + row(2, num('A2', 45107, 1));
    const styles = stylesXml([0, 164], [{ id: 164, code: 'dd/mm/yyyy' }]);
    const buf = await oneSheetXlsx(rows, { styles });
    const { doc } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { rows: unknown[][][] };
    expect(table.rows[0]![0]).toEqual([{ t: 'text', v: '2023-06-30' }]);
  });

  it('carries the raw value and reports the cell when a style index cannot be resolved', async () => {
    // Round-1 regression fixture: a style index with no cellXfs entry at all
    // (a malformed or truncated styles.xml) must not crash, guess, or silently
    // print nothing — the design's own rule for this exact case.
    const rows = row(1, inlineStr('A1', 'X')) + row(2, num('A2', 45107, 7)); // style index 7 doesn't exist
    const styles = stylesXml([0]); // only index 0 defined
    const buf = await oneSheetXlsx(rows, { styles });
    const { doc, dropped } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { rows: unknown[][][] };
    expect(table.rows[0]![0]).toEqual([{ t: 'text', v: '45107' }]);
    expect(dropped.some((d) => d.includes('cell A2') && d.includes('could not be resolved'))).toBe(true);
  });

  it('formats a plain number (no date format) as text without a stray style hop', async () => {
    const rows = row(1, inlineStr('A1', 'Qty')) + row(2, num('A2', 3.5, 0));
    const styles = stylesXml([0]);
    const buf = await oneSheetXlsx(rows, { styles });
    const { doc } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { rows: unknown[][][] };
    expect(table.rows[0]![0]).toEqual([{ t: 'text', v: '3.5' }]);
  });
});

describe('ingestXlsx — trimming and header detection', () => {
  it('trims an empty leading column and an empty leading row, but keeps a fully empty row inside the used range', async () => {
    // Column A and row 1 are entirely empty; row 4 (inside the used range) is
    // also entirely empty and must survive — see the design's own "a blank
    // row inside a register usually separates groups" rule.
    const rows =
      row(2, `${inlineStr('B2', 'Name')}${inlineStr('C2', 'Role')}`) +
      row(3, `${inlineStr('B3', 'Alice')}${inlineStr('C3', 'Director')}`) +
      row(4, '') +
      row(5, `${inlineStr('B5', 'Bob')}${inlineStr('C5', 'Officer')}`);
    const buf = await oneSheetXlsx(rows);
    const { doc } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { head: unknown; rows: unknown[][][] };
    expect(table.head).toEqual([[{ t: 'text', v: 'Name' }], [{ t: 'text', v: 'Role' }]]);
    expect(table.rows).toEqual([
      [[{ t: 'text', v: 'Alice' }], [{ t: 'text', v: 'Director' }]],
      [[], []],
      [[{ t: 'text', v: 'Bob' }], [{ t: 'text', v: 'Officer' }]],
    ]);
  });

  it('reports and keeps every row as data when the first row is not a real header (a numeric cell in it)', async () => {
    const rows = row(1, `${inlineStr('A1', 'Item')}${num('B1', 1)}`) + row(2, `${inlineStr('A2', 'Widget')}${num('B2', 2)}`);
    const buf = await oneSheetXlsx(rows);
    const { doc, dropped } = await ingestXlsx(buf);
    const table = doc.blocks[1] as { head: unknown; rows: unknown[][][] };
    expect(table.head).toEqual([[], []]);
    expect(table.rows).toEqual([
      [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: '1' }]],
      [[{ t: 'text', v: 'Widget' }], [{ t: 'text', v: '2' }]],
    ]);
    expect(dropped.some((d) => d.includes('no header row'))).toBe(true);
  });
});

describe('ingestXlsx — the two refusals', () => {
  it('refuses a sheet with a merged cell, naming the sheet and the count', async () => {
    const rows = row(1, `${inlineStr('A1', 'X')}${inlineStr('B1', 'Y')}`) + row(2, `${inlineStr('A2', 'a')}${inlineStr('B2', 'b')}`);
    const buf = await oneSheetXlsx(rows, { merges: ['A1:B1'] });
    // Break-on-purpose check performed by hand: removing the `mergeCount > 0`
    // guard in readWorksheet (src/ingest/xlsx.ts) turns this red — the sheet
    // is silently ingested with the merge flattened instead of refused.
    await expect(ingestXlsx(buf)).rejects.toThrow(/every sheet in the workbook was refused/);
  });

  it('names the merge count and sheet name in the dropped list when at least one other sheet succeeds', async () => {
    const goodRows = row(1, inlineStr('A1', 'X')) + row(2, inlineStr('A2', 'ok'));
    const mergedRows = row(1, `${inlineStr('A1', 'X')}${inlineStr('B1', 'Y')}`) + row(2, `${inlineStr('A2', 'a')}${inlineStr('B2', 'b')}`);
    const buf = await buildXlsx({
      'xl/workbook.xml': workbookXml([{ name: 'Good', rId: 'rId1' }, { name: 'Merged', rId: 'rId2' }]),
      'xl/_rels/workbook.xml.rels': relsXml([{ rId: 'rId1', target: 'worksheets/sheet1.xml' }, { rId: 'rId2', target: 'worksheets/sheet2.xml' }]),
      'xl/worksheets/sheet1.xml': sheetXml(goodRows),
      'xl/worksheets/sheet2.xml': sheetXml(mergedRows, ['A1:B1']),
    });
    const { dropped } = await ingestXlsx(buf);
    const msg = dropped.find((d) => d.includes('refused'));
    expect(msg).toContain('"Merged"');
    expect(msg).toContain('1 merged cell');
  });

  it('refuses a sheet beyond the row limit, naming the size', async () => {
    let rows = '';
    for (let r = 1; r <= 250; r++) rows += row(r, num(`A${r}`, r));
    const buf = await oneSheetXlsx(rows);
    // Break-on-purpose check performed by hand: raising MAX_ROWS past 250 (or
    // deleting the size check) turns this red — a 250-row sheet is ingested
    // whole instead of refused.
    await expect(ingestXlsx(buf)).rejects.toThrow(/refused: 250 rows × 1 columns/);
  });

  it('refuses a sheet beyond the column limit, naming the size', async () => {
    // A-Z is exactly 26 columns — past MAX_COLS (25), and still single
    // letters, so the fixture doesn't need two-letter column references.
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const rows = row(1, letters.map((l) => num(`${l}1`, 1)).join(''));
    const buf = await oneSheetXlsx(rows);
    await expect(ingestXlsx(buf)).rejects.toThrow(/26 columns/);
  });

  it('fails the whole ingest — not an empty document — when every sheet is refused', async () => {
    const mergedRows = row(1, `${inlineStr('A1', 'X')}${inlineStr('B1', 'Y')}`);
    const buf = await oneSheetXlsx(mergedRows, { merges: ['A1:B1'] });
    await expect(ingestXlsx(buf)).rejects.toThrow(/every sheet in the workbook was refused \(1 of 1\)/);
  });
});

describe('ingestXlsx — multiple sheets', () => {
  it('produces headings in sheet order', async () => {
    const rows1 = row(1, inlineStr('A1', 'first'));
    const rows2 = row(1, inlineStr('A1', 'second'));
    const buf = await buildXlsx({
      'xl/workbook.xml': workbookXml([{ name: 'Alpha', rId: 'rId1' }, { name: 'Beta', rId: 'rId2' }]),
      'xl/_rels/workbook.xml.rels': relsXml([{ rId: 'rId1', target: 'worksheets/sheet1.xml' }, { rId: 'rId2', target: 'worksheets/sheet2.xml' }]),
      'xl/worksheets/sheet1.xml': sheetXml(rows1),
      'xl/worksheets/sheet2.xml': sheetXml(rows2),
    });
    const { doc } = await ingestXlsx(buf);
    expect(doc.blocks.map((b) => (b.t === 'heading' ? b.text[0] : b.t))).toEqual([
      { t: 'text', v: 'Alpha' }, 'table', { t: 'text', v: 'Beta' }, 'table',
    ]);
  });
});

describe('ingestXlsx — title', () => {
  it('falls back to "Untitled" with no --title (build.ts fills in the filename, same as ingestDocx)', async () => {
    const rows = row(1, inlineStr('A1', 'x'));
    const buf = await oneSheetXlsx(rows);
    const { doc } = await ingestXlsx(buf);
    expect(doc.meta.title).toBe('Untitled');
  });

  it('honours an explicit --title', async () => {
    const rows = row(1, inlineStr('A1', 'x'));
    const buf = await oneSheetXlsx(rows);
    const { doc } = await ingestXlsx(buf, { title: 'Shareholders Register' });
    expect(doc.meta.title).toBe('Shareholders Register');
  });
});
