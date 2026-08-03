#!/usr/bin/env node

/**
 * Build System for Cross-Provider Design Skills
 *
 * Transforms source skills into provider-specific formats:
 * - Cursor: .cursor/skills/
 * - Claude Code: .claude/skills/
 * - Gemini: .gemini/skills/
 * - Codex: dist/codex/ only (OpenAI-metadata bundle; not synced to repo root)
 * - Agents: .agents/skills/ (Codex repo/user installs)
 * - GitHub: .github/skills/ (GitHub Copilot)
 *
 * Also assembles a universal ZIP containing all providers,
 * and builds Tailwind CSS for production deployment.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readSourceFiles, readPatterns, stashPerProjectArtifacts, restorePerProjectArtifacts } from './lib/utils.js';
import { createTransformer, PROVIDERS } from './lib/transformers/index.js';
import { hooksJsonFor, buildClaudePluginHooksManifest } from './lib/transformers/hooks.js';
import { createAllZips, createProviderZip } from './lib/zip.js';
import { collectPluginVersions } from './lib/validate-plugin-versions.js';
import { collectPluginManifestFindings } from './lib/validate-plugin-manifest.js';
import { stageOpenAIPlugin } from './lib/openai-plugin.js';
import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';
// Sub-page generation is now handled by Astro content collections.

/**
 * Generate authoritative counts from source data and write to site/public/js/generated/counts.js.
 * Also validates that key HTML files reference the correct numbers.
 */
function generateCounts(rootDir, skills, buildDir) {
  // Count active commands. After the v3.0 consolidation, commands are sub-commands
  // of /impeccable. Count them from the command router table in SKILL.md.
  const impeccableSkill = skills.find(s => s.name === 'impeccable');
  let commandCount;
  if (impeccableSkill) {
    // Count lines in the command table that start with | `...` | — tolerant
    // of argument hints inside the backticks (e.g. `craft [feature]`) and of
    // multi-word commands (e.g. `pin <command>`).
    const routerMatches = impeccableSkill.body.match(/^\| `[^`]+` \|/gm);
    commandCount = routerMatches ? routerMatches.length : 0;
  } else {
    // Fallback: count user-invocable skills
    const activeCommands = skills.filter(s => {
      if (!s.userInvocable) return false;
      const content = fs.readFileSync(s.filePath, 'utf-8');
      return !content.includes('DEPRECATED');
    });
    commandCount = activeCommands.length;
  }

  // Count detection rules from the detector registry.
  const detectionCount = new Set(ANTIPATTERNS.map(rule => rule.id)).size;

  // Validate counts in key files
  const filesToCheck = [
    'site/pages/index.astro',
    'README.md',
    'README.npm.md',
    'AGENTS.md',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
  ];

  let errors = 0;
  for (const relPath of filesToCheck) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf-8');

    // Check for stale command counts (look for "N commands" or "N skills" patterns)
    // Strip changelog list content to avoid flagging historical counts
    const strippedContent = content.replace(/<ul class="changelog-items">[\s\S]*?<\/ul>/g, '');
    const countPattern = /\b(\d+)\s+(design\s+)?(commands|sub-commands|skills|steering commands)/gi;
    for (const match of strippedContent.matchAll(countPattern)) {
      const num = parseInt(match[1]);
      // Allow 1 (for "1 skill") and the correct count
      if (num !== commandCount && num !== 1) {
        console.error(`  ❌ ${relPath}: found "${match[0]}" but active command count is ${commandCount}`);
        errors++;
      }
    }

    // Check for stale detection counts. Use the changelog-stripped content
    // so historical counts in changelog entries (e.g. "28 rules" from an
    // older release) don't flag against the current detector total.
    // "detector" as an infix ("60 deterministic detector rules") and
    // qualified "issues" both evaded the old pattern, which is how five
    // stale counts shipped while the validator reported clean.
    const detectPattern = /\b(\d+)\s+(deterministic\s+)?(detector\s+)?(checks|patterns|rules|detections|issues)\b/gi;
    for (const match of strippedContent.matchAll(detectPattern)) {
      const num = parseInt(match[1]);
      if (match[4] === 'issues' && !match[2]) continue; // plain "issues" is prose, not a count claim
      if (num !== detectionCount && num > 10) { // ignore small numbers like "3 patterns"
        console.error(`  ❌ ${relPath}: found "${match[0]}" but detection count is ${detectionCount}`);
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.error(`\n❌ ${errors} stale count reference(s) found. Update them to match source of truth.`);
  }

  console.log(`✓ Generated counts: ${commandCount} commands, ${detectionCount} detection rules`);
  return errors;
}

/**
 * Guard against plugin/skill version drift (issue #274). The pure comparison
 * lives in ./lib/validate-plugin-versions.js (so it's unit-tested directly);
 * this wrapper owns the console output and the error count the build gates on.
 */
function validatePluginVersions(rootDir) {
  const { source, mismatches, errors } = collectPluginVersions(rootDir);
  // No root manifest at all → nothing to check (source null with no errors).
  if (source == null && errors.length === 0) return 0;

  for (const { relPath, reason } of errors) {
    console.error(`  ❌ ${relPath}: ${reason}`);
  }
  for (const { relPath, found, expected } of mismatches) {
    console.error(
      `  ❌ ${relPath}: version "${found}" disagrees with .claude-plugin/plugin.json "${expected}"`,
    );
  }

  const total = errors.length + mismatches.length;
  if (total > 0) {
    console.error(
      `\n❌ ${total} plugin/skill version problem(s). Bump every version together and run ` +
      `\`bun run build:release\` to regenerate the ./plugin subtree (issue #274).`,
    );
  } else {
    console.log(`✓ Plugin/skill versions agree: ${source}`);
  }
  return total;
}

