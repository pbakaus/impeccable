/**
 * `impeccable skills` subcommand
 *
 * Usage:
 *   impeccable skills help      Show all available skills and commands
 *   impeccable skills install   Install skills via npx skills add
 *   impeccable skills update    Update skills to latest version
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, symlinkSync, readlinkSync, unlinkSync, mkdirSync, writeFileSync, rmSync, renameSync, createWriteStream, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://impeccable.style';

// Provider folder names in project roots
const PROVIDER_DIRS = ['.claude', '.cursor', '.gemini', '.agents', '.github', '.kiro', '.opencode', '.pi', '.qoder', '.trae', '.trae-cn'];

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
  execSync(`unzip -qo "${tmpZip}" -d "${tmpDir}"`, { encoding: 'utf8' });
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prefixSkillContent(content, prefix, allSkillNames) {
  // Prefix the name in frontmatter
  let result = content.replace(/^name:\s*(.+)$/m, (_, name) => `name: ${prefix}${name.trim()}`);

  // Prefix cross-references: /skillname -> /prefix-skillname
  const sorted = [...allSkillNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    // Command invocations: /skillname
    result = result.replace(
      new RegExp(`/(?=${escapeRegex(name)}(?:[^a-zA-Z0-9_-]|$))`, 'g'),
      `/${prefix}`
    );
    // Prose references: "the skillname skill"
    result = result.replace(
      new RegExp(`(the) ${escapeRegex(name)} skill`, 'gi'),
      (_, article) => `${article} ${prefix}${name} skill`
    );
  }
  return result;
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

function renameSkillsWithPrefix(root, prefix) {
  // First pass: collect all skill names across all providers (use first provider found)
  let allSkillNames = [];
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    const entries = readdirSync(skillsDir);
    allSkillNames = entries.filter(name => isSkillDir(skillsDir, name));
    if (allSkillNames.length > 0) break;
  }

  // Second pass: rename real dirs and update their content
  let count = 0;
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      const entries = readdirSync(skillsDir);
      for (const name of entries) {
        if (name.startsWith(prefix)) continue;
        if (!isRealSkillDir(skillsDir, name)) continue;

        const src = join(skillsDir, name);
        const dest = join(skillsDir, prefix + name);

        renameSync(src, dest);

        // Prefix frontmatter name + all cross-references in SKILL.md
        let content = readFileSync(join(dest, 'SKILL.md'), 'utf8');
        content = prefixSkillContent(content, prefix, allSkillNames);
        writeFileSync(join(dest, 'SKILL.md'), content);
        count++;
      }
    } catch {}
  }

  // Third pass: fix symlinks that now point to renamed targets (npx skills uses these)
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      const entries = readdirSync(skillsDir);
      for (const name of entries) {
        if (name.startsWith(prefix)) continue;
        const full = join(skillsDir, name);
        try {
          if (!lstatSync(full).isSymbolicLink()) continue;
          const target = readlinkSync(full);
          const newTarget = target.replace(new RegExp(`/${escapeRegex(name)}$`), `/${prefix}${name}`);
          unlinkSync(full);
          symlinkSync(newTarget, join(skillsDir, prefix + name));
        } catch {}
      }
    } catch {}
  }

  return count;
}

async function install(flags) {
  const force = flags.includes('--force');
  const yes = flags.includes('-y') || flags.includes('--yes');
  const prefixFlag = flags.find(f => f.startsWith('--prefix='));
  const root = findProjectRoot();
  const existing = isAlreadyInstalled(root);

  if (existing && !force) {
    console.log(`Impeccable skills are already installed (found in ${existing}/).`);
    console.log('Run with --force to reinstall.\n');
    process.exit(0);
  }

  console.log('Installing impeccable skills via npx skills...\n');
  try {
    execSync(`npx skills add pbakaus/impeccable${yes ? ' -y' : ''}`, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status ?? 1);
  }

  // Ask about prefixing (skip in CI mode unless --prefix= is set)
  let prefix = '';
  if (prefixFlag) {
    prefix = prefixFlag.split('=')[1] || 'i-';
  } else if (!yes) {
    console.log();
    const wantPrefix = await ask('Prefix commands to avoid conflicts? e.g. /i-audit instead of /audit (y/N) ');
    if (wantPrefix === 'y' || wantPrefix === 'yes') {
      const custom = await ask('Prefix (default: i-): ');
      prefix = custom || 'i-';
    }
  }

  if (prefix) {
    const count = renameSkillsWithPrefix(root, prefix);
    if (count > 0) {
      console.log(`\nRenamed ${count} skills with "${prefix}" prefix.`);
      console.log(`Commands are now available as /${prefix}<command> (e.g. /${prefix}audit).`);
    }
  }

  // Clean up deprecated skills from previous versions
  try {
    const { cleanup } = await import('../../source/skills/impeccable/scripts/cleanup-deprecated.mjs');
    const result = cleanup(root);
    const total = result.deletedPaths.length + result.removedLockEntries.length;
    if (total > 0) {
      console.log(`Cleaned up ${total} deprecated skill(s) from previous versions.`);
    }
  } catch {
    // Cleanup script not available -- skip
  }

  console.log(`\nDone! Run /${prefix}impeccable teach in your AI harness to set up design context.\n`);
}

/** Detect prefix by looking for the 'impeccable' skill (or legacy 'teach-impeccable') */
function detectPrefix(root) {
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const name of readdirSync(skillsDir)) {
      if (name === 'impeccable') return '';
      if (name.endsWith('-impeccable') && name !== 'teach-impeccable') return name.slice(0, -'impeccable'.length);
      // Legacy fallback
      if (name === 'teach-impeccable') return '';
      if (name.endsWith('-teach-impeccable')) return name.slice(0, -'teach-impeccable'.length);
    }
  }
  return '';
}

