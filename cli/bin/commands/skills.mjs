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
import { existsSync, readFileSync, readdirSync, statSync, accessSync, constants, lstatSync, unlinkSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, rmdirSync, renameSync, createWriteStream, realpathSync, symlinkSync, readlinkSync, cpSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep, delimiter } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { unzipSync } from 'fflate';
import { getHookConsent, setHookConsent } from '../../lib/impeccable-config.mjs';
import { printUsage } from '../usage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://impeccable.style';

// Provider folder names in project roots
const PROVIDER_DIRS = ['.claude', '.cursor', '.gemini', '.agents', '.agent', '.github', '.grok', '.hermes', '.kiro', '.opencode', '.pi', '.qoder', '.trae', '.trae-cn', '.rovodev', '.vibe', '.veto'];
const PROVIDER_ALIASES = {
  agent: '.agent',
  agents: '.agents',
  antigravity: '.agent',
  claude: '.claude',
  'claude-code': '.claude',
  codex: '.agents',
  copilot: '.github',
  cursor: '.cursor',
  gemini: '.gemini',
  github: '.github',
  grok: '.grok',
  'grok-build': '.grok',
  hermes: '.hermes',
  xai: '.grok',
  kiro: '.kiro',
  opencode: '.opencode',
  pi: '.pi',
  qoder: '.qoder',
  'rovo-dev': '.rovodev',
  rovodev: '.rovodev',
  trae: '.trae',
  'trae-cn': '.trae-cn',
  vibe: '.vibe',
  veto: '.veto',
};

const PROVIDER_DISPLAY = {
  '.agent': { name: 'Antigravity', input: 'antigravity' },
  '.agents': { name: 'Codex CLI', input: 'codex' },
  '.claude': { name: 'Claude Code', input: 'claude' },
  '.cursor': { name: 'Cursor', input: 'cursor' },
  '.gemini': { name: 'Gemini CLI', input: 'gemini' },
  '.github': { name: 'GitHub Copilot', input: 'github' },
  '.grok': { name: 'Grok Build', input: 'grok' },
  '.hermes': { name: 'Hermes Agent', input: 'hermes' },
  '.kiro': { name: 'Kiro', input: 'kiro' },
  '.opencode': { name: 'OpenCode', input: 'opencode' },
  '.pi': { name: 'Pi Coding Agent', input: 'pi' },
  '.qoder': { name: 'Qoder', input: 'qoder' },
  '.rovodev': { name: 'Rovo Dev', input: 'rovo-dev' },
  '.trae': { name: 'Trae', input: 'trae' },
  '.trae-cn': { name: 'Trae CN', input: 'trae-cn' },
  '.vibe': { name: 'Mistral Vibe', input: 'vibe' },
  '.veto': { name: 'Veto', input: 'veto' },
};
const PROVIDER_INPUT_ORDER = ['antigravity', 'claude', 'codex', 'cursor', 'gemini', 'github', 'grok', 'hermes', 'kiro', 'opencode', 'pi', 'qoder', 'trae', 'trae-cn', 'rovo-dev', 'vibe', 'veto'];

// OpenCode reads global skills from its config directory, not ~/.opencode:
// $OPENCODE_CONFIG_DIR, else $XDG_CONFIG_HOME/opencode, else
// ~/.config/opencode. Writing to ~/.opencode/skills produced an install
// `opencode debug skill` never listed. See issue #406.
function opencodeGlobalConfigDir(home) {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'opencode');
  return join(home, '.config', 'opencode');
}

// Hermes reads skills from `$HERMES_HOME/skills/`, where $HERMES_HOME defaults
// to `~/.hermes` but is also set to a profile path (e.g.
// `~/.hermes/profiles/forge`) when a non-default profile is active. Reading
// the env var matters here at install time: writing to `~/.hermes/skills/`
// from a profile-scoped Hermes invocation would land in the wrong profile
// (the same cross-profile data-corruption class that the active_profile
// fallback warning in hermes_constants.py exists to detect). Used by
// HOME_SKILLS_DIR_OVERRIDES['.hermes'] only; GLOBAL_HARNESS_HINTS reads the
// fixed `~/.hermes` location so detection doesn't leak the developer's real
// HERMES_HOME into test output (test isolation).
//
// Ignore $HERMES_HOME when it doesn't sit under `home` (the caller-supplied
// home dir, which tests inject via HOME=/tmp/...). Without this guard, an
// inherited $HERMES_HOME=/home/<dev>/.hermes from the developer's shell leaks
// into test output even when the test sets HOME=/tmp/imp-home-xxx: tests
// expect ~/.hermes to live under their tmp home, not under the dev's real
// home. The check uses `resolve()` on both sides so a symlinked test home
// (e.g. /tmp -> /private/tmp on macOS) still compares correctly.
function hermesGlobalHome(home) {
  const envHome = process.env.HERMES_HOME;
  if (envHome) {
    try {
      const resolvedEnv = resolve(envHome);
      const resolvedHome = resolve(home);
      // Honor HERMES_HOME only when it lives under the active home (real
      // ~/.hermes or ~/.hermes/profiles/<name>). Cross-home inheritance is
      // treated as not-set, so a test running under HOME=/tmp/... doesn't
      // pick up the developer's real ~/.hermes.
      if (resolvedEnv === resolvedHome || resolvedEnv.startsWith(resolvedHome + sep)) {
        return resolvedEnv;
      }
    } catch {
      // fall through to default
    }
  }
  return join(home, '.hermes');
}

// Providers whose GLOBAL (home) skills dir is not `<provider>/skills`,
// as a function of the home dir. Pi discovers global skills from
// ~/.pi/agent/skills/ (issue #327); OpenCode from its config dir (issue
// #406); Hermes from $HERMES_HOME. Project scope stays `<provider>/skills`
// for all three.
const HOME_SKILLS_DIR_OVERRIDES = {
  '.agent': (home) => join(home, '.gemini', 'config', 'skills'),
  '.hermes': (home) => join(hermesGlobalHome(home), 'skills'),
  '.pi': (home) => join(home, '.pi', 'agent', 'skills'),
  '.opencode': (home) => join(opencodeGlobalConfigDir(home), 'skills'),
};

