// The layout kit: everything documentor hands a layout module that lives in
// a theme's folder rather than in this package (ADR 0011). A module there
// imports nothing from documentor at run time; it exports
//
//   export const layoutApi = 1;
//   export default function (kit: LayoutKit): Layout { … }
//
// and takes its helpers from `kit`. Types come by `import type` from this
// file, which is erased when the module runs. The kit is a contract: what it
// hands a layout changes only with LAYOUT_API, and an ADR 0011 amendment.

import { bigNumber, capsClass, gateLines, mm, plain } from './common.js';
import { luminance, mixToWhite, readableOn, sheetOf } from '../tint.js';

export type { Ctx, CoverParts, GateRow, Gates, Kit, Layout, Section } from './common.js';

export const LAYOUT_API = 1;

export const layoutKit = { version: LAYOUT_API, plain, capsClass, gateLines, bigNumber, mm, sheetOf, luminance, mixToWhite, readableOn } as const;

export type LayoutKit = typeof layoutKit;
