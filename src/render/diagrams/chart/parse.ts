// A ```chart fence read into a model: bar, dumbbell or waterfall
// (docs/adr/0008). A line grammar in Mermaid's manner — the first line names
// the type, then settings, then one row per line, a row's label being
// everything before its trailing numbers. Anything not understood refuses
// the fence, naming the line, so it prints as its source and the build says
// why. Values are printed exactly as written; they are parsed under one
// convention, and summed exactly (scaled integers), never in binary floats.

export type ChartKind = 'bar' | 'grouped' | 'dumbbell' | 'waterfall';
export const CHART_KINDS: readonly ChartKind[] = ['bar', 'grouped', 'dumbbell', 'waterfall'];

/** A number as the author wrote it, and its exact value. */
export type Num = {
  /** The token verbatim: what the chart prints. */
  text: string;
  /** The value, for geometry. */
  value: number;
  /** The value × 10^scale, exact. */
  exact: bigint;
  /** Decimals written. */
  decimals: number;
  /** Whether the author wrote a sign. */
  signed: boolean;
  /** The thousands separator the author used, or '' for none. */
  sep: string;
};

export type Row = { label: string; values: Num[]; role?: 'total' | 'step'; focus: boolean; line: number };

export type Chart = {
  kind: ChartKind;
  title?: string;
  desc?: string;
  unit?: string;
  axis?: Num;
  before?: string;
  after?: string;
  marks: { value: Num; label: string }[];
  /** A grouped bar's series names, in column order. */
  series: string[];
  rows: Row[];
};

export type Parsed = { ok: true; chart: Chart } | { ok: false; error: string };

/** The settings each type accepts, besides its rows. */
export const SETTINGS: Readonly<Record<ChartKind, readonly string[]>> = {
  bar: ['title', 'desc', 'unit', 'mark'],
  grouped: ['title', 'desc', 'unit', 'mark', 'series'],
  dumbbell: ['title', 'desc', 'unit', 'axis', 'before', 'after'],
  waterfall: ['title', 'desc', 'unit', 'axis'],
};
const ALL_SETTINGS = new Set(Object.values(SETTINGS).flat());

/** Row keywords a type takes (a bar or dumbbell row has none). */
export const ROW_WORDS: Readonly<Record<ChartKind, readonly string[]>> = {
  bar: [], grouped: [], dumbbell: [], waterfall: ['total', 'step'],
};

const MINUS = '−';
/** Optional sign; digits, with one thousands separator used throughout in
 *  groups of three (comma, apostrophe, thin space); optional `.` decimals. */
