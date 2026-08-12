#!/usr/bin/env node
import { FORMATS, runBuild } from '../cli/build.js';
import { runDoctor } from '../cli/doctor.js';
import { runInspect } from '../cli/inspect.js';

// The --to list is derived from build.ts's own FORMATS, not copied, so this
// text cannot go stale the way it did when docx was wired in but the string
// here still named only pdf and md.
const USAGE = `documentor — re-issue an existing document as a well-typeset one

  documentor inspect <file|dir> [--theme plain] [--json] [--recursive] [--title <s>] [--date <s>] [--entity <s>] [--config <file>] [--no-config]
  documentor build <file|dir> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>] [--title <s>] [--date <s>] [--entity <s>] [--plain-names] [--recursive] [--config <file>] [--no-config]
  documentor doctor

inspect reads a document and reports what it understood, what it had to drop,
and what will surprise you — it renders nothing, and writes nothing to disk.
Output lands beside the input as <name>.<theme>.<ext>, or <name>.<ext> with --plain-names.
A directory input builds (or inspects) every .md/.markdown/.docx file it
contains (its own top level only, unless --recursive); build reuses one
browser for the batch and prints a summary of what was written, refused,
failed, or dropped.

A <stem>.documentor.json sidecar beside an input is found automatically and
applied — a flag on the command line outranks the sidecar, which outranks the
document's own metadata — and named in the output when used. --config <file>
names one explicitly (a single input only); --no-config ignores any that
exist.`;

/**
 * The exit code contract, documented in this one place because callers script
 * against it. Keeping "declined" (3) distinct from "fell over" (1) is the
 * point: without it a script cannot tell "documentor understood the request
 * and refused" from "documentor crashed", and would retry a refusal it should
 * instead treat as final.
 *
 *   0  success
 *   1  unexpected failure (an uncaught throw — a bug, a missing file, etc.;
 *      for a directory batch, also any single document that failed this way
 *      — a batch never invents a new code for "some of these, some of
 *      those", it reports the more serious class the same way one document
 *      only ever gets one code)
 *   2  usage error (bad option, missing argument, unsupported format or
 *      input extension, or a directory batch with nothing readable in it —
 *      the command as typed cannot be carried out)
 *   3  refused (documentor understood the request and declined to carry it
 *      out — e.g. the computed output path would overwrite the input; for a
 *      directory batch, also when some documents wrote and others were only
 *      refused, with none failing outright)
 *
 * `runBuild` returns 2 and 3 itself; this file only owns 0 (nothing ran) and
 * 1 (the catch-all for anything that threw instead of returning a code) —
 * except that a directory batch computes its own 1 the same way, since one
 * bad document must not let an uncaught throw end the whole batch.
 *
 * `inspect` returns the same four codes for the same meanings — see
 * src/cli/inspect.ts's own comment on `runInspect` for exactly how a
 * readable, an unreadable, and a would-be-refused document each map here.
 */

const io = { log: (s: string) => console.log(s), err: (s: string) => console.error(s) };
const [command, ...rest] = process.argv.slice(2);

let code = 0;
try {
  if (command === 'build') code = await runBuild(rest, io);
  else if (command === 'inspect') code = await runInspect(rest, io);
  else if (command === 'doctor') code = await runDoctor(io);
  else if (command === undefined || command === '--help' || command === '-h') { io.log(USAGE); code = command === undefined ? 2 : 0; }
  else { io.err(`documentor: unknown command ${JSON.stringify(command)}\n\n${USAGE}`); code = 2; }
} catch (e) {
  io.err(`documentor: ${(e as Error).message}`);
  code = 1;
}
process.exit(code);
