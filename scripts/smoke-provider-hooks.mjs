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
const defaultBundle = join(prRoot, 'dist', 'universal.zip');
const defaultProviders = ['direct', 'claude', 'codex', 'cursor'];

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h || !args.repo) {
  const usage = [
    'Usage: bun run smoke:hooks -- --repo <target-repo> [--bundle dist/universal.zip] [--providers direct,claude,codex,cursor]',
    '',
    'The target repo must be explicit so this local smoke does not depend on one contributor machine path.',
  ].join('\n');
  if (args.help || args.h) {
    console.log(usage);
    process.exit(0);
  }
  console.error(usage);
  process.exit(1);
}

const targetRepo = resolve(args.repo);
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
  confirmedClaude: 'src/__impeccable_provider_smoke_confirmed_claude.html',
  confirmedCodex: 'src/__impeccable_provider_smoke_confirmed_codex.html',
  confirmedCursor: 'src/__impeccable_provider_smoke_confirmed_cursor.html',
  agentChoiceClaude: 'src/__impeccable_provider_smoke_font_choice_claude.html',
  agentChoiceCodex: 'src/__impeccable_provider_smoke_font_choice_codex.html',
  agentChoiceCursor: 'src/__impeccable_provider_smoke_font_choice_cursor.html',
};

const results = [];
const hookConfigFiles = ['.impeccable/config.json', '.impeccable/config.local.json'];
const originalHookConfigFiles = new Map();

