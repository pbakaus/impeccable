/**
 * Call recorder used by the loader hooks. Writes one JSON line per unique
 * (args) call to $IMPECCABLE_VECTORS_DIR/<module>/<fn>.jsonl when both the
 * arguments and the return value are plain data. Anything holding DOM-ish
 * objects, functions, or class instances other than Map/Set is skipped and
 * counted in _skipped.json so the porter knows which functions need
 * adapter-level (end-to-end) coverage instead.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.IMPECCABLE_VECTORS_DIR;
const seen = new Map(); // key -> Set of arg hashes
const skipped = new Map();
const streams = new Map();

class NotPlain extends Error {}

function encode(value, depth = 0) {
  if (depth > 12) throw new NotPlain('depth');
  if (value === undefined) return { $undef: true };
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') {
    if (Number.isNaN(value)) return { $nan: true };
    if (value === Infinity) return { $inf: 1 };
    if (value === -Infinity) return { $inf: -1 };
    if (Object.is(value, -0)) return { $negzero: true };
    return value;
  }
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'bigint') return { $bigint: value.toString() };
  if (t === 'function' || t === 'symbol') throw new NotPlain(t);
  if (Array.isArray(value)) return value.map(v => encode(v, depth + 1));
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [encode(k, depth + 1), encode(v, depth + 1)]) };
  if (value instanceof Set) return { $set: [...value].map(v => encode(v, depth + 1)) };
  if (value instanceof RegExp) throw new NotPlain('regexp');
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new NotPlain('instance:' + (value.constructor?.name || '?'));
    if ('nodeType' in value || 'getComputedStyle' in value) throw new NotPlain('dom');
    const out = {};
    for (const k of Object.keys(value)) out[k] = encode(value[k], depth + 1);
    return out;
  }
  throw new NotPlain(t);
}

function stream(mod, fn) {
  const key = mod + '/' + fn;
  let s = streams.get(key);
  if (!s) {
    const dir = path.join(OUT, mod);
    fs.mkdirSync(dir, { recursive: true });
    s = fs.openSync(path.join(dir, fn + '.jsonl'), 'a');
    streams.set(key, s);
  }
  return s;
}

function bump(mod, fn, reason) {
  const key = mod + '/' + fn;
  const m = skipped.get(key) || {};
  m[reason] = (m[reason] || 0) + 1;
  skipped.set(key, m);
}

export function __wrap(mod, fn, value) {
  if (typeof value !== 'function' || !OUT) return value;
  if (/^class\b/.test(Function.prototype.toString.call(value))) return value;
  const wrapped = function (...args) {
    const result = value.apply(this, args);
    if (result && typeof result.then === 'function') return result;
    try {
      const encArgs = encode(args);
      const encRes = encode(result);
      const line = JSON.stringify({ args: encArgs, result: encRes });
      const key = mod + '/' + fn;
      let set = seen.get(key);
      if (!set) { set = new Set(); seen.set(key, set); }
      const h = JSON.stringify(encArgs);
      if (!set.has(h) && set.size < 5000) {
        set.add(h);
        fs.writeSync(stream(mod, fn), line + '\n');
      }
    } catch (e) {
      bump(mod, fn, e instanceof NotPlain ? e.message : 'error');
    }
    return result;
  };
  Object.defineProperty(wrapped, 'name', { value: fn });
  Object.defineProperty(wrapped, 'length', { value: value.length });
  return wrapped;
}

process.on('exit', () => {
  if (!OUT) return;
  const p = path.join(OUT, '_skipped.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* fresh */ }
  for (const [k, v] of skipped) {
    prev[k] = prev[k] || {};
    for (const [r, n] of Object.entries(v)) prev[k][r] = (prev[k][r] || 0) + n;
  }
  fs.writeFileSync(p, JSON.stringify(prev, null, 2) + '\n');
});
