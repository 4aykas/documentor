import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiagramArgs, runDiagram } from '../../src/cli/diagram.js';

const quiet = () => {
  const out: string[] = [], err: string[] = [];
  return { io: { log: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
};

describe('diagram arguments', () => {
  it('takes a Markdown file and defaults to the plain theme', () => {
    expect(parseDiagramArgs(['a.md'])).toEqual({ input: 'a.md', theme: 'plain' });
  });

  it('reads --out, --png, --theme and --width, and refuses what it does not know', () => {
    expect(parseDiagramArgs(['a.md', '--out', 'a.svg', '--png', 'a.png', '--theme', 'tebin', '--width', '400']))
      .toEqual({ input: 'a.md', out: 'a.svg', png: 'a.png', theme: 'tebin', width: 400 });
    expect(() => parseDiagramArgs(['a.md', '--width', '50'])).toThrow(/--width takes a column width/);
    expect(() => parseDiagramArgs(['a.md', '--column', '400'])).toThrow(/unknown option --column/);
    expect(() => parseDiagramArgs(['a.md', 'b.md'])).toThrow(/unexpected argument/);
  });
});

describe('documentor diagram', () => {
  it('writes the first fence as a standalone SVG beside the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-diagram-'));
    const md = join(dir, 'chart.md');
    await writeFile(md, '# Volumes\n\n```chart\nbar\nunit m³\nDiesel  300\nUrea  40\n```\n');
    const { io, out } = quiet();
    expect(await runDiagram([md, '--width', '400', '--png', join(dir, 'chart.png')], io)).toBe(0);
    const svg = await readFile(join(dir, 'chart.svg'), 'utf8');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg).toContain('300');
    expect(existsSync(join(dir, 'chart.png'))).toBe(true);
    // The paths it wrote; on a machine without Chromium yet, the install's
    // own lines come first (a fresh clone, 2026-10-17).
    expect(out.slice(-2)).toEqual([join(dir, 'chart.svg'), join(dir, 'chart.png')]);
  }, 60_000);

  it('exits 3 and writes nothing when the fence is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-diagram-'));
    const md = join(dir, 'chart.md');
    await writeFile(md, '```chart\nbar\nDiesel  three hundred\n```\n');
    const { io, err } = quiet();
    expect(await runDiagram([md], io)).toBe(3);
    expect(existsSync(join(dir, 'chart.svg'))).toBe(false);
    expect(err.join('\n')).toMatch(/chart/);
  }, 60_000);

  it('exits 2 for a file with no diagram fence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-diagram-'));
    const md = join(dir, 'prose.md');
    await writeFile(md, '# Only prose\n');
    const { io } = quiet();
    expect(await runDiagram([md], io)).toBe(2);
  });
});
