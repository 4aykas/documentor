import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMATS } from '../../src/cli/build.js';
import { expectExit, runCli } from '../helpers/cli.js';

// The entry point run as its own process (test/helpers/cli.ts), from source:
// this asserts the entry point's contract, and dist-smoke.test.ts already
// covers the compiled artefact.

describe('the exit-code contract', () => {
  it('exits 0 and prints usage for --help', () => {
    const r = runCli(['--help']);
    expectExit(r, 0);
    expect(r.stdout).toContain('documentor build');
  });

  it('names every format the build actually accepts', () => {
    // Pins the --help text to FORMATS itself, not a hand-copied list — this
    // is exactly the assertion missing when docx shipped without --help
    // learning about it.
    const r = runCli(['--help']);
    for (const format of FORMATS) expect(r.stdout, r.said).toContain(format);
  });

  it('mentions --plain-names and explains what it does to the output name', () => {
    // Pins the option to its explanation the same way the format list above
    // is pinned: the option appearing in the flags line and the sentence
    // describing naming going stale independently is exactly the class of
    // bug the format-list test above exists to prevent.
    const r = runCli(['--help']);
    expect(r.stdout, r.said).toContain('--plain-names');
    expect(r.stdout, r.said).toContain('<name>.<ext>');
  });

  it('exits 2 with no command', () => {
    expectExit(runCli([]), 2);
  });

  it('exits 2 for an unknown command', () => {
    const r = runCli(['frobnicate']);
    expectExit(r, 2);
    expect(r.stderr).toContain('frobnicate');
  });

  it('exits 2 for a build with no input file', () => {
    expectExit(runCli(['build']), 2);
  });

  it('exits 1 when the input does not exist', () => {
    const r = runCli(['build', 'no-such-file.md']);
    expectExit(r, 1);
    expect(r.stderr).not.toContain('    at '); // a message, not a stack trace
  });

  it('reads relative paths from where `npm run documentor` was typed, not from the package', () => {
    // npm starts the script in the package's folder; INIT_CWD is where the
    // person stood. A --theme path given from a document's folder used to
    // point into the clone. Started the way npm starts the `documentor`
    // script rather than through npm itself: which npm a child finds on the
    // PATH is the machine's business (on CI's Windows image it was npm 10,
    // which this package's devEngines refuses), and not what this is about.
    const dir = mkdtempSync(join(tmpdir(), 'documentor-initcwd-'));
    writeFileSync(join(dir, 'note.md'), '# Note\n\nHello.\n');
    // Windows names are case-blind: an inherited Npm_Lifecycle_Event or
    // init_cwd would stand beside these and one of the two would win.
    const inherited = Object.entries(process.env).filter(([k]) => !/^(npm_lifecycle_event|init_cwd)$/i.test(k));
    const r = runCli(['build', 'note.md', '--to', 'md'], { env: { ...Object.fromEntries(inherited), npm_lifecycle_event: 'documentor', INIT_CWD: dir } });
    expectExit(r, 0);
    expect(existsSync(join(dir, 'note.plain.md')), r.said).toBe(true);
  });
});
