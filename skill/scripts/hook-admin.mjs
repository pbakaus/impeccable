#!/usr/bin/env node
/**
 * `/impeccable hooks <on|off|status|reset>` — manage the design hook
 * via the `hook` key of .impeccable/config.json and .impeccable/config.local.json
 * in the current project.
 *
 * Usage:
 *   node hook-admin.mjs status                         # print current state
 *   node hook-admin.mjs on                             # set enabled: true
 *   node hook-admin.mjs off                            # set enabled: false
 *   node hook-admin.mjs ignore-rule <rule-id>          # append to ignoreRules
 *   node hook-admin.mjs ignore-rule overused-font --all-values
 *   node hook-admin.mjs ignore-file <glob>             # append to ignoreFiles
 *   node hook-admin.mjs ignore-value <rule> <value>    # append to shared ignoreValues
 *   node hook-admin.mjs ignore-value <rule> <value> --local
 *   node hook-admin.mjs reset                          # remove all config + cache
 *
 * Designed to be invoked by the LLM from the reference/hooks.md flow.
 * Output is human-readable; the harness will pass it back to the user.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getConfigPath,
  getLocalConfigPath,
  getCachePath,
  getPendingPath,
  readConfig,
  DEFAULT_CONFIG,
  ensureHookGitExcludes,
  normalizeIgnoreValue,
  normalizeIgnoreValueEntries,
} from './hook-lib.mjs';

const ACTIONS = new Set(['status', 'on', 'off', 'ignore-rule', 'ignore-file', 'ignore-value', 'reset']);
const IMPECCABLE_HOOK_COMMAND_MARKERS = [
  'skills/impeccable/scripts/hook-probe.mjs',
  'skills/impeccable/scripts/hook.mjs',
  'skills/impeccable/scripts/hook-before-edit.mjs',
  'skills/impeccable/scripts/hook-after-edit.mjs',
  'skills/impeccable/scripts/hook-stop.mjs',
];
const TIMEOUT_SECONDS = 5;
const STATUS_MESSAGE = 'Checking UI changes';

const HOOK_MANIFEST_TARGETS = [
  {
    provider: '.claude',
    skillRel: '.claude/skills/impeccable',
    destRel: '.claude/settings.local.json',
    sharedDestRel: '.claude/settings.json',
    manifest: () => ({
      description: 'Impeccable design detector: runs after Edit/Write/MultiEdit on UI files and surfaces findings as system reminders.',
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [
              {
                type: 'command',
                command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"',
                timeout: TIMEOUT_SECONDS,
                statusMessage: STATUS_MESSAGE,
              },
            ],
          },
        ],
      },
    }),
  },
  {
    provider: '.agents',
    skillRel: '.agents/skills/impeccable',
    destRel: '.codex/hooks.json',
    manifest: () => ({
      description: 'Impeccable design detector: runs after Edit/Write/apply_patch on UI files and surfaces findings as system reminders.',
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|apply_patch',
            hooks: [
              {
                type: 'command',
                command: 'node "$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs"',
                timeout: TIMEOUT_SECONDS,
                statusMessage: STATUS_MESSAGE,
              },
            ],
          },
        ],
      },
    }),
  },
  {
    provider: '.cursor',
    skillRel: '.cursor/skills/impeccable',
    destRel: '.cursor/hooks.json',
    manifest: () => ({
      version: 1,
      hooks: {
        preToolUse: [
          {
            command: 'node ".cursor/skills/impeccable/scripts/hook-before-edit.mjs"',
            timeout: TIMEOUT_SECONDS,
          },
        ],
      },
    }),
  },
];

function readRawConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, malformed: false, raw: null };
  try {
    return { exists: true, malformed: false, raw: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch {
    return { exists: true, malformed: true, raw: null };
  }
}

// The hook settings to edit: the unified file's `hook` subtree.
function readRawConfig(cwd, opts = {}) {
  const unified = readRawConfigFile(opts.local ? getLocalConfigPath(cwd) : getConfigPath(cwd)).raw;
  if (unified && typeof unified === 'object' && unified.hook && typeof unified.hook === 'object') {
    return unified.hook;
  }
  return null;
}

// Write the hook config back under the `hook` key of the unified file, leaving
// any sibling keys (e.g. updateCheck) untouched.
function writeConfig(cwd, hookConfig, opts = {}) {
  const filePath = opts.local ? getLocalConfigPath(cwd) : getConfigPath(cwd);
  if (opts.local) ensureHookGitExcludes(cwd);
  const existingRaw = readRawConfigFile(filePath).raw;
  const existing = existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw) ? existingRaw : {};
  const existingHook = existing.hook && typeof existing.hook === 'object' && !Array.isArray(existing.hook) ? existing.hook : {};
  // Merge over the existing hook object so fields the merge helpers don't manage
  // (consent, quiet, auditLog) survive a `/impeccable hooks` edit.
  const next = { ...existing, hook: { ...existingHook, ...hookConfig } };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n');
  return filePath;
}

function mergeConfig(existing) {
  // Persist the full shape so /impeccable hooks edits leave a complete file
  // for the user to see, not an unhelpful `{"enabled":false}`.
  const base = existing && typeof existing === 'object' ? existing : {};
  return {
    enabled: base.enabled === false ? false : true,
    ignoreRules: Array.isArray(base.ignoreRules) ? Array.from(new Set(base.ignoreRules.map(String))) : [],
    ignoreFiles: Array.isArray(base.ignoreFiles) ? Array.from(new Set(base.ignoreFiles.map(String))) : [],
    ignoreValues: normalizeIgnoreValueEntries(base.ignoreValues || []),
    limits: {
      maxFindings: Number.isFinite(base?.limits?.maxFindings) ? base.limits.maxFindings : DEFAULT_CONFIG.limits.maxFindings,
      maxChars: Number.isFinite(base?.limits?.maxChars) ? base.limits.maxChars : DEFAULT_CONFIG.limits.maxChars,
    },
  };
}

function mergeLocalConfig(existing) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const out = {};
  if (Object.prototype.hasOwnProperty.call(base, 'enabled')) {
    out.enabled = base.enabled === false ? false : true;
  }
  if (Array.isArray(base.ignoreRules)) {
    out.ignoreRules = Array.from(new Set(base.ignoreRules.map(String)));
  }
  if (Array.isArray(base.ignoreFiles)) {
    out.ignoreFiles = Array.from(new Set(base.ignoreFiles.map(String)));
  }
  out.ignoreValues = normalizeIgnoreValueEntries(base.ignoreValues || []);
  if (base.limits && typeof base.limits === 'object') {
    const limits = {};
    if (Number.isFinite(base.limits.maxFindings)) limits.maxFindings = base.limits.maxFindings;
    if (Number.isFinite(base.limits.maxChars)) limits.maxChars = base.limits.maxChars;
    if (Object.keys(limits).length) out.limits = limits;
  }
  return out;
}

function statusReport(cwd) {
  const shared = readRawConfigFile(getConfigPath(cwd));
  const local = readRawConfigFile(getLocalConfigPath(cwd));
  const cfg = readConfig(cwd);
  const envKill = process.env.IMPECCABLE_HOOK_DISABLED;
  const envState = envKill ? `IMPECCABLE_HOOK_DISABLED=${envKill}` : 'unset';
  const cfgPath = path.relative(cwd, getConfigPath(cwd)) || '.impeccable/config.json';
  const localPath = path.relative(cwd, getLocalConfigPath(cwd)) || '.impeccable/config.local.json';
  const cachePath = path.relative(cwd, getCachePath(cwd)) || '.impeccable/hook.cache.json';
  const fileState = (info, relPath, absent) => {
    if (info.malformed) return `${relPath} (malformed; ignored)`;
    if (info.exists) return relPath;
    return `${relPath} (${absent})`;
  };
  const ignoreValues = cfg.ignoreValues.map((entry) => `${entry.rule}=${entry.value}`);

  const lines = [
    `Impeccable design hook`,
    `  state:        ${cfg.enabled ? 'enabled' : 'disabled'}`,
    `  shared file:  ${fileState(shared, cfgPath, 'using defaults; file not present')}`,
    `  local file:   ${fileState(local, localPath, 'not present')}`,
    `  ignoreRules:  ${cfg.ignoreRules.length ? cfg.ignoreRules.join(', ') : '(none)'}`,
    `  ignoreFiles:  ${cfg.ignoreFiles.length ? cfg.ignoreFiles.join(', ') : '(none)'}`,
    `  ignoreValues: ${ignoreValues.length ? ignoreValues.join(', ') : '(none)'}`,
    `  maxFindings:  ${cfg.limits.maxFindings}`,
    `  maxChars:     ${cfg.limits.maxChars}`,
    `  env override: ${envState}`,
    `  cache file:   ${fs.existsSync(getCachePath(cwd)) ? cachePath : `${cachePath} (not present)`}`,
  ];
  return lines.join('\n');
}

function setEnabled(cwd, value) {
  const config = mergeConfig(readRawConfig(cwd));
  config.enabled = value;
  const target = writeConfig(cwd, config);
  if (!value) {
    return `Design hook disabled for this project (wrote ${path.relative(cwd, target) || target}).`;
  }

  const localTarget = writeConfig(cwd, { consent: 'accepted' }, { local: true });
  const repaired = repairHookManifests(cwd);
  const parts = [
    `Design hook enabled for this project (wrote ${path.relative(cwd, target) || target}).`,
    `Recorded local hook consent in ${path.relative(cwd, localTarget) || localTarget}.`,
  ];
  if (repaired.written.length > 0) {
    parts.push(`Installed or repaired hook manifests for: ${repaired.written.join(', ')}.`);
  } else if (repaired.already.length > 0) {
    parts.push(`Hook manifests already installed for: ${repaired.already.join(', ')}.`);
  } else {
    parts.push('No installed provider skill folders found to repair.');
  }
  if (repaired.backups.length > 0) {
    parts.push(`Backed up malformed manifest(s): ${repaired.backups.map((filePath) => path.relative(cwd, filePath) || filePath).join(', ')}.`);
  }
  return parts.join(' ');
}

function repairHookManifests(cwd) {
  const result = { written: [], already: [], backups: [] };
  for (const target of HOOK_MANIFEST_TARGETS) {
    if (!fs.existsSync(path.join(cwd, target.skillRel))) continue;
    const dest = path.join(cwd, target.destRel);
    const sharedDest = target.sharedDestRel ? path.join(cwd, target.sharedDestRel) : null;

    if (sharedDest && fileHasImpeccableHookMarker(sharedDest)) {
      pruneImpeccableHookFromManifest(dest);
      result.already.push(target.provider);
      continue;
    }

    const fresh = target.manifest();
    let next = fresh;
    if (fs.existsSync(dest)) {
      try {
        next = mergeHookManifests(JSON.parse(fs.readFileSync(dest, 'utf-8')), fresh);
      } catch {
        const backup = `${dest}.bak`;
        fs.copyFileSync(dest, backup);
        result.backups.push(backup);
      }
    }

    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    const current = fs.existsSync(dest) ? safeReadText(dest) : null;
    if (current === serialized) {
      result.already.push(target.provider);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, serialized);
    result.written.push(target.provider);
  }
  return result;
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
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

function fileHasImpeccableHookMarker(filePath) {
  if (!fs.existsSync(filePath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (!parsed.hooks || typeof parsed.hooks !== 'object') return false;
  return valueHasImpeccableHookMarker(parsed.hooks);
}

function valueHasImpeccableHookMarker(value) {
  if (typeof value === 'string') {
    return IMPECCABLE_HOOK_COMMAND_MARKERS.some((marker) => value.includes(marker));
  }
  if (Array.isArray(value)) return value.some(valueHasImpeccableHookMarker);
  if (value && typeof value === 'object') return Object.values(value).some(valueHasImpeccableHookMarker);
  return false;
}

function stripImpeccableHookEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (valueHasImpeccableHookMarker(entry.command) || valueHasImpeccableHookMarker(entry.args)) {
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

function pruneImpeccableHookFromManifest(manifestPath) {
  if (!fileHasImpeccableHookMarker(manifestPath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
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
    delete next.hooks;
    delete next.description;
    delete next.version;
  }

  if (Object.keys(next).length === 0) {
    fs.rmSync(manifestPath, { force: true });
  } else {
    fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return true;
}

function normalizeRuleId(rule) {
  return String(rule || '').trim().toLowerCase();
}

function parseIgnoreRuleArgs(args) {
  const positionals = [];
  let allValues = false;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--all-values') {
      allValues = true;
    } else if (arg === '--reason') {
      while (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) i++;
    } else if (arg.startsWith('--reason=')) {
      // Accepted for command symmetry; ignoreRules stores rule ids only.
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown ignore-rule flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return {
    rule: normalizeRuleId(positionals[0]),
    allValues,
  };
}

function addIgnoreRule(cwd, args) {
  const parsed = parseIgnoreRuleArgs(args);
  const rule = parsed.rule;
  if (!rule) throw new Error('Pass a rule id, e.g. /impeccable hooks ignore-rule side-tab');
  if (rule === 'overused-font' && !parsed.allValues) {
    throw new Error('overused-font is value-specific by default. Use /impeccable hooks ignore-value overused-font <font> for a confirmed font, or /impeccable hooks ignore-rule overused-font --all-values only when the user asked to ignore overused fonts generally.');
  }
  const config = mergeConfig(readRawConfig(cwd));
  if (!config.ignoreRules.includes(rule)) config.ignoreRules.push(rule);
  writeConfig(cwd, config);
  return `Added "${rule}" to ignoreRules. Current: ${config.ignoreRules.join(', ')}`;
}

function addIgnoreFile(cwd, glob) {
  if (!glob) throw new Error('Pass a glob, e.g. /impeccable hooks ignore-file "src/legacy/**"');
  const config = mergeConfig(readRawConfig(cwd));
  if (!config.ignoreFiles.includes(glob)) config.ignoreFiles.push(glob);
  writeConfig(cwd, config);
  return `Added "${glob}" to ignoreFiles. Current: ${config.ignoreFiles.join(', ')}`;
}

function parseIgnoreValueArgs(args) {
  const positionals = [];
  let shared = false;
  let local = false;
  let reason = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--shared') {
      shared = true;
    } else if (arg === '--local') {
      local = true;
    } else if (arg === '--reason') {
      const chunks = [];
      while (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) {
        chunks.push(args[++i]);
      }
      reason = chunks.join(' ').trim();
    } else if (String(arg).startsWith('--reason=')) {
      reason = String(arg).slice('--reason='.length).trim();
    } else {
      positionals.push(arg);
    }
  }

  const [rule, ...valueParts] = positionals;
  return {
    rule: String(rule || '').trim().toLowerCase(),
    value: normalizeIgnoreValue(valueParts.join(' ')),
    shared,
    local,
    reason,
  };
}

function addIgnoreValue(cwd, args) {
  const parsed = parseIgnoreValueArgs(args);
  if (!parsed.rule || !parsed.value) {
    throw new Error('Pass a rule id and value, e.g. /impeccable hooks ignore-value overused-font Inter');
  }

  if (parsed.shared && parsed.local) {
    throw new Error('Pass only one scope flag: --shared or --local');
  }

  const local = parsed.local;
  const config = local
    ? mergeLocalConfig(readRawConfig(cwd, { local: true }))
    : mergeConfig(readRawConfig(cwd, { local: false }));
  const key = `${parsed.rule}\0${parsed.value}`;
  const existing = config.ignoreValues.find((entry) => `${entry.rule}\0${entry.value}` === key);

  if (existing) {
    if (parsed.reason) existing.reason = parsed.reason;
  } else {
    const entry = {
      rule: parsed.rule,
      value: parsed.value,
      createdAt: new Date().toISOString(),
    };
    if (parsed.reason) entry.reason = parsed.reason;
    config.ignoreValues.push(entry);
  }

  const target = writeConfig(cwd, config, { local });
  const scope = local ? 'local ignoreValues' : 'shared ignoreValues';
  return `Added ${parsed.rule}=${parsed.value} to ${scope} (${path.relative(cwd, target) || target}).`;
}

function reset(cwd) {
  const removed = [];
  // Unified files may hold non-hook keys (e.g. updateCheck); strip only the
  // hook subtree and keep the rest, deleting the file only if nothing remains.
  for (const filePath of [getConfigPath(cwd), getLocalConfigPath(cwd)]) {
    try {
      const raw = readRawConfigFile(filePath).raw;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('hook' in raw)) continue;
      const { hook, ...rest } = raw;
      if (Object.keys(rest).length === 0) {
        fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, JSON.stringify(rest, null, 2) + '\n');
      }
      removed.push(path.relative(cwd, filePath) || filePath);
    } catch { /* ignore */ }
  }
  // State files are wholly ours; delete outright.
  for (const filePath of [getCachePath(cwd), getPendingPath(cwd)]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removed.push(path.relative(cwd, filePath) || filePath);
      }
    } catch { /* ignore */ }
  }
  return removed.length
    ? `Reset design hook config and cache (removed: ${removed.join(', ')}).`
    : 'No hook config or cache to remove. Already at defaults.';
}

function main() {
  const [, , actionArg, ...rest] = process.argv;
  const action = (actionArg || 'status').toLowerCase();
  const cwd = process.cwd();

  if (!ACTIONS.has(action)) {
    process.stderr.write(`Unknown action: ${action}\nValid: ${Array.from(ACTIONS).join(', ')}\n`);
    process.exit(1);
  }

  try {
    let out = '';
    switch (action) {
      case 'status': out = statusReport(cwd); break;
      case 'on':     out = setEnabled(cwd, true); break;
      case 'off':    out = setEnabled(cwd, false); break;
      case 'ignore-rule': out = addIgnoreRule(cwd, rest); break;
      case 'ignore-file': out = addIgnoreFile(cwd, rest[0]); break;
      case 'ignore-value': out = addIgnoreValue(cwd, rest); break;
      case 'reset':  out = reset(cwd); break;
    }
    process.stdout.write(out + '\n');
  } catch (err) {
    process.stderr.write(`Error: ${err.message || err}\n`);
    process.exit(1);
  }
}

main();
