# DOCX spike

Date: 2026-08-12

The measurement the phase-2 design asked for before the DOCX renderer is
planned: what varies between two runs of `Packer.toBuffer`, what the minimal
normalisation is, and the exact API shape the plan will contain verbatim.

Everything below was run on this machine. Where something could not be
measured it says so.

## Versions

| | |
|:--|:--|
| Node | v26.2.0 |
| npm | 11.13.0 |
| `docx` | 9.7.1 |
| `jszip` (transitive, via `docx`) | 3.10.1 |

```
node --version
node -p "require('./node_modules/docx/package.json').version"
```

`npm install docx` added 19 packages. `docx`'s own dependencies are
`@types/node`, `hash.js`, `jszip`, `nanoid`, `xml`, `xml-js`.

## Byte reproducibility

Two `Packer.toBuffer` calls on the same `Document` are **not** byte-identical,
in the same process or across processes. Measured with one non-trivial document
carrying two headers, a `PAGE`/`NUMPAGES` field pair, two images, two tables, a
hyperlink, a page break and five named styles.

```
raw identical = false   # same process, back to back
raw identical = false   # two separate node processes
```

Unzipping both and comparing the central directory entry by entry — names,
methods, CRCs, compressed sizes and stored DOS timestamps — names exactly three
varying things across 28 entries.

**1. Every zip entry's DOS timestamp.** JSZip stamps each entry with
`new Date()` at pack time. All 28 entries move together; the resolution is two
seconds, so two builds inside the same second look identical and the failure is
intermittent rather than absolute.

```
word/document.xml   ... 2026-08-12 07:31:38
word/document.xml   ... 2026-08-12 07:31:42   <- same input, four seconds later
```

**2. `docProps/core.xml` — `dcterms:created` and `dcterms:modified`.**

```
A: <dcterms:created xsi:type="dcterms:W3CDTF">2026-08-12T07:31:09.165Z
B: <dcterms:created xsi:type="dcterms:W3CDTF">2026-08-12T07:31:09.274Z
```

`IPropertiesOptions` in `docx@9.7.1` has **no** `created` or `modified` option —
the field list is `sections, title, subject, creator, keywords, description,
lastModifiedBy, revision, externalStyles, styles, numbering, comments,
footnotes, endnotes, background, features, compatabilityModeVersion,
compatibility, customProperties, evenAndOddHeaderAndFooters, defaultTabStop,
fonts, hyphenation`. The library hardcodes the wall clock:

```js
// docx/dist/index.mjs
constructor(name) {
  super(name);
  this.root.push(new TimestampElementProperties({ type: "dcterms:W3CDTF" }));
  this.root.push(dateTimeValue(new Date()));
}
```

So the date must be rewritten after packing. There is no option to pass.

**3. The `ExternalHyperlink` relationship id.** `ConcreteHyperlink` calls
`uniqueId()`, which is `nanoid().toLowerCase()`, and the bundled non-secure
nanoid draws from `Math.random()`. The id appears in both the part and its
relationships file:

```
A: <Relationship Id="rIdzqyshhh0_ccxuiiaojxyy" ... Target="https://tebin.pro/" TargetMode="External"/>
B: <Relationship Id="rId0g0nx4a83l6t9qscikjr5" ... Target="https://tebin.pro/" TargetMode="External"/>
A: <w:hyperlink w:history="1" r:id="rIdzqyshhh0_ccxuiiaojxyy">
B: <w:hyperlink w:history="1" r:id="rId0g0nx4a83l6t9qscikjr5">
```

Links are in the design's block list, so this is on the main path, not a corner.

**What does not vary.** `word/settings.xml` carries neither `w:docId` nor any
`w:rsid` — `docx` emits `<w:displayBackgroundShape/>`, `<w:evenAndOddHeaders/>`
and a single `<w:compatSetting/>`, and nothing else. `docProps/app.xml` and
`docProps/custom.xml` are empty `<Properties/>` elements with no dates. Image
part names are a SHA-1 of the image bytes
(`word/media/6540ff…8d.png`), so they are content-addressed and stable.
`grep` of the bundle finds no `Date.now`.

Packing three documents in one process and comparing the third against the same
document packed first gives identical bytes, so the library's numeric id
generators are per-`Document`, not module-global. Verified with a document
containing an image, an external hyperlink and a `Bookmark`.

