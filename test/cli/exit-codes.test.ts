import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS } from '../../src/cli/build.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = join(ROOT, 'src', 'bin', 'documentor.ts');

// tsx rather than the built output: this asserts the entry point's contract,
// and dist-smoke.test.ts already covers the compiled artefact.
//
// On Windows, shell: true feeds the argv to cmd.exe by concatenating them
// with spaces rather than quoting each one (Node warns about this), so an
// unquoted absolute BIN path breaks the moment the checkout lives under a
// directory whose path contains a space — as it does on the machine this was
// developed on. Quoting BIN keeps it a single token.
const QUOTED_BIN = process.platform === 'win32' ? `"${BIN}"` : BIN;
const run = (...args: string[]) =>
  spawnSync('npx', ['tsx', QUOTED_BIN, ...args], { encoding: 'utf8', shell: process.platform === 'win32' });

describe('the exit-code contract', () => {
  it('exits 0 and prints usage for --help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('documentor build');
  });

  it('names every format the build actually accepts', () => {
    // Pins the --help text to FORMATS itself, not a hand-copied list — this
    // is exactly the assertion missing when docx shipped without --help
    // learning about it.
    const r = run('--help');
    for (const format of FORMATS) expect(r.stdout).toContain(format);
  });

  it('mentions --plain-names and explains what it does to the output name', () => {
    // Pins the option to its explanation the same way the format list above
    // is pinned: the option appearing in the flags line and the sentence
    // describing naming going stale independently is exactly the class of
    // bug the format-list test above exists to prevent.
    const r = run('--help');
    expect(r.stdout).toContain('--plain-names');
    expect(r.stdout).toContain('<name>.<ext>');
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

  it('reads relative paths from where `npm run documentor` was typed, not from the package', () => {
    // npm starts the script in the package's folder; INIT_CWD is where the
    // person stood. A --theme path given from a document's folder used to
    // point into the clone.
    const dir = mkdtempSync(join(tmpdir(), 'documentor-initcwd-'));
    writeFileSync(join(dir, 'note.md'), '# Note\n\nHello.\n');
    // ROOT ends in a separator, and on Windows a trailing \ before the quote
    // would escape the quote.
    const root = ROOT.replace(/[\\/]+$/, '');
    const r = spawnSync('npm', ['run', '-s', '--prefix', process.platform === 'win32' ? `"${root}"` : root, 'documentor', '--', 'build', 'note.md', '--to', 'md'],
      // npm reads INIT_CWD and its npm_config_* settings from the environment
      // it inherits, and this suite runs under npx, which set them: the
      // child must start as one typed in a shell would.
      { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'INIT_CWD' && !/^npm_/i.test(k))) });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(dir, 'note.plain.md'))).toBe(true);
  });
});
