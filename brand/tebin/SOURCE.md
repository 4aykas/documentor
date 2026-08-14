# Brand snapshot — TEBIN

Copied from the `tebin-style` design system, theme `tebin-classic` v1.0.0, on
2026-08-12. `tebin-classic` is the print theme: it is the one whose `ink` and
`topbar` are the values a document is set in. The web theme `tebin` is a
lighter palette and is not what a printed document should use.

This directory is the only input to `npm run theme:tebin`. It is vendored
rather than fetched so the generator runs offline and so refreshing the brand
is an explicit commit whose diff shows what moved.

`corner-mark.svg`/`corner-mark.png` are the `tebin-classic` theme's
`corner-mark` and `corner-mark@256` assets — the same red glyph that already
appears, unnamed, as the trailing `<g>` in `logo-full.svg`, vendored here on
its own so a cover page can place it independently of the wordmark.

To refresh: replace these files from the same source, run `npm run theme:tebin`,
and commit the snapshot and the regenerated `themes/tebin/theme.json` together.

Licence: the tokens are MIT. The logo files are © TEBIN, all rights reserved —
see NOTICE at the repository root.
