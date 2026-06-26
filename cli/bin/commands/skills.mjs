/**
 * `impeccable skills` subcommand
 *
 * Usage:
 *   impeccable help      Show all available skills and commands
 *   impeccable install   Install compiled skills from the universal bundle
 *   impeccable link      Symlink compiled skills from a local checkout
 *   impeccable update    Update skills to latest version
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, unlinkSync, mkdirSync, writeFileSync, rmSync, renameSync, createWriteStream, realpathSync, symlinkSync, readlinkSync, cpSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { unzipSync } from 'fflate';
import { getHookConsent, setHookConsent } from '../../lib/impeccable-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://impeccable.style';

// Provider folder names in project roots
const PROVIDER_DIRS = ['.claude', '.cursor', '.gemini', '.agents', '.github', '.kiro', '.opencode', '.pi', '.qoder', '.trae', '.trae-cn', '.rovodev'];
const PROVIDER_ALIASES = {
  agents: '.agents',
  claude: '.claude',
  'claude-code': '.claude',
  codex: '.agents',
  copilot: '.github',
  cursor: '.cursor',
  gemini: '.gemini',
  github: '.github',
  kiro: '.kiro',
  opencode: '.opencode',
  pi: '.pi',
  qoder: '.qoder',
  'rovo-dev': '.rovodev',
  rovodev: '.rovodev',
  trae: '.trae',
  'trae-cn': '.trae-cn',
};

const PROVIDER_DISPLAY = {
  '.agents': { name: 'Codex CLI', input: 'codex' },
  '.claude': { name: 'Claude Code', input: 'claude' },
  '.cursor': { name: 'Cursor', input: 'cursor' },
  '.gemini': { name: 'Gemini CLI', input: 'gemini' },
  '.github': { name: 'GitHub Copilot', input: 'github' },
  '.kiro': { name: 'Kiro', input: 'kiro' },
  '.opencode': { name: 'OpenCode', input: 'opencode' },
  '.pi': { name: 'Project Indigo', input: 'pi' },
  '.qoder': { name: 'Qoder', input: 'qoder' },
  '.rovodev': { name: 'Rovo Dev', input: 'rovo-dev' },
  '.trae': { name: 'Trae', input: 'trae' },
  '.trae-cn': { name: 'Trae CN', input: 'trae-cn' },
};
const PROVIDER_INPUT_ORDER = ['claude', 'codex', 'cursor', 'gemini', 'github', 'kiro', 'opencode', 'pi', 'qoder', 'trae', 'trae-cn', 'rovo-dev'];

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
  { home: '.rovodev', provider: '.rovodev' },
];

// Last-resort default when nothing is detected: Claude Code + the universal
// (.agents, also Codex) folder, which covers the most common setups.
const DEFAULT_TARGETS = ['.claude', '.agents'];
const IGNORED_SKILL_DIR_NAMES = new Set([
  'codex-primary-runtime',
]);
const IMPECCABLE_HOOK_COMMAND_MARKERS = [
  'skills/impeccable/scripts/hook-probe.mjs',
  'skills/impeccable/scripts/hook.mjs',
  'skills/impeccable/scripts/hook-before-edit.mjs',
  'skills/impeccable/scripts/hook-after-edit.mjs',
  'skills/impeccable/scripts/hook-stop.mjs',
];
const PROVIDER_HOOK_ARTIFACTS = {
  '.claude': [
    // The hook is a machine-local install side effect, so it lands in the
    // gitignored `.claude/settings.local.json` rather than the team-shared
    // `settings.json`. The bundle still ships the manifest as `settings.json`
    // (the `rel` source), but we write it to `destRel`. A hook the user moved
    // into `settings.json` is honored in place; see copyProviderHooks.
    { sourceProvider: '.claude', rel: 'settings.json', destProvider: '.claude', destRel: 'settings.local.json' },
  ],
  '.cursor': [
    { sourceProvider: '.cursor', rel: 'hooks.json', destProvider: '.cursor' },
  ],
  // Codex reads skills from `.agents/skills`, but project hooks from
  // `.codex/hooks.json`, so the `.agents` install target owns this sidecar.
  '.agents': [
    { sourceProvider: '.codex', rel: 'hooks.json', destProvider: '.codex' },
  ],
  // GitHub Copilot reads repo-level hooks from `.github/hooks/*.json`. Unlike
  // Claude, this is a team-shared, committed file (not a machine-local override),
  // so source and dest are the same path.
  '.github': [
    { sourceProvider: '.github', rel: 'hooks/impeccable.json', destProvider: '.github' },
  ],
};

let pipedAnswers = null;
class PromptAbortError extends Error {
  constructor() {
    super('Aborted.');
    this.name = 'PromptAbortError';
    this.code = 'IMPECCABLE_PROMPT_ABORT';
  }
}

function isPromptAbortError(error) {
  return error?.code === 'IMPECCABLE_PROMPT_ABORT';
}

function canStyleTerminal() {
  return Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
}

function ansi(open, close, value) {
  const text = String(value);
  return canStyleTerminal() ? `${open}${text}${close}` : text;
}

const ui = {
  accent: value => ansi('\x1b[36m', '\x1b[0m', value),
  bold: value => ansi('\x1b[1m', '\x1b[22m', value),
  dim: value => ansi('\x1b[2m', '\x1b[22m', value),
  good: value => ansi('\x1b[32m', '\x1b[0m', value),
};

function ask(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    if (!pipedAnswers) {
      let input = '';
      try {
        input = readFileSync(0, 'utf-8');
      } catch {}
      pipedAnswers = input.split(/\r?\n/);
    }
    return Promise.resolve(String(pipedAnswers.shift() || '').trim().toLowerCase());
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.once('SIGINT', () => {
      rl.close();
      reject(new PromptAbortError());
    });
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}

function isInteractivePrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function');
}

function promptKeypressSession(renderInitial, handleKey) {
  const input = process.stdin;
  const output = process.stdout;
  const wasRaw = Boolean(input.isRaw);
  let lastLineCount = 0;
  let done = false;

  emitKeypressEvents(input);

  return new Promise((resolve, reject) => {
    function cleanup() {
      if (done) return;
      done = true;
      input.off('keypress', onKeypress);
      if (typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
      output.write('\x1b[?25h');
      input.pause();
    }

    function render(lines) {
      const nextLines = Array.isArray(lines) ? lines : String(lines).split('\n');
      if (lastLineCount > 0) output.write(`\x1b[${lastLineCount}A`);
      const lineCount = Math.max(lastLineCount, nextLines.length);
      for (let index = 0; index < lineCount; index++) {
        const line = nextLines[index] || '';
        output.write(`\x1b[2K\r${line}\n`);
      }
      lastLineCount = lineCount;
    }

    function finish(value) {
      cleanup();
      resolve(value);
    }

    function abort() {
      cleanup();
      reject(new PromptAbortError());
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === 'c') {
        abort();
        return;
      }
      const next = handleKey(str, key);
      if (!next) return;
      if (next.abort) {
        abort();
        return;
      }
      if (next.done) {
        render(next.lines);
        finish(next.value);
        return;
      }
      render(next.lines);
    }

    input.on('keypress', onKeypress);
    input.setRawMode(true);
    input.resume();
    output.write('\x1b[?25l');
    render(renderInitial());
  });
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

function visibleWindow(cursor, total, maxVisible) {
  const visible = Math.max(1, Math.min(total, maxVisible));
  let start = Math.max(0, cursor - visible + 1);
  if (cursor < start) start = cursor;
  start = Math.min(start, Math.max(0, total - visible));
  return { start, end: start + visible };
}

async function promptRadio(message, options, { initialIndex = 0 } = {}) {
  let cursor = clampIndex(initialIndex, options.length);

  const render = () => [
    `${ui.accent('◆')} ${ui.bold(message)}`,
    '',
    ...options.map((option, index) => {
      const active = index === cursor;
      const pointer = active ? ui.accent('›') : ' ';
      const mark = active ? ui.good('●') : ui.dim('○');
      const label = active ? ui.bold(option.label) : option.label;
      const hint = option.hint ? ` ${ui.dim(option.hint)}` : '';
      return `  ${pointer} ${mark} ${label}${hint}`;
    }),
    '',
    `  ${ui.dim('↑/↓ move, enter confirm')}`,
  ];

  return promptKeypressSession(render, (_str, key = {}) => {
    if (key.name === 'up' || key.name === 'k') cursor = clampIndex(cursor - 1, options.length);
    if (key.name === 'down' || key.name === 'j') cursor = clampIndex(cursor + 1, options.length);
    if (key.name === 'return' || key.name === 'enter') {
      return { done: true, value: options[cursor].value, lines: render() };
    }
    return { lines: render() };
  });
}

async function promptCheckbox(message, options, { selectedValues = [] } = {}) {
  const selected = new Set(selectedValues);
  let cursor = 0;
  let error = '';
  let query = '';
  const maxVisible = Math.max(5, Math.min(options.length, (process.stdout.rows || 24) - 9, 10));

  function filteredOptions() {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(option => option.searchText.toLowerCase().includes(needle));
  }

  function selectedSummary() {
    const selectedOptions = options.filter(option => selected.has(option.value));
    if (selectedOptions.length === 0) return ui.dim('none');
    const labels = selectedOptions.map(option => option.label);
    if (labels.length <= 4) return labels.join(', ');
    return `${labels.slice(0, 4).join(', ')} ${ui.dim(`+${labels.length - 4} more`)}`;
  }

  const render = () => {
    const filtered = filteredOptions();
    cursor = clampIndex(cursor, filtered.length);
    const { start, end } = visibleWindow(cursor, filtered.length, maxVisible);
    const lines = [
      `${ui.accent('◆')} ${ui.bold(message)}`,
      '',
      `  Search: ${query || ui.dim('type to filter')}`,
      `  ${ui.dim('↑/↓ move, space select, enter confirm')}`,
      '',
    ];
    if (filtered.length === 0) {
      lines.push(`  ${ui.dim('No matches')}`);
    } else if (filtered.length > maxVisible) {
      lines.push(`  ${ui.dim(`Showing ${start + 1}-${end} of ${filtered.length}`)}`);
    }

    if (filtered.length > 0) {
      for (let index = start; index < end; index++) {
        const option = filtered[index];
        const active = index === cursor;
        const pointer = active ? ui.accent('›') : ' ';
        const mark = selected.has(option.value) ? ui.good('●') : ui.dim('○');
        const label = active ? ui.bold(option.label) : option.label;
        const hint = option.hint ? ` ${ui.dim(option.hint)}` : '';
        lines.push(`  ${pointer} ${mark} ${label}${hint}`);
      }
    }

    lines.push('');
    lines.push(`  Selected: ${selectedSummary()}`);
    if (error) lines.push(`  ${error}`);
    return lines;
  };

  return promptKeypressSession(render, (str, key = {}) => {
    const filtered = filteredOptions();
    if (key.name === 'up') cursor = clampIndex(cursor - 1, filtered.length);
    if (key.name === 'down') cursor = clampIndex(cursor + 1, filtered.length);
    if (key.name === 'space' || str === ' ') {
      const option = filtered[cursor];
      if (option) {
        if (selected.has(option.value)) selected.delete(option.value);
        else selected.add(option.value);
        error = '';
      }
    }
    if (key.name === 'backspace' || key.name === 'delete') {
      query = query.slice(0, -1);
      cursor = 0;
      error = '';
    }
    if (key.ctrl && key.name === 'u') {
      query = '';
      cursor = 0;
      error = '';
    }
    if (str && str.length === 1 && str >= '!' && !key.ctrl && !key.meta) {
      query += str;
      cursor = 0;
      error = '';
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (selected.size === 0) {
        error = ui.dim('Choose at least one harness.');
        return { lines: render() };
      }
      return {
        done: true,
        value: options.filter(option => selected.has(option.value)).map(option => option.value),
        lines: render(),
      };
    }
    return { lines: render() };
  });
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
  console.log('  Install:  npx impeccable install');
  console.log('  Link:     npx impeccable link --source=.impeccable');
  console.log('  Update:   npx impeccable update');
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
 * Return every file in a directory tree, sorted and relative to the tree root.
 */
