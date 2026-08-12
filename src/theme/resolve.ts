import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_PT, type PageSize, type Theme } from './types.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const PAGE_SIZES = new Set<PageSize>(['A4', 'Letter']);
const PACKAGE_NAME = '@tebin/documentor';
const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Finds inline paint smuggled into a logo SVG in any of the forms it can
 * take: a fill/stroke attribute (fill="none" included — "none" is still an
 * inline decision, not a class), a fill:/stroke: declaration inside a
 * style="..." attribute, or one inside an embedded <style> element. Returns
 * where it was found so the refusal explains itself, since the whole point
 * of refusing is that a silently-ignored theme colour is otherwise invisible.
 */
export function findInlinePaint(svg: string): { where: string; found: string } | null {
  const attr = svg.match(/\b(fill|stroke)\s*=\s*(["'])[^"']*\2/i);
  if (attr) return { where: `a "${attr[1]}" attribute`, found: attr[0] };

  const styleAttr = svg.match(/\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/i);
  if (styleAttr) {
    const decl = (styleAttr[1] ?? styleAttr[2] ?? '').match(/\b(fill|stroke)\s*:/i);
    if (decl) return { where: `"${decl[1]}:" inside a style attribute`, found: decl[0] };
  }

  const styleEl = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleEl) {
    const decl = (styleEl[1] ?? '').match(/\b(fill|stroke)\s*:/i);
    if (decl) return { where: `"${decl[1]}:" inside a <style> element`, found: decl[0] };
  }

  return null;
}

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

  // Validated although nothing reads it: see the comment on Theme['font']
  // ['embed']. Rejecting an unknown value now is what keeps a theme that names
  // a second face from silently printing in the first one later.
  const embed = (font['embed'] ?? 'arimo') as string;
  if (embed !== 'arimo') bad('font.embed', `only 'arimo' is available, got ${JSON.stringify(embed)}`);

  let logo: Theme['logo'] = null;
  const rawLogo = t['logo'];
  if (rawLogo !== undefined && rawLogo !== null) {
    const l = rawLogo as Record<string, unknown>;
    if (typeof l['svg'] !== 'string' || !l['svg'].includes('<svg')) {
      bad('logo.svg', 'expected inline SVG markup');
    }
    // A logo paints by class only: every colour comes from the host
    // stylesheet's custom properties, and a path that should not be filled
    // gets a class whose rule sets fill: none, not an inline attribute. An
    // inline fill or stroke — attribute, style="", or embedded <style> —
    // silently wins over the class, so the logo would stop following the
    // theme with nothing visible to explain why.
    const paint = findInlinePaint(l['svg']);
    if (paint) {
      bad('logo.svg', `inline paint is not allowed; found ${paint.where} (${JSON.stringify(paint.found)}) — paint by class instead`);
    }
    const rawPng = l['png'];
    if (rawPng !== undefined && rawPng !== null && (typeof rawPng !== 'string' || !PNG_DATA_URI.test(rawPng))) {
      bad('logo.png', 'expected an inline "data:image/png;base64,…" URI, or null — a theme is one file, so a path to a raster beside it is not accepted');
    }
    logo = {
      svg: l['svg'],
      heightPt: num(l['heightPt'], 'logo.heightPt', 11),
      png: (rawPng as string | null | undefined) ?? null,
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
 * Walks up from this file to the first ancestor whose package.json declares
 * this package's own name, rather than counting '..' segments: that count
 * depends on the build's output layout (rootDir, whether dist mirrors src/),
 * which changes independently of this file and would silently break the
 * lookup again. Checking the name (not just presence of package.json +
 * themes/) keeps a monorepo root that happens to have both from being
 * mistaken for this package when installed as a dependency.
 */
function packageRoot(): string {
  const startedAt = dirname(fileURLToPath(import.meta.url));
  let dir = startedAt;
  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath) && existsSync(join(dir, 'themes'))) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
        if (pkg.name === PACKAGE_NAME) return dir;
      } catch {
        // Malformed package.json can't be this package's own; keep walking.
      }
    }
    const parentDir = dirname(dir);
    if (parentDir === dir) {
      throw new Error(
        `could not locate the ${PACKAGE_NAME} package root (looked for a package.json named "${PACKAGE_NAME}" alongside a themes/ directory, walking up from ${startedAt})`,
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
