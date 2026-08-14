/**
 * Staleness detection for Impeccable's own project artifacts: PRODUCT.md,
 * DESIGN.md and its `.impeccable/design.json` sidecar, `.impeccable/config.json`,
 * and persisted surface briefs.
 *
 * Three kinds of drift live under "out of date", and they want different
 * handling:
 *
 *   1. Tool version drift. The installed skill is older than the published one.
 *      Owned by computeUpdateDirective in context.mjs, not by this module.
 *   2. Schema drift. An artifact was written by an older Impeccable: fields it
 *      no longer reads, fields it now expects, files in retired locations.
 *      Deterministic, and mostly fixable without asking anyone.
 *   3. Truth drift. The code moved on and the document no longer describes it.
 *      Not mechanical. `document` and `init` own the rewrite; the most this
 *      module does is measure a proxy and name it as a proxy.
 *
 * Two tiers, because the boot path runs on every session:
 *
 *   Tier 1 (collectBootFindings) spends only what a boot already spends. It
 *   parses markdown context.mjs has in memory, stats a bounded set of paths,
 *   and reads the two small JSON files the boot reads anyway. No directory
 *   walks, no git, no cross-workspace sweep.
 *
 *   Tier 2 (the doctor pass) is on demand and may walk, shell out to git, and
 *   compare declared tokens against real CSS.
 *
 * Findings are data, not prose, so both tiers and the JSON output render the
 * same set. Severity says what should happen, not how bad it is:
 *
 *   'auto'    fix it silently the next time that file is written anyway
 *   'mention' state it once, offer the fix, carry on with the user's task
 *   'route'   needs a specific command, so name the command and the gap
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  PRODUCT_SCHEMA_VERSION,
  PRODUCT_DEPRECATED_SECTIONS,
  PRODUCT_V4_SECTIONS,
  DESIGN_SIDECAR_SCHEMA_VERSION,
  readProductSchemaVersion,
  readSidecarSchemaVersion,
} from './artifact-schema.mjs';

// Top-level keys any reader honors: `hook` and `detector` subtrees (hook-lib's
// readConfig), `updateCheck` (context.mjs), `projectRoots` (context.mjs's
// monorepo resolution), `buildPath` (context.mjs's build-path directive), plus
// `stalenessCheck` below. `$schema` and `version` are allowed as conventional
// metadata nobody reads.
const KNOWN_CONFIG_KEYS = new Set([
  'hook',
  'detector',
  'updateCheck',
  'stalenessCheck',
  'projectRoots',
  'buildPath',
  '$schema',
  'version',
]);

// The only two values context.mjs and new-work honor. A near miss reads as a
// working preference and silently rides the opposite path, so it is worth
// reporting rather than coercing.
const BUILD_PATH_VALUES = Object.freeze(['comp', 'code']);

// Evidence that this project does the kind of work `buildPath` governs. A
// project that only ever ran polish or audit has no use for the setting and
// should never be told it exists. Two stats, so Tier 1 can afford it.
const DIRECTION_WORK_PATHS = Object.freeze([
  path.join('.impeccable', 'surfaces'),
  path.join('.impeccable', 'mocks', 'decision'),
]);

// `detector` is a closed set, so a typo here is worth reporting. `hook` is not
// checked: it carries runtime settings from several writers and the false
// positive rate would outweigh the catch.
const KNOWN_DETECTOR_KEYS = new Set([
  'ignoreRules',
  'ignoreFiles',
  'ignoreValues',
  'designSystem',
  'extensions',
]);

// Evidence that a project ships a native app. Checked only to catch a
// PRODUCT.md that says web (or says nothing, which resolves to web) on a
// project that is plainly not: that combination silently skips the iOS and
// Android references for the whole session.
const NATIVE_EVIDENCE_PATHS = Object.freeze([
  { rel: 'pubspec.yaml', platform: 'adaptive', reason: 'a Flutter pubspec.yaml' },
  { rel: 'ios/Podfile', platform: 'ios', reason: 'an ios/Podfile' },
  { rel: 'android/build.gradle', platform: 'android', reason: 'an android/build.gradle' },
  { rel: 'android/build.gradle.kts', platform: 'android', reason: 'an android/build.gradle.kts' },
  { rel: 'ios/Runner.xcodeproj', platform: 'ios', reason: 'an ios/Runner.xcodeproj' },
]);

const NATIVE_EVIDENCE_DEPENDENCIES = Object.freeze([
  { name: 'react-native', platform: 'adaptive', reason: 'a react-native dependency' },
  { name: 'expo', platform: 'adaptive', reason: 'an expo dependency' },
  { name: '@react-native/metro-config', platform: 'adaptive', reason: 'a React Native metro config dependency' },
]);

function finding({ id, artifact, filePath = null, severity, summary, fix }) {
  return { id, artifact, path: filePath, severity, summary, fix };
}

/**
 * Every location a design sidecar may live, canonical first. Pure so that both
 * impeccable-paths (which resolves the project root) and context.mjs (which
 * cannot import impeccable-paths without a cycle) share one definition of
 * where the retired locations are.
 */
