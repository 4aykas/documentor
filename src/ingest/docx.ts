// DOCX (word/document.xml, OOXML) → IR. Scoped by measurement, not ambition —
// see docs/superpowers/specs/2026-08-12-docx-ingest-slice-design.md, written
// from a corpus of 86 short reply letters on a legacy letterhead. No document
// in it has a table, and only three use a heading style at all: the bodies are
// flat runs of paragraphs and list items, so that is what this file reads.
//
// XML, not a DOM parser: bringing in one (fast-xml-parser, xmldom, …) would be
// this project's first parsing dependency, for a shape of document that is
// itself flat — no paragraph nests another paragraph, and the corpus has zero
// tables to nest inside a cell. Regexes below take advantage of exactly that
// flatness (a `w:p` never contains another `w:p`; nothing here recurses into
// a `w:tbl`'s cells because tables are dropped whole). What would defeat this
// approach is named at each site that depends on it, and summarised here so
// the risk is visible in one place rather than only where it happens to bite:
//   - A table nested inside a table cell (`splitTopLevel`): the non-greedy
//     match for `<w:tbl>…</w:tbl>` closes at the first `</w:tbl>` it finds,
//     the inner table's, corrupting everything read after it.
//   - A heading/list style Word localises under a different `w:styleId` than
//     the `HeadingN` this file matches (`headingLevel`).
//   - A tracked-change wrapper (`<w:ins>`/`<w:del>`): the run-matching regex
//     finds a `<w:r>` wherever it sits in the string, ancestor tags or not,
//     so an inserted run reads as ordinary content regardless of the
//     `<w:ins>` around it — a deliberate policy here (see `runText`'s
//     comment), not an accident, but only because it is impossible for a
//     regex to see the wrapper in the first place.
//   - An attribute on a paragraph-level wrapper carries meaning a nested run
//     never sees: `<w:fldSimple w:instr='HYPERLINK "url"'>text</w:fldSimple>`
//     puts the href in `w:instr`, not in any `<w:t>`, so a scan that only
//     ever looks *inside* a run (the leftover check in `runAtoms`) finds
//     nothing wrong — the run regex still matches the nested `<w:r>` for
//     "text" wherever it sits, and the href is gone with no trace. Fixed
//     structurally, not by special-casing `fldSimple`: `paragraphSegments`
//     now runs the same leftover check `runAtoms` already ran per-run, once
//     more over the paragraph as a whole, so *any* unrecognised
//     paragraph-level wrapper — `<w:smartTag>`, `<w:customXml>`, a future one
//     nobody has written a case for yet — is reported instead of silently
//     discarding whatever it wrapped, even though only `fldSimple` gets its
//     meaning actually carried forward (see `paragraphSegments`'s own
//     comment on why the complex `fldChar` form gets the same treatment).
//   - `<w:pPrChange>`: a paragraph's own `<w:pPr>` can contain a nested
//     `<w:pPrChange><w:pPr>…</w:pPr></w:pPrChange>` recording what the
//     paragraph's properties were *before* a tracked format change. The
//     non-greedy `<w:pPr>([\s\S]*?)<\/w:pPr>` in `paraProps` would close at
//     that inner `</w:pPr>` instead of the outer paragraph's own one,
//     reading the pre-change style or numbering instead of the current one.
//     Not defended against: no document in the corpus tracks changes.
//   - Run splitting: Word frequently emits one logical run of text as several
//     adjacent `<w:r>` elements with identical formatting (spell-check
//     boundaries, an editing session's own history). A regex walk sees each
//     one, so an ingester that didn't merge adjacent same-formatted inline
//     nodes back together would hand the renderers a paragraph text made of
//     needlessly many nodes; `mergeAdjacentInlines` below is what closes
//     that gap, but a subtler split (formatting differing in a way that
//     doesn't matter to the IR, e.g. two runs whose fonts differ but whose
//     bold/italic agree) still passes through unmerged.
// A future ingester that has to read nested structure (tables, tracked
// changes properly, or a richer heading vocabulary) should reach for a real
// parser instead of growing these regexes to cover it.

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

type Lvl = { numFmt: string; start: number; lvlRestart?: number };
type AbstractNum = { byIlvl: Map<string, Lvl>; numStyleLink?: string };
type NumDef = { abstractNumId: string; overrides: Map<string, number> }; // ilvl -> startOverride

