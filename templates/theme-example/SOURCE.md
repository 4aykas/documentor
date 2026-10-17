# theme-example

The smallest theme folder with one of everything ADR 0011 lets a theme
carry. Copy it, rename the folder (the folder's name is the theme's id), and
build with `--theme <path to the folder>`.

- `fonts/example-mono-400.woff2` is JetBrains Mono, Latin, 400, from
  `@fontsource/jetbrains-mono`, under the SIL Open Font License 1.1. It is
  renamed so a test can tell a theme's own face from the built-in one.
- `logo.svg` is a plain bar that paints by class.
- `layout.mts` is a designed layout reduced to its hooks. The contract it
  is written against is `src/render/layouts/api.ts` in the repository
  (`dist/render/layouts/api.d.ts` in an installed copy).