export function designSidecarCandidatesFor(projectRoot, contextDir = projectRoot) {
  const candidates = [
    path.join(projectRoot, '.impeccable', 'design.json'),
    path.join(projectRoot, 'DESIGN.json'),
  ];
  const contextLegacy = path.join(contextDir || projectRoot, 'DESIGN.json');
  if (!candidates.includes(contextLegacy)) candidates.push(contextLegacy);
  return candidates;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function mtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function hasSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\s*$`, 'im').test(String(markdown || ''));
}

function toRelative(filePath, root) {
  if (!filePath) return null;
  const rel = path.relative(root, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    ? rel.split(path.sep).join('/')
    : filePath;
}

// ─── PRODUCT.md ────────────────────────────────────────────────────────────

/**
 * Pure: schema drift visible in a PRODUCT.md body. `productPath` is used for
 * reporting only.
 */
export function checkProduct(product, productPath = 'PRODUCT.md') {
  if (!product) return [];
  const findings = [];

  for (const [heading, reason] of Object.entries(PRODUCT_DEPRECATED_SECTIONS)) {
    if (!hasSection(product, heading)) continue;
    findings.push(finding({
      id: `product-deprecated-${heading.toLowerCase()}`,
      artifact: 'PRODUCT.md',
      filePath: productPath,
      severity: 'mention',
      summary: `PRODUCT.md still carries a \`## ${heading}\` section. ${reason}`,
      fix: `Treat \`## ${heading}\` as absent for every decision this session. `
        + 'Offer to delete the section; do not let its value influence the work either way.',
    }));
  }

  const stamped = readProductSchemaVersion(product);
  if (stamped === null && !PRODUCT_V4_SECTIONS.some((section) => hasSection(product, section))) {
    findings.push(finding({
      id: 'product-schema-legacy',
      artifact: 'PRODUCT.md',
      filePath: productPath,
      severity: 'route',
      summary: 'PRODUCT.md has no schema stamp and none of the sections the current record adds '
        + `(${PRODUCT_V4_SECTIONS.join(', ')}), so it predates this version of the product record.`,
      fix: 'Offer `init`, which preserves confirmed answers and fills the gaps by interview. '
        + 'Do not rewrite the file from inference.',
    }));
  } else if (stamped !== null && stamped < PRODUCT_SCHEMA_VERSION) {
    findings.push(finding({
      id: 'product-schema-outdated',
      artifact: 'PRODUCT.md',
      filePath: productPath,
      severity: 'route',
      summary: `PRODUCT.md is stamped product-schema ${stamped}; the current record is ${PRODUCT_SCHEMA_VERSION}.`,
      fix: 'Offer `init` to bring the record current, preserving confirmed answers.',
    }));
  }

  return findings;
}

/**
 * A project that resolves to web while carrying native build files. Bounded:
 * a handful of stats plus one package.json read at the project root.
 */
