// The one way a test runs documentor's CLI as a separate process: Node and
// tsx directly, never npx and never a shell. npx through a shell on Windows
// joins arguments unquoted (a path with a space splits) and sets npm's own
// variables over the test's; and a failure must say what the child printed:
// a CI run on 2026-10-17 failed three times with nothing to read, because a
// test asserted only an exit code. test/guardrails/cli-helper.test.ts holds
// the suite to this.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN = join(ROOT, 'src', 'bin', 'documentor.ts');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

export type Ran = { status: number | null; stdout: string; stderr: string; said: string };

/** `documentor <args…>`, from `cwd` (the package root by default). */
export function runCli(args: readonly string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Ran {
  const r = spawnSync(process.execPath, [TSX, BIN, ...args], { cwd: opts.cwd ?? ROOT, encoding: 'utf8', env: opts.env ?? process.env });
  const status = r.status;
  const said = `documentor ${args.join(' ')} exited ${status}${r.error ? ` (${r.error.message})` : ''}\n`
    + `--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;
  return { status, stdout: r.stdout, stderr: r.stderr, said };
}

/** Asserts the exit code, failing with everything the child printed. */
export function expectExit(r: Ran, code: number): void {
  expect(r.status, r.said).toBe(code);
}
