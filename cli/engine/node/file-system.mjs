import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

// Hidden directories are skipped wholesale during recursion (below), which
// covers .git / .next / .nuxt / .svelte-kit / .turbo / .vercel and — the
// issue #303 class — every vendored AI-harness install (.claude, .cursor,
// .codex, .agents, .impeccable, ...) whose bundled detector source would
// otherwise be reported as findings on a root scan. Only the non-hidden
// build/dependency dirs need naming. An explicitly passed hidden target
// still scans: walkDir name-checks children, never the root it's given.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '__pycache__',
]);

// The exceptions to the hidden-dir rule: hidden directories that
// conventionally hold real UI source rather than tooling or vendored code.
// VitePress and VuePress keep custom theme components in
// .vitepress/theme/*.vue / .vuepress/theme/, and Storybook keeps preview
// decorators/styles in .storybook/.
const HIDDEN_SOURCE_DIRS = new Set(['.vitepress', '.vuepress', '.storybook']);

const SCANNABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.jsx', '.tsx', '.js', '.ts',
  '.vue', '.svelte', '.astro', '.blade.php',
]);

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

function hasScannableExtension(filename) {
  const lower = filename.toLowerCase();
  if (SCANNABLE_EXTENSIONS.has(path.extname(lower))) return true;
  for (const ext of SCANNABLE_EXTENSIONS) {
    if (ext.indexOf('.', 1) !== -1 && lower.endsWith(ext)) return true;
  }
  return false;
}

const IMPORT_SPECIFIER_PATTERNS = [
  /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g,
  /@import\s+(?:url\(\s*)?['"]?([^'");\s]+)['"]?\s*\)?/g,
  /@(?:use|forward)\s+['"]([^'"]+)['"]/g,
];

function walkDir(dir, onReadError = null) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (onReadError) onReadError(dir, error);
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && entry.name.startsWith('.') && !HIDDEN_SOURCE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkDir(full, onReadError));
    else if (hasScannableExtension(entry.name)) files.push(full);
  }
  return files;
}


// ---------------------------------------------------------------------------
// Import graph (multi-file awareness)
// ---------------------------------------------------------------------------

function resolveImport(specifier, fromDir, fileSet) {
  if (!/^[./]/.test(specifier)) return null; // skip bare specifiers
  const base = path.resolve(fromDir, specifier);
  if (fileSet.has(base)) return base;
  for (const ext of SCANNABLE_EXTENSIONS) {
    const withExt = base + ext;
    if (fileSet.has(withExt)) return withExt;
  }
  // index file convention
  for (const ext of SCANNABLE_EXTENSIONS) {
    const indexFile = path.join(base, 'index' + ext);
    if (fileSet.has(indexFile)) return indexFile;
  }
  return null;
}

function buildImportGraph(files, onReadError = null) {
  const fileSet = new Set(files);
  const graph = new Map();

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      if (!onReadError) throw error;
      onReadError(file, error);
      continue;
    }
    const dir = path.dirname(file);
    const imports = new Set();

    for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const resolved = resolveImport(match[1], dir, fileSet);
        if (resolved) imports.add(resolved);
      }
    }

    graph.set(file, imports);
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Framework dev server detection
// ---------------------------------------------------------------------------

const FRAMEWORK_CONFIGS = [
  { name: 'Next.js', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /next/i } },
  { name: 'SvelteKit', files: ['svelte.config.js', 'svelte.config.ts'], defaultPort: 5173,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-sveltekit-page', value: null } },
  { name: 'Nuxt', files: ['nuxt.config.js', 'nuxt.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /nuxt/i } },
  { name: 'Vite', files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'], defaultPort: 5173,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { body: /@vite\/client/ } },
  { name: 'Astro', files: ['astro.config.js', 'astro.config.ts', 'astro.config.mjs'], defaultPort: 4321,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { body: /astro/i } },
  { name: 'Angular', files: ['angular.json'], defaultPort: 4200,
    portRe: /"port"\s*:\s*(\d+)/,
    fingerprint: { body: /ng-version/i } },
  { name: 'Remix', files: ['remix.config.js', 'remix.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /remix/i } },
];

function detectFrameworkConfig(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const entrySet = new Set(entries);

  for (const cfg of FRAMEWORK_CONFIGS) {
    const match = cfg.files.find(f => entrySet.has(f));
    if (!match) continue;

    const configPath = path.join(dir, match);
    let port = cfg.defaultPort;
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const portMatch = content.match(cfg.portRe);
      if (portMatch) port = parseInt(portMatch[1], 10);
    } catch { /* use default */ }

    return { name: cfg.name, port, configPath, fingerprint: cfg.fingerprint };
  }
  return null;
}

/**
 * Check if a port is listening and optionally verify it matches the expected framework.
 * Returns { listening: true, matched: true/false } or { listening: false }.
 */
async function isPortListening(port, fingerprint = null) {
  if (!fingerprint) {
    // Simple TCP probe fallback
    const net = await import('node:net');
    return new Promise((resolve) => {
      const sock = net.default.createConnection({ port, host: '127.0.0.1' });
      sock.setTimeout(500);
      sock.on('connect', () => { sock.destroy(); resolve({ listening: true, matched: true }); });
      sock.on('error', () => resolve({ listening: false }));
      sock.on('timeout', () => { sock.destroy(); resolve({ listening: false }); });
    });
  }

  // HTTP probe with fingerprint matching
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);

    // Check header fingerprint
    if (fingerprint.header) {
      const val = res.headers.get(fingerprint.header);
      if (val && (!fingerprint.value || fingerprint.value.test(val))) {
        return { listening: true, matched: true };
      }
    }

    // Check body fingerprint
    if (fingerprint.body) {
      const body = await res.text();
      if (fingerprint.body.test(body)) {
        return { listening: true, matched: true };
      }
    }

    // Port is listening but doesn't match the expected framework
    return { listening: true, matched: false };
  } catch {
    return { listening: false };
  }
}

export {
  SKIP_DIRS,
  SCANNABLE_EXTENSIONS,
  HTML_EXTENSIONS,
  hasScannableExtension,
  walkDir,
  resolveImport,
  buildImportGraph,
  FRAMEWORK_CONFIGS,
  detectFrameworkConfig,
  isPortListening,
};
