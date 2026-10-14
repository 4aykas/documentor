# documentor

- **Look at a PDF** with `npm run documentor -- proof <file.pdf>`: every page,
  numbered, on one PNG beside it. Read that PNG; do not rasterise page by page.
- **Judge a diagram change** with `npm run diagrams:proof [-- themes…]`: the
  15-type gallery (`test/fixtures/diagram-gallery.md`) drawn per theme, a
  table of each diagram's printed label size, and one proof sheet each.
- **Checks:** `npm run typecheck` and `npm test`. Pixel baselines are a
  separate, machine-bound instrument: `npm run test:pixels` (see its header).
- **Review rules** live in `CODING_STANDARDS.md`; designed layouts and themes
  are described in README "Designed layouts".