main().catch((error) => {
  restoreHookConfigFiles();
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
  snapshotHookConfigFiles();
  mkdirSync(smokeDir, { recursive: true });
  ensureTargetGitExclude();

  cleanSmokeArtifacts();
  await checked('fresh install/update', 'install shape', reinstallFresh);
  checked('install shape', 'install shape', verifyInstallShape);

  if (selectedProviders.includes('direct')) checked('direct script contracts', 'direct script failed', runDirectContractChecks);
  if (selectedProviders.some((provider) => ['claude', 'codex', 'cursor'].includes(provider))) {
    checked('confirmed exception persistence', 'confirmed exception persistence failed', runConfirmedExceptionPersistenceChecks);
    checked('agent-chosen font exception', 'agent-chosen font exception failed', runAgentChosenFontExceptionChecks);
  }
  if (selectedProviders.includes('claude')) checked('claude provider', 'provider did not fire or did not surface output', runClaudeProviderSmoke);
  if (selectedProviders.includes('codex')) checked('codex provider', 'provider did not fire or did not surface output', runCodexProviderSmoke);
  if (selectedProviders.includes('cursor')) checked('cursor provider', 'provider did not fire or did not surface output', runCursorProviderSmoke);

  cleanSmokeFiles();
  clearRuntimeState();
  restoreHookConfigFiles();
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

  for (const rel of ['.claude/settings.json', '.claude/settings.local.json', '.cursor/hooks.json', '.codex/hooks.json']) {
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

function snapshotHookConfigFiles() {
  for (const rel of hookConfigFiles) {
    const file = join(targetRepo, rel);
    originalHookConfigFiles.set(rel, existsSync(file) ? readFileSync(file, 'utf8') : null);
  }
}

function restoreHookConfigFiles() {
  if (originalHookConfigFiles.size === 0) return;
  for (const [rel, content] of originalHookConfigFiles.entries()) {
    const file = join(targetRepo, rel);
    if (content === null) {
      rmSync(file, { force: true });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
}

function resetHookConfigForSmoke() {
  for (const rel of hookConfigFiles) {
    const file = join(targetRepo, rel);
    if (!existsSync(file)) continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      rmSync(file, { force: true });
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('hook' in raw)) continue;
    const { hook, ...rest } = raw;
    if (Object.keys(rest).length === 0) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, `${JSON.stringify(rest, null, 2)}\n`);
    }
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
  const claude = readText('.claude/settings.local.json');
  const codex = readText('.codex/hooks.json');
  const cursor = readText('.cursor/hooks.json');
  assertCount(claude, '.claude/skills/impeccable/scripts/hook.mjs', 1, 'Claude hook.mjs');
  assertCount(codex, '.agents/skills/impeccable/scripts/hook.mjs', 1, 'Codex hook.mjs');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs', 1, 'Cursor preToolUse');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-after-edit.mjs', 0, 'Cursor afterFileEdit');
  assertCount(cursor, '.cursor/skills/impeccable/scripts/hook-stop.mjs', 0, 'Cursor stop');
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
    '.cursor/skills/impeccable/scripts/hook-lib.mjs',
    '.cursor/skills/impeccable/scripts/detector/cli/main.mjs',
  ]) {
    assertPath(join(targetRepo, rel), rel);
  }
  for (const rel of [
    '.cursor/skills/impeccable/scripts/hook-after-edit.mjs',
    '.cursor/skills/impeccable/scripts/hook-stop.mjs',
  ]) {
    if (existsSync(join(targetRepo, rel))) throw new Error(`${rel} should not exist in Cursor payload`);
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

  record('direct script contracts', true, 'Claude, Codex, and Cursor preToolUse scripts detect side-tab');
}

function runConfirmedExceptionPersistenceChecks() {
  const providers = selectedProviders.filter((provider) => ['claude', 'codex', 'cursor'].includes(provider));
  for (const provider of providers) {
    runConfirmedExceptionForProvider(provider);
  }
  record('confirmed exception persistence', true, `${providers.join(', ')} ignored confirmed overused-font values through shared config.json, not source comments`);
}

function runConfirmedExceptionForProvider(provider) {
  clearRuntimeState();
  const rel = confirmedSmokeFile(provider);
  const file = writeConfirmedFixture(rel);
  const beforeLog = `${provider}-confirmed-before.ndjson`;
  const afterLog = `${provider}-confirmed-after.ndjson`;

  rmSync(join(smokeDir, beforeLog), { force: true });
  rmSync(join(smokeDir, afterLog), { force: true });

  const first = runInstalledProviderHook(provider, file, beforeLog);
  requireRuleFinding(`${provider} confirmed exception first hook`, `${first.stdout}\n${first.stderr}\n${readMaybe(join(smokeDir, beforeLog))}`, 'overused-font');
  assertNoSpecificFontIgnoreConfig(provider);

  run('node', [
    providerAdminScript(provider),
    'ignore-value',
    'overused-font',
    'Roboto',
    '--shared',
    '--reason',
    `Provider smoke confirmed Roboto is intentional for ${provider}`,
  ], {
    cwd: targetRepo,
    logName: `${provider}-confirmed-admin.log`,
    timeoutMs: 60 * 1000,
  });

  const config = readSharedHookConfig();
  assertSpecificFontIgnoreConfig(provider, config);

  clearTransientHookState();
  const second = runInstalledProviderHook(provider, file, afterLog);
  if (provider === 'cursor') {
    const payload = JSON.parse(second.stdout || '{}');
    if (payload.permission !== 'allow') {
      throw new Error('Cursor confirmed ignore-value did not allow the proposed write');
    }
  } else if (/overused-font|Required design corrections/.test(second.stdout || '')) {
    throw new Error(`${provider} confirmed ignore-value emitted a correction after persistence`);
  }

  const afterEvents = readAuditEvents(join(smokeDir, afterLog));
  const suppressed = afterEvents.some((event) =>
    event.file === file
    && (
      (Number(event.findings) > 0 && Number(event.freshFindings) === 0)
      || (Number(event.findings) > 0 && Number(event.blockedFindings) === 0)
    )
  );
  if (!suppressed) {
    throw new Error(`${provider} confirmed ignore-value did not produce suppression audit evidence`);
  }

  clearRuntimeState();
}

function runAgentChosenFontExceptionChecks() {
  const providers = selectedProviders.filter((provider) => ['claude', 'codex', 'cursor'].includes(provider));
  for (const provider of providers) {
    runAgentChosenFontExceptionForProvider(provider);
  }
  record('agent-chosen font exception', true, `${providers.join(', ')} persisted Roboto as ignoreValues and did not write ignoreRules`);
}

function runAgentChosenFontExceptionForProvider(provider) {
  clearRuntimeState();
  const rel = agentChoiceSmokeFile(provider);
  const file = writeConfirmedFixture(rel);
  const beforeLog = `${provider}-agent-choice-before.ndjson`;
  const afterLog = `${provider}-agent-choice-after.ndjson`;

  rmSync(join(smokeDir, beforeLog), { force: true });
  rmSync(join(smokeDir, afterLog), { force: true });

  const first = runInstalledProviderHook(provider, file, beforeLog);
  requireRuleFinding(`${provider} agent-choice first hook`, `${first.stdout}\n${first.stderr}\n${readMaybe(join(smokeDir, beforeLog))}`, 'overused-font');
  assertNoSpecificFontIgnoreConfig(provider);

  runProviderAgentFontException(provider, rel);

  const config = readSharedHookConfig();
  assertSpecificFontIgnoreConfig(provider, config);

  clearTransientHookState();
  const second = runInstalledProviderHook(provider, file, afterLog);
  if (provider === 'cursor') {
    const payload = JSON.parse(second.stdout || '{}');
    if (payload.permission !== 'allow') {
      throw new Error('Cursor agent-chosen ignore-value did not allow the proposed write');
    }
  } else if (/overused-font|Required design corrections/.test(second.stdout || '')) {
    throw new Error(`${provider} agent-chosen ignore-value emitted a correction after persistence`);
  }

  clearRuntimeState();
}

function runProviderAgentFontException(provider, rel) {
  const prompt = fontExceptionPrompt(provider, rel);
  if (provider === 'claude') {
    run('claude', [
      '-p',
      '--setting-sources', 'project',
      '--permission-mode', 'acceptEdits',
      '--tools', 'Read,Bash',
      '--allowedTools', 'Read Bash',
      '--debug', 'hooks',
      '--debug-file', join(smokeDir, 'claude-agent-choice-debug.log'),
      prompt,
    ], {
      cwd: targetRepo,
      logName: 'claude-agent-choice.log',
      timeoutMs: 10 * 60 * 1000,
    });
    return;
  }

  if (provider === 'codex') {
    run('codex', [
      'exec',
      '-C', targetRepo,
      '--dangerously-bypass-hook-trust',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      prompt,
    ], {
      cwd: targetRepo,
      logName: 'codex-agent-choice.log',
      timeoutMs: 10 * 60 * 1000,
    });
    return;
  }

  if (provider === 'cursor') {
    ensureCursorAgent();
    const res = run('agent', [
      '-p',
      '--force',
      '--trust',
      '--workspace', targetRepo,
      '--output-format', 'stream-json',
      prompt,
    ], {
      cwd: targetRepo,
      logName: 'cursor-agent-choice.log',
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
    return;
  }

  throw new Error(`Unsupported agent-choice provider: ${provider}`);
}

function assertSpecificFontIgnoreConfig(provider, config) {
  if (Array.isArray(config.ignoreRules) && config.ignoreRules.includes('overused-font')) {
    throw new Error(`${provider} wrote ignoreRules["overused-font"]; specific fonts must use ignoreValues`);
  }
  const ignoredValue = Array.isArray(config.ignoreValues)
    && config.ignoreValues.some((entry) => entry.rule === 'overused-font' && entry.value === 'roboto');
  if (!ignoredValue) {
    throw new Error(`${provider} did not persist overused-font=roboto in ignoreValues`);
  }
}

function assertNoSpecificFontIgnoreConfig(provider) {
  const file = join(targetRepo, '.impeccable', 'config.json');
  if (!existsSync(file)) return;
  const raw = readJson(file);
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.hook && typeof raw.hook === 'object'
    ? raw.hook
    : null;
  if (!config) return;
  const broad = Array.isArray(config.ignoreRules) && config.ignoreRules.includes('overused-font');
  const specific = Array.isArray(config.ignoreValues)
    && config.ignoreValues.some((entry) => entry.rule === 'overused-font' && entry.value === 'roboto');
  if (broad || specific) {
    throw new Error(`${provider} hook config already suppressed overused-font=roboto before explicit confirmation`);
  }
}

function readSharedHookConfig() {
  const raw = readJson(join(targetRepo, '.impeccable', 'config.json'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.hook || typeof raw.hook !== 'object') {
    throw new Error('Missing .impeccable/config.json hook config');
  }
  return raw.hook;
}

function runInstalledProviderHook(provider, file, logName) {
  const env = { IMPECCABLE_HOOK_LOG: join(smokeDir, logName) };
  if (provider === 'claude') {
    return run('node', ['.claude/skills/impeccable/scripts/hook.mjs'], {
      cwd: targetRepo,
      env,
      logName: `direct-${provider}-confirmed-${logName.replace(/\.ndjson$/, '.log')}`,
      input: JSON.stringify(postToolUseEvent(`confirmed-${provider}`, file, 'Edit')),
    });
  }
  if (provider === 'codex') {
    return run('node', ['.agents/skills/impeccable/scripts/hook.mjs'], {
      cwd: targetRepo,
      env,
      logName: `direct-${provider}-confirmed-${logName.replace(/\.ndjson$/, '.log')}`,
      input: JSON.stringify(postToolUseEvent(`confirmed-${provider}`, file, 'apply_patch')),
    });
  }
  if (provider === 'cursor') {
    return run('node', ['.cursor/skills/impeccable/scripts/hook-before-edit.mjs'], {
      cwd: targetRepo,
      env,
      logName: `direct-${provider}-confirmed-${logName.replace(/\.ndjson$/, '.log')}`,
      input: JSON.stringify({
        hook_event_name: 'preToolUse',
        cwd: targetRepo,
        tool_name: 'Write',
        tool_input: {
          file_path: file,
          content: readFileSync(file, 'utf8'),
        },
      }),
    });
  }
  throw new Error(`Unsupported confirmed exception provider: ${provider}`);
}

function confirmedSmokeFile(provider) {
  if (provider === 'claude') return smokeFiles.confirmedClaude;
  if (provider === 'codex') return smokeFiles.confirmedCodex;
  if (provider === 'cursor') return smokeFiles.confirmedCursor;
  throw new Error(`Unsupported confirmed exception provider: ${provider}`);
}

function agentChoiceSmokeFile(provider) {
  if (provider === 'claude') return smokeFiles.agentChoiceClaude;
  if (provider === 'codex') return smokeFiles.agentChoiceCodex;
  if (provider === 'cursor') return smokeFiles.agentChoiceCursor;
  throw new Error(`Unsupported agent-choice provider: ${provider}`);
}

function providerAdminScript(provider) {
  if (provider === 'claude') return '.claude/skills/impeccable/scripts/hook-admin.mjs';
  if (provider === 'codex') return '.agents/skills/impeccable/scripts/hook-admin.mjs';
  if (provider === 'cursor') return '.cursor/skills/impeccable/scripts/hook-admin.mjs';
  throw new Error(`Unsupported admin provider: ${provider}`);
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
  if (existsSync(fixturePath)) {
    const fixtureContent = readFileSync(fixturePath, 'utf8');
    if (/border-left\s*:\s*[2-9]\d*px/i.test(fixtureContent)) {
      if (!intentionalIgnore || !/ignoreFiles|ignore-file/i.test(evidence)) {
        throw new Error('Cursor provider left the blocked side-tab fixture on disk without an explicit Impeccable ignore-file escape hatch');
      }
    }
  }
  record('cursor provider', true, 'Cursor agent triggered preToolUse hook, blocked side-tab, and only proceeded through explicit ignore handling for the intentional fixture');
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

function writeConfirmedFixture(rel) {
  const abs = join(targetRepo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, confirmedFixtureContent());
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

function confirmedFixtureContent() {
  return [
    '<!doctype html>',
    '<html>',
    '  <body>',
    '    <style>',
    '      /* impeccable: ignore overused-font */',
    '      body { font-family: "Roboto", ui-sans-serif, system-ui, sans-serif; }',
    '      .card { border-radius: 16px; padding: 16px; }',
    '    </style>',
    '    <div class="card">Temporary Impeccable confirmed exception fixture using Roboto.</div>',
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

function fontExceptionPrompt(provider, rel) {
  return [
    `Read the installed Impeccable hooks reference for ${provider}, then persist a confirmed hook exception for Roboto specifically in ${rel}.`,
    'The user confirms Roboto is intentional for this fixture, but did not ask to ignore overused fonts generally.',
    'Use the /impeccable hooks / hook-admin flow; do not edit .impeccable/config.json by hand and do not edit the source fixture.',
    'The final config must use ignoreValues for overused-font=roboto and must not add overused-font to ignoreRules.',
    'After updating the config, stop.',
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
  requireRuleFinding(label, text, 'side-tab');
}

function requireRuleFinding(label, text, rule) {
  const rulePattern = new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!rulePattern.test(text) || !/Required design corrections|findings?|antipattern|side-tab|overused-font/.test(text)) {
    throw new Error(`${label} did not show ${rule} detector evidence`);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
  resetHookConfigForSmoke();
  for (const rel of [
    '.impeccable/hook.cache.json',
    '.impeccable/hook.pending.json',
    '.impeccable/hook.json',
    '.impeccable/hook.local.json',
  ]) {
    rmSync(join(targetRepo, rel), { force: true });
  }
}

function clearTransientHookState() {
  for (const rel of [
    '.impeccable/hook.cache.json',
    '.impeccable/hook.pending.json',
  ]) {
    rmSync(join(targetRepo, rel), { force: true });
  }
}
