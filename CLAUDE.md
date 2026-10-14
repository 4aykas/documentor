# documentor

- **Look at a PDF** with `npm run documentor -- proof <file.pdf>`: every page,
  numbered, on one PNG beside it. Read that PNG; do not rasterise page by page.
- **Checks:** `npm run typecheck` and `npm test`. Pixel baselines are a
  separate, machine-bound instrument: `npm run test:pixels` (see its header).
- **Review rules** live in `CODING_STANDARDS.md`; designed layouts and themes
  are described in README "Designed layouts".
