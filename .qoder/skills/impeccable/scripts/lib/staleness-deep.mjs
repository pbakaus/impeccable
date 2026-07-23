/**
 * Tier 2 staleness checks: the ones that cost too much to run on every session
 * boot. Shelling out to git, walking workspaces, resolving hook script paths,
 * and validating ignore lists against the live rule registry all belong here.
 *
 * The boot tier answers "did an older Impeccable write this". This tier also
 * asks "does it still describe the code", which no file comparison can settle
 * on its own. Where the answer needs judgment, the finding reports a measured
 * proxy and says it is a proxy. It never claims a document is wrong because a
 * number is large.
 *
 * Same finding shape and severities as lib/staleness.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VISUAL_SOURCE_DIRS = ['src', 'app', 'pages', 'components', 'site', 'styles', 'public'];

const HOOK_MANIFESTS_BY_PROVIDER = Object.freeze({
  'claude-code': ['.claude/settings.local.json', '.claude/settings.json'],
  codex: ['.codex/hooks.json'],
  agents: ['.codex/hooks.json'],
  cursor: ['.cursor/hooks.json'],
  github: ['.github/hooks/impeccable.json'],
  grok: ['.grok/hooks/impeccable.json'],
});

const HOOK_SCRIPT_MARKERS = [
  'skills/impeccable/scripts/hook.mjs',
  'skills/impeccable/scripts/hook-before-edit.mjs',
];

// Retired live-mode state locations. impeccable-paths still reads these as
// fallbacks; reporting them is what eventually lets the fallbacks go.
const LEGACY_LIVE_PATHS = ['.impeccable-live.json', '.impeccable-live'];

function finding({ id, artifact, filePath = null, severity, summary, fix }) {
  return { id, artifact, path: filePath, severity, summary, fix };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function toRelative(filePath, root) {
  if (!filePath) return null;
  const rel = path.relative(root, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    ? rel.split(path.sep).join('/')
    : filePath;
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// ─── DESIGN.md truth drift ─────────────────────────────────────────────────

/**
 * How much UI work has landed since DESIGN.md was last touched, measured in
 * commits to the visual source directories. A proxy, and reported as one: a
 * large number means the document is worth re-reading, not that it is wrong.
 * Silent outside a git repo, on an untracked DESIGN.md, and when the count is
 * small enough to be ordinary maintenance.
 */
export function checkDesignDrift({ designPath, projectRoot, threshold = 25 }) {
  if (!designPath || !projectRoot) return [];
  if (!git(['rev-parse', '--is-inside-work-tree'], projectRoot)) return [];

  const relDesign = toRelative(designPath, projectRoot);
  const lastDesignCommit = git(['log', '-1', '--format=%H', '--', relDesign], projectRoot);
  if (!lastDesignCommit) return [];

  const dirs = VISUAL_SOURCE_DIRS.filter((dir) => fs.existsSync(path.join(projectRoot, dir)));
  if (!dirs.length) return [];

  const log = git(
    ['log', '--oneline', `${lastDesignCommit}..HEAD`, '--', ...dirs],
    projectRoot,
  );
  if (log === null) return [];
  const commits = log ? log.split('\n').filter(Boolean).length : 0;
  if (commits < threshold) return [];

  const when = git(['log', '-1', '--format=%ad', '--date=short', '--', relDesign], projectRoot);
  return [finding({
    id: 'design-md-drift',
    artifact: 'DESIGN.md',
    filePath: relDesign,
    severity: 'route',
    summary: `${commits} commits have touched ${dirs.join(', ')} since ${relDesign} was last edited`
      + `${when ? ` (${when})` : ''}. This counts commits, not contradictions: it says the document is worth `
      + 're-reading, not that it is wrong.',
    fix: 'Read DESIGN.md against the current tokens and components before trusting it as authority. '
      + 'If it has genuinely drifted, `document` regenerates it from the code.',
  })];
}

/**
 * Canonical DESIGN.md sections that carry nothing. Distinct from truth drift:
 * a section can be absent because it never applied, so this is reported as a
 * documentation gap for a human to judge, never as an error.
 */
export function checkDesignCoverage({ design, designPath, parseDesignMd }) {
  if (!design || typeof parseDesignMd !== 'function') return [];
  let model;
  try {
    model = parseDesignMd(design);
  } catch {
    return [];
  }
  const missing = ['colors', 'typography', 'components']
    .filter((section) => !model[section]);
  if (!missing.length) return [];
  return [finding({
    id: 'design-md-coverage',
    artifact: 'DESIGN.md',
    filePath: designPath,
    severity: 'mention',
    summary: `${designPath || 'DESIGN.md'} has no ${missing.join(', ')} section. `
      + 'Agents generating new screens get no normative guidance for those, and the live design panel renders '
      + 'generic approximations in their place.',
    fix: 'Ask whether the section never applied or was never written. `document` fills it from the code if the '
      + 'project has the answer in its CSS.',
  })];
}