function listSkillTreeFiles(root, dir = root) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSkillTreeFiles(root, full));
    } else if (entry.isFile()) {
      files.push(relative(root, full).split(sep).join('/'));
    }
  }
  return files;
}

/**
 * Extract every entry of a zip archive into `targetDir`.
 *
 * This replaces `extract-zip`, whose `yauzl`/`fd-slicer` read stack stalls on
 * Node v24.16.0 / v26.1.0+ (nodejs/node#63487): `pause()`/`resume()` became
 * no-ops on destroyed streams, so extraction stops after a handful of entries,
 * its promise never settles, and -- because nothing else keeps the event loop
 * alive -- the CLI exits 0 with no error, silently installing nothing.
 *
 * `fflate` decompresses from an in-memory buffer and never touches the fs
 * stream path, so it is immune to that regression on every Node version. It is
 * pure JS with zero dependencies, which keeps the Windows fix from #198 intact
 * (no `unzip` binary required). We write the entries to disk ourselves, which
 * lets us guard against zip-slip (`../` entries escaping `targetDir`).
 */
async function extractZip(zipPath, targetDir) {
  const entries = unzipSync(readFileSync(zipPath));
  const root = resolve(targetDir);
  for (const [entryPath, bytes] of Object.entries(entries)) {
    // Directory entries arrive as zero-length names ending in `/`; the files
    // beneath them create their parents via mkdirSync below.
    if (entryPath.endsWith('/')) continue;
    const dest = resolve(root, entryPath);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new Error(`Refusing to extract entry outside target dir: ${entryPath}`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
}

/**
 * Download the universal bundle to a temp dir and return its path.
 * Caller is responsible for cleanup.
 */
async function downloadAndExtractBundle() {
  const localBundle = process.env.IMPECCABLE_BUNDLE_PATH;
  if (localBundle) return copyOrExtractLocalBundle(localBundle);

  const tmpZip = join(tmpdir(), `impeccable-update-${Date.now()}.zip`);
  const tmpDir = join(tmpdir(), `impeccable-update-${Date.now()}`);
  await downloadFile(`${API_BASE}/api/download/bundle/universal`, tmpZip);
  mkdirSync(tmpDir, { recursive: true });
  await extractZip(tmpZip, tmpDir);
  rmSync(tmpZip, { force: true });
  return tmpDir;
}

async function copyOrExtractLocalBundle(sourceValue) {
  const source = resolve(sourceValue);
  if (!existsSync(source)) {
    throw new Error(`Local bundle not found: ${source}`);
  }

  const tmpDir = join(tmpdir(), `impeccable-local-bundle-${process.pid}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  if (statSync(source).isDirectory()) {
    cpSync(source, tmpDir, { recursive: true });
    return tmpDir;
  }

  await extractZip(source, tmpDir);
  return tmpDir;
}

/**
 * Normalize a SKILL.md's content for comparison by stripping
 * provider-specific paths. Different install methods (npx skills add
 * vs our bundle) resolve {{scripts_path}} to different provider dirs
 * (e.g. .agents vs .claude), so we strip those differences.
 * Version fields intentionally remain part of the comparison so metadata-only
 * releases still refresh installed files.
 */
function normalizeForHash(content) {
  return content
    .replace(/\.(claude|cursor|agents|github|gemini|codex|kiro|opencode|pi|qoder|trae|trae-cn|rovodev)\/skills\//g, '.PROVIDER/skills/');
}

function hashSkillFile(filePath) {
  return createHash('sha256')
    .update(normalizeForHash(readFileSync(filePath, 'utf-8')))
    .digest('hex');
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
 * Only checks skills that exist in the bundle (ignores user's custom skills
 * that aren't part of impeccable). Deduplicates providers that share the same
 * real path (symlinks). Compares the full bundled skill tree, not just
 * SKILL.md, so script-only fixes and removed files are detected.
 * Returns true if every bundle skill matches the local copy.
 */
function isUpToDate(root, providers, bundleDir) {
  const unique = deduplicateProviders(root, providers);
  if (unique.length === 0) return false;

  for (const { provider, localSkillsDir } of unique) {
    const bundleSkillsDir = join(bundleDir, provider, 'skills');
    if (!existsSync(bundleSkillsDir)) continue;

    for (const name of readdirSync(bundleSkillsDir)) {
      const bundleSkillDir = join(bundleSkillsDir, name);
      const localSkillDir = join(localSkillsDir, name);
      const bundleMd = join(bundleSkillDir, 'SKILL.md');
      if (!existsSync(bundleMd)) continue;
      if (!existsSync(localSkillDir)) return false;

      const bundleFiles = listSkillTreeFiles(bundleSkillDir);
      const localFiles = listSkillTreeFiles(localSkillDir);
      if (bundleFiles.join('\n') !== localFiles.join('\n')) return false;

      for (const relPath of bundleFiles) {
        const bundleHash = hashSkillFile(join(bundleSkillDir, ...relPath.split('/')));
        const localHash = hashSkillFile(join(localSkillDir, ...relPath.split('/')));
        if (bundleHash !== localHash) return false;
      }
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
    console.log('Run `npx impeccable install` to install.');
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
      console.log('Run `npx impeccable update` to update.');
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

function hasRealSkillEntries(skillsDir) {
  if (!existsSync(skillsDir)) return false;
  let entries;
  try { entries = readdirSync(skillsDir); } catch { return false; }
  return entries.some(name =>
    !name.startsWith('.') &&
    !IGNORED_SKILL_DIR_NAMES.has(name) &&
    isSkillDir(skillsDir, name)
  );
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
      // A prefixed impeccable skill is `<prefix>impeccable`, not the canonical
      // `impeccable` and not an unrelated legacy skill name.
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

function getFlagValue(flags, name) {
  const prefix = `${name}=`;
  const inline = flags.find(f => f.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = flags.indexOf(name);
  if (index !== -1 && flags[index + 1] && !flags[index + 1].startsWith('-')) {
    return flags[index + 1];
  }
  return null;
}

function normalizeProviderName(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (PROVIDER_DIRS.includes(raw)) return raw;
  const key = raw.replace(/^\./, '').toLowerCase();
  return PROVIDER_ALIASES[key] || null;
}

function parseProviderList(value) {
  const providers = [];
  const invalid = [];
  for (const raw of String(value || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const provider = normalizeProviderName(raw);
    if (!provider) {
      invalid.push(raw);
      continue;
    }
    if (!providers.includes(provider)) providers.push(provider);
  }
  return { providers, invalid };
}

function providerInputName(provider) {
  return PROVIDER_DISPLAY[provider]?.input || provider.replace(/^\./, '');
}

function providerDisplayName(provider) {
  return PROVIDER_DISPLAY[provider]?.name || provider;
}

function formatProviderList(providers) {
  return providers.map(providerInputName).join(', ');
}

function providerPromptOptions() {
  return PROVIDER_INPUT_ORDER.map(input => {
    const provider = normalizeProviderName(input);
    const label = providerDisplayName(provider);
    const hint = `(${provider}/skills)`;
    return {
      value: provider,
      label,
      hint,
      searchText: `${label} ${input} ${provider} ${hint}`,
    };
  });
}

function formatPathForDisplay(path, home = homedir()) {
  if (path === home) return '~';
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

function uniquePaths(paths) {
  return [...new Set(paths)];
}

function userSkillProbePaths(home, harnessDir, provider) {
  return uniquePaths([
    join(home, provider, 'skills'),
    join(home, harnessDir, 'skills'),
  ]);
}

function collectInstallDetections(root, home = homedir()) {
  const detections = [];
  for (const provider of PROVIDER_DIRS) {
    const foundPath = join(root, provider);
    if (!existsSync(foundPath)) continue;
    detections.push({
      provider,
      scope: 'project',
      foundPath,
      installRoot: root,
      installPath: join(root, provider, 'skills'),
      hasRealSkills: hasRealSkillEntries(join(root, provider, 'skills')),
      reason: 'project harness folder',
    });
  }

  for (const { home: h, provider } of GLOBAL_HARNESS_HINTS) {
    const foundPath = join(home, h);
    if (!existsSync(foundPath)) continue;
    const skillProbePaths = userSkillProbePaths(home, h, provider);
    detections.push({
      provider,
      scope: 'user',
      foundPath,
      installRoot: home,
      installPath: join(home, provider, 'skills'),
      skillProbePaths,
      hasRealSkills: skillProbePaths.some(hasRealSkillEntries),
      reason: 'user harness folder',
    });
  }
  return detections;
}

function uniqueProviders(detections) {
  const providers = [];
  for (const detection of detections) {
    if (!providers.includes(detection.provider)) providers.push(detection.provider);
  }
  return providers;
}

function defaultDetectedProviders(detections) {
  const projectProviders = uniqueProviders(detections.filter(d => d.scope === 'project'));
  if (projectProviders.length > 0) return projectProviders;
  return uniqueProviders(detections.filter(d => d.scope === 'user'));
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
    return parseProviderList(providersValue).providers;
  }

  const detected = defaultDetectedProviders(collectInstallDetections(root));
  if (detected.length > 0) return detected;

  return [...DEFAULT_TARGETS];
}

function normalizeInstallScope(value) {
  const key = String(value || '').trim().toLowerCase();
  if (['u', 'user', 'home', 'global'].includes(key)) return 'user';
  if (['p', 'project', 'local', 'repo'].includes(key)) return 'project';
  return null;
}

function getInstallScopeValue(flags) {
  if (flags.includes('--user') || flags.includes('--home') || flags.includes('--global')) return 'user';
  if (flags.includes('--project') || flags.includes('--local')) return 'project';
  return getFlagValue(flags, '--scope') || getFlagValue(flags, '--install-scope');
}

function defaultInstallScope(detections, providers) {
  const selected = new Set(providers);
  if (detections.some(d => selected.has(d.provider) && d.scope === 'project')) return 'project';
  if (detections.some(d => selected.has(d.provider) && d.scope === 'user' && d.hasRealSkills)) return 'user';
  return 'project';
}

function installRootForScope(scope, projectRoot) {
  return scope === 'user' ? homedir() : projectRoot;
}

function printInstallIntro() {
  if (!isInteractivePrompt()) return;
  console.log(`${ui.accent(ui.bold('impeccable'))} ${ui.dim('install')}`);
  console.log('');
}

function formatInstallDetectionLines(projectRoot, detections, home = homedir(), { styled = false } = {}) {
  if (detections.length === 0) {
    const message = `No harnesses detected under ${formatPathForDisplay(projectRoot, home)} or ${formatPathForDisplay(home, home)}.`;
    return styled
      ? [`${ui.accent('◇')} ${ui.bold('Detected harnesses')}`, `  ${ui.dim(message)}`]
      : [message];
  }

  const names = detections.map(d => providerDisplayName(d.provider));
  const paths = detections.map(d => formatPathForDisplay(d.foundPath, home));
  const nameWidth = Math.max(...names.map(name => name.length));
  const heading = styled ? `${ui.accent('◇')} ${ui.bold('Detected harnesses')}` : 'Detected harnesses:';
  return [
    heading,
    ...detections.map((detection, index) => {
      const rawName = names[index].padEnd(nameWidth);
      const rawFoundPath = paths[index];
      const name = styled ? ui.bold(rawName) : rawName;
      const foundPath = styled ? ui.dim(rawFoundPath) : rawFoundPath;
      return `  ${name}  ${foundPath}`;
    }),
  ];
}

function printInstallDetections(projectRoot, detections) {
  for (const line of formatInstallDetectionLines(projectRoot, detections, homedir(), { styled: isInteractivePrompt() })) console.log(line);
  console.log('');
}

async function promptForProviders(defaultProviders = []) {
  if (isInteractivePrompt()) {
    return promptCheckbox('Select harnesses', providerPromptOptions(), { selectedValues: defaultProviders });
  }

  const choices = PROVIDER_INPUT_ORDER.join(', ');
  const suffix = defaultProviders.length > 0
    ? ` [blank keeps ${formatProviderList(defaultProviders)}]`
    : '';
  while (true) {
    const answer = await ask(`Select harnesses (comma-separated: ${choices})${suffix}: `);
    if (!answer && defaultProviders.length > 0) return [...defaultProviders];
    const { providers, invalid } = parseProviderList(answer);
    if (invalid.length > 0) {
      console.log(`Unknown provider(s): ${invalid.join(', ')}`);
      continue;
    }
    if (providers.length > 0) return providers;
    console.log('Choose at least one provider.');
  }
}

async function promptDetectedInstallMode(detectedProviders) {
  if (isInteractivePrompt()) {
    return promptRadio('Install for detected harnesses only, or add more?', [
      { value: 'detected', label: 'Detected only', hint: `(${formatProviderList(detectedProviders)})` },
      { value: 'add', label: 'Customize...' },
    ]);
  }

  while (true) {
    const answer = await ask(`Install target: [1] Detected only (${formatProviderList(detectedProviders)})  [2] Customize [1]: `);
    if (!answer || ['1', 'detected', 'detected only', 'only', 'd'].includes(answer)) return 'detected';
    if (['2', 'customize', 'customise', 'add', 'add more', 'more', 'a', 'n', 'no'].includes(answer)) return 'add';
    console.log('Choose 1 for detected only, or 2 to customize.');
  }
}

async function chooseInstallProviders(projectRoot, providersValue, { yes } = {}) {
  const detections = collectInstallDetections(projectRoot);
  if (providersValue) {
    const { providers, invalid } = parseProviderList(providersValue);
    if (invalid.length > 0) {
      throw new Error(`Unknown provider(s): ${invalid.join(', ')}`);
    }
    return { targets: providers, detections, explicit: true };
  }

  if (yes) {
    return { targets: resolveInstallTargets(projectRoot, null), detections, explicit: false };
  }

  printInstallDetections(projectRoot, detections);
  const detectedProviders = defaultDetectedProviders(detections);
  if (detectedProviders.length === 0) {
    return { targets: await promptForProviders(), detections, explicit: false };
  }

  const mode = await promptDetectedInstallMode(detectedProviders);
  if (mode === 'add') {
    return { targets: await promptForProviders(detectedProviders), detections, explicit: false };
  }
  return { targets: detectedProviders, detections, explicit: false };
}

async function chooseInstallScope(projectRoot, targets, detections, { yes, scopeValue } = {}) {
  const explicitScope = normalizeInstallScope(scopeValue);
  if (scopeValue && !explicitScope) {
    throw new Error(`Unknown install scope: ${scopeValue}. Use --scope=project or --scope=global.`);
  }
  if (explicitScope) return explicitScope;

  // Preserve the old scripted behavior: `-y` installs into the current project
  // unless the caller explicitly opts into `--scope=global`.
  if (yes) return 'project';

  const fallback = defaultInstallScope(detections, targets);
  if (isInteractivePrompt()) {
    return promptRadio('Install location', [
      { value: 'project', label: 'Project', hint: `(${formatPathForDisplay(projectRoot)})` },
      { value: 'user', label: 'Global', hint: `(${formatPathForDisplay(homedir())})` },
    ], { initialIndex: fallback === 'user' ? 1 : 0 });
  }

  const answer = await ask(`Install location: project (${formatPathForDisplay(projectRoot)}) or global (${formatPathForDisplay(homedir())})? [${fallback === 'user' ? 'global' : fallback}] `);
  if (!answer) return fallback;
  const scope = normalizeInstallScope(answer);
  if (!scope) {
    console.log(`Unknown install location "${answer}", using ${fallback}.`);
    return fallback;
  }
  return scope;
}

async function chooseInstallPlan(projectRoot, flags, { yes } = {}) {
  const providersValue = getFlagValue(flags, '--providers');
  const scopeValue = getInstallScopeValue(flags);
  const { targets, detections } = await chooseInstallProviders(projectRoot, providersValue, { yes });
  if (targets.length === 0) {
    throw new Error('Could not determine a target harness folder.');
  }
  const scope = await chooseInstallScope(projectRoot, targets, detections, { yes, scopeValue });
  const installRoot = installRootForScope(scope, projectRoot);
  return { targets, scope, installRoot, hookRoot: projectRoot, detections };
}

/**
 * Whether `localSkillsDir` is a symlink that points at ANOTHER in-project
 * provider's skills dir (e.g. `.claude/skills -> ../.agents/skills`, the shape a
 * prior `npx skills` install can leave behind). Only these get dropped so each
 * provider can receive its own compiled variant. A symlink to anywhere else -
 * notably a user's external shared skills dir (`~/.claude/skills ->
 * ~/.config/agents/skills`) - is preserved and written through. See issue #295.
 */
function isInProjectProviderLink(localSkillsDir, root, provider) {
  let target;
  try {
    if (!lstatSync(localSkillsDir).isSymbolicLink()) return false;
    target = readlinkSync(localSkillsDir);
  } catch {
    return false; // not a symlink, or unreadable
  }
  // Resolve the link's TARGET lexically against the link's own directory. We
  // deliberately do NOT realpathSync the target:
  //   * it lets a not-yet-created in-project target still match, so a dangling
  //     `.claude/skills -> ../.agents/skills` is still dropped;
  //   * it compares the ACTUAL target, not a shared realpath, so two providers
  //     pointing at the SAME external dir are never misread as in-project.
  const resolvedTarget = resolve(dirname(localSkillsDir), target);
  for (const other of PROVIDER_DIRS) {
    if (other === provider) continue;
    if (resolvedTarget === join(root, other, 'skills')) return true;
  }
  return false;
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
    if (existsSync(srcDir)) {
      const localSkillsDir = join(root, provider, 'skills');
      // A previous `npx skills` install may have left this provider's skills dir
      // as a symlink to ANOTHER in-project provider's canonical copy. Drop only
      // that link so we write a real, provider-specific directory. A user's
      // external shared-skills symlink (e.g. ~/.claude/skills ->
      // ~/.config/agents/skills) is preserved and written through. See #295.
      try {
        if (isInProjectProviderLink(localSkillsDir, root, provider)) unlinkSync(localSkillsDir);
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
  }
  return written;
}

function refreshProviderSkills(bundleDir, root, providers) {
  const unique = deduplicateProviders(root, providers);
  let updated = 0;
  for (const { provider, localSkillsDir } of unique) {
    const srcDir = join(bundleDir, provider, 'skills');
    if (!existsSync(srcDir)) continue;

    const skills = readdirSync(srcDir, { withFileTypes: true });
    for (const skill of skills) {
      if (!skill.isDirectory()) continue;
      const src = join(srcDir, skill.name);
      const dest = join(localSkillsDir, skill.name);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      copyDirSync(src, dest);
      updated++;
    }
  }
  return updated;
}

function hookArtifactsForProvider(bundleDir, root, provider) {
  return (PROVIDER_HOOK_ARTIFACTS[provider] || []).map(({ sourceProvider, rel, destProvider, destRel }) => {
    const writeRel = destRel || rel;
    const artifact = {
      src: join(bundleDir, sourceProvider, rel),
      dest: join(root, destProvider, writeRel),
    };
    // When the write target is a local override (e.g. settings.local.json), the
    // team-shared sibling (settings.json) is where a legacy install or a
    // deliberate user move would put our hook. Track it so we never duplicate.
    if (writeRel !== rel) {
      artifact.sharedDest = join(root, destProvider, rel);
    }
    return artifact;
  });
}

function hookScriptPathForProvider(skillRoot, provider) {
  // `.github` is intentionally absent: its hook manifest (`.github/hooks/
  // impeccable.json`) is a committed, team-shared file that the Copilot cloud
  // agent and every teammate read, so the command must stay portable
  // (`$(git rev-parse --show-toplevel)/.github/skills/...`). Rewriting it to a
  // machine-local absolute skillRoot path would break those. GitHub skills are
  // project-scoped (not a home-provider), so the project-relative path resolves.
  if (provider === '.cursor') {
    return join(skillRoot, provider, 'skills', 'impeccable', 'scripts', 'hook-before-edit.mjs');
  }
  if (provider === '.claude' || provider === '.agents') {
    return join(skillRoot, provider, 'skills', 'impeccable', 'scripts', 'hook.mjs');
  }
  return null;
}

function rewriteHookCommandsForSkillRoot(value, provider, skillRoot) {
  const hookScript = hookScriptPathForProvider(skillRoot, provider);
  if (!hookScript) return value;

  if (typeof value === 'string') {
    if (valueHasImpeccableHookMarker(value)) return `node ${JSON.stringify(hookScript)}`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => rewriteHookCommandsForSkillRoot(item, provider, skillRoot));
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = rewriteHookCommandsForSkillRoot(child, provider, skillRoot);
    }
    return next;
  }
  return value;
}

// The file paths the CLI writes hook manifests to (the local override target,
// e.g. settings.local.json — not the shared sibling).
function expectedHookDests(root, providers) {
  const targets = Array.isArray(providers) ? providers : [providers];
  return targets.flatMap(provider =>
    (PROVIDER_HOOK_ARTIFACTS[provider] || []).map(({ rel, destProvider, destRel }) =>
      join(root, destProvider, destRel || rel))
  );
}

// Whether a hook manifest file actually wires up the Impeccable hook. We parse
// the JSON and scan only the `hooks` subtree (via valueHasImpeccableHookMarker),
// not the raw file text: an unrelated string elsewhere — e.g. a permissions
// allow entry that happens to mention the hook path — must not read as a hook.
function fileHasImpeccableHookMarker(file) {
  if (!existsSync(file)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (!parsed.hooks || typeof parsed.hooks !== 'object') return false;
  return valueHasImpeccableHookMarker(parsed.hooks);
}

// Whether our hook is already wired up for a provider, used to decide if the
// already-installed fast path should top up a missing hook. We look for the
// Impeccable marker — not mere file existence — because the target files
// (settings.local.json, hooks.json) commonly hold unrelated local settings; an
// existence check would falsely report "installed" and skip repairing a missing
// hook that `update` would otherwise add. For Claude we also honor our hook
// living in the shared settings.json sibling (a legacy install or user move).
function hookInstalledForProvider(root, provider) {
  const artifacts = PROVIDER_HOOK_ARTIFACTS[provider] || [];
  if (artifacts.length === 0) return true;
  return artifacts.every(({ destProvider, rel, destRel }) => {
    const writeRel = destRel || rel;
    if (fileHasImpeccableHookMarker(join(root, destProvider, writeRel))) return true;
    if (writeRel !== rel && fileHasImpeccableHookMarker(join(root, destProvider, rel))) return true;
    return false;
  });
}

function valueHasImpeccableHookMarker(value) {
  if (typeof value === 'string') {
    return IMPECCABLE_HOOK_COMMAND_MARKERS.some(marker => value.includes(marker));
  }
  if (Array.isArray(value)) return value.some(valueHasImpeccableHookMarker);
  if (value && typeof value === 'object') {
    return Object.values(value).some(valueHasImpeccableHookMarker);
  }
  return false;
}

function stripImpeccableHookEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  // `command`/`args`: Claude/Codex/Cursor. `bash`/`powershell`: GitHub Copilot's
  // flat entry shape, where the marker lives under the shell-command keys.
  if (valueHasImpeccableHookMarker(entry.command) || valueHasImpeccableHookMarker(entry.args)
    || valueHasImpeccableHookMarker(entry.bash) || valueHasImpeccableHookMarker(entry.powershell)) {
    return null;
  }
  if (!Array.isArray(entry.hooks)) return entry;

  const strippedHooks = entry.hooks
    .map(stripImpeccableHookEntry)
    .filter(Boolean);

  if (strippedHooks.length === 0 && entry.hooks.some(valueHasImpeccableHookMarker)) {
    return null;
  }

  return { ...entry, hooks: strippedHooks };
}

function stripImpeccableHookEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(stripImpeccableHookEntry)
    .filter(Boolean);
}

