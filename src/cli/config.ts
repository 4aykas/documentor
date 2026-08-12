// The one place `build` and `inspect` resolve what a single input's
// configuration actually is — flag, sidecar, and (through the `ingestOpts`
// this hands to `ingest()`) the document's own metadata — so the two
// commands cannot answer the same question differently. See
// docs/superpowers/specs/2026-08-12-sidecar-design.md, "Precedence": an
// explicit flag beats the sidecar; the sidecar beats what the document says
// about itself.
//
// The third rung of that ladder — sidecar over document — is not resolved
// here. It falls out for free: this function only ever decides what to hand
// `ingest()` as `title`/`subtitle`/`date`/`entity`, and `ingest()` already
// prefers a supplied value over whatever the document itself carries (see
// build.ts's own `ingest` and each ingester's `opts.title ?? …`). So the
// value this function computes for "flag ?? sidecar" is exactly the value
// that then outranks the document, with no second comparison needed.
//
// `to` is deliberately *not* validated here against the formats this build
// can actually write — that check lives beside FORMATS in build.ts (see its
// own `checkFormats`), the one place both `build` and `inspect` already run
// a resolved `to` list through, so a sidecar's format cannot slip past a
// check a `--to` flag would have to pass.

import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { loadTheme } from '../theme/resolve.js';
import { readSidecar, sidecarPathFor, type SidecarData } from './sidecar.js';

/** The subset of a command's own parsed flags this function needs for one
 *  input. `undefined` means "not given on the command line" — distinct from
 *  a value a sidecar or a default would also produce, which is exactly the
 *  distinction precedence needs to see. `to` and `plainNames` are optional
 *  because `inspect` has no such flags at all; it still resolves a `theme`
 *  and `ingestOpts` through the same function. */
export type ConfigFlags = {
  configPath?: string;
  noConfig: boolean;
  title?: string;
  date?: string;
  entity?: string;
  theme?: string;
  to?: string[];
  plainNames?: boolean;
};

export type ResolvedConfig = {
  ingestOpts: { title?: string; subtitle?: string; date?: string; entity?: string };
  theme: string;
  to: string[];
  plainNames: boolean;
  /** Set only when a sidecar file was actually found and read — never for
   *  "no sidecar beside this input" or `--no-config`. Both commands print
   *  this, per the design's rule that a sidecar which changed the output
   *  must be named, not silently applied. */
  sidecarPath?: string;
};

export const DEFAULT_THEME = 'plain';
export const DEFAULT_TO: readonly string[] = ['pdf'];

/**
 * Thrown by `resolveConfig` for anything wrong with the sidecar itself —
 * missing `--config` file, a path that is not a file at all, malformed
 * JSON, an unknown key, or (see below) a theme the sidecar names that does
 * not exist. Carries `sidecarPath` — the file that was actually found, even
 * when reading or validating it is what failed — so a caller can still
 * count "this input had a sidecar" for one that was found but rejected,
 * which a summary claiming to count *that* must not miss (see
 * runBuildBatch's own use of this).
 */
export class SidecarResolutionError extends Error {
  readonly sidecarPath: string | undefined;
  constructor(message: string, sidecarPath: string | undefined) {
    super(message);
    this.name = 'SidecarResolutionError';
    this.sidecarPath = sidecarPath;
  }
}

/**
 * Resolves one input's configuration under `--flag > sidecar > document`.
 * `--config <file>` names one sidecar explicitly; otherwise this looks for
 * `<stem>.documentor.json` beside `input` and uses it only if it exists — a
 * missing sidecar is not an error, it is simply "no sidecar for this
 * document". `--no-config` skips discovery (and `--config`, since asking to
 * ignore every sidecar and simultaneously naming one is a contradiction the
 * caller must resolve, not this function).
 *
 * Throws `SidecarResolutionError` (never returns a partial result) when a
 * named `--config` file does not exist or is not a file, when the path
 * found beside the input exists but is not a file (a directory is exactly
 * as unusable as malformed JSON — see sidecar.ts's own module comment on
 * why every other unusable-sidecar case refuses loudly, and this one must
 * too), when the sidecar found is malformed (see sidecar.ts's own
 * `readSidecar`), or when a theme the sidecar names does not exist. The
 * design calls a malformed sidecar a usage error, "since the fix is to
 * correct what the operator wrote", so callers of this function report the
 * message and stop rather than proceeding with a partially-understood file.
 *
 * A theme named by a *flag* is deliberately not validated here: that is
 * pre-existing `--theme` behaviour this slice does not own, and changing
 * it was not asked for. Only a theme the *sidecar* contributed is checked
 * here, because that is the one case the design names outright — "a theme
 * id ... that the sidecar accepts and the CLI rejects cannot exist" — and
 * the failure must say so came from the sidecar, not read as though a flag
 * had been typed.
 */
export async function resolveConfig(input: string, flags: ConfigFlags): Promise<ResolvedConfig> {
  let sidecarPath: string | undefined;
  let data: SidecarData = {};

  if (!flags.noConfig) {
    if (flags.configPath !== undefined) {
      const p = resolvePath(flags.configPath);
      const st = await stat(p).catch(() => undefined);
      if (st === undefined) throw new SidecarResolutionError(`--config file not found: ${p}`, undefined);
      if (!st.isFile()) throw new SidecarResolutionError(`--config path is not a file: ${p}`, undefined);
      sidecarPath = p;
    } else {
      const p = sidecarPathFor(input);
      const st = await stat(p).catch(() => undefined);
      if (st !== undefined) {
        if (!st.isFile()) {
          throw new SidecarResolutionError(
            `sidecar ${p} exists but is not a file (found ${st.isDirectory() ? 'a directory' : 'a special file'}) — a decision recorded there could never be read`,
            p,
          );
        }
        sidecarPath = p;
      }
    }
    if (sidecarPath !== undefined) {
      try {
        data = await readSidecar(sidecarPath);
      } catch (e) {
        throw new SidecarResolutionError((e as Error).message, sidecarPath);
      }
    }
  }

  const title = flags.title ?? data.title;
  const subtitle = data.subtitle; // no CLI flag exists for subtitle at all
  const date = flags.date ?? data.date;
  const entity = flags.entity ?? data.entity;
  const theme = flags.theme ?? data.theme ?? DEFAULT_THEME;

  // Validated here, once, rather than left to whichever `loadTheme` call a
  // caller happens to make afterward — a flag-supplied theme still relies
  // on that later call (unchanged pre-existing behaviour), but a
  // sidecar-supplied one must fail as *this* file's own usage error, with
  // *this* file named, the same way an unknown key or malformed JSON
  // already does, not as an unattributed "theme not found" that reads as
  // though `--theme` were typed.
  if (flags.theme === undefined && data.theme !== undefined) {
    try {
      await loadTheme(theme);
    } catch (e) {
      throw new SidecarResolutionError(`sidecar ${sidecarPath}: ${(e as Error).message}`, sidecarPath);
    }
  }

  return {
    ingestOpts: {
      ...(title === undefined ? {} : { title }),
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(date === undefined ? {} : { date }),
      ...(entity === undefined ? {} : { entity }),
    },
    theme,
    to: flags.to ?? data.to ?? [...DEFAULT_TO],
    plainNames: flags.plainNames ?? data.plainNames ?? false,
    ...(sidecarPath === undefined ? {} : { sidecarPath }),
  };
}
