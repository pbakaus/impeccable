/**
 * Context loader: prints PRODUCT.md (and DESIGN.md if present) as one
 * markdown block on stdout, or exits with empty stdout when no PRODUCT.md
 * is found anywhere. The skill keys off "empty stdout" to branch into the
 * init flow.
 *
 * Path resolution (first match wins):
 *   1. Active project root, if PRODUCT.md or DESIGN.md is there
 *   2. Active project .agents/context/ then docs/
 *   3. Monorepo root context, using the same order, as a per-file fallback
 *   4. $IMPECCABLE_CONTEXT_DIR (absolute or cwd-relative) — power-user
 *      escape hatch, only consulted when defaults are empty
 *   5. Active project root as a "nothing found" default
 *
 * `resolveContextDir()` and `loadContext()` are also exported for the
 * server-side scripts (live.mjs, live-server.mjs) that need the structured
 * shape rather than the markdown block.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTargetOptions } from './lib/target-args.mjs';

const PRODUCT_NAMES = ['PRODUCT.md', 'Product.md', 'product.md'];
const DESIGN_NAMES = ['DESIGN.md', 'Design.md', 'design.md'];
const FALLBACK_DIRS = ['.agents/context', 'docs'];
const MONOREPO_MARKER_FILES = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'];
const MONOREPO_FALLBACK_PROJECT_DIRS = ['apps', 'packages'];
const WORKSPACE_DISCOVERY_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
]);

// ─── Update check ──────────────────────────────────────────────────────────
// Piggyback a lightweight skill-version check on the once-per-session boot.
// When a newer skill ships, append an UPDATE_AVAILABLE directive so the agent
// can offer `npx impeccable update`. Everything here is best-effort and
// silent on failure: a network problem, sandbox, or missing cache must never
// block context output or print an error.

const UPDATE_HOST = (process.env.IMPECCABLE_UPDATE_HOST || 'https://impeccable.style').replace(/\/$/, '');
const UPDATE_CACHE_PATH =
  process.env.IMPECCABLE_UPDATE_CACHE || path.join(os.homedir(), '.impeccable', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // throttle the network poll to once a day
const RENOTIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // don't re-surface the same version for a week
const FETCH_TIMEOUT_MS = 1200;

export function resolveContextDir(cwd = process.cwd(), options = {}) {
  return resolveContext(cwd, options).contextDir;
}

export function loadContext(cwd = process.cwd(), options = {}) {
  const resolved = resolveContext(cwd, options);
  const absCwd = path.resolve(cwd);
  const productPath = resolved.productPath;
  const designPath = resolved.designPath;
  const product = productPath ? safeRead(productPath) : null;
  const design = designPath ? safeRead(designPath) : null;
  return {
    hasProduct: !!product,
    product,
    productPath: productPath ? path.relative(absCwd, productPath) : null,
    hasDesign: !!design,
    design,
    designPath: designPath ? path.relative(absCwd, designPath) : null,
    contextDir: resolved.contextDir,
    productContextDir: productPath ? path.dirname(productPath) : null,
    designContextDir: designPath ? path.dirname(designPath) : null,
    projectRoot: resolved.projectRoot,
    repoRoot: resolved.repoRoot,
    isMonorepo: resolved.isMonorepo,
  };
}

function resolveContext(cwd = process.cwd(), options = {}) {
  const absCwd = path.resolve(cwd);
  const project = resolveProject(absCwd, options);
  const projectContextDir = resolveLocalContextDir(project.projectRoot);
  const rootContextDir = project.isMonorepo && project.repoRoot !== project.projectRoot
    ? resolveLocalContextDir(project.repoRoot)
    : null;

  let productPath =
    (projectContextDir ? firstExisting(projectContextDir, PRODUCT_NAMES) : null)
    || (rootContextDir ? firstExisting(rootContextDir, PRODUCT_NAMES) : null);
  let designPath =
    (projectContextDir ? firstExisting(projectContextDir, DESIGN_NAMES) : null)
    || (rootContextDir ? firstExisting(rootContextDir, DESIGN_NAMES) : null);

  let envContextDir = null;
  if (!productPath && !designPath) {
    envContextDir = resolveEnvContextDir(absCwd);
    if (envContextDir) {
      productPath = firstExisting(envContextDir, PRODUCT_NAMES);
      designPath = firstExisting(envContextDir, DESIGN_NAMES);
    }
  }

  return {
    contextDir: productPath
      ? path.dirname(productPath)
      : designPath
        ? path.dirname(designPath)
        : envContextDir || project.projectRoot,
    productPath,
    designPath,
    projectRoot: project.projectRoot,
    repoRoot: project.repoRoot,
    isMonorepo: project.isMonorepo,
    targetDir: project.targetDir,
  };
}

export function resolveProjectRoot(cwd = process.cwd(), options = {}) {
  return resolveProject(cwd, options).projectRoot;
}

export function resolveTargetSelection(cwd = process.cwd(), options = {}) {
  if (hasTargetOption(options)) return null;
  const project = resolveProject(cwd);
  if (
    !project.isMonorepo
    || !project.projectRoot
    || !project.repoRoot
    || path.resolve(project.projectRoot) !== path.resolve(project.repoRoot)
  ) {
    return null;
  }
  const targetCandidates = discoverTargetCandidates(project.repoRoot);
  // No discoverable child apps (e.g. `workspaces: ["."]`, a root-only workspace,
  // or a marker file with no apps/packages children): there is nothing to choose,
  // so treat the repo root as the active project rather than blocking on an empty
  // selection prompt that the user cannot answer.
  if (targetCandidates.length === 0) return null;
  return {
    targetPath: null,
    projectRoot: project.projectRoot,
    repoRoot: project.repoRoot,
    targetCandidates,
  };
}

function resolveProject(cwd = process.cwd(), options = {}) {
  const absCwd = path.resolve(cwd);
  const targetDir = resolveTargetDir(absCwd, options);
  let repoRoot = findMonorepoRoot(targetDir);
  if (!repoRoot && targetDir !== absCwd) {
    const cwdRepoRoot = findMonorepoRoot(absCwd);
    if (cwdRepoRoot && isPathInside(targetDir, cwdRepoRoot)) {
      repoRoot = cwdRepoRoot;
    }
  }
  if (!repoRoot) {
    return {
      targetDir,
      projectRoot: absCwd,
      repoRoot: absCwd,
      isMonorepo: false,
    };
  }
  return {
    targetDir,
    projectRoot: resolveWorkspaceProjectRoot(repoRoot, targetDir) || repoRoot,
    repoRoot,
    isMonorepo: true,
  };
}

function isPathInside(candidate, root) {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveLocalContextDir(root) {
  if (firstExisting(root, [...PRODUCT_NAMES, ...DESIGN_NAMES])) {
    return root;
  }
  for (const rel of FALLBACK_DIRS) {
    const candidate = path.resolve(root, rel);
    if (firstExisting(candidate, [...PRODUCT_NAMES, ...DESIGN_NAMES])) {
      return candidate;
    }
  }
  return null;
}

function resolveEnvContextDir(cwd) {
  const envDir = process.env.IMPECCABLE_CONTEXT_DIR;
  if (!envDir || !envDir.trim()) return null;
  const trimmed = envDir.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
}

function resolveTargetDir(cwd, options = {}) {
  const targetPath = options && typeof options === 'object' ? options.targetPath : null;
  if (!targetPath || !String(targetPath).trim()) return cwd;
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  try {
    const stat = fs.statSync(abs);
    return stat.isDirectory() ? abs : path.dirname(abs);
  } catch {
    return path.extname(abs) ? path.dirname(abs) : abs;
  }
}

function findMonorepoRoot(startDir) {
  let dir = path.resolve(startDir);
  const homeDir = path.resolve(os.homedir());
  while (true) {
    if (dir === homeDir) return null;
    // isMonorepoRoot is checked before hasGitBoundary on purpose: a workspace
    // root that also carries its own .git is still recognized. The trade-off is
    // deliberate — a directory with a monorepo *marker* but no workspace patterns
    // and no apps/packages children is not a monorepo root, so its .git stops
    // traversal and a further-up root is not searched. The nested .git is treated
    // as an independent project boundary, which is the intended isolation.
    if (isMonorepoRoot(dir)) return dir;
    if (hasGitBoundary(dir)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isMonorepoRoot(dir) {
  if (readWorkspacePatterns(dir).some((pattern) => !normalizeWorkspacePattern(pattern).startsWith('!'))) return true;
  if (!MONOREPO_MARKER_FILES.some((file) => fs.existsSync(path.join(dir, file)))) return false;
  return hasFallbackWorkspaceChildren(dir);
}

function hasGitBoundary(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function hasFallbackWorkspaceChildren(dir) {
  for (const name of MONOREPO_FALLBACK_PROJECT_DIRS) {
    const base = path.join(dir, name);
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isDirectory() && !isIgnoredWorkspaceDiscoveryDir(entry.name))) return true;
  }
  return false;
}

function discoverTargetCandidates(repoRoot) {
  const roots = new Map();
  const patterns = readWorkspacePatterns(repoRoot);
  for (const pattern of patterns) {
    for (const root of discoverRootsForPattern(repoRoot, pattern)) {
      roots.set(path.relative(repoRoot, root).split(path.sep).join('/'), root);
    }
  }
  if (MONOREPO_MARKER_FILES.some((file) => fs.existsSync(path.join(repoRoot, file)))) {
    for (const name of MONOREPO_FALLBACK_PROJECT_DIRS) {
      const base = path.join(repoRoot, name);
      let entries;
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || isIgnoredWorkspaceDiscoveryDir(entry.name)) continue;
        const root = path.join(base, entry.name);
        roots.set(path.relative(repoRoot, root).split(path.sep).join('/'), root);
      }
    }
  }
  return [...roots.entries()]
    .filter(([rel]) => rel && !rel.startsWith('..'))
    // Honor negated workspace patterns (e.g. "!packages/internal"). resolveWorkspaceProjectRoot
    // sends an excluded package back to the repo root, so an excluded folder must not appear as a
    // selectable target — choosing it would silently resolve to the root instead.
    .filter(([rel]) => !isExcludedByWorkspacePattern(rel.split('/').filter(Boolean), patterns))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, root]) => {
      const targetExample = findTargetExample(repoRoot, root);
      return {
        name: path.basename(root),
        path: rel,
        targetExample,
        ...resolveCandidateContextSummary(repoRoot, root, targetExample),
      };
    });
}

function resolveCandidateContextSummary(repoRoot, projectRoot, targetPath) {
  const ctx = resolveContext(repoRoot, { targetPath });
  return {
    productStatus: contextSourceStatus(ctx.productPath, repoRoot, projectRoot),
    productPath: contextSourcePath(ctx.productPath, repoRoot),
    designStatus: contextSourceStatus(ctx.designPath, repoRoot, projectRoot),
    designPath: contextSourcePath(ctx.designPath, repoRoot),
  };
}

// Selection candidates surface one of four statuses: 'child' (a canonical
// PRODUCT.md/DESIGN.md directly in the app root), 'inherited' (resolved from the
// repo root in a monorepo), 'missing' (no file found), and 'fallback'. 'fallback'
// intentionally covers two non-canonical locations: a file inside the project
// root but in a subdirectory (FALLBACK_DIRS, e.g. `.agents/context/`), and a file
// outside both the project and repo roots (IMPECCABLE_CONTEXT_DIR override).
function contextSourceStatus(filePath, repoRoot, projectRoot) {
  if (!filePath) return 'missing';
  const absPath = path.resolve(filePath);
  const absProjectRoot = path.resolve(projectRoot);
  const absRepoRoot = path.resolve(repoRoot);
  if (isPathInsideOrEqual(absPath, absProjectRoot)) {
    return path.dirname(absPath) === absProjectRoot ? 'child' : 'fallback';
  }
  if (absProjectRoot !== absRepoRoot && isPathInsideOrEqual(absPath, absRepoRoot)) {
    return 'inherited';
  }
  return 'fallback';
}

function contextSourcePath(filePath, repoRoot) {
  if (!filePath) return null;
  const rel = path.relative(repoRoot, filePath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return filePath;
}

function discoverRootsForPattern(repoRoot, rawPattern) {
  const pattern = normalizeWorkspacePattern(rawPattern);
  if (!pattern || pattern.startsWith('!')) return [];
  const segments = pattern.split('/').filter(Boolean);
  if (!segments.length) return [];
  const firstGlobIndex = segments.findIndex((segment) => segment.includes('*'));
  const literalPrefix = firstGlobIndex === -1 ? segments : segments.slice(0, firstGlobIndex);
  const base = path.join(repoRoot, ...literalPrefix);
  if (!fs.existsSync(base)) return [];
  if (segments.includes('**')) {
    const packageRoots = [];
    walkDirs(base, (dir) => {
      if (dir !== base && isCandidateProjectRoot(dir)) packageRoots.push(dir);
    });
    if (packageRoots.length) return packageRoots;
    return directChildDirs(base);
  }
  return expandSimplePattern(repoRoot, segments);
}

function expandSimplePattern(repoRoot, patternSegments, index = 0, current = repoRoot) {
  if (index >= patternSegments.length) return fs.existsSync(current) ? [current] : [];
  const segment = patternSegments[index];
  if (!segment.includes('*')) {
    return expandSimplePattern(repoRoot, patternSegments, index + 1, path.join(current, segment));
  }
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return [];
  }
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredWorkspaceDiscoveryDir(entry.name)) continue;
    if (!segmentMatches(segment, entry.name)) continue;
    roots.push(...expandSimplePattern(repoRoot, patternSegments, index + 1, path.join(current, entry.name)));
  }
  return roots;
}

function directChildDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !isIgnoredWorkspaceDiscoveryDir(entry.name))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function walkDirs(root, visit) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredWorkspaceDiscoveryDir(entry.name)) continue;
    const dir = path.join(root, entry.name);
    visit(dir);
    walkDirs(dir, visit);
  }
}

function isCandidateProjectRoot(dir) {
  return !!(
    fs.existsSync(path.join(dir, 'package.json'))
    || firstExisting(dir, [...PRODUCT_NAMES, ...DESIGN_NAMES])
    || fs.existsSync(path.join(dir, 'src'))
    || fs.existsSync(path.join(dir, 'app'))
    || fs.existsSync(path.join(dir, 'pages'))
    || fs.existsSync(path.join(dir, 'public'))
  );
}

function isIgnoredWorkspaceDiscoveryDir(name) {
  return name.startsWith('.') || WORKSPACE_DISCOVERY_IGNORED_DIRS.has(name);
}

function findTargetExample(repoRoot, projectRoot) {
  const examples = [
    'src/App.jsx',
    'src/App.tsx',
    'src/main.jsx',
    'src/main.tsx',
    'src/index.jsx',
    'src/index.ts',
    'app/page.tsx',
    'pages/index.tsx',
    'public/index.html',
  ];
  for (const rel of examples) {
    const abs = path.join(projectRoot, rel);
    if (fs.existsSync(abs)) return path.relative(repoRoot, abs).split(path.sep).join('/');
  }
  return path.relative(repoRoot, projectRoot).split(path.sep).join('/');
}

function resolveWorkspaceProjectRoot(repoRoot, targetDir) {
  const rel = path.relative(repoRoot, targetDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return repoRoot;
  const relSegments = rel.split(path.sep).filter(Boolean);
  const patterns = readWorkspacePatterns(repoRoot);
  const excluded = isExcludedByWorkspacePattern(relSegments, patterns);
  if (!excluded) {
    for (const pattern of patterns) {
      const projectRoot = projectRootFromWorkspacePattern(repoRoot, relSegments, pattern);
      if (projectRoot) return projectRoot;
    }
  }
  if (excluded) return repoRoot;
  if (
    relSegments.length >= 2
    && MONOREPO_FALLBACK_PROJECT_DIRS.includes(relSegments[0])
  ) {
    return path.join(repoRoot, relSegments[0], relSegments[1]);
  }
  const nearest = nearestProjectLikeRoot(repoRoot, targetDir);
  if (nearest) return nearest;
  return repoRoot;
}

function isExcludedByWorkspacePattern(relSegments, patterns) {
  return patterns.some((rawPattern) => {
    const pattern = normalizeWorkspacePattern(rawPattern);
    if (!pattern.startsWith('!')) return false;
    return workspacePatternMatchesRel(pattern.slice(1), relSegments);
  });
}

function nearestProjectLikeRoot(repoRoot, targetDir) {
  let dir = path.resolve(targetDir);
  const stop = path.resolve(repoRoot);
  while (dir && dir !== stop) {
    if (
      firstExisting(dir, [...PRODUCT_NAMES, ...DESIGN_NAMES])
      || fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function nearestPackageRootBetween(repoRoot, targetDir, stopDir) {
  let dir = path.resolve(targetDir);
  const stop = path.resolve(stopDir || repoRoot);
  const root = path.resolve(repoRoot);
  while (dir && dir !== stop && isPathInsideOrEqual(dir, root)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isPathInsideOrEqual(candidate, root) {
  return path.resolve(candidate) === path.resolve(root) || isPathInside(candidate, root);
}

function workspacePatternMatchesRel(pattern, relSegments) {
  const patternSegments = normalizeWorkspacePattern(pattern).split('/').filter(Boolean);
  if (!patternSegments.length) return false;
  if (patternSegments.includes('**')) {
    const firstGlobIndex = patternSegments.findIndex((segment) => segment.includes('*'));
    const literalPrefix = firstGlobIndex === -1
      ? patternSegments
      : patternSegments.slice(0, firstGlobIndex);
    if (relSegments.length < literalPrefix.length + 1) return false;
    for (let i = 0; i < literalPrefix.length; i++) {
      if (!segmentMatches(literalPrefix[i], relSegments[i])) return false;
    }
    return true;
  }
  if (relSegments.length < patternSegments.length) return false;
  for (let i = 0; i < patternSegments.length; i++) {
    if (!segmentMatches(patternSegments[i], relSegments[i])) return false;
  }
  return true;
}

function readWorkspacePatterns(repoRoot) {
  return [
    ...readPackageWorkspaces(repoRoot),
    ...readPnpmWorkspaces(repoRoot),
    ...readLernaWorkspaces(repoRoot),
  ].filter(Boolean);
}

function readPackageWorkspaces(repoRoot) {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const workspaces = pkg?.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  if (Array.isArray(workspaces?.packages)) return workspaces.packages;
  return [];
}

function readLernaWorkspaces(repoRoot) {
  const lerna = readJson(path.join(repoRoot, 'lerna.json'));
  return Array.isArray(lerna?.packages) ? lerna.packages : [];
}

function readPnpmWorkspaces(repoRoot) {
  try {
    const body = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf-8');
    const patterns = [];
    let inPackages = false;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = stripYamlInlineComment(line).trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const flowMatch = trimmed.match(/^packages:\s*\[(.*)\]\s*$/);
      if (flowMatch) {
        patterns.push(...parseYamlFlowList(flowMatch[1]));
        inPackages = false;
        continue;
      }
      if (/^packages:\s*$/.test(trimmed)) {
        inPackages = true;
        continue;
      }
      if (inPackages && /^[A-Za-z0-9_-]+:\s*/.test(trimmed)) break;
      if (inPackages) {
        const match = trimmed.match(/^-\s*(.+)$/);
        if (match) patterns.push(unquoteYamlValue(match[1]));
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

function stripYamlInlineComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== '\\') {
      quote = quote === ch ? null : quote || ch;
      continue;
    }
    if (ch === '#' && !quote) return line.slice(0, i);
  }
  return line;
}

