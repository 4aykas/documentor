// A Mermaid source read as text: its header, its type, and the two rewrites
// documentor hands Mermaid instead of the source as written.

/** The diagram type a source declares: its first word after any frontmatter. */
export function kindOf(source: string): string {
  const { lines, at } = headerLine(source);
  return at === -1 ? '' : lines[at]!.trim().split(/[\s;]/)[0] ?? '';
}

/**
 * The source's lines and the index of its header — the first line after
 * any frontmatter, blank lines and %% comments — or -1 when there is none
 * (no header, or frontmatter that never closes). The one place kindOf,
 * leftToRight and drawable find the header, so they cannot disagree.
 */
export function headerLine(source: string): { lines: string[]; at: number } {
  const lines = source.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === '---');
    if (end === -1) return { lines, at: -1 };
    i = end + 1;
  }
  while (i < lines.length && (lines[i]!.trim() === '' || lines[i]!.trim().startsWith('%%'))) i++;
  return { lines, at: i < lines.length ? i : -1 };
}

/**
 * The source as Mermaid is handed it. Only one thing changes: a Gantt chart
 * draws a line at today's date unless its own source says `todayMarker off`
 * (no configuration key turns it off), and a wall-clock line would make a
 * document re-issued tomorrow come out different. So any marker line the
 * author wrote is replaced by that one. The block keeps the source as written.
 */
export function drawable(source: string): string {
  const { lines, at: head } = headerLine(source);
  if (head === -1 || !/^\s*gantt\s*$/.test(lines[head]!)) return source;
  const kept = lines.filter((l, i) => i <= head || !/^\s*todayMarker\b/.test(l));
  kept.splice(head + 1, 0, '  todayMarker off');
  return kept.join('\n');
}

/**
 * The source with a left-to-right flowchart or timeline turned top-down, or
 * null when it is neither. Only the header line's direction word changes.
 */
export function leftToRight(source: string): string | null {
  const { lines, at: i } = headerLine(source);
  if (i === -1) return null;
  const m = /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b(.*)$/.exec(lines[i] ?? '');
  if (m !== null) {
    lines[i] = `${m[1]}TD${m[3]}`;
    return lines.join('\n');
  }
  // A timeline runs left to right unless its header says TD; Mermaid draws
  // each period 200px apart, so four already outrun an A4 column.
  const t = /^(\s*timeline)(?:\s+LR)?\s*$/.exec(lines[i] ?? '');
  if (t === null) return null;
  lines[i] = `${t[1]} TD`;
  return lines.join('\n');
}

/**
 * Whether a source carries its own description for readers who cannot see
 * it: an `accDescr: …` line or an `accDescr { … }` block, which Mermaid
 * writes into the SVG as `<desc>`.
 */
export function hasDescription(source: string, lang = 'mermaid'): boolean {
  // A ```chart fence describes itself with a `desc` line.
  if (lang.toLowerCase() === 'chart') return /^\s*desc[ \t]+\S/m.test(source);
  return /^\s*accDescr\s*[:{]/m.test(source);
}