// Remove our hook from a manifest file, preserving any unrelated content. Used
// when the hook is honored in the shared settings.json so a stale machine-local
// copy doesn't make the detector run twice. Drops the file if nothing but our
// hook scaffolding remains. Returns true if it changed anything.
function pruneImpeccableHookFromManifest(manifestPath) {
  if (!fileHasImpeccableHookMarker(manifestPath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return false;
  }

  const existingHooks = parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
    ? parsed.hooks
    : {};
  const cleanedHooks = {};
  for (const [event, entries] of Object.entries(existingHooks)) {
    const kept = stripImpeccableHookEntries(entries);
    if (kept.length > 0) cleanedHooks[event] = kept;
  }

  const next = { ...parsed };
  if (Object.keys(cleanedHooks).length > 0) {
    next.hooks = cleanedHooks;
  } else {
    // Our hook was the only thing here; drop the hook-manifest scaffolding too.
    delete next.hooks;
    delete next.description;
    delete next.version;
  }

  if (Object.keys(next).length === 0) {
    rmSync(manifestPath, { force: true });
  } else {
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return true;
}

function mergeHookManifests(existing, fresh) {
  const existingObject = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const freshObject = fresh && typeof fresh === 'object' && !Array.isArray(fresh) ? fresh : {};
  const existingHooks = existingObject.hooks && typeof existingObject.hooks === 'object' && !Array.isArray(existingObject.hooks)
    ? existingObject.hooks
    : {};
  const freshHooks = freshObject.hooks && typeof freshObject.hooks === 'object' && !Array.isArray(freshObject.hooks)
    ? freshObject.hooks
    : {};

  const merged = { ...existingObject, hooks: {} };
  if (freshObject.version !== undefined) merged.version = freshObject.version;
  if (freshObject.description !== undefined) merged.description = freshObject.description;

  const hookEvents = new Set([...Object.keys(existingHooks), ...Object.keys(freshHooks)]);
  for (const event of hookEvents) {
    const preserved = stripImpeccableHookEntries(existingHooks[event]);
    const added = Array.isArray(freshHooks[event]) ? freshHooks[event] : [];
    const mergedEntries = [...preserved, ...added];
    if (mergedEntries.length > 0) merged.hooks[event] = mergedEntries;
  }

  return merged;
}

function readJsonFile(filePath, description) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new Error(`${description} is not valid JSON: ${filePath}. ${e.message}`);
  }
}

