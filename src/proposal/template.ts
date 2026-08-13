// The template language. Three constructions — a field, a presence/absence
// block, a directive — and nothing else: no loops, no expressions, no
// helpers. Anything needing logic lives in the assembler under tests, not in
// a template where nothing checks it.

import { ProposalError, type ProposalData } from './types.js';

export type TplNode =
  | { t: 'text'; text: string }
  | { t: 'field'; path: string }
  | { t: 'presence'; positive: boolean; path: string; children: TplNode[] }
  | { t: 'directive'; name: string; args: Record<string, string> };

export type FlatItem =
  | { t: 'md'; text: string }
  | { t: 'directive'; name: string; args: Record<string, string> };

const TOKEN = /\{\{(.*?)\}\}/g;
const FIELD = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*$/;

export function parseTemplate(src: string): TplNode[] {
  const errors: string[] = [];
  // Stack of open presence blocks; the root list is the bottom entry.
  const root: TplNode[] = [];
  const stack: { node?: Extract<TplNode, { t: 'presence' }>; list: TplNode[]; opener: string }[] = [
    { list: root, opener: '' },
  ];
  const top = () => stack[stack.length - 1]!;

  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index! > last) top().list.push({ t: 'text', text: src.slice(last, m.index) });
    last = m.index! + m[0].length;
    const inner = (m[1] ?? '').trim();

    if (inner.startsWith('?') || inner.startsWith('^')) {
      const positive = inner.startsWith('?');
      const path = inner.slice(1).trim();
      if (!FIELD.test(path)) { errors.push(`cannot read ${JSON.stringify(m[0])} — a presence block opens with a field path`); continue; }
      const node: Extract<TplNode, { t: 'presence' }> = { t: 'presence', positive, path, children: [] };
      top().list.push(node);
      stack.push({ node, list: node.children, opener: m[0] });
    } else if (inner === '/?' || inner === '/^') {
      const open = top().node;
      if (open === undefined || open.positive !== (inner === '/?')) {
        errors.push(`${m[0]} has no open ${inner === '/?' ? '{{?…}}' : '{{^…}}'} block to close`);
      } else {
        stack.pop();
      }
    } else if (inner.startsWith('@')) {
      // One per line: a directive expands to whole blocks, and half a
      // sentence around a table is not something the assembler can honour.
      const lineStart = src.lastIndexOf('\n', m.index! - 1) + 1;
      const lineEnd = ((i) => (i === -1 ? src.length : i))(src.indexOf('\n', last));
      const around = src.slice(lineStart, m.index!) + src.slice(last, lineEnd);
      if (around.trim() !== '') {
        errors.push(`${m[0]} must stand alone on its own line — it expands to whole blocks, not to words`);
      }
      const [head, ...rest] = inner.slice(1).split(/\s+/);
      const args: Record<string, string> = {};
      for (const part of rest) {
        const eq = part.indexOf('=');
        if (eq <= 0) { errors.push(`${m[0]}: cannot read argument ${JSON.stringify(part)} — expected key=value`); continue; }
        args[part.slice(0, eq)] = part.slice(eq + 1);
      }
      top().list.push({ t: 'directive', name: head ?? '', args });
    } else if (inner.startsWith('section:')) {
      top().list.push({ t: 'directive', name: 'section', args: { name: inner.slice('section:'.length).trim() } });
    } else if (FIELD.test(inner)) {
      top().list.push({ t: 'field', path: inner });
    } else {
      errors.push(`cannot read ${JSON.stringify(m[0])} — a token is a {{field}}, a {{?presence}}/{{^absence}} block, a {{@directive}}, or {{section:name}}`);
    }
  }
  if (last < src.length) top().list.push({ t: 'text', text: src.slice(last) });
  while (stack.length > 1) {
    errors.push(`${stack.pop()!.opener} is not closed`);
  }
  if (errors.length > 0) throw new ProposalError(errors);
  return root;
}

/** Dotted lookup over the data. Absent, '' and [] all count as "absent" for a
 *  presence block; a real value that is an object or array is not printable. */
function lookup(data: ProposalData, path: string): unknown {
  let v: unknown = data;
  for (const part of path.split('.')) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

const isAbsent = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function flattenTemplate(nodes: TplNode[], data: ProposalData): FlatItem[] {
  const errors: string[] = [];
  const out: FlatItem[] = [];
  const push = (text: string) => {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.t === 'md') prev.text += text;
    else out.push({ t: 'md', text });
  };
  const walk = (list: TplNode[]): void => {
    for (const n of list) {
      switch (n.t) {
        case 'text': push(n.text); break;
        case 'field': {
          const v = lookup(data, n.path);
          if (isAbsent(v)) errors.push(`{{${n.path}}} has no value — supply it in the data file, or wrap the block in {{?${n.path}}}…{{/?}}`);
          else if (typeof v !== 'string' && typeof v !== 'number') errors.push(`{{${n.path}}} is not a printable value — it is an object or a list`);
          else push(String(v));
          break;
        }
        case 'presence':
          if (isAbsent(lookup(data, n.path)) !== n.positive) walk(n.children);
          break;
        case 'directive':
          if (n.name === 'section') {
            const name = n.args['name'] ?? '';
            const v = data.sections[name];
            if (v === undefined) errors.push(`{{section:${name}}} — the data file's sections carry no ${JSON.stringify(name)}`);
            else push(v);
          } else {
            out.push({ t: 'directive', name: n.name, args: n.args });
          }
          break;
      }
    }
  };
  walk(nodes);
  if (errors.length > 0) throw new ProposalError(errors);
  return out;
}
