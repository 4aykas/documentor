import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { launchBrowser, nodeTooOld, resetWordFontNotes, wordFontNote, type BrowserDeps } from '../../src/cli/preflight.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const io = () => {
  const lines: string[] = [];
  return { lines, log: (s: string) => lines.push(s), err: (s: string) => lines.push(s) };
};

describe('the Node check', () => {
  it('accepts the version engines.node promises and newer', () => {
    expect(nodeTooOld('22.0.0')).toBeUndefined();
    expect(nodeTooOld('24.3.1')).toBeUndefined();
  });

  it('names the Node found and the Node needed, and where to get it', () => {
    const msg = nodeTooOld('20.11.0');
    expect(msg).toContain('Node 22 or newer');
    expect(msg).toContain('20.11.0');
    expect(msg).toContain('nodejs.org');
  });
});

describe('the browser preflight', () => {
  // The message playwright-core gives for a browser that was never
  // installed, as seen on a fresh machine.
  const missing = () => new Error("browserType.launch: Executable doesn't exist at C:/x/chrome-headless-shell.exe");
  const fake = { close: async () => {} } as unknown as Browser;
  const deps = (present: boolean, installOk: boolean, installsIt = true): BrowserDeps & { installs: number; launches: number } => {
    let there = present;
    const d = {
      installs: 0,
      launches: 0,
      launch: async () => { d.launches++; if (!there) throw missing(); return fake; },
      install: () => { d.installs++; if (installsIt) there = installOk; return installOk ? 0 : 1; },
    };
    return d;
  };

  it('launches straight away when the browser is there', async () => {
    const d = deps(true, true);
    const o = io();
    expect(await launchBrowser(o, d)).toBe(fake);
    expect(d.installs).toBe(0);
    expect(o.lines).toEqual([]);
  });

  it('installs on first use, saying so before the download, then launches', async () => {
    const d = deps(false, true);
    const o = io();
    expect(await launchBrowser(o, d)).toBe(fake);
    expect(d.installs).toBe(1);
    expect(d.launches).toBe(2);
    expect(o.lines[0]).toMatch(/not installed yet — installing it now/);
  });

  it('names `documentor setup` when the install fails', async () => {
    await expect(launchBrowser(io(), deps(false, false))).rejects.toThrow(/documentor setup/);
  });

  it('does not trust an exit code the second launch contradicts', async () => {
    // The installer said 0 but left nothing behind: still a failure, still
    // named, rather than the raw path message a moment later.
    await expect(launchBrowser(io(), deps(false, true, false))).rejects.toThrow(/did not succeed/);
  });

  it('leaves a browser that is there but will not start to its own error', async () => {
    const d = { launch: async () => { throw new Error('Target page, context or browser has been closed'); }, install: () => 0 };
    await expect(launchBrowser(io(), d)).rejects.toThrow(/has been closed/);
  });
});

describe('the Word font note', () => {
  it('names the faces a theme asks Word for that the machine lacks, once per theme', async () => {
    resetWordFontNotes();
    const theme = await loadTheme('schweiz');
    const dir = await mkdtemp(join(tmpdir(), 'documentor-nofonts-'));
    const first = wordFontNote(theme, [dir]);
    expect(first).toContain('Manrope');
    expect(first).toContain('fonts.google.com');
    expect(first).toContain(theme.id);
    expect(wordFontNote(theme, [dir])).toBeUndefined();
  });

  it('says nothing when every face is installed', async () => {
    resetWordFontNotes();
    const theme = await loadTheme('plain');
    const dir = await mkdtemp(join(tmpdir(), 'documentor-fonts-'));
    for (const f of [theme.font.document, theme.font.heading.document, theme.font.label?.document]) {
      if (f) await writeFile(join(dir, `${f.replace(/\s/g, '')}-Regular.ttf`), '');
    }
    expect(wordFontNote(theme, [dir])).toBeUndefined();
  });
});
