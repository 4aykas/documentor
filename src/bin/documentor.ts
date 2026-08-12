#!/usr/bin/env node
import { runBuild } from '../cli/build.js';
import { runDoctor } from '../cli/doctor.js';

const USAGE = `documentor — re-issue an existing document as a well-typeset one

  documentor build <file> [--to pdf,md] [--theme plain] [--out <dir>] [--title <s>]
  documentor doctor

Output lands beside the input as <name>.<theme>.<ext>.`;

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