/** Undo prefixing: rename folders back and strip prefix from SKILL.md content */
function undoPrefix(root, prefix) {
  if (!prefix) return;
  // Collect the unprefixed names (strip our prefix)
  let allPrefixedNames = [];
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    allPrefixedNames = readdirSync(skillsDir).filter(n => n.startsWith(prefix) && isRealSkillDir(skillsDir, n));
    if (allPrefixedNames.length > 0) break;
  }
  const unprefixedNames = allPrefixedNames.map(n => n.slice(prefix.length));

  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const name of readdirSync(skillsDir)) {
      if (!name.startsWith(prefix)) continue;
      const unprefixed = name.slice(prefix.length);
      const src = join(skillsDir, name);
      const dest = join(skillsDir, unprefixed);

      if (lstatSync(src).isSymbolicLink()) {
        const target = readlinkSync(src);
        const newTarget = target.replace(`/${name}`, `/${unprefixed}`);
        unlinkSync(src);
        symlinkSync(newTarget, dest);
      } else {
        renameSync(src, dest);
        // Strip prefix from SKILL.md content
        const skillMd = join(dest, 'SKILL.md');
        if (existsSync(skillMd)) {
          let content = readFileSync(skillMd, 'utf8');
          // Reverse the prefixing: replace prefixed names with unprefixed
          content = content.replace(new RegExp(`^name:\\s*${escapeRegex(prefix)}`, 'm'), 'name: ');
          const sorted = [...allPrefixedNames].sort((a, b) => b.length - a.length);
          for (const pName of sorted) {
            const uName = pName.slice(prefix.length);
            content = content.replace(new RegExp(`/${escapeRegex(pName)}(?=[^a-zA-Z0-9_-]|$)`, 'g'), `/${uName}`);
            content = content.replace(new RegExp(`(the) ${escapeRegex(pName)} skill`, 'gi'), `$1 ${uName} skill`);
          }
          writeFileSync(skillMd, content);
        }
      }
    }
  }
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
    const { cleanup } = await import('../../source/skills/impeccable/scripts/cleanup-deprecated.mjs');
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

    // Re-apply prefix if detected
    const prefix = detectPrefix(root);
    if (prefix) {
      const count = renameSkillsWithPrefix(root, prefix);
      if (count > 0) console.log(`Re-applied "${prefix}" prefix to ${count} skills.`);
    }

    // Run cleanup to remove deprecated stubs from the fresh download
    try {
      const { cleanup: postCleanup } = await import('../../source/skills/impeccable/scripts/cleanup-deprecated.mjs');
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
