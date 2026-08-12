// DOCX (word/document.xml, OOXML) → IR. Scoped by measurement, not ambition —
// see docs/superpowers/specs/2026-08-12-docx-ingest-slice-design.md, written
// from a corpus of 86 due-diligence reply letters. No document in that corpus
// has a table, and only three use a heading style at all: the bodies are flat
// runs of paragraphs and list items, so that is what this file reads.
//
// XML, not a DOM parser: bringing in one (fast-xml-parser, xmldom, …) would be
// this project's first parsing dependency, for a shape of document that is
// itself flat — no paragraph nests another paragraph, and the corpus has zero
// tables to nest inside a cell. Regexes below take advantage of exactly that
// flatness (a `w:p` never contains another `w:p`; nothing here recurses into
// a `w:tbl`'s cells because tables are dropped whole). What would defeat this
// approach is named at each site that depends on it — chiefly a table nested
// inside a table cell (`splitTopLevel`) and a heading/list style that Word
// localises under a different `w:styleId` than the `HeadingN` this file
// matches. A future ingester that has to read nested structure (tables, or a
// richer heading vocabulary) should reach for a real parser instead of
// growing these regexes to cover it.

import JSZip from 'jszip';
import { posix } from 'node:path';
import type { Block, Ingested, Inline } from '../ir/types.js';

type Sink = { blocks: Block[]; dropped: string[] };

// ---------------------------------------------------------------------------
// XML entity / text plumbing
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

/** Plain text of an XML fragment, tags stripped — used only to hunt for a
 *  date in the header/footer, never for body content (which is read
 *  structurally, run by run, so bold/italic/links survive). */
function stripTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function truncate(s: string, n = 60): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

// ---------------------------------------------------------------------------
// Relationships (word/_rels/document.xml.rels): rId → target
// ---------------------------------------------------------------------------

type Rel = { type: string; target: string; external: boolean };

function parseRels(xml: string): Map<string, Rel> {
  const out = new Map<string, Rel>();
  for (const tag of xml.match(/<Relationship\b[^>]*\/>/g) ?? []) {
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const type = /\bType="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (!id || !type || target === undefined) continue;
    out.set(id, { type, target: decodeXmlEntities(target), external: /\bTargetMode="External"/.test(tag) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbering (word/numbering.xml): the two-hop numId → abstractNum → lvl lookup
// ---------------------------------------------------------------------------

type Lvl = { numFmt: string; start: number };
type AbstractNum = Map<string, Lvl>; // ilvl -> Lvl
type NumDef = { abstractNumId: string; overrides: Map<string, number> }; // ilvl -> startOverride

type Numbering = { abstractNums: Map<string, AbstractNum>; nums: Map<string, NumDef> };

function parseNumbering(xml: string | null): Numbering {
  const abstractNums = new Map<string, AbstractNum>();
  const nums = new Map<string, NumDef>();
  if (xml === null) return { abstractNums, nums };

  for (const block of xml.match(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = /\bw:abstractNumId="([^"]*)"/.exec(block)?.[1];
    if (id === undefined) continue;
    const byIlvl: AbstractNum = new Map();
    for (const lvl of block.match(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/g) ?? []) {
      const ilvl = /\bw:ilvl="([^"]*)"/.exec(lvl)?.[1];
      if (ilvl === undefined) continue;
      const numFmt = /<w:numFmt\b[^>]*\bw:val="([^"]*)"/.exec(lvl)?.[1] ?? 'decimal';
      const start = Number(/<w:start\b[^>]*\bw:val="([^"]*)"/.exec(lvl)?.[1] ?? '1');
      byIlvl.set(ilvl, { numFmt, start: Number.isFinite(start) ? start : 1 });
    }
    abstractNums.set(id, byIlvl);
  }

  for (const block of xml.match(/<w:num\b[^>]*>[\s\S]*?<\/w:num>/g) ?? []) {
    const numId = /\bw:numId="([^"]*)"/.exec(block)?.[1];
    const abstractNumId = /<w:abstractNumId\b[^>]*\bw:val="([^"]*)"/.exec(block)?.[1];
    if (numId === undefined || abstractNumId === undefined) continue;
    const overrides = new Map<string, number>();
    for (const ov of block.match(/<w:lvlOverride\b[^>]*>[\s\S]*?<\/w:lvlOverride>/g) ?? []) {
      const ilvl = /\bw:ilvl="([^"]*)"/.exec(ov)?.[1];
      const startVal = /<w:startOverride\b[^>]*\bw:val="([^"]*)"/.exec(ov)?.[1];
      if (ilvl !== undefined && startVal !== undefined) overrides.set(ilvl, Number(startVal));
    }
    nums.set(numId, { abstractNumId, overrides });
  }
  return { abstractNums, nums };
}

