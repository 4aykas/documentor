import type { Align, Block, Doc, Inline } from './types.js';

const BLOCK_TYPES = new Set([
  'heading', 'para', 'list', 'table', 'heatmap', 'image', 'code', 'quote', 'rule', 'pagebreak',
]);
const INLINE_TYPES = new Set(['text', 'strong', 'em', 'code', 'link']);
const ALIGNS = new Set<Align>(['l', 'r', 'c']);

function fail(where: string, why: string): never {
  throw new Error(`invalid document at ${where}: ${why}`);
}

function checkInlines(v: unknown, where: string): void {
  if (!Array.isArray(v)) fail(where, 'expected an array of inlines');
  v.forEach((node, i) => {
    const at = `${where}[${i}]`;
    if (typeof node !== 'object' || node === null) fail(at, 'expected an object');
    const n = node as Record<string, unknown>;
    if (typeof n['t'] !== 'string' || !INLINE_TYPES.has(n['t'])) {
      fail(at, `unknown inline type ${JSON.stringify(n['t'])}`);
    }
    if (n['t'] === 'text') {
      if (typeof n['v'] !== 'string') fail(at, 'text inline needs a string v');
      return;
    }
    if (n['t'] === 'link' && typeof n['href'] !== 'string') {
      fail(at, 'link inline needs a string href');
    }
    checkInlines(n['children'], `${at}.children`);
  });
}

function checkBlock(b: unknown, where: string): void {
  if (typeof b !== 'object' || b === null) fail(where, 'expected an object');
  const n = b as Record<string, unknown>;
  const t = n['t'];
  if (typeof t !== 'string' || !BLOCK_TYPES.has(t)) {
    fail(where, `unknown block type ${JSON.stringify(t)}`);
  }
  switch (t) {
    case 'heading': {
      const lvl = n['level'];
      if (lvl !== 1 && lvl !== 2 && lvl !== 3) fail(where, `level must be 1, 2 or 3, got ${String(lvl)}`);
      checkInlines(n['text'], `${where}.text`);
      return;
    }
    case 'para':
      checkInlines(n['text'], `${where}.text`);
      return;
    case 'list': {
      if (typeof n['ordered'] !== 'boolean') fail(where, 'list needs a boolean ordered');
      if (typeof n['depth'] !== 'number' || n['depth'] < 0) fail(where, 'list needs a non-negative depth');
      if (!Array.isArray(n['items'])) fail(`${where}.items`, 'expected an array');
      n['items'].forEach((it, i) => checkInlines(it, `${where}.items[${i}]`));
      if ('start' in n && n['start'] !== undefined) {
        const s = n['start'];
        if (typeof s !== 'number' || !Number.isInteger(s) || s < 1) {
          fail(`${where}.start`, `expected a positive integer, got ${JSON.stringify(s)}`);
        }
      }
      return;
    }
    case 'table': {
      if (!Array.isArray(n['head'])) fail(`${where}.head`, 'expected an array');
      // The column-count checks below all compare against head's length, and
      // every one of them holds trivially when that length is 0 — so a table
      // with no columns is the one malformed table this validator would wave
      // through, leaving each renderer to survive it alone. Markdown cannot
      // produce one; an empty spreadsheet sheet is an ordinary input.
      if (n['head'].length === 0) fail(`${where}.head`, 'a table needs at least one column');
      n['head'].forEach((c, i) => checkInlines(c, `${where}.head[${i}]`));
      if (!Array.isArray(n['align'])) fail(`${where}.align`, 'expected an array');
      n['align'].forEach((a, i) => {
        if (!ALIGNS.has(a as Align)) fail(`${where}.align[${i}]`, `expected l, r or c, got ${String(a)}`);
      });
      if (n['align'].length !== n['head'].length) {
        fail(where, `align has ${n['align'].length} entries for ${n['head'].length} columns`);
      }
      if (!Array.isArray(n['rows'])) fail(`${where}.rows`, 'expected an array');
      n['rows'].forEach((row, r) => {
        if (!Array.isArray(row)) fail(`${where}.rows[${r}]`, 'expected an array of cells');
        if (row.length !== (n['head'] as unknown[]).length) {
          fail(`${where}.rows[${r}]`, `has ${row.length} cells for ${(n['head'] as unknown[]).length} columns`);
        }
        row.forEach((c, i) => checkInlines(c, `${where}.rows[${r}][${i}]`));
      });
      return;
    }
    case 'heatmap': {
      const styles = new Set(['scale', 'numbers', 'marks']);
      if (typeof n['style'] !== 'string' || !styles.has(n['style'])) {
        fail(where, `unknown heatmap style ${JSON.stringify(n['style'])} — expected scale, numbers or marks`);
      }
      const rows = n['rows'];
      if (!Array.isArray(rows) || rows.length === 0) fail(`${where}.rows`, 'a heatmap needs at least one row');
      let weeks = -1;
      rows.forEach((row, r) => {
        const at = `${where}.rows[${r}]`;
        if (typeof row !== 'object' || row === null) fail(at, 'expected an object');
        const rr = row as Record<string, unknown>;
        if (typeof rr['label'] !== 'string' || rr['label'] === '') fail(at, 'row needs a non-empty label');
        const values = rr['values'];
        if (!Array.isArray(values) || values.length === 0) fail(`${at}.values`, 'expected a non-empty array of numbers');
        values.forEach((v, i) => {
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${at}.values[${i}]`, `expected a number ≥ 0, got ${JSON.stringify(v)}`);
        });
        if (weeks === -1) weeks = values.length;
        else if (values.length !== weeks) fail(at, `has ${values.length} week(s) where the first row has ${weeks}`);
      });
      return;
    }
    case 'image': {
      if (typeof n['src'] !== 'string' || n['src'] === '') fail(where, 'image needs a non-empty src');
      if (typeof n['alt'] !== 'string') fail(where, 'image needs a string alt (empty is allowed)');
      return;
    }
    case 'code':
      if (typeof n['text'] !== 'string') fail(where, 'code needs a string text');
      return;
    case 'quote': {
      if (!Array.isArray(n['paras'])) fail(`${where}.paras`, 'expected an array');
      n['paras'].forEach((p, i) => checkInlines(p, `${where}.paras[${i}]`));
      return;
    }
    default: // rule, pagebreak carry no payload
      return;
  }
}

/** Throws with a path to the offending node. A validator that only says "invalid" costs more than it saves. */
export function validateDoc(doc: unknown): asserts doc is Doc {
  if (typeof doc !== 'object' || doc === null) fail('document', 'expected an object');
  const d = doc as Record<string, unknown>;
  const meta = d['meta'];
  if (typeof meta !== 'object' || meta === null) fail('meta', 'expected an object');
  const m = meta as Record<string, unknown>;
  if (typeof m['title'] !== 'string' || m['title'] === '') fail('meta.title', 'expected a non-empty string');
  if (typeof m['lang'] !== 'string' || m['lang'] === '') fail('meta.lang', 'expected a non-empty string');
  if (!Array.isArray(d['blocks'])) fail('blocks', 'expected an array');
  d['blocks'].forEach((b, i) => checkBlock(b, `blocks[${i}]`));
}

export type { Block, Doc, Inline };
