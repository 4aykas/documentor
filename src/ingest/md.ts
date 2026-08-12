// Markdown → IR. `marked`'s lexer gives an almost-flat token stream, which is
// why it is the cheapest of the four ingesters and therefore the one the whole
// architecture is proven on first.

import { marked, type Token, type Tokens } from 'marked';
import type { Align, Block, Ingested, Inline } from '../ir/types.js';

type Sink = { blocks: Block[]; dropped: string[] };

// `images`, when supplied, collects any image tokens found instead of
// dropping them, letting the caller decide what an image means in its
// context (a paragraph turns it into a sibling block; anywhere else in the
// IR an inline image cannot be represented at all). Passing it as an
// out-array rather than pushing blocks as a side effect keeps `inlinesOf`
// order-neutral: the caller controls exactly when and whether the images it
// collected become blocks, instead of an image jumping ahead of the block
// that is still being built.
function inlinesOf(tokens: Token[] | undefined, sink: Sink, images?: Tokens.Image[]): Inline[] {
  const out: Inline[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text':
      case 'escape': {
        const t = tok as Tokens.Text;
        // marked nests tokens under a text token when the text contains markup.
        if (t.tokens?.length) out.push(...inlinesOf(t.tokens, sink, images));
        else out.push({ t: 'text', v: t.text });
        break;
      }
      case 'strong':
        out.push({ t: 'strong', children: inlinesOf((tok as Tokens.Strong).tokens, sink, images) });
        break;
      case 'em':
        out.push({ t: 'em', children: inlinesOf((tok as Tokens.Em).tokens, sink, images) });
        break;
      case 'codespan':
        out.push({ t: 'code', children: [{ t: 'text', v: (tok as Tokens.Codespan).text }] });
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        out.push({ t: 'link', href: l.href, children: inlinesOf(l.tokens, sink, images) });
        break;
      }
      case 'br':
        out.push({ t: 'text', v: '\n' });
        break;
      case 'del':
        // The IR has no strikethrough. Keep the words, say the styling went.
        sink.dropped.push('strikethrough styling (the text was kept)');
        out.push(...inlinesOf((tok as Tokens.Del).tokens, sink, images));
        break;
      case 'html':
        sink.dropped.push(`inline html: ${truncate((tok as Tokens.HTML).text)}`);
        break;
      case 'image': {
        const im = tok as Tokens.Image;
        if (images) {
          images.push(im);
        } else {
          // The IR has no inline image type, and this position (heading, list
          // item, table cell, quote) has no block-level fallback either, so
          // there is nowhere faithful to put it.
          sink.dropped.push(`image here has no representation: alt="${truncate(im.text)}" src=${truncate(im.href)}`);
        }
        break;
      }
      default:
        if (!carriesNothing(tok)) sink.dropped.push(`inline ${tok.type}: ${rawOf(tok)}`);
    }
  }
  return out;
}

function truncate(s: string, n = 40): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/**
 * The source text a token came from, ready to put in a `dropped` message.
 *
 * `raw` is optional on marked's `Token` union, so every call site has to test
 * for it; four of them did, with three different fallbacks — including an empty
 * string, which produced entries that trailed off after a colon. One fallback,
 * the token's own type name, so a message is never a dead end.
 */
function rawOf(tok: Token): string {
  const raw = 'raw' in tok && typeof tok.raw === 'string' ? tok.raw : '';
  return raw.trim() === '' ? tok.type : truncate(raw);
}

/**
 * True for a token that carries no source text worth reporting — marked's
 * blank-line noise. Nothing was lost, so nothing should be announced as lost.
 */
function carriesNothing(tok: Token): boolean {
  return !('raw' in tok) || typeof tok.raw !== 'string' || tok.raw.trim() === '';
}

const ALIGN_OF: Record<string, Align> = { left: 'l', right: 'r', center: 'c' };

// A list item can hold more than inline text: a nested list, or (in a
// "loose" list) a whole code block or blockquote. The IR's list item is
// text-only, so anything but a nested list is lifted out to become a
// sibling block, and a nested list is lifted out to become sibling `list`
// blocks at depth + 1. Either way membership in the item is lost, which is
// why "other" content records a `dropped` entry naming what moved.
type Deferred = { kind: 'list'; list: Tokens.List; depth: number } | { kind: 'other'; token: Token; depth: number };

