// A minimal in-memory .xlsx: one sheet, shared strings, no styles. Enough for
// the ingester's happy path; tests needing merges or number formats keep
// building their own richer packages (see test/ingest/xlsx.test.ts's own
// buildXlsx/oneSheetXlsx, which build XML fragments directly rather than from
// a rows: string[][] table — a different level of abstraction from this
// helper, kept separate rather than merged).
import JSZip from 'jszip';

export async function makeXlsx(rows: string[][], sheetName = 'Sheet1'): Promise<Buffer> {
  const strings: string[] = [];
  const indexOf = (s: string): number => {
    const i = strings.indexOf(s);
    if (i !== -1) return i;
    strings.push(s);
    return strings.length - 1;
  };
  const colRef = (c: number): string => {
    let ref = '';
    for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) ref = String.fromCharCode(65 + (n % 26)) + ref;
    return ref;
  };
  const sheetXml = rows
    .map((row, r) => `<row r="${r + 1}">${row
      .map((v, c) => (v === '' ? '' : `<c r="${colRef(c)}${r + 1}" t="s"><v>${indexOf(v)}</v></c>`))
      .join('')}</row>`)
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`);
  return await zip.generateAsync({ type: 'nodebuffer' });
}