type Numbering = {
  abstractNums: Map<string, AbstractNum>;
  // A Word "list style" (Format ▸ Bullets and Numbering ▸ linked to a style)
  // stores its levels on one abstractNum, marked `<w:styleLink w:val="Name">`,
  // and every *other* abstractNum built from that style carries no `<w:lvl>`
  // of its own — only `<w:numStyleLink w:val="Name"/>`, pointing back at it
  // by style name, not by id. This is the second table `resolveLevel` needs
  // to walk that link.
  styleLinkAbstracts: Map<string, string>; // style name -> abstractNumId
  nums: Map<string, NumDef>;
};

function parseNumbering(xml: string | null): Numbering {
  const abstractNums = new Map<string, AbstractNum>();
  const styleLinkAbstracts = new Map<string, string>();
  const nums = new Map<string, NumDef>();
  if (xml === null) return { abstractNums, styleLinkAbstracts, nums };

  for (const block of xml.match(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = /\bw:abstractNumId="([^"]*)"/.exec(block)?.[1];
    if (id === undefined) continue;
    const byIlvl = new Map<string, Lvl>();
    for (const lvl of block.match(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/g) ?? []) {
      const ilvl = /\bw:ilvl="([^"]*)"/.exec(lvl)?.[1];
      if (ilvl === undefined) continue;
      const numFmt = /<w:numFmt\b[^>]*\bw:val="([^"]*)"/.exec(lvl)?.[1] ?? 'decimal';
      const start = Number(/<w:start\b[^>]*\bw:val="([^"]*)"/.exec(lvl)?.[1] ?? '1');
      const restartVal = /<w:lvlRestart\b[^>]*\bw:val="([^"]*)"/.exec(lvl)?.[1];
      const lvlRestart = restartVal !== undefined && Number.isFinite(Number(restartVal)) ? Number(restartVal) : undefined;
      byIlvl.set(ilvl, { numFmt, start: Number.isFinite(start) ? start : 1, ...(lvlRestart !== undefined ? { lvlRestart } : {}) });
    }
    const numStyleLink = /<w:numStyleLink\b[^>]*\bw:val="([^"]*)"/.exec(block)?.[1];
    const styleLink = /<w:styleLink\b[^>]*\bw:val="([^"]*)"/.exec(block)?.[1];
    abstractNums.set(id, { byIlvl, ...(numStyleLink !== undefined ? { numStyleLink } : {}) });
    if (styleLink !== undefined) styleLinkAbstracts.set(styleLink, id);
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
  return { abstractNums, styleLinkAbstracts, nums };
}

/** Resolves a `numId`/`ilvl` pair to its format and starting number, or
 *  `null` when the chain breaks anywhere along the way. A broken chain must
 *  not crash the ingest — a `numId` with no matching `<w:num>`, or one that
 *  names an `abstractNumId` nobody defined, both happen in the wild (a
 *  numbering part edited by hand, or copied from another document that
 *  carried the definition and this one didn't). The caller degrades a
 *  paragraph with an unresolved `numId` to an ordinary paragraph rather than
 *  guessing bullet or ordered — a wrong guess would misrepresent the source
 *  silently, where a plain paragraph at least keeps the words and says why
 *  the list-ness of it was lost. */
function resolveLevel(numbering: Numbering, numId: string, ilvl: string): Lvl | null {
  const num = numbering.nums.get(numId);
  if (!num) return null;
  let abstractNum = numbering.abstractNums.get(num.abstractNumId);
  if (!abstractNum) return null;

  // A list built from a Word list style defines no levels on its own
  // abstractNum — see the `styleLinkAbstracts` comment above. This is one
  // hop, not a general alias-chasing walk: OOXML producers don't chain
  // `numStyleLink` through more than one indirection in practice, and a
  // document that somehow did still degrades safely below (`byIlvl` stays
  // empty, `lvl` comes back `undefined`, the paragraph becomes plain text).
  if (abstractNum.byIlvl.size === 0 && abstractNum.numStyleLink !== undefined) {
    const linkedId = numbering.styleLinkAbstracts.get(abstractNum.numStyleLink);
    const linked = linkedId !== undefined ? numbering.abstractNums.get(linkedId) : undefined;
    if (linked) abstractNum = linked;
  }

  // A level definition is required at every `ilvl` a document actually uses,
  // but a hand-edited numbering part might only define ilvl 0 — falling back
  // to it is closer to what Word itself does than refusing the paragraph.
  const lvl = abstractNum.byIlvl.get(ilvl) ?? abstractNum.byIlvl.get('0');
  if (!lvl) return null;
  const override = num.overrides.get(ilvl);
  return { numFmt: lvl.numFmt, start: override ?? lvl.start, ...(lvl.lvlRestart !== undefined ? { lvlRestart: lvl.lvlRestart } : {}) };
}