### The PDF trick does not transfer

`normalize-pdf.ts` substitutes a fixed-width date in place, leaving every xref
offset valid. That works because the varying bytes are the same length and the
container has no checksums. A DOCX has both: the nanoid ids are the same length
uncompressed, but they **deflate to different sizes** —

```
word/document.xml  csize 1430 -> 1428   (usize 5921 both)
```

— and every entry carries a CRC and a local-header offset. The package must be
rewritten, not patched.

## The minimal normalisation

One pass over the buffer with JSZip, which is already in the tree. Three edits,
then re-zip with a fixed date:

1. Replace the `dcterms:created` / `dcterms:modified` text with the epoch.
2. Renumber `rId<21 chars>` ids to `rIdLink1`, `rIdLink2`, … in order of first
   appearance in the part, applying the same map to the part's `.rels`.
3. Rebuild the archive, giving every entry the same `date`.

```ts
import JSZip from 'jszip';

const RANDOM_RID = /rId[a-z0-9_-]{21}/g;

export async function normalizeDocx(buf: Buffer, epochSeconds: number): Promise<Buffer> {
  const stamp = new Date(epochSeconds * 1000);
  const iso = stamp.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const src = await JSZip.loadAsync(buf);
  const names = Object.keys(src.files);
  const parts = new Map<string, Buffer | null>();
  for (const name of names) {
    const f = src.files[name];
    if (f === undefined) continue;
    parts.set(name, f.dir ? null : await f.async('nodebuffer'));
  }

  const core = parts.get('docProps/core.xml');
  if (core != null) {
    parts.set('docProps/core.xml', Buffer.from(
      core.toString('utf8').replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<)/g, `$1${iso}$2`),
      'utf8'));
  }

  for (const name of names) {
    if (!/^word\/.*\.xml$/.test(name)) continue;
    const relName = name.replace(/([^/]+)$/, '_rels/$1.rels');
    const part = parts.get(name);
    const rel = parts.get(relName);
    if (part == null || rel == null) continue;
    const xml = part.toString('utf8');
    const seen: string[] = [];
    for (const m of xml.matchAll(RANDOM_RID)) if (!seen.includes(m[0])) seen.push(m[0]);
    if (seen.length === 0) continue;
    const map = new Map(seen.map((id, i) => [id, `rIdLink${i + 1}`]));
    const sub = (s: string): string => s.replace(RANDOM_RID, (id) => map.get(id) ?? id);
    parts.set(name, Buffer.from(sub(xml), 'utf8'));
    parts.set(relName, Buffer.from(sub(rel.toString('utf8')), 'utf8'));
  }

  const out = new JSZip();
  for (const name of names) {
    const data = parts.get(name);
    if (data === undefined) continue;
    if (data === null) out.file(name, '', { dir: true, date: stamp, createFolders: false });
    else out.file(name, data, { date: stamp, createFolders: false, binary: true });
  }
  return await out.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}
```

It typechecks clean under the project's compiler settings (`--strict
--noUncheckedIndexedAccess --exactOptionalPropertyTypes --module nodenext`).
`createFolders` belongs on `file()`, not on `generateAsync` — JSZip's own types
reject it there.

### Proof

Two builds three seconds apart, normalised to the same epoch:

```
raw identical       = false
normalised identical= true   12362 12362
normalised DOS stamps: 2025-08-11 00:00:00
```

Also identical across two processes, and across timezones — the same build run
under `TZ=America/New_York` (verified in effect: `getTimezoneOffset()` returned
240) produced the same bytes, because JSZip derives the DOS field from
`getUTCHours/getUTCMinutes/getUTCSeconds/getUTCFullYear/getUTCMonth/getUTCDate`.

Comparing the normalised package against the raw one it came from, only three
entries changed CRC or compressed size — `word/document.xml`,
`word/_rels/document.xml.rels` and `docProps/core.xml`. All 25 others survived
the round trip with **identical CRCs and identical compressed sizes**, which is
the evidence that re-zipping with JSZip reproduces `docx`'s own DEFLATE output
rather than merely producing a valid archive. Entry names and order are
preserved exactly, including the directory entries.

### The re-zipped file still opens

Word is installed here and drivable over COM, so this was checked against the
real application rather than inferred:

```powershell
$w = New-Object -ComObject Word.Application; $w.Visible = $false
$d = $w.Documents.Open("$sp\n1.docx", $false, $true)
```

```
OPENED OK: n1.docx
paragraph count: 13
pages: 2
section 1 DifferentFirstPageHeaderFooter: -1
para1 style: Heading 1 | size 22 | bold -1 | color 1710618 | name Arial
hyperlinks: 1 -> https://tebin.pro/
tables: 1 | cell(1,1): Item
PRIMARY header fields: 2 -> PAGE, NUMPAGES
FIRST header tick cell width (pt): 28  border bottom color: 1845722  width enum: 24
```

No repair prompt, no error. `1845722` is `0x1C29DA`, which is `#DA291C` in
Word's BGR order; `LineWidth 24` is eighths of a point, so 3pt. The 560-DXA
first column measures as exactly 28pt.

