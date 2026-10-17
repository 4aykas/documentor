# ADR 0011 — A theme is a folder, built in or anywhere on disk

**Status:** accepted (2026-10-17)

## Context

A theme was one `theme.json` under `themes/`, and everything else it needed
lived in the package: its layout in `src/render/layouts/`, its faces in
`src/render/fonts.ts`, its marks inline in the JSON. So every theme made for
one job (lionfocus, made for one client's report on 2026-10-14) went into the
repository, and into every copy of the package, even when it served nobody
else and was not a TEBIN theme at all. A theme could already be named by a
path to its JSON, but only if the layout and faces it named were the
package's own.

The owner asked (2026-10-17) that a new theme not be committed to the
project by default, that it live beside the documents that use it, and that
it carry whatever it needs: its faces, and anything else a theme needs. A
theme repository that documentor would fetch from was considered and not
taken: a layout is code, and a build that fetched and ran code from a
repository would run whatever was there that day, and need the network that
ADR 0002 keeps diagrams from needing.

## Decision

A theme is a folder. Its name is the theme's id.

```
<id>/
  theme.json      required; its "id", when given, is the folder's name
  layout.mts      optional; a designed layout (also .mjs, .ts, .js)
  fonts/          optional; the face files theme.json declares
  *.svg, *.png    optional; the logo and corner mark, by path
  SOURCE.md       optional; where the design came from, for whom, licences
```

- **Paths inside a theme are relative to its folder and stay inside it**:
  no absolute path, no `..`. A path that leaves the folder is refused.
- **Faces.** `theme.json` may declare its own faces:

  ```json
  "faces": {
    "acme": { "family": "Acme Sans", "license": "OFL-1.1",
              "files": { "400": "fonts/acme-400.woff2", "700": "fonts/acme-700.woff2" },
              "cyrillic": "manrope" }
  }
  ```

  `font.embed`, `font.heading.embed` and `font.label.embed` name a face of
  the theme's own or one built into the package. `license` is required, since
  every PDF embeds the face. `cyrillic` is required too: `true` when the face
  carries Cyrillic, else the built-in face that stands in for it, because a
  Ukrainian word must never fall to whatever the reader's system has (see
  `fonts.ts`). A theme's face may not reuse a built-in face's id. Word gets
  the face's `document` name only, as before; Word embeds no font.
- **Marks.** `logo.svg`, `logo.png`, `cornerMark.svg` and `cornerMark.png`
  may be a path to a file in the folder instead of inline markup or a data
  URI. A file is held to the same rules as inline markup (an SVG paints by
  class only).
- **Layout.** `"layout"` names a built-in layout or a module in the folder
  (`"./layout.mts"`). The module exports `layoutApi = 1` and a default
  function that takes the layout kit (`src/render/layouts/api.ts`) and
  returns a `Layout`. It imports nothing from documentor at run time; types
  come by `import type`, which is erased. A module whose `layoutApi` is not
  the kit's version is refused by name, so a layout written against an older
  kit fails before it draws.
- **Where a theme is found.** `--theme` (and a sidecar's `"theme"`) takes
  either a path or an id.
  - A path (it has a slash, or ends in `.json`) is the folder or its
    `theme.json`. A sidecar's relative path is relative to the sidecar.
  - An id is looked up in the package's `themes/` and then in each folder
    listed in `DOCUMENTOR_THEMES` (separated as `PATH` is). An id found in
    more than one of those places is refused as ambiguous, rather than
    letting one theme silently stand in for another.
- **Built in or not.** A theme is built into the package only when the
  owner asks for it to be ("запакуй", "save it as a theme"). A theme made
  for one job lives in that job's `.raw/themes/`, beside the documents that
  use it. Nothing is fetched: a theme repository, when there is one, is a
  folder on disk named in `DOCUMENTOR_THEMES`.

## Consequences

- A layout module runs with the user's rights, like any script in the
  folder. It runs only when its theme is chosen, and it is never fetched.
- The layout kit is a contract now. Changing what it hands a layout means
  raising `layoutApi` and saying so in an amendment here.
- lionfocus and lionfocus-light move out of the package, into the folder
  of the documents they were made for. Tests that needed a dark sheet use a
  theme in `test/fixtures/themes/` instead. Inter stays built in: it is a
  general face, not lionfocus's.
- Which built-in themes stay built in (rams, rodchenko, haskoning,
  dreamscape, blueprint, schweiz) is decided separately, with naming.
