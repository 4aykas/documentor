import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { arimoFaceCss } from '../render/fonts.js';
import { bundledThemeIds, loadTheme } from '../theme/resolve.js';

// `advisory` marks a check that cannot stop a build: it prints as a note and
// never turns Ready into "need attention".
type Check = { name: string; ok: boolean; detail: string; fix?: string; advisory?: boolean };

/** Where the operating system keeps installed fonts, per platform. */
export function systemFontDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  if (platform === 'win32') {
    return [join(env['WINDIR'] ?? 'C:\\Windows', 'Fonts'), join(env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')];
  }
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.local', 'share', 'fonts'), join(home, '.fonts')];
}

/**
 * The families in `families` with no font file under any of `dirs`, matched
 * by file name with spaces and case ignored ("JetBrains Mono" finds
 * JetBrainsMono-Regular.ttf). A file-name match is a heuristic, not a font
 * parser, and it is enough for what this answers: whether Word will find the
 * face a `.docx` names or draw a substitute. A PDF never asks — it carries its
 * faces inside it.
 */
export function missingSystemFonts(families: string[], dirs: string[]): string[] {
  const names: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name), depth + 1);
      else if (/\.(ttf|otf|ttc)$/i.test(e.name)) names.push(e.name.toLowerCase().replace(/[\s_-]/g, ''));
    }
  };
  for (const d of dirs) walk(d, 0);
  return families.filter((f) => {
    const key = f.toLowerCase().replace(/[\s_-]/g, '');
    return !names.some((n) => n.startsWith(key));
  });
}

/**
 * Says what is missing and the command that fixes it. A diagnostic that only
 * reports "not ready" makes the user guess; this one does not.
 */
export async function runDoctor(io: { log: (s: string) => void }): Promise<number> {
  const checks: Check[] = [];

  const [major] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'Node',
    ok: (major ?? 0) >= 22,
    detail: `v${process.versions.node}`,
    fix: 'install Node 22 or newer',
  });

  try {
    const browser = await chromium.launch();
    checks.push({ name: 'Chromium', ok: true, detail: browser.version() });
    await browser.close();
  } catch (e) {
    checks.push({
      name: 'Chromium',
      ok: false,
      detail: (e as Error).message.split('\n')[0] ?? 'failed to launch',
      fix: 'documentor setup',
    });
  }

  try {
    const css = await arimoFaceCss();
    const faces = css.match(/@font-face/g)?.length ?? 0;
    checks.push({ name: 'Font', ok: faces === 6, detail: `${faces} Arimo faces inlined`, fix: 'npm install' });
  } catch (e) {
    checks.push({ name: 'Font', ok: false, detail: (e as Error).message, fix: 'npm install' });
  }

  // Every bundled theme, not just the default. A theme is a file that ships in
  // the package and can therefore arrive damaged — truncated in transit, or
  // missing the logo it names, which fails every render that uses it. Checking
  // only `plain` would report Ready on an installation whose brand theme is
  // unusable, and the brand theme is the one most people were handed this for.
  for (const id of bundledThemeIds()) {
    try {
      const theme = await loadTheme(id);
      checks.push({ name: `Theme ${id}`, ok: true, detail: `${theme.name} (${theme.page.size})` });
    } catch (e) {
      checks.push({
        name: `Theme ${id}`,
        ok: false,
        detail: (e as Error).message,
        fix: 'reinstall the package',
      });
    }
  }

  // The faces the bundled themes name for Word. Word draws a .docx with the
  // fonts installed on the machine that opens it, so a missing one is not a
  // build failure but a Word file that looks different from its PDF.
  const wordFaces = new Map<string, string[]>();
  for (const id of bundledThemeIds()) {
    try {
      const { font } = await loadTheme(id);
      for (const f of [font.document, font.heading.document, font.label?.document]) {
        if (f) wordFaces.set(f, [...(wordFaces.get(f) ?? []), id]);
      }
    } catch { /* reported above */ }
  }
  const missing = missingSystemFonts([...wordFaces.keys()], systemFontDirs());
  checks.push(missing.length === 0
    ? { name: 'Word fonts', ok: true, detail: [...wordFaces.keys()].join(', ') }
    : {
        name: 'Word fonts',
        ok: false,
        advisory: true,
        detail: `${missing.join(', ')} not installed — Word shows a substitute in .docx files from ${
          [...new Set(missing.flatMap((f) => wordFaces.get(f) ?? []))].join(', ')}; PDFs are unaffected`,
        fix: `install ${missing.join(' and ')} (free on fonts.google.com) where the Word files are opened`,
      });

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    io.log(`${c.ok ? 'ok  ' : c.advisory ? 'note' : 'MISS'}  ${c.name.padEnd(width)}  ${c.detail}`);
    if (!c.ok && c.fix) io.log(`      ${' '.repeat(width)}  fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => !c.ok && !c.advisory).length;
  io.log(failed === 0 ? '\nReady.' : `\n${failed} check(s) need attention.`);
  return failed === 0 ? 0 : 1;
}