function copyProviderHooks(bundleDir, root, providers, { force = false, skillRoot = root } = {}) {
  const targets = Array.isArray(providers) ? providers : [providers];
  const written = [];
  for (const provider of targets) {
    for (const { src, dest, sharedDest } of hookArtifactsForProvider(bundleDir, root, provider)) {
      if (!existsSync(src)) continue;

      // Leave-it-never-duplicate: our hook already lives in the team-shared
      // settings.json (a legacy install or a deliberate user move). Honor it in
      // place and skip the local write — but first strip any stale copy from the
      // local override, or Claude Code would load both and run the detector
      // twice per edit.
      if (sharedDest && fileHasImpeccableHookMarker(sharedDest)) {
        pruneImpeccableHookFromManifest(dest);
        continue;
      }

      const freshManifest = readJsonFile(src, 'Bundled hook manifest');
      const fresh = skillRoot === root
        ? freshManifest
        : rewriteHookCommandsForSkillRoot(freshManifest, provider, skillRoot);
      let next = fresh;

      if (existsSync(dest)) {
        try {
          const existing = JSON.parse(readFileSync(dest, 'utf-8'));
          next = mergeHookManifests(existing, fresh);
        } catch {
          if (!force) {
            throw new Error(`Existing hook manifest is not valid JSON: ${dest}. Re-run with --force to replace it.`);
          }
          writeFileSync(`${dest}.bak`, readFileSync(dest));
          next = fresh;
        }
      }

      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, `${JSON.stringify(next, null, 2)}\n`);
      written.push(provider);
    }
  }
  return [...new Set(written)];
}

