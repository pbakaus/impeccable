#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prRoot = resolve(__dirname, '..');
const defaultTargetRepo = '/Users/abdulwahab/impeccable-live-react';
const defaultBundle = join(prRoot, 'dist', 'universal.zip');
const defaultProviders = ['direct', 'claude', 'codex', 'cursor'];

const args = parseArgs(process.argv.slice(2));
const targetRepo = resolve(args.repo || defaultTargetRepo);
const bundlePath = resolve(args.bundle || defaultBundle);
const selectedProviders = (args.providers || defaultProviders.join(','))
  .split(',')
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const smokeDir = join(targetRepo, '.impeccable', 'provider-smoke');
const summaryPath = join(smokeDir, 'summary.json');
const smokeFiles = {
  direct: 'src/__impeccable_provider_smoke_direct.html',
  claude: 'src/__impeccable_provider_smoke_claude.html',
  codex: 'src/__impeccable_provider_smoke_codex.html',
  cursor: 'src/__impeccable_provider_smoke_cursor.html',
};

const results = [];

main().catch((error) => {
  if (!results.some((result) => !result.pass)) {
    record('fatal', false, String(error?.message || error), 'fatal');
  }
  writeSummary();
  console.error(error?.stack || error);
  process.exit(1);
});

async function main() {
  assertPath(targetRepo, 'target repo');
  assertPath(bundlePath, 'universal bundle');
  mkdirSync(smokeDir, { recursive: true });
  ensureTargetGitExclude();

  cleanSmokeArtifacts();
  await checked('fresh install/update', 'install shape', reinstallFresh);
  checked('install shape', 'install shape', verifyInstallShape);

  if (selectedProviders.includes('direct')) checked('direct script contracts', 'direct script failed', runDirectContractChecks);
  if (selectedProviders.includes('claude')) checked('claude provider', 'provider did not fire or did not surface output', runClaudeProviderSmoke);
  if (selectedProviders.includes('codex')) checked('codex provider', 'provider did not fire or did not surface output', runCodexProviderSmoke);
  if (selectedProviders.includes('cursor')) checked('cursor provider', 'provider did not fire or did not surface output', runCursorProviderSmoke);

  cleanSmokeFiles();
  clearRuntimeState();
  writeSummary();

  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    console.error(`Provider smoke failed: ${failed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`Provider smoke passed. Summary: ${summaryPath}`);
}

async function checked(name, classification, fn) {
  try {
    return await fn();
  } catch (error) {
    record(name, false, String(error?.message || error), error?.classification || classification);
    throw error;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return out;
}

function assertPath(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
}

function record(name, pass, detail = '', classification = '') {
  const result = { name, pass, classification, detail };
  results.push(result);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${classification ? ` [${classification}]` : ''}${detail ? `: ${detail}` : ''}`);
}

