/**
 * Context loader: prints PRODUCT.md (and DESIGN.md if present) as one
 * markdown block on stdout, or exits with empty stdout when no PRODUCT.md
 * is found anywhere. The skill keys off "empty stdout" to branch into the
 * init flow.
 *
 * Path resolution (first match wins):
 *   1. cwd, if PRODUCT.md or DESIGN.md is there
 *   2. .agents/context/ then docs/
 *   3. $IMPECCABLE_CONTEXT_DIR (absolute or cwd-relative) — power-user
 *      escape hatch, only consulted when defaults are empty
 *   4. cwd as a "nothing found" default
 *
 * DESIGN.md may be scoped: a project with more than one design system keeps a
 * DESIGN.md inside named subdirectories of the context dir (alongside the
 * shared PRODUCT.md). Pass the URL or file path being designed as argv[2] and
 * the loader routes to the matching scope's DESIGN.md (see resolveDesignPath),
 * falling back to the shared DESIGN.md. Single-DESIGN.md projects are
 * unaffected.
 *
 * `resolveContextDir()` and `loadContext()` are also exported for the
 * server-side scripts (live.mjs, live-server.mjs) that need the structured
 * shape rather than the markdown block.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT_NAMES = ['PRODUCT.md', 'Product.md', 'product.md'];
const DESIGN_NAMES = ['DESIGN.md', 'Design.md', 'design.md'];
const FALLBACK_DIRS = ['.agents/context', 'docs'];

// ─── Update check ──────────────────────────────────────────────────────────
// Piggyback a lightweight skill-version check on the once-per-session boot.
// When a newer skill ships, append an UPDATE_AVAILABLE directive so the agent
// can offer `npx impeccable skills update`. Everything here is best-effort and
// silent on failure: a network problem, sandbox, or missing cache must never
// block context output or print an error.

const UPDATE_HOST = (process.env.IMPECCABLE_UPDATE_HOST || 'https://impeccable.style').replace(/\/$/, '');
const UPDATE_CACHE_PATH =
  process.env.IMPECCABLE_UPDATE_CACHE || path.join(os.homedir(), '.impeccable', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // throttle the network poll to once a day
const RENOTIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // don't re-surface the same version for a week
const FETCH_TIMEOUT_MS = 1200;

export function resolveContextDir(cwd = process.cwd()) {
  if (firstExisting(cwd, [...PRODUCT_NAMES, ...DESIGN_NAMES])) {
    return cwd;
  }
  for (const rel of FALLBACK_DIRS) {
    const candidate = path.resolve(cwd, rel);
    if (firstExisting(candidate, [...PRODUCT_NAMES, ...DESIGN_NAMES])) {
      return candidate;
    }
  }
  const envDir = process.env.IMPECCABLE_CONTEXT_DIR;
  if (envDir && envDir.trim()) {
    const trimmed = envDir.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  }
  return cwd;
}

export function loadContext(cwd = process.cwd(), target = null) {
  const contextDir = resolveContextDir(cwd);
  const productPath = firstExisting(contextDir, PRODUCT_NAMES);
  // DESIGN.md: scoped when `target` matches a scope subdir, else the shared
  // DESIGN.md next to PRODUCT.md. PRODUCT.md is always project-wide.
  const { path: designPath, scope: designScope } = resolveDesignPath(contextDir, target);
  const product = productPath ? safeRead(productPath) : null;
  const design = designPath ? safeRead(designPath) : null;
  return {
    hasProduct: !!product,
    product,
    productPath: productPath ? path.relative(cwd, productPath) : null,
    hasDesign: !!design,
    design,
    designPath: designPath ? path.relative(cwd, designPath) : null,
    designScope,
    contextDir,
  };
}

// ─── Scoped DESIGN.md routing ───────────────────────────────────────────────
// Some projects ship more than one design system — e.g. an admin app, a public
// marketing site, and a mobile web app, each with its own look. Impeccable
// supports this with zero config: drop a DESIGN.md inside a named subdirectory
// of the context dir (alongside the shared PRODUCT.md), e.g.
//   .agents/context/PRODUCT.md          (shared — one product story)
//   .agents/context/admin/DESIGN.md     (scope "admin")
//   .agents/context/marketing/DESIGN.md (scope "marketing")
// Pass the URL or file path you're working on to context.mjs and the loader
// loads the matching scope's DESIGN.md, inferred by matching the target's
// hostname labels / path segments against the scope directory names
// (e.g. https://admin.example.com/... or src/admin/page.tsx -> "admin").
// Falls back to the shared DESIGN.md when nothing matches, so single-DESIGN.md
// projects are unaffected.

/** Subdirectories of `contextDir` that contain a DESIGN.md, as design scopes. */
function discoverScopes(contextDir) {
  let entries;
  try {
    entries = fs.readdirSync(contextDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const scopes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const designPath = firstExisting(path.join(contextDir, entry.name), DESIGN_NAMES);
    if (designPath) scopes.push({ name: entry.name, designPath });
  }
  return scopes;
}

/** Split a URL or path into lowercased tokens (host labels first, then path segments). */
function tokenizeTarget(target) {
  const trimmed = String(target || '').trim();
  if (!trimmed) return [];
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return [...url.hostname.split('.'), ...url.pathname.split('/')]
        .map((t) => t.toLowerCase())
        .filter(Boolean);
    } catch {
      // fall through to plain tokenization
    }
  }
  return trimmed
    .split(/[\/.\\]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Infer a scope name from a target (URL or file path) by matching its tokens
 * against the available scope names. Returns the first matching scope (host
 * labels take precedence over path segments), or null.
 */
export function inferScope(target, scopeNames) {
  if (!target || !Array.isArray(scopeNames) || scopeNames.length === 0) return null;
  const byLower = new Map(scopeNames.map((n) => [n.toLowerCase(), n]));
  for (const token of tokenizeTarget(target)) {
    if (byLower.has(token)) return byLower.get(token);
  }
  return null;
}

/**
 * Resolve which DESIGN.md to load. When `target` matches a scope subdir, use
 * that scope's DESIGN.md; otherwise fall back to the shared DESIGN.md next to
 * PRODUCT.md. Returns { path, scope } (scope is null for the shared file).
 */
export function resolveDesignPath(contextDir, target = null) {
  if (target) {
    const scopes = discoverScopes(contextDir);
    if (scopes.length) {
      const name = inferScope(target, scopes.map((s) => s.name));
      const hit = name && scopes.find((s) => s.name === name);
      if (hit) return { path: hit.designPath, scope: hit.name };
    }
  }
  return { path: firstExisting(contextDir, DESIGN_NAMES), scope: null };
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
    `Update now? It runs \`npx impeccable skills update\`." ` +
    `If they agree, run \`npx impeccable skills update\` (the update applies to the next session, not this one). ` +
    `Either way, continue the current task without waiting, and do not raise this again.`
  );
}