Re-unzipping the normalised buffer also gives 28 entries, a `word/document.xml`
that starts with the XML declaration and ends with `</w:document>`, and no
relationship id referenced without being declared.

## API shape

Import names are exactly these, all from `'docx'`:

```ts
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Header, ImageRun,
  PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
```

### Different first page

`properties.titlePage: true` on the section, and a `headers` object with `first`
and `default`:

```ts
{
  properties: { titlePage: true, page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
  headers: { first: firstPageHeader, default: runningHeader },
  children: [ /* … */ ],
}
```

produces

```xml
<w:sectPr>
  <w:headerReference w:type="default" r:id="rId7"/>
  <w:headerReference w:type="first" r:id="rId8"/>
  …
  <w:titlePg/>
</w:sectPr>
```

**The part numbering follows the option order, not the page order.**
`headers.default` becomes `word/header1.xml` and `headers.first` becomes
`word/header2.xml`. A read-back test that assumes `header1.xml` is the
first-page header will assert on the wrong file and still pass for the wrong
reason. Each header gets its own `word/_rels/headerN.xml.rels`, and each part's
relationship ids are numbered independently — the logo's image relationship in
`header2.xml.rels` is `rId0` while the same media part is `rId9` in
`document.xml.rels`. Both point at one `word/media/<sha1>.png`; identical bytes
are stored once.

### PAGE and NUMPAGES

`PageNumber.CURRENT` and `PageNumber.TOTAL_PAGES` go in a run's `children`:

```ts
new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTED })
new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: MUTED })
```

```xml
<w:r>
  <w:rPr><w:color w:val="898D8D"/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr>
  <w:fldChar w:fldCharType="begin"/>
  <w:instrText xml:space="preserve">PAGE</w:instrText>
  <w:fldChar w:fldCharType="separate"/>
  <w:fldChar w:fldCharType="end"/>
</w:r>
```

No cached result is written between `separate` and `end`, so a reader that never
recalculates fields sees nothing there. `features: { updateFields: true }` on
`Document` emits `<w:updateFields/>` into `settings.xml`, which asks Word to
recalculate on open. Word resolved both fields when opening the file.

### A PNG at an exact size

```ts
new ImageRun({ data: pngBuffer, type: 'png', transformation: { width: 96, height: 24 } })
```

`transformation` is in **pixels at 96 dpi**: the emitted EMU is
`round(px * 9525)`. Measured:

| `width` | `<wp:extent cx=…>` | points |
|--:|--:|--:|
| 96 | 914400 | 72 |
| 48 | 457200 | 36 |
| 28 | 266700 | 21 |
| 28.5 | 271463 | 21.375 |

So **points → `transformation` is `pt * 4 / 3`**, and the result is exact for
any point value that is a multiple of 0.075 (`pt * 4/3 * 9525 = pt * 12700`).
Fractional pixel values are accepted and rounded.

The image lands at `word/media/<sha1-of-bytes>.png`, is declared by the
`image/png` `Default` extension already present in `[Content_Types].xml`, and is
referenced as `<a:blip r:embed="rIdN"/>` inside `<w:drawing><wp:inline>`.

### Table with DXA widths and a coloured bottom border

This is the tick-and-hairline drawing from the design, verbatim:

