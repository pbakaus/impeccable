/**
 * One argv parser for the Live benchmark / judging scripts.
 *
 * These scripts had four subtly different hand-rolled parsers, and the gaps
 * failed silently rather than loudly: a parser without the `argv[i + 1]`
 * lookahead turned `--iterations 20` into `iterations: true` and benchmarked
 * the default 5 runs; a parser without kebab→camel mapping turned
 * `--median-target=0.4` into a key nothing read, so the comparison ran against
 * the default threshold. Both produce a clean-looking report of the wrong thing.
 *
 * Supported forms, per flag:
 *   --flag              → true
 *   --flag=value        → 'value'
 *   --flag value        → 'value'   (unless `value` itself starts with `--`)
 *
 * Keys are camel-cased, so `--simulated-tail-ms` and `--simulatedTailMs` both
 * land on `simulatedTailMs`.
 */
export function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    if (!body) continue;
    const equals = body.indexOf('=');
    if (equals !== -1) {
      out[toCamel(body.slice(0, equals))] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[toCamel(body)] = next;
      index += 1;
    } else {
      out[toCamel(body)] = true;
    }
  }
  return out;
}

export function toCamel(value) {
  return String(value).replace(/-([a-z0-9])/gi, (_, char) => char.toUpperCase());
}

/**
 * Read a boolean flag. `--headed` and `--headed=true` must mean the same thing;
 * comparing the raw value against `true` silently ignores the second form.
 */
export function boolFlag(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['', 'true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse a positive integer flag, falling back when absent. Throws on a value
 * that was clearly meant as a number but isn't one, so `--iterations abc`
 * fails instead of quietly benchmarking the default.
 */
export function positiveIntFlag(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== String(value).trim()) {
    throw new Error(`expected a positive integer, got: ${value}`);
  }
  return parsed;
}

/**
 * Resolve a flag that must be one of a fixed set.
 *
 * A silent `x === 'known' ? 'known' : fallback` is the trap this replaces: the
 * private evals Live runner passes `--agent=codex`, which fell through to the
 * canned fake agent and produced a clean-looking report of a deterministic stub
 * labelled as a real harness run. An unrecognized value is a mistake, not a
 * request for the default.
 */
export function resolveEnum(value, allowed, fallback, flagName) {
  if (value === undefined || value === true) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (allowed.includes(normalized)) return normalized;
  throw new Error(`${flagName} must be one of ${allowed.join(', ')}; got: ${value}`);
}
