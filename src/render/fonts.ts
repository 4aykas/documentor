// The font is inlined, never fetched. A renderer that must reach for a resource
// will one day fail to get it, silently substitute a system face, and re-wrap
// the whole document — a defect only a human opening the PDF ever sees.
//
// Arimo rather than Arial: the brand's document face is Arial, which exists on
// Windows and macOS and not on Linux or CI. Arimo is metrically identical, so
// the line breaks match, and it is Apache-2.0, so it can ship in a public repo.
//
// The other faces exist for themes modelled on a design somebody liked (see
// theme/capture.ts): that design's own faces are nearly always commercial, so
// a theme names a free face that reads the same way instead. Every face here
// is OFL, comes from @fontsource, and must carry Cyrillic — a document this
// project prints is as often Ukrainian as English, and a face without Cyrillic
// would silently fall back to a system font for every Ukrainian word.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { FaceId, Theme } from '../theme/types.js';

const require = createRequire(import.meta.url);

const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;

/**
 * What each embeddable face is called in CSS, which package ships it, and
 * which weights are inlined. Only the weights a theme can ask for are
 * inlined: every one is a base64 blob in every PDF's stylesheet.
 */
export const FACES: Record<FaceId, { family: string; pkg: string; weights: readonly number[] }> = {
  arimo: { family: 'Arimo', pkg: '@fontsource/arimo', weights: [400, 700] },
  manrope: { family: 'Manrope', pkg: '@fontsource/manrope', weights: [400, 700, 800] },
  'jetbrains-mono': { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', weights: [400, 700] },
};

export const FACE_IDS = Object.keys(FACES) as FaceId[];

const cached = new Map<FaceId, string>();

async function oneFaceCss(id: FaceId): Promise<string> {
  const hit = cached.get(id);
  if (hit !== undefined) return hit;
  const { family, pkg, weights } = FACES[id];

  // unicode.json ships with the package and is the authority on the ranges;
  // hard-coding them here would rot the day the package re-subsets.
  const ranges = require(`${pkg}/unicode.json`) as Record<string, string>;
  const filesDir = require.resolve(`${pkg}/unicode.json`).replace(/unicode\.json$/, 'files');

  const faces: string[] = [];
  for (const subset of SUBSETS) {
    const range = ranges[subset];
    if (!range) throw new Error(`${pkg} declares no unicode-range for ${subset}`);
    for (const weight of weights) {
      const file = `${filesDir}/${id}-${subset}-${weight}-normal.woff2`;
      const b64 = (await readFile(file)).toString('base64');
      faces.push(
        `@font-face{font-family:${family.includes(' ') ? `'${family}'` : family};font-style:normal;font-weight:${weight};font-display:block;` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`,
      );
    }
  }
  const css = faces.join('');
  cached.set(id, css);
  return css;
}

export async function arimoFaceCss(): Promise<string> {
  return oneFaceCss('arimo');
}

/** Every face a theme uses, each once, body first. */
export async function themeFaceCss(theme: Theme): Promise<string> {
  const ids = new Set<FaceId>([theme.font.embed, theme.font.heading.embed]);
  if (theme.font.label !== null) ids.add(theme.font.label.embed);
  return (await Promise.all([...ids].map(oneFaceCss))).join('');
}

/** A CSS font-family value: the embedded face, then the theme's document
 *  name as the fallback a reader's system might have. */
export function familyStack(face: { embed: FaceId; document: string }, generic = 'sans-serif'): string {
  const css = FACES[face.embed].family;
  return `${css.includes(' ') ? `'${css}'` : css}, ${face.document}, ${generic}`;
}