const NUMBER = /^([+\-−])?(\d{1,3}(?:([,' ])\d{3})(?:\3\d{3})*|\d+)(?:\.(\d+))?$/;

export function parseNumber(token: string): Num | null {
  const m = NUMBER.exec(token);
  if (m === null) return null;
  const [, sign, int, sep = '', frac = ''] = m;
  const digits = int!.split(sep || '\u0000').join('') + frac;
  const negative = sign === '-' || sign === MINUS;
  const exact = BigInt(digits) * (negative ? -1n : 1n);
  // Beyond 15 significant digits a value cannot be placed on a scale
  // exactly; it is refused like any number this chart cannot read.
  if (digits.replace(/^0+/, '').length > 15) return null;
  return { text: token, value: Number(exact) / 10 ** frac.length, exact, decimals: frac.length, signed: sign !== undefined, sep };
}

/** A grouped bar's missing value: written `-`, drawn as nothing, printed as nothing. */
export const MISSING: Num = { text: '', value: Number.NaN, exact: 0n, decimals: 0, signed: false, sep: '' };
export const isMissing = (n: Num) => Number.isNaN(n.value);

/** Exact values at one common scale, for sums. */
function scaled(nums: Num[]): { at: (n: Num) => bigint; scale: number } {
  const scale = Math.max(0, ...nums.map((n) => n.decimals));
  return { scale, at: (n) => n.exact * 10n ** BigInt(scale - n.decimals) };
}

/** A scaled integer written back as a plain decimal, for messages. */
function plain(v: bigint, scale: number): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(scale + 1, '0');
  const int = s.slice(0, s.length - scale).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${int}${scale ? `.${s.slice(-scale)}` : ''}`;
}

export function parseChart(source: string): Parsed {
  const lines = source.split('\n');
  const fail = (line: number, why: string): Parsed => ({ ok: false, error: `line ${line + 1}: ${why}` });
  let i = 0;
  const skip = (l: string) => l.trim() === '' || l.trim().startsWith('%%');
  while (i < lines.length && skip(lines[i]!)) i++;
  const head = lines[i]?.trim() ?? '';
  if (!(CHART_KINDS as readonly string[]).includes(head)) {
    return fail(i, `a chart starts with its type, one of ${CHART_KINDS.join(', ')}; got ${JSON.stringify(head)}`);
  }
  const kind = head as ChartKind;
  const chart: Chart = { kind, marks: [], series: [], rows: [] };
  const seen = new Set<string>();
  for (let n = i + 1; n < lines.length; n++) {
    const line = lines[n]!;
    if (skip(line)) continue;
    const tokens = line.trim().split(/[ \t]+/);
    const word = tokens[0]!;
    const rest = line.trim().slice(word.length).trim();
    // A setting word at the start of a line is a setting, before or after the
    // rows; a row's label therefore never begins with one.
    if (!(SETTINGS[kind] as readonly string[]).includes(word) && ALL_SETTINGS.has(word)) {
      return fail(n, `${word} is not a ${kind} setting; a ${kind} takes ${SETTINGS[kind].join(', ')}`);
    }
    if ((SETTINGS[kind] as readonly string[]).includes(word)) {
      if (word !== 'mark' && word !== 'series' && seen.has(word)) return fail(n, `${word} is set twice`);
      seen.add(word);
      if (word === 'axis') {
        const v = parseNumber(rest);
        if (v === null) return fail(n, `axis takes one number, got ${JSON.stringify(rest)}`);
        chart.axis = v;
      } else if (word === 'series') {
        if (chart.rows.length) return fail(n, 'a grouped bar names its series before its rows');
        if (rest === '') return fail(n, 'series needs a name');
        if (chart.series.includes(rest)) return fail(n, `the series "${rest}" is named twice`);
        chart.series.push(rest);
      } else if (word === 'mark') {
        const [tok, ...label] = rest.split(/[ \t]+/);
        const v = parseNumber(tok ?? '');
        if (v === null || label.length === 0) return fail(n, 'mark takes a number and a label');
        chart.marks.push({ value: v, label: label.join(' ') });
      } else {
        if (rest === '') return fail(n, `${word} needs text`);
        (chart as Record<string, unknown>)[word] = rest;
      }
      continue;
    }
    // A row: [role] label… numbers [focus]
    let t = tokens.slice();
    let role: Row['role'];
    if (ROW_WORDS[kind].length) {
      if (!ROW_WORDS[kind].includes(t[0]!)) return fail(n, `a ${kind} row starts with ${ROW_WORDS[kind].join(' or ')}; got ${JSON.stringify(t[0])}`);
      role = t[0] as Row['role'];
      t = t.slice(1);
    }
    const focus = t.at(-1) === 'focus';
    if (focus) t = t.slice(0, -1);
    if (kind === 'grouped' && chart.series.length < 2) return fail(n, 'a grouped bar names two to four series first, one "series <name>" line each');
    const want = kind === 'dumbbell' ? 2 : kind === 'grouped' ? chart.series.length : 1;
    // In a grouped bar, `-` says a row has no value in that series.
    const read = (x: string) => (kind === 'grouped' && (x === '-' || x === '\u2013') ? MISSING : parseNumber(x));
    const nums = t.slice(-want).map(read);
    const label = t.slice(0, -want).join(' ');
    if (t.length <= want || nums.some((x) => x === null)) {
      // Too few tokens is a missing label or value, whatever the tokens are.
      const bad = t.length <= want ? undefined : t.slice(-want).find((x) => read(x) === null);
      return fail(n, bad !== undefined
        ? `${JSON.stringify(bad)} is not a number this chart can read (digits, an optional sign, thousands in groups of three, a point for decimals)`
        : `a ${kind} row needs a label and ${want === 1 ? 'a number' : `${want} numbers`}`);
    }
    if (nums.every((x) => x !== null && isMissing(x))) return fail(n, 'a row needs at least one value');

    // "Personnel 12 500" is a label and 500, or 12,500 written with a plain
    // space: refused rather than guessed. A thin space or a comma says which.
    const before = t[t.length - want - 1];
    if (before !== undefined && /^[+\-\u2212]?\d{1,3}$/.test(before) && /^\d{3}(\.\d+)?$/.test(t[t.length - want]!)) {
      return fail(n, `is "${before} ${t[t.length - want]}" one number? Write thousands with a comma, an apostrophe or a thin space, `
        + 'or end the label with a word');
    }
    chart.rows.push({ label, values: nums as Num[], ...(role ? { role } : {}), focus, line: n });
  }
  if (chart.rows.length === 0) return fail(lines.length - 1, `a ${kind} needs at least one row`);
  if (chart.marks.length > 2) return fail(chart.rows[0]!.line, 'a bar chart takes at most two marks');
  if (kind === 'grouped' && chart.series.length > 4) return fail(chart.rows[0]!.line, 'a grouped bar takes at most four series');
  if (kind === 'grouped') {
    const empty = chart.series.findIndex((_, si) => chart.rows.every((r) => isMissing(r.values[si]!)));
    if (empty !== -1) return fail(chart.rows[0]!.line, `the series "${chart.series[empty]}" has no value in any row; leave it out`);
  }
  if (kind === 'dumbbell' && (!chart.before || !chart.after)) {
    return fail(i, 'a dumbbell names its two values with "before <name>" and "after <name>"');
  }
  if (kind === 'waterfall') {
    const err = reconcile(chart);
    if (err) return { ok: false, error: err };
    if (runningLevels(chart).some((v) => v < 0)) {
      return fail(i, 'a waterfall that runs below zero is not drawn: its totals would stand on a baseline the steps cross');
    }
  }
  const levels = kind === 'waterfall' ? runningLevels(chart) : chart.rows.flatMap((r) => r.values.filter((v) => !isMissing(v)).map((v) => v.value));
  if (chart.axis && levels.some((v) => v < chart.axis!.value)) {
    return fail(i, `axis ${chart.axis.text} lies above a value the chart must show; start it at or below ${Math.min(...levels)}`);
  }
  return { ok: true, chart };
}

/**
 * A waterfall reconciles or is refused: it opens and closes on a total, has
 * at most one subtotal between, every step carries its sign and is not zero,
 * and every total equals the running sum exactly.
 */
function reconcile(c: Chart): string | null {
  const rows = c.rows;
  const at = (r: Row) => `line ${r.line + 1}`;
  if (rows[0]!.role !== 'total') return `${at(rows[0]!)}: a waterfall opens on a total`;
  if (rows.at(-1)!.role !== 'total' || rows.length < 2) return `${at(rows.at(-1)!)}: a waterfall closes on a total`;
  if (rows.filter((r) => r.role === 'total').length > 3) return `${at(rows[0]!)}: a waterfall takes at most one subtotal between its first and last total`;
  const { at: x, scale } = scaled(rows.map((r) => r.values[0]!));
  let run = 0n;
  for (const r of rows) {
    const v = r.values[0]!;
    if (r.role === 'step') {
      if (!v.signed) return `${at(r)}: a step carries its sign (+ or −): ${v.text}`;
      if (v.exact === 0n) return `${at(r)}: a zero step draws nothing; say it in the text instead`;
      run += x(v);
    } else if (r === rows[0]) {
      run = x(v);
    } else if (x(v) !== run) {
      return `${at(r)}: the total ${v.text} does not equal the running sum ${plain(run, scale)} (difference ${plain(x(v) - run, scale)})`;
    }
  }
  return null;
}

/** The level before and after each row of a reconciled waterfall. */
export function runningLevels(c: Chart): number[] {
  const out: number[] = [];
  let run = 0;
  for (const r of c.rows) {
    const v = r.values[0]!.value;
    if (r.role === 'step') { out.push(run); run += v; out.push(run); } else { run = v; out.push(v); }
  }
  return out;
}
