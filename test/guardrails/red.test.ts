import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm run red is an instrument: it certifies that a guard test guards. It
// once certified "no test ran" as "the test failed" (a shell split a test
// name with a space), so it is held to its three verdicts here: a defect put
// back is red, a change that changes nothing is not, and a test name that
// matches nothing is no verdict at all. The target is a fixture no other
// test imports, and its test runs only when this one asks (RED_TARGET), so
// mutating it disturbs nothing running beside it.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = 'test/fixtures/red-target.ts';
const GUARD = 'if (n < 0) return true;';
const run = (find: string, replace: string, name: string) => spawnSync(process.execPath,
  [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'scripts/red.mts'), SOURCE, '--find', find, '--replace', replace,
    '--', 'test/guardrails/red-target.test.ts', '-t', name], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RED_TARGET: '1' } });

describe('npm run red', () => {
  const before = readFileSync(join(ROOT, SOURCE));
  it('calls a defect put back red', () => {
    const r = run(GUARD, '', 'refuses a negative number');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/shown red/);
  }, 120_000);

  it('calls a change that changes nothing not red', () => {
    const r = run(GUARD, GUARD, 'refuses a negative number');
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/NOT red/);
  }, 120_000);

  it('gives no verdict when no test ran, whatever the name holds', () => {
    const r = run(GUARD, '', 'no test is called this');
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/no test ran/);
  }, 120_000);

  it('leaves the target as it found it', () => {
    expect(readFileSync(join(ROOT, SOURCE)).equals(before)).toBe(true);
  });
});
