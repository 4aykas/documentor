# Coding standards

Read during review, against a diff. Anything a machine can check lives in the
suite or CI instead; these are the calls a reviewer makes by reading.

## Text is carried, never written

documentor re-issues what somebody wrote. Every reviewer question below
comes back to that.

- **A new or changed path from source to page ships with a carry test.** An
  ingester, a renderer, a layout, or a figure that redraws a block (a table
  turned into a diagram) needs a test showing every word of the source reaches
  the output. `test/render/layouts.test.ts` is the shape. Without one, a lost
  table header or a dropped cover line passes every other check — both
  happened while the layouts were written, and only that test caught them.
- **Appearance changes by style, never by rewriting the string.** Case,
  tracking and line breaks belong to CSS. `toUpperCase()` on document text in
  a renderer changes what a copy out of the PDF says. Using it to measure a
  string is fine.
- **Chrome may add text; content may not.** Page numbers, section numbers and
  a running title are the page's own furniture. A label, slogan or button
  caption that the source does not contain is invented content, even when it
  looks like decoration.

## Designs modelled on someone else

- **Their language, not their artwork.** A theme or layout after a company or
  a designer takes colours, faces, proportions and gestures. It takes no
  logo, photograph or illustration of theirs. Marks and pictures are drawn
  for the theme and said so in its `$source.note`.
- **Their vocabulary, not a recoloured template.** A layout "after" someone
  draws what is recognisably theirs. A colour and font swap on the ordinary
  page is a theme, and should be called one.