export function checkNativePlatformEvidence({ projectRoot, platform, product, productPath }) {
  if (!projectRoot) return [];
  // Only the web resolution is worth checking. An explicit native value is
  // already honored, and an unrecognized value already gets its own warning.
  if (platform && platform !== 'web') return [];

  const evidence = [];
  for (const entry of NATIVE_EVIDENCE_PATHS) {
    if (fs.existsSync(path.join(projectRoot, entry.rel))) evidence.push(entry);
  }
  const pkg = readJson(path.join(projectRoot, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const entry of NATIVE_EVIDENCE_DEPENDENCIES) {
      if (deps[entry.name]) evidence.push(entry);
    }
  }
  if (!evidence.length) return [];

  const platforms = new Set(evidence.map((entry) => entry.platform));
  const suggested = platforms.size > 1 || platforms.has('adaptive')
    ? 'adaptive'
    : [...platforms][0];
  const declared = platform === 'web'
    ? 'PRODUCT.md declares `## Platform: web`'
    : product
      ? 'PRODUCT.md has no `## Platform` section, so the project resolves to web'
      : 'no PRODUCT.md declares a platform, so the project resolves to web';

  return [finding({
    id: 'platform-native-evidence',
    artifact: 'PRODUCT.md',
    filePath: productPath || null,
    severity: 'mention',
    summary: `${declared}, but the project carries ${evidence.map((entry) => entry.reason).join(' and ')}. `
      + 'Web guidance is being applied to a native codebase, and the iOS and Android references never load.',
    fix: `Ask the user whether \`## Platform\` should be \`${suggested}\`. `
      + 'If it should, write the value and load the matching native reference before designing.',
  })];
}

// ─── DESIGN.md and the design.json sidecar ─────────────────────────────────

/**
 * Sidecar drift: retired location, schema version behind, or older than the
 * DESIGN.md it extends. Costs three stats and one small JSON read.
 *
 * `sidecarCandidates` comes from impeccable-paths' resolver so this module
 * stays out of the business of knowing where sidecars may live; the first
 * entry is the canonical location.
 */
export function checkDesignSidecar({ designPath, sidecarCandidates = [], projectRoot }) {
  const findings = [];
  const canonical = sidecarCandidates[0] || null;
  const present = sidecarCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  if (!present) return findings;

  const relPresent = toRelative(present, projectRoot);

  if (canonical && path.resolve(present) !== path.resolve(canonical)) {
    findings.push(finding({
      id: 'design-sidecar-legacy-path',
      artifact: 'design.json',
      filePath: relPresent,
      severity: 'auto',
      summary: `The design sidecar sits at ${relPresent}, a location kept only for backward compatibility.`,
      fix: `Move it to ${toRelative(canonical, projectRoot)} the next time the sidecar is written. `
        + 'No user decision is needed.',
    }));
  }

  const sidecar = readJson(present);
  const schemaVersion = readSidecarSchemaVersion(sidecar);
  if (sidecar && (schemaVersion === null || schemaVersion < DESIGN_SIDECAR_SCHEMA_VERSION)) {
    findings.push(finding({
      id: 'design-sidecar-schema-outdated',
      artifact: 'design.json',
      filePath: relPresent,
      severity: 'route',
      summary: `${relPresent} is schemaVersion ${schemaVersion === null ? 'unset' : schemaVersion}; `
        + `the current sidecar is ${DESIGN_SIDECAR_SCHEMA_VERSION}. Token primitives moved to the DESIGN.md `
        + 'frontmatter, so the old shape carries values that are now read from two places.',
      fix: 'Offer `document` to regenerate the sidecar. It reads the existing DESIGN.md, so no interview is needed.',
    }));
  }

  if (designPath) {
    const designMtime = mtimeMs(designPath);
    const sidecarMtime = mtimeMs(present);
    if (designMtime !== null && sidecarMtime !== null && designMtime > sidecarMtime) {
      findings.push(finding({
        id: 'design-sidecar-stale',
        artifact: 'design.json',
        filePath: relPresent,
        severity: 'mention',
        summary: `DESIGN.md was edited after ${relPresent} was generated, so the sidecar's ramps, `
          + 'shadows, motion tokens, and component snippets may contradict it.',
        fix: 'Offer `document` to refresh the sidecar, preserving DESIGN.md.',
      }));
    }
  }

  return findings;
}

// ─── .impeccable/config.json ───────────────────────────────────────────────

/**
 * Unrecognized keys in the shared and local configs. A key nothing reads is
 * indistinguishable from a working setting until someone checks, which is how
 * a singular `ignoreRule` silences nothing for months.
 */