/**
 * Word does not store the number a list item actually carries — only the
 * definition plus any override — so a level's counter has to be reset the
 * same way Word's own numbering engine resets it: whenever a shallower item
 * interrupts it. By default (no explicit `<w:lvlRestart>` on the level)
 * OOXML restarts a level whenever *any* shallower `ilvl` occurs, not only
 * the immediate parent — `a / a.i / b / b.i` numbers the second sub-list
 * "i", not "ii", because `b` at ilvl 0 restarts every deeper level under it.
 * An explicit `<w:lvlRestart w:val="N"/>` narrows that to "restart only when
 * ilvl N specifically occurs", which is honoured here by checking the
 * *deeper* level's own restart value, not the incoming paragraph's — with one
 * reserved value: ECMA-376 gives `N=0` the meaning "this level is *never*
 * restarted", not "restart at ilvl 0". Treating it as an ordinary ilvl to
 * compare against (as an earlier version of this function did) inverted the
 * document's own instruction — restarting on the single most common
 * interruption instead of never restarting at all, silently, since a
 * misnumbered list has nothing to say in `dropped`.
 */
function resetDeeperCounters(numbering: Numbering, counters: Map<string, number>, numId: string, ilvl: number): void {
  const prefix = `${numId}:`;
  for (const key of counters.keys()) {
    if (!key.startsWith(prefix)) continue;
    const otherIlvl = Number(key.slice(prefix.length));
    if (!(otherIlvl > ilvl)) continue;
    const lvl = resolveLevel(numbering, numId, String(otherIlvl));
    const restart = lvl?.lvlRestart;
    const triggers = restart === undefined ? true : restart !== 0 && ilvl === restart;
    if (triggers) counters.delete(key);
  }
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
  // `<w:tbl\b[^>]*>` rather than a literal `<w:tbl>`, matching the `<w:p>`
  // alternative's own tolerance for attributes: ECMA-376 gives `w:tbl` no
  // attributes today, but if a producer ever added one, a literal match
  // would simply not recognise the table as a unit at all — and the `<w:p>`
  // elements inside its cells would then each be picked up individually by
  // the paragraph alternative below, promoted to body paragraphs with no
  // `dropped` entry to say so. Silent corruption, not a loud drop; matching
  // the same way `<w:p>` already does closes that gap rather than hoping the
  // literal stays true forever.
  const re = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
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
  // Strips the paragraph's own `<w:p>…</w:p>` wrapper along with its
  // `<w:pPr>`, not just the latter: the wrapper never mattered while the
  // only leftover check lived inside `runAtoms` (scoped to one `<w:r>`'s own
  // insides, which never sees the paragraph tag around it at all), but the
  // paragraph-level leftover check in `paragraphSegments` scans this whole
  // string — leaving `<w:p>`/`</w:p>` in place would make *every* paragraph
  // report itself as unread content, the same shape of bug the run-level
  // check's own history warns about (its doc comment: "made every ordinary
  // run report itself as unread content" before the `<w:r>` wrapper was
  // stripped there).
  return pXml
    .replace(/^<w:p\b[^>]*>/, '')
    .replace(/<\/w:p>$/, '')
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '');
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

/**
 * Word's own constant run-splitting (a spell-check boundary, an editing
 * session's own history) hands this ingester several adjacent `<w:r>`
 * elements with identical formatting for what was one logical span of text —
 * without this, a document reading `**bold**` in Word round-trips through
 * `renderMarkdown` as `**bo****ld**`. Adjacent nodes of the same shape are
 * folded back together, recursively, so a merge can expose a further merge
 * one level down (two adjacent `strong` nodes whose own children end in and
 * begin with plain text on each side).
 */
function mergeAdjacentInlines(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev?.t === 'text' && n.t === 'text') {
      out[out.length - 1] = { t: 'text', v: prev.v + n.v };
    } else if (prev?.t === 'strong' && n.t === 'strong') {
      out[out.length - 1] = { t: 'strong', children: mergeAdjacentInlines([...prev.children, ...n.children]) };
    } else if (prev?.t === 'em' && n.t === 'em') {
      out[out.length - 1] = { t: 'em', children: mergeAdjacentInlines([...prev.children, ...n.children]) };
    } else if (prev?.t === 'code' && n.t === 'code') {
      out[out.length - 1] = { t: 'code', children: mergeAdjacentInlines([...prev.children, ...n.children]) };
    } else {
      out.push(n);
    }
  }
  return out;
}