// ─── detector ignore lists ─────────────────────────────────────────────────

/**
 * Ignore entries that no longer match anything: rule ids the engine dropped or
 * renamed, and file paths that are gone. Both read as working suppressions
 * until someone checks, and a dead rule ignore also hides that the rule left.
 */
export function checkDetectorIgnores({ projectRoot, knownRuleIds = null }) {
  const findings = [];
  if (!projectRoot) return findings;

  for (const name of ['config.json', 'config.local.json']) {
    const filePath = path.join(projectRoot, '.impeccable', name);
    const raw = readJson(filePath);
    const detector = raw?.detector;
    if (!detector || typeof detector !== 'object') continue;
    const rel = toRelative(filePath, projectRoot);

    if (knownRuleIds && Array.isArray(detector.ignoreRules)) {
      const unknown = detector.ignoreRules
        .map((rule) => String(rule || '').trim().toLowerCase())
        .filter((rule) => rule && rule !== '*' && !knownRuleIds.has(rule));
      if (unknown.length) {
        findings.push(finding({
          id: 'detector-ignore-rules-unknown',
          artifact: 'config.json',
          filePath: rel,
          severity: 'mention',
          summary: `${rel} ignores rule id(s) the detector does not have: `
            + `${unknown.map((rule) => `\`${rule}\``).join(', ')}. Either the rule was renamed or removed, or the `
            + 'id was mistyped and has never suppressed anything.',
          fix: 'Report the exact ids. Removing them is safe; keeping a dead ignore hides that the rule is gone.',
        }));
      }
    }

    if (Array.isArray(detector.ignoreFiles)) {
      const missing = detector.ignoreFiles
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry && !entry.includes('*') && !fs.existsSync(path.join(projectRoot, entry)));
      if (missing.length) {
        findings.push(finding({
          id: 'detector-ignore-files-missing',
          artifact: 'config.json',
          filePath: rel,
          severity: 'mention',
          summary: `${rel} ignores file path(s) that no longer exist: `
            + `${missing.map((entry) => `\`${entry}\``).join(', ')}.`,
          fix: 'Ask whether the file moved (repoint the entry) or was deleted (drop it). '
            + 'A stale entry silently stops covering the file that replaced it.',
        }));
      }
    }
  }
  return findings;
}

// ─── hook installation ─────────────────────────────────────────────────────

function collectHookCommands(value, out = []) {
  if (typeof value === 'string') {
    if (HOOK_SCRIPT_MARKERS.some((marker) => value.includes(marker))) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectHookCommands(entry, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectHookCommands(entry, out);
  }
  return out;
}

const HOOK_MARKER = /skills\/impeccable\/scripts\/hook(?:-before-edit)?\.mjs/;

// Pull the script-path token out of a hook command line, placeholders intact.
// The forms our manifests ship:
//   * bare:            node "${CLAUDE_PROJECT_DIR}/.../hook.mjs"
//   * bundle-relative: node ".agents/.../hook.mjs"
//   * legacy unquoted: node .claude/.../hook.mjs
//   * guarded (#399):  [ ! -f "PATH" ] || node "PATH"   (PATH twice, identical)
//   * absolute:        node "/Users/.../hook.mjs"        (user-level installs)
//   * github portable: node "$(git rev-parse --show-toplevel)/.../hook.mjs"
// A quoted path wins; the guard's two occurrences are identical, so the first
// quoted match is the path. Otherwise fall back to the whitespace/metachar-
// delimited token that ends at the marker, so we don't absorb `node`, `[`, `!`
// or `||`. Returns the token verbatim; resolution happens separately.
function hookScriptTokenFrom(command) {
  const str = String(command);
  if (!HOOK_MARKER.test(str)) return null;
  const quoted = str.match(/"([^"]*skills\/impeccable\/scripts\/hook(?:-before-edit)?\.mjs)"/);
  if (quoted) return quoted[1];
  const bare = str.match(/([^\s"'|&;()]*skills\/impeccable\/scripts\/hook(?:-before-edit)?\.mjs)/);
  return bare ? bare[1] : null;
}

// Resolve a script token to an absolute path the doctor can existsSync, or null
// when the doctor cannot know where it points — in which case the caller must
// NOT report it missing (a doctor never asserts a negative it cannot verify).
//
// Per-placeholder policy, mirroring what each runtime actually expands:
//   ${CLAUDE_PROJECT_DIR}  → the project root being scanned. This is exactly the
//                            runtime mapping (Claude Code sets it to the project
//                            dir at hook time), so we EXPAND it against `root`.
//                            Not doing so was the #402 bug: the literal
//                            `${CLAUDE_PROJECT_DIR}/...` string never exists.
//   ${CLAUDE_PLUGIN_ROOT}  → plugin-package install dir, set by the harness to
//   ${PLUGIN_ROOT}           wherever the plugin/codex/grok bundle was unpacked
//   ${GROK_PLUGIN_ROOT}      (grok aliases CLAUDE_PLUGIN_ROOT). The doctor has no
//                            way to know that location → SKIP (return null).
//   $(...) / backticks     → command substitution, e.g. GitHub's
//                            `$(git rev-parse --show-toplevel)`. Not statically
//                            resolvable → SKIP.
//   any other ${VAR}/$VAR  → unknown to the doctor → SKIP.
// A token with no placeholder is a literal path: absolute as-is, else relative
// to `root`.
function resolveHookScriptPath(token, root) {
  if (!token) return null;
  // Command substitution or backtick expansion we can't evaluate.
  if (token.includes('$(') || token.includes('`')) return null;
  const expanded = token.replace(/\$\{CLAUDE_PROJECT_DIR\}/g, root);
  // Any placeholder or shell variable still present is one we can't map.
  if (/\$\{[^}]*\}|\$[A-Za-z_]/.test(expanded)) return null;
  return path.isAbsolute(expanded) ? expanded : path.join(root, expanded);
}

/**
 * A hook whose script path does not resolve is a silent no-op, and the user
 * believes the project is covered. Also catches the contradiction of an
 * installed manifest against `hook.enabled: false`.
 */
export function checkHookInstallation({ projectRoot, repoRoot, providerId }) {
  const findings = [];
  const manifests = HOOK_MANIFESTS_BY_PROVIDER[providerId] || [];
  if (!manifests.length) return findings;

  const roots = [...new Set([projectRoot, repoRoot].filter(Boolean).map((root) => path.resolve(root)))];
  let installedAt = null;

  for (const root of roots) {
    for (const rel of manifests) {
      const manifestPath = path.join(root, rel);
      const raw = readJson(manifestPath);
      if (!raw?.hooks) continue;
      const commands = collectHookCommands(raw.hooks);
      if (!commands.length) continue;
      installedAt = toRelative(manifestPath, projectRoot || root);

      const broken = commands.filter((command) => {
        const token = hookScriptTokenFrom(command);
        if (!token) return false;
        const abs = resolveHookScriptPath(token, root);
        // Unresolvable placeholder or command substitution: never assert missing.
        if (!abs) return false;
        return !fs.existsSync(abs);
      });
      if (broken.length) {
        findings.push(finding({
          id: 'hook-script-missing',
          artifact: 'hook manifest',
          filePath: installedAt,
          severity: 'mention',
          summary: `${installedAt} installs the design hook, but its script path does not exist: `
            + `${broken.map((command) => `\`${command}\``).join(', ')}. The hook runs as a no-op, so UI edits `
            + 'have been going unscanned while the project looks covered.',
          fix: `Reinstall with \`impeccable hooks on\`, which rewrites the manifest against the skill's current location.`,
        }));
      }
    }
  }

  if (installedAt) {
    for (const root of roots) {
      for (const name of ['config.json', 'config.local.json']) {
        const raw = readJson(path.join(root, '.impeccable', name));
        if (raw?.hook && raw.hook.enabled === false) {
          findings.push(finding({
            id: 'hook-enabled-conflict',
            artifact: 'config.json',
            filePath: toRelative(path.join(root, '.impeccable', name), projectRoot || root),
            severity: 'mention',
            summary: `${installedAt} installs the design hook while this config sets \`hook.enabled: false\`, `
              + 'so the hook fires and then declines to scan.',
            fix: 'Ask which was intended: `impeccable hooks on` to enable, or `impeccable hooks off` to uninstall '
              + 'the manifest entry as well.',
          }));
          return findings;
        }
      }
    }
  }

  return findings;
}

// ─── retired locations ─────────────────────────────────────────────────────

export function checkLegacyLiveState({ projectRoot }) {
  if (!projectRoot) return [];
  const present = LEGACY_LIVE_PATHS.filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
  if (!present.length) return [];
  return [finding({
    id: 'legacy-live-state',
    artifact: 'live state',
    filePath: present.join(', '),
    severity: 'auto',
    summary: `Live-mode state sits in retired location(s): ${present.map((rel) => `\`${rel}\``).join(', ')}. `
      + 'Current live mode writes under `.impeccable/live/`.',
    fix: 'These are read only through backward-compatible fallbacks and are safe to delete once no live session '
      + 'is running. No user decision is needed.',
  })];
}

// ─── monorepo sweep ────────────────────────────────────────────────────────

/**
 * Per-workspace context, plus the case worth acting on: a workspace with
 * native build files inheriting a repo-root PRODUCT.md that says web. Each
 * such app gets web guidance and never loads the native references, and
 * nothing at boot reports it because the root record parses cleanly.
 *
 * `candidates` comes from context.mjs's discovery so the walk is not repeated.
 */
export function checkWorkspaces({ repoRoot, candidates = [], checkNativePlatformEvidence, extractPlatform, readFile }) {
  if (!repoRoot || !candidates.length) return { findings: [], workspaces: [] };
  const findings = [];
  const workspaces = [];

  for (const candidate of candidates) {
    const workspaceRoot = path.join(repoRoot, candidate.path);
    const productPath = candidate.productPath ? path.join(repoRoot, candidate.productPath) : null;
    const product = productPath && readFile ? readFile(productPath) : null;
    const platform = extractPlatform ? extractPlatform(product) : null;

    workspaces.push({
      name: candidate.name,
      path: candidate.path,
      productStatus: candidate.productStatus,
      productPath: candidate.productPath,
      designStatus: candidate.designStatus,
      designPath: candidate.designPath,
      platform: platform || (product ? 'web (default)' : null),
    });

    if (!checkNativePlatformEvidence) continue;
    const native = checkNativePlatformEvidence({
      projectRoot: workspaceRoot,
      platform,
      product,
      productPath: candidate.productPath,
    });
    for (const entry of native) {
      findings.push(finding({
        id: 'workspace-platform-native-evidence',
        artifact: 'PRODUCT.md',
        filePath: candidate.productPath || `${candidate.path}/PRODUCT.md`,
        severity: 'mention',
        summary: `Workspace \`${candidate.path}\` ${
          candidate.productStatus === 'inherited'
            ? 'inherits the repo-root PRODUCT.md'
            : 'has a PRODUCT.md'
        } that resolves to web, but the workspace itself carries native build files. ${entry.summary}`,
        fix: candidate.productStatus === 'inherited'
          ? `Give \`${candidate.path}\` its own PRODUCT.md with the right \`## Platform\`. `
            + 'An inherited record cannot describe two platforms at once.'
          : entry.fix,
      }));
    }
  }

  const inherited = workspaces.filter((entry) => entry.productStatus === 'inherited');
  if (inherited.length) {
    findings.push(finding({
      id: 'workspace-context-inherited',
      artifact: 'PRODUCT.md',
      filePath: null,
      severity: 'mention',
      summary: `${inherited.length} of ${workspaces.length} workspace(s) inherit the repo-root PRODUCT.md: `
        + `${inherited.map((entry) => `\`${entry.path}\``).join(', ')}. Inheritance is intended; whether one `
        + 'record truthfully describes these apps is not something this check can tell.',
      fix: 'Ask the user whether the inherited record describes each app. Where it does not, `init` in that '
        + 'workspace writes a child PRODUCT.md that overrides it.',
    }));
  }

  return { findings, workspaces };
}

// ─── rule registry ─────────────────────────────────────────────────────────

/**
 * Rule ids from the bundled detector, or null when it cannot be resolved (a
 * partial install, or a harness that ships the skill without the engine).
 * Null means "cannot check", which the ignore-rule check treats as skip rather
 * than as every id being unknown.
 */
export async function loadKnownRuleIds(scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  // Same two locations detect.mjs resolves: the bundled copy in an installed
  // skill, then the source-repo engine when running from a checkout.
  const candidates = [
    path.join(scriptsDir, 'detector', 'detect-antipatterns.mjs'),
    path.join(scriptsDir, '..', '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
  ];
  const detectorPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!detectorPath) return null;
  try {
    const { ANTIPATTERNS } = await import(pathToFileURL(detectorPath).href);
    if (!Array.isArray(ANTIPATTERNS)) return null;
    return new Set(ANTIPATTERNS.map((rule) => String(rule.id).toLowerCase()));
  } catch {
    return null;
  }
}
