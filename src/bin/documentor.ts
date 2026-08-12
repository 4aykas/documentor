#!/usr/bin/env node
import { FORMATS, runBuild } from '../cli/build.js';
import { runDoctor } from '../cli/doctor.js';

// The --to list is derived from build.ts's own FORMATS, not copied, so this
// text cannot go stale the way it did when docx was wired in but the string
// here still named only pdf and md.
const USAGE = `documentor — re-issue an existing document as a well-typeset one

  documentor build <file> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>] [--title <s>]
  documentor doctor

Output lands beside the input as <name>.<theme>.<ext>.`;

/**
 * The exit code contract, documented in this one place because callers script
 * against it. Keeping "declined" (3) distinct from "fell over" (1) is the
 * point: without it a script cannot tell "documentor understood the request
 * and refused" from "documentor crashed", and would retry a refusal it should
 * instead treat as final.
 *
 *   0  success
 *   1  unexpected failure (an uncaught throw — a bug, a missing file, etc.)
 *   2  usage error (bad option, missing argument, unsupported format or
 *      input extension — the command as typed cannot be carried out)
 *   3  refused (documentor understood the request and declined to carry it
 *      out — e.g. the computed output path would overwrite the input)
 *
 * `runBuild` returns 2 and 3 itself; this file only owns 0 (nothing ran) and
 * 1 (the catch-all for anything that threw instead of returning a code).
 */

const io = { log: (s: string) => console.log(s), err: (s: string) => console.error(s) };
const [command, ...rest] = process.argv.slice(2);

let code = 0;
try {
  if (command === 'build') code = await runBuild(rest, io);
  else if (command === 'doctor') code = await runDoctor(io);
  else if (command === undefined || command === '--help' || command === '-h') { io.log(USAGE); code = command === undefined ? 2 : 0; }
  else { io.err(`documentor: unknown command ${JSON.stringify(command)}\n\n${USAGE}`); code = 2; }
} catch (e) {
  io.err(`documentor: ${(e as Error).message}`);
  code = 1;
}
process.exit(code);
