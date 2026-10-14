import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guardrail for a defect that shipped: a patch script turned the `\b` of a
// regex in src/render/html.ts into a real backspace (0x08). The file still
// compiled and every test passed; the regex simply never matched, so the
// diagram size cap it applied was gone. A control character is invisible in
// an editor, a diff and a review, so only a byte check sees it. Tab, line
// feed and carriage return are text; nothing else below 0x20 (or DEL) is.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEXT = new Set(['.ts', '.js', '.mjs', '.json', '.md', '.css', '.html', '.svg', '.yml', '.yaml', '.txt', '']);
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const listing = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
const tracked = listing.status === 0
  ? listing.stdout.split('\0').filter((f) => f !== '' && TEXT.has(extname(f).toLowerCase()) && !f.endsWith('package-lock.json'))
  : [];

describe('tracked text files', () => {
  it('are found', () => {
    expect(listing.status, `this check reads the file list from git, which failed: ${listing.error?.message ?? listing.stderr}`).toBe(0);
    expect(tracked.length).toBeGreaterThan(50);
  });

  it('carry no control characters', () => {
    const hits: string[] = [];
    for (const f of tracked) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = CONTROL.exec(line);
        if (m) hits.push(`${f}:${i + 1}: U+${m[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
