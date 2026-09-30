// `documentor theme capture` — read a web page someone likes and write down,
// as evidence, what its typography and colour actually are.
//
// It measures; it does not decide. Which captured face a theme substitutes,
// which colour becomes the brand and which the rule, are judgements a person
// (or Claude, reading the capture and the screenshot) makes when writing the
// theme. A generator that turned "the most frequent colour" into a brand
// colour would be confidently wrong on every page whose most frequent colour
// is black text.
//
// Chromium does the reading because Chromium already prints this project's
// PDFs (see render/pdf.ts): the page is measured with computed styles — what
// the browser actually painted after every stylesheet, variable and media
// query — rather than by parsing CSS, whose declared rules say little about
// which of them ever reached a visible element.
//
// The capture is kept out of git by default (under .input/, see .gitignore):
// it is a record of somebody else's site, including a screenshot of it, and
// this repository is meant to be published. What a theme takes from it —
// colours and sizes, never the site's fonts or artwork — goes into the theme.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

/** One run of visible text, as the page painted it. */
export type TextSample = {
  tag: string;
  /** The first family of the computed font-family list, unquoted. */
  family: string;
  sizePx: number;
  weight: number;
  italic: boolean;
  /** The computed `color`, as the browser serialises it (rgb()/rgba()). */
  color: string;
  /** How many characters of text this element holds directly. */
  chars: number;
};

/** One painted background, as the page painted it. */
export type BackgroundSample = { color: string; areaPx: number };

export type FaceDeclared = { family: string; weight: string; style: string };

export type Capture = {
  url: string;
  /**
   * When the site served the page, from its own HTTP `Date` header — not this
   * machine's clock, which this project never reads (see cli/timestamp.ts).
   * Null when the server sent none.
   */
  capturedAt: string | null;
  viewport: { width: number; height: number };
  /** Faces the page declares through @font-face, whether or not used. */
  declaredFaces: FaceDeclared[];
  fonts: {
    family: string;
    share: number;
    chars: number;
    sizesPx: { px: number; chars: number }[];
    weights: { weight: number; chars: number }[];
  }[];
  textColors: { hex: string; share: number }[];
  backgrounds: { hex: string; share: number }[];
  /** The first h1..h3 on the page, if any: what the site calls a heading. */
  headings: Record<string, { family: string; sizePx: number; weight: number } | undefined>;
  /** The size, family and colour carrying the most text: the site's body. */
  body: { family: string; sizePx: number; color: string } | null;
};

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * `rgb(246, 191, 223)` → `#F6BFDF`. Null for anything fully or mostly
 * transparent: a colour that is barely painted says nothing about the design,
 * and blending it against an assumed white would invent one.
 */
export function toHex(css: string): string | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  const alphaRaw = m[4];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
  if (alpha < 0.5) return null;
  return (
    '#' +
    [m[1], m[2], m[3]]
      .map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v!)))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function tally<K>(entries: Iterable<[K, number]>): Map<K, number> {
  const out = new Map<K, number>();
  for (const [k, n] of entries) out.set(k, (out.get(k) ?? 0) + n);
  return out;
}

const byCount = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

/**
 * Turns what the page painted into shares. Pure, so it is tested without a
 * browser or a network; `capturePage` is only the part that has to look.
 */