function parseYamlFlowList(body) {
  const items = [];
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if ((ch === '"' || ch === "'") && body[i - 1] !== '\\') {
      quote = quote === ch ? null : quote || ch;
      current += ch;
      continue;
    }
    if (ch === ',' && !quote) {
      const value = unquoteYamlValue(current);
      if (value) items.push(value);
      current = '';
      continue;
    }
    current += ch;
  }
  const value = unquoteYamlValue(current);
  if (value) items.push(value);
  return items;
}

function unquoteYamlValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function projectRootFromWorkspacePattern(repoRoot, relSegments, rawPattern) {
  const pattern = normalizeWorkspacePattern(rawPattern);
  if (!pattern || pattern.startsWith('!')) return null;
  const patternSegments = pattern.split('/').filter(Boolean);
  if (!patternSegments.length) return null;
  if (patternSegments.includes('**')) {
    return projectRootFromDoubleStarPattern(repoRoot, relSegments, patternSegments);
  }
  if (relSegments.length < patternSegments.length) return null;
  for (let i = 0; i < patternSegments.length; i++) {
    if (!segmentMatches(patternSegments[i], relSegments[i])) return null;
  }
  return path.join(repoRoot, ...relSegments.slice(0, patternSegments.length));
}

function projectRootFromDoubleStarPattern(repoRoot, relSegments, patternSegments) {
  const firstGlobIndex = patternSegments.findIndex((segment) => segment.includes('*'));
  const literalPrefix = firstGlobIndex === -1
    ? patternSegments
    : patternSegments.slice(0, firstGlobIndex);
  if (relSegments.length < literalPrefix.length + 1) return null;
  for (let i = 0; i < literalPrefix.length; i++) {
    if (!segmentMatches(literalPrefix[i], relSegments[i])) return null;
  }
  const prefixDir = path.join(repoRoot, ...literalPrefix);
  const targetDir = path.join(repoRoot, ...relSegments);
  const packageRoot = nearestPackageRootBetween(repoRoot, targetDir, prefixDir);
  if (packageRoot) return packageRoot;
  return path.join(repoRoot, ...relSegments.slice(0, literalPrefix.length + 1));
}

