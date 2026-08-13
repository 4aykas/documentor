/**
 * `pdf-to-img` (used by rasterPages) bundles its own pdfjs-dist@4.2.67,
 * pinned independently of this project's pdfjs-dist@4.10.38 (used by
 * pdfText and below) — npm cannot dedupe across the version conflict, so
 * both copies load into the same process. In Node, pdfjs-dist has no real
 * worker thread; it falls back to a "fake worker" and caches its message
 * handler on `globalThis.pdfjsWorker`, keyed by nothing but insertion
 * order. Whichever copy resolves first wins that global permanently, so the
 * next *different* copy to run finds a handler tagged with the wrong
 * version and throws instead of loading its own. Clearing the slot right
 * before a copy's first use in a file lets it load fresh; after that,
 * pdfjs-dist memoizes the resolution per module, so later calls to the same
 * copy are unaffected by this reset.
 */
export function resetPdfjsWorkerGlobal(): void {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}
