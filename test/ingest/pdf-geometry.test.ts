import { describe, expect, it } from 'vitest';
import { applyMatrix, readPageGeometry } from '../../src/ingest/pdf/geometry.js';

// pdfjs op codes, from pdfjs-dist@4.10.38's OPS table. Hardcoded rather than
// imported so the test states what shape it is feeding in.
const OPS = { save: 10, restore: 11, transform: 12, rectangle: 19, constructPath: 91 };

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