/**
 * Best-effort update directive for the boot output. Returns a string to append
 * or null. Polls the version endpoint at most once per day (cached globally in
 * the user's home dir) and re-surfaces a given version at most once per week so
 * the agent never nags. Opt out entirely with IMPECCABLE_NO_UPDATE_CHECK=1.
 */
async function computeUpdateDirective(now = Date.now()) {
  try {
    if (process.env.IMPECCABLE_NO_UPDATE_CHECK) return null;
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
  // process.argv[2] (optional): the URL or file path being designed, used to
  // route to a scoped DESIGN.md when the project keeps more than one.
  const ctx = loadContext(process.cwd(), process.argv[2] || null);
  const updateDirective = await computeUpdateDirective();

  if (!ctx.hasProduct) {
    // Direct stdout message instead of relying on empty output as a signal
    // — cheap models miss the empty case more often than the explicit one.
    const parts = [
      'NO_PRODUCT_MD: This project has no PRODUCT.md yet. ' +
      'Stop the current task, load reference/init.md, and follow its ' +
      'instructions to write PRODUCT.md before resuming.',
    ];
    if (updateDirective) parts.push(updateDirective);
    process.stdout.write(parts.join('\n\n---\n\n') + '\n');
    process.exit(0);
  }
  const parts = [`# PRODUCT.md\n\n${ctx.product.trim()}`];
  if (ctx.hasDesign) {
    parts.push(`# DESIGN.md\n\n${ctx.design.trim()}`);
  }
  const register = extractRegister(ctx.product);
  const next = register
    ? `NEXT STEP: This project's register is \`${register}\`. You MUST now read \`reference/${register}.md\` before producing any design output.`
    : `NEXT STEP: You MUST now read the matching register reference (\`reference/brand.md\` or \`reference/product.md\`) before producing any design output. Pick based on PRODUCT.md above.`;
  parts.push(next);
  if (updateDirective) parts.push(updateDirective);
  process.stdout.write(parts.join('\n\n---\n\n') + '\n');
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
