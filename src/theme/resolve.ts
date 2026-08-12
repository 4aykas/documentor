import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_PT, type PageSize, type Theme } from './types.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const PAGE_SIZES = new Set<PageSize>(['A4', 'Letter']);

function bad(where: string, why: string): never {
  throw new Error(`invalid theme at ${where}: ${why}`);
}

function hex(v: unknown, where: string, fallback: string): string {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !HEX.test(v)) {
    bad(where, `expected a six-digit hex colour like #1A1A1A, got ${JSON.stringify(v)}`);
  }
  return v;
}

function num(v: unknown, where: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    bad(where, `expected a positive number, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function resolveTheme(input: unknown, opts: { id?: string } = {}): Theme {
  if (typeof input !== 'object' || input === null) bad('theme', 'expected an object');
  const t = input as Record<string, unknown>;
  const colors = (t['colors'] ?? {}) as Record<string, unknown>;
  const page = (t['page'] ?? {}) as Record<string, unknown>;
  const type = (t['type'] ?? {}) as Record<string, unknown>;
  const font = (t['font'] ?? {}) as Record<string, unknown>;

  const size = (page['size'] ?? 'A4') as PageSize;
  if (!PAGE_SIZES.has(size)) {
    bad('page.size', `expected one of ${[...PAGE_SIZES].join(', ')}, got ${JSON.stringify(size)}`);
  }
  const marginPt = num(page['marginPt'], 'page.marginPt', 48);
  const trim = PAGE_PT[size];
  if (marginPt * 2 >= trim.w - 72) {
    bad('page.marginPt', `${marginPt}pt margins leave no usable column on ${size}`);
  }

  const embed = (font['embed'] ?? 'arimo') as string;
  if (embed !== 'arimo') bad('font.embed', `only 'arimo' is available, got ${JSON.stringify(embed)}`);

  let logo: Theme['logo'] = null;
  const rawLogo = t['logo'];
  if (rawLogo !== undefined && rawLogo !== null) {
    const l = rawLogo as Record<string, unknown>;
    if (typeof l['svg'] !== 'string' || !l['svg'].includes('<svg')) {
      bad('logo.svg', 'expected inline SVG markup');
    }
    if (/\bfill\s*=/.test(l['svg'])) {
      // The theme recolours the logo through CSS custom properties. An inline
      // fill silently wins over that, so the logo would stop following the
      // theme with nothing to show for it.
      bad('logo.svg', 'inline fill attributes are not allowed; paint by class');
    }
    logo = {
      svg: l['svg'],
      heightPt: num(l['heightPt'], 'logo.heightPt', 11),
      ...(typeof l['cornerMarkSvg'] === 'string' ? { cornerMarkSvg: l['cornerMarkSvg'] } : {}),
    };
  }

  const letterhead = Array.isArray(t['letterhead'])
    ? t['letterhead'].map((l, i) => {
        if (typeof l !== 'string') bad(`letterhead[${i}]`, 'expected a string');
        return l;
      })
    : [];

  const brandOnDark = colors['brandOnDark'];
  if (brandOnDark !== undefined && brandOnDark !== null && (typeof brandOnDark !== 'string' || !HEX.test(brandOnDark))) {
    bad('colors.brandOnDark', 'expected a six-digit hex colour or null');
  }

  return {
    id: String(t['id'] ?? opts.id ?? 'unnamed'),
    name: String(t['name'] ?? t['id'] ?? 'Unnamed'),
    colors: {
      brandOnLight: hex(colors['brandOnLight'], 'colors.brandOnLight', '#1A1A1A'),
      brandOnDark: (brandOnDark as string | null | undefined) ?? null,
      ink: hex(colors['ink'], 'colors.ink', '#1A1A1A'),
      muted: hex(colors['muted'], 'colors.muted', '#6B6B6B'),
      rule: hex(colors['rule'], 'colors.rule', '#D8D8D8'),
    },
    font: { document: String(font['document'] ?? 'Arial'), embed: 'arimo' },
    logo,
    page: { size, marginPt },
    type: {
      bodyPt: num(type['bodyPt'], 'type.bodyPt', 10),
      leading: num(type['leading'], 'type.leading', 1.45),
      h1Pt: num(type['h1Pt'], 'type.h1Pt', 18),
      h2Pt: num(type['h2Pt'], 'type.h2Pt', 13),
      h3Pt: num(type['h3Pt'], 'type.h3Pt', 11),
      smallPt: num(type['smallPt'], 'type.smallPt', 8),
    },
    letterhead,
  };
}

/**
 * The package root, so a bare theme id resolves whether run from src or dist.
 * Walks up from this file to the first directory holding both package.json
 * and themes/, rather than counting '..' segments: that count depends on the
 * build's output layout (rootDir, whether dist mirrors src/), which changes
 * independently of this file and would silently break the lookup again.
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'themes'))) {
      return dir;
    }
    const parentDir = dirname(dir);
    if (parentDir === dir) {
      throw new Error(
        `could not locate the documentor package root (looked for package.json + themes/ above ${dirname(fileURLToPath(import.meta.url))})`,
      );
    }
    dir = parentDir;
  }
}

export async function loadTheme(idOrPath: string): Promise<Theme> {
  const looksLikePath = idOrPath.endsWith('.json') || idOrPath.includes('/') || idOrPath.includes(sep);
  const file = looksLikePath ? idOrPath : join(packageRoot(), 'themes', idOrPath, 'theme.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`theme ${JSON.stringify(idOrPath)} not found (looked in ${file})`);
  }
  return resolveTheme(JSON.parse(raw), { id: idOrPath });
}

export type { Theme } from './types.js';
