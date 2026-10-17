import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The rules docs/adr/README.md states about its own folder: files named
// NNNN-slug.md, numbered from 0001 with no gaps or repeats, each with a
// status line, and the index listing exactly the files there are.

const DIR = fileURLToPath(new URL('../../docs/adr/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f !== 'README.md').sort();
const index = readFileSync(join(DIR, 'README.md'), 'utf8');

describe('docs/adr', () => {
  it('names every record NNNN-slug.md, numbered from 0001 with no gaps', () => {
    for (const f of files) expect(f).toMatch(/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
    expect(files.map((f) => Number(f.slice(0, 4)))).toEqual(files.map((_, i) => i + 1));
  });

  it('gives every record a title naming its number and a status line', () => {
    for (const f of files) {
      const text = readFileSync(join(DIR, f), 'utf8');
      expect(text.split('\n')[0], f).toMatch(new RegExp(`^# ADR ${f.slice(0, 4)} — \\S`));
      expect(text, f).toMatch(/^\*\*Status:\*\* (accepted|proposed|superseded by ADR \d{4})\b/m);
    }
  });

  it('lists exactly these records in the index', () => {
    const linked = [...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]);
    expect(linked).toEqual(files);
  });
});
