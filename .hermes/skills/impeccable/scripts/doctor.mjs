#!/usr/bin/env node
/**
 * Deep staleness pass over Impeccable's own project artifacts.
 *
 *   node doctor.mjs                 # human-readable report
 *   node doctor.mjs --json          # machine-readable, for the skill command
 *   node doctor.mjs --fix           # apply the mechanical migrations only
 *   node doctor.mjs --target <path> # pick a monorepo workspace
 *
 * The boot check in context.mjs reports what a session can afford to measure.
 * This runs everything: git drift, per-workspace sweep, ignore-list validation
 * against the live rule registry, hook script resolution.
 *
 * `--fix` is deliberately narrow. It performs only the migrations marked
 * severity 'auto', the ones with no judgment in them: stamp the product record,
 * move a sidecar out of a retired location. Anything that needs an answer from
 * the user (a platform value, whether an inherited record still describes an
 * app, whether a document has drifted from the code) is reported and left
 * alone. Exit code is 0 unless the run itself failed; findings are not errors.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContext, extractPlatform, resolveTargetSelection } from './context.mjs';
import { parseTargetOptions } from './lib/target-args.mjs';
import { IMPECCABLE_COMMAND, IMPECCABLE_PROVIDER_ID } from './lib/provider.mjs';
import { parseDesignMd } from './lib/design-parser.mjs';
import {
  PRODUCT_SCHEMA_VERSION,
  readProductSchemaVersion,
  stampProductSchema,
} from './lib/artifact-schema.mjs';
import {
  collectBootFindingGroups,
  checkNativePlatformEvidence,
  designSidecarCandidatesFor,
} from './lib/staleness.mjs';
import {
  checkDesignCoverage,
  checkDesignDrift,
  checkDetectorIgnores,
  checkHookInstallation,
  checkLegacyLiveState,
  checkWorkspaces,
  loadKnownRuleIds,
} from './lib/staleness-deep.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const passthrough = [];
  const flags = { json: false, fix: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--fix') flags.fix = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else passthrough.push(arg);
  }
  return { flags, targetOptions: parseTargetOptions(passthrough, { strict: true }) };
}

function usage() {
  return [
    `Usage: node doctor.mjs [--json] [--fix] [--target <path>]`,
    '',
    "Report drift between this project's Impeccable artifacts and what the",
    'installed version reads: PRODUCT.md, DESIGN.md and its sidecar,',
    '.impeccable/config.json, surface briefs, and the design hook.',
    '',
    '  --json           Emit findings as JSON.',
    '  --fix            Apply the mechanical migrations (severity "auto") only.',
    '  --target <path>  Select a workspace in a monorepo.',
  ].join('\n');
}

async function collect(cwd, targetOptions) {
  const ctx = loadContext(cwd, targetOptions);
  const projectRoot = ctx.projectRoot || cwd;
  const absProductPath = ctx.productPath ? path.resolve(cwd, ctx.productPath) : null;
  const absDesignPath = ctx.designPath ? path.resolve(cwd, ctx.designPath) : null;
  const sidecarCandidates = designSidecarCandidatesFor(projectRoot, ctx.contextDir);
  const knownRuleIds = await loadKnownRuleIds(SCRIPTS_DIR);

  const selection = resolveTargetSelection(cwd, targetOptions);
  const workspaceCandidates = selection?.targetCandidates || [];

  const workspaceResult = checkWorkspaces({
    repoRoot: ctx.repoRoot,
    candidates: workspaceCandidates,
    checkNativePlatformEvidence,
    extractPlatform,
    readFile: safeRead,
  });
  const bootFindings = collectBootFindingGroups(ctx, {
    absDesignPath,
    sidecarCandidates,
    projectRootPatterns: readProjectRootPatterns(ctx.repoRoot),
    targetCandidates: workspaceCandidates,
  });

  const findings = [
    ...bootFindings.product,
    ...bootFindings.nativePlatform,
    ...bootFindings.designSidecar,
    ...checkDesignDrift({ designPath: absDesignPath, projectRoot }),
    ...checkDesignCoverage({ design: ctx.design, designPath: ctx.designPath, parseDesignMd }),
    ...bootFindings.config,
    ...bootFindings.buildPath,
    ...checkDetectorIgnores({ projectRoot, knownRuleIds }),
    ...bootFindings.surfaceBriefs,
    ...checkHookInstallation({
      projectRoot,
      repoRoot: ctx.repoRoot,
      providerId: IMPECCABLE_PROVIDER_ID,
    }),
    ...checkLegacyLiveState({ projectRoot }),
    ...bootFindings.projectRoots,
    ...workspaceResult.findings,
  ];

  return {
    ctx,
    projectRoot,
    absProductPath,
    sidecarCandidates,
    findings,
    workspaces: workspaceResult.workspaces,
    ruleRegistryAvailable: knownRuleIds !== null,
  };
}

// Read straight from disk rather than importing context.mjs's private reader.
// Only the positive/negative pattern strings matter here.
function readProjectRootPatterns(repoRoot) {
  if (!repoRoot) return [];
  const patterns = [];
  for (const name of ['config.json', 'config.local.json']) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, '.impeccable', name), 'utf-8'));
      if (Array.isArray(raw?.projectRoots)) {
        for (const entry of raw.projectRoots) {
          if (typeof entry === 'string' && entry.trim()) patterns.push(entry.trim());
        }
      }
    } catch { /* missing or malformed: nothing to check */ }
  }
  return patterns;
}