type Atom = { kind: 'text'; v: string } | { kind: 'pagebreak' } | { kind: 'drawing'; xml: string };

/**
 * A single `<w:r>…</w:r>` → its formatting plus the ordered sequence of
 * things it contains: text, a page break, a picture. A run is not
 * necessarily *only* one of those — `before<page break>after` is valid
 * inside one run, and so is text beside a `<w:drawing>` — so this returns
 * every atom in source order instead of testing the run as a whole and
 * returning early, which used to make a page-break or image run discard
 * whatever text sat next to the break/picture inside the same run.
 *
 * Reports anything left over after the recognised text-bearing elements
 * (and the run's own `<w:r>…</w:r>` wrapper and `<w:rPr>`) are stripped out
 * — a comment reference, a footnote reference, a field character. This is
 * *not* where tracked-change insertions are reported: an `<w:ins>` wrapper
 * around an ordinary `<w:r>` is invisible to the run-matching regex (see the
 * file-header comment), so an inserted run reads as accepted content with no
 * trace here at all — that is a deliberate policy (Word's own default
 * display), made visible instead by `reportTrackedChanges` counting the
 * wrappers directly, once per paragraph. A deletion's own text lives in
 * `<w:delText>`, which *is* recognised below (consumed, contributing no
 * characters) precisely so it does not also fall through to the leftover
 * report as generic "content not read" — `reportTrackedChanges` already
 * names it as a deletion once per paragraph, and a second, unlabelled entry
 * for the same thing would be noise the round-1 fix was trying to remove.
 */
function runAtoms(runXml: string, sink: Sink): { fmt: Fmt; atoms: Atom[] } {
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0] ?? '';
  const fmt: Fmt = { bold: flagOn(rPr, 'b'), italics: flagOn(rPr, 'i') };
  if (/^<w:r\b[^>]*\/>$/.test(runXml)) return { fmt, atoms: [] };

  // The run's own wrapper tags always contain a `w:` element name
  // (`<w:r>`/`<w:r w:rsidR="…">` and `</w:r>`), which is exactly what the
  // leftover check below looks for — stripping only `<w:rPr>` and leaving
  // the wrapper in place made *every* ordinary run report itself as unread
  // content. The wrapper has to go before the leftover test has anything
  // meaningful to say.
  const inner = runXml
    .replace(/^<w:r\b[^>]*>/, '')
    .replace(/<\/w:r>$/, '')
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '');

  const atoms: Atom[] = [];
  let text = '';
  const flushText = () => {
    if (text !== '') atoms.push({ kind: 'text', v: text });
    text = '';
  };

  // The page-break alternative must be tried before the bare `<w:br/>` and
  // `<w:br …/>` ones so a `w:type="page"` break is classified as a break, not
  // read as a plain line break.
  const partRe =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\b[^>]*\bw:type="page"[^>]*\/>|<w:br\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:noBreakHyphen\/>|<w:softHyphen\/>|<w:lastRenderedPageBreak\/>|<w:delText\b[^>]*>[\s\S]*?<\/w:delText>|<w:delText\/>|<w:drawing>[\s\S]*?<\/w:drawing>/g;
  for (const m of inner.matchAll(partRe)) {
    const s = m[0];
    // `<w:tab/>` must be tested before the `<w:t` prefix check below: a
    // plain `s.startsWith('<w:t')` is a *string* prefix test, blind to the
    // regex's own `\b` word-boundary logic that told the two apart as
    // separate alternatives in the first place — "<w:tab/>" does start with
    // the four characters "<w:t", so with the checks the other way round
    // every tab fell into the `<w:t>` branch, read its (nonexistent) capture
    // group as `''`, and vanished with no trace: `a<w:tab/>b` ingested as
    // `"ab"`. The order here is load-bearing, not incidental — do not
    // reorder these two without re-reading this comment.
    if (s === '<w:tab/>') {
      // The IR has no tab; a renderer sets its own spacing, so a space is
      // the closest faithful substitute — better than silently joining the
      // two words the tab was separating.
      text += ' ';
    } else if (s.startsWith('<w:t')) text += decodeXmlEntities(m[1] ?? '');
    else if (s === '<w:cr/>') text += '\n';
    else if (s === '<w:noBreakHyphen/>') text += '\u2011';
    else if (s === '<w:softHyphen/>') { /* no visible character when the line doesn't break there */ }
    // Word's own record of where *it* last paginated the document for
    // screen/print layout — a caching hint for its repagination, meaningless
    // to any other renderer, and this project's renderers choose their own
    // pagination regardless (see paragraphSegments' pageBreaks option, which
    // governs the *real* `w:type="page"` break above, not this). Reporting
    // it in `dropped` is exactly the false positive that sent 5 of 86 real
    // documents through this ingester with a "content not read" entry that
    // read nothing: consumed silently, the same way `<w:softHyphen/>` above
    // already is.
    else if (s === '<w:lastRenderedPageBreak/>') { /* not content — see comment above */ }
    else if (s.startsWith('<w:delText')) { /* a tracked deletion's own text, deliberately not read \u2014 see this function's own doc comment; consumed here so it does not also surface as generic unread-content noise */ }
    else if (s.startsWith('<w:drawing')) { flushText(); atoms.push({ kind: 'drawing', xml: s }); }
    else if (/\bw:type="page"/.test(s)) { flushText(); atoms.push({ kind: 'pagebreak' }); }
    // A `<w:br/>` that isn't a page break (a column or text-wrapping break,
    // or the plain kind) is read as a line break — the same approximation
    // `<w:cr/>` gets.
    else text += '\n';
  }
  flushText();

  const leftover = inner.replace(partRe, '');
  if (/<w:\w/.test(leftover)) {
    sink.dropped.push(`run content this ingester does not read: ${truncate(leftover)}`);
  }

  return { fmt, atoms };
}

