// A .docx packed twice from the same input is not the same file. Three things
// move: every zip entry's DOS timestamp (JSZip stamps new Date()), the
// dcterms:created / dcterms:modified pair in docProps/core.xml (docx hardcodes
// the wall clock and offers no option), and the relationship id of every
// external hyperlink (a nanoid off Math.random()).
//
// The obvious cheap fix — substituting fixed-width bytes in place, which is
// what this project's PDF path did while Chromium's own output was what it
// normalised — cannot work here: the ids deflate to different sizes and every
// zip entry carries a CRC and a local-header offset. So the package is
// unpacked, edited and rebuilt. Measured 2026-08-12: rebuilding with JSZip
// reproduces docx's own DEFLATE output — of 28 entries only the three actually
// edited change CRC or compressed size — and Word opens the result with no
// repair prompt.
//
// Checked 2026-08-13, when docx.ts's list rendering started emitting
// word/numbering.xml: its abstractNumId/numId pairs are not ids of this
// kind. They come from docx's own uniqueNumericIdCreator (see
// node_modules/docx/dist/index.cjs), a plain per-Document counter seeded at
// a fixed value and incremented once per abstractNum/num created — never
// Math.random, never the wall clock — so two renders of the same IR ask for
// the same ids in the same order and get the same ids back. Confirmed by
// rendering the kitchen-sink fixture twice and diffing the buffers: no
// bytes moved. Nothing here needed rewriting to make numbering
// reproducible; it already was.

import JSZip from 'jszip';

/** A docx-generated hyperlink id: "rId" followed by a 21-character nanoid. */
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
    parts.set(
      'docProps/core.xml',
      Buffer.from(
        core.toString('utf8').replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<)/g, `$1${iso}$2`),
        'utf8',
      ),
    );
  }

  // A relationship id is local to its part, so the renumbering is too: the same
  // id must be rewritten in the part and in that part's own .rels, and nowhere
  // else. Numbered by order of first appearance, which is deterministic
  // because the part's own content is.
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
    // createFolders belongs on file(), not on generateAsync — JSZip's types
    // reject it there, and a folder entry invented on the way out would change
    // the entry list.
    if (data === null) out.file(name, '', { dir: true, date: stamp, createFolders: false });
    else out.file(name, data, { date: stamp, createFolders: false, binary: true });
  }
  return await out.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}
