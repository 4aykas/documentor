// Runs a command on another commit, in a throwaway worktree that borrows this
// checkout's node_modules: the way to ask "did the old code do this too?".
//
//   npm run at -- <commit> -- <command…>
//   npm run at -- af0d1fa --keep -- npx vitest run test/baseline/local-only-pixels.test.ts
//
// --keep leaves the worktree (its path is printed) so what the command wrote,
// such as test/baseline/__actual__, can be compared with pixels:diff; run
// `npm run at -- --clean <path>` when done. The borrowed node_modules is a
// link, and it is removed as a link before the worktree goes: removing the
// worktree first would follow it and delete this checkout's packages.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OWN = join(ROOT, 'node_modules');

function git(...args: string[]): string {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Unlinks the borrowed node_modules, checks this checkout's is whole, then removes the worktree. */
function clean(dir: string): void {
  const link = join(dir, 'node_modules');
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`${link} is not a link; not removing ${dir}, remove it by hand`);
    unlinkSync(link);
  }
  if (!existsSync(join(OWN, 'vitest'))) throw new Error(`${OWN} looks damaged after unlinking; not removing ${dir}`);
  git('worktree', 'remove', '--force', dir);
  // The temporary folder it sat in, if nothing else is there.
  try { rmdirSync(dirname(dir)); } catch { /* not empty, or not ours */ }
  console.log(`removed ${dir}`);
}

const args = process.argv.slice(2);
if (args[0] === '--clean' && args[1] !== undefined) {
  clean(resolve(args[1]));
  process.exit(0);
}
const sepAt = args.indexOf('--');
const [rev, ...flags] = sepAt === -1 ? args : args.slice(0, sepAt);
const cmd = sepAt === -1 ? [] : args.slice(sepAt + 1);
if (rev === undefined || cmd.length === 0 || flags.some((f) => f !== '--keep')) {
  console.error('usage: npm run at -- <commit> [--keep] -- <command…>   |   npm run at -- --clean <worktree>');
  process.exit(2);
}
const sha = git('rev-parse', '--short', rev);
const dir = join(mkdtempSync(join(tmpdir(), `documentor-at-${sha}-`)), 'tree');
git('worktree', 'add', '--detach', dir, sha);
// A junction on Windows needs no elevated rights; elsewhere a plain link.
symlinkSync(OWN, join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
console.log(`at ${sha}: ${dir}`);
let status = 1;
try {
  const quoted = process.platform === 'win32' ? cmd.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : cmd;
  const r = spawnSync(quoted[0]!, quoted.slice(1), { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  status = r.status ?? 1;
} finally {
  if (flags.includes('--keep')) console.log(`kept ${dir}; npm run at -- --clean "${dir}" when done`);
  else clean(dir);
}
process.exit(status);