/**
 * Apply the migrations that carry no decision. Returns what was done and what
 * was deliberately left for the user.
 */
function applyFixes(report) {
  const applied = [];
  const skipped = [];

  for (const entry of report.findings) {
    if (entry.severity !== 'auto') {
      skipped.push({ id: entry.id, reason: 'needs a decision from the user' });
      continue;
    }
    if (entry.id === 'design-sidecar-legacy-path') {
      const canonical = report.sidecarCandidates[0];
      const present = report.sidecarCandidates.find((candidate) => fs.existsSync(candidate));
      if (!canonical || !present || path.resolve(canonical) === path.resolve(present)) continue;
      if (fs.existsSync(canonical)) {
        skipped.push({ id: entry.id, reason: `${rel(canonical, report.projectRoot)} already exists; not overwriting` });
        continue;
      }
      fs.mkdirSync(path.dirname(canonical), { recursive: true });
      fs.renameSync(present, canonical);
      applied.push(`Moved ${rel(present, report.projectRoot)} to ${rel(canonical, report.projectRoot)}.`);
      continue;
    }
    if (entry.id === 'legacy-live-state') {
      // Reported, never deleted here: a running live session still reads these,
      // and losing session state to a doctor run is a worse outcome than a
      // stale file. The report says what to remove and when.
      skipped.push({ id: entry.id, reason: 'delete by hand once no live session is running' });
      continue;
    }
    skipped.push({ id: entry.id, reason: 'no automatic migration implemented' });
  }

  // Stamping the product record is additive and safe, and it is what stops a
  // later version proposing an interview the user has already sat through.
  const productPath = report.absProductPath;
  if (productPath && report.ctx.product && readProductSchemaVersion(report.ctx.product) === null
    && !report.findings.some((entry) => entry.id === 'product-schema-legacy')) {
    fs.writeFileSync(productPath, stampProductSchema(report.ctx.product), 'utf-8');
    applied.push(`Stamped ${rel(productPath, report.projectRoot)} as product-schema ${PRODUCT_SCHEMA_VERSION}.`);
  }

  return { applied, skipped };
}

function rel(filePath, root) {
  const value = path.relative(root, filePath);
  return value && !value.startsWith('..') ? value.split(path.sep).join('/') : filePath;
}

const SEVERITY_LABEL = {
  auto: 'automatic',
  mention: 'worth saying',
  route: 'needs a command',
};

function renderText(report, fixes) {
  const lines = [];
  const { findings } = report;

  lines.push(`Impeccable doctor: ${rel(report.projectRoot, process.cwd()) || '.'}`);
  if (report.ctx.isMonorepo) {
    lines.push(`Monorepo, repo root ${rel(report.ctx.repoRoot, process.cwd()) || '.'}.`);
  }
  lines.push('');

  if (!findings.length) {
    lines.push('No drift found. Every artifact matches what this version reads.');
  } else {
    const order = ['route', 'mention', 'auto'];
    for (const severity of order) {
      const group = findings.filter((entry) => entry.severity === severity);
      if (!group.length) continue;
      lines.push(`${SEVERITY_LABEL[severity]} (${group.length}):`);
      for (const entry of group) {
        lines.push(`  ${entry.id}${entry.path ? `  [${entry.path}]` : ''}`);
        lines.push(`    ${entry.summary}`);
        lines.push(`    → ${entry.fix}`);
      }
      lines.push('');
    }
  }

  if (report.workspaces.length) {
    lines.push('Workspaces:');
    for (const workspace of report.workspaces) {
      lines.push(`  ${workspace.path}  product: ${workspace.productStatus}`
        + `  design: ${workspace.designStatus}`
        + `${workspace.platform ? `  platform: ${workspace.platform}` : ''}`);
    }
    lines.push('');
  }

  if (!report.ruleRegistryAvailable) {
    lines.push('Note: the bundled detector could not be resolved, so ignored rule ids were not validated.');
    lines.push('');
  }

  if (fixes) {
    lines.push(fixes.applied.length ? 'Applied:' : 'Applied nothing.');
    for (const entry of fixes.applied) lines.push(`  ${entry}`);
    const held = fixes.skipped.filter((entry) => entry.reason !== 'needs a decision from the user');
    if (held.length) {
      lines.push('Left alone:');
      for (const entry of held) lines.push(`  ${entry.id}: ${entry.reason}`);
    }
  } else if (findings.some((entry) => entry.severity === 'auto')) {
    lines.push(`Run \`node doctor.mjs --fix\` to apply the automatic migrations, `
      + `or \`${IMPECCABLE_COMMAND} doctor\` to work through all of them.`);
  }

  return lines.join('\n');
}

async function cli() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  if (parsed.flags.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = await collect(process.cwd(), parsed.targetOptions);
  const fixes = parsed.flags.fix ? applyFixes(report) : null;

  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify({
      projectRoot: report.projectRoot,
      repoRoot: report.ctx.repoRoot,
      isMonorepo: report.ctx.isMonorepo,
      productPath: report.ctx.productPath,
      designPath: report.ctx.designPath,
      platform: report.ctx.platform,
      ruleRegistryAvailable: report.ruleRegistryAvailable,
      findings: report.findings,
      workspaces: report.workspaces,
      ...(fixes ? { fixes } : {}),
    }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderText(report, fixes)}\n`);
}

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
  cli().catch((err) => {
    process.stderr.write(`impeccable doctor failed: ${err?.message || err}\n`);
    process.exit(1);
  });
}

export { collect, applyFixes, renderText };