// When a project has no harness folder yet, infer the target from globally
// installed harnesses (~/.claude, ~/.codex, ...). Codex reads skills from
// .agents/skills, so ~/.codex maps to the .agents bundle variant.
//
// Hermes auto-detection uses the fixed `~/.hermes` location only. When a
// non-default Hermes profile is active (HERMES_HOME points to a profile path),
// the user is expected to be inside a Hermes invocation and can pass
// --providers=hermes explicitly. Auto-detection from a non-default HERMES_HOME
// would also defeat test isolation (tests inject HOME; HERMES_HOME leaks from
// the parent process and would surface the developer's real ~/.hermes in
// detection output). The install path honors $HERMES_HOME; detection does not.
const GLOBAL_HARNESS_HINTS = [
  { home: '.agent', provider: '.agent' },
  // Antigravity nests under ~/.gemini/ too, so any of these also trips the
  // .gemini hint above (harmless double-detection — both get pre-selected).
  { home: '.gemini/antigravity', provider: '.agent' },
  { home: '.gemini/antigravity-cli', provider: '.agent' },
  { home: '.gemini/antigravity-ide', provider: '.agent' },
  { home: '.claude', provider: '.claude' },
  { home: '.codex', provider: '.agents' },
  { home: '.cursor', provider: '.cursor' },
  { home: '.gemini', provider: '.gemini' },
  { home: '.grok', provider: '.grok' },
  { home: '.hermes', provider: '.hermes' },
  { home: '.kiro', provider: '.kiro' },
  { home: '.opencode', provider: '.opencode' },
  // OpenCode's real global config dir (issue #406); the ~/.opencode entry
  // above keeps recognizing machines that only have the legacy dir.
  { resolve: opencodeGlobalConfigDir, provider: '.opencode' },
  { home: '.pi', provider: '.pi' },
  { home: '.qoder', provider: '.qoder' },
  { home: '.rovodev', provider: '.rovodev' },
  { home: '.vibe', provider: '.vibe' },
  // Veto is a CLI harness whose managed skill directory is ~/.veto/skills.
  // Require its managed state directory as well as the executable so an
  // unrelated `veto` binary on PATH does not change project install defaults.
  { command: 'veto', provider: '.veto' },
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
  // Grok Build discovers project hooks from `.grok/hooks/*.json`. Team-shared
  // by default (commit them if the whole team uses Grok); folder trust is still
  // required via `/hooks-trust` or `--trust` before they run.
  '.grok': [
    { sourceProvider: '.grok', rel: 'hooks/impeccable.json', destProvider: '.grok' },
  ],
};

function userProviderSkillsDir(home, provider) {
  const override = HOME_SKILLS_DIR_OVERRIDES[provider];
  if (override) return override(home);
  return join(home, provider, 'skills');
}

// Compare via realpath: the project root comes from process.cwd() (symlinks
// resolved) while homedir() reflects $HOME verbatim, so a home dir reached
// through a symlink (e.g. /tmp -> /private/tmp) would fail a string compare.
function isHomeDir(root) {
  if (root === homedir()) return true;
  try {
    return realpathSync(root) === realpathSync(homedir());
  } catch {
    return false;
  }
}

// Every layout a provider's installed skills can live in under `root`.
// `scope` narrows the answer when the caller knows which install it is
// acting on: 'user' means the provider's global layout, 'project' means
// `<provider>/skills`. Without a scope (update/check, where installs of
// either kind may live under `root`) both layouts are candidates when
// `root` is the home dir, since an overridden provider (Pi) keeps its
// global skills elsewhere while a repo rooted at ~ still uses the project
// layout. Scoping matters for the same reason: a project-scope install in
// a home-rooted repo must not be conflated with an existing global one.
function providerSkillsDirCandidates(root, provider, scope) {
  if (scope === 'user') return [userProviderSkillsDir(root, provider)];
  const dirs = [join(root, provider, 'skills')];
  if (scope !== 'project' && HOME_SKILLS_DIR_OVERRIDES[provider] && isHomeDir(root)) {
    dirs.unshift(userProviderSkillsDir(root, provider));
  }
  return dirs;
}

function existingSkillsDirs(root, provider, scope) {
  return providerSkillsDirCandidates(root, provider, scope).filter(existsSync);
}

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

