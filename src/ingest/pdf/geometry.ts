// One coordinate space, and it is the page's. pdfjs hands rectangles out in
// whatever space the current transformation matrix defines and text in page
// space; on a real file those differ by a factor of four and a y-flip
// (`[0.24, 0, 0, -0.24, 0, 850.08]`), so a comparison between the two without
// this module is meaningless. Every downstream unit takes page space for
// granted.

/** pdfjs-dist@4.10.38 op codes. Only the ones this reader acts on. */
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_RECTANGLE = 19;
const OP_MOVE_TO = 13;
const OP_LINE_TO = 14;
const OP_CURVE_TO = 15;
const OP_CONSTRUCT_PATH = 91;

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type TextRun = { text: string; x: number; y: number; sizePt: number };
export type PageGeometry = { rects: Rect[]; runs: TextRun[]; rotated: number; widthPt: number; heightPt: number };

export type PdfPageLike = {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
};

/** `[a, b, c, d, e, f]` applied to a point, PDF's own convention. */
export function applyMatrix(m: readonly number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0]! * x + m[2]! * y + m[4]!, y: m[1]! * x + m[3]! * y + m[5]! };
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!, a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!, a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!, a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ];
}

export async function readPageGeometry(page: PdfPageLike): Promise<PageGeometry> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const rects: Rect[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (const [i, fn] of fnArray.entries()) {
    if (fn === OP_SAVE) { stack.push([...ctm]); continue; }
    if (fn === OP_RESTORE) { ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OP_TRANSFORM) { ctm = multiply(ctm, argsArray[i] as number[]); continue; }
    if (fn !== OP_CONSTRUCT_PATH) continue;
    const [pathOps, coords] = argsArray[i] as [number[], number[]];
    let a = 0;
    for (const op of pathOps) {
      if (op === OP_RECTANGLE) {
        const [x, y, w, h] = [coords[a]!, coords[a + 1]!, coords[a + 2]!, coords[a + 3]!];
        a += 4;
        const p = applyMatrix(ctm, x, y);
        const q = applyMatrix(ctm, x + w, y + h);
        rects.push({
          x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x),
          y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y),
        });
      } else if (op === OP_CURVE_TO) a += 6;
      else if (op === OP_MOVE_TO || op === OP_LINE_TO) a += 2;
    }
  }

  const { items } = await page.getTextContent();
  const runs: TextRun[] = [];
  let rotated = 0;
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[] };
    if (typeof it.str !== 'string' || it.str.trim() === '' || it.transform === undefined) continue;
    const t = it.transform;
    // Unrotated text is [size, 0, 0, size, x, y]. Anything with a shear or a
    // rotation is counted, not kept: reading it would need a second geometry
    // and the caller reports the count rather than losing it in silence.
    if (t[1] !== 0 || t[2] !== 0) { rotated += 1; continue; }
    runs.push({ text: it.str, x: t[4]!, y: t[5]!, sizePt: Math.abs(t[0]!) });
  }
  const vp = page.getViewport({ scale: 1 });
  return { rects, runs, rotated, widthPt: vp.width, heightPt: vp.height };
}
