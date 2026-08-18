/**
 * Loader hooks: rewrite the pure engine modules so that every function
 * declaration that the module exports is routed through the recorder, for
 * internal callers as well as importers. See hooks.mjs.
 *
 * Transform: `function X(` at line start becomes `function __orig_X(`, and a
 * `const X = __wrap(mod, 'X', __orig_X);` line is inserted right after the
 * import block, so hoisting keeps every internal reference valid and the
 * module's own `export { X }` exports the wrapped binding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = [
  'cli/engine/shared/color.mjs',
  'cli/engine/shared/fonts.mjs',
  'cli/engine/shared/inline-ignores.mjs',
  'cli/engine/rules/checks.mjs',
  'cli/engine/engines/static-html/css-cascade.mjs',
];

function targetOf(url) {
  if (!url.startsWith('file:')) return null;
  const p = fileURLToPath(url).split(path.sep).join('/');
  return TARGETS.find(t => p.endsWith('/' + t)) || null;
}

function exportedNames(source) {
  const names = new Set();
  const block = /export\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = block.exec(source))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  const direct = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = direct.exec(source))) names.add(m[1]);
  return [...names];
}

export async function load(url, context, nextLoad) {
  const target = targetOf(url);
  if (!target) return nextLoad(url, context);
  let source = fs.readFileSync(fileURLToPath(url), 'utf8');
  const modName = target.replace(/^cli\/engine\//, '').replace(/\.mjs$/, '').replace(/\//g, '.');
  const wrapped = [];
  for (const n of exportedNames(source)) {
    // Only plain function declarations at column 0 (module scope). Async
    // functions are wrapped too; the recorder passes promises through.
    const re = new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${n}\\s*\\(`, 'm');
    if (!re.test(source)) continue;
    source = source.replace(re, (all, exp, asyncKw) => `${asyncKw || ''}function __orig_${n}(`);
    wrapped.push(n);
  }
  if (!wrapped.length) return { format: 'module', shortCircuit: true, source };
  // Insert after the last top-level import statement (imports may span lines).
  const importRe = /^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm;
  let lastEnd = 0, m;
  while ((m = importRe.exec(source))) lastEnd = m.index + m[0].length;
  const inject = [
    `\nimport { __wrap as __impeccableWrap } from ${JSON.stringify(new URL('./recorder.mjs', import.meta.url).href)};`,
    ...wrapped.map(n => `const ${n} = __impeccableWrap(${JSON.stringify(modName)}, ${JSON.stringify(n)}, __orig_${n});`),
    '',
  ].join('\n');
  // Names that were `export function X` need an explicit export now.
  const exportedDirect = wrapped.filter(n => new RegExp(`^export\\s+(async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(fs.readFileSync(fileURLToPath(url), 'utf8')));
  const tail = exportedDirect.length ? `\nexport { ${exportedDirect.join(', ')} };\n` : '';
  source = source.slice(0, lastEnd) + inject + source.slice(lastEnd) + tail;
  return { format: 'module', shortCircuit: true, source };
}