export function checkConfig({ projectRoot, repoRoot }) {
  const findings = [];
  const roots = [...new Set([projectRoot, repoRoot].filter(Boolean).map((root) => path.resolve(root)))];
  for (const root of roots) {
    for (const name of ['config.json', 'config.local.json']) {
      const filePath = path.join(root, '.impeccable', name);
      const raw = readJson(filePath);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const rel = toRelative(filePath, projectRoot || root);

      const unknownTop = Object.keys(raw).filter((key) => !KNOWN_CONFIG_KEYS.has(key));
      if (unknownTop.length) {
        findings.push(finding({
          id: 'config-unknown-keys',
          artifact: 'config.json',
          filePath: rel,
          severity: 'mention',
          summary: `${rel} has top-level key(s) nothing reads: ${unknownTop.map((key) => `\`${key}\``).join(', ')}. `
            + `Recognized keys are ${[...KNOWN_CONFIG_KEYS].map((key) => `\`${key}\``).join(', ')}.`,
          fix: 'Report the exact keys to the user. A near-miss of a real key is a setting that has never applied.',
        }));
      }

      if (Object.prototype.hasOwnProperty.call(raw, 'buildPath')
        && !BUILD_PATH_VALUES.includes(raw.buildPath)) {
        findings.push(finding({
          id: 'config-invalid-build-path',
          artifact: 'config.json',
          filePath: rel,
          severity: 'mention',
          summary: `${rel} sets \`buildPath\` to ${JSON.stringify(raw.buildPath)}, which nothing reads. `
            + `The values are ${BUILD_PATH_VALUES.map((value) => `\`${value}\``).join(' and ')}.`,
          fix: 'Report the value. An unread `buildPath` does not fall back to the other path; '
            + 'it falls back to the default, so a project meaning `code` has been building comp-led.',
        }));
      }

      const detector = raw.detector;
      if (detector && typeof detector === 'object' && !Array.isArray(detector)) {
        const unknownDetector = Object.keys(detector).filter((key) => !KNOWN_DETECTOR_KEYS.has(key));
        if (unknownDetector.length) {
          findings.push(finding({
            id: 'config-unknown-detector-keys',
            artifact: 'config.json',
            filePath: rel,
            severity: 'mention',
            summary: `${rel} has \`detector\` key(s) nothing reads: ${unknownDetector.map((key) => `\`${key}\``).join(', ')}. `
              + `Recognized keys are ${[...KNOWN_DETECTOR_KEYS].map((key) => `\`${key}\``).join(', ')}.`,
            fix: 'Report the exact keys. `ignoreRule` for `ignoreRules` is the common one, and it silences nothing.',
          }));
        }
      }
    }
  }
  return findings;
}

/**
 * No recorded build-path preference on a project that plainly does visual
 * direction work. Not drift in the usual sense: the setting is newer than the
 * project, so every project that predates it lands here at once. That is why
 * it is gated twice, on a product record and on evidence of the work the
 * setting governs, and why it says the choice rather than assuming a harness
 * can make it. Image generation is the real precondition and this module
 * cannot see it: a harness-native image tool leaves no trace on disk, so the
 * finding hands the question to the one reader that knows.
 */
export function checkBuildPathUnset({ projectRoot, repoRoot, product }) {
  if (!projectRoot || !product) return [];
  const roots = [...new Set([projectRoot, repoRoot].filter(Boolean).map((root) => path.resolve(root)))];

  for (const root of roots) {
    for (const name of ['config.json', 'config.local.json']) {
      const raw = readJson(path.join(root, '.impeccable', name));
      // Any declared value ends this, valid or not: an invalid one already has
      // its own finding and two reports of one key is noise.
      if (raw && Object.prototype.hasOwnProperty.call(raw, 'buildPath')) return [];
    }
  }

  const evidence = DIRECTION_WORK_PATHS.filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
  if (!evidence.length) return [];

  return [finding({
    id: 'config-build-path-unset',
    artifact: 'config.json',
    filePath: '.impeccable/config.json',
    severity: 'mention',
    summary: 'This project has run visual direction work but records no `buildPath`, '
      + 'so every direction round takes the comp-first default without anyone having chosen it.',
    fix: 'Only when image generation exists in your tool surface, offer the choice once: '
      + '**comp-first** (an image sets the bar before any code; bolder composition, slower) or '
      + '**code-first** (build directly; ambition carried by the direction contract; leaner, faster). '
      + 'Write the answer to `.impeccable/config.json` as `"buildPath": "comp"` or `"buildPath": "code"`, '
      + 'merging with the keys already there. Without image generation there is no choice to record: stay silent.',
  })];
}

// ─── Surface briefs ────────────────────────────────────────────────────────

/**
 * A brief whose primary target no longer exists still resolves and still gets
 * injected as authority for a surface that is gone. Route and URL targets have
 * no file to check and are skipped.
 */
export function checkSurfaceBriefs({ candidates = [], projectRoot }) {
  if (!projectRoot) return [];
  const orphaned = [];
  for (const brief of candidates) {
    const target = brief?.primaryTarget;
    if (!target || typeof target !== 'string') continue;
    if (/^https?:\/\//i.test(target) || target.startsWith('route:')) continue;
    if (!fs.existsSync(path.join(projectRoot, target))) orphaned.push(brief);
  }
  if (!orphaned.length) return [];
  return [finding({
    id: 'surface-brief-orphaned',
    artifact: 'surface brief',
    filePath: orphaned.map((brief) => brief.path).filter(Boolean).join(', ') || null,
    severity: 'mention',
    summary: `${orphaned.length} persisted surface brief(s) name a primary target that no longer exists: `
      + `${orphaned.map((brief) => `${brief.path} → ${brief.primaryTarget}`).join('; ')}.`,
    fix: 'Ask whether the surface moved (repoint the brief) or was removed (delete the brief). '
      + 'Until then the brief is authority for a file that is gone.',
  })];
}

// ─── Monorepo structure ────────────────────────────────────────────────────

/**
 * `projectRoots` globs that match no directory. When every pattern misses,
 * candidate discovery returns nothing, the repo root silently becomes the
 * active project, and no other signal fires.
 *
 * Takes the candidate list rather than computing it: the boot path has already
 * paid for that walk, and this module must not pay for it twice.
 */
export function checkProjectRoots({ patterns = [], candidates = [], configuredIn = '.impeccable/config.json' }) {
  const positive = patterns.filter((pattern) => pattern && !String(pattern).trim().startsWith('!'));
  if (!positive.length || candidates.length) return [];
  return [finding({
    id: 'config-project-roots-match-nothing',
    artifact: 'config.json',
    filePath: configuredIn,
    severity: 'mention',
    summary: `\`projectRoots\` declares ${positive.map((pattern) => `\`${pattern}\``).join(', ')}, `
      + 'but no directory matches any of them, so the repo root is being treated as the active project.',
    fix: 'Report the patterns and ask which directories they should name. A renamed workspace folder is the usual cause.',
  })];
}

/**
 * Workspaces that inherit the repo-root PRODUCT.md. Inheritance is a feature,
 * not a defect, so this is reported as information for the doctor pass rather
 * than emitted at boot: the judgment call is whether the inherited record
 * actually describes that app.
 */
export function describeWorkspaceContext(candidates = []) {
  return candidates.map((candidate) => ({
    name: candidate.name,
    path: candidate.path,
    productStatus: candidate.productStatus,
    productPath: candidate.productPath,
    designStatus: candidate.designStatus,
    designPath: candidate.designPath,
  }));
}

// ─── Tier 1 orchestration ──────────────────────────────────────────────────

/**
 * Everything a boot can afford. `ctx` is the loadContext result; `extras`
 * carries values the caller already computed so nothing is recomputed here.
 */
export function collectBootFindings(ctx, extras = {}) {
  if (!ctx) return [];
  const projectRoot = ctx.projectRoot || process.cwd();
  const absProductPath = extras.absProductPath || null;
  const absDesignPath = extras.absDesignPath || null;

  return [
    ...checkProduct(ctx.product, ctx.productPath || 'PRODUCT.md'),
    // Only checked once a PRODUCT.md exists. Without one the boot already
    // emits NO_PRODUCT_MD and routes into init, which asks for the platform
    // directly; a second signal saying the same thing is noise.
    ...(ctx.product
      ? checkNativePlatformEvidence({
          projectRoot,
          platform: ctx.platform,
          product: ctx.product,
          productPath: ctx.productPath,
        })
      : []),
    ...checkDesignSidecar({
      designPath: absDesignPath,
      sidecarCandidates: extras.sidecarCandidates || [],
      projectRoot,
    }),
    ...checkConfig({ projectRoot, repoRoot: ctx.repoRoot }),
    ...checkBuildPathUnset({ projectRoot, repoRoot: ctx.repoRoot, product: ctx.product }),
    ...checkSurfaceBriefs({ candidates: ctx.surfaceBriefCandidates, projectRoot }),
    ...(extras.projectRootPatterns
      ? checkProjectRoots({
          patterns: extras.projectRootPatterns,
          candidates: extras.targetCandidates || [],
        })
      : []),
  ];
}