function parseSkillFrontmatterVersion(content) {
  const match = String(content).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|[ \t]*$)/);
  if (!match) return null;

  let metadataVersion = null;
  let topLevelVersion = null;
  let inMetadata = false;
  let metadataIndent = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indentText = line.match(/^[ \t]*/)[0];
    const indent = indentText.replace(/\t/g, '  ').length;

    if (indent === 0) {
      inMetadata = /^metadata:\s*(?:#.*)?$/.test(line);
      metadataIndent = null;
      const version = line.match(/^version:\s*(.+?)\s*$/);
      if (version) topLevelVersion = version[1];
      continue;
    }

    if (!inMetadata) continue;
    if (metadataIndent === null) metadataIndent = indent;
    if (indent !== metadataIndent) continue;
    const version = line.trim().match(/^version:\s*(.+?)\s*$/);
    if (version) metadataVersion = version[1];
  }

  const value = metadataVersion || topLevelVersion;
  return value ? value.trim().replace(/^(["'])(.*)\1$/, '$2') : null;
}

/**
 * Read the skills version from the impeccable SKILL.md frontmatter.
 */
function getSkillsVersion(root, scope) {
  for (const d of PROVIDER_DIRS) {
    for (const skillsDir of providerSkillsDirCandidates(root, d, scope)) {
      const skillMd = join(skillsDir, 'impeccable', 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      const content = readFileSync(skillMd, 'utf-8');
      const version = parseSkillFrontmatterVersion(content);
      if (version) return version;
    }
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

  const staging = mkdtempSync(join(tmpdir(), 'impeccable-update-'));
  const tmpZip = join(staging, 'bundle.zip');
  try {
    await downloadFile(`${API_BASE}/api/download/bundle/universal`, tmpZip);
    await extractZip(tmpZip, staging);
    rmSync(tmpZip, { force: true });
    return staging;
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

async function copyOrExtractLocalBundle(sourceValue) {
  const source = resolve(sourceValue);
  if (!existsSync(source)) {
    throw new Error(`Local bundle not found: ${source}`);
  }

  const staging = mkdtempSync(join(tmpdir(), 'impeccable-local-bundle-'));
  try {
    if (statSync(source).isDirectory()) {
      cpSync(source, staging, { recursive: true });
    } else {
      await extractZip(source, staging);
    }
    return staging;
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
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
    .replace(/\.(claude|cursor|agents|agent|github|gemini|codex|grok|hermes|kiro|opencode|pi|qoder|trae|trae-cn|rovodev|vibe|veto)\/skills\//g, '.PROVIDER/skills/');
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
function deduplicateProviders(root, providers, scope) {
  const seen = new Map(); // realPath -> { provider, localSkillsDir }
  for (const provider of providers) {
    // A provider can hold real installs in more than one layout (a home-rooted
    // repo may carry both ~/.pi/agent/skills and ~/.pi/skills). Keep each as
    // its own entry so update/check touch every tree, not just the first.
    for (const skillsDir of existingSkillsDirs(root, provider, scope)) {
      const real = realpathSync(skillsDir);
      if (!seen.has(real)) {
        seen.set(real, { provider, localSkillsDir: skillsDir });
      }
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
function isUpToDate(root, providers, bundleDir, scope, agentScope = scope) {
  const unique = deduplicateProviders(root, providers, scope);
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

    // Provider command artifacts (e.g. OpenCode's commands/impeccable.md) are
    // part of "current" too: an install whose skills match but whose bridge is
    // missing or drifted must refresh, otherwise reinstall/update report
    // success while the slash command stays absent (#474 backfill). Only
    // bundle-shipped files are checked, so pinned or user commands never
    // affect freshness. The commands dir sits next to the matched skills dir
    // (project <root>/.opencode, user <config>, home-dir global override), so
    // deriving it from localSkillsDir stays correct for every layout
    // copyProviderCommands can write.
    const bundleCommandsDir = join(bundleDir, provider, 'commands');
    if (existsSync(bundleCommandsDir)) {
      const localCommandsDir = join(dirname(localSkillsDir), 'commands');
      for (const entry of readdirSync(bundleCommandsDir)) {
        const bundleFile = join(bundleCommandsDir, entry);
        if (!statSync(bundleFile).isFile()) continue;
        const localFile = join(localCommandsDir, entry);
        if (!existsSync(localFile)) return false;
        if (hashSkillFile(bundleFile) !== hashSkillFile(localFile)) return false;
      }
    }

    if (!providerAgentsUpToDate(bundleDir, root, provider, agentScope)) return false;
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
    const agentScope = isHomeDir(root) ? 'user' : undefined;
    const upToDate = isUpToDate(root, providers, bundleDir, undefined, agentScope);
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
function isAlreadyInstalled(root, scope) {
  for (const d of PROVIDER_DIRS) {
    for (const skillsDir of existingSkillsDirs(root, d, scope)) {
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
function migrateUnprefixImpeccable(root, scope) {
  let migrated = 0;
  for (const d of PROVIDER_DIRS) {
    for (const skillsDir of existingSkillsDirs(root, d, scope)) {
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
    userProviderSkillsDir(home, provider),
    join(home, harnessDir, 'skills'),
  ]);
}

function commandOnPath(command) {
  const candidates = process.platform === 'win32'
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`]
    : [command];
  for (const directory of String(process.env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    for (const candidate of candidates) {
      const path = resolve(directory, candidate);
      try {
        if (statSync(path).isFile()) {
          accessSync(path, constants.X_OK);
          return path;
        }
      } catch {}
    }
  }
  return null;
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

  for (const hint of GLOBAL_HARNESS_HINTS) {
    const { provider } = hint;
    // A hint is either a fixed dir under home or a resolver for harnesses
    // whose location depends on the environment (OpenCode's config dir).
    const foundPath = hint.command
      ? commandOnPath(hint.command)
      : hint.resolve ? hint.resolve(home) : join(home, hint.home);
    if (!foundPath || (!hint.command && !existsSync(foundPath))) continue;
    if (hint.command && !existsSync(join(home, '.veto'))) continue;
    const skillProbePaths = hint.command
      ? [userProviderSkillsDir(home, provider)]
      : hint.resolve
      ? uniquePaths([userProviderSkillsDir(home, provider), join(foundPath, 'skills')])
      : userSkillProbePaths(home, hint.home, provider);
    detections.push({
      provider,
      scope: 'user',
      foundPath,
      installRoot: home,
      installPath: userProviderSkillsDir(home, provider),
      skillProbePaths,
      hasRealSkills: skillProbePaths.some(hasRealSkillEntries),
      reason: hint.command ? 'CLI on PATH' : 'user harness folder',
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
  const { targets, detections, explicit } = await chooseInstallProviders(projectRoot, providersValue, { yes });
  if (targets.length === 0) {
    throw new Error('Could not determine a target harness folder.');
  }
  const scope = await chooseInstallScope(projectRoot, targets, detections, { yes, scopeValue });
  const installRoot = installRootForScope(scope, projectRoot);
  return { targets, scope, installRoot, hookRoot: projectRoot, detections, explicit };
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
 * `scope: 'user'` writes to the provider's global skills layout (see
 * HOME_SKILLS_DIR_OVERRIDES); anything else writes `<provider>/skills`.
 */
function copyProviderSkills(bundleDir, root, targets, { scope } = {}) {
  let written = 0;
  for (const provider of targets) {
    const srcDir = join(bundleDir, provider, 'skills');
    if (existsSync(srcDir)) {
      const localSkillsDir = scope === 'user'
        ? userProviderSkillsDir(root, provider)
        : join(root, provider, 'skills');
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
      // A pre-#406 global OpenCode install lived at ~/.opencode/skills, a
      // location OpenCode never reads. Now that the real copy sits in the
      // config dir, drop exactly the skills just written from the stranded
      // location; sibling skills and everything else in ~/.opencode stay.
      // Guards (both flagged in review): a symlinked skills dir is shared
      // storage whose target must not be emptied through the link, the
      // just-written dir must be compared by realpath rather than string,
      // and a home-rooted repo makes `.opencode/skills` a live
      // project-scope install rather than a stranded global one.
      if (scope === 'user' && provider === '.opencode') {
        const legacyDir = join(root, '.opencode', 'skills');
        let migratable = false;
        try {
          migratable = existsSync(legacyDir)
            && !lstatSync(legacyDir).isSymbolicLink()
            && realpathSync(legacyDir) !== realpathSync(localSkillsDir)
            && !existsSync(join(root, '.git'));
        } catch { migratable = false; }
        if (migratable) {
          for (const skill of readdirSync(srcDir, { withFileTypes: true })) {
            if (!skill.isDirectory()) continue;
            rmSync(join(legacyDir, skill.name), { recursive: true, force: true });
          }
          try { rmdirSync(legacyDir); } catch { /* not empty: siblings stay */ }
        }
      }
    }
  }
  return written;
}

/**
 * Copy each target provider's compiled command variant from an extracted
 * bundle into the project or global config dir. OpenCode 1.18.10 discovers
 * custom commands from `{command,commands}/**.md` under any active config
 * dir, so the install mirrors `copyProviderSkills`: project scope writes
 * `<root>/<configDir>/commands/`, user scope writes
 * `opencodeGlobalConfigDir(home)/commands` with the same
 * `OPENCODE_CONFIG_DIR` → `$XDG_CONFIG_HOME/opencode` → `~/.config/opencode`
 * precedence PR #417 established for skills.
 *
 * Migration guard: a pre-#406 global OpenCode install at
 * `~/.opencode/commands/` is not scanned by OpenCode. After a global
 * install, the commands just written are removed from the stranded
 * legacy copy, sibling commands stay put, symlinked legacy dirs are
 * skipped (deleting through a symlink would empty the real target), and
 * a home-rooted git repo (`<configDir>/commands/` IS a project install)
 * is left alone. Symmetric to `copyProviderSkills` at
 * `skills.mjs:1168-1186`.
 */
// Local commands dir for a provider. Project installs land at
// <root>/<configDir>/commands; user-scope OpenCode installs must target the
// config dir OpenCode actually scans (OPENCODE_CONFIG_DIR → XDG → ~/.config).
function providerCommandsDir(root, providerEntry, scope) {
  return scope === 'user'
    ? join(opencodeGlobalConfigDir(root), 'commands')
    : join(root, providerEntry.replace(/^\./, '.'), 'commands');
}

function copyProviderCommands(bundleDir, root, targets, { scope } = {}) {
  let written = 0;
  for (const target of targets) {
    const providerEntry = PROVIDER_DIRS.includes(`.${target}`)
      ? `.${target}`
      : target;
    const srcDir = join(bundleDir, providerEntry, 'commands');
    if (!existsSync(srcDir)) continue;
    const localCommandsDir = providerCommandsDir(root, providerEntry, scope);
    mkdirSync(localCommandsDir, { recursive: true });
    for (const entry of readdirSync(srcDir)) {
      const src = join(srcDir, entry);
      if (!statSync(src).isFile()) continue;
      const dest = join(localCommandsDir, entry);
      rmSync(dest, { recursive: true, force: true });
      copyFileSync(src, dest);
      written++;
    }
    if (scope === 'user' && providerEntry === '.opencode') {
      const legacyDir = join(root, '.opencode', 'commands');
      let migratable = false;
      try {
        migratable = existsSync(legacyDir)
          && !lstatSync(legacyDir).isSymbolicLink()
          && realpathSync(legacyDir) !== realpathSync(localCommandsDir)
          && !existsSync(join(root, '.git'));
      } catch { migratable = false; }
      if (migratable) {
        for (const entry of readdirSync(srcDir)) {
          const src = join(srcDir, entry);
          if (!statSync(src).isFile()) continue;
          rmSync(join(legacyDir, entry), { recursive: true, force: true });
        }
        try { rmdirSync(legacyDir); } catch { /* not empty: siblings stay */ }
      }
    }
  }
  return written;
}

// Native subagent definitions that ship in the bundle next to a provider's
// skills. Claude Code's live at `.claude/agents/impeccable-*.md`; project
// agents take precedence over user agents. GitHub Copilot's live at
// `.github/agents/impeccable-*.agent.md`:
// project installs commit them at `<repo>/.github/agents/`, user-level
// installs go to `~/.copilot/agents/` (Copilot's user-scope dir, NOT
// `~/.github/`). On a name conflict Copilot lets the user-level file shadow
// the project one, so both paths overwrite existing impeccable-* copies and a
// project install reports any same-named user-level agents that would shadow
// it. Cursor's live at `.cursor/agents/impeccable-*.md`, user scope
// `~/.cursor/agents/`; project agents take precedence there, so no shadow
// warning is needed.
const PROVIDER_AGENT_ARTIFACTS = {
  '.claude': {
    ext: '.md',
    userDir: home => join(home, '.claude', 'agents'),
    userShadowsProject: false,
  },
  '.github': {
    ext: '.agent.md',
    userDir: home => join(home, '.copilot', 'agents'),
    userShadowsProject: true,
  },
  '.cursor': {
    ext: '.md',
    userDir: home => join(home, '.cursor', 'agents'),
    userShadowsProject: false,
  },
};

function providerAgentsUpToDate(bundleDir, root, provider, scope) {
  const artifact = PROVIDER_AGENT_ARTIFACTS[provider];
  if (!artifact) return true;
  const srcDir = join(bundleDir, provider, 'agents');
  if (!existsSync(srcDir)) return true;

  const destDir = scope === 'user'
    ? artifact.userDir(root)
    : join(root, provider, 'agents');
  const agentFiles = readdirSync(srcDir).filter(name => name.endsWith(artifact.ext));
  return agentFiles.every(name => {
    const localPath = join(destDir, name);
    return existsSync(localPath)
      && hashSkillFile(join(srcDir, name)) === hashSkillFile(localPath);
  });
}

function copyProviderAgents(bundleDir, root, providers, { scope, home = homedir() } = {}) {
  const targets = Array.isArray(providers) ? providers : [providers];
  const results = [];
  for (const provider of targets) {
    const artifact = PROVIDER_AGENT_ARTIFACTS[provider];
    if (!artifact) continue;
    const srcDir = join(bundleDir, provider, 'agents');
    if (!existsSync(srcDir)) continue;
    const agentFiles = readdirSync(srcDir).filter(name => name.endsWith(artifact.ext));
    if (agentFiles.length === 0) continue;

    const destDir = scope === 'user'
      ? artifact.userDir(root)
      : join(root, provider, 'agents');
    mkdirSync(destDir, { recursive: true });
    for (const name of agentFiles) {
      writeFileSync(join(destDir, name), readFileSync(join(srcDir, name)));
    }

    // A project install can be shadowed by same-named agents in the user-level
    // dir; surface them so the freshly installed project agents actually apply.
    const userDir = artifact.userDir(home);
    const shadowed = artifact.userShadowsProject && scope !== 'user'
      ? agentFiles.filter(name => existsSync(join(userDir, name)))
      : [];

    results.push({ provider, written: agentFiles.length, destDir, userDir, shadowed });
  }
  return results;
}

function reportProviderAgents(results) {
  for (const result of results || []) {
    if (result.written === 0) continue;
    console.log(`Installed ${providerDisplayName(result.provider)} agents into: ${formatPathForDisplay(result.destDir)}`);
    if (result.shadowed.length > 0) {
      console.warn(`Warning: user-level agents in ${formatPathForDisplay(result.userDir)} shadow the project copies just installed: ${result.shadowed.join(', ')}.`);
      console.warn('Run `npx impeccable update --user` to refresh them, or remove them so the project agents apply.');
    }
  }
}

function refreshProviderSkills(bundleDir, root, providers, scope) {
  const unique = deduplicateProviders(root, providers, scope);
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

// The project-relative hook command path for a provider, used for project-scope
// installs (skillRoot === root). Derived rather than copied from the bundle: the
// Codex bundle ships a `.codex/skills/...` command (correct for a `.codex`-
// directory install), but the CLI lays Codex's skill down at `.agents/skills/`,
// so preserving the bundle token would point the hook at a nonexistent file and
// silently no-op it. Claude keeps its ${CLAUDE_PROJECT_DIR} token so a manifest
// read from a nested cwd (or copied into settings.local.json) still resolves.
function hookScriptRelPathForProvider(provider) {
  const script = provider === '.cursor' ? 'hook-before-edit.mjs' : 'hook.mjs';
  const rel = `${provider}/skills/impeccable/scripts/${script}`;
  return provider === '.claude' ? '${CLAUDE_PROJECT_DIR}/' + rel : rel;
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
  if (provider === '.claude' || provider === '.agents' || provider === '.grok') {
    return join(skillRoot, provider, 'skills', 'impeccable', 'scripts', 'hook.mjs');
  }
  return null;
}

// Wrap a `node "PATH"` hook command so a missing skill file is a silent no-op
// (exit 0) instead of a Node module-resolution crash. hook.mjs promises to
// "never break a turn. Always exit 0.", but that only holds once Node can load
// the file; a stale/missing path crashes before any of that logic runs. The
// `[ ! -f X ] || node X` form (NOT `... || true`) preserves Node's own exit
// code when the file exists, so Claude's exit-2 blocking signal still reaches
// the agent. POSIX-shell form, consistent with the project's other hook
// commands (e.g. the GitHub manifest's `$(git rev-parse ...)`).
//
// On Windows that guard is a hard failure, not a degraded one (issue #452).
// Codex runs hook commands through COMSPEC (`cmd.exe /C`), where `[` is not a
// command: the guard errors noisily and `||` then runs node even when the file
// is missing, trading the silent no-op for a MODULE_NOT_FOUND crash. Two
// remedies, by provider:
//
//   * Codex manifests support a `commandWindows` sibling that Codex 0.146.0+
//     selects on Windows (`command_windows.unwrap_or(command)` in its hook
//     discovery). rewriteHookCommandsForSkillRoot adds it with a cmd.exe
//     `if exist` guard (form contributed and Windows-tested by @PatrickSys in
//     issue #452; `exit /b` forwards node's errorlevel), so the same
//     .codex/hooks.json is correct on every OS no matter where it was
//     written, and `command` stays the plain POSIX guard.
//   * Claude and Cursor manifests have no per-platform field, so a Windows
//     install moves the existence check into node itself: a `node -e` wrapper
//     that exits 0 when the target is missing and otherwise re-spawns node on
//     it with inherited stdio, forwarding the hook's exit code. Cursor's
//     hooks.json is committable and can be consumed on a teammate's POSIX
//     machine, so the wrapper has to hold there too: it uses only characters
//     that survive PowerShell, cmd.exe (issue #445: shims re-parse through
//     `cmd /C`, which claims < > | & ^ % !), and sh double-quoting alike,
//     with single quotes for the inner string literals.
const WIN32_HOOK_GUARD_SCRIPT = "const p=process.argv[1];const f=require('fs');if(f.existsSync(p)){const r=require('child_process').spawnSync(process.execPath,[p],{stdio:'inherit'});process.exit(r.status===null?1:r.status);}";

// POSIX single-quote escaping. JSON.stringify is not shell quoting: inside
// double quotes /bin/sh still expands $(...), backticks, and ${}, and this
// string is baked into a hook manifest the harness re-executes on every edit,
// so an install path embedding $(...) would run it repeatedly (issue #476).
// Windows command forms keep double quotes: cmd.exe treats ' as a literal
// character and performs no command substitution.
function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function windowsHookCommand(quotedPath) {
  return `if exist ${quotedPath} (node ${quotedPath} & exit /b)`;
}

// `quotedPath` carries one pre-quoted form per target shell: { posix, win32 }.
function guardHookCommand(quotedPath, provider) {
  // `.agents` (Codex) keeps the POSIX form unconditionally: its Windows
  // consumers read the commandWindows sibling instead.
  if (provider !== '.agents' && process.platform === 'win32') {
    return `node -e "${WIN32_HOOK_GUARD_SCRIPT}" ${quotedPath.win32}`;
  }
  return `[ ! -f ${quotedPath.posix} ] || node ${quotedPath.posix}`;
}

// Transform bundled hook commands for the actual install target:
//   * absolute — rewrite the (marker) command to the resolved absolute skill
//     path. Required when the manifest is a user/global file (~/.claude/
//     settings.local.json) that fires in EVERY project, so ${CLAUDE_PROJECT_DIR}
//     would resolve per-project to dirs without a skill copy (issue #399); also
//     when a project hook points at a skill installed elsewhere (--scope=global).
//   * otherwise — keep the bundle's own ${CLAUDE_PROJECT_DIR}-relative path,
//     which correctly resolves for a project-scoped install.
// Either way the command goes through guardHookCommand (POSIX shell guard, or
// the shell-agnostic node -e guard when installing on Windows), and Codex hook
// entries additionally get a `commandWindows` sibling for cmd.exe.
function rewriteHookCommandsForSkillRoot(value, provider, { skillRoot, absolute }) {
  const hookScript = hookScriptPathForProvider(skillRoot, provider);
  // Providers we don't own a `node "PATH"` command hook for (.github) carry
  // their own portable command forms; leave them untouched.
  if (!hookScript) return value;

  // Project-scope installs derive the provider's own project-relative path
  // rather than trusting the bundle token, which for Codex points at
  // `.codex/skills/...` while the CLI installs the skill at `.agents/skills/`.
  // The absolute path comes from the install root (project dir or $HOME), so
  // its POSIX form gets real single-quote escaping (issue #476). The relative
  // form is a per-provider constant and stays double-quoted, because Claude's
  // ${CLAUDE_PROJECT_DIR} token must keep expanding at hook time.
  const relPath = hookScriptRelPathForProvider(provider);
  const quotedPath = absolute
    ? { posix: shSingleQuote(hookScript), win32: JSON.stringify(hookScript) }
    : { posix: JSON.stringify(relPath), win32: JSON.stringify(relPath) };

  if (typeof value === 'string') {
    if (!valueHasImpeccableHookMarker(value)) return value;
    return guardHookCommand(quotedPath, provider);
  }
  if (Array.isArray(value)) {
    return value.map(item => rewriteHookCommandsForSkillRoot(item, provider, { skillRoot, absolute }));
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = rewriteHookCommandsForSkillRoot(child, provider, { skillRoot, absolute });
    }
    if (provider === '.agents' && typeof value.command === 'string' && valueHasImpeccableHookMarker(value.command)) {
      next.commandWindows = windowsHookCommand(quotedPath.win32);
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
    const normalized = value.replace(/\\/g, '/');
    return IMPECCABLE_HOOK_COMMAND_MARKERS.some(marker => normalized.includes(marker));
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
      // Rewrite to an absolute skill path when the skill lives elsewhere than
      // this manifest's root (--scope=global project hook) OR when the manifest
      // itself is a user/global file. A global settings file fires in every
      // project, so ${CLAUDE_PROJECT_DIR} there crashes Node wherever no local
      // skill copy exists (issue #399); the resolved absolute path is correct
      // for the one global skill it targets.
      const absolute = skillRoot !== root || isHomeDir(root);
      const fresh = rewriteHookCommandsForSkillRoot(freshManifest, provider, { skillRoot, absolute });
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

  // Linked installs are excluded from install/update refreshes (overwriting a
  // symlink would destroy the link), so this is the only path that can deliver
  // the OpenCode command bridge to them. A copy, not a symlink: the bridge is
  // static and OpenCode scans the real commands dir. No-ops when the source
  // checkout has no built commands (e.g. dist/ not built yet).
  copyProviderCommands(source.bundleRoot, root, targets, { scope: 'project' });

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

  const { targets, installRoot, hookRoot, scope, explicit } = plan;
  const existing = isAlreadyInstalled(installRoot, scope);
  const installedTargets = existing ? findInstalledProviders(installRoot, scope) : [];
  // An explicit --providers list is a per-target request: a selected provider
  // with no install yet gets a fresh install instead of tripping the global
  // "already installed" early exit (issue #500). When every selected provider
  // is missing, skip the update branch entirely and take the fresh-install path.
  const missingSelectedTargets = (existing && !force && explicit)
    ? targets.filter(provider => !installedTargets.includes(provider))
    : [];

  if (existing && !force && missingSelectedTargets.length < targets.length) {
    console.log(`Impeccable skills are already installed (found in ${existing}/).`);
    const selectedInstalledTargets = targets.filter(provider => installedTargets.includes(provider));
    const linkedTargets = findLinkedProviders(installRoot, selectedInstalledTargets, scope);
    const copyTargets = selectedInstalledTargets.filter(provider => !linkedTargets.includes(provider));
    const hookTargets = [...selectedInstalledTargets, ...missingSelectedTargets];
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
      if (copyTargets.length > 0 || missingHookTargets.length > 0 || missingSelectedTargets.length > 0) {
        try {
          bundleDir = await downloadAndExtractBundle();
        } catch (e) {
          if (missingHookTargets.length > 0 || missingSelectedTargets.length > 0) throw e;
          updateCheckSkipped = true;
          console.log(`Could not check for skill updates: ${e.message}`);
        }
      }

      if (!updateCheckSkipped && copyTargets.length > 0 && !isUpToDate(installRoot, copyTargets, bundleDir, scope)) {
        migrateUnprefixImpeccable(installRoot, scope);
        updated = refreshProviderSkills(bundleDir, installRoot, copyTargets, scope);
        reportProviderAgents(copyProviderAgents(bundleDir, installRoot, copyTargets, { scope }));
        copyProviderCommands(bundleDir, installRoot, copyTargets, { scope });
        const v = getSkillsVersion(installRoot, scope);
        console.log(`Updated ${updated} skill(s)${v ? ` to v${v}` : ''}.`);
      }

      let freshWritten = 0;
      if (!updateCheckSkipped && missingSelectedTargets.length > 0) {
        freshWritten = copyProviderSkills(bundleDir, installRoot, missingSelectedTargets, { scope });
        if (freshWritten === 0) {
          console.error(`Nothing was installed: the bundle had no variants for ${missingSelectedTargets.join(', ')}.`);
          process.exit(1);
        }
        console.log(`Installed impeccable into: ${missingSelectedTargets.join(', ')} (${scope === 'user' ? 'global' : 'project'})`);
        reportProviderAgents(copyProviderAgents(bundleDir, installRoot, missingSelectedTargets, { scope }));
      }

      const writtenHookTargets = missingHookTargets.length > 0
        ? copyProviderHooks(bundleDir, hookRoot, missingHookTargets, { skillRoot: installRoot })
        : [];
      if (writtenHookTargets.length > 0) console.log(`Installed hooks into: ${writtenHookTargets.join(', ')}`);

      if (updateCheckSkipped) {
        console.log('Existing skills were left unchanged.');
        console.log('Run with --force to reinstall.\n');
      } else if (updated === 0 && writtenHookTargets.length === 0 && freshWritten === 0) {
        const v = getSkillsVersion(installRoot, scope);
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
  migrateUnprefixImpeccable(installRoot, scope);

  let written = 0;
  let hookTargets = [];
  let agentResults = [];
  try {
    written = copyProviderSkills(bundleDir, installRoot, targets, { scope });
    agentResults = copyProviderAgents(bundleDir, installRoot, targets, { scope });
    copyProviderCommands(bundleDir, installRoot, targets, { scope });
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
  reportProviderAgents(agentResults);
  if (hookTargets.length > 0) console.log(`Installed hooks into: ${hookTargets.join(', ')}`);

  console.log('\nDone! Now type /impeccable init in your AI coding agent\'s chat (not in this terminal) to set up design context.\n');
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

function findInstalledProviders(root, scope) {
  const found = [];
  for (const d of PROVIDER_DIRS) {
    for (const skillsDir of existingSkillsDirs(root, d, scope)) {
      try {
        const entries = readdirSync(skillsDir);
        if (entries.some(name => isSkillDir(skillsDir, name))) {
          found.push(d);
          break;
        }
      } catch {}
    }
  }
  return found;
}

// Like findInstalledProviders, but only counts a provider whose skills dir
// actually holds the IMPECCABLE skill (canonical, prefixed, or legacy teach-).
// `update` uses this so it never mistakes a repo that vendors OTHER first-party
// skills under .claude/skills for an impeccable install and drops a copy in
// (issue #399, part 2).
function findImpeccableProviders(root, scope) {
  const found = [];
  for (const d of PROVIDER_DIRS) {
    for (const skillsDir of existingSkillsDirs(root, d, scope)) {
      let entries;
      try { entries = readdirSync(skillsDir); } catch { continue; }
      if (entries.some(e =>
        e === 'impeccable' || e.endsWith('-impeccable') ||
        e === 'teach-impeccable' || e.endsWith('-teach-impeccable')
      )) {
        found.push(d);
        break;
      }
    }
  }
  return found;
}

// Resolve which install `skills update` should refresh: project-level (the CWD's
// git root) or user-level (~/.claude etc.). Returns a plain descriptor; the
// caller handles the interactive both-exist prompt via `ambiguous`.
function resolveUpdateTarget({ projectRoot, home, explicitScope }) {
  // A home-rooted repo (a dotfiles checkout at $HOME) overlaps project and user
  // installs under one root; keep the historical unscoped scan so overlapping
  // layouts (e.g. Pi's ~/.pi/skills and ~/.pi/agent/skills) both refresh.
  const homeRooted = isHomeDir(projectRoot);
  if (homeRooted && !explicitScope) {
    const providers = findInstalledProviders(home);
    return providers.length
      ? { root: home, scope: undefined, agentScope: 'user', providers, scopeLabel: 'user level' }
      : null;
  }

  const projectProviders = homeRooted ? [] : findImpeccableProviders(projectRoot, 'project');
  const userProviders = findImpeccableProviders(home, 'user');

  if (explicitScope === 'user') {
    return userProviders.length
      ? { root: home, scope: 'user', providers: userProviders, scopeLabel: 'user level' }
      : null;
  }
  if (explicitScope === 'project') {
    return projectProviders.length
      ? { root: projectRoot, scope: 'project', providers: projectProviders, scopeLabel: 'this project' }
      : null;
  }
  if (projectProviders.length && userProviders.length) {
    return { ambiguous: true, projectRoot, home, projectProviders, userProviders };
  }
  if (projectProviders.length) {
    return { root: projectRoot, scope: 'project', providers: projectProviders, scopeLabel: 'this project' };
  }
  if (userProviders.length) {
    return { root: home, scope: 'user', providers: userProviders, scopeLabel: 'user level' };
  }
  return null;
}

function findLinkedProviders(root, providers, scope) {
  return providers.filter(provider => {
    for (const skillsDir of providerSkillsDirCandidates(root, provider, scope)) {
      const skillDir = join(skillsDir, 'impeccable');
      try {
        if (lstatSync(skillDir).isSymbolicLink()) return true;
      } catch {}
    }
    return false;
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

async function downloadFile(url, dest, { fetchImpl = globalThis.fetch } = {}) {
  let current = url;
  let hopsLeft = 5;
  while (true) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:') {
      throw new Error('Refusing non-HTTPS URL');
    }
    const res = await fetchImpl(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`HTTP ${res.status}`);
      if (hopsLeft <= 0) throw new Error('Too many redirects');
      hopsLeft -= 1;
      current = new URL(location, current).href;
      continue;
    }
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.body) throw new Error('Empty response body');
    try {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest, { flags: 'wx' }));
    } catch (e) {
      if (e.code !== 'EEXIST') rmSync(dest, { force: true });
      throw e;
    }
    return;
  }
}

async function update(flags = []) {
  if (flags.includes('--help') || flags.includes('-h')) {
    printUsage();
    return;
  }

  const yes = flags.includes('-y') || flags.includes('--yes');
  const force = flags.includes('--force');
  const installHooks = !flags.includes('--no-hooks');
  const scopeValue = getInstallScopeValue(flags);
  const explicitScope = normalizeInstallScope(scopeValue);
  if (scopeValue && !explicitScope) {
    console.error(`Unknown update scope: ${scopeValue}. Use --project or --user.`);
    process.exit(1);
  }

  // Download the latest skills directly from impeccable.style.
  // We skip `npx skills update` because it has a known upstream bug
  // (vercel-labs/skills#775) where it can't find the lock file.
  const projectRoot = findProjectRoot();
  const home = homedir();

  let target = resolveUpdateTarget({ projectRoot, home, explicitScope });
  if (!target) {
    if (explicitScope) {
      const where = explicitScope === 'user' ? `user level (${formatPathForDisplay(home)})` : `this project (${projectRoot})`;
      console.log(`No impeccable skill folders found at the ${where}.`);
    } else {
      console.log('No impeccable skill folders found in this project or at the user level.');
    }
    console.log('Run `npx impeccable install` to install first.');
    process.exit(1);
  }

  // Both a project and a user-level install exist and no scope was given. Never
  // silently pick (issue #399, part 2): prompt when interactive, else default to
  // the project and say how to target the other.
  if (target.ambiguous) {
    console.log('Impeccable is installed both here and at the user level:');
    console.log(`  project    ${projectRoot}  (${target.projectProviders.join(', ')})`);
    console.log(`  user level ${formatPathForDisplay(home)}  (${target.userProviders.join(', ')})`);
    let pickUser = false;
    if (!yes && process.stdin.isTTY) {
      const ans = await ask('Update which? [project]/user: ');
      pickUser = ['user', 'u', 'global', 'home'].includes(ans);
    } else {
      console.log('Defaulting to the project. Re-run with --user to update the user-level install instead.');
    }
    target = pickUser
      ? { root: home, scope: 'user', providers: target.userProviders, scopeLabel: 'user level' }
      : { root: projectRoot, scope: 'project', providers: target.projectProviders, scopeLabel: 'this project' };
  }

  const { root, scope, agentScope = scope } = target;
  console.log(`Updating the ${target.scopeLabel} install: ${formatPathForDisplay(root)} (${target.providers.join(', ')})`);
  const providers = target.providers;
  const linkedProviders = findLinkedProviders(root, providers, scope);
  const copyProviders = providers.filter(provider => !linkedProviders.includes(provider));

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
  if (isUpToDate(root, copyProviders, tmpDir, scope, agentScope)) {
    try {
      const wantHooks = installHooks && await decideHookInstall(root, copyProviders, { yes });
      const hookTargets = wantHooks ? copyProviderHooks(tmpDir, root, copyProviders, { force }) : [];
      rmSync(tmpDir, { recursive: true, force: true });
      const v = getSkillsVersion(root, scope);
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
    const migrated = migrateUnprefixImpeccable(root, scope);
    if (migrated > 0) console.log('Migrated a prefixed install back to /impeccable (the i- prefix is no longer used).');

    const updated = refreshProviderSkills(tmpDir, root, copyProviders, scope);
    reportProviderAgents(copyProviderAgents(tmpDir, root, copyProviders, { scope: agentScope }));
    copyProviderCommands(tmpDir, root, copyProviders, { scope });
    const wantHooks = installHooks && await decideHookInstall(root, providers, { yes });
    const hookTargets = wantHooks ? copyProviderHooks(tmpDir, root, providers, { force }) : [];

    rmSync(tmpDir, { recursive: true, force: true });

    const v = getSkillsVersion(root, scope);
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
  copyProviderAgents,
  copyProviderCommands,
  copyProviderHooks,
  copyProviderSkills,
  decideHookInstall,
  downloadAndExtractBundle,
  downloadFile,
  expectedHookDests,
  extractZip,
  formatInstallDetectionLines,
  getSkillsVersion,
  isUpToDate,
  hermesGlobalHome,
  HOME_SKILLS_DIR_OVERRIDES,
  linkProviderSkills,
  mergeHookManifests,
  migrateUnprefixImpeccable,
  opencodeGlobalConfigDir,
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