/** Resolves a `numId`/`ilvl` pair to `{ ordered, start }`, or `null` when the
 *  chain breaks anywhere along the way. A broken chain must not crash the
 *  ingest — a `numId` with no matching `<w:num>`, or one that names an
 *  `abstractNumId` nobody defined, both happen in the wild (a numbering part
 *  edited by hand, or copied from another document that carried the
 *  definition and this one didn't). The caller degrades a paragraph with an
 *  unresolved `numId` to an ordinary paragraph rather than guessing bullet or
 *  ordered — a wrong guess would misrepresent the source silently, where a
 *  plain paragraph at least keeps the words and says why the list-ness of it
 *  was lost. */
function resolveLevel(numbering: Numbering, numId: string, ilvl: string): Lvl | null {
  const num = numbering.nums.get(numId);
  if (!num) return null;
  const abstractNum = numbering.abstractNums.get(num.abstractNumId);
  if (!abstractNum) return null;
  // A level definition is required at every `ilvl` a document actually uses,
  // but a hand-edited numbering part might only define ilvl 0 — falling back
  // to it is closer to what Word itself does than refusing the paragraph.
  const lvl = abstractNum.get(ilvl) ?? abstractNum.get('0');
  if (!lvl) return null;
  const override = num.overrides.get(ilvl);
  return { numFmt: lvl.numFmt, start: override ?? lvl.start };
}

// ---------------------------------------------------------------------------
// Body: top-level paragraphs and tables
// ---------------------------------------------------------------------------

type Unit = { kind: 'p'; xml: string } | { kind: 'tbl'; xml: string };

/** Splits `<w:body>…</w:body>`'s content into its direct children, keeping
 *  only `<w:p>` and `<w:tbl>` — everything else at this level is the body's
 *  own `<w:sectPr>`, which this ingester has no use for (page size and
 *  margins are the theme's business, not the source document's).
 *
 *  This assumes a `w:tbl` never contains another `w:tbl`: the non-greedy
 *  `[\s\S]*?` for a table closes at the *first* `</w:tbl>` it finds, which
 *  would be the inner table's, leaving the outer table's own close tag
 *  dangling in the stream and corrupting everything read after it. The
 *  corpus this ingester was built for has zero tables, nested or otherwise —
 *  see the design doc — so this is a real limit, not a hedge. */
function splitTopLevel(bodyXml: string): Unit[] {
  const re = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g;
  const out: Unit[] = [];
  for (const m of bodyXml.match(re) ?? []) out.push({ kind: m.startsWith('<w:tbl') ? 'tbl' : 'p', xml: m });
  return out;
}

function extractBody(documentXml: string): string {
  const m = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml);
  return m?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// Paragraph properties
// ---------------------------------------------------------------------------

type NumPr = { ilvl: string; numId: string };

type ParaProps = { style: string | null; numPr: NumPr | null };