const HOOK_EXPLAINER = [
  '',
  'Impeccable can install a design hook for this project. In Claude/Codex it',
  'checks UI files after edits; in Cursor it checks proposed writes before they',
  'land and can block writes with detector findings. It feeds results back to',
  'your agent so design slop gets caught as you build. Change it later with',
  '/impeccable hooks on|off.',
  '',
].join('\n');

// Decide whether to install the design hook. Prompts once (default yes) the
// first time, records the answer in .impeccable/config.local.json, and never
// re-asks: a recorded decision or an already-installed hook short-circuits, and
// non-interactive runs keep the historical install-by-default behavior.
async function decideHookInstall(root, targets, { yes } = {}) {
  if (targets.length === 0) return false;
  const consent = getHookConsent(root);
  if (consent === 'declined') return false;
  if (consent === 'accepted') return true;
  // Existing hook users (hook already wired up) are never nagged.
  if (targets.length > 0 && targets.every(provider => hookInstalledForProvider(root, provider))) {
    return true;
  }
  // Undecided and not yet installed. Non-interactive (-y or no TTY) keeps the
  // historical default-on behavior without recording a (re-promptable) decision.
  if (yes || !process.stdin.isTTY) return true;

  process.stdout.write(HOOK_EXPLAINER);
  const ans = await ask('Install the design hook? (Y/n) ');
  const accepted = !(ans === 'n' || ans === 'no');
  setHookConsent(root, accepted ? 'accepted' : 'declined');
  return accepted;
}

