/**
 * Provider API keys for local dev and the opt-in provider-backed suites.
 *
 * Keys live in one shared file, ~/.config/impeccable/dev.env (mode 0600), or
 * the file IMPECCABLE_DEV_KEYS names. A real environment variable still wins,
 * so CI keeps passing GitHub secrets through the job env.
 *
 * Keys read from the file are handed to the caller and never written into
 * process.env: every child process inherits process.env as its launch
 * environment, and other processes on the machine can read that. Spawn
 * children with withoutProviderKeys(process.env) so a key that did arrive
 * through the environment (CI) stops at this process too.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Names treated as credentials when building a child's environment. */
export const PROVIDER_KEY_NAME = /(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/;

export function devKeysFile(env = process.env) {
  return env.IMPECCABLE_DEV_KEYS || path.join(os.homedir(), '.config', 'impeccable', 'dev.env');
}

/** Parse `NAME=value` lines: optional `export `, quotes, `#` comments. */
export function parseDevEnv(text) {
  const keys = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    keys.set(match[1], value);
  }
  return keys;
}

const cache = new Map();

/** The file's keys; empty when the file does not exist. Throws on a file others can read. */
export function readDevKeys(file = devKeysFile()) {
  if (cache.has(file)) return cache.get(file);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cache.set(file, new Map());
    return cache.get(file);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${file} must be private to you; run: chmod 600 ${file}`);
  }
  const keys = parseDevEnv(fs.readFileSync(file, 'utf8'));
  cache.set(file, keys);
  return keys;
}

/** A key from the environment, else from the dev keys file, else undefined. */
export function devKey(name, env = process.env) {
  return env[name] || readDevKeys(devKeysFile(env)).get(name) || undefined;
}

/**
 * A plain object holding the environment plus the file's keys, for code that
 * takes an `env` lookup (resolveLlmAgentConfig). Never pass it to a child.
 */
export function devEnvView(env = process.env) {
  const view = { ...env };
  for (const [name, value] of readDevKeys(devKeysFile(env))) {
    if (!view[name] && value) view[name] = value;
  }
  return view;
}

/** A copy of `env` without credential names, for spawning children. */
export function withoutProviderKeys(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !PROVIDER_KEY_NAME.test(name)));
}