function paraProps(pXml: string): ParaProps {
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] ?? '';
  const style = /<w:pStyle\b[^>]*\bw:val="([^"]*)"/.exec(pPr)?.[1] ?? null;
  const numPrXml = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1];
  let numPr: NumPr | null = null;
  if (numPrXml !== undefined) {
    const numId = /<w:numId\b[^>]*\bw:val="([^"]*)"/.exec(numPrXml)?.[1];
    const ilvl = /<w:ilvl\b[^>]*\bw:val="([^"]*)"/.exec(numPrXml)?.[1] ?? '0';
    // numId "0" is Word's own way of saying "no numbering here", used to
    // switch numbering off on a paragraph that would otherwise inherit it
    // from a style — not a broken reference, so it degrades to a plain
    // paragraph without a dropped-content note.
    if (numId !== undefined && numId !== '0') numPr = { ilvl, numId };
  }
  return { style, numPr };
}

function runsRegionOf(pXml: string): string {
  return pXml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '');
}

// ---------------------------------------------------------------------------
// Runs → inline nodes, with the same-shaped image/page-break carve-out
// paragraphs need and headings/list items don't (see md.ts's `inlinesOf`,
// which this mirrors: images are collected out-of-band so the caller can
// decide whether "sibling block" is even a place they can go).
// ---------------------------------------------------------------------------

type Fmt = { bold?: boolean; italics?: boolean };

/** `<w:b/>` means on; `<w:b w:val="0"/>` or `w:val="false"` means explicitly
 *  off (used to cancel a style's own bold inside one run) — both shapes occur
 *  in documents that started life in real Word, not just this project's own
 *  renderer, which only ever emits the bare form. */
function flagOn(rPr: string, tag: string): boolean {
  const m = new RegExp(`<w:${tag}\\b([^/]*)/>`).exec(rPr);
  if (!m) return false;
  const val = /\bw:val="([^"]*)"/.exec(m[1] ?? '')?.[1];
  return val === undefined || !/^(0|false)$/i.test(val);
}

function wrapFmt(nodes: Inline[], fmt: Fmt): Inline[] {
  let out = nodes;
  if (fmt.italics) out = [{ t: 'em', children: out }];
  if (fmt.bold) out = [{ t: 'strong', children: out }];
  return out;
}

/** A single `<w:r>…</w:r>` (rPr already known to hold no drawing/page-break —
 *  the caller sorts those out first) → its text as inline nodes, formatted by
 *  its own `w:b`/`w:i`. Reports anything else it finds in the run instead of
 *  swallowing it: comments, footnotes, fields and tracked-change markup all
 *  end up here since none of them get a bespoke reader (see the design's drop
 *  list) — they are indistinguishable to this function, which is fine, since
 *  all of them are dropped the same way: named, not silently gone. */
function runText(runXml: string, sink: Sink): Inline[] {
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0] ?? '';
  const fmt: Fmt = { bold: flagOn(rPr, 'b'), italics: flagOn(rPr, 'i') };
  const body = runXml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '');

  let text = '';
  let consumed = '';
  const partRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\/>|<w:cr\/>|<w:noBreakHyphen\/>|<w:softHyphen\/>/g;
  for (const m of body.matchAll(partRe)) {
    consumed += m[0];
    if (m[0].startsWith('<w:t')) text += decodeXmlEntities(m[1] ?? '');
    else if (m[0] === '<w:tab/>') text += '\t';
    else if (m[0] === '<w:br/>' || m[0] === '<w:cr/>') text += '\n';
    else if (m[0] === '<w:noBreakHyphen/>') text += '\u2011';
    // softHyphen carries no visible character when the line doesn't break.
  }

  // Whatever is left after pulling `w:rPr` and the recognised text-bearing
  // elements out is something this reader doesn't have a name for — a
  // comment reference, a footnote reference, a field character, tracked-
  // change wrapper content that isn't itself a run. Reported once per run
  // rather than decoded, on the same "say what was lost" principle as the
  // rest of this file.
  const leftover = body.replace(partRe, '');
  if (/<w:\w/.test(leftover)) {
    sink.dropped.push(`run content this ingester does not read: ${truncate(leftover)}`);
  }

  return text === '' ? [] : wrapFmt([{ t: 'text', v: text }], fmt);
}

type Segment = { kind: 'text'; inlines: Inline[] } | { kind: 'image'; src: string; alt: string } | { kind: 'pagebreak' };