/**
 * Counts `<w:ins>`/`<w:del>` wrappers in a paragraph's runs region and names
 * what happened to them, once per paragraph. Policy: an insertion is read as
 * accepted (its `<w:r>` matches the ordinary run pattern in `runAtoms`
 * regardless of the `<w:ins>` wrapper around it, which the regex-based scan
 * cannot see) — the same thing Word itself shows by default. A deletion is
 * read as rejected: its text lives in `<w:delText>`, which nothing here
 * recognises, so it contributes nothing to the body. Both are defensible
 * choices, but silent is not — in a document under review, an unaccepted
 * redline reading as final without comment is a real defect, so this names
 * exactly what happened rather than leaving it to be inferred from a generic
 * leftover-content note (which is what a deletion falls through to anyway,
 * unlabelled as a deletion, unless this also runs).
 */
function reportTrackedChanges(runsXml: string, sink: Sink): void {
  const insertions = (runsXml.match(/<w:ins\b/g) ?? []).length;
  const deletions = (runsXml.match(/<w:del\b/g) ?? []).length;
  if (insertions === 0 && deletions === 0) return;
  const parts: string[] = [];
  if (insertions > 0) parts.push(`${insertions} tracked insertion${insertions === 1 ? '' : 's'} (kept, read as accepted)`);
  if (deletions > 0) parts.push(`${deletions} tracked deletion${deletions === 1 ? '' : 's'} (dropped, read as rejected)`);
  sink.dropped.push(`paragraph contains ${parts.join(' and ')}`);
}

/** Reads an XML attribute's value from a tag's attribute substring, tolerant
 *  of either quote style — `w:instr="…"` or `w:instr='…'` — because a field
 *  instruction routinely contains a double-quoted URL (`HYPERLINK "url"`),
 *  which forces Word to write the *attribute itself* single-quoted so the
 *  URL's own quotes don't need escaping. A single-quote-only reader (every
 *  other attribute read in this file uses a literal `"([^"]*)"`) would miss
 *  exactly the shape this function exists to read. */