/**
 * Guard against unverified plugin manifest shapes (PR #494). The pure check
 * lives in ./lib/validate-plugin-manifest.js (so it's unit-tested directly);
 * this wrapper owns the console output and the error count the build gates on.
 */
function validatePluginManifestShape(rootDir) {
  const findings = collectPluginManifestFindings(rootDir);
  for (const { relPath, reason } of findings) {
    console.error(`  ❌ ${relPath}: ${reason}`);
  }
  if (findings.length > 0) {
    console.error(
      `\n❌ ${findings.length} plugin manifest shape problem(s). Every manifest key is a ` +
      'claim about the Claude Code loader; see scripts/lib/validate-plugin-manifest.js (PR #494).',
    );
  } else {
    console.log('✓ Plugin manifest shape matches the verified loader contract');
  }
  return findings.length;
}

function validateSkillFrontmatter(skills) {
  let errors = 0;

  for (const skill of skills) {
    if (skill.description && skill.description.length > 1024) {
      console.error(`❌ ${skill.filePath}: invalid description: exceeds maximum length of 1024 characters (${skill.description.length})`);
      errors++;
    }
  }

  return errors;
}

/**
 * Scan user-facing copy for AI-prose anti-patterns:
 *   - em dashes (— or &mdash;)
 *   - double-hyphen substitutes (` -- `)
 *   - denylisted phrases that read as AI tells in marketing copy
 *
 * The denylist is the editorial brief in docs/STYLE.md, enforced. Each rule has a
 * rationale that prints with the failure so the next author understands why.
 *
 * Scope: every surface a reader sees. Not skill/, where
 * LLM-facing reference instructions can use technical phrasings the marketing
 * copy can't.
 *
 * Returns the number of occurrences found. Build fails if > 0.
 */
