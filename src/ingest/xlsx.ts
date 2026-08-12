// XLSX (OOXML SpreadsheetML) → IR. Scoped by measurement, not ambition — see
// docs/superpowers/specs/2026-08-13-xlsx-ingest-design.md, written from 68
// real files in a data room. The useful subset there is small tabular
// registers (a shareholders' list of 12 rows, a legal structure of 41); a
// 94,309-row sheet or one riddled with merged cells is a working instrument,
// not a document, and this file refuses those loudly rather than reformat
// them into uselessness (see MAX_ROWS/MAX_COLS below).
//
// XML, not a DOM parser or ExcelJS — the same choice src/ingest/docx.ts
// makes, for the same reason: the parts out of the zip with `jszip` (already
// a dependency) are all four things this ingester needs (shared strings,
// cell values, merge ranges, number formats) actually require. A cell
// reference (`r="C7"`) is read off every `<c>` directly rather than assumed
// from position — SpreadsheetML omits a `<c>` entirely for an empty cell, so
// a row is sparse by construction, and building the grid from anything but
// the references themselves would shear the moment a row has a gap.

import JSZip from 'jszip';
import { posix } from 'node:path';
import type { Block, Ingested, Inline } from '../ir/types.js';

type Sink = { blocks: Block[]; dropped: string[] };

// ---------------------------------------------------------------------------
// XML entity / text plumbing (mirrors docx.ts's own; not shared, on purpose —
// see that file's own module comment on why each ingester stays self-
// contained rather than growing a shared regex-XML layer neither corpus needs
// in full).
// ---------------------------------------------------------------------------

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[body] ?? m;
  });
}

// ---------------------------------------------------------------------------
// Relationships (xl/_rels/workbook.xml.rels): rId → target
// ---------------------------------------------------------------------------

function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of xml.match(/<Relationship\b[^>]*\/>/g) ?? []) {
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (id !== undefined && target !== undefined) out.set(id, decodeXmlEntities(target));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Workbook: sheet order/names, and the 1900/1904 date-system flag a serial
// number needs before it can become a calendar date at all.
// ---------------------------------------------------------------------------

type SheetRef = { name: string; rId: string };

function parseWorkbook(xml: string): { sheets: SheetRef[]; date1904: boolean } {
  // Excel's "1904 date system" (Preferences ▸ Calculate, a macOS-era
  // holdover) shifts every serial by a fixed number of days. Not seen in the
  // measured corpus, but the flag costs one regex to honour and produces a
  // silently wrong date for every row of a sheet if ignored.
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(xml);
  const sheets: SheetRef[] = [];
  const sheetsBlock = /<sheets>([\s\S]*?)<\/sheets>/.exec(xml)?.[1] ?? '';
  for (const m of sheetsBlock.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = m[1] ?? '';
    const name = /\bname="([^"]*)"/.exec(attrs)?.[1];
    const rId = /\br:id="([^"]*)"/.exec(attrs)?.[1];
    if (name !== undefined && rId !== undefined) sheets.push({ name: decodeXmlEntities(name), rId });
  }
  return { sheets, date1904 };
}

// ---------------------------------------------------------------------------
// Shared strings (xl/sharedStrings.xml): `<si>` by index. An `<si>` is either
// one plain `<t>` or several rich-text `<r><t>…</t></r>` runs — measured in 3
// of the 68 files. Concatenating *every* `<t>` found inside one `<si>`,
// whichever shape it is, is what keeps the rich-text case from silently
// losing every run after the first: a shape-specific reader that only looked
// for a direct child `<t>` would see nothing at all for those three files.
// ---------------------------------------------------------------------------

function parseSharedStrings(xml: string | null): string[] {
  if (xml === null) return [];
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    const inner = si[1] ?? '';
    let text = '';
    for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\/>/g)) text += decodeXmlEntities(t[1] ?? '');
    out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Styles (xl/styles.xml): a cell's `s="N"` attribute indexes `cellXfs`, whose
// own `numFmtId` is either one of Excel's built-ins (never written into the
// file — they are fixed by the spec, ECMA-376 §18.8.30) or a custom one
// defined in `<numFmts>`. This is the one hop that tells a date from a number
// wearing the same digits.
// ---------------------------------------------------------------------------