/** Splits a paragraph's runs region into ordered segments: text, an image, or
 *  a page break, in source order — the same reason md.ts's paragraph case
 *  orders an image after the text it was embedded beside rather than always
 *  last. `images`/`pageBreaks` control whether an image or a page break found
 *  here becomes its own segment or is reported as unrepresentable: a plain
 *  body paragraph can hold either as a sibling block, but a heading or a list
 *  item has nowhere to put one (the IR's heading and list item are text-only,
 *  same limitation md.ts's `inlinesOf` names for a Markdown image in the same
 *  positions). */
function paragraphSegments(
  pXml: string,
  rels: Map<string, Rel>,
  media: Map<string, { src: string } | { dropped: string }>,
  sink: Sink,
  opts: { images: boolean; pageBreaks: boolean; context: string },
): Segment[] {
  const runs = runsRegionOf(pXml);
  const segments: Segment[] = [];
  let current: Inline[] = [];
  const flush = () => {
    if (current.length > 0) segments.push({ kind: 'text', inlines: current });
    current = [];
  };

  const unitRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  for (const m of runs.matchAll(unitRe)) {
    if (m[1] !== undefined) {
      // A hyperlink. Its target is the relationship its `r:id` names — never
      // the visible text, which is what makes phishing via a mismatched link
      // text/href possible in the first place — so the href is looked up,
      // not read off the run.
      const rId = /\br:id="([^"]*)"/.exec(m[1])?.[1];
      const inner = m[2] ?? '';
      const children = innerRunsToInlines(inner, sink, opts.context);
      const rel = rId !== undefined ? rels.get(rId) : undefined;
      if (rel === undefined) {
        sink.dropped.push('hyperlink with no resolvable relationship (kept the text, dropped the link)');
        current.push(...children);
      } else {
        // The scheme rule (refusing javascript:/data: etc.) lives in
        // src/render/links.ts and runs at render time, not here: ingest's job
        // is to carry the href as written, exactly the same division the
        // design draws for the date and the letterhead — read faithfully,
        // judge later.
        current.push({ t: 'link', href: rel.target, children });
      }
      continue;
    }

    const runXml = m[0];
    const hasPageBreak = /<w:br\b[^>]*\bw:type="page"/.test(runXml);
    const drawingXml = /<w:drawing>[\s\S]*?<\/w:drawing>/.exec(runXml)?.[0];

    if (hasPageBreak) {
      if (!opts.pageBreaks) {
        sink.dropped.push(`page break inside a ${opts.context} has no representation`);
        continue;
      }
      flush();
      segments.push({ kind: 'pagebreak' });
      continue;
    }

    if (drawingXml !== undefined) {
      if (!opts.images) {
        sink.dropped.push(`image inside a ${opts.context} has no representation`);
        continue;
      }
      const graphicUri = /<a:graphicData\b[^>]*\buri="([^"]*)"/.exec(drawingXml)?.[1] ?? '';
      if (!graphicUri.endsWith('/picture')) {
        sink.dropped.push('a drawing that is not a picture (chart, shape or canvas) was dropped');
        continue;
      }
      const embed = /<a:blip\b[^>]*\br:embed="([^"]*)"/.exec(drawingXml)?.[1];
      const resolved = embed !== undefined ? media.get(embed) : undefined;
      if (resolved === undefined) {
        sink.dropped.push('a picture whose relationship could not be resolved was dropped');
      } else if ('dropped' in resolved) {
        sink.dropped.push(resolved.dropped);
      } else {
        flush();
        // The renderer never writes an image's alt text into the .docx it
        // produces (src/render/docx.ts's ImageRun carries no description), so
        // reading it back can only ever recover an empty string for a file
        // this project itself rendered. A document authored in Word may set
        // `descr` on `pic:cNvPr`, so that is still read when present, on the
        // chance a source .docx carries one even though this project's own
        // output never will.
        const alt = /<pic:cNvPr\b[^>]*\bdescr="([^"]*)"/.exec(drawingXml)?.[1] ?? '';
        segments.push({ kind: 'image', src: resolved.src, alt: decodeXmlEntities(alt) });
      }
      continue;
    }

    current.push(...runText(runXml, sink));
  }
  flush();
  return segments;
}

