/**
 * `impeccable skills` subcommand
 *
 * Usage:
 *   impeccable skills help      Show all available skills and commands
 *   impeccable skills install   Install compiled skills from the universal bundle
 *   impeccable skills update    Update skills to latest version
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, unlinkSync, mkdirSync, writeFileSync, rmSync, renameSync, createWriteStream, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import extract from 'extract-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://impeccable.style';

// Provider folder names in project roots
const PROVIDER_DIRS = ['.claude', '.cursor', '.gemini', '.agents', '.github', '.kiro', '.opencode', '.pi', '.qoder', '.trae', '.trae-cn'];

// When a project has no harness folder yet, infer the target from globally
// installed harnesses (~/.claude, ~/.codex, ...). Codex reads skills from
// .agents/skills, so ~/.codex maps to the .agents bundle variant.
const GLOBAL_HARNESS_HINTS = [
  { home: '.claude', provider: '.claude' },
  { home: '.codex', provider: '.agents' },
  { home: '.cursor', provider: '.cursor' },
  { home: '.gemini', provider: '.gemini' },
  { home: '.kiro', provider: '.kiro' },
  { home: '.opencode', provider: '.opencode' },
  { home: '.qoder', provider: '.qoder' },
];

// Last-resort default when nothing is detected: Claude Code + the universal
// (.agents, also Codex) folder, which covers the most common setups.
const DEFAULT_TARGETS = ['.claude', '.agents'];

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim().toLowerCase()); }));
}

// ─── skills help ──────────────────────────────────────────────────────────────

async function showHelp() {
  let commands;
  try {
    const res = await fetch(`${API_BASE}/api/commands`);
    commands = await res.json();
  } catch {
    console.error('Could not fetch command list from impeccable.style. Check your network connection.');
    process.exit(1);
  }

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

  console.log('\n  Impeccable Skills & Commands\n');
  console.log('  Install:  npx impeccable skills install');
  console.log('  Update:   npx impeccable skills update');
  console.log('  Docs:     https://impeccable.style/cheatsheet\n');
  console.log(`  ${pad('Command', 22)} Description`);
  console.log(`  ${'-'.repeat(22)} ${'-'.repeat(52)}`);

  for (const cmd of commands.sort((a, b) => a.id.localeCompare(b.id))) {
    // Trim description to fit terminal
    const desc = cmd.description.length > 72
      ? cmd.description.substring(0, 69) + '...'
      : cmd.description;
    console.log(`  ${pad('/' + cmd.id, 22)} ${desc}`);
  }
  console.log(`\n  ${commands.length} commands available. Run /<command> in your AI harness.\n`);
}

// ─── version helpers ─────────────────────────────────────────────────────────

/**
 * Read the skills version from the impeccable SKILL.md frontmatter.
 */
