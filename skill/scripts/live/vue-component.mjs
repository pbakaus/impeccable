/**
 * Nuxt/Vue live-mode component previews.
 *
 * Generation writes real Vue SFCs into a generated app-local module tree.
 * Nuxt/Vite compiles those modules without touching the active route; Accept
 * is the only operation that writes the user's .vue source.
 */

import fs from 'node:fs';
import path from 'node:path';

const NUXT_CONFIG_RE = /^nuxt\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

export function detectNuxtVueProject(cwd = process.cwd()) {
  const configFile = fs.readdirSync(cwd, { withFileTypes: true })
    .find((entry) => entry.isFile() && NUXT_CONFIG_RE.test(entry.name))?.name;
  if (!configFile) return null;
  const config = fs.readFileSync(path.join(cwd, configFile), 'utf-8');
  const srcDirMatch = config.match(/\bsrcDir\s*:\s*(['"])([^'"]+)\1/);
  let appDir = fs.existsSync(path.join(cwd, 'app')) ? 'app' : '';
  if (srcDirMatch) {
    const candidate = path.posix.normalize(srcDirMatch[2].replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
    if (candidate !== '..' && !candidate.startsWith('../') && !path.isAbsolute(candidate)) {
      appDir = candidate === '.' ? '' : candidate;
    }
  }
  const componentRoot = [appDir, '.impeccable-live'].filter(Boolean).join('/');
  return { configFile, appDir, componentRoot };
}

export function shouldUseVueComponentInjection(filePath, cwd = process.cwd()) {
  if (/^(0|false|no)$/i.test(process.env.IMPECCABLE_LIVE_VUE_COMPONENT || '')) return false;
  return path.extname(filePath).toLowerCase() === '.vue' && !!detectNuxtVueProject(cwd);
}

export function vueComponentSessionDir(id, cwd = process.cwd()) {
  const project = detectNuxtVueProject(cwd);
  if (!project) throw new Error('Nuxt project not found');
  return path.join(cwd, project.componentRoot, id);
}

export function vueManifestPathForSession(id, cwd = process.cwd()) {
  return path.join(vueComponentSessionDir(id, cwd), 'manifest.json');
}

function ensureVueRuntime(cwd = process.cwd()) {
  const project = detectNuxtVueProject(cwd);
  if (!project) throw new Error('Nuxt project not found');
  const rel = `${project.componentRoot}/__runtime.js`;
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const source = `import { createApp } from 'vue';\n\nexport function mount(Component, options = {}) {\n  const app = createApp(Component, options.props || {});\n  app.mount(options.target);\n  return app;\n}\n\nexport async function unmount(app) {\n  app?.unmount?.();\n}\n`;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf-8') !== source) fs.writeFileSync(file, source, 'utf-8');
  return nuxtViteFsModulePath(file, cwd);
}

/**
 * Nuxt mounts Vite beneath its build-assets base (normally `/_nuxt/`).
 * Keep the manifest path base-agnostic and let the browser prepend the
 * runtime's actual buildAssetsDir. A page-route URL such as
 * `/app/.impeccable-live/x.vue` is handled by Nitro and returns HTML.
 */
export function nuxtViteFsModulePath(file, cwd = process.cwd()) {
  const absolute = path.resolve(cwd, file).split(path.sep).join('/');
  const relative = path.relative(cwd, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Nuxt live module must stay inside the project root');
  }
  return '/@fs/' + absolute.replace(/^\/+/, '');
}

export function extractVueExpressions(markup) {
  const out = [];
  const seen = new Set();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let match;
  while ((match = re.exec(String(markup || '')))) {
    const expr = match[1].trim();
    if (!expr || seen.has(expr)) continue;
    seen.add(expr);
    out.push({ expr, token: match[0] });
  }
  return out;
}

function buildVuePropContract(expressions) {
  return expressions.map(({ expr, token }, index) => ({
    prop: derivePropName(expr, index),
    expr,
    placeholder: token,
    // DOMParser sees Vue interpolation `{{ user.name }}` as text containing
    // the inner `{ user.name }` token; preserve its whitespace for the
    // browser's source-text → rendered-text map.
    previewToken: token.slice(1, -1),
  }));
}

function derivePropName(expr, index) {
  const tail = expr.match(/(?:^|\.|\[)([A-Za-z_$][\w$]*)\s*\]?$/);
  return tail?.[1] || `prop${index}`;
}

function substituteVueExpressions(markup, contract) {
  let out = String(markup || '');
  for (const entry of contract) out = out.split(entry.placeholder).join(`{{ ${entry.prop} }}`);
  return out;
}

function buildVueVariantStub(variant, markup, contract) {
  const props = contract.length > 0
    ? `<script setup>\ndefineProps({\n${contract.map((entry) => `  ${entry.prop}: { default: '' },`).join('\n')}\n});\n</script>\n\n`
    : '';
  return `${props}<template>\n${markup.trim()}\n</template>\n\n<style scoped>\n/* Variant ${variant}: add scoped CSS here */\n</style>\n`;
}

export function scaffoldVueComponentSession({
  id,
  count,
  sourceFile,
  sourceStartLine,
  sourceEndLine,
  originalLines,
  cwd = process.cwd(),
}) {
  const runtimeModule = ensureVueRuntime(cwd);
  const dir = vueComponentSessionDir(id, cwd);
  fs.mkdirSync(dir, { recursive: true });
  const originalMarkup = originalLines.join('\n');
  const propContract = buildVuePropContract(extractVueExpressions(originalMarkup));
  const previewMarkup = substituteVueExpressions(originalMarkup, propContract);
  const manifest = {
    id,
    previewMode: 'vue-component',
    framework: 'vue',
    componentExtension: 'vue',
    sourceFile: sourceFile.split(path.sep).join('/'),
    sourceStartLine,
    sourceEndLine,
    count,
    propContract,
    originalMarkup,
    componentDir: path.relative(cwd, dir).split(path.sep).join('/'),
    componentModuleBase: nuxtViteFsModulePath(dir, cwd),
    runtimeModule,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  for (let variant = 1; variant <= count; variant++) {
    const file = path.join(dir, `v${variant}.vue`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buildVueVariantStub(variant, previewMarkup, propContract), 'utf-8');
  }
  return {
    manifest,
    manifestFile: path.relative(cwd, path.join(dir, 'manifest.json')).split(path.sep).join('/'),
    componentDir: manifest.componentDir,
    propContract,
  };
}

export function findVueComponentManifest(id, cwd = process.cwd()) {
  let direct;
  try { direct = vueManifestPathForSession(id, cwd); } catch { return null; }
  if (!fs.existsSync(direct)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(direct, 'utf-8'));
    return manifest?.id === id && manifest?.previewMode === 'vue-component'
      ? { ...manifest, manifestPath: direct }
      : null;
  } catch {
    return null;
  }
}

function parseVueSfc(source) {
  const text = String(source || '');
  const template = text.match(/<template\b[^>]*>([\s\S]*?)<\/template\s*>/i)?.[1]?.trim() || '';
  const style = text.match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/i)?.[1]?.trim() || '';
  return { template, cssLines: style ? style.split('\n').map((line) => line.trimEnd()) : [] };
}

function restoreVueExpressions(markup, contract) {
  let out = String(markup || '');
  for (const entry of contract || []) {
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(entry.prop)}\\s*\\}\\}`, 'g'), entry.placeholder);
  }
  return out;
}

export function inlineVueComponentAccept(manifest, variantNum, cwd = process.cwd()) {
  const sourcePath = resolveInside(cwd, manifest.sourceFile);
  const componentDir = resolveInside(cwd, manifest.componentDir);
  const variantPath = componentDir && path.join(componentDir, `v${variantNum}.vue`);
  const resultBase = {
    file: manifest.sourceFile,
    sourceFile: manifest.sourceFile,
    previewMode: 'vue-component',
    componentDir: manifest.componentDir,
    carbonize: false,
  };
  if (!sourcePath || !componentDir || !variantPath || !fs.existsSync(sourcePath) || !fs.existsSync(variantPath)) {
    return { handled: false, error: `Variant ${variantNum} not found`, ...resultBase };
  }
  const { template, cssLines } = parseVueSfc(fs.readFileSync(variantPath, 'utf-8'));
  if (!template) return { handled: false, error: 'Accepted Vue variant has no template', ...resultBase };
  if (/\bdata-impeccable-[\w-]*\s*=/.test(template)) {
    return { handled: false, error: 'Accepted Vue variant contains preview-only attributes', ...resultBase };
  }

  const sourceLines = fs.readFileSync(sourcePath, 'utf-8').split('\n');
  const start = Number(manifest.sourceStartLine) - 1;
  const end = Number(manifest.sourceEndLine) - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= sourceLines.length) {
    return { handled: false, error: 'Invalid source line range for ' + manifest.sourceFile, ...resultBase };
  }
  const indent = sourceLines[start].match(/^(\s*)/)?.[1] || '';
  const mergedTemplate = mergeOriginalVueAttrs(template, manifest.originalMarkup || '');
  const markupLines = restoreVueExpressions(mergedTemplate, manifest.propContract)
    .split('\n')
    .map((line) => line.trim() ? indent + line.trimStart() : '');
  let next = [...sourceLines.slice(0, start), ...markupLines, ...sourceLines.slice(end + 1)];
  const meaningfulCss = cssLines.filter((line) => line.trim() && !/^\/\*\s*Variant \d+:/.test(line.trim()));
  if (meaningfulCss.length > 0) next = appendVueStyle(next, meaningfulCss);
  fs.writeFileSync(sourcePath, next.join('\n'), 'utf-8');
  retireVueComponentSession(manifest.id, cwd);
  return { handled: true, ...resultBase };
}

function appendVueStyle(lines, cssLines) {
  let close = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (/<\/style\s*>/.test(lines[index])) { close = index; break; }
  }
  const block = ['', ...cssLines.map((line) => line.trim() ? '  ' + line.trimStart() : '')];
  if (close < 0) return [...lines, '', '<style scoped>', ...block.slice(1), '</style>'];
  return [...lines.slice(0, close), ...block, ...lines.slice(close)];
}

function mergeOriginalVueAttrs(markup, originalMarkup) {
  const variant = matchOpeningTag(markup);
  const original = matchOpeningTag(originalMarkup);
  if (!variant || !original || variant.tag.toLowerCase() !== original.tag.toLowerCase()) return markup;
  const variantAttrs = parseStaticAttrs(variant.attrs);
  const originalAttrs = parseStaticAttrs(original.attrs);
  const additions = [];
  let attrs = variant.attrs;

  const originalClass = originalAttrs.get('class');
  const variantClass = variantAttrs.get('class');
  if (originalClass && variantClass) {
    const classes = [
      ...variantClass.value.split(/\s+/),
      ...originalClass.value.split(/\s+/),
    ].filter(Boolean);
    const replacement = `class=${variantClass.quote}${[...new Set(classes)].join(' ')}${variantClass.quote}`;
    attrs = attrs.slice(0, variantClass.start) + replacement + attrs.slice(variantClass.end);
  } else if (originalClass) {
    additions.push(originalClass.raw);
  }
  for (const [name, attr] of originalAttrs) {
    if (name === 'class' || variantAttrs.has(name)) continue;
    additions.push(attr.raw);
  }
  const open = `<${variant.tag}${attrs}${additions.map((attr) => ' ' + attr.trim()).join('')}${variant.close}`;
  return markup.slice(0, variant.index) + open + markup.slice(variant.index + variant.raw.length);
}

function matchOpeningTag(markup) {
  const match = String(markup || '').match(/<([A-Za-z][\w:-]*)([^>]*?)(\/?>)/);
  return match ? {
    raw: match[0],
    tag: match[1],
    attrs: match[2] || '',
    close: match[3],
    index: match.index || 0,
  } : null;
}

function parseStaticAttrs(attrs) {
  const out = new Map();
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = re.exec(attrs))) {
    out.set(match[1], {
      raw: match[0],
      value: match[3],
      quote: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

export function removeVueComponentSession(id, cwd = process.cwd()) {
  try { fs.rmSync(vueComponentSessionDir(id, cwd), { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Make an accepted/discarded session undiscoverable immediately while keeping
 * Vue modules that Vite has in its graph alive until Live shuts down. Deleting
 * an imported SFC mid-session makes Nuxt's HMR client attempt to reload a
 * missing module and emit a console error. The generated directory remains
 * ignored and removeAllVueComponentSessions removes it on server shutdown.
 */
export function retireVueComponentSession(id, cwd = process.cwd()) {
  let dir;
  try { dir = vueComponentSessionDir(id, cwd); } catch { return; }
  for (const name of ['manifest.json', 'params.json']) {
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* best effort */ }
  }
}

export function removeAllVueComponentSessions(cwd = process.cwd()) {
  const project = detectNuxtVueProject(cwd);
  if (!project) return;
  const root = path.join(cwd, project.componentRoot);
  if (!fs.existsSync(root)) return;
  fs.rmSync(root, { recursive: true, force: true });
}

export function buildVueComponentCssAuthoring(count) {
  return {
    mode: 'vue-component',
    count,
    requirements: [
      'Write each variant as a real Vue SFC in componentDir/vN.vue.',
      'Keep one root element inside <template> and put variant CSS in <style scoped>.',
      'Keep propContract bindings as {{ propName }} instead of snapshot text.',
      'Do not add data-impeccable-* attributes.',
    ],
    forbidden: ['Rewriting sourceFile during preview', 'data-impeccable-* attributes', 'Off-brand replacement content'],
  };
}

function resolveInside(cwd, value) {
  if (!value || path.isAbsolute(value)) return null;
  const full = path.resolve(cwd, value);
  const rel = path.relative(cwd, full);
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : full;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
