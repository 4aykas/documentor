import { describe, expect, it } from 'vitest';
import { applyMatrix, readPageGeometry } from '../../src/ingest/pdf/geometry.js';

// pdfjs op codes, from pdfjs-dist@4.10.38's OPS table. Hardcoded rather than
// imported so the test states what shape it is feeding in.
const OPS = {
  save: 10, restore: 11, transform: 12, constructPath: 91,
  moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
};

describe('applyMatrix', () => {
  it('maps a path coordinate into page space, y-flip included', () => {
    // The P&L's own page-one CTM, read off the file.
    const m = [0.24, 0, 0, -0.24, 0, 850.08];
    expect(applyMatrix(m, 252, 0).x).toBeCloseTo(60.48, 2);
    // 850.08 + (-0.24 * 3509.375) = 7.83. (The brief's draft said 8.83; that
    // number is arithmetically inconsistent with m and this input for any
    // affine row/column convention, since the matrix's off-diagonal terms
    // are zero here — verified by hand and confirmed a typo, not a bug in
    // applyMatrix itself.)
    expect(applyMatrix(m, 0, 3509.375).y).toBeCloseTo(7.83, 2);
  });
});

describe('readPageGeometry', () => {
  it('returns rectangles in page space and text runs with their size', async () => {
    const page = {
      getOperatorList: async () => ({
        fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore],
        argsArray: [
          null,
          [0.5, 0, 0, -0.5, 0, 100],
          // [pathOps, coords, minMax] — the shape pdfjs actually emits.
          [[OPS.rectangle], [10, 20, 40, 30], [10, 20, 50, 50]],
          null,
        ],
      }),
      getTextContent: async () => ({
        items: [{ str: 'Turnover', transform: [12, 0, 0, 12, 60.5, 610], width: 40, height: 12 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    const g = await readPageGeometry(page);
    // x: 10 * 0.5 = 5 … 50 * 0.5 = 25. y flips: 100 - 0.5*20 = 90, 100 - 0.5*50 = 75.
    expect(g.rects).toEqual([{ x0: 5, y0: 75, x1: 25, y1: 90 }]);
    expect(g.runs).toEqual([{ text: 'Turnover', x: 60.5, y: 610, sizePt: 12 }]);
    expect(g.widthPt).toBe(595.5);
    expect(g.rotated).toBe(0);
  });

  it('counts rotated text instead of keeping it, so task 4 can report it', async () => {
    // Sideways text needs a second geometry to read. Keeping it as if it were
    // horizontal would put it in the wrong cell; dropping it without a count
    // would lose it in silence. Counting is the third option.
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({
        items: [{ str: 'sideways', transform: [0, 10, -10, 0, 5, 5], width: 3, height: 10 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    const g = await readPageGeometry(page);
    expect(g.runs).toEqual([]);
    expect(g.rotated).toBe(1);
  });

  it('walks every path operator, so a rectangle after a curve keeps its own coordinates', async () => {
    // The regression this exists for: curveTo2 and curveTo3 consume four
    // coordinates each. A walk that skips them does not lose a curve — nobody
    // wants the curve — it leaves the shared cursor eight short, and the
    // rectangle that follows is then read from the middle of the curve's
    // numbers. Wrong rectangles, no error, and a table silently mis-gridded.
    const before = [
      1, 1, // moveTo
      2, 2, 3, 3, 4, 4, // curveTo
      5, 5, 6, 6, // curveTo2
      7, 7, 8, 8, // curveTo3
      9, 9, // lineTo
      // closePath consumes nothing
    ];
    expect(before).toHaveLength(18);
    const page = {
      getOperatorList: async () => ({
        fnArray: [OPS.constructPath],
        argsArray: [[
          [OPS.moveTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3, OPS.lineTo, OPS.closePath, OPS.rectangle],
          [...before, 10, 20, 40, 30],
          [0, 0, 100, 100],
        ]],
      }),
      getTextContent: async () => ({ items: [] }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    // Identity CTM, so the rectangle arrives exactly as drawn.
    expect((await readPageGeometry(page)).rects).toEqual([{ x0: 10, y0: 20, x1: 50, y1: 50 }]);
  });

  it('refuses a path operator it does not know rather than shifting what follows', async () => {
    const page = {
      getOperatorList: async () => ({
        fnArray: [OPS.constructPath],
        argsArray: [[[99, OPS.rectangle], [1, 2, 10, 20, 40, 30], [0, 0, 100, 100]]],
      }),
      getTextContent: async () => ({ items: [] }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    await expect(readPageGeometry(page)).rejects.toThrow(/unknown PDF path operator 99/);
  });

  it('counts upside-down text, which has no shear term to give it away', async () => {
    // [-size, 0, 0, -size, x, y] is a 180° rotation: b and c are both zero, so
    // a check on those alone files it as ordinary body text and hands the grid
    // a baseline that is really the top of the glyphs.
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({
        items: [{ str: 'flipped', transform: [-12, 0, 0, -12, 5, 5], width: 3, height: 12 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    const g = await readPageGeometry(page);
    expect(g.runs).toEqual([]);
    expect(g.rotated).toBe(1);
  });

  it('drops a run that is only whitespace', async () => {
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({
        items: [{ str: '   ', transform: [10, 0, 0, 10, 1, 2], width: 3, height: 10 }],
      }),
      getViewport: () => ({ width: 595.5, height: 842 }),
    };
    expect((await readPageGeometry(page)).runs).toEqual([]);
  });
});