function writeSummary() {
  mkdirSync(smokeDir, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify({
    targetRepo,
    bundlePath,
    providers: selectedProviders,
    results,
  }, null, 2)}\n`);
}

function run(cmd, cmdArgs, {
  cwd = targetRepo,
  env = {},
  input = undefined,
  logName,
  timeoutMs = 10 * 60 * 1000,
  allowFailure = false,
} = {}) {
  const fallbackPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Codex.app/Contents/Resources';
  const inheritedPath = process.env.PATH || fallbackPath;
  const fullEnv = {
    ...process.env,
    PATH: `${join(homedir(), '.local', 'bin')}:${inheritedPath}:${fallbackPath}`,
    ...env,
  };
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    env: fullEnv,
    input,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const output = [
    `$ ${cmd} ${cmdArgs.map(shellQuote).join(' ')}`,
    `exit=${res.status ?? 'null'} signal=${res.signal ?? ''}`,
    '--- stdout ---',
    res.stdout || '',
    '--- stderr ---',
    res.stderr || '',
    res.error ? `--- error ---\n${res.error.stack || res.error.message || res.error}` : '',
  ].join('\n');
  if (logName) writeFileSync(join(smokeDir, logName), output);
  if (!allowFailure && (res.error || res.status !== 0)) {
    const message = res.error
      ? `${cmd} failed: ${res.error.message}`
      : `${cmd} exited ${res.status}`;
    throw Object.assign(new Error(message), { output, status: res.status });
  }
  return { ...res, output };
}

function shellQuote(value) {
  const s = String(value);
  return /^[A-Za-z0-9_/:=.,@%+-]+$/.test(s) ? s : JSON.stringify(s);
}

async function reinstallFresh() {
  cleanInstalledImpeccable();
  const packDir = makeTempDir('impeccable-provider-smoke-pack-');
  const pack = run('npm', ['pack', '--pack-destination', packDir], {
    cwd: prRoot,
    logName: 'npm-pack.log',
    timeoutMs: 2 * 60 * 1000,
  });
  const packName = (pack.stdout || '').trim().split('\n').pop();
  const tarball = join(packDir, packName);
  assertPath(tarball, 'local npm tarball');

  const env = { IMPECCABLE_BUNDLE_PATH: bundlePath };
  run('npx', ['--yes', '--package', tarball, 'impeccable', 'skills', 'install', '-y', '--force', '--providers=claude,cursor,codex'], {
    cwd: targetRepo,
    env,
    logName: 'skills-install.log',
    timeoutMs: 5 * 60 * 1000,
  });
  run('npx', ['--yes', '--package', tarball, 'impeccable', 'skills', 'update', '-y'], {
    cwd: targetRepo,
    env,
    logName: 'skills-update.log',
    timeoutMs: 5 * 60 * 1000,
  });
  record('fresh install/update', true, 'installed through local npx + IMPECCABLE_BUNDLE_PATH');
}

function makeTempDir(prefix) {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanInstalledImpeccable() {
  clearRuntimeState();
  cleanSmokeFiles();

  for (const rel of [
    '.claude/skills/impeccable',
    '.cursor/skills/impeccable',
    '.agents/skills/impeccable',
    '.claude/hooks/hooks.json',
    '.agents/hooks',
    '.agents/plugins/marketplace.json',
    '.cursor/pre-log.mjs',
    '.cursor/rules/impeccable-design-hook.mdc',
    'plugin-codex',
  ]) {
    rmSync(join(targetRepo, rel), { recursive: true, force: true });
  }

  for (const rel of ['.claude/settings.json', '.cursor/hooks.json', '.codex/hooks.json']) {
    stripManifest(rel);
  }

  run('claude', ['plugin', 'uninstall', 'impeccable@impeccable', '--scope', 'user'], {
    cwd: targetRepo,
    logName: 'claude-plugin-uninstall.log',
    allowFailure: true,
    timeoutMs: 60 * 1000,
  });
  run('claude', ['plugin', 'marketplace', 'remove', 'impeccable', '--scope', 'user'], {
    cwd: targetRepo,
    logName: 'claude-marketplace-remove.log',
    allowFailure: true,
    timeoutMs: 60 * 1000,
  });
  run('codex', ['plugin', 'remove', 'impeccable@impeccable'], {
    cwd: targetRepo,
    logName: 'codex-plugin-remove.log',
    allowFailure: true,
    timeoutMs: 60 * 1000,
  });
  run('codex', ['plugin', 'marketplace', 'remove', 'impeccable'], {
    cwd: targetRepo,
    logName: 'codex-marketplace-remove.log',
    allowFailure: true,
    timeoutMs: 60 * 1000,
  });

  for (const abs of [
    join(homedir(), '.claude/plugins/cache/impeccable'),
    join(homedir(), '.claude/plugins/data/impeccable-impeccable'),
    join(homedir(), '.codex/plugins/cache/impeccable'),
    join(homedir(), '.codex/plugins/data/impeccable-impeccable'),
  ]) {
    rmSync(abs, { recursive: true, force: true });
  }
}

function ensureTargetGitExclude() {
  const excludePath = join(targetRepo, '.git', 'info', 'exclude');
  if (!existsSync(dirname(excludePath))) return;
  const block = [
    '# impeccable-provider-smoke-start',
    '.impeccable/provider-smoke/',
    'src/__impeccable_provider_smoke_*.html',
    '# impeccable-provider-smoke-end',
  ].join('\n');
  const current = readMaybe(excludePath);
  const next = current.includes('# impeccable-provider-smoke-start')
    ? current.replace(/# impeccable-provider-smoke-start[\s\S]*?# impeccable-provider-smoke-end/g, block)
    : `${current.replace(/\s*$/, '')}\n${block}\n`;
  if (next !== current) writeFileSync(excludePath, next);
}

function stripManifest(rel) {
  const file = join(targetRepo, rel);
  if (!existsSync(file)) return;
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    rmSync(file, { force: true });
    return;
  }
  const hooks = json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks) ? json.hooks : {};
  const nextHooks = {};
  for (const [event, entries] of Object.entries(hooks)) {
    const preserved = Array.isArray(entries)
      ? entries.map(stripImpeccableHookEntry).filter(Boolean)
      : entries;
    if (Array.isArray(preserved) ? preserved.length > 0 : Boolean(preserved)) nextHooks[event] = preserved;
  }
  const next = { ...json, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) {
    rmSync(file, { force: true });
  } else {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
}

function stripImpeccableHookEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (containsImpeccableHook(entry)) return null;
  if (Array.isArray(entry.hooks)) {
    const hooks = entry.hooks.map(stripImpeccableHookEntry).filter(Boolean);
    if (hooks.length === 0 && entry.hooks.some(containsImpeccableHook)) return null;
    return { ...entry, hooks };
  }
  return entry;
}

function containsImpeccableHook(value) {
  if (typeof value === 'string') return value.includes('skills/impeccable/scripts/hook') || value.includes('.cursor/pre-log.mjs');
  if (Array.isArray(value)) return value.some(containsImpeccableHook);
  if (value && typeof value === 'object') return Object.values(value).some(containsImpeccableHook);
  return false;
}

function verifyInstallShape() {
  const claude = readText('.claude/settings.json');
  const codex = readText('.codex/hooks.json');
  const cursor = readText('.cursor/hooks.json');
  assertCount(claude, '.claude/skills/impeccable/scripts/hook.mjs', 1, 'Claude hook.mjs');
  assertCount(codex, '.agents/skills/impeccable/scripts/hook.mjs', 1, 'Codex hook.mjs');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs', 1, 'Cursor preToolUse');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-after-edit.mjs', 1, 'Cursor afterFileEdit');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-stop.mjs', 1, 'Cursor stop');
  for (const text of [claude, codex, cursor]) {
    if (text.includes('hook-probe.mjs')) throw new Error('hook-probe.mjs still appears in hook manifests');
  }
  for (const rel of [
    '.claude/skills/impeccable/scripts/hook.mjs',
    '.claude/skills/impeccable/scripts/hook-lib.mjs',
    '.claude/skills/impeccable/scripts/detector/cli/main.mjs',
    '.agents/skills/impeccable/scripts/hook.mjs',
    '.agents/skills/impeccable/scripts/hook-lib.mjs',
    '.agents/skills/impeccable/scripts/detector/cli/main.mjs',
    '.cursor/skills/impeccable/scripts/hook-before-edit.mjs',
    '.cursor/skills/impeccable/scripts/hook-after-edit.mjs',
    '.cursor/skills/impeccable/scripts/hook-stop.mjs',
    '.cursor/skills/impeccable/scripts/hook-lib.mjs',
    '.cursor/skills/impeccable/scripts/detector/cli/main.mjs',
  ]) {
    assertPath(join(targetRepo, rel), rel);
  }
  if (findFiles(['.claude', '.cursor', '.agents'], 'hook-probe.mjs').length > 0) {
    throw new Error('hook-probe.mjs still exists in installed payloads');
  }
  assertNoPluginInstall();
  record('install shape', true, 'real hook manifests and payloads installed; no probe/plugin leftovers');
}

function readText(rel) {
  return readFileSync(join(targetRepo, rel), 'utf8');
}

function assertCount(text, needle, expected, label) {
  const actual = text.split(needle).length - 1;
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function findFiles(roots, filename) {
  const found = [];
  for (const root of roots) {
    walk(join(targetRepo, root), (file) => {
      if (file.endsWith(`/${filename}`)) found.push(file);
    });
  }
  return found;
}

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function assertNoPluginInstall() {
  const claude = run('claude', ['plugin', 'list'], { allowFailure: true, logName: 'claude-plugin-list.log', timeoutMs: 60 * 1000 });
  const codex = run('codex', ['plugin', 'list'], { allowFailure: true, logName: 'codex-plugin-list.log', timeoutMs: 60 * 1000 });
  const codexMarket = run('codex', ['plugin', 'marketplace', 'list'], { allowFailure: true, logName: 'codex-marketplace-list.log', timeoutMs: 60 * 1000 });
  for (const [name, text] of [
    ['Claude plugin list', `${claude.stdout}\n${claude.stderr}`],
    ['Codex plugin list', `${codex.stdout}\n${codex.stderr}`],
    ['Codex marketplace list', `${codexMarket.stdout}\n${codexMarket.stderr}`],
  ]) {
    if (/impeccable@impeccable|Marketplace `impeccable`|impeccable-design-hook-impl/.test(text)) {
      throw new Error(`${name} still contains Impeccable plugin install`);
    }
  }
}

function runDirectContractChecks() {
  clearRuntimeState();
  const file = writeBadFixture(smokeFiles.direct);
  const env = { IMPECCABLE_HOOK_LOG: join(smokeDir, 'direct.ndjson') };
  const claude = run('node', ['.claude/skills/impeccable/scripts/hook.mjs'], {
    cwd: targetRepo,
    env,
    logName: 'direct-claude.log',
    input: JSON.stringify(postToolUseEvent('direct-claude', file, 'Edit')),
  });
  requireFinding('direct Claude hook', `${claude.stdout}\n${readMaybe(join(smokeDir, 'direct.ndjson'))}`);

  clearRuntimeState();
  const codex = run('node', ['.agents/skills/impeccable/scripts/hook.mjs'], {
    cwd: targetRepo,
    env,
    logName: 'direct-codex.log',
    input: JSON.stringify(postToolUseEvent('direct-codex', file, 'apply_patch')),
  });
  requireFinding('direct Codex hook', `${codex.stdout}\n${readMaybe(join(smokeDir, 'direct.ndjson'))}`);

  clearRuntimeState();
  const pre = run('node', ['.cursor/skills/impeccable/scripts/hook-before-edit.mjs'], {
    cwd: targetRepo,
    env,
    logName: 'direct-cursor-before.log',
    input: JSON.stringify({
      hook_event_name: 'preToolUse',
      cwd: targetRepo,
      tool_name: 'Write',
      tool_input: {
        file_path: join(targetRepo, smokeFiles.direct),
        content: badFixtureContent(),
      },
    }),
  });
  requireFinding('direct Cursor preToolUse hook', `${pre.stdout}\n${readMaybe(join(smokeDir, 'direct.ndjson'))}`);

  clearRuntimeState();
  run('node', ['.cursor/skills/impeccable/scripts/hook-after-edit.mjs'], {
    cwd: targetRepo,
    env,
    logName: 'direct-cursor-after.log',
    input: JSON.stringify({ hook_event_name: 'afterFileEdit', cwd: targetRepo, file_path: file }),
  });
  const stop = run('node', ['.cursor/skills/impeccable/scripts/hook-stop.mjs'], {
    cwd: targetRepo,
    env,
    logName: 'direct-cursor-stop.log',
    input: JSON.stringify({ hook_event_name: 'stop', cwd: targetRepo }),
  });
  requireFinding('direct Cursor hook', `${stop.stdout}\n${readMaybe(join(smokeDir, 'direct.ndjson'))}`);

  record('direct script contracts', true, 'all installed scripts detect side-tab');
}

function runClaudeProviderSmoke() {
  clearRuntimeState();
  const env = { IMPECCABLE_HOOK_LOG: join(smokeDir, 'claude.ndjson') };
  const prompt = providerPrompt(smokeFiles.claude);
  const res = run('claude', [
    '-p',
    '--setting-sources', 'project',
    '--permission-mode', 'acceptEdits',
    '--tools', 'Read,Write,Edit',
    '--allowedTools', 'Read Write Edit',
    '--debug', 'hooks',
    '--debug-file', join(smokeDir, 'claude-debug.log'),
    prompt,
  ], {
    cwd: targetRepo,
    env,
    logName: 'claude-provider.log',
    timeoutMs: 10 * 60 * 1000,
  });
  const evidence = `${res.stdout}\n${res.stderr}\n${readMaybe(join(smokeDir, 'claude.ndjson'))}\n${readMaybe(join(smokeDir, 'claude-debug.log'))}`;
  requireFile(smokeFiles.claude, 'Claude provider fixture');
  requireFinding('Claude provider hook', evidence);
  if (!/PostToolUse|hook/i.test(evidence)) throw new Error('Claude provider evidence lacks hook/PostToolUse marker');
  record('claude provider', true, 'Claude edit triggered PostToolUse hook and side-tab detection');
}

function runCodexProviderSmoke() {
  clearRuntimeState();
  const env = { IMPECCABLE_HOOK_LOG: join(smokeDir, 'codex.ndjson') };
  const prompt = `Use apply_patch to ${providerPrompt(smokeFiles.codex)}`;
  const res = run('codex', [
    'exec',
    '-C', targetRepo,
    '--dangerously-bypass-hook-trust',
    '--dangerously-bypass-approvals-and-sandbox',
    '--json',
    prompt,
  ], {
    cwd: targetRepo,
    env,
    logName: 'codex-provider.log',
    timeoutMs: 10 * 60 * 1000,
  });
  const evidence = `${res.stdout}\n${res.stderr}\n${readMaybe(join(smokeDir, 'codex.ndjson'))}`;
  const cacheEvidence = `${readMaybe(join(targetRepo, '.impeccable', 'hook.cache.json'))}\n${readMaybe(join(targetRepo, '.impeccable', 'hook.pending.json'))}`;
  requireFile(smokeFiles.codex, 'Codex provider fixture');
  requireFinding('Codex provider hook', `${evidence}\n${cacheEvidence}`);
  record('codex provider', true, 'Codex apply_patch triggered project hook and side-tab detection');
}

function runCursorProviderSmoke() {
  ensureCursorAgent();
  clearRuntimeState();
  const env = { IMPECCABLE_HOOK_LOG: join(smokeDir, 'cursor.ndjson') };
  const prompt = providerPrompt(smokeFiles.cursor);
  const res = run('agent', [
    '-p',
    '--force',
    '--trust',
    '--workspace', targetRepo,
    '--output-format', 'stream-json',
    prompt,
  ], {
    cwd: targetRepo,
    env,
    logName: 'cursor-provider.log',
    timeoutMs: 10 * 60 * 1000,
    allowFailure: true,
  });
  if (res.error || res.status !== 0) {
    const output = `${res.stdout}\n${res.stderr}\n${res.error?.message || ''}`;
    if (/Authentication required|agent login|CURSOR_API_KEY/i.test(output)) {
      const err = new Error('Cursor CLI authentication required. Run `agent login` or set CURSOR_API_KEY, then rerun `bun run smoke:hooks -- --providers=cursor`.');
      err.classification = 'cursor auth required';
      throw err;
    }
    throw new Error(res.error ? `agent failed: ${res.error.message}` : `agent exited ${res.status}`);
  }
  const evidence = `${res.stdout}\n${res.stderr}\n${readMaybe(join(smokeDir, 'cursor.ndjson'))}\n${readMaybe(join(targetRepo, '.impeccable', 'hook.pending.json'))}\n${readMaybe(join(targetRepo, '.impeccable', 'hook.cache.json'))}`;
  requireFinding('Cursor provider hook', evidence);
  const auditEvents = readAuditEvents(join(smokeDir, 'cursor.ndjson'));
  if (!auditEvents.some((event) => event.event === 'preToolUse' && event.blocked === true)) {
    throw new Error('Cursor provider evidence lacks a preToolUse audit entry with blocked=true');
  }
  const fixturePath = join(targetRepo, smokeFiles.cursor);
  const intentionalIgnore = auditEvents.some((event) =>
    event.event === 'preToolUse'
    && event.file === fixturePath
    && event.skipped === 'config-ignore-file'
  );
  if (existsSync(fixturePath) && /border-left\s*:\s*[2-9]\d*px/i.test(readFileSync(fixturePath, 'utf8'))) {
    if (!intentionalIgnore || !/ignoreFiles|ignore-file/i.test(evidence)) {
      throw new Error('Cursor provider left the blocked side-tab fixture on disk without an explicit Impeccable ignore-file escape hatch');
    }
  }
  record('cursor provider', true, 'Cursor agent triggered preToolUse hook, blocked side-tab, and only proceeded through explicit ignore-file handling for the intentional fixture');
}

function ensureCursorAgent() {
  const version = run('agent', ['--version'], {
    cwd: targetRepo,
    logName: 'cursor-agent-version-before.log',
    allowFailure: true,
    timeoutMs: 60 * 1000,
  });
  if (version.status === 0) return;

  run('/bin/bash', ['-c', '/usr/bin/curl https://cursor.com/install -fsS | /bin/bash'], {
    cwd: targetRepo,
    logName: 'cursor-agent-install.log',
    timeoutMs: 5 * 60 * 1000,
  });
  run('agent', ['--version'], {
    cwd: targetRepo,
    logName: 'cursor-agent-version-after.log',
    timeoutMs: 60 * 1000,
  });
}

function writeBadFixture(rel) {
  const abs = join(targetRepo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, badFixtureContent());
  return abs;
}

function badFixtureContent() {
  return [
    '<!doctype html>',
    '<html>',
    '  <body>',
    '    <style>',
    '      .card {',
    '        border-left: 4px solid #7c3aed;',
    '        border-radius: 16px;',
    '        padding: 16px;',
    '      }',
    '    </style>',
    '    <div class="card">Temporary Impeccable provider smoke fixture</div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function providerPrompt(rel) {
  return [
    `Create ${rel} as an intentionally bad Impeccable hook test fixture.`,
    'The file must be HTML and include a rounded card with exactly this CSS pattern: border-left: 4px solid #7c3aed; border-radius: 16px; padding: 16px.',
    'This is intentionally bad UI for hook verification, so do not fix or remove the side border if a hook warns about it.',
    'After creating the file, stop.',
  ].join(' ');
}

function postToolUseEvent(sessionId, file, toolName) {
  return {
    session_id: sessionId,
    cwd: targetRepo,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: { file_path: file },
  };
}

function requireFile(rel, label) {
  const abs = join(targetRepo, rel);
  if (!existsSync(abs)) throw new Error(`${label} was not created: ${rel}`);
}

function requireFinding(label, text) {
  if (!/side-tab/.test(text) || !/Required design corrections|findings?|antipattern|side-tab/.test(text)) {
    throw new Error(`${label} did not show side-tab detector evidence`);
  }
}

function readAuditEvents(path) {
  return readMaybe(path)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function readMaybe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function cleanSmokeArtifacts() {
  rmSync(smokeDir, { recursive: true, force: true });
  mkdirSync(smokeDir, { recursive: true });
  cleanSmokeFiles();
}

function cleanSmokeFiles() {
  for (const rel of Object.values(smokeFiles)) {
    rmSync(join(targetRepo, rel), { force: true });
  }
}

function clearRuntimeState() {
  for (const rel of [
    '.impeccable/hook.cache.json',
    '.impeccable/hook.pending.json',
    '.impeccable/hook.json',
    '.impeccable/hook.local.json',
  ]) {
    rmSync(join(targetRepo, rel), { force: true });
  }
}