function normalizeWorkspacePattern(pattern) {
  return String(pattern || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function segmentMatches(patternSegment, relSegment) {
  if (patternSegment === '*') return true;
  if (!patternSegment.includes('*')) return patternSegment === relSegment;
  const re = new RegExp(`^${escapeRegExp(patternSegment).replace(/\\\*/g, '[^/]*')}$`);
  return re.test(relSegment);
}

function firstExisting(dir, names) {
  for (const name of names) {
    const abs = path.join(dir, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pull the register (`brand` or `product`) out of PRODUCT.md by looking
 * for a `## Register` section and reading the first non-empty line that
 * follows it. Returns null when the file is legacy / register-less.
 */
export function extractRegister(product) {
  if (!product) return null;
  const lines = product.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Register\b/i.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) continue;
        const word = next.toLowerCase();
        if (word === 'brand' || word === 'product') return word;
        return null;
      }
    }
  }
  return null;
}

/**
 * Read the installed skill's own version from the sibling SKILL.md frontmatter
 * (this file lives at `<skill>/scripts/context.mjs`). Returns null when the
 * frontmatter is missing or unreadable.
 */
function readLocalSkillVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const skillMd = path.join(here, '..', 'SKILL.md');
    const content = fs.readFileSync(skillMd, 'utf-8');
    const match = content.match(/^version:\s*(.+)$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

function readUpdateCache() {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeUpdateCache(cache) {
  try {
    fs.mkdirSync(path.dirname(UPDATE_CACHE_PATH), { recursive: true });
    fs.writeFileSync(UPDATE_CACHE_PATH, JSON.stringify(cache));
  } catch {
    // Best-effort: a read-only home dir just means we re-poll next session.
  }
}

/** Compare dotted numeric versions. Returns >0 when a is newer than b. */
function compareSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestSkillVersion() {
  try {
    const res = await fetch(`${UPDATE_HOST}/api/version`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.skills === 'string' ? data.skills : null;
  } catch {
    return null; // offline, sandboxed, timed out, or bad JSON: all non-fatal
  }
}

function buildUpdateDirective(localVersion, latestVersion) {
  return (
    `UPDATE_AVAILABLE: A newer Impeccable skill is available ` +
    `(installed v${localVersion}, latest v${latestVersion}). ` +
    `Before continuing, ask the user once: "A newer Impeccable (v${latestVersion}) is available. ` +
    `Update now? It runs \`npx impeccable update\`." ` +
    `If they agree, run \`npx impeccable update\` (the update applies to the next session, not this one). ` +
    `Either way, continue the current task without waiting, and do not raise this again.`
  );
}

/**
 * Best-effort update directive for the boot output. Returns a string to append
 * or null. Polls the version endpoint at most once per day (cached globally in
 * the user's home dir) and re-surfaces a given version at most once per week so
 * the agent never nags. Opt out entirely with IMPECCABLE_NO_UPDATE_CHECK=1.
 */
// Read the unified config's top-level `updateCheck` (local overrides shared).
// Inlined rather than importing hook-lib so the boot path stays lightweight.
function updateCheckDisabledByConfig(cwd = process.cwd()) {
  let value;
  for (const name of ['config.json', 'config.local.json']) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cwd, '.impeccable', name), 'utf-8'));
      if (raw && typeof raw === 'object' && typeof raw.updateCheck === 'boolean') value = raw.updateCheck;
    } catch { /* missing or malformed: ignore */ }
  }
  return value === false;
}