type Styles = { numFmts: Map<number, string>; cellXfNumFmtIds: number[]; present: boolean };

function parseStyles(xml: string | null): Styles {
  const numFmts = new Map<number, string>();
  const cellXfNumFmtIds: number[] = [];
  if (xml === null) return { numFmts, cellXfNumFmtIds, present: false };
  const numFmtsBlock = /<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/.exec(xml)?.[1] ?? '';
  for (const m of numFmtsBlock.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const attrs = m[1] ?? '';
    const id = /\bnumFmtId="(\d+)"/.exec(attrs)?.[1];
    const code = /\bformatCode="([^"]*)"/.exec(attrs)?.[1];
    if (id !== undefined && code !== undefined) numFmts.set(Number(id), decodeXmlEntities(code));
  }
  const cellXfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  for (const m of cellXfsBlock.matchAll(/<xf\b([^>]*)\/>|<xf\b([^>]*)>[\s\S]*?<\/xf>/g)) {
    const attrs = m[1] ?? m[2] ?? '';
    const id = /\bnumFmtId="(\d+)"/.exec(attrs)?.[1];
    cellXfNumFmtIds.push(id !== undefined ? Number(id) : 0);
  }
  return { numFmts, cellXfNumFmtIds, present: true };
}

// Built-in date/time format ids, per ECMA-376 Part 1 §18.8.30's predefined
// table — fixed by the spec, not written anywhere in the file, so this list
// is the only way to recognise them. 14–22 are the everyday Latin-locale
// date/time formats; 27–36 and 45–58 are the CJK/locale variants the same
// table reserves for date and time — none of the ids in between (23–26,
// 37–44, 48–49) are date-shaped, so they are deliberately left out rather
// than swept in by a wider range.
const DATE_BUILTIN_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** A custom format code (`numFmtId >= 164`, or any id `<numFmts>` redefines)
 *  is free text, not a fixed table — `dd/mm/yyyy`, `[$-409]d\-mmm\-yy;@`, a
 *  quoted literal, a colour switch. Quoted spans and bracketed switches are
 *  stripped first so a currency symbol or a locale tag can't be mistaken for
 *  the letter `d`; what is left is a date/time format exactly when it still
 *  contains one of the letters that mean day/month/year/hour/second in
 *  SpreadsheetML's format-code grammar. */
function looksLikeDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(stripped);
}

function isDateNumFmt(styles: Styles, numFmtId: number): boolean {
  if (DATE_BUILTIN_IDS.has(numFmtId)) return true;
  const code = styles.numFmts.get(numFmtId);
  return code !== undefined && looksLikeDateFormat(code);
}

// ---------------------------------------------------------------------------
// Excel serial date → calendar date. The serial counts days since a fixed
// epoch (1899-12-30 for the ordinary date system, chosen so serial 60 lands
// on Excel's own fictitious 1900-02-29 — the epoch that makes that century-
// old bug fall out for free instead of needing a special case here); the
// 1904 system instead counts from 1904-01-01. Formatted as plain ISO
// (`YYYY-MM-DD`, plus `HH:MM` only when the serial carries a fractional day)
// rather than any locale spelling: the IR's job is to carry what the number
// means, not to guess which locale a reader wants — the same division
// docx.ts's own date field draws between "read faithfully" and "render
// later".
// ---------------------------------------------------------------------------

