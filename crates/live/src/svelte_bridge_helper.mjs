// Embedded helper run by crates/live/src/svelte_bridge.rs under the user
// project's own `node`. It resolves `svelte/compiler` from the app root the
// same way skill/scripts/live/svelte-ast.mjs `loadSvelteCompiler` did
// (createRequire(<appRoot>/package.json)) and answers JSON-lines requests on
// stdin with one JSON line each on stdout:
//   {"op":"parse","source"}   -> {"ok":true,"ast"} | {"ok":false,"message"}
//   {"op":"compile","source"} -> {"ok":true,"warnings":[{start,end}]}
//                              | {"ok":false,"message","line","column"}
// The first line written is the load result: {"ok":true,"version"} or
// {"ok":false}, after which a failed load exits.
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';

const appRoot = process.argv[2] || process.cwd();
let compiler = null;
try {
  const req = createRequire(path.join(appRoot, 'package.json'));
  const mod = req('svelte/compiler');
  if (typeof mod.parse === 'function') {
    const major = parseInt(String(mod.VERSION || '0'), 10);
    if (major >= 5) compiler = { parse: mod.parse, compile: mod.compile, VERSION: mod.VERSION };
  }
} catch {
  compiler = null;
}
if (!compiler) {
  process.stdout.write(JSON.stringify({ ok: false }) + '\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({ ok: true, version: String(compiler.VERSION) }) + '\n');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ ok: false, message: 'bad request' }) + '\n'); return; }
  let out;
  if (req.op === 'parse') {
    try {
      const ast = compiler.parse(String(req.source || ''), { modern: true });
      out = { ok: true, ast };
    } catch (err) {
      out = { ok: false, message: String(err && err.message != null ? err.message : err) };
    }
  } else if (req.op === 'compile') {
    if (typeof compiler.compile !== 'function') {
      out = { ok: false, message: 'compile is not a function' };
    } else {
      try {
        const { warnings } = compiler.compile(String(req.source || ''), { generate: false });
        out = {
          ok: true,
          warnings: (warnings || [])
            .filter((w) => w.code === 'css_unused_selector'
              && Number.isInteger(w.start?.character)
              && Number.isInteger(w.end?.character))
            .map((w) => ({ start: w.start.character, end: w.end.character })),
        };
      } catch (err) {
        out = {
          ok: false,
          message: String(err && err.message != null ? err.message : err),
          line: err?.start?.line ?? null,
          column: err?.start?.column ?? null,
        };
      }
    }
  } else {
    out = { ok: false, message: 'unknown op' };
  }
  process.stdout.write(JSON.stringify(out) + '\n');
});
rl.on('close', () => process.exit(0));
