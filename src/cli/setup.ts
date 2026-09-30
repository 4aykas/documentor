import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Installs the Chromium build this copy's own playwright-core launches, by
 * running that playwright-core's installer rather than whatever `npx` finds.
 *
 * `npx playwright install chromium` was the instruction here, and it is wrong
 * in a way that only shows on someone else's machine: this package depends on
 * playwright-core, not playwright, so npx fetches the newest playwright
 * release and installs the Chromium build *it* wants. Once the two releases
 * differ, doctor reports a browser that "does not exist" right after it was
 * installed. CI hit exactly that. `npx playwright-core install` has the same
 * flaw outside this package's own folder, which is where a global install
 * leaves a colleague. Resolving the installer from this module is the only
 * way to get the build this copy will ask for.
 *
 * `--with-deps` is passed on to the installer, which then also installs the
 * system libraries Chromium needs on Linux. Nothing else is accepted: an
 * option this command does not know is a typo, not something to forward.
 */
export function parseSetupArgs(argv: string[]): { withDeps: boolean } {
  let withDeps = false;
  for (const a of argv) {
    if (a === '--with-deps') withDeps = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else throw new Error(`unexpected argument ${JSON.stringify(a)}`);
  }
  return { withDeps };
}

export function runSetup(argv: string[], io: { log: (s: string) => void; err: (s: string) => void }): number {
  let args: { withDeps: boolean };
  try {
    args = parseSetupArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}\n\n  documentor setup [--with-deps]`);
    return 2;
  }
  const require = createRequire(import.meta.url);
  const manifest = require.resolve('playwright-core/package.json');
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
  const cli = join(dirname(manifest), 'cli.js');
  io.log(`documentor: installing the Chromium playwright-core ${version} launches`);
  const run = spawnSync(process.execPath, [cli, 'install', ...(args.withDeps ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit' });
  if (run.status === 0) {
    io.log('documentor: done — run `documentor doctor` to check the rest');
    return 0;
  }
  io.err(`documentor: the Chromium install failed${run.error ? `: ${run.error.message}` : ''}`);
  return 1;
}