function resolveLinkSource(sourceValue, root) {
  const sourcePath = sourceValue || '.impeccable';
  const checkoutRoot = isAbsolute(sourcePath) ? sourcePath : resolve(root, sourcePath);
  const universalRoot = join(checkoutRoot, 'dist', 'universal');
  if (existsSync(universalRoot)) {
    return { checkoutRoot, bundleRoot: universalRoot };
  }
  if (PROVIDER_DIRS.some(provider => existsSync(join(checkoutRoot, provider, 'skills')))) {
    return { checkoutRoot, bundleRoot: checkoutRoot };
  }
  throw new Error(`Could not find compiled skills in ${sourcePath}. Expected dist/universal/ or provider skill folders.`);
}

function pathExistsOrLink(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isSymlinkTo(dest, expectedSource) {
  try {
    if (!lstatSync(dest).isSymbolicLink()) return false;
    const target = readlinkSync(dest);
    const resolvedTarget = resolve(dirname(dest), target);
    return realpathSync(resolvedTarget) === realpathSync(expectedSource);
  } catch {
    return false;
  }
}

function resolveUniqueLinkTargets(root, targets) {
  const seen = new Set();
  const unique = [];
  for (const provider of targets) {
    const localSkillsDir = join(root, provider, 'skills');
    mkdirSync(localSkillsDir, { recursive: true });
    const real = realpathSync(localSkillsDir);
    if (seen.has(real)) continue;
    seen.add(real);
    unique.push({ provider, localSkillsDir });
  }
  return unique;
}

function linkProviderSkills(bundleRoot, root, targets, { force = false } = {}) {
  let linked = 0;
  let already = 0;
  let skipped = 0;

  for (const { provider, localSkillsDir } of resolveUniqueLinkTargets(root, targets)) {
    const srcDir = join(bundleRoot, provider, 'skills');
    if (!existsSync(srcDir)) continue;

    for (const skill of readdirSync(srcDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const src = join(srcDir, skill.name);
      const dest = join(localSkillsDir, skill.name);

      if (pathExistsOrLink(dest)) {
        if (isSymlinkTo(dest, src)) {
          already++;
          continue;
        }
        if (!force) {
          console.warn(`Skipped existing ${provider}/skills/${skill.name}. Use --force to replace it with a link.`);
          skipped++;
          continue;
        }
        rmSync(dest, { recursive: true, force: true });
      }

      const target = relative(dirname(dest), src) || '.';
      symlinkSync(target, dest, 'dir');
      linked++;
    }
  }

  return { linked, already, skipped };
}

async function link(flags) {
  const force = flags.includes('--force');
  const yes = flags.includes('-y') || flags.includes('--yes');
  const sourceValue = getFlagValue(flags, '--source');
  const providersValue = getFlagValue(flags, '--providers');
  const root = findProjectRoot();

  let source;
  try {
    source = resolveLinkSource(sourceValue, root);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const targets = resolveInstallTargets(root, providersValue);
  if (targets.length === 0) {
    console.error('Could not determine a target harness folder.');
    console.error('Pass one explicitly, e.g. --providers=claude,cursor');
    process.exit(1);
  }

  if (!yes) {
    console.log(`Source checkout: ${source.checkoutRoot}`);
    console.log(`Target harness folder(s): ${targets.join(', ')}`);
    const ans = await ask(`Link impeccable skills into ${targets.length} folder(s)? (Y/n) `);
    if (ans === 'n' || ans === 'no') {
      console.log('Aborted. Re-run with --providers=<names> to choose explicitly (e.g. --providers=claude,cursor).');
      process.exit(0);
    }
  }

  const result = linkProviderSkills(source.bundleRoot, root, targets, { force });
  if (result.linked === 0 && result.already === 0) {
    if (result.skipped > 0) {
      console.error('Nothing was linked because matching skill folders already exist.');
      console.error('Existing skills were left untouched. Re-run with --force to replace them with links.');
    } else {
      console.error(`Nothing was linked: ${source.bundleRoot} had no variants for ${targets.join(', ')}.`);
    }
    process.exit(1);
  }

  const parts = [];
  if (result.linked > 0) parts.push(`${result.linked} linked`);
  if (result.already > 0) parts.push(`${result.already} already linked`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  console.log(`Linked impeccable into: ${targets.join(', ')} (${parts.join(', ')}).`);
  console.log('Update with `git submodule update --remote` from your project root, then rerun this command if new skills are added.\n');
}

async function install(flags) {
  const force = flags.includes('--force');
  const yes = flags.includes('-y') || flags.includes('--yes');
  const installHooks = !flags.includes('--no-hooks');
  const projectRoot = findProjectRoot();
  if (!yes) printInstallIntro();
  let plan;
  try {
    plan = await chooseInstallPlan(projectRoot, flags, { yes });
  } catch (e) {
    if (isPromptAbortError(e)) throw e;
    console.error(e.message);
    console.error('Pass providers explicitly, e.g. --providers=claude,cursor');
    process.exit(1);
  }

  const { targets, installRoot, hookRoot, scope } = plan;
  const existing = isAlreadyInstalled(installRoot);

  if (existing && !force) {
    console.log(`Impeccable skills are already installed (found in ${existing}/).`);
    const installedTargets = findInstalledProviders(installRoot);
    const selectedInstalledTargets = targets.filter(provider => installedTargets.includes(provider));
    const linkedTargets = findLinkedProviders(installRoot, selectedInstalledTargets);
    const copyTargets = selectedInstalledTargets.filter(provider => !linkedTargets.includes(provider));
    const hookTargets = selectedInstalledTargets;
    const wantHooks = installHooks && await decideHookInstall(hookRoot, hookTargets, { yes });
    let bundleDir;
    try {
      if (linkedTargets.length > 0) {
        console.log(`Linked skills found in: ${linkedTargets.join(', ')}`);
        console.log('Update the source checkout with `git submodule update --remote`, then rerun `npx impeccable link --source=.impeccable` if new skills are added.');
        if (copyTargets.length > 0) console.log(`Continuing with copied installs in: ${copyTargets.join(', ')}\n`);
      }

      let updated = 0;
      const missingHookTargets = wantHooks
        ? hookTargets.filter(provider => !hookInstalledForProvider(hookRoot, provider))
        : [];
      let updateCheckSkipped = false;
      if (copyTargets.length > 0 || missingHookTargets.length > 0) {
        try {
          bundleDir = await downloadAndExtractBundle();
        } catch (e) {
          if (missingHookTargets.length > 0) throw e;
          updateCheckSkipped = true;
          console.log(`Could not check for skill updates: ${e.message}`);
        }
      }

      if (!updateCheckSkipped && copyTargets.length > 0 && !isUpToDate(installRoot, copyTargets, bundleDir)) {
        migrateUnprefixImpeccable(installRoot);
        updated = refreshProviderSkills(bundleDir, installRoot, copyTargets);
        const v = getSkillsVersion(installRoot);
        console.log(`Updated ${updated} skill(s)${v ? ` to v${v}` : ''}.`);
      }

      const writtenHookTargets = missingHookTargets.length > 0
        ? copyProviderHooks(bundleDir, hookRoot, missingHookTargets, { skillRoot: installRoot })
        : [];
      if (writtenHookTargets.length > 0) console.log(`Installed hooks into: ${writtenHookTargets.join(', ')}`);

      if (updateCheckSkipped) {
        console.log('Existing skills were left unchanged.');
        console.log('Run with --force to reinstall.\n');
      } else if (updated === 0 && writtenHookTargets.length === 0) {
        const v = getSkillsVersion(installRoot);
        console.log(`Skills are up to date${v ? ` (v${v})` : ''}.`);
        console.log('Run with --force to reinstall.\n');
      } else {
        console.log('Done!\n');
      }
    } catch (e) {
      console.error(`Install check failed: ${e.message}`);
      process.exit(1);
    } finally {
      if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
    }
    process.exit(0);
  }

  // Decide which harness folders to install into, then copy each harness's own
  // compiled variant from the universal bundle. We deliberately do NOT shell out
  // to `npx skills add`: its name-based discovery can install the uncompiled
  // source, and its symlink default points every harness at one shared variant.
  // Copying per-provider variants is the only correct install for this skill.
  if (targets.length === 0) {
    console.error('Could not determine a target harness folder.');
    console.error('Pass one explicitly, e.g. --providers=.claude,.cursor');
    process.exit(1);
  }

  const wantHooks = installHooks && await decideHookInstall(hookRoot, targets, { yes });

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
  migrateUnprefixImpeccable(installRoot);

  let written = 0;
  let hookTargets = [];
  try {
    written = copyProviderSkills(bundleDir, installRoot, targets);
    hookTargets = wantHooks ? copyProviderHooks(bundleDir, hookRoot, targets, { force, skillRoot: installRoot }) : [];
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
  console.log(`Installed impeccable into: ${targets.join(', ')} (${scope === 'user' ? 'global' : 'project'})`);
  if (hookTargets.length > 0) console.log(`Installed hooks into: ${hookTargets.join(', ')}`);

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

function findLinkedProviders(root, providers) {
  return providers.filter(provider => {
    const skillDir = join(root, provider, 'skills', 'impeccable');
    try {
      return lstatSync(skillDir).isSymbolicLink();
    } catch {
      return false;
    }
  });
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
  const force = flags.includes('--force');
  const installHooks = !flags.includes('--no-hooks');

  // Download the latest skills directly from impeccable.style.
  // We skip `npx skills update` because it has a known upstream bug
  // (vercel-labs/skills#775) where it can't find the lock file.
  const root = findProjectRoot();
  const providers = findInstalledProviders(root);
  const linkedProviders = findLinkedProviders(root, providers);
  const copyProviders = providers.filter(provider => !linkedProviders.includes(provider));

  if (providers.length === 0) {
    console.log('No impeccable skill folders found in this project.');
    console.log('Run `npx impeccable install` to install first.');
    process.exit(1);
  }

  if (linkedProviders.length > 0) {
    console.log(`Linked skills found in: ${linkedProviders.join(', ')}`);
    console.log('Update the source checkout with `git submodule update --remote`, then rerun `npx impeccable link --source=.impeccable` if new skills are added.');
    if (copyProviders.length === 0) process.exit(0);
    console.log(`Continuing with copied installs in: ${copyProviders.join(', ')}\n`);
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
  if (isUpToDate(root, copyProviders, tmpDir)) {
    try {
      const wantHooks = installHooks && await decideHookInstall(root, copyProviders, { yes });
      const hookTargets = wantHooks ? copyProviderHooks(tmpDir, root, copyProviders, { force }) : [];
      rmSync(tmpDir, { recursive: true, force: true });
      const v = getSkillsVersion(root);
      console.log(`Skills are up to date${v ? ` (v${v})` : ''}.`);
      if (hookTargets.length > 0) console.log(`Installed hooks into: ${hookTargets.join(', ')}`);
      console.log('Nothing else to do.');
      process.exit(0);
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      console.error(`Update failed: ${e.message}`);
      process.exit(1);
    }
  }

  console.log(`Found skills in: ${copyProviders.join(', ')}`);

  if (!yes) {
    const ans = await ask(`Update skills in ${copyProviders.length} provider folder(s)? (Y/n) `);
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

    const updated = refreshProviderSkills(tmpDir, root, copyProviders);
    const wantHooks = installHooks && await decideHookInstall(root, providers, { yes });
    const hookTargets = wantHooks ? copyProviderHooks(tmpDir, root, providers, { force }) : [];

    rmSync(tmpDir, { recursive: true, force: true });

    const v = getSkillsVersion(root);
    console.log(`Updated ${updated} skill(s)${v ? ` to v${v}` : ''}.`);
    if (hookTargets.length > 0) console.log(`Installed hooks into: ${hookTargets.join(', ')}`);
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
export {
  collectInstallDetections,
  copyProviderHooks,
  copyProviderSkills,
  decideHookInstall,
  expectedHookDests,
  extractZip,
  formatInstallDetectionLines,
  linkProviderSkills,
  mergeHookManifests,
  migrateUnprefixImpeccable,
  resolveInstallTargets,
  resolveLinkSource,
};

// ─── Router ───────────────────────────────────────────────────────────────────

export async function run(args) {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    await showHelp();
  } else if (sub === 'install') {
    await install(args.slice(1));
  } else if (sub === 'link') {
    await link(args.slice(1));
  } else if (sub === 'update') {
    await update(args.slice(1));
  } else if (sub === 'check') {
    await check();
  } else {
    console.error(`Unknown skills command: ${sub}`);
    console.error(`Run 'impeccable --help' for available commands.`);
    process.exit(1);
  }
}
