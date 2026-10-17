import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A test runs documentor's CLI through test/helpers/cli.ts, which starts it
// with Node and tsx directly and fails with everything the child printed.
// The forms it replaced — npx tsx through a shell — split a quoted path on
// Windows, picked up npm's variables, and on 2026-10-17 failed in CI with an
// exit code and nothing else to read.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HELPER = join('test', 'helpers', 'cli.ts');
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : /\.(ts|mts)$/.test(e.name) ? [join(d, e.name)] : []));

describe('tests that run the CLI', () => {
  it('run it through test/helpers/cli.ts', () => {
    const offenders = files(join(ROOT, 'test'))
      .filter((f) => relative(ROOT, f) !== HELPER && !f.endsWith('cli-helper.test.ts'))
      // A spawn of npx or tsx is a string naming it; the entry point itself
      // is only ever named in comments outside the helper.
      .filter((f) => /['"](npx|tsx)['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders, 'start the CLI with runCli() from test/helpers/cli.ts').toEqual([]);
  });
});
