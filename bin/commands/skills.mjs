/**
 * `impeccable skills` subcommand
 *
 * Usage:
 *   impeccable skills help      Show all available skills and commands
 *   impeccable skills install   Install skills via npx skills add
 *   impeccable skills update    Update skills to latest version
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, symlinkSync, readlinkSync, unlinkSync, mkdirSync, writeFileSync, rmSync, renameSync, createWriteStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://impeccable.style';

// Provider folder names in project roots
const PROVIDER_DIRS = ['.claude', '.cursor', '.gemini', '.codex', '.agents', '.kiro', '.opencode', '.pi', '.trae', '.trae-cn'];

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

// ─── skills install ───────────────────────────────────────────────────────────

// Check if impeccable skills are already present in any provider folder
function isAlreadyInstalled(root) {
  for (const d of PROVIDER_DIRS) {
    const skillsDir = join(root, d, 'skills');
    if (!existsSync(skillsDir)) continue;
    try {
      const entries = readdirSync(skillsDir);
      // Look for teach-impeccable (or any prefixed variant like i-teach-impeccable)
      if (entries.some(e => e === 'teach-impeccable' || e.endsWith('-teach-impeccable'))) {
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

  console.log(`\nDone! Run /${prefix}teach-impeccable in your AI harness to set up design context.\n`);
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
  // Try npx skills update first
  console.log('Checking for skills manager...');
  let noLockFile = true;
  try {
    const output = execSync('npx skills check', { encoding: 'utf8', timeout: 15000 });
    noLockFile = output.includes('No skills tracked');
  } catch {
    // npx skills not available or errored
  }

  if (!noLockFile) {
    // npx skills is managing our install -- delegate to it
    console.log('Updating via npx skills...\n');
    try {
      execSync('npx skills update', { stdio: 'inherit' });
    } catch (e) {
      process.exit(e.status ?? 1);
    }
    process.exit(0);
  }

  // Fallback: manual update by downloading the universal bundle
  console.log('Skills not managed by npx skills. Using direct download.\n');

  const root = findProjectRoot();
  const providers = findInstalledProviders(root);

  if (providers.length === 0) {
    console.log('No impeccable skill folders found in this project.');
    console.log('Run `npx impeccable skills install` to install first.');
    process.exit(1);
  }

  console.log(`Found impeccable skills in: ${providers.join(', ')}`);

  // Check for local modifications
  const modified = getModifiedSkillFiles(root, providers);
  if (modified.length > 0) {
    console.log(`\n  Warning: ${modified.length} skill file(s) have local changes:\n`);
    for (const m of modified.slice(0, 10)) {
      console.log(`    ${m.flag} ${m.file}`);
    }
    if (modified.length > 10) console.log(`    ... and ${modified.length - 10} more`);
    console.log();
    if (!yes) {
      const ans = await ask('  Overwrite local changes? (y/N) ');
      if (ans !== 'y' && ans !== 'yes') {
        console.log('Aborted.');
        process.exit(0);
      }
    }
  } else if (!yes) {
    const ans = await ask(`Update skills in ${providers.length} provider folder(s)? (Y/n) `);
    if (ans === 'n' || ans === 'no') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Download universal bundle
  const tmpZip = join(tmpdir(), `impeccable-update-${Date.now()}.zip`);
  console.log('\nDownloading latest skills...');
  try {
    await downloadFile(`${API_BASE}/api/download/bundle/universal`, tmpZip);
  } catch (e) {
    console.error(`Download failed: ${e.message}`);
    process.exit(1);
  }

  // Extract and copy to each provider folder
  let unzip;
  try {
    // Use built-in decompress if available (Node 22+), otherwise shell unzip
    const tmpDir = join(tmpdir(), `impeccable-update-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    execSync(`unzip -qo "${tmpZip}" -d "${tmpDir}"`, { encoding: 'utf8' });

    // The universal bundle has provider folders at the top level
    let updated = 0;
    for (const provider of providers) {
      const srcDir = join(tmpDir, provider, 'skills');
      const destDir = join(root, provider, 'skills');
      if (!existsSync(srcDir)) continue;

      // Copy each skill folder
      const skills = readdirSync(srcDir, { withFileTypes: true });
      for (const skill of skills) {
        if (!skill.isDirectory()) continue;
        const src = join(srcDir, skill.name);
        const dest = join(destDir, skill.name);
        // Remove old and copy new
        if (existsSync(dest)) rmSync(dest, { recursive: true });
        copyDirSync(src, dest);
        updated++;
      }
    }

    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpZip, { force: true });

    console.log(`Updated ${updated} skills across ${providers.length} provider(s).`);
    console.log('Done!\n');
  } catch (e) {
    console.error(`Extract failed: ${e.message}`);
    rmSync(tmpZip, { force: true });
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
  } else {
    console.error(`Unknown skills command: ${sub}`);
    console.error(`Run 'impeccable skills --help' for available commands.`);
    process.exit(1);
  }
}
