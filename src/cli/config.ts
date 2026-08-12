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

import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
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
 * Resolves one input's configuration under `--flag > sidecar > document`.
 * `--config <file>` names one sidecar explicitly; otherwise this looks for
 * `<stem>.documentor.json` beside `input` and uses it only if it exists — a
 * missing sidecar is not an error, it is simply "no sidecar for this
 * document". `--no-config` skips discovery (and `--config`, since asking to
 * ignore every sidecar and simultaneously naming one is a contradiction the
 * caller must resolve, not this function).
 *
 * Throws (never returns a partial result) when a named `--config` file does
 * not exist, or when the sidecar found is malformed — see sidecar.ts's own
 * `readSidecar`. The design calls a malformed sidecar a usage error, "since
 * the fix is to correct what the operator wrote", so callers of this
 * function report the message and stop rather than proceeding with a
 * partially-understood file.
 */
export async function resolveConfig(input: string, flags: ConfigFlags): Promise<ResolvedConfig> {
  let sidecarPath: string | undefined;
  let data: SidecarData = {};

  if (!flags.noConfig) {
    if (flags.configPath !== undefined) {
      const p = resolvePath(flags.configPath);
      const st = await stat(p).catch(() => undefined);
      if (st === undefined || !st.isFile()) throw new Error(`--config file not found: ${p}`);
      sidecarPath = p;
    } else {
      const p = sidecarPathFor(input);
      const st = await stat(p).catch(() => undefined);
      if (st?.isFile()) sidecarPath = p;
    }
    if (sidecarPath !== undefined) data = await readSidecar(sidecarPath);
  }

  const title = flags.title ?? data.title;
  const subtitle = data.subtitle; // no CLI flag exists for subtitle at all
  const date = flags.date ?? data.date;
  const entity = flags.entity ?? data.entity;

  return {
    ingestOpts: {
      ...(title === undefined ? {} : { title }),
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(date === undefined ? {} : { date }),
      ...(entity === undefined ? {} : { entity }),
    },
    theme: flags.theme ?? data.theme ?? DEFAULT_THEME,
    to: flags.to ?? data.to ?? [...DEFAULT_TO],
    plainNames: flags.plainNames ?? data.plainNames ?? false,
    ...(sidecarPath === undefined ? {} : { sidecarPath }),
  };
}
