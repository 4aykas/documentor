# Working on documentor

This page is for someone changing documentor, usually in an IDE with Claude
Code open beside it. README is for using it.

## First hour

```bash
npm ci                                  # Node 22 or later, npm 11
npm run documentor -- setup             # the Chromium the PDFs are printed in, once
npm run documentor -- build README.md --to pdf --theme tebin --out .cache/first-hour
npm run documentor -- proof .cache/first-hour/README.tebin.pdf
```

Open `.cache/first-hour/README.tebin.proof.png`: this README, typeset,
every page on one sheet. If you got that far, everything a change needs
works (`.cache/` is ignored by git). Then run the checks once, so you know
what green looks like:

```bash
npm run typecheck   # src, test and scripts
npm run lint        # promises nobody awaits, switches that miss a case
npm test            # about 1150 tests, a few minutes; Chromium is launched
```

In Claude Code, ask "how do I start?" and it walks you through the same.

## Where things are

| Path | What it holds |
|:--|:--|
| `src/ingest/` | Markdown, Word, Excel and PDF read into one document model |
| `src/ir/` | that model, and its validation |
| `src/render/` | HTML, PDF, Word and Markdown drawn from the model |
| `src/render/diagrams/` | mermaid, chart and axonometric fences; the type registry |
| `src/render/layouts/` | designed layouts; `api.ts` is the kit a theme's own layout gets |
| `src/theme/` | theme resolution; `themes/` holds the built-in themes |
| `src/cli/` | one file per command; `src/bin/documentor.ts` dispatches |
| `templates/` | proposal and contract templates, and `theme-example/` |
| `test/` | the suite; `test/guardrails/` checks the repository itself |
| `docs/adr/` | the decisions, one file each, and why |
| `docs/diagrams/` | the chart and axonometric grammars |

## How a change goes

1. **Read the decision it touches** in `docs/adr/`. A change that makes a new
   decision adds an ADR; one that moves an old one amends it.
2. **Show the guard red.** A test written for a defect must fail without the
   fix: `npm run red -- <file> --find "<fixed text>" --replace "<broken text>"
   -- <vitest args>` puts the defect back, runs the test, and restores.
3. **Look at what you drew.** A rendering change is judged by eye:
   `npm run documentor -- proof <pdf>` for a document,
   `npm run diagrams:proof` for the diagram gallery, and
   `npm run diagrams:hash -- --out before.json` then `-- --compare
   before.json` for a change that must not alter any drawing, and
   `npm run pixels:diff -- before.pdf after.pdf --strip review.png` for one
   that must not alter a document.
4. **Run the three checks**, then commit. CI runs them on Linux, macOS and
   Windows (`.github/workflows/ci.yml`; `gh workflow run ci.yml --ref
   <branch>` runs it on any branch).
5. **Review** reads `CODING_STANDARDS.md`. For the diagram system there is a
   reviewer subagent, `.claude/agents/diagram-reviewer.md`.

## Adding things

- **A theme**: a folder (ADR 0011). Copy `templates/theme-example/`. Only a
  theme meant for everyone goes into `themes/`.
- **A diagram type**: a record in `src/render/diagrams/registry.ts`, a
  section in `test/fixtures/diagram-gallery.md`, a row in README's table;
  ADR 0005 says what the record must carry.
- **A command**: `src/cli/<name>.ts` with `parse<Name>Args` and
  `run<Name>`, a line in `src/bin/documentor.ts`'s usage, a README section;
  `test/guardrails/docs-parity.test.ts` holds the flags to the parser.