function serialToDateString(serial: number, date1904: boolean): string {
  const epochMs = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epochMs + serial * 86_400_000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const fracDay = serial - Math.floor(serial);
  if (Math.abs(fracDay) < 1e-9) return `${y}-${mo}-${da}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Cell address plumbing
// ---------------------------------------------------------------------------

/** `"AB"` → 27 (zero-based). Column letters are base-26 with no zero digit
 *  (A=1, Z=26, AA=27), which is why this is a running `*26 + digit`, not a
 *  positional radix conversion. */
function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
  return idx - 1;
}

function extractV(content: string): string | undefined {
  const m = /<v>([\s\S]*?)<\/v>|<v\/>/.exec(content);
  if (!m) return undefined;
  return m[1] ?? '';
}

// The size limit named in the design's second refusal: not a technical
// ceiling (this ingester could build a 94,309-row grid) but a page's worth of
// reading. 200 rows is roughly four to five printed pages at the ~40–50 body
// rows a themed A4-portrait page holds before a table stops being something
// a person reads start to finish and becomes something they scroll or query
// — and it is where the measured corpus itself already splits (51 of 68
// files stay under it; the sheets that don't are exactly the working
// registers the design's own "what was measured" section calls out: a
// 94,309-row sheet, a 612-formula weekly status report). 25 columns is a
// generous multiple of the ~10 columns inspect.ts's own MIN_LEGIBLE_COL_PT
// already treats as the practical ceiling for one A4-portrait page — wide
// enough that no register in the corpus trips it, narrow enough that a sheet
// built as a database export (hundreds of columns) still does.
const MAX_ROWS = 200;
const MAX_COLS = 25;

type Cell = { text: string; isNumeric: boolean };

const EMPTY_CELL: Cell = { text: '', isNumeric: false };

function cellToInline(cell: Cell): Inline[] {
  return cell.text === '' ? [] : [{ t: 'text', v: cell.text }];
}

/** A row "looks like" a header exactly when every one of its cells is filled
 *  with non-numeric text — the design's own rule. A row with even one blank
 *  or one number in it is ordinary data that happens to sit first, and
 *  treating it as a header anyway is the "quiet misreading" the design warns
 *  against. */
function looksLikeHeader(row: readonly Cell[]): boolean {
  return row.length > 0 && row.every((c) => c.text.trim() !== '' && !c.isNumeric);
}

/** Removes leading empty rows and leading empty columns — and only those.
 *  A fully empty row *inside* the used range survives (a blank row inside a
 *  register usually separates groups; deleting it changes what the table
 *  says — see the design doc), and so does a trailing one: the grid's own
 *  extent already comes from the last cell reference that exists in the
 *  sheet, so there is nothing "trailing" left to trim once that boundary is
 *  the one the grid was built to. */
function trimLeading(grid: readonly Cell[][]): Cell[][] {
  let firstRow = 0;
  while (firstRow < grid.length && grid[firstRow]!.every((c) => c.text === '')) firstRow++;
  if (firstRow === grid.length) return [];
  const cols = grid[0]!.length;
  let firstCol = 0;
  while (firstCol < cols && grid.every((row) => row[firstCol]!.text === '')) firstCol++;
  return grid.slice(firstRow).map((row) => row.slice(firstCol));
}

// ---------------------------------------------------------------------------
// One worksheet
// ---------------------------------------------------------------------------

type SheetOutcome =
  | { kind: 'refused'; message: string }
  | { kind: 'empty' }
  | { kind: 'ok'; grid: Cell[][]; hadFormula: boolean };

/**
 * Reads one `xl/worksheets/sheetN.xml`. Two passes over the same string,
 * deliberately: the first only ever looks at `<c … r="…">` and
 * `<mergeCell>` tags — cheap, and enough to decide a refusal — so that the
 * one sheet in the corpus with 94,309 rows is refused after a single cheap
 * scan instead of after resolving 94,309 cells' shared strings and number
 * formats for a grid that is about to be thrown away.
 */
function readWorksheet(
  sheetXml: string, sheetName: string, sharedStrings: readonly string[], styles: Styles, date1904: boolean, sink: Sink,
): SheetOutcome {
  const mergeCount = (sheetXml.match(/<mergeCell\b/g) ?? []).length;
  if (mergeCount > 0) {
    return {
      kind: 'refused',
      message: `sheet "${sheetName}" refused: ${mergeCount} merged cell${mergeCount === 1 ? '' : 's'} — the IR has no way to represent a merged cell, and flattening one would produce a table that looks right and says something different from the source; extract the range that matters into a small sheet, and re-issue that.`,
    };
  }

  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity, cellCount = 0;
  for (const m of sheetXml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
    const col = colLettersToIndex(m[1]!);
    const row = Number(m[2]);
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    cellCount++;
  }
  if (cellCount === 0) return { kind: 'empty' };

  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;
  if (rows > MAX_ROWS || cols > MAX_COLS) {
    return {
      kind: 'refused',
      message: `sheet "${sheetName}" refused: ${rows} rows × ${cols} columns exceeds this build's ${MAX_ROWS}×${MAX_COLS} limit — a table nobody can read on paper has not been re-issued, it has been reformatted into uselessness; extract the range that matters into a small sheet, and re-issue that.`,
    };
  }

  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => EMPTY_CELL));
  let hadFormula = false;
  let sawUnaddressed = false;

  for (const m of sheetXml.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = m[1] ?? m[2] ?? '';
    const content = m[3] ?? '';
    const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!refMatch) { sawUnaddressed = true; continue; }
    const col = colLettersToIndex(refMatch[1]!) - minCol;
    const row = Number(refMatch[2]) - minRow;
    const addr = `${refMatch[1]}${refMatch[2]}`;

    if (/<f\b/.test(content)) hadFormula = true;
    const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
    const sAttr = /\bs="(\d+)"/.exec(attrs)?.[1];
    const sIndex = sAttr !== undefined ? Number(sAttr) : 0;

    let cell: Cell;
    if (t === 'inlineStr') {
      const isBlock = /<is>([\s\S]*?)<\/is>/.exec(content)?.[1] ?? '';
      let text = '';
      for (const tm of isBlock.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\/>/g)) text += decodeXmlEntities(tm[1] ?? '');
      cell = { text, isNumeric: false };
    } else if (t === 's') {
      const raw = extractV(content);
      const idx = raw !== undefined ? Number(raw) : NaN;
      const text = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
      if (raw !== undefined && sharedStrings[idx] === undefined) {
        sink.dropped.push(`sheet "${sheetName}" cell ${addr}: shared-string index ${raw} has no entry — cell left blank`);
      }
      cell = { text, isNumeric: false };
    } else if (t === 'str') {
      cell = { text: decodeXmlEntities(extractV(content) ?? ''), isNumeric: false };
    } else if (t === 'b') {
      const raw = extractV(content);
      cell = { text: raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '', isNumeric: false };
    } else if (t === 'e') {
      cell = { text: decodeXmlEntities(extractV(content) ?? ''), isNumeric: false };
    } else {
      // No `t` (or `t="n"`): a plain number, unless the style attached to it
      // names a date/time format — see the styles section above for why that
      // hop through `xl/styles.xml` is unavoidable.
      const raw = extractV(content);
      if (raw === undefined) {
        cell = EMPTY_CELL;
      } else {
        const numFmtId = styles.cellXfNumFmtIds[sIndex];
        if (numFmtId === undefined) {
          // A style index this workbook's own cellXfs table has no entry
          // for — malformed, but not this ingester's job to repair. Carry
          // the raw value and say exactly which cell couldn't be resolved,
          // per the design's own rule for this case, rather than guess.
          if (styles.present) {
            sink.dropped.push(`sheet "${sheetName}" cell ${addr}: number format could not be resolved (style index ${sIndex} has no entry in xl/styles.xml) — raw value "${raw}" kept instead of a formatted number or date`);
          }
          cell = { text: raw, isNumeric: true };
        } else if (isDateNumFmt(styles, numFmtId)) {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            cell = { text: serialToDateString(n, date1904), isNumeric: true };
          } else {
            sink.dropped.push(`sheet "${sheetName}" cell ${addr}: date-formatted value "${raw}" is not a number — kept as-is`);
            cell = { text: raw, isNumeric: true };
          }
        } else {
          const n = Number(raw);
          cell = { text: Number.isFinite(n) ? String(n) : raw, isNumeric: true };
        }
      }
    }
    grid[row]![col] = cell;
  }

  if (sawUnaddressed) {
    sink.dropped.push(`sheet "${sheetName}" contained a cell with no address (a malformed <c> with no r attribute) — it could not be placed and was skipped`);
  }

  return { kind: 'ok', grid, hadFormula };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function ingestXlsx(
  bytes: Uint8Array | Buffer,
  opts: { title?: string; subtitle?: string; date?: string; entity?: string } = {},
): Promise<Ingested> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) {
    throw new Error('not an Excel workbook: xl/workbook.xml is missing from the package');
  }
  const workbookXml = await workbookFile.async('string');
  const { sheets, date1904 } = parseWorkbook(workbookXml);
  if (sheets.length === 0) {
    throw new Error('workbook has no worksheets to read');
  }

  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const rels = parseRels(relsFile ? await relsFile.async('string') : '');
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedStringsFile ? await sharedStringsFile.async('string') : null);
  const stylesFile = zip.file('xl/styles.xml');
  const styles = parseStyles(stylesFile ? await stylesFile.async('string') : null);

  const sink: Sink = { blocks: [], dropped: [] };
  const refusalMessages: string[] = [];
  let refusedCount = 0;
  let hadFormula = false;

  for (const sheet of sheets) {
    const target = rels.get(sheet.rId);
    const path = target === undefined ? undefined
      : target.startsWith('/') ? target.slice(1) : posix.join('xl', target);
    const sheetFile = path !== undefined ? zip.file(path) : undefined;
    if (!sheetFile) {
      refusedCount++;
      refusalMessages.push(`sheet "${sheet.name}" refused: its part (${path ?? `relationship ${sheet.rId}`}) is missing from the package`);
      continue;
    }
    const sheetXml = await sheetFile.async('string');
    const outcome = readWorksheet(sheetXml, sheet.name, sharedStrings, styles, date1904, sink);

    if (outcome.kind === 'refused') {
      refusedCount++;
      refusalMessages.push(outcome.message);
      continue;
    }
    if (outcome.kind === 'empty') {
      sink.dropped.push(`sheet "${sheet.name}" has no cells — nothing to show`);
      continue;
    }

    if (outcome.hadFormula) hadFormula = true;
    const trimmed = trimLeading(outcome.grid);
    if (trimmed.length === 0 || trimmed[0]!.length === 0) {
      sink.dropped.push(`sheet "${sheet.name}" is entirely empty once leading blank rows and columns are trimmed — nothing to show`);
      continue;
    }

    const header = trimmed[0]!;
    let head: Inline[][];
    let dataRows: Cell[][];
    if (looksLikeHeader(header)) {
      head = header.map(cellToInline);
      dataRows = trimmed.slice(1);
    } else {
      sink.dropped.push(`sheet "${sheet.name}": first row is not a header (every header cell must be filled with non-numeric text) — the table has no header row, and every row (including what would have been the header) was kept as data`);
      head = header.map(() => []);
      dataRows = trimmed;
    }

    // "Sheet1" on a single-sheet workbook tells a reader nothing — see the
    // design doc's own rule.
    if (!(sheets.length === 1 && sheet.name === 'Sheet1')) {
      sink.blocks.push({ t: 'heading', level: 1, text: [{ t: 'text', v: sheet.name }] });
    }
    sink.blocks.push({
      t: 'table',
      head,
      rows: dataRows.map((row) => row.map(cellToInline)),
      align: head.map(() => 'l'),
    });
  }

  // Every sheet refused: the workbook is not empty (an empty workbook simply
  // produces no blocks below, and that is fine), it is a working instrument
  // this ingester declined every part of — see the design doc's own rule
  // that this must fail the build, not quietly hand back an empty document.
  if (refusedCount > 0 && refusedCount === sheets.length) {
    throw new Error(
      `every sheet in the workbook was refused (${refusedCount} of ${sheets.length}):\n${refusalMessages.map((m) => `  - ${m}`).join('\n')}`,
    );
  }
  for (const m of refusalMessages) sink.dropped.push(m);

  if (hadFormula) {
    sink.dropped.push('workbook contains formulas — the cached values Excel last computed were used rather than recomputed; a workbook last saved by something that did not recalculate could carry a stale number');
  }

  const title = opts.title;
  return {
    doc: {
      meta: {
        title: title && title !== '' ? title : 'Untitled',
        lang: 'en',
        ...(opts.subtitle !== undefined && opts.subtitle !== '' ? { subtitle: opts.subtitle } : {}),
        ...(opts.date !== undefined ? { date: opts.date } : {}),
        ...(opts.entity !== undefined ? { entity: opts.entity } : {}),
      },
      blocks: sink.blocks,
    },
    dropped: sink.dropped,
  };
}