async function computeUpdateDirective(now = Date.now()) {
  try {
    if (process.env.IMPECCABLE_NO_UPDATE_CHECK) return null;
    if (updateCheckDisabledByConfig()) return null;
    const localVersion = readLocalSkillVersion();
    if (!localVersion) return null;

    const cache = readUpdateCache();

    // Poll the network only when the throttle window has elapsed. Stamp
    // lastCheck even on failure so an offline machine doesn't poll every boot.
    if (!cache.lastCheck || now - cache.lastCheck > CHECK_INTERVAL_MS) {
      const latest = await fetchLatestSkillVersion();
      cache.lastCheck = now;
      if (latest) cache.latestVersion = latest;
      writeUpdateCache(cache);
    }

    const latest = cache.latestVersion;
    if (!latest || compareSemver(latest, localVersion) <= 0) return null;

    // Anti-nag: surface a given version at most once per RENOTIFY window.
    if (cache.notifiedVersion === latest && cache.notifiedAt && now - cache.notifiedAt < RENOTIFY_INTERVAL_MS) {
      return null;
    }
    cache.notifiedVersion = latest;
    cache.notifiedAt = now;
    writeUpdateCache(cache);

    return buildUpdateDirective(localVersion, latest);
  } catch {
    return null;
  }
}