function getSkillsVersion(root) {
  for (const d of PROVIDER_DIRS) {
    const skillMd = join(root, d, 'skills', 'impeccable', 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const content = readFileSync(skillMd, 'utf-8');
    const match = content.match(/^version:\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Hash all SKILL.md files in a directory tree for comparison.
 * Returns a sorted string of "name:hash" pairs.
 */
function hashSkillsDir(skillsDir) {
  if (!existsSync(skillsDir)) return '';
  const entries = [];
  for (const name of readdirSync(skillsDir).sort()) {
    const skillMd = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const hash = createHash('sha256').update(readFileSync(skillMd)).digest('hex').slice(0, 12);
    entries.push(`${name}:${hash}`);
  }
  return entries.join(',');
}

/**
 * Download the universal bundle to a temp dir and return its path.
 * Caller is responsible for cleanup.
 */
async function downloadAndExtractBundle() {
  const tmpZip = join(tmpdir(), `impeccable-update-${Date.now()}.zip`);
  const tmpDir = join(tmpdir(), `impeccable-update-${Date.now()}`);
  await downloadFile(`${API_BASE}/api/download/bundle/universal`, tmpZip);
  mkdirSync(tmpDir, { recursive: true });
  await extract(tmpZip, { dir: tmpDir });
  rmSync(tmpZip, { force: true });
  return tmpDir;
}

/**
 * Normalize a SKILL.md's content for comparison by stripping
 * provider-specific paths. Different install methods (npx skills add
 * vs our bundle) resolve {{scripts_path}} to different provider dirs
 * (e.g. .agents vs .claude), so we strip those differences.
 */
function normalizeForHash(content) {
  return content
    .replace(/\.(claude|cursor|agents|github|gemini|codex|kiro|opencode|pi|qoder|trae|trae-cn|rovodev)\/skills\//g, '.PROVIDER/skills/')
    .replace(/^version:\s*.+$/m, 'version: NORMALIZED');
}

/**
 * Deduplicate providers by resolved path. When .claude/skills is a
 * symlink to ../.agents/skills, both resolve to the same directory.
 * Returns an array of { provider, localSkillsDir } with one entry
 * per unique real path. The first provider that maps to a real path
 * wins (so the bundle uses that provider's build).
 */
function deduplicateProviders(root, providers) {
  const seen = new Map(); // realPath -> { provider, localSkillsDir }
  for (const provider of providers) {
    const skillsDir = join(root, provider, 'skills');
    if (!existsSync(skillsDir)) continue;
    const real = realpathSync(skillsDir);
    if (!seen.has(real)) {
      seen.set(real, { provider, localSkillsDir: skillsDir });
    }
  }
  return [...seen.values()];
}

/**
 * Compare local skills against a downloaded bundle.
 * Only checks skills that exist in the bundle (ignores user's custom
 * skills that aren't part of impeccable). Deduplicates providers that
 * share the same real path (symlinks). Normalizes provider-specific
 * paths and version fields before comparing.
 * Returns true if every bundle skill matches the local copy.
 */
function isUpToDate(root, providers, bundleDir) {
  const unique = deduplicateProviders(root, providers);
  if (unique.length === 0) return false;

  for (const { provider, localSkillsDir } of unique) {
    const bundleSkillsDir = join(bundleDir, provider, 'skills');
    if (!existsSync(bundleSkillsDir)) continue;

    for (const name of readdirSync(bundleSkillsDir)) {
      const bundleMd = join(bundleSkillsDir, name, 'SKILL.md');
      const localMd = join(localSkillsDir, name, 'SKILL.md');
      if (!existsSync(bundleMd)) continue;
      if (!existsSync(localMd)) return false;

      const bundleHash = createHash('sha256').update(normalizeForHash(readFileSync(bundleMd, 'utf-8'))).digest('hex');
      const localHash = createHash('sha256').update(normalizeForHash(readFileSync(localMd, 'utf-8'))).digest('hex');
      if (bundleHash !== localHash) return false;
    }
  }
  return true;
}

// ─── skills check ────────────────────────────────────────────────────────────

async function check() {
  const root = findProjectRoot();
  const installed = isAlreadyInstalled(root);

  if (!installed) {
    console.log('Impeccable is not installed in this project.');
    console.log('Run `npx impeccable skills install` to install.');
    process.exit(0);
  }

  const providers = findInstalledProviders(root);

  console.log('Checking for updates...\n');
  try {
    const bundleDir = await downloadAndExtractBundle();
    const upToDate = isUpToDate(root, providers, bundleDir);
    rmSync(bundleDir, { recursive: true, force: true });

    if (upToDate) {
      const v = getSkillsVersion(root);
      console.log(`Skills are up to date${v ? ` (v${v})` : ''}.`);
    } else {
      console.log('Updates available.');
      console.log('Run `npx impeccable skills update` to update.');
    }
  } catch (e) {
    console.error(`Could not check for updates: ${e.message}`);
    process.exit(1);
  }
}

// ─── skills install ───────────────────────────────────────────────────────────

// Check if impeccable skills are already present in any provider folder
function isAlreadyInstalled(root) {
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      const entries = readdirSync(skillsDir);
      // Look for 'impeccable' skill (or prefixed variant, or legacy 'teach-impeccable')
      if (entries.some(e =>
        e === 'impeccable' || e.endsWith('-impeccable') ||
        e === 'teach-impeccable' || e.endsWith('-teach-impeccable')
      )) {
        return d;
      }
    } catch {}
  }
  return null;
}

function isSkillDir(skillsDir, name) {
  // Skill entries can be real directories or symlinks to directories (npx skills uses symlinks)
  const full = join(skillsDir, name);
  try {
    return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
  } catch { return false; }
}

function isRealSkillDir(skillsDir, name) {
  // Only real directories, not symlinks -- renaming the real dir renames the symlink targets too
  const full = join(skillsDir, name);
  try {
    const lstat = lstatSync(full);
    return lstat.isDirectory() && !lstat.isSymbolicLink() && existsSync(join(full, 'SKILL.md'));
  } catch { return false; }
}

/**
 * One-way migration for installs from the era when the CLI offered a command
 * prefix (default `i-`), renaming the skill to e.g. `i-impeccable`. The prefix
 * only earned its keep when every command was its own skill; with a single
 * `impeccable` skill it does nothing, so it is no longer offered. Rename any
 * prefixed impeccable skill back to the canonical `impeccable` (the fresh
 * install/update content lands there next) so users aren't left with a stale,
 * orphaned `i-impeccable` alongside the new one. Scoped to the impeccable skill
 * by name -- never touches third-party skills that happen to start with `i-`.
 * Returns the number of skills migrated.
 */
function migrateUnprefixImpeccable(root) {
  let migrated = 0;
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    let entries;
    try { entries = readdirSync(skillsDir); } catch { continue; }
    for (const name of entries) {
      // A prefixed impeccable skill is `<prefix>impeccable` -- not the canonical
      // `impeccable`, and not the legacy `teach-impeccable` (cleanup handles that).
      if (name === 'impeccable' || name === 'teach-impeccable') continue;
      if (!name.endsWith('-impeccable')) continue;
      if (!isRealSkillDir(skillsDir, name)) continue;

      const dest = join(skillsDir, 'impeccable');
      try {
        rmSync(dest, { recursive: true, force: true });
        renameSync(join(skillsDir, name), dest);
        migrated++;
      } catch {}
    }
  }
  return migrated;
}

/**
 * Decide which provider folders to install into.
 *  1. An explicit --providers=.claude,.cursor list wins.
 *  2. Otherwise, harness folders already present in the project.
 *  3. Otherwise, infer from globally installed harnesses (~/.claude, ~/.codex).
 *  4. Otherwise, a sensible default (.claude + .agents).
 */
function resolveInstallTargets(root, providersValue) {
  if (providersValue) {
    const wanted = providersValue
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => (s.startsWith('.') ? s : `.${s}`))
      .filter(p => PROVIDER_DIRS.includes(p));
    return [...new Set(wanted)];
  }

  const inProject = PROVIDER_DIRS.filter(d => existsSync(join(root, d)));
  if (inProject.length > 0) return inProject;

  const home = homedir();
  const inferred = [];
  for (const { home: h, provider } of GLOBAL_HARNESS_HINTS) {
    if (existsSync(join(home, h)) && !inferred.includes(provider)) inferred.push(provider);
  }
  if (inferred.length > 0) return inferred;

  return [...DEFAULT_TARGETS];
}

/**
 * Copy each target provider's compiled skill variant from an extracted bundle
 * into the project. Writes real directories (copy, never symlink) so every
 * harness keeps the build that was compiled for it. Returns skills written.
 */
function copyProviderSkills(bundleDir, root, targets) {
  let written = 0;
  for (const provider of targets) {
    const srcDir = join(bundleDir, provider, 'skills');
    if (!existsSync(srcDir)) continue;
    const localSkillsDir = join(root, provider, 'skills');
    // A previous `npx skills` install may have left this provider's skills dir
    // as a symlink to another provider's canonical copy. Drop the link so we
    // write a real, provider-specific directory instead of writing through it.
    try {
      if (lstatSync(localSkillsDir).isSymbolicLink()) unlinkSync(localSkillsDir);
    } catch {}
    for (const skill of readdirSync(srcDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const src = join(srcDir, skill.name);
      const dest = join(localSkillsDir, skill.name);
      rmSync(dest, { recursive: true, force: true });
      copyDirSync(src, dest);
      written++;
    }
  }
  return written;
}

async function install(flags) {
  const force = flags.includes('--force');
  const yes = flags.includes('-y') || flags.includes('--yes');
  const providersFlag = flags.find(f => f.startsWith('--providers='));
  const root = findProjectRoot();
  const existing = isAlreadyInstalled(root);

  if (existing && !force) {
    console.log(`Impeccable skills are already installed (found in ${existing}/).`);
    console.log('Run with --force to reinstall.\n');
    process.exit(0);
  }

  // Decide which harness folders to install into, then copy each harness's own
  // compiled variant from the universal bundle. We deliberately do NOT shell out
  // to `npx skills add`: its name-based discovery can install the uncompiled
  // source, and its symlink default points every harness at one shared variant.
  // Copying per-provider variants is the only correct install for this skill.
  const targets = resolveInstallTargets(root, providersFlag ? providersFlag.split('=')[1] : null);
  if (targets.length === 0) {
    console.error('Could not determine a target harness folder.');
    console.error('Pass one explicitly, e.g. --providers=.claude,.cursor');
    process.exit(1);
  }

  if (!yes) {
    console.log(`Target harness folder(s): ${targets.join(', ')}`);
    const ans = await ask(`Install impeccable skills into ${targets.length} folder(s)? (Y/n) `);
    if (ans === 'n' || ans === 'no') {
      console.log('Aborted. Re-run with --providers=<dirs> to choose explicitly (e.g. --providers=.claude,.cursor).');
      process.exit(0);
    }
  }

  console.log('\nDownloading impeccable skills...');
  let bundleDir;
  try {
    bundleDir = await downloadAndExtractBundle();
  } catch (e) {
    console.error(`Download failed: ${e.message}`);
    process.exit(1);
  }

  // Retire any old `i-`-prefixed install so the fresh copy lands on the
  // canonical `impeccable` dir instead of orphaning the prefixed one.
  migrateUnprefixImpeccable(root);

  let written = 0;
  try {
    written = copyProviderSkills(bundleDir, root, targets);
  } catch (e) {
    rmSync(bundleDir, { recursive: true, force: true });
    console.error(`Install failed: ${e.message}`);
    process.exit(1);
  }
  rmSync(bundleDir, { recursive: true, force: true });

  if (written === 0) {
    console.error(`Nothing was installed: the bundle had no variants for ${targets.join(', ')}.`);
    process.exit(1);
  }
  console.log(`Installed impeccable into: ${targets.join(', ')}`);

  // Clean up deprecated skills from previous versions
  try {
    const { cleanup } = await import('../../../skill/scripts/cleanup-deprecated.mjs');
    const result = cleanup(root);
    const total = result.deletedPaths.length + result.removedLockEntries.length;
    if (total > 0) {
      console.log(`Cleaned up ${total} deprecated skill(s) from previous versions.`);
    }
  } catch {
    // Cleanup script not available -- skip
  }

  console.log('\nDone! Run /impeccable init in your AI harness to set up design context.\n');
}

// ─── skills update ────────────────────────────────────────────────────────────

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function findInstalledProviders(root) {
  const found = [];
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      const entries = readdirSync(skillsDir);
      if (entries.some(name => isSkillDir(skillsDir, name))) found.push(d);
    } catch {}
  }
  return found;
}