function validateProse(rootDir) {
  const targets = [
    'README.md',
    'README.npm.md',
  ];
  const extensions = new Set(['.html', '.md', '.js', '.mjs', '.css', '.astro']);
  // The slop catalog documents every antipattern by example, so it must
  // contain em dashes, buzzwords, and the rest as specimens. Exempt it from
  // the prose gate: its job is to show the slop, not to avoid it.
  const excludedPrefixes = [];
  const emDashPatterns = [/—/g, /&mdash;/gi, /&#8212;/gi, /&#x2014;/gi];
  // Phrase rules: { re, rationale }. Add to docs/STYLE.md when adding here.
  const phraseRules = [
    { re: /\bload-bearing\b/i, rationale: 'AI tell. Stolen-engineer diction; almost always vague. Name what the thing actually does.' },
    { re: /\bhighest-leverage\b/i, rationale: 'AI tell. Vague claim of impact. Say what specifically pays off.' },
    { re: /\bbiggest unlock\b/i, rationale: 'AI tell. Marketing-speak. Describe the actual change.' },
    { re: /\breflex defaults?\b/i, rationale: 'Internal jargon leaking into user-facing copy. Say "instincts" or "first guesses".' },
    { re: /\bcollapses? into monoculture\b/i, rationale: 'Internal eval-speak. Describe what actually went wrong.' },
    { re: /\bdata-driven\b/i, rationale: 'Empty marketing adjective. Cite the data instead.' },
    { re: /\bseamless(?:ly)?\b/i, rationale: 'Hollow positive. Say what specifically works without friction.' },
    { re: /\brobust(?:ness)?\b/i, rationale: 'Hollow positive. Cite the failure mode it handles.' },
    { re: /\bdelves?\b|\bdelved\b|\bdelving\b/i, rationale: 'Top AI tell. Use "explore", "look at", or just delete.' },
    { re: /\belevate(?:s|d)?\b/i, rationale: 'Marketing verb. Use the specific verb (improve, raise, sharpen).' },
    { re: /\bempower(?:s|ed|ing)?\b/i, rationale: 'Marketing verb. Use "let you" or "make possible".' },
    { re: /\bunderscore(?:s|d)?\b/i, rationale: 'AI tell. Use "show" or "make clear".' },
    { re: /\bpivotal\b/i, rationale: 'Hollow positive. Use "central", "key", or describe the role.' },
    { re: /\bin today's\b/i, rationale: 'Throat-clearing opener. Cut the clause; start at the point.' },
    { re: /\bgone are the days\b/i, rationale: 'Throat-clearing. Make the point directly.' },
    { re: /\bwhether you're\b/i, rationale: 'Audience-pandering. Pick one reader; write to them.' },
    { re: /\blet's dive in\b/i, rationale: 'Throat-clearing. Just start.' },
    { re: /\bin summary\b|\bin conclusion\b/i, rationale: 'Summarizing closer. End on the strongest sentence; trust the reader.' },
    { re: /\bmoreover\b|\bfurthermore\b/i, rationale: 'Transition crutch on a metronome. Drop, or use "also".' },
    { re: /\btapestry\b/i, rationale: 'AI scenery noun. Cut.' },
  ];
  let errors = 0;

  const checkLine = (line, rel, lineNum) => {
    for (const re of emDashPatterns) {
      if (re.test(line)) {
        console.error(`  ❌ ${rel}:${lineNum}: em dash → ${line.trim().slice(0, 120)}`);
        console.error(`        Use commas, colons, semicolons, periods, or parentheses.`);
        errors++;
        re.lastIndex = 0;
        break;
      }
      re.lastIndex = 0;
    }
    if (/ -- /.test(line)) {
      console.error(`  ❌ ${rel}:${lineNum}: \` -- \` em-dash substitute → ${line.trim().slice(0, 120)}`);
      console.error(`        Worse than the em dash. Pick real punctuation.`);
      errors++;
    }
    for (const rule of phraseRules) {
      if (rule.re.test(line)) {
        const matched = line.match(rule.re)?.[0] ?? '';
        console.error(`  ❌ ${rel}:${lineNum}: "${matched}" → ${line.trim().slice(0, 120)}`);
        console.error(`        ${rule.rationale}`);
        errors++;
      }
    }
  };

  const scan = (absPath, rel) => {
    // Normalize to POSIX separators so the forward-slash excludedPrefixes match
    // on Windows, where path.join() produces backslash-separated rel paths.
    const relPosix = rel.split(path.sep).join('/');
    if (excludedPrefixes.some(p => relPosix === p || relPosix.startsWith(p + '/'))) return;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absPath)) {
        scan(path.join(absPath, entry), path.join(rel, entry));
      }
      return;
    }
    if (!extensions.has(path.extname(absPath))) return;
    const src = fs.readFileSync(absPath, 'utf-8');
    const lines = src.split('\n');
    lines.forEach((line, i) => checkLine(line, rel, i + 1));
  };

  for (const target of targets) {
    const full = path.join(rootDir, target);
    if (fs.existsSync(full)) scan(full, target);
  }

  if (errors === 0) {
    console.log(`✓ Prose validator: no AI tells in user-facing copy`);
  } else {
    console.error(`\n❌ ${errors} prose issue(s) in user-facing copy. See docs/STYLE.md for the rules.`);
  }
  return errors;
}

/**
 * Narrow prose check for the impeccable skill source.
 *
 * The full validateProse rules don't fit LLM-facing reference instructions:
 * the hardening repetition and triadic checklists those files use exist on
 * purpose, and the structural-prose rules in docs/STYLE.md require human judgment.
 * This validator only enforces the mechanical wins: em dashes (which are
 * pure punctuation laziness regardless of audience) and the small handful
 * of denylisted phrases that have no technical reading. Em-dash creep is the
 * only thing likely to come back at scale once humans stop watching.
 *
 * Returns the number of occurrences found. Build fails if > 0.
 */
function validateSkillProse(rootDir) {
  const target = 'skill';
  const extensions = new Set(['.md']);
  const emDashPatterns = [/—/g, /&mdash;/gi, /&#8212;/gi, /&#x2014;/gi];
  // Tighter than validateProse: only the rules that have no technical reading.
  // Skipping `data-driven` here would be a mistake (it slipped through twice
  // in live.md before this pass); but `seamless`, `robust`, etc. have
  // legitimate technical uses elsewhere we may want to allow.
  const phraseRules = [
    { re: /\bload-bearing\b/i, rationale: 'AI tell. Name what the thing actually does.' },
    { re: /\bhighest-leverage\b/i, rationale: 'AI tell. Say what specifically pays off.' },
    { re: /\bbiggest unlock\b/i, rationale: 'Marketing-speak. Describe the actual change.' },
    { re: /\breflex defaults?\b/i, rationale: 'Internal jargon. Say "instincts" or "first guesses".' },
    { re: /\bcollapses? into monoculture\b/i, rationale: 'Eval-speak. Describe what actually went wrong.' },
    { re: /\bdata-driven\b/i, rationale: 'Empty marketing adjective. Cite the data instead.' },
    { re: /\bdelves?\b|\bdelved\b|\bdelving\b/i, rationale: 'Top AI tell. Use "explore" or "look at".' },
    { re: /\btapestry\b/i, rationale: 'AI scenery noun. Cut.' },
    { re: /\bin today's\b/i, rationale: 'Throat-clearing opener. Start at the point.' },
    { re: /\bgone are the days\b/i, rationale: 'Throat-clearing. Make the point directly.' },
    { re: /\blet's dive in\b/i, rationale: 'Throat-clearing. Just start.' },
    { re: /\bin summary\b|\bin conclusion\b/i, rationale: 'Summarizing closer. End on the strongest sentence.' },
  ];
  let errors = 0;

  const checkLine = (line, rel, lineNum) => {
    for (const re of emDashPatterns) {
      if (re.test(line)) {
        console.error(`  ❌ ${rel}:${lineNum}: em dash → ${line.trim().slice(0, 120)}`);
        console.error(`        Use commas, colons, semicolons, periods, or parentheses.`);
        errors++;
        re.lastIndex = 0;
        break;
      }
      re.lastIndex = 0;
    }
    if (/ -- /.test(line)) {
      console.error(`  ❌ ${rel}:${lineNum}: \` -- \` em-dash substitute → ${line.trim().slice(0, 120)}`);
      console.error(`        Worse than the em dash. Pick real punctuation.`);
      errors++;
    }
    for (const rule of phraseRules) {
      if (rule.re.test(line)) {
        const matched = line.match(rule.re)?.[0] ?? '';
        console.error(`  ❌ ${rel}:${lineNum}: "${matched}" → ${line.trim().slice(0, 120)}`);
        console.error(`        ${rule.rationale}`);
        errors++;
      }
    }
  };

  const scan = (absPath, rel) => {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absPath)) {
        scan(path.join(absPath, entry), path.join(rel, entry));
      }
      return;
    }
    if (!extensions.has(path.extname(absPath))) return;
    const src = fs.readFileSync(absPath, 'utf-8');
    const lines = src.split('\n');
    lines.forEach((line, i) => checkLine(line, rel, i + 1));
  };

  const full = path.join(rootDir, target);
  if (fs.existsSync(full)) scan(full, target);

  if (errors === 0) {
    console.log(`✓ Skill prose validator: skill/ is clean`);
  } else {
    console.error(`\n❌ ${errors} prose issue(s) in skill/. See docs/STYLE.md.`);
  }
  return errors;
}

/**
 * Validate that every hand-authored HTML page carries the shared site header.
 * The partial is stamped with `<!-- site-header v1 -->` so drift is loud.
 *
 * Returns the number of validation errors. Build fails if > 0.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Make an existing directory match a generated source without removing the
 * destination root. Provider skill roots can be watched by the running agent;
 * replacing that root fails on some platforms and can invalidate the live
 * skill path mid-session.
 */
function mirrorDirContentsSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const sourceEntries = new Map(
    fs.readdirSync(src, { withFileTypes: true }).map(entry => [entry.name, entry]),
  );

  for (const destEntry of fs.readdirSync(dest, { withFileTypes: true })) {
    if (!sourceEntries.has(destEntry.name)) {
      fs.rmSync(path.join(dest, destEntry.name), { recursive: true, force: true });
    }
  }

  for (const entry of sourceEntries.values()) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const destStat = fs.existsSync(destPath) ? fs.lstatSync(destPath) : null;
    if (entry.isDirectory()) {
      if (destStat && !destStat.isDirectory()) fs.rmSync(destPath, { recursive: true, force: true });
      mirrorDirContentsSync(srcPath, destPath);
    } else {
      if (destStat?.isDirectory()) fs.rmSync(destPath, { recursive: true, force: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function syncRootHookManifests(rootDir) {
  const synced = [];
  for (const config of Object.values(PROVIDERS)) {
    if (!config.emitHooks) continue;
    const manifest = hooksJsonFor(config.emitHooks, { configDir: config.configDir });
    if (!manifest) continue;
    const rel = config.hooksManifestRel || path.join('hooks', 'hooks.json');
    const dest = path.join(rootDir, config.configDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
    synced.push(path.join(config.configDir, rel).split(path.sep).join('/'));
  }
  return synced;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function parseBuildOptions(argv = process.argv.slice(2)) {
  const skipRootSync = argv.includes('--skip-root-sync') || argv.includes('--no-root-sync');
  return {
    syncRootOutputs: !skipRootSync,
  };
}

const BUILD_OPTIONS = parseBuildOptions();

// buildStaticSite (Bun HTML bundler) removed — now handled by Astro.

/**
 * Assemble universal directory from all provider outputs
 */
function assembleUniversal(distDir) {
  const universalDir = path.join(distDir, 'universal');

  // Clean and recreate
  if (fs.existsSync(universalDir)) {
    fs.rmSync(universalDir, { recursive: true, force: true });
  }

  const providerConfigs = Object.values(PROVIDERS);

  for (const { provider, configDir } of providerConfigs) {
    const src = path.join(distDir, provider, configDir);
    const dest = path.join(universalDir, configDir);
    if (fs.existsSync(src)) {
      copyDirSync(src, dest);
    }
  }

  // Add a visible README so macOS users don't see an empty folder
  // (all provider dirs are dotfiles, hidden by default in Finder)
  fs.writeFileSync(path.join(universalDir, 'README.txt'),
`Impeccable. Design fluency for AI harnesses.
https://impeccable.style

This folder contains skills for all supported tools:

  .cursor/    -> Cursor
  .claude/    -> Claude Code
  .gemini/    -> Gemini CLI
  .codex/     -> Codex custom agents (Codex skills use .agents/)
  .agents/    -> Codex CLI
  .agent/     -> Antigravity
  .github/    -> GitHub Copilot
  .grok/      -> Grok Build
  .kiro/      -> Kiro
  .opencode/  -> OpenCode
  .pi/        -> Pi
  .trae-cn/   -> Trae China
  .trae/      -> Trae International
  .rovodev/   -> Rovo Dev
  .vibe/      -> Mistral Vibe
  .qoder/     -> Qoder

To install, copy the relevant folder(s) into your project root.
For Codex, repo and user skill installs come from .agents/skills.
These are hidden folders (dotfiles). Press Cmd+Shift+. in Finder to see them.
`);

  console.log(`✓ Assembled universal directory (${providerConfigs.length} providers)`);
}

/**
 * Copy dist files to build output for Cloudflare Pages Functions access.
 * Download functions use env.ASSETS.fetch() to read these files.
 */
function copyDistToBuild(distDir, buildDir) {
  const destDir = path.join(buildDir, '_data', 'dist');
  copyDirSync(distDir, destDir);
  console.log('✓ Copied dist files to build output');
}

/**
 * Generate Cloudflare Pages config files (_headers, _redirects)
 */
async function build() {
  console.log('🔨 Building cross-provider design skills...\n');

  // Sub-page generation, HTML bundling, and static-asset copying are now
  // handled by Astro (bun run build:site). This script focuses on skills,
  // API data, and Cloudflare config.

  const buildDir = path.join(ROOT_DIR, 'build');

  // Read source files (unified skills architecture)
  const { skills } = readSourceFiles(ROOT_DIR);
  const patterns = readPatterns(ROOT_DIR);
  const userInvocableCount = skills.filter(s => s.userInvocable).length;
  console.log(`📖 Read ${skills.length} skills (${userInvocableCount} user-invocable) and ${patterns.patterns.length + patterns.antipatterns.length} pattern categories\n`);

  const frontmatterErrors = validateSkillFrontmatter(skills);
  if (frontmatterErrors > 0) {
    process.exit(1);
  }

  // Read skills version from plugin.json
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, '.claude-plugin/plugin.json'), 'utf-8'));
  const skillsVersion = pluginJson.version;

  // Transform for each provider
  for (const config of Object.values(PROVIDERS)) {
    const transform = createTransformer(config);
    transform(skills, DIST_DIR, { skillsVersion });
  }

  // Assemble universal directory
  assembleUniversal(DIST_DIR);

  // Create ZIP bundles (individual + universal)
  await createAllZips(DIST_DIR);


  if (BUILD_OPTIONS.syncRootOutputs) {
    // Copy all provider outputs to project root for direct GitHub installs and
    // submodule users. `.codex/` is intentionally excluded: Codex no longer
    // consumes that layout; keep generated Codex bundles under dist/ only.
    const syncConfigs = Object.values(PROVIDERS).filter(({ configDir }) => configDir !== '.codex');

    for (const { provider, configDir } of syncConfigs) {
      const skillsSrc = path.join(DIST_DIR, provider, configDir, 'skills');
      const skillsDest = path.join(ROOT_DIR, configDir, 'skills');

      if (fs.existsSync(skillsSrc)) {
        // Preserve legacy per-project script artifacts (e.g. live-mode config.json)
        // while replacing only skills generated by this build. Removing the
        // whole provider skills directory can erase unrelated repo-local skills,
        // and watched directories such as `.agents/skills` may reject the parent
        // removal while Codex is using them.
        const stashed = stashPerProjectArtifacts(skillsDest);
        fs.mkdirSync(skillsDest, { recursive: true });
        for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
          const generatedDest = path.join(skillsDest, entry.name);
          if (entry.isDirectory()) mirrorDirContentsSync(path.join(skillsSrc, entry.name), generatedDest);
          else fs.copyFileSync(path.join(skillsSrc, entry.name), generatedDest);
        }
        restorePerProjectArtifacts(skillsDest, stashed);
      }
    }

    for (const { provider, configDir, agentFormat } of Object.values(PROVIDERS)) {
      if (!agentFormat) continue;

      const agentsSrc = path.join(DIST_DIR, provider, configDir, 'agents');
      const agentsDest = path.join(ROOT_DIR, configDir, 'agents');

      if (fs.existsSync(agentsDest)) fs.rmSync(agentsDest, { recursive: true, force: true });
      if (fs.existsSync(agentsSrc)) {
        copyDirSync(agentsSrc, agentsDest);
      }
    }

    const syncedHooks = syncRootHookManifests(ROOT_DIR);
    if (syncedHooks.length > 0) {
      console.log(`🪝 Synced hook manifests to: ${syncedHooks.join(', ')}`);
    }

    // Remove deprecated skill stubs from local harness dirs. They exist
    // in dist/ so the cleanup script can redirect users, but they should
    // not clutter the repo's own skill directories.
    const deprecatedLocalSkills = [
      'frontend-design', 'teach-impeccable',
      'arrange', 'normalize', 'onboard', 'extract',
      // v3.0 consolidation: standalone skills -> /impeccable sub-commands
      'adapt', 'animate', 'audit', 'bolder', 'clarify', 'colorize',
      'critique', 'delight', 'distill', 'harden', 'layout', 'optimize',
      'overdrive', 'polish', 'quieter', 'shape', 'typeset',
    ];
    for (const { configDir } of syncConfigs) {
      for (const name of deprecatedLocalSkills) {
        const p = path.join(ROOT_DIR, configDir, 'skills', name);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      }
    }

    console.log(`📋 Synced skills to: ${syncConfigs.map(p => p.configDir).join(', ')}`);

    // Build the shared plugin subtree at ./plugin/.
    // Claude Code marketplace is configured with `source: "./plugin"`, so the
    // plugin cache only copies this slim directory (~0.3 MB) instead of the
    // entire monorepo. Grok Build installs the same subtree via
    // `grok plugin install pbakaus/impeccable#plugin --trust` (or the
    // marketplace source). The harness dirs above stay where they are because
    // `npx skills add pbakaus/impeccable` reads them from the GitHub repo.
    const pluginRoot = path.join(ROOT_DIR, 'plugin');
    const pluginManifestDir = path.join(pluginRoot, '.claude-plugin');
    const grokPluginManifestDir = path.join(pluginRoot, '.grok-plugin');
    const pluginSkillsDir = path.join(pluginRoot, 'skills');
    const pluginAgentsDir = path.join(pluginRoot, 'agents');
    const pluginHooksDir = path.join(pluginRoot, 'hooks');
    if (fs.existsSync(pluginManifestDir)) fs.rmSync(pluginManifestDir, { recursive: true });
    if (fs.existsSync(grokPluginManifestDir)) fs.rmSync(grokPluginManifestDir, { recursive: true });
    if (fs.existsSync(pluginSkillsDir)) fs.rmSync(pluginSkillsDir, { recursive: true });
    if (fs.existsSync(pluginAgentsDir)) fs.rmSync(pluginAgentsDir, { recursive: true });
    if (fs.existsSync(pluginHooksDir)) fs.rmSync(pluginHooksDir, { recursive: true });
    // Clean up the short-lived mixed-provider subtree from early OpenAI plugin
    // development. The canonical Codex preview now lives in dist/openai/.
    for (const staleRel of ['.codex-plugin', 'assets']) {
      const stalePath = path.join(pluginRoot, staleRel);
      if (fs.existsSync(stalePath)) fs.rmSync(stalePath, { recursive: true });
    }

    const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, '.claude-plugin/plugin.json'), 'utf-8'));
    const claudeAgentsSrc = path.join(DIST_DIR, 'claude-code', '.claude', 'agents');
    // Trailing slash on the skills path matches the documented schema in
    // code.claude.com/docs/en/plugins-reference. Issue #86 has 3 reporters
    // converging on "add trailing slash to fix slash commands not registering";
    // the docs schema example consistently uses `"./custom/skills/"` form.
    const pluginManifest = { ...rootManifest, skills: './skills/' };
    // No `agents` key: Claude Code discovers agents/*.md by itself, and the
    // identifier it uses is the file name. Declaring the key as an array of
    // file paths makes it load ZERO agents, so the four shipped subagents were
    // never reachable. The other plausible shapes are worse: a string, or an
    // array containing a directory, and the whole plugin fails to load.
    // Omitting the key is the only shape that works.
    delete pluginManifest.agents;
    fs.mkdirSync(pluginManifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginManifestDir, 'plugin.json'),
      JSON.stringify(pluginManifest, null, 2) + '\n',
    );

    // Native Grok plugin manifest. Grok also reads `.claude-plugin/`; dual
    // manifests keep both marketplaces and `grok plugin validate` happy when
    // Claude compat is disabled.
    // https://docs.x.ai/build/features/skills-plugins-marketplaces
    const grokPluginManifest = {
      name: pluginManifest.name,
      version: pluginManifest.version,
      description: pluginManifest.description,
      author: pluginManifest.author,
      homepage: pluginManifest.homepage,
      repository: pluginManifest.repository,
      license: pluginManifest.license || 'MIT',
      keywords: ['design', 'frontend', 'ui', 'ux', 'skills', 'hooks'],
    };
    fs.mkdirSync(grokPluginManifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(grokPluginManifestDir, 'plugin.json'),
      JSON.stringify(grokPluginManifest, null, 2) + '\n',
    );

    const claudeSkillsSrc = path.join(DIST_DIR, 'claude-code', '.claude', 'skills', 'impeccable');
    if (fs.existsSync(claudeSkillsSrc)) {
      fs.mkdirSync(pluginSkillsDir, { recursive: true });
      copyDirSync(claudeSkillsSrc, path.join(pluginSkillsDir, 'impeccable'));
    }

    if (fs.existsSync(claudeAgentsSrc)) {
      copyDirSync(claudeAgentsSrc, pluginAgentsDir);
    }

    // Ship the design detector as a plugin-packaged hook. Claude Code and
    // Grok Build both auto-discover `hooks/hooks.json` at the plugin root
    // (Grok aliases CLAUDE_PLUGIN_ROOT → GROK_PLUGIN_ROOT), so marketplace /
    // plugin-install users get PostToolUse + Stop without merging into project
    // settings (that path remains the CLI's job for project-scoped installs).
    fs.mkdirSync(pluginHooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginHooksDir, 'hooks.json'),
      JSON.stringify(buildClaudePluginHooksManifest(), null, 2) + '\n',
    );

    console.log('📦 Built Claude Code / Grok Build plugin subtree at ./plugin/');
  } else {
    console.log('📋 Skipped root harness and plugin sync (--skip-root-sync)');
  }

  // The public OpenAI plugin is a Codex artifact, not a copy of the tracked
  // Claude marketplace subtree. Build it on every source-first build so the
  // upload ZIP and local preview directory cannot drift behind provider output.
  const openAiPluginRoot = stageOpenAIPlugin(ROOT_DIR, DIST_DIR);
  await createProviderZip(openAiPluginRoot, DIST_DIR, 'openai-plugin');

  // Generate authoritative counts and validate references
  const countErrors = generateCounts(ROOT_DIR, skills, buildDir);

  // Guard plugin/skill version drift: marketplace + ./plugin subtree must
  // match root plugin.json so marketplace installs never ship a stale version.
  const versionErrors = validatePluginVersions(ROOT_DIR);

  // Guard the generated plugin manifest's shape: a key the Claude Code loader
  // does not honor (like the agents array, PR #494) ships silently broken.
  const manifestShapeErrors = validatePluginManifestShape(ROOT_DIR);

  // Scan user-facing copy for AI tells (em dashes, marketing fluff, denylisted phrases)
  const proseErrors = validateProse(ROOT_DIR);

  // Narrow scan of LLM-facing skill instructions: em dashes + a tighter denylist
  // that has no technical reading. Hardening repetition is intentionally allowed.
  const skillProseErrors = validateSkillProse(ROOT_DIR);

  if (countErrors > 0 || versionErrors > 0 || manifestShapeErrors > 0 || proseErrors > 0 || skillProseErrors > 0) {
    process.exit(1);
  }

  console.log('\n✨ Build complete!');
}

// Run the build. A rejection here (e.g. the release zip failing to build) must
// exit non-zero so a broken artifact never deploys silently.
build().catch((err) => {
  console.error(`\n❌ Build failed: ${err.message}`);
  process.exit(1);
});
