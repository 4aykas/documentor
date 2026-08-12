import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = join(ROOT, 'src', 'bin', 'documentor.ts');

// tsx rather than the built output: this asserts the entry point's contract,
// and dist-smoke.test.ts already covers the compiled artefact.
//
// On Windows, shell: true feeds the argv to cmd.exe by concatenating them
// with spaces rather than quoting each one (Node warns about this), so an
// unquoted absolute BIN path breaks the moment the repo lives under a
// directory with a space in it — as this one does ("OneDrive - TEBIN").
// Quoting BIN keeps it a single token.
const QUOTED_BIN = process.platform === 'win32' ? `"${BIN}"` : BIN;
const run = (...args: string[]) =>
  spawnSync('npx', ['tsx', QUOTED_BIN, ...args], { encoding: 'utf8', shell: process.platform === 'win32' });

describe('the exit-code contract', () => {
  it('exits 0 and prints usage for --help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('documentor build');
  });

  it('exits 2 with no command', () => {
    expect(run().status).toBe(2);
  });

  it('exits 2 for an unknown command', () => {
    const r = run('frobnicate');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('frobnicate');
  });

  it('exits 2 for a build with no input file', () => {
    expect(run('build').status).toBe(2);
  });

  it('exits 1 when the input does not exist', () => {
    const r = run('build', 'no-such-file.md');
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('    at '); // a message, not a stack trace
  });
});