function pushList(tok: Tokens.List, depth: number, sink: Sink, start = 1): void {
  // A nested list becomes a sibling block carrying a greater depth, because the
  // IR is flat. The renderers indent from `depth`.
  //
  // Content that sits between two list items in the source (a nested list, or
  // "other" loose-item content) must become sibling blocks *at that point*,
  // not after the whole parent list: emitting it at the end would silently
  // reorder the document, printing item N+1 before content that came before
  // it in the source. So the parent list is split into fragments around each
  // such interruption, and `groupStart` tracks the item number the current
  // fragment's first item carries, so ordered numbering keeps counting
  // through a split instead of restarting at 1 in every fragment.
  const ordered = Boolean(tok.ordered);
  let items: Inline[][] = [];
  let groupStart = start;
  let itemNumber = start;

  const flush = () => {
    if (items.length === 0) return;
    // Omit `start` when it is the implicit default (1) rather than writing it on
    // every ordinary list — it only needs to be visible where numbering doesn't
    // start at 1, i.e. a source list starting `3. item`, or a fragment resuming
    // after a split.
    sink.blocks.push(
      ordered && groupStart !== 1
        ? { t: 'list', ordered, depth, items, start: groupStart }
        : { t: 'list', ordered, depth, items },
    );
    items = [];
  };

  for (const item of tok.items) {
    const own: Token[] = [];
    const deferred: Deferred[] = [];
    for (const child of item.tokens) {
      // `space` tokens are just the blank line between a "loose" item's
      // paragraph and its next block; marked emits them as formatting noise,
      // not content, so they are skipped the same way blockOf skips them.
      if (child.type === 'space') continue;
      if (child.type === 'list') deferred.push({ kind: 'list', list: child as Tokens.List, depth: depth + 1 });
      else if (child.type === 'text' || child.type === 'paragraph') own.push(child);
      else deferred.push({ kind: 'other', token: child, depth: depth + 1 });
    }
    if (items.length === 0) groupStart = itemNumber;
    items.push(inlinesOf(own, sink));
    itemNumber++;

    if (deferred.length > 0) {
      flush();
      for (const d of deferred) {
        if (d.kind === 'list') {
          // Honour the source's own `3. item` numbering on a nested ordered
          // list, same as the top-level call in blockOf does.
          const childStart = typeof d.list.start === 'number' ? d.list.start : 1;
          pushList(d.list, d.depth, sink, childStart);
        } else {
          sink.dropped.push(`list item membership: a ${d.token.type} moved out of its list item and became a sibling block: ${rawOf(d.token)}`);
          blockOf(d.token, sink);
        }
      }
    }
  }
  flush();
}

function blockOf(tok: Token, sink: Sink): void {
  switch (tok.type) {
    case 'space':
      return;
    case 'heading': {
      const h = tok as Tokens.Heading;
      const level = (h.depth > 3 ? 3 : h.depth) as 1 | 2 | 3;
      if (h.depth > 3) {
        sink.dropped.push(`h${h.depth} clamped to h3: ${truncate(h.text)}`);
      }
      sink.blocks.push({ t: 'heading', level, text: inlinesOf(h.tokens, sink) });
      return;
    }
    case 'paragraph': {
      const p = tok as Tokens.Paragraph;
      // Images are collected rather than emitted inline (see inlinesOf), so
      // the paragraph's own text and the images it contained can be ordered
      // deliberately: the paragraph first (if it has real text), then the
      // images that were embedded in it, in source order.
      const images: Tokens.Image[] = [];
      const text = inlinesOf(p.tokens, sink, images);
      const hasText = text.some((n) => n.t !== 'text' || n.v.trim() !== '');
      if (hasText) sink.blocks.push({ t: 'para', text });
      for (const im of images) sink.blocks.push({ t: 'image', src: im.href, alt: im.text });
      return;
    }
    case 'list': {
      const t = tok as Tokens.List;
      pushList(t, 0, sink, typeof t.start === 'number' ? t.start : 1);
      return;
    }
    case 'table': {
      const t = tok as Tokens.Table;
      sink.blocks.push({
        t: 'table',
        head: t.header.map((c) => inlinesOf(c.tokens, sink)),
        rows: t.rows.map((row) => row.map((c) => inlinesOf(c.tokens, sink))),
        align: t.align.map((a) => (a ? ALIGN_OF[a] ?? 'l' : 'l')),
      });
      return;
    }
    case 'code': {
      const c = tok as Tokens.Code;
      sink.blocks.push(c.lang ? { t: 'code', lang: c.lang, text: c.text } : { t: 'code', text: c.text });
      return;
    }
    case 'blockquote': {
      const q = tok as Tokens.Blockquote;
      const paras: Inline[][] = [];
      for (const child of q.tokens) {
        if (child.type === 'paragraph') paras.push(inlinesOf((child as Tokens.Paragraph).tokens, sink));
        else if (child.type !== 'space') sink.dropped.push(`inside a quote: ${child.type}: ${rawOf(child)}`);
      }
      sink.blocks.push({ t: 'quote', paras });
      return;
    }
    case 'hr':
      sink.blocks.push({ t: 'rule' });
      return;
    case 'html':
      sink.dropped.push(`block html: ${truncate((tok as Tokens.HTML).text)}`);
      return;
    default:
      if (!carriesNothing(tok)) sink.dropped.push(`${tok.type}: ${rawOf(tok)}`);
  }
}

function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plain(n.children))).join('');
}

export function ingestMarkdown(source: string, opts: { title?: string; date?: string; entity?: string } = {}): Ingested {
  const sink: Sink = { blocks: [], dropped: [] };
  for (const tok of marked.lexer(source)) blockOf(tok, sink);

  let title = opts.title;
  if (title === undefined) {
    const i = sink.blocks.findIndex((b) => b.t === 'heading' && b.level === 1);
    if (i !== -1) {
      const h = sink.blocks[i] as Extract<Block, { t: 'heading' }>;
      title = plain(h.text);
      // The theme's header prints the title, so leaving it in the body would
      // set it twice.
      sink.blocks.splice(i, 1);
    }
  }

  // date/entity have no source in the Markdown itself (unlike title, which
  // can fall back to an h1) — a document only carries them when the caller
  // supplies them, so under exactOptionalPropertyTypes they are spread in
  // rather than assigned, keeping an absent flag indistinguishable from a
  // document rendered before these options existed.
  return {
    doc: {
      meta: {
        title: title ?? 'Untitled',
        lang: 'en',
        ...(opts.date === undefined ? {} : { date: opts.date }),
        ...(opts.entity === undefined ? {} : { entity: opts.entity }),
      },
      blocks: sink.blocks,
    },
    dropped: sink.dropped,
  };
}
