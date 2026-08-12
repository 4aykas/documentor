import { chromium } from 'playwright-core';
import { arimoFaceCss } from '../render/fonts.js';
import { bundledThemeIds, loadTheme } from '../theme/resolve.js';

type Check = { name: string; ok: boolean; detail: string; fix?: string };

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
      fix: 'npx playwright install chromium',
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

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    io.log(`${c.ok ? 'ok  ' : 'MISS'}  ${c.name.padEnd(width)}  ${c.detail}`);
    if (!c.ok && c.fix) io.log(`      ${' '.repeat(width)}  fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  io.log(failed === 0 ? '\nReady.' : `\n${failed} check(s) need attention.`);
  return failed === 0 ? 0 : 1;
}