```ts
new Table({
  layout: TableLayoutType.FIXED,
  width: { size: 9026, type: WidthType.DXA },
  columnWidths: [560, 8466],            // 560 dxa = 28pt; 20 dxa = 1pt
  borders: { top: NONE, bottom: NONE, left: NONE, right: NONE,
             insideHorizontal: NONE, insideVertical: NONE },
  rows: [new TableRow({ children: [
    new TableCell({
      width: { size: 560, type: WidthType.DXA },
      borders: { bottom: { style: BorderStyle.SINGLE, size: 24, color: 'DA291C' } },
      children: [new Paragraph({ children: [] })],
    }),
    new TableCell({
      width: { size: 8466, type: WidthType.DXA },
      borders: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CDCDCE' } },
      children: [new Paragraph({ children: [] })],
    }),
  ]})],
})
```

`borders.*.size` is in **eighths of a point**: 24 is 3pt, 6 is 0.75pt. Colours
are six hex digits with no `#`. A borderless table needs all six sides set to
`BorderStyle.NONE` explicitly — omitting `borders` gives every edge
`<w:top w:val="single" w:color="auto" w:sz="4"/>`, which is a visible box.

```xml
<w:tblPr><w:tblW w:type="dxa" w:w="9026"/>
  <w:tblBorders><w:top w:val="none" w:color="auto" w:sz="0"/>…</w:tblBorders>
  <w:tblLayout w:type="fixed"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="560"/><w:gridCol w:w="8466"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="560"/>
  <w:tcBorders><w:bottom w:val="single" w:color="DA291C" w:sz="24"/></w:tcBorders>
</w:tcPr><w:p/></w:tc>…
```

`columnWidths` is what produces `<w:tblGrid>`; `width` on each cell produces
`<w:tcW>`. Both are needed — the design's note that tables spread without
explicit widths is about `<w:tblGrid>`.

### External hyperlink

```ts
new ExternalHyperlink({
  link: 'https://tebin.pro/',
  children: [new TextRun({ text: 'tebin.pro', style: 'Hyperlink' })],
})
```

```xml
<w:hyperlink w:history="1" r:id="rIdLink1">
  <w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">tebin.pro</w:t></w:r>
</w:hyperlink>
```

The target is only in the relationships file, never in the part. `style:
'Hyperlink'` on the run refers to a character style `docx` always emits.

### Page break

```ts
new Paragraph({ children: [new PageBreak()] })   //  <w:r><w:br w:type="page"/></w:r>
```

### Named paragraph styles from values in code

```ts
styles: {
  default: { document: { run: { font: 'Arial', size: 20, color: '1A1A1A' } } },
  paragraphStyles: [
    { id: 'Body', name: 'Body', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: 'Arial', size: 20, color: '1A1A1A' },
      paragraph: { spacing: { line: 276, after: 120 } } },
    { id: 'Code', name: 'Code', basedOn: 'Normal', next: 'Code',
      run: { font: 'Consolas', size: 18, color: '1A1A1A' },
      paragraph: { spacing: { line: 240, before: 120, after: 120 },
                   shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } } },
  ],
}
```

`run.size` is **half-points** (20 → 10pt, 44 → 22pt). `spacing.line` is
twentieths of a point. Shading is on `paragraph`, not `run`, and emits
`<w:shd w:fill="F2F2F2" w:color="auto" w:val="clear"/>`.

Applied with `new Paragraph({ text: '…', style: 'Body' })` →
`<w:pPr><w:pStyle w:val="Body"/></w:pPr>`.

### Bold and italic

```ts
new TextRun({ text: 'bold', bold: true })      // <w:rPr><w:b/><w:bCs/></w:rPr>
new TextRun({ text: 'italic', italics: true }) // <w:rPr><w:i/><w:iCs/></w:rPr>
```

The option is `italics`, not `italic`. Both emit the complex-script twin as
well, so a test should assert on `<w:b/>` and `<w:i/>`.

## Reading the file back

**No new dependency.** `jszip@3.10.1` is hoisted to the top of `node_modules`
by `docx` and ships its own `index.d.ts`, so `import JSZip from 'jszip'`
resolves and typechecks. It is nonetheless an *undeclared* dependency: the
normaliser above is production code, so `jszip` should be promoted to a direct
`dependency` in `package.json`. That adds nothing to the install — it is already
there — and it is the difference between a supported import and a hoisting bet.

The whole instrument is four lines:

```ts
import JSZip from 'jszip';

async function part(buf: Buffer, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(name);
  if (!file) throw new Error(`no such part: ${name}`);
  return await file.async('string');
}
```

