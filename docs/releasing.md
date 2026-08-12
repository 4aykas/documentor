# Handing this to someone else

Where it stands today: the repository is **private** and the package is **not
on npm**. Both of those are decisions for a person, not steps an agent should
take on its own — publishing is outward-facing and cannot be undone by deleting
anything afterwards. This page is what to do when the decision is made, and how
to check the result before anyone else sees it.

## The two decisions

1. **Make the repository public.** The licence is already MIT and the design
   documents were sanitised for a public repository, so nothing is waiting on
   the code. Until this happens, `npm install github:4aykas/documentor` works
   only for someone who already has access.
2. **Publish to npm** as `@tebin/documentor`. A scoped package is private by
   default, so the first publish needs `--access public` or it lands where
   nobody can install it.

## Before publishing

`prepublishOnly` runs the typecheck and the suite, so a broken tree cannot be
published by accident. What it cannot check is what the tarball *contains* —
run the smoke test below for that.

```bash
npm pack --dry-run          # what would ship: dist/, themes/, README, LICENSE, NOTICE
npm publish --access public # the first time only; later publishes inherit it
```

## The smoke test that matters

Reading `package.json` does not tell you whether an installed copy works. This
sequence is what caught a package whose `bin` pointed at a file that was not
there:

```bash
npm pack --pack-destination /tmp/pack
cd /tmp/pack && npm init -y && npm install ./tebin-documentor-*.tgz
echo '# Note' > note.md
npx documentor build note.md --to pdf,docx --theme tebin
```

A PDF and a `.docx` beside `note.md` means the package is whole: the binary is
built, the themes shipped, and the font and logo are inside the theme rather
than resolved from the machine that built it.

`test/guardrails/packaging.test.ts` holds the standing half of this — bin
targets, themes, the package name the theme resolver matches on, and the
lifecycle script that builds. It runs in the suite; the tarball test above is
the one a human runs before publishing.

## Versioning

The version is the promise. `0.x` says the interfaces may still move, which is
true — the ingesters' `dropped` vocabulary and the theme file's shape are both
young. Bump the minor for a new capability, the patch for a fix, and say in the
commit what a consumer would notice.
