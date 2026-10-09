import { chromium, type Browser } from 'playwright-core';
import { runSetup } from './setup.js';
import { missingSystemFonts, systemFontDirs } from './doctor.js';
import type { Theme } from '../theme/resolve.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

/** The oldest Node this package runs on, as `engines.node` promises. */
export const NODE_MIN_MAJOR = 22;

/**
 * Names the problem when the Node running this is too old, or returns
 * undefined when it is fine. Checked before any command runs: on an old Node
 * the first failure would otherwise be a syntax error deep inside a
 * dependency, which tells a colleague nothing about what to install.
 */
export function nodeTooOld(version: string = process.versions.node): string | undefined {
  const [major] = version.split('.').map(Number);
  if ((major ?? 0) >= NODE_MIN_MAJOR) return undefined;
  return `documentor needs Node ${NODE_MIN_MAJOR} or newer, and this is Node ${version}.\n`
    + `  fix: install the current LTS from nodejs.org (or \`nvm install ${NODE_MIN_MAJOR}\`), then run the same command again`;
}

/**
 * What `launchBrowser` needs from the outside world, so a test can hand it
 * a launch that fails the way a missing browser fails, and an installer
 * that succeeds or does not, without downloading anything.
 */
export type BrowserDeps = {
  launch: () => Promise<Browser>;
  /** Runs the install; resolves to the installer's exit code. */
  install: (io: Io) => number;
};

const realDeps: BrowserDeps = {
  launch: () => chromium.launch(),
  install: (io) => runSetup([], io),
};

/**
 * Whether a launch failed because the browser is not on the machine, as
 * opposed to a browser that is there and would not start. Playwright says
 * "Executable doesn't exist at <path>" for the first; the second gets a
 * different message and is not something an install would fix.
 */
export function isMissingBrowser(e: unknown): boolean {
  return /Executable doesn't exist/i.test((e as Error)?.message ?? '');
}

/**
 * The one way a command gets its browser: launch, and when the launch fails
 * because the Chromium this copy expects is not there, install it on the
 * spot and launch again.
 *
 * Launching is the test, not looking for a file: a headless launch opens the
 * headless shell, a headed one the full browser, and the registry decides
 * which from flags this module does not see — a path check answered for the
 * wrong binary. `documentor setup` still exists and does the same install,
 * but a colleague handed `npm install -g …` and a document to convert does
 * not know to run it, and the error they would otherwise meet names a path,
 * not a command. So the first command that needs a browser installs it,
 * says so before the download starts (one time, about 150 MB), and carries
 * on. When the install fails — no network, a proxy, a blocked download —
 * the error names `documentor setup` so the retry is one command, not a
 * search.
 */
export async function launchBrowser(io: Io, deps: BrowserDeps = realDeps): Promise<Browser> {
  try {
    return await deps.launch();
  } catch (e) {
    if (!isMissingBrowser(e)) throw e;
  }
  io.log('documentor: the Chromium build this copy launches is not installed yet — installing it now (one time, about 150 MB)');
  const code = deps.install(io);
  if (code === 0) {
    try {
      return await deps.launch();
    } catch (e) {
      if (!isMissingBrowser(e)) throw e;
    }
  }
  throw new Error(
    'Chromium is not installed, and installing it just now did not succeed.\n'
    + '  fix: check the network (a proxy or a blocked download is the usual cause), then run `documentor setup`;\n'
    + '       `documentor doctor` lists everything else a build needs',
  );
}

const fontNoteGiven = new Set<string>();

/**
 * One line, or nothing: the faces a theme names for Word that this machine
 * does not have. Word draws a .docx with the fonts of the machine that opens
 * it, so this cannot stop a build and is not an error — but a colleague who
 * opens the file here and sees a serif where the PDF shows Manrope should
 * hear why from the build, not discover it. Said once per theme per run,
 * so a batch of forty files does not say it forty times. `doctor` makes the
 * same check for every bundled theme at once.
 */
export function wordFontNote(theme: Theme, dirs: string[] = systemFontDirs()): string | undefined {
  if (fontNoteGiven.has(theme.id)) return undefined;
  fontNoteGiven.add(theme.id);
  const faces = [...new Set([theme.font.document, theme.font.heading.document, theme.font.label?.document].filter((f): f is string => f !== undefined))];
  const missing = missingSystemFonts(faces, dirs);
  if (missing.length === 0) return undefined;
  return `${missing.join(', ')} not installed on this machine — Word here shows a substitute in .docx files from theme ${theme.id}; `
    + `PDFs are unaffected. fix: install ${missing.join(' and ')} (free on fonts.google.com) wherever the Word file is opened`;
}

/** Forgets which themes were already noted — for tests only. */
export function resetWordFontNotes(): void { fontNoteGiven.clear(); }
