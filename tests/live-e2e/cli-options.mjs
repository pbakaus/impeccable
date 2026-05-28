/**
 * Minimal CLI option reader for live-e2e tests. Supports `--name=value` and
 * `--name value` forms. Throws when `--name` appears without a value or
 * another flag is about to be consumed as the value, since the wrong-value
 * failure mode was the main reason this was extracted from the runner.
 */
export function readCliOption(argv, name) {
  const prefix = '--' + name + '=';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === '--' + name) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(
          `--${name} requires a value (received ${next === undefined ? 'no value' : JSON.stringify(next)}). Use --${name}=<value> or --${name} <value>.`,
        );
      }
      return next;
    }
  }
  return undefined;
}
