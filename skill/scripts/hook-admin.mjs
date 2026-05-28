#!/usr/bin/env node
/**
 * `/impeccable hooks <on|off|status|reset>` — manage the design hook
 * via .impeccable/hook.json in the current project.
 *
 * Usage:
 *   node hook-admin.mjs status                  # print current state
 *   node hook-admin.mjs on                      # set enabled: true
 *   node hook-admin.mjs off                     # set enabled: false
 *   node hook-admin.mjs ignore-rule <rule-id>   # append to ignoreRules
 *   node hook-admin.mjs ignore-file <glob>      # append to ignoreFiles
 *   node hook-admin.mjs reset                   # remove all config + cache
 *
 * Designed to be invoked by the LLM from the reference/hooks.md flow.
 * Output is human-readable; the harness will pass it back to the user.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getConfigPath, getCachePath, readConfig, DEFAULT_CONFIG } from './hook-lib.mjs';

const ACTIONS = new Set(['status', 'on', 'off', 'ignore-rule', 'ignore-file', 'reset']);

function readRawConfig(cwd) {
  const filePath = getConfigPath(cwd);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function writeConfig(cwd, config) {
  const filePath = getConfigPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
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
    minSeverity: typeof base.minSeverity === 'string' ? base.minSeverity : DEFAULT_CONFIG.minSeverity,
    limits: {
      maxFindings: Number.isFinite(base?.limits?.maxFindings) ? base.limits.maxFindings : DEFAULT_CONFIG.limits.maxFindings,
      maxChars: Number.isFinite(base?.limits?.maxChars) ? base.limits.maxChars : DEFAULT_CONFIG.limits.maxChars,
    },
  };
}

function statusReport(cwd) {
  const raw = readRawConfig(cwd);
  const cfg = readConfig(cwd);
  const fileExists = raw !== null;
  const envKill = process.env.IMPECCABLE_HOOK_DISABLED;
  const envState = envKill ? `IMPECCABLE_HOOK_DISABLED=${envKill}` : 'unset';
  const cfgPath = path.relative(cwd, getConfigPath(cwd)) || '.impeccable/hook.json';
  const cachePath = path.relative(cwd, getCachePath(cwd)) || '.impeccable/hook.cache.json';

  const lines = [
    `Impeccable design hook`,
    `  state:        ${cfg.enabled ? 'enabled' : 'disabled'}`,
    `  config file:  ${fileExists ? cfgPath : `${cfgPath} (using defaults; file not present)`}`,
    `  ignoreRules:  ${cfg.ignoreRules.length ? cfg.ignoreRules.join(', ') : '(none)'}`,
    `  ignoreFiles:  ${cfg.ignoreFiles.length ? cfg.ignoreFiles.join(', ') : '(none)'}`,
    `  minSeverity:  ${cfg.minSeverity}`,
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
  return `Design hook ${value ? 'enabled' : 'disabled'} for this project (wrote ${path.relative(cwd, target) || target}).`;
}

function addIgnoreRule(cwd, rule) {
  if (!rule) throw new Error('Pass a rule id, e.g. /impeccable hooks ignore-rule side-tab');
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

function reset(cwd) {
  const removed = [];
  for (const filePath of [getConfigPath(cwd), getCachePath(cwd)]) {
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
      case 'ignore-rule': out = addIgnoreRule(cwd, rest[0]); break;
      case 'ignore-file': out = addIgnoreFile(cwd, rest[0]); break;
      case 'reset':  out = reset(cwd); break;
    }
    process.stdout.write(out + '\n');
  } catch (err) {
    process.stderr.write(`Error: ${err.message || err}\n`);
    process.exit(1);
  }
}

main();
