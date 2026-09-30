import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingSystemFonts, systemFontDirs } from '../../src/cli/doctor.js';

describe('the Word fonts check', () => {
  it('finds a family by file name, ignoring spaces, case and nesting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-fonts-'));
    await mkdir(join(dir, 'jetbrains'), { recursive: true });
    await writeFile(join(dir, 'jetbrains', 'JetBrainsMono-Regular.ttf'), '');
    await writeFile(join(dir, 'arial.ttf'), '');
    await writeFile(join(dir, 'Manrope.woff2'), '');
    // A web font file is not an installed font: Word cannot use it.
    expect(missingSystemFonts(['Arial', 'JetBrains Mono', 'Manrope'], [dir])).toEqual(['Manrope']);
  });

  it('treats a folder that does not exist as holding nothing', () => {
    expect(missingSystemFonts(['Arial'], [join(tmpdir(), 'documentor-no-such-dir')])).toEqual(['Arial']);
  });

  it('looks where each platform keeps fonts, the user\'s own folder included', () => {
    const win = systemFontDirs('win32', { WINDIR: 'D:\\Win', LOCALAPPDATA: 'E:\\Local' });
    expect(win).toEqual([join('D:\\Win', 'Fonts'), join('E:\\Local', 'Microsoft', 'Windows', 'Fonts')]);
    expect(systemFontDirs('win32', {})[0]).toBe(join('C:\\Windows', 'Fonts'));
    expect(systemFontDirs('darwin')).toContain('/Library/Fonts');
    expect(systemFontDirs('linux')).toContain('/usr/share/fonts');
  });
});
