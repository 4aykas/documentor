import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The files an agent loads: the plugin's skills and the repository's own
// subagents. A skill or agent whose name is not its folder's or file's is
// loaded under one name and looked for under another; a description is what
// decides whether it fires at all, and Claude Code cuts one past 1024
// characters. The plugin ships beside the CLI it drives, so it carries the
// CLI's version: an unchanged version is how an installed plugin learns
// there is nothing new.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function frontmatter(file: string): Record<string, string> {
  const text = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(m, `${file} opens with a --- frontmatter block`).not.toBeNull();
  return Object.fromEntries(m![1]!.split('\n').filter((l) => /^\w[\w-]*:/.test(l)).map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i), l.slice(i + 1).trim()];
  }));
}

const skills = readdirSync(join(ROOT, 'plugin/skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const agents = readdirSync(join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md'));

describe('agent-facing files', () => {
  it.each(skills)('names the %s skill after its folder, with a description that fits', (dir) => {
    const fm = frontmatter(join(ROOT, 'plugin/skills', dir, 'SKILL.md'));
    expect(fm['name']).toBe(dir);
    expect(fm['description']?.length ?? 0).toBeGreaterThanOrEqual(40);
    expect(fm['description']!.length).toBeLessThanOrEqual(1024);
  });

  it.each(agents)('names the %s subagent after its file, with a description and its tools', (file) => {
    const fm = frontmatter(join(ROOT, '.claude/agents', file));
    expect(fm['name']).toBe(basename(file, '.md'));
    expect(fm['description']?.length ?? 0).toBeGreaterThanOrEqual(40);
    expect(fm['tools']).toBeTruthy();
  });

  it('gives the plugin the version of the CLI it ships beside', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const plugin = JSON.parse(readFileSync(join(ROOT, 'plugin/.claude-plugin/plugin.json'), 'utf8')) as { version: string };
    expect(plugin.version).toBe(pkg.version);
  });
});