function getModifiedSkillFiles(root, providerDirs) {
  // Use git to check if any skill files have local modifications
  const modified = [];
  try {
    const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
    for (const line of status.split('\n')) {
      if (!line.trim()) continue;
      const file = line.substring(3);
      for (const d of providerDirs) {
        if (file.startsWith(`${d}/skills/`)) {
          const flag = line.substring(0, 2).trim();
          modified.push({ file, flag });
        }
      }
    }
  } catch {
    // Not a git repo or git not available
  }
  return modified;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function update(flags = []) {
  const yes = flags.includes('-y') || flags.includes('--yes');

  // Clean up deprecated skills from previous versions.
  try {
    const { cleanup } = await import('../../../skill/scripts/cleanup-deprecated.mjs');
    const root = findProjectRoot();
    const result = cleanup(root);
    const total = result.deletedPaths.length + result.removedLockEntries.length;
    if (total > 0) {
      console.log(`Cleaned up ${total} deprecated skill(s) from previous versions.\n`);
    }
  } catch {
    // Cleanup script not available (e.g. running from npm package) -- skip
  }

  // Download the latest skills directly from impeccable.style.
  // We skip `npx skills update` because it has a known upstream bug
  // (vercel-labs/skills#775) where it can't find the lock file.
  const root = findProjectRoot();
  const providers = findInstalledProviders(root);

  if (providers.length === 0) {
    console.log('No impeccable skill folders found in this project.');
    console.log('Run `npx impeccable skills install` to install first.');
    process.exit(1);
  }

  console.log('Checking for updates...');

  let tmpDir;
  try {
    tmpDir = await downloadAndExtractBundle();
  } catch (e) {
    console.error(`Download failed: ${e.message}`);
    process.exit(1);
  }

  // Compare local vs remote -- skip if already up to date
  if (isUpToDate(root, providers, tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    const v = getSkillsVersion(root);
    console.log(`Skills are up to date${v ? ` (v${v})` : ''}. Nothing to do.`);
    process.exit(0);
  }

  console.log(`Found skills in: ${providers.join(', ')}`);

  if (!yes) {
    const ans = await ask(`Update skills in ${providers.length} provider folder(s)? (Y/n) `);
    if (ans === 'n' || ans === 'no') {
      rmSync(tmpDir, { recursive: true, force: true });
      console.log('Aborted.');
      process.exit(0);
    }
  }

  try {

    // Retire any old `i-`-prefixed install up front so the refresh lands on the
    // canonical `impeccable` dir rather than orphaning the prefixed copy.
    const migrated = migrateUnprefixImpeccable(root);
    if (migrated > 0) console.log('Migrated a prefixed install back to /impeccable (the i- prefix is no longer used).');

    // Copy from the bundle to each unique provider folder.
    // Deduplicate so symlinked dirs (e.g. .claude/skills -> .agents/skills)
    // are only written once with the correct provider's content.
    const unique = deduplicateProviders(root, providers);
    let updated = 0;
    for (const { provider, localSkillsDir } of unique) {
      const srcDir = join(tmpDir, provider, 'skills');
      if (!existsSync(srcDir)) continue;

      const skills = readdirSync(srcDir, { withFileTypes: true });
      for (const skill of skills) {
        if (!skill.isDirectory()) continue;
        const src = join(srcDir, skill.name);
        const dest = join(localSkillsDir, skill.name);
        if (existsSync(dest)) rmSync(dest, { recursive: true });
        copyDirSync(src, dest);
        updated++;
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });

    // Run cleanup to remove deprecated stubs from the fresh download
    try {
      const { cleanup: postCleanup } = await import('../../../skill/scripts/cleanup-deprecated.mjs');
      postCleanup(root);
    } catch {
      // Not available -- skip
    }

    const v = getSkillsVersion(root);
    console.log(`Updated ${updated} skill(s)${v ? ` to v${v}` : ''}.`);
    console.log('Done!\n');
  } catch (e) {
    console.error(`Update failed: ${e.message}`);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
}

function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      writeFileSync(d, readFileSync(s));
    }
  }
}

// ─── Test surface ───────────────────────────────────────────────────────────
// Exported so the test suite exercises the real implementation rather than a
// reimplementation in a helper script (which is how bugs slip through).
export { migrateUnprefixImpeccable };

// ─── Router ───────────────────────────────────────────────────────────────────

export async function run(args) {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    await showHelp();
  } else if (sub === 'install') {
    await install(args.slice(1));
  } else if (sub === 'update') {
    await update(args.slice(1));
  } else if (sub === 'check') {
    await check();
  } else {
    console.error(`Unknown skills command: ${sub}`);
    console.error(`Run 'impeccable skills --help' for available commands.`);
    process.exit(1);
  }
}
