// Layout modules from theme folders (ADR 0011), imported once by loadTheme
// and found again by the absolute path the resolved theme carries.

import { pathToFileURL } from 'node:url';
import { LAYOUT_API, layoutKit } from './api.js';
import type { Layout } from './common.js';

const loaded = new Map<string, Layout>();

const HOOKS: readonly (keyof Layout)[] = ['css', 'cover', 'masthead', 'section', 'gates', 'end', 'footer'];

export async function loadLayoutModule(file: string): Promise<Layout> {
  const hit = loaded.get(file);
  if (hit !== undefined) return hit;
  let mod: { layoutApi?: unknown; default?: unknown };
  try {
    mod = await import(pathToFileURL(file).href) as typeof mod;
  } catch (e) {
    const code = (e as { code?: string }).code;
    const why = code === 'ERR_UNKNOWN_FILE_EXTENSION'
      ? 'this Node cannot run TypeScript; use Node 22.18 or later, or write the layout as .mjs'
      : (e as Error).message;
    throw new Error(`layout ${file} could not be loaded: ${why}`);
  }
  if (mod.layoutApi !== LAYOUT_API) {
    throw new Error(`layout ${file} is written for layout kit ${JSON.stringify(mod.layoutApi ?? null)}, and this documentor hands kit ${LAYOUT_API}: export const layoutApi = ${LAYOUT_API}, after checking the layout against src/render/layouts/api.ts`);
  }
  if (typeof mod.default !== 'function') throw new Error(`layout ${file} has no default export: export default function (kit) { return { css, cover, … } }`);
  const layout = (mod.default as (kit: typeof layoutKit) => Layout)(layoutKit);
  const missing = HOOKS.filter((h) => typeof (layout as unknown as Record<string, unknown> | null)?.[h] !== 'function');
  if (missing.length > 0) throw new Error(`layout ${file} returns no ${missing.join(', ')}`);
  loaded.set(file, layout);
  return layout;
}

/** A layout module loadTheme has imported, or undefined. */
export const externalLayout = (file: string): Layout | undefined => loaded.get(file);
