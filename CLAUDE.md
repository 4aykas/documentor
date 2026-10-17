# documentor

- **Look at a PDF** with `npm run documentor -- proof <file.pdf>`: every page,
  numbered, on one PNG beside it. Read that PNG; do not rasterise page by page.
- **Judge a diagram change** with `npm run diagrams:proof [-- themes…]`: the
  gallery (`test/fixtures/diagram-gallery.md`, one section per type in
  `src/render/diagrams/registry.ts`) drawn per theme, a table of each
  diagram's printed label size, and one proof sheet each. A change that must
  not alter any drawing: `npm run diagrams:hash -- --out before.json` first,
  `-- --compare before.json` after.
- **Decisions** are ADRs in `docs/adr/`; read the one a change touches.
- **Checks:** `npm run typecheck` and `npm test`. Pixel baselines are a
  separate, machine-bound instrument: `npm run test:pixels` (see its header).
- **Review rules** live in `CODING_STANDARDS.md`; designed layouts and themes
  are described in README "Designed layouts".
