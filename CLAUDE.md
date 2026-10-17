# documentor

- **New here, or asked how to start:** walk the person through
  `CONTRIBUTING.md` "First hour"; it also maps the repository.

- **Look at a PDF** with `npm run documentor -- proof <file.pdf>`: every page,
  numbered, on one PNG beside it. Read that PNG; do not rasterise page by page.
- **Judge a diagram change** with `npm run diagrams:proof [-- themes…]`: the
  gallery (`test/fixtures/diagram-gallery.md`, one section per type in
  `src/render/diagrams/registry.ts`) drawn per theme, a table of each
  diagram's printed label size, and one proof sheet each. A change that must
  not alter any drawing: `npm run diagrams:hash -- --out before.json` first,
  `-- --compare before.json` after. What a drawing holds (warnings, counts,
  groups, computed colours): `npm run diagrams:inspect -- <file.md>`.
- **Show a guard test red** with `npm run red -- <file> --find … --replace …
  -- <vitest args>`.
- **Decisions** are ADRs in `docs/adr/`; read the one a change touches.
- **Checks:** `npm run typecheck` (src, test and scripts), `npm run lint`
  and `npm test`. Pixel baselines are a
  separate, machine-bound instrument: `npm run test:pixels`, then
  `pixels:diff` to look and `pixels:approve` to accept (see its header).
- **Compare two renderings** (PDFs, PNGs, folders of PNGs) with
  `npm run pixels:diff -- <a> <b> [--strip <png>]`.
- **Review rules** live in `CODING_STANDARDS.md`; designed layouts and themes
  are described in README "Designed layouts".
