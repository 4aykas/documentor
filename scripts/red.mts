// Show a guard test red once (CODING_STANDARDS.md, "Tests that guard"): put
// the defect back with one exact replacement, run the test, require it to
// fail, and restore the file byte for byte whatever happens.
//
//   npm run red -- <file> --find "<text>" --replace "<text>" -- <vitest args>
//   npm run red -- src/render/docx.ts --find "altText: {" --replace "alt: {" -- test/render/diagrams.test.ts -t "alt text"
//
// --find must occur exactly once. Exit 0 when the test failed with the
// defect (the guard works), 1 when it passed anyway, 2 on a usage error.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep === -1 ? argv : argv.slice(0, sep);
const test = sep === -1 ? [] : argv.slice(sep + 1);
const flag = (name: string) => { const i = own.indexOf(name); return i === -1 ? undefined : own.splice(i, 2)[1]; };
const find = flag('--find');
const replace = flag('--replace');
const file = own[0];
const usage = (why: string) => { console.error(`red: ${why}\n  npm run red -- <file> --find "<text>" --replace "<text>" -- <vitest args>`); process.exit(2); };
if (!file || find === undefined || replace === undefined || test.length === 0) usage('needs a file, --find, --replace and the test after --');

const original = readFileSync(file!);
const text = original.toString('utf8');
const hits = text.split(find!).length - 1;
if (hits !== 1) usage(`--find occurs ${hits} times in ${file}; it must occur exactly once`);

let failed: boolean;
try {
  writeFileSync(file!, text.replace(find!, () => replace!));
  // On Windows npx needs a shell, which splits unquoted arguments: `-t "a b"`
  // would become `-t a` and a file filter `b`, and vitest would fail for
  // having no test to run. Every argument is quoted for the shell.
  const win = process.platform === 'win32';
  const args = ['vitest', 'run', ...test].map((a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a));
  const r = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: win });
  const out = r.stdout + r.stderr;
  // Red means a test ran and failed, not that nothing ran.
  const ran = /Tests\s+.*\d+ (failed|passed)/.test(out);
  if (!ran) { console.error(`red: no test ran:\n${out.split('\n').slice(-8).join('\n')}`); writeFileSync(file!, original); process.exit(2); }
  failed = /Tests\s+.*\d+ failed/.test(out);
  console.log(out.split('\n').filter((l) => /Tests\s|AssertionError/.test(l)).slice(0, 3).join('\n'));
} finally {
  writeFileSync(file!, original);
}
if (readFileSync(file!).compare(original) !== 0) { console.error(`red: ${file} was not restored`); process.exit(2); }
console.log(failed!
  ? `red: shown red — with ${JSON.stringify(find)} → ${JSON.stringify(replace)} in ${file}, the test fails; restored`
  : `red: NOT red — the test passed with the defect in ${file}; the guard does not guard`);
process.exit(failed! ? 0 : 1);
