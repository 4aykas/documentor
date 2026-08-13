// IR → Markdown. Also the cheapest way to see what an ingester understood:
// `--to md` is "show me the IR in a form a human reads".

import type { Block, Doc, Inline } from '../ir/types.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { stepOf, weekLabel } from './tint.js';

/**
 * A refused link, written the way the HTML renderer writes it: the link's own
 * text, then where it pointed. Markdown has no muted style to set the target
 * apart, so parentheses do that work.
 *
 * Markdown output is inert until something else renders it — which is the whole
 * reason this is easy to forget, and the whole reason it matters. A `--to md`
 * file is an input to some other tool as often as it is a thing a human reads,
 * and the second renderer must not hand on a `javascript:` URL that the first
 * one refused.
 */
function refusedLinkText(href: string, text: string): string {
  return `${text} (${refusedLinkTarget(href)})`;
}

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text': return n.v;
        case 'strong': return `**${inline(n.children)}**`;
        case 'em': return `*${inline(n.children)}*`;
        case 'code': return `\`${inline(n.children)}\``;
        case 'link':
          return schemeIsRefused(n.href)
            ? refusedLinkText(n.href, inline(n.children))
            : `[${inline(n.children)}](${n.href})`;
      }
    })
    .join('');
}

/** A cell may not contain a bare pipe or a newline, or the row stops being a row. */
function cell(nodes: Inline[]): string {
  return inline(nodes).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fence(text: string): string {
  // A fence must be longer than the longest run of backticks it contains.
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function block(b: Block): string {
  switch (b.t) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${inline(b.text)}`;
    case 'para':
      return inline(b.text);
    case 'list': {
      const pad = '  '.repeat(b.depth);
      const start = b.start ?? 1;
      return b.items
        .map((it, i) => `${pad}${b.ordered ? `${start + i}.` : '-'} ${inline(it)}`)
        .join('\n');
    }
    case 'table': {
      const sep = b.align.map((a) => (a === 'l' ? ':--' : a === 'r' ? '--:' : ':-:'));
      const row = (cells: Inline[][]) => `| ${cells.map(cell).join(' | ')} |`;
      return [row(b.head), `| ${sep.join(' | ')} |`, ...b.rows.map(row)].join('\n');
    }
    case 'heatmap': {
      const weeks = b.rows[0]?.values.length ?? 0;
      const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
      // Markdown is the readable intermediate, so scale — tint-only on paper —
      // shows its hours here rather than an empty grid.
      const cellFor = (v: number): string =>
        b.style === 'marks' ? '▪'.repeat(stepOf(v, max, 3))
        : b.style === 'fill' ? (v > 0 ? '■' : '')
        : v > 0 ? String(v) : '';
      const head = ['', ...Array.from({ length: weeks }, (_, i) => weekLabel(i))];
      const sep = [':--', ...Array.from({ length: weeks }, () => ':-:')];
      const lines = [
        `| ${head.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...b.rows.map((r) => `| ${[cell([{ t: 'text', v: r.label }]), ...r.values.map(cellFor)].join(' | ')} |`),
      ];
      return lines.join('\n');
    }
    case 'image':
      return `![${b.alt}](${b.src})`;
    case 'code': {
      const f = fence(b.text);
      return `${f}${b.lang ?? ''}\n${b.text}\n${f}`;
    }
    case 'quote':
      return b.paras.map((p) => `> ${inline(p)}`).join('\n>\n');
    case 'rule':
      return '---';
    case 'pagebreak':
      // No Markdown syntax for this. The comment does NOT survive a round trip
      // through the ingester: `ingestMarkdown` treats any block-level HTML
      // (including a comment) as `block html: ...` and pushes it to `dropped`
      // rather than reconstructing a `pagebreak` block. So a document
      // containing a pagebreak is not idempotent through ingest→render; this
      // is the best Markdown can do and is called out in the task report.
      return '<!-- pagebreak -->';
  }
}

export function renderMarkdown(doc: Doc): string {
  // Each part is paired with the block that produced it (null for the title and
  // subtitle, which come from meta), so the separator rule below can ask about
  // the real neighbours instead of guessing from an index offset.
  const parts: { text: string; block: Block | null }[] = [
    { text: `# ${doc.meta.title}`, block: null },
  ];
  // This round-trips as text but not as meaning: rendering `*subtitle*` and
  // re-ingesting it produces the same string, but ingestMarkdown has no concept
  // of a subtitle, so what comes back is an ordinary `para` block holding an
  // `em` inline — `doc.meta.subtitle` itself is gone. Same class of lossy
  // round trip as `pagebreak` below; this one is easier to miss because the
  // text survives even though the type does not.
  if (doc.meta.subtitle) parts.push({ text: `*${doc.meta.subtitle}*`, block: null });
  for (const b of doc.blocks) parts.push({ text: block(b), block: b });

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += parts[i]!.text;
    const next = parts[i + 1];
    if (!next) break;
    // Consecutive list blocks are one list to a reader — a blank line between
    // them would end the list and restart the numbering.
    const bothLists = parts[i]!.block?.t === 'list' && next.block?.t === 'list';
    out += bothLists ? '\n' : '\n\n';
  }
  return `${out}\n`;
}