/** Runs inside a hyperlink: text and formatting only. An image or a page
 *  break embedded inside a link has nowhere to go in the IR's link (its
 *  children are `Inline[]`, the same text-only shape a heading or list item
 *  has), so both are reported rather than silently dropped. */
function innerRunsToInlines(xml: string, sink: Sink, context: string): Inline[] {
  const out: Inline[] = [];
  for (const m of xml.matchAll(/<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
    if (/<w:drawing>/.test(m[0])) {
      sink.dropped.push(`image inside a hyperlink in a ${context} has no representation`);
      continue;
    }
    if (/<w:br\b[^>]*\bw:type="page"/.test(m[0])) {
      sink.dropped.push(`page break inside a hyperlink in a ${context} has no representation`);
      continue;
    }
    out.push(...runText(m[0], sink));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header/footer: the date is content, everything else is not (see the
// design doc's section of the same name). Measured over the corpus: every
// date that appeared read "July 20, 2026" — `Month D, YYYY` — so that is the
// one shape this looks for. A source using a different date format would
// pass through this regex and be dropped with the rest of the letterhead;
// widening it is a one-line change once a document that needs it exists.
// ---------------------------------------------------------------------------

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},\\s+\\d{4}\\b`);

async function scanHeadersAndFooters(zip: JSZip, sink: Sink): Promise<string | undefined> {
  const names = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d+\.xml$/.test(n)).sort();
  let date: string | undefined;
  let hadContent = false;
  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    const text = stripTags(await file.async('string'));
    if (text !== '') hadContent = true;
    if (date === undefined) {
      const m = DATE_RE.exec(text);
      if (m) date = m[0];
    }
  }
  // Dropped by design, not by accident: re-issuing the letterhead under the
  // current theme is the point of the tool, so its old branding is expected
  // to go. It is still named here so a header carrying something other than
  // branding — a disclaimer, a reference number — cannot vanish silently.
  if (hadContent) {
    sink.dropped.push(
      date !== undefined
        ? `header/footer letterhead dropped (kept the date it carried: "${date}")`
        : 'header/footer letterhead dropped (no date found in it)',
    );
  }
  return date;
}

// ---------------------------------------------------------------------------
// Images: word/media/* by relationship, inlined as a data: URI. Every
// renderer in this project embeds rather than fetches (see src/render/*.ts),
// so an ingester that emitted a path instead would break that promise one
// layer up, the moment the .docx that carried the picture was deleted.
// ---------------------------------------------------------------------------

const RASTER_SIGNATURES: Array<{ mime: string; sig: number[] }> = [
  { mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', sig: [0x42, 0x4d] },
];

function sniffRaster(bytes: Buffer): string | null {
  for (const { mime, sig } of RASTER_SIGNATURES) {
    if (bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)) return mime;
  }
  return null;
}

/** Resolves every image relationship up front (rather than lazily, mid-parse)
 *  so paragraph parsing — which is synchronous, matching md.ts's shape — never
 *  has to await a zip read in the middle of a regex walk. */
async function loadMedia(zip: JSZip, rels: Map<string, Rel>): Promise<Map<string, { src: string } | { dropped: string }>> {
  const out = new Map<string, { src: string } | { dropped: string }>();
  for (const [rId, rel] of rels) {
    if (!rel.type.endsWith('/image')) continue;
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : posix.join('word', rel.target);
    const file = zip.file(path);
    if (!file) {
      out.set(rId, { dropped: `an image (${path}) was referenced but not found in the package` });
      continue;
    }
    const bytes = Buffer.from(await file.async('nodebuffer'));
    const mime = sniffRaster(bytes);
    if (mime === null) {
      out.set(rId, { dropped: `an image (${path}) is not a raster format this ingester reads (PNG/JPEG/GIF/BMP)` });
      continue;
    }
    out.set(rId, { src: `data:${mime};base64,${bytes.toString('base64')}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Headings, straight text
// ---------------------------------------------------------------------------

/** `DocH1`/`DocH2`/`DocH3` are this project's own styles — the round trip
 *  needs them recognised, since renderDocx.ts's `blocks()` writes exactly
 *  these for a `heading` block. `Heading1`..`Heading6` (no space) is Word's
 *  own built-in style id, which is what the source corpus actually carries
 *  (measured: `Heading5`, three times, across 81 documents). Anything else —
 *  a custom outline style, a localised id Word wrote under a different name —
 *  is not a heading this ingester recognises, and becomes an ordinary
 *  paragraph rather than a guess. */
function headingLevel(style: string | null): { level: 1 | 2 | 3; sourceDepth: number } | null {
  if (style === null) return null;
  const own = /^DocH([123])$/.exec(style);
  if (own) return { level: Number(own[1]!) as 1 | 2 | 3, sourceDepth: Number(own[1]!) };
  const word = /^Heading([1-6])$/.exec(style);
  if (word) {
    const depth = Number(word[1]!);
    return { level: (depth > 3 ? 3 : depth) as 1 | 2 | 3, sourceDepth: depth };
  }
  return null;
}

function flattenInlines(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : flattenInlines(n.children))).join('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type ListGroup = { ordered: boolean; depth: number; numId: string; start: number; items: Inline[][] };

export async function ingestDocx(
  bytes: Uint8Array | Buffer,
  opts: { title?: string; date?: string; entity?: string } = {},
): Promise<Ingested> {
  const zip = await JSZip.loadAsync(bytes);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    // Not "content this ingester can't represent" — there is no document to
    // read at all, the same distinction renderDocx.ts's own thrown errors
    // draw between a source that lost information and an input the format
    // itself refuses.
    throw new Error('not a Word document: word/document.xml is missing from the package');
  }
  const documentXml = await documentFile.async('string');
  const relsFile = zip.file('word/_rels/document.xml.rels');
  const rels = parseRels(relsFile ? await relsFile.async('string') : '');
  const numberingFile = zip.file('word/numbering.xml');
  const numbering = parseNumbering(numberingFile ? await numberingFile.async('string') : null);
  const media = await loadMedia(zip, rels);

  const sink: Sink = { blocks: [], dropped: [] };
  let title: string | undefined;
  let subtitle: string | undefined;

  // Word does not store the number a list item actually carries — only the
  // definition (`abstractNum`) and any per-numId override. The number a
  // reader sees is the position of that paragraph among every paragraph
  // sharing the same `numId`+`ilvl`, counted from the resolved start. That
  // count is threaded through here rather than recomputed per paragraph
  // because a later fragment of the same list (after a nested sub-list
  // interrupts it, exactly the shape md.ts's own list-splitting handles)
  // must resume where the earlier fragment left off, not restart at 1.
  const counters = new Map<string, number>(); // `${numId}:${ilvl}` -> next number
  let openGroup: ListGroup | null = null;
  const flushGroup = () => {
    if (!openGroup) return;
    sink.blocks.push(
      openGroup.ordered && openGroup.start !== 1
        ? { t: 'list', ordered: openGroup.ordered, depth: openGroup.depth, items: openGroup.items, start: openGroup.start }
        : { t: 'list', ordered: openGroup.ordered, depth: openGroup.depth, items: openGroup.items },
    );
    openGroup = null;
  };

  for (const unit of splitTopLevel(extractBody(documentXml))) {
    if (unit.kind === 'tbl') {
      flushGroup();
      const rows = (unit.xml.match(/<w:tr\b/g) ?? []).length;
      // The one thing in this slice a later document is likely to need (see
      // the design doc's "What it drops, loudly") — named with its size so
      // the gap is visible rather than a document that quietly lost a table.
      sink.dropped.push(`table with ${rows} rows`);
      continue;
    }

    const { style, numPr } = paraProps(unit.xml);

    // The title/subtitle slot this project's own renderer writes (DocTitle /
    // DocSubtitle) is not body content — it is where doc.meta.title and
    // .subtitle already went when this file was rendered — so it is read
    // back into meta, never emitted as a paragraph block. The corpus this
    // ingester was built for carries no title in its body at all (see the
    // design doc), so this path exists for the round trip, not for the
    // corpus: `opts.title` still wins when the caller supplies one, same as
    // ingestMarkdown's h1 fallback.
    if (style === 'DocTitle' || style === 'DocSubtitle') {
      flushGroup();
      const segs = paragraphSegments(unit.xml, rels, media, sink, { images: false, pageBreaks: false, context: 'title' });
      const text = flattenInlines(segs.flatMap((s) => (s.kind === 'text' ? s.inlines : [])));
      if (style === 'DocTitle') title ??= text;
      else subtitle ??= text;
      continue;
    }

    const heading = headingLevel(style);
    if (heading) {
      flushGroup();
      if (heading.sourceDepth > 3) {
        sink.dropped.push(`h${heading.sourceDepth} clamped to h3 (the IR has three heading levels)`);
      }
      const segs = paragraphSegments(unit.xml, rels, media, sink, { images: false, pageBreaks: false, context: 'heading' });
      const text = segs.flatMap((s) => (s.kind === 'text' ? s.inlines : []));
      sink.blocks.push({ t: 'heading', level: heading.level, text });
      continue;
    }

    if (numPr) {
      const resolved = resolveLevel(numbering, numPr.numId, numPr.ilvl);
      const segs = paragraphSegments(unit.xml, rels, media, sink, { images: false, pageBreaks: false, context: 'list item' });
      const text = segs.flatMap((s) => (s.kind === 'text' ? s.inlines : []));
      if (resolved === null) {
        sink.dropped.push(
          `list numbering unresolved (numId ${numPr.numId} has no usable definition): item kept as a plain paragraph`,
        );
        flushGroup();
        if (text.length > 0) sink.blocks.push({ t: 'para', text });
        continue;
      }
      const ordered = resolved.numFmt !== 'bullet';
      const depth = Number(numPr.ilvl);
      const key = `${numPr.numId}:${numPr.ilvl}`;
      let n = counters.get(key);
      if (n === undefined) n = resolved.start;
      counters.set(key, n + 1);

      if (openGroup && openGroup.ordered === ordered && openGroup.depth === depth && openGroup.numId === numPr.numId) {
        openGroup.items.push(text);
      } else {
        flushGroup();
        openGroup = { ordered, depth, numId: numPr.numId, start: n, items: [text] };
      }
      continue;
    }

    // An ordinary paragraph: images and page breaks are collected as sibling
    // blocks rather than dropped, the same split md.ts's `blockOf` makes for
    // a Markdown paragraph.
    flushGroup();
    const segs = paragraphSegments(unit.xml, rels, media, sink, { images: true, pageBreaks: true, context: 'paragraph' });
    for (const seg of segs) {
      if (seg.kind === 'pagebreak') sink.blocks.push({ t: 'pagebreak' });
      else if (seg.kind === 'image') sink.blocks.push({ t: 'image', src: seg.src, alt: seg.alt });
      else if (seg.inlines.some((n) => n.t !== 'text' || n.v.trim() !== '')) sink.blocks.push({ t: 'para', text: seg.inlines });
    }
  }
  flushGroup();

  const foundDate = await scanHeadersAndFooters(zip, sink);
  const date = opts.date ?? foundDate;
  const finalTitle = opts.title ?? title;

  return {
    doc: {
      meta: {
        title: finalTitle && finalTitle !== '' ? finalTitle : 'Untitled',
        lang: 'en',
        ...(subtitle !== undefined && subtitle !== '' ? { subtitle } : {}),
        ...(date !== undefined ? { date } : {}),
        ...(opts.entity !== undefined ? { entity: opts.entity } : {}),
      },
      blocks: sink.blocks,
    },
    dropped: sink.dropped,
  };
}
