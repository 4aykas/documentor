import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath decodes percent-escapes (e.g. a repo path containing spaces),
// unlike a plain `.pathname` read — see test/baseline/kitchen-sink.test.ts.
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tsFiles(p)));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('reproducibility guardrails', () => {
  it('no source file reads the wall clock', async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles(SRC)) {
      const text = await readFile(file, 'utf8');
      // normalize-pdf.ts constructs a Date from an explicit epoch, which is fine;
      // an argument-less `new Date()` or a Date.now() is not.
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        if (/\bDate\.now\s*\(/.test(line) || /\bnew Date\s*\(\s*\)/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'timestamps must come from resolveEpoch, never the clock').toEqual([]);
  });

  it('no source file fetches over the network', async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles(SRC)) {
      const text = await readFile(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        if (/\bfetch\s*\(/.test(line) || /https?:\/\//.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'the renderer must inline every asset, never fetch one').toEqual([]);
  });
});
