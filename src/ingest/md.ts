// Markdown → IR. `marked`'s lexer gives an almost-flat token stream, which is
// why it is the cheapest of the four ingesters and therefore the one the whole
// architecture is proven on first.

import { marked, type Token, type Tokens } from 'marked';
import type { Align, Block, Ingested, Inline } from '../ir/types.js';

type Sink = { blocks: Block[]; dropped: string[] };

function inlinesOf(tokens: Token[] | undefined, sink: Sink): Inline[] {
  const out: Inline[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text':
      case 'escape': {
        const t = tok as Tokens.Text;
        // marked nests tokens under a text token when the text contains markup.
        if (t.tokens?.length) out.push(...inlinesOf(t.tokens, sink));
        else out.push({ t: 'text', v: t.text });
        break;
      }
      case 'strong':
        out.push({ t: 'strong', children: inlinesOf((tok as Tokens.Strong).tokens, sink) });
        break;
      case 'em':
        out.push({ t: 'em', children: inlinesOf((tok as Tokens.Em).tokens, sink) });
        break;
      case 'codespan':
        out.push({ t: 'code', children: [{ t: 'text', v: (tok as Tokens.Codespan).text }] });
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        out.push({ t: 'link', href: l.href, children: inlinesOf(l.tokens, sink) });
        break;
      }
      case 'br':
        out.push({ t: 'text', v: '\n' });
        break;
      case 'del':
        // The IR has no strikethrough. Keep the words, say the styling went.
        sink.dropped.push('strikethrough styling (the text was kept)');
        out.push(...inlinesOf((tok as Tokens.Del).tokens, sink));
        break;
      case 'html':
        sink.dropped.push(`inline html: ${truncate((tok as Tokens.HTML).text)}`);
        break;
      case 'image': {
        // An image inside a paragraph becomes its own block; see blockOf.
        const im = tok as Tokens.Image;
        sink.blocks.push({ t: 'image', src: im.href, alt: im.text });
        break;
      }
      default:
        if ('raw' in tok && typeof tok.raw === 'string' && tok.raw.trim() !== '') {
          sink.dropped.push(`inline ${tok.type}: ${truncate(tok.raw)}`);
        }
    }
  }
  return out;
}

function truncate(s: string, n = 40): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

const ALIGN_OF: Record<string, Align> = { left: 'l', right: 'r', center: 'c' };

function pushList(tok: Tokens.List, depth: number, sink: Sink): void {
  // A nested list becomes a sibling block carrying a greater depth, because the
  // IR is flat. The renderers indent from `depth`.
  const items: Inline[][] = [];
  const deferred: { list: Tokens.List; depth: number }[] = [];
  for (const item of tok.items) {
    const own: Token[] = [];
    for (const child of item.tokens) {
      if (child.type === 'list') deferred.push({ list: child as Tokens.List, depth: depth + 1 });
      else if (child.type === 'text' || child.type === 'paragraph') own.push(child);
      else deferred.push({ list: child as unknown as Tokens.List, depth: depth + 1 });
    }
    items.push(inlinesOf(own, sink));
  }
  sink.blocks.push({ t: 'list', ordered: Boolean(tok.ordered), depth, items });
  for (const d of deferred) {
    if ((d.list as Token).type === 'list') pushList(d.list, d.depth, sink);
    else blockOf(d.list as unknown as Token, sink);
  }
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
      const before = sink.blocks.length;
      const text = inlinesOf(p.tokens, sink);
      // inlinesOf may have pushed image blocks; a paragraph that was only an
      // image must not also emit an empty paragraph.
      const onlyImages = text.every((n) => n.t === 'text' && n.v.trim() === '');
      if (sink.blocks.length > before && onlyImages) return;
      if (text.length) sink.blocks.push({ t: 'para', text });
      return;
    }
    case 'list':
      pushList(tok as Tokens.List, 0, sink);
      return;
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
        else if (child.type !== 'space') sink.dropped.push(`inside a quote: ${child.type}`);
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
      if ('raw' in tok && typeof tok.raw === 'string' && tok.raw.trim() !== '') {
        sink.dropped.push(`${tok.type}: ${truncate(tok.raw)}`);
      }
  }
}

function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plain(n.children))).join('');
}

export function ingestMarkdown(source: string, opts: { title?: string } = {}): Ingested {
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

  return {
    doc: { meta: { title: title ?? 'Untitled', lang: 'en' }, blocks: sink.blocks },
    dropped: sink.dropped,
  };
}
