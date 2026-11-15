/**
 * Locate the impeccable engine binary for tests that drive verbs end to end.
 *
 * Order: $IMPECCABLE_BIN, then skill/scripts/bin/<os>-<arch>/impeccable[.exe]
 * (what `bun run fetch:engine` writes), then target/release/impeccable[.exe]
 * (what `cargo build --release -p impeccable` writes, so a local source build
 * is picked up without any extra step). Returns null when none exists so a
 * suite can skip cleanly instead of failing on a machine without the engine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutProviderKeys } from './dev-keys.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function engineTarget() {
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[os.platform()] || 'unknown';
  const arch = { arm64: 'arm64', x64: 'x64' }[os.arch()] || 'unknown';
  return `${platform}-${arch}`;
}

export function findEngineBinary() {
  const fromEnv = process.env.IMPECCABLE_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const target = engineTarget();
  const exe = target.startsWith('windows-') ? 'impeccable.exe' : 'impeccable';
  const candidates = [
    path.join(REPO_ROOT, 'skill', 'scripts', 'bin', target, exe),
    path.join(REPO_ROOT, 'target', 'release', exe),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export const ENGINE_MISSING_MESSAGE =
  'engine binary not found: run `cargo build --release -p impeccable` or `bun run fetch:engine`, or set IMPECCABLE_BIN';

/** Environment the launcher would export for the binary when run from this repo's skill dir. */
export function engineEnv(bin, extra = {}) {
  return {
    // Provider keys stay with the harness; a test that needs one passes it in extra.
    ...withoutProviderKeys(process.env),
    IMPECCABLE_SKILL_DIR: path.join(REPO_ROOT, 'skill'),
    IMPECCABLE_SELF: bin,
    ...extra,
    // Any roll API request a test makes is tagged as test traffic. Set last,
    // so neither the shell nor a test's extras can untag it.
    IMPECCABLE_TELEMETRY_CHANNEL: 'test',
  };
}
