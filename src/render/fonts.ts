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
import type { FaceFile, FaceId, ResolvedFace, Theme } from '../theme/types.js';

const require = createRequire(import.meta.url);

const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;

/**
 * What each embeddable face is called in CSS, which package ships it, and
 * which weights are inlined. Only the weights a theme can ask for are
 * inlined: every one is a base64 blob in every PDF's stylesheet.
 */
export type Face = {
  family: string;
  pkg: string;
  weights: readonly number[];
  /** The subsets the package ships; every one of SUBSETS unless listed. */
  subsets?: readonly (typeof SUBSETS)[number][];
  /**
   * A face with no Cyrillic of its own names the face that stands in for
   * it: that face's Cyrillic ranges are inlined beside this one and follow it
   * in the family stack, so a Ukrainian word falls to a chosen face, not to
   * whatever the system has. The stand-in must carry Cyrillic itself.
   */
  cyrillicFrom?: FaceId;
};

export const FACES: Record<FaceId, Face> = {
  arimo: { family: 'Arimo', pkg: '@fontsource/arimo', weights: [400, 700] },
  manrope: { family: 'Manrope', pkg: '@fontsource/manrope', weights: [400, 700, 800] },
  'jetbrains-mono': { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', weights: [400, 700] },
  // Google's Urbanist ships Latin only; Manrope, the nearest geometric face
  // here, takes its Cyrillic.
  urbanist: { family: 'Urbanist', pkg: '@fontsource/urbanist', weights: [400, 700], subsets: ['latin', 'latin-ext'], cyrillicFrom: 'manrope' },
  // The heavy condensed grotesque the constructivist layout builds with.
  'roboto-condensed': { family: 'Roboto Condensed', pkg: '@fontsource/roboto-condensed', weights: [400, 700, 900] },
  // A screen-pixel display face, for display titles.
  'pixelify-sans': { family: 'Pixelify Sans', pkg: '@fontsource/pixelify-sans', weights: [400, 700] },
  // A neutral grotesque, for a body face that should not be noticed.
  inter: { family: 'Inter', pkg: '@fontsource/inter', weights: [400, 600, 700] },
};

export const FACE_IDS = Object.keys(FACES) as FaceId[];

const builtIn = new Map<FaceId, ResolvedFace>();

/** A built-in face, its files found in the package that ships it. */
export function builtInFace(id: FaceId): ResolvedFace {
  const hit = builtIn.get(id);
  if (hit !== undefined) return hit;
  const { family, pkg, weights, subsets = SUBSETS, cyrillicFrom } = FACES[id];
  // unicode.json ships with the package and is the authority on the ranges;
  // hard-coding them here would rot the day the package re-subsets.
  const ranges = require(`${pkg}/unicode.json`) as Record<string, string>;
  const filesDir = require.resolve(`${pkg}/unicode.json`).replace(/unicode\.json$/, 'files');
  const files: FaceFile[] = [];
  for (const subset of subsets) {
    const range = ranges[subset];
    if (!range) throw new Error(`${pkg} declares no unicode-range for ${subset}`);
    for (const weight of weights) files.push({ weight, file: `${filesDir}/${id}-${subset}-${weight}-normal.woff2`, range });
  }
  const face: ResolvedFace = { id, family, weights, files, standIn: cyrillicFrom === undefined ? null : builtInFace(cyrillicFrom) };
  builtIn.set(id, face);
  return face;
}

const FORMAT: Record<string, { mime: string; format: string }> = {
  woff2: { mime: 'font/woff2', format: 'woff2' },
  woff: { mime: 'font/woff', format: 'woff' },
  ttf: { mime: 'font/ttf', format: 'truetype' },
  otf: { mime: 'font/otf', format: 'opentype' },
};
export const FACE_FILE_EXTENSIONS = Object.keys(FORMAT);

const cssFamily = (family: string) => (family.includes(' ') ? `'${family}'` : family);

// Keyed by file, not by face id: two theme folders may each call a face of
// their own "brand".
const cached = new Map<string, string>();

async function fileCss(family: string, f: FaceFile): Promise<string> {
  const key = `${family}\n${f.file}`;
  const hit = cached.get(key);
  if (hit !== undefined) return hit;
  const { mime, format } = FORMAT[f.file.slice(f.file.lastIndexOf('.') + 1).toLowerCase()]!;
  const b64 = (await readFile(f.file)).toString('base64');
  const css = `@font-face{font-family:${cssFamily(family)};font-style:normal;font-weight:${f.weight};font-display:block;` +
    `src:url(data:${mime};base64,${b64}) format('${format}')${f.range === undefined ? '' : `;unicode-range:${f.range}`}}`;
  cached.set(key, css);
  return css;
}

async function oneFaceCss(face: ResolvedFace): Promise<string> {
  return (await Promise.all(face.files.map((f) => fileCss(face.family, f)))).join('');
}

export async function arimoFaceCss(): Promise<string> {
  return oneFaceCss(builtInFace('arimo'));
}

/** Every face a theme uses, each once, body first. */
export async function themeFaceCss(theme: Theme): Promise<string> {
  const faces = new Map<string, ResolvedFace>();
  const add = (f: ResolvedFace) => { if (!faces.has(f.id)) faces.set(f.id, f); };
  add(theme.font.face);
  add(theme.font.heading.face);
  if (theme.font.label !== null) add(theme.font.label.face);
  // A face's Cyrillic stand-in is inlined with it, so the stack below always
  // finds the face it names.
  for (const f of [...faces.values()]) if (f.standIn !== null) add(f.standIn);
  return (await Promise.all([...faces.values()].map(oneFaceCss))).join('');
}

/** A CSS font-family value: the embedded face, its Cyrillic stand-in when it
 *  has one, then the theme's document name as the fallback a reader's
 *  system might have. */
export function familyStack(slot: { face: ResolvedFace; document: string }, generic = 'sans-serif'): string {
  const standIn = slot.face.standIn === null ? '' : `${cssFamily(slot.face.standIn.family)}, `;
  return `${cssFamily(slot.face.family)}, ${standIn}${slot.document}, ${generic}`;
}