function attrValue(attrsXml: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`).exec(attrsXml);
  if (!m) return undefined;
  return m[1] !== undefined ? m[1] : m[2];
}

/**
 * A field instruction is free-text, not markup — `HYPERLINK "url" \l "frag"
 * \o "tooltip"` — so the URL is whatever sits inside the first double-quoted
 * span after the `HYPERLINK` keyword, and everything after it (a bookmark
 * switch `\l`, a tooltip switch `\o "…"`, both optional and in either order)
 * must not leak into the href. Capturing only that first quoted span, rather
 * than "everything up to the closing tag", is what keeps a switch out of the
 * link target without needing to enumerate every switch OOXML defines.
 */
function parseHyperlinkInstr(instr: string): { href: string } | null {
  const m = /\bHYPERLINK\s+"([^"]*)"/i.exec(instr);
  return m ? { href: m[1] ?? '' } : null;
}

/**
 * Splits the XML span of a complex field (`fldChar begin` … `fldChar
 * separate` … `fldChar end`, each in its own `<w:r>`, per OOXML's field
 * grammar) into the instruction text and the display-text region. The
 * instruction can itself be split across several adjacent `<w:instrText>`
 * runs — Word does this the same way it splits ordinary text runs (see this
 * file's header comment on run-splitting) — so every occurrence is
 * concatenated, not just the first. When `separate`/`end` cannot be found
 * (a malformed or truncated field), the display region comes back empty
 * rather than guessing at a boundary.
 */
function splitComplexField(spanXml: string): { instr: string; displayXml: string } {
  let instr = '';
  for (const m of spanXml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:instrText\/>/g)) {
    instr += decodeXmlEntities(m[1] ?? '');
  }
  const sepIdx = spanXml.search(/<w:fldChar\b[^>]*\bw:fldCharType="separate"/);
  const endIdx = spanXml.search(/<w:fldChar\b[^>]*\bw:fldCharType="end"/);
  const displayXml = sepIdx !== -1 && endIdx !== -1 && endIdx > sepIdx ? spanXml.slice(sepIdx, endIdx) : '';
  return { instr, displayXml };
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
  reportTrackedChanges(runs, sink);

  const segments: Segment[] = [];
  let current: Inline[] = [];
  const flush = () => {
    if (current.length > 0) segments.push({ kind: 'text', inlines: mergeAdjacentInlines(current) });
    current = [];
  };

  // `<w:bookmarkStart>`/`<w:bookmarkEnd>` and `<w:proofErr>` are siblings of
  // `<w:r>` inside `<w:p>` (OOXML's EG_PContent group), never nested inside
  // a run — so they were already invisible to `runAtoms`'s leftover check,
  // which only ever sees the inside of one `<w:r>`. Left out of `unitRe`
  // entirely they would still vanish with no dropped entry, but only as an
  // accident of the regex not matching them, the same kind of incidental
  // silence this file's own header warns against elsewhere. Matched here
  // explicitly instead, so the choice is visible and deliberate:
  //   - `<w:proofErr>` is Word's own spell/grammar-check flag on the run(s)
  //     beside it, not a value of their text — proofing state, not content.
  //   - `<w:bookmarkStart>`/`<w:bookmarkEnd>` mark a named point a
  //     cross-reference elsewhere in the document could target. That makes a
  //     bookmark content-*adjacent* (unlike a proofing mark, it names
  //     something a reader could jump to) — but this IR has no
  //     cross-reference/anchor block shape to carry it to, and the bookmark
  //     itself has no visible text of its own to lose. Silencing it drops a
  //     structural feature the ingester cannot represent either way, not a
  //     word of body text, so it belongs with the other silent atoms rather
  //     than in `dropped` (which the design reserves for content, per the
  //     corpus's own review round 1).
  // Named groups, not positional `m[1]`/`m[2]`: three of these alternatives
  // now carry their own captures (hyperlink, fldSimple, the complex-field
  // span), and indexing them by position would silently shift the moment a
  // fourth was added — a name says what it is at the call site instead of
  // relying on alternation order staying memorised.
  //
  // `<w:fldSimple>` and the `fldChar begin`/`instrText`/`separate`/`fldChar
  // end` span both get a case here for the same reason `<w:hyperlink>` does:
  // Word wrote a link this way for every version before 2007, and still does
  // for mail-merge and cross-reference fields, so a `HYPERLINK` field is
  // ordinary Word output, not a corruption — see this function's own comment
  // below on why both forms are handled identically instead of one being
  // carried and the other merely reported.
  const unitRe =
    /<w:bookmarkStart\b[^>]*\/>|<w:bookmarkEnd\b[^>]*\/>|<w:proofErr\b[^>]*\/>|<w:hyperlink\b(?<hlAttrs>[^>]*)>(?<hlInner>[\s\S]*?)<\/w:hyperlink>|<w:fldSimple\b(?<fsAttrs>[^>]*)>(?<fsInner>[\s\S]*?)<\/w:fldSimple>|(?<cfSpan><w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:fldChar\b[^>]*\bw:fldCharType="begin"[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>[\s\S]*?<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:fldChar\b[^>]*\bw:fldCharType="end"[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>)|<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  for (const m of runs.matchAll(unitRe)) {
    if (m[0].startsWith('<w:bookmarkStart') || m[0].startsWith('<w:bookmarkEnd') || m[0].startsWith('<w:proofErr')) continue;

    if (m.groups?.hlAttrs !== undefined) {
      // A hyperlink. Its target is the relationship its `r:id` names — never
      // the visible text, which is what makes phishing via a mismatched link
      // text/href possible in the first place — so the href is looked up,
      // not read off the run.
      const rId = /\br:id="([^"]*)"/.exec(m.groups.hlAttrs)?.[1];
      const inner = m.groups.hlInner ?? '';
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

    if (m.groups?.fsAttrs !== undefined) {
      // `<w:fldSimple w:instr='HYPERLINK "url"'>text</w:fldSimple>` — the
      // pre-2007 (and still current, for mail-merge/cross-reference fields)
      // way Word writes a link: target and display text both live on this
      // one element, target in the `w:instr` attribute rather than any
      // nested run, so it is built into the same `link` node `<w:hyperlink>`
      // becomes above, not a second inline shape.
      const instrRaw = attrValue(m.groups.fsAttrs, 'w:instr');
      const instr = instrRaw !== undefined ? decodeXmlEntities(instrRaw) : undefined;
      const children = innerRunsToInlines(m.groups.fsInner ?? '', sink, opts.context);
      const link = instr !== undefined ? parseHyperlinkInstr(instr) : null;
      if (link) {
        current.push({ t: 'link', href: link.href, children });
      } else {
        // Not every field is a HYPERLINK (PAGE, REF, SEQ, DATE, …); this
        // ingester only knows how to carry the one kind, so any other kind
        // is named and its already-computed field *result* text is kept —
        // the same "keep the text, name what was lost" shape the
        // no-resolvable-relationship hyperlink case above uses.
        sink.dropped.push(`field code this ingester does not carry (kept its text): ${truncate(instr ?? '(no w:instr)')}`);
        current.push(...children);
      }
      continue;
    }

    if (m.groups?.cfSpan !== undefined) {
      // The same HYPERLINK field, written the "complex" way: `fldChar
      // begin`/`instrText`/`fldChar separate`/`fldChar end` spread across
      // several sibling runs instead of one `<w:fldSimple>` element. Before
      // this case existed, `fldSimple` was silent (fell through with no
      // dropped entry — the very defect this change closes) while this form
      // was noisy *four times over* (`runAtoms`'s leftover check firing once
      // per run: the begin run, the instrText run, the separate run, the end
      // run) and *still* lost the href — the same link, invisible in one
      // spelling and shouting in the other. Handling both the same way here
      // — carry a HYPERLINK, name and keep the text of anything else, exactly
      // once — is the fix for the incoherence, not just the noise: a second
      // link node, an unrepresentable field, or the leftover-content flood
      // would each have been defensible in isolation, but only "handle both
      // forms identically" leaves nothing for a reader to reconcile.
      const { instr, displayXml } = splitComplexField(m.groups.cfSpan);
      const link = parseHyperlinkInstr(instr);
      const children = innerRunsToInlines(displayXml, sink, opts.context);
      if (link) {
        current.push({ t: 'link', href: link.href, children });
      } else {
        sink.dropped.push(`complex field code this ingester does not carry (kept its text): ${truncate(instr)}`);
        current.push(...children);
      }
      continue;
    }

    const { fmt, atoms } = runAtoms(m[0], sink);
    for (const atom of atoms) {
      if (atom.kind === 'text') {
        current.push(...wrapFmt([{ t: 'text', v: atom.v }], fmt));
        continue;
      }
      if (atom.kind === 'pagebreak') {
        if (!opts.pageBreaks) {
          sink.dropped.push(`page break inside a ${opts.context} has no representation`);
          continue;
        }
        flush();
        segments.push({ kind: 'pagebreak' });
        continue;
      }
      // atom.kind === 'drawing'
      if (!opts.images) {
        sink.dropped.push(`image inside a ${opts.context} has no representation`);
        continue;
      }
      const drawingXml = atom.xml;
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
    }
  }
  flush();

  // The paragraph-level mirror of `runAtoms`'s own leftover check: everything
  // `unitRe` recognised has now been consumed above, so whatever text is left
  // in `runs` once that pattern is stripped out is a *paragraph*-level
  // element this ingester has no case for — an unrecognised field type, a
  // `<w:smartTag>` or `<w:customXml>` wrapper, anything future Word output
  // adds. Before this check existed, that leftover simply vanished: the run
  // regex inside `unitRe`/`runAtoms` still matches a nested `<w:r>` wherever
  // it sits in the string, ancestor tags or not (see this file's header
  // comment), so the *text* survived by accident while the *wrapper's own
  // meaning* — an attribute holding a target, a semantic tag on the content —
  // was discarded with nothing in `dropped` to say so. This is what turns
  // that unbounded, silent class of loss into a bounded, loud one: it cannot
  // name what a wrapper meant (it doesn't know the shape), but it can and
  // does say something was there and was not read.
  //
  // `<w:ins>`/`<w:del>` are the one paragraph-level wrapper already named
  // deliberately, not by omission (see `reportTrackedChanges` and the file
  // header comment on why the regex can't see them around an ordinary run
  // either way) — stripped here before the generic check runs so a tracked
  // change is not reported twice under two different, differently-worded
  // messages for the same thing.
  const leftover = runs.replace(unitRe, '').replace(/<\/?w:ins\b[^>]*>|<\/?w:del\b[^>]*>/g, '');
  if (/<w:\w/.test(leftover)) {
    sink.dropped.push(`paragraph content this ingester does not read: ${truncate(leftover)}`);
  }

  return segments;
}

/** Runs inside a hyperlink: text and formatting only. An image or a page
 *  break embedded inside a link has nowhere to go in the IR's link (its
 *  children are `Inline[]`, the same text-only shape a heading or list item
 *  has), so both are reported rather than silently dropped — the rest of the
 *  same run's text is still kept, for the same reason `paragraphSegments`
 *  keeps it: one unrepresentable atom must not take its siblings with it. */
function innerRunsToInlines(xml: string, sink: Sink, context: string): Inline[] {
  const out: Inline[] = [];
  for (const m of xml.matchAll(/<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
    const { fmt, atoms } = runAtoms(m[0], sink);
    for (const atom of atoms) {
      if (atom.kind === 'text') out.push(...wrapFmt([{ t: 'text', v: atom.v }], fmt));
      else if (atom.kind === 'pagebreak') sink.dropped.push(`page break inside a hyperlink in a ${context} has no representation`);
      else sink.dropped.push(`image inside a hyperlink in a ${context} has no representation`);
    }
  }
  return mergeAdjacentInlines(out);
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

export function sniffRaster(bytes: Buffer): string | null {
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
  opts: { title?: string; subtitle?: string; date?: string; entity?: string } = {},
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
      const text = mergeAdjacentInlines(segs.flatMap((s) => (s.kind === 'text' ? s.inlines : [])));
      sink.blocks.push({ t: 'heading', level: heading.level, text });
      continue;
    }

    if (numPr) {
      const resolved = resolveLevel(numbering, numPr.numId, numPr.ilvl);
      const segs = paragraphSegments(unit.xml, rels, media, sink, { images: false, pageBreaks: false, context: 'list item' });
      const text = mergeAdjacentInlines(segs.flatMap((s) => (s.kind === 'text' ? s.inlines : [])));
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
      // A shallower item restarts every deeper level's own counter — see
      // `resetDeeperCounters`'s comment — so this has to run before this
      // item's own counter is read, even though it is `depth`, not a deeper
      // level, that is being read next.
      resetDeeperCounters(numbering, counters, numPr.numId, depth);
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
  // opts.subtitle (the sidecar/caller value) wins over the body's own
  // DocSubtitle, same precedence opts.title already has over the body's
  // DocTitle above — a caller-supplied subtitle is a more deliberate
  // decision than whatever paragraph happened to carry the style.
  const finalSubtitle = opts.subtitle ?? subtitle;

  return {
    doc: {
      meta: {
        title: finalTitle && finalTitle !== '' ? finalTitle : 'Untitled',
        lang: 'en',
        ...(finalSubtitle !== undefined && finalSubtitle !== '' ? { subtitle: finalSubtitle } : {}),
        ...(date !== undefined ? { date } : {}),
        ...(opts.entity !== undefined ? { entity: opts.entity } : {}),
      },
      blocks: sink.blocks,
    },
    dropped: sink.dropped,
  };
}