async function cli() {
  let cliOptions;
  try {
    cliOptions = parseCliOptions(process.argv.slice(2));
  } catch (err) {
    if (err?.name === 'TargetArgError') {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const targetProvided = hasTargetOption(cliOptions);
  const targetExists = targetProvided ? pathExistsForTarget(process.cwd(), cliOptions.targetPath) : null;
  const selection = resolveTargetSelection(process.cwd(), cliOptions);
  if (selection) {
    process.stdout.write(buildTargetSelectionDirective(selection) + '\n');
    process.exit(0);
  }
  const ctx = loadContext(process.cwd(), cliOptions);
  const updateDirective = await computeUpdateDirective();

  if (!ctx.hasProduct) {
    // Direct stdout message instead of relying on empty output as a signal
    // — cheap models miss the empty case more often than the explicit one.
    const parts = [
      'NO_PRODUCT_MD: This project has no PRODUCT.md yet. ' +
      'Stop the current task, load reference/init.md, and follow its ' +
      'instructions to write PRODUCT.md before resuming.',
    ];
    parts.push(buildResolvedContextDirective(ctx, cliOptions, { targetExists }));
    if (shouldWarnMissingTarget(ctx, targetProvided, targetExists)) {
      parts.push(buildMissingTargetDirective());
    }
    if (updateDirective) parts.push(updateDirective);
    process.stdout.write(parts.join('\n\n---\n\n') + '\n');
    process.exit(0);
  }
  const parts = [`# PRODUCT.md\n\n${ctx.product.trim()}`];
  if (ctx.hasDesign) {
    parts.push(`# DESIGN.md\n\n${ctx.design.trim()}`);
  }
  parts.push(buildResolvedContextDirective(ctx, cliOptions, { targetExists }));
  if (shouldWarnMissingTarget(ctx, targetProvided, targetExists)) {
    parts.push(buildMissingTargetDirective());
  }
  const register = extractRegister(ctx.product);
  const next = register
    ? `NEXT STEP: This project's register is \`${register}\`. You MUST now read \`reference/${register}.md\` before producing any design output.`
    : `NEXT STEP: You MUST now read the matching register reference (\`reference/brand.md\` or \`reference/product.md\`) before producing any design output. Pick based on PRODUCT.md above.`;
  parts.push(next);
  if (updateDirective) parts.push(updateDirective);
  process.stdout.write(parts.join('\n\n---\n\n') + '\n');
}

function parseCliOptions(args) {
  return parseTargetOptions(args, { strict: true });
}

function hasTargetOption(options) {
  return !!(options && typeof options.targetPath === 'string' && options.targetPath.trim());
}

function pathExistsForTarget(cwd, targetPath) {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  return fs.existsSync(abs);
}

function buildResolvedContextDirective(ctx, options, { targetExists = null } = {}) {
  const targetPath = hasTargetOption(options) ? options.targetPath : null;
  return `RESOLVED_CONTEXT:\n${JSON.stringify({
    targetPath,
    ...(targetPath ? { targetExists } : {}),
    projectRoot: ctx.projectRoot,
    repoRoot: ctx.repoRoot,
    productPath: ctx.productPath,
    designPath: ctx.designPath,
  }, null, 2)}`;
}

function shouldWarnMissingTarget(ctx, targetProvided, targetExists = null) {
  if (ctx.isMonorepo && targetProvided && targetExists === false) return true;
  return !!(
    ctx.isMonorepo
    && (!targetProvided || targetExists === false)
    && ctx.projectRoot
    && ctx.repoRoot
    && path.resolve(ctx.projectRoot) === path.resolve(ctx.repoRoot)
  );
}

function buildMissingTargetDirective() {
  const script = process.argv[1] || 'context.mjs';
  return (
    'MONOREPO_TARGET_REQUIRED: This is a monorepo and context.mjs ran without --target. ' +
    'If the user named a file, route, or child app, do not answer from this output. ' +
    `Rerun \`node ${script} --target <path>\` and answer from that run's RESOLVED_CONTEXT fields.`
  );
}

function buildTargetSelectionDirective(selection) {
  return (
    `TARGET_SELECTION_REQUIRED:\n${JSON.stringify(selection, null, 2)}\n\n` +
    'Show each app with its productStatus/productPath and designStatus/designPath so the user can see child overrides, inherited root files, fallback files, or missing files before choosing. ' +
    'Ask the user which app Impeccable should use, then rerun Impeccable helper commands from that child app cwd using this same scripts directory. ' +
    'Use `--target <path>` only as a fallback when changing cwd is not possible, or when the user explicitly named a file/path.'
  );
}

// Run cli() only when this module is the entry point. Compare realpaths
// rather than endsWith(): a loose suffix match also fires for unrelated
// scripts like `load-context.mjs`, and realpath tolerates symlinked
// invocation (the test harness symlinks the skill dir).
function invokedAsScript() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  cli();
}