export function summarise(
  input: {
    url: string;
    capturedAt: string | null;
    viewport: { width: number; height: number };
    text: TextSample[];
    backgrounds: BackgroundSample[];
    declaredFaces: FaceDeclared[];
  },
): Capture {
  const text = input.text.filter((s) => s.chars > 0);
  const totalChars = text.reduce((n, s) => n + s.chars, 0) || 1;

  const families = byCount(tally(text.map((s) => [s.family, s.chars])));
  const fonts = families.map(([family, chars]) => {
    const own = text.filter((s) => s.family === family);
    return {
      family,
      chars,
      share: round(chars / totalChars),
      sizesPx: byCount(tally(own.map((s) => [round(s.sizePx, 1), s.chars]))).map(([px, n]) => ({ px, chars: n })),
      weights: byCount(tally(own.map((s) => [s.weight, s.chars]))).map(([weight, n]) => ({ weight, chars: n })),
    };
  });

  const colours = byCount(
    tally(text.flatMap((s): [string, number][] => {
      const h = toHex(s.color);
      return h === null ? [] : [[h, s.chars]];
    })),
  );
  const textColors = colours.map(([hex, n]) => ({ hex, share: round(n / totalChars) }));

  const bgs = byCount(
    tally(input.backgrounds.flatMap((b): [string, number][] => {
      const h = toHex(b.color);
      return h === null ? [] : [[h, b.areaPx]];
    })),
  );
  const totalArea = bgs.reduce((n, [, a]) => n + a, 0) || 1;
  const backgrounds = bgs.map(([hex, a]) => ({ hex, share: round(a / totalArea) }));

  const headings: Capture['headings'] = {};
  for (const tag of ['h1', 'h2', 'h3']) {
    const s = text.find((t) => t.tag === tag);
    headings[tag] = s ? { family: s.family, sizePx: s.sizePx, weight: s.weight } : undefined;
  }

  // The body is the single (family, size, colour) combination carrying the
  // most characters — not the most frequent family and, separately, the most
  // frequent size, which on a page set in two faces can pair a size with a
  // face it never appears in.
  const combos = byCount(tally(text.map((s) => [`${s.family}\u0000${round(s.sizePx, 1)}\u0000${s.color}`, s.chars])));
  const top = combos[0]?.[0].split('\u0000');
  const body = top ? { family: top[0]!, sizePx: Number(top[1]), color: toHex(top[2]!) ?? top[2]! } : null;

  return {
    url: input.url,
    capturedAt: input.capturedAt,
    viewport: input.viewport,
    declaredFaces: input.declaredFaces,
    fonts,
    textColors,
    backgrounds,
    headings,
    body,
  };
}

/**
 * Runs inside the page, so it is plain JavaScript source rather than a
 * TypeScript function: this project compiles against Node's library only, and
 * pulling the DOM's types into every file to type-check one snippet would let
 * a stray `document` elsewhere compile. Returns what `summarise` takes.
 */
const MEASURE = `(() => {
  const text = [];
  const backgrounds = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      backgrounds.push({ color: bg, areaPx: Math.round(r.width * r.height) });
    }
    // Only the text this element holds directly: counting descendants too
    // would credit a wrapper's font with every paragraph inside it.
    let chars = 0;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) chars += (n.textContent || '').replace(/\\s+/g, '').length;
    }
    if (chars === 0) continue;
    text.push({
      tag: el.tagName.toLowerCase(),
      family: (cs.fontFamily.split(',')[0] || '').trim().replace(/^["']|["']$/g, ''),
      sizePx: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic',
      color: cs.color,
      chars,
    });
  }
  const declaredFaces = [];
  document.fonts.forEach((f) => {
    declaredFaces.push({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style });
  });
  return { text, backgrounds, declaredFaces };
})()`;

/** Scrolls the page through once, so text a page animates in on scroll is
 *  measured as a reader sees it rather than in its invisible first frame. */
const SETTLE = `(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
  await document.fonts.ready;
})()`;

export type CaptureResult = { capture: Capture; screenshot: Buffer };

/**
 * Loads `url` at a desktop width, lets it settle (see SETTLE), and measures
 * it.
 */
export async function capturePage(
  url: string,
  opts: { browser?: Browser; viewport?: { width: number; height: number } } = {},
): Promise<CaptureResult> {
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const own = opts.browser ?? (await chromium.launch());
  try {
    const page = await own.newPage({ viewport });
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      if (response !== null && !response.ok()) {
        throw new Error(`${url} answered ${response.status()} ${response.statusText()}`);
      }
      const served = response?.headers()['date'];
      const servedAt = served === undefined ? NaN : Date.parse(served);
      await page.evaluate(SETTLE);
      await page.waitForTimeout(500);
      const measured = (await page.evaluate(MEASURE)) as {
        text: TextSample[];
        backgrounds: BackgroundSample[];
        declaredFaces: FaceDeclared[];
      };
      const screenshot = await page.screenshot({ type: 'png' });
      const capture = summarise({
        url,
        capturedAt: Number.isNaN(servedAt) ? null : new Date(servedAt).toISOString(),
        viewport,
        ...measured,
      });
      return { capture, screenshot };
    } finally {
      await page.close();
    }
  } finally {
    if (opts.browser === undefined) await own.close();
  }
}

/** Writes `capture.json` and `screenshot.png` into `dir`, creating it. */
export async function writeCapture(dir: string, result: CaptureResult): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const json = join(dir, 'capture.json');
  const png = join(dir, 'screenshot.png');
  await writeFile(json, JSON.stringify(result.capture, null, 2) + '\n');
  await writeFile(png, result.screenshot);
  return [json, png];
}