`Object.keys(zip.files)` lists every entry in central-directory order;
`zip.files[n].dir` distinguishes the directory entries. This was run under the
project's own vitest (2.1.9) — five assertions across two spike files, all
passing — covering `word/document.xml`, `word/_rels/document.xml.rels`,
`word/styles.xml`, both header parts, and a check that no `r:id` or `r:embed` is
referenced without being declared.

What the XML gives a test to assert on:

| Question | Assert on |
|:--|:--|
| bold run | `<w:b/>` inside the run's `<w:rPr>` |
| italic run | `<w:i/>` inside the run's `<w:rPr>` |
| per-cell value | `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="3000"/></w:tcPr><w:p>…<w:t>NIP</w:t>` |
| column widths | `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6026"/>` |
| link target | `Target="https://tebin.pro/" TargetMode="External"` in `word/_rels/document.xml.rels` |
| link text ↔ target | `<w:hyperlink … r:id="X">` in the part, `Id="X"` in the rels |
| different first page | `<w:titlePg/>` and two `<w:headerReference>` in `<w:sectPr>` |
| image count | entries under `word/media/` |

`<w:t>` is written as `<w:t xml:space="preserve">`, so a test matching on
`<w:t>` alone finds nothing.

## Traps

**Custom styles named `Heading1` collide with the library's own.** `docx`
always emits a built-in style set — `Title, Heading1…Heading6, Strong,
ListParagraph, Hyperlink, FootnoteReference, FootnoteText, FootnoteTextChar,
EndnoteReference, EndnoteText, EndnoteTextChar` — and appends
`styles.paragraphStyles` after it. The design's `Heading1`, `Heading2`,
`Heading3` therefore produce **duplicate `w:styleId` values** in `styles.xml`.
Word 365 on this machine applied the *last* definition (the first paragraph
reported Arial, 22pt, `#1A1A1A`, bold — the values passed in code, not the
built-in blue `#2E74B5`), so the document is not wrong here. But last-wins is
not a documented guarantee, and other readers were not measured. The cheap fix
is distinct ids.

The apparent escape hatch is worse: `styles.importedStyles: []` does suppress
the built-ins, but it also removes `<w:docDefaults>` — so the theme's default
font and colour vanish — and removes the `Hyperlink` character style the link
code depends on. Measured:

```
paragraphStyles only : Title, Heading1…EndnoteTextChar, Heading1   docDefaults: true
importedStyles: []   : Heading1                                    docDefaults: false
distinct ids         : Title, Heading1…EndnoteTextChar, DocH1      docDefaults: true
```

**`headers.default` is `header1.xml`.** Named above; it is the assertion most
likely to be written backwards.

**A borderless table is not the default.** Omitting `borders` gives every edge a
visible hairline.

**`italics`, not `italic`.** TypeScript catches it; a hand-written fixture will
not.

**Relationship ids are not contiguous.** A single document produced
`rId1…rId9`, then `rId11`, with the hyperlink between `rId8` and `rId9`. Nothing
may assume sequence.

**Two builds within the same second look reproducible.** The zip timestamp has
two-second resolution, so a byte-identity test that builds twice back to back
can pass with no normalisation at all. The gate must either normalise or force a
gap; the measurement above used a deliberate delay for exactly this reason.

## Audit

```
npm audit --omit=dev
found 0 vulnerabilities
```

Clean for consumers. The 7 findings a full `npm audit` reports are all
dev-side and pre-existing — `esbuild` under `vite`/`vitest`, and `tar`. The
lockfile diff confirms `docx` introduced none of them: it added `core-util-is`,
`docx`, `hash.js`, `immediate`, `isarray`, `jszip`, `lie`,
`minimalistic-assert`, `nanoid`, `process-nextick-args`, `readable-stream`,
`safe-buffer`, `sax`, `setimmediate`, `string_decoder`, `undici-types`, `xml`,
`xml-js` and `@types/node`.

## Not measured

- Whether readers other than Word 365 (LibreOffice, Google Docs, Pages) accept
  the duplicate `w:styleId`. LibreOffice is not installed here.
- Byte identity on a non-Windows platform, or under a different Node major.
- Whether `Packer.toBuffer`'s `overrides` argument is a viable route for
  `docProps/core.xml` — it would not remove the need to re-zip for the entry
  timestamps, so it was not pursued.
