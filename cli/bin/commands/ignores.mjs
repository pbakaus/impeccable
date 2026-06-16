import path from 'node:path';

import {
  getConfigPath,
  getLocalConfigPath,
  normalizeIgnoreValue,
  readDetectionConfig,
  readRawDetectionConfig,
  writeDetectionConfig,
} from '../../lib/impeccable-config.mjs';

const ACTION_ALIASES = new Map([
  ['status', 'list'],
  ['ls', 'list'],
  ['list', 'list'],
  ['add-rule', 'add-rule'],
  ['ignore-rule', 'add-rule'],
  ['add-file', 'add-file'],
  ['ignore-file', 'add-file'],
  ['add-value', 'add-value'],
  ['ignore-value', 'add-value'],
  ['update-value', 'add-value'],
  ['remove-rule', 'remove-rule'],
  ['rm-rule', 'remove-rule'],
  ['remove-file', 'remove-file'],
  ['rm-file', 'remove-file'],
  ['remove-value', 'remove-value'],
  ['rm-value', 'remove-value'],
  ['clear', 'clear'],
]);

function printUsage() {
  console.log(`Usage: impeccable ignores <action> [options]

Manage detector ignores in .impeccable config.

Actions:
  list                                  Show merged, shared, and local ignores
  add-rule <rule> [--all-values]        Ignore a rule
  add-file <glob>                       Ignore files by glob
  add-value <rule> <value>              Ignore one rule/value pair
  remove-rule <rule>                    Remove a rule ignore
  remove-file <glob>                    Remove a file ignore
  remove-value <rule> <value>           Remove a rule/value ignore
  clear                                 Clear detector ignores in the selected scope

Scope:
  --shared                              Write .impeccable/config.json (default)
  --local                               Write .impeccable/config.local.json
  --all                                 For remove/clear, apply to shared and local

Value options:
  --file <glob>                         Scope add-value/remove-value to a file glob
  --reason <text>                       Store or update a reason on add-value

Examples:
  impeccable ignores add-file "src/legacy/**"
  impeccable ignores add-value overused-font Inter --reason "Brand font"
  impeccable ignores add-value design-system-color "*" --file "src/demo.css"
  impeccable ignores remove-value overused-font Inter`);
}

function parseScope(args, { allowAll = false } = {}) {
  const rest = [];
  let local = false;
  let shared = false;
  let all = false;
  for (const arg of args) {
    if (arg === '--local') local = true;
    else if (arg === '--shared') shared = true;
    else if (arg === '--all') all = true;
    else rest.push(arg);
  }
  if ([local, shared, all].filter(Boolean).length > 1) {
    throw new Error(`Pass only one scope flag: --shared${allowAll ? ', --local, or --all' : ' or --local'}`);
  }
  if (all && !allowAll) throw new Error('--all is only supported for remove and clear actions');
  return { local, all, rest };
}

function parseValueArgs(args, { allowUnscopedWildcard = false } = {}) {
  const positionals = [];
  const files = [];
  let reason = '';

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--reason') {
      const chunks = [];
      while (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) chunks.push(args[++i]);
      reason = chunks.join(' ').trim();
    } else if (arg.startsWith('--reason=')) {
      reason = arg.slice('--reason='.length).trim();
    } else if (arg === '--file' || arg === '--files') {
      if (i + 1 >= args.length) throw new Error(`${arg} requires a glob`);
      files.push(String(args[++i]).trim());
    } else if (arg.startsWith('--file=')) {
      files.push(arg.slice('--file='.length).trim());
    } else if (arg.startsWith('--files=')) {
      files.push(arg.slice('--files='.length).trim());
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown add-value flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  const [rule, ...valueParts] = positionals;
  const value = normalizeIgnoreValue(valueParts.join(' '));
  if (!rule || !value) throw new Error('Pass a rule id and value, e.g. impeccable ignores add-value overused-font Inter');
  const scopedFiles = Array.from(new Set(files.filter(Boolean)));
  if (value === '*' && scopedFiles.length === 0 && !allowUnscopedWildcard) {
    throw new Error('Wildcard value ignores must be scoped with --file <glob>.');
  }
  return {
    rule: String(rule).trim().toLowerCase(),
    value,
    files: scopedFiles,
    reason,
  };
}

function formatValues(values) {
  if (!values.length) return '(none)';
  return values
    .map((entry) => {
      const fileSuffix = Array.isArray(entry.files) && entry.files.length
        ? ` [${entry.files.join(', ')}]`
        : '';
      const reasonSuffix = entry.reason ? ` - ${entry.reason}` : '';
      return `${entry.rule}=${entry.value}${fileSuffix}${reasonSuffix}`;
    })
    .join(', ');
}

function formatConfig(label, config) {
  return [
    `${label}:`,
    `  ignoreRules:  ${config.ignoreRules.length ? config.ignoreRules.join(', ') : '(none)'}`,
    `  ignoreFiles:  ${config.ignoreFiles.length ? config.ignoreFiles.join(', ') : '(none)'}`,
    `  ignoreValues: ${formatValues(config.ignoreValues)}`,
    `  designSystem: ${config.designSystem?.enabled === false ? 'disabled' : 'enabled'}`,
  ].join('\n');
}

function list(cwd) {
  const merged = readDetectionConfig(cwd);
  const shared = readRawDetectionConfig(cwd);
  const local = readRawDetectionConfig(cwd, { local: true });
  return [
    'Impeccable detector ignores',
    `  shared file: ${path.relative(cwd, getConfigPath(cwd)) || getConfigPath(cwd)}`,
    `  local file:  ${path.relative(cwd, getLocalConfigPath(cwd)) || getLocalConfigPath(cwd)}`,
    '',
    formatConfig('Merged', merged),
    '',
    formatConfig('Shared', shared),
    '',
    formatConfig('Local', local),
  ].join('\n');
}

function readScopeConfig(cwd, local) {
  return readRawDetectionConfig(cwd, { local });
}

function writeScopeConfig(cwd, config, local) {
  return writeDetectionConfig(cwd, config, { local });
}

function parseRuleArgs(args) {
  const positionals = [];
  let allValues = false;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--all-values') {
      allValues = true;
    } else if (arg === '--reason') {
      while (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) i++;
    } else if (arg.startsWith('--reason=')) {
      // Accepted for symmetry with add-value; ignoreRules stores ids only.
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown add-rule flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return {
    rule: String(positionals[0] || '').trim().toLowerCase(),
    allValues,
  };
}

function addRule(cwd, args) {
  const { local, rest } = parseScope(args);
  const { rule, allValues } = parseRuleArgs(rest);
  if (!rule) throw new Error('Pass a rule id, e.g. impeccable ignores add-rule side-tab');
  if (rule === 'overused-font' && !allValues) {
    throw new Error('overused-font is value-specific by default. Use add-value overused-font <font>, or add-rule overused-font --all-values for broad suppression.');
  }
  const config = readScopeConfig(cwd, local);
  if (!config.ignoreRules.includes(rule)) config.ignoreRules.push(rule);
  const target = writeScopeConfig(cwd, config, local);
  return `Added ${rule} to ${local ? 'local' : 'shared'} detector ignoreRules (${path.relative(cwd, target) || target}).`;
}

function addFile(cwd, args) {
  const { local, rest } = parseScope(args);
  const glob = String(rest[0] || '').trim();
  if (!glob) throw new Error('Pass a glob, e.g. impeccable ignores add-file "src/legacy/**"');
  const config = readScopeConfig(cwd, local);
  if (!config.ignoreFiles.includes(glob)) config.ignoreFiles.push(glob);
  const target = writeScopeConfig(cwd, config, local);
  return `Added ${glob} to ${local ? 'local' : 'shared'} detector ignoreFiles (${path.relative(cwd, target) || target}).`;
}

function addValue(cwd, args) {
  const { local, rest } = parseScope(args);
  const parsed = parseValueArgs(rest);
  const config = readScopeConfig(cwd, local);
  const key = ignoreValueKey(parsed);
  const existing = config.ignoreValues.find((entry) => ignoreValueKey(entry) === key);
  if (existing) {
    if (parsed.reason) existing.reason = parsed.reason;
    if (parsed.files.length) existing.files = parsed.files;
  } else {
    const entry = {
      rule: parsed.rule,
      value: parsed.value,
      createdAt: new Date().toISOString(),
    };
    if (parsed.files.length) entry.files = parsed.files;
    if (parsed.reason) entry.reason = parsed.reason;
    config.ignoreValues.push(entry);
  }
  const target = writeScopeConfig(cwd, config, local);
  return `Added ${parsed.rule}=${parsed.value} to ${local ? 'local' : 'shared'} detector ignoreValues (${path.relative(cwd, target) || target}).`;
}

function removeFromScopes(cwd, args, remover) {
  const { local, all, rest } = parseScope(args, { allowAll: true });
  const scopes = all ? [false, true] : [local];
  const removed = [];
  for (const isLocal of scopes) {
    const config = readScopeConfig(cwd, isLocal);
    const count = remover(config, rest);
    if (count > 0) {
      const target = writeScopeConfig(cwd, config, isLocal);
      removed.push(`${count} from ${isLocal ? 'local' : 'shared'} (${path.relative(cwd, target) || target})`);
    }
  }
  return removed.length ? `Removed ${removed.join(', ')}.` : 'No matching detector ignore found.';
}

function removeRule(cwd, args) {
  return removeFromScopes(cwd, args, (config, rest) => {
    const rule = String(rest[0] || '').trim().toLowerCase();
    if (!rule) throw new Error('Pass a rule id, e.g. impeccable ignores remove-rule side-tab');
    const before = config.ignoreRules.length;
    config.ignoreRules = config.ignoreRules.filter((entry) => entry !== rule);
    return before - config.ignoreRules.length;
  });
}

function removeFile(cwd, args) {
  return removeFromScopes(cwd, args, (config, rest) => {
    const glob = String(rest[0] || '').trim();
    if (!glob) throw new Error('Pass a glob, e.g. impeccable ignores remove-file "src/legacy/**"');
    const before = config.ignoreFiles.length;
    config.ignoreFiles = config.ignoreFiles.filter((entry) => entry !== glob);
    return before - config.ignoreFiles.length;
  });
}

function removeValue(cwd, args) {
  return removeFromScopes(cwd, args, (config, rest) => {
    const parsed = parseValueArgs(rest, { allowUnscopedWildcard: true });
    const key = ignoreValueKey(parsed);
    const before = config.ignoreValues.length;
    config.ignoreValues = config.ignoreValues.filter((entry) => ignoreValueKey(entry) !== key);
    return before - config.ignoreValues.length;
  });
}

function clear(cwd, args) {
  const { local, all, rest } = parseScope(args, { allowAll: true });
  if (rest.length > 0) throw new Error('clear does not take positional arguments');
  const scopes = all ? [false, true] : [local];
  for (const isLocal of scopes) {
    const config = readScopeConfig(cwd, isLocal);
    config.ignoreRules = [];
    config.ignoreFiles = [];
    config.ignoreValues = [];
    writeScopeConfig(cwd, config, isLocal);
  }
  return `Cleared detector ignores in ${all ? 'shared and local config' : local ? 'local config' : 'shared config'}.`;
}

function ignoreValueKey(entry) {
  const files = Array.isArray(entry.files) && entry.files.length ? entry.files.join('\x1f') : '';
  return `${String(entry.rule || '').trim().toLowerCase()}\0${normalizeIgnoreValue(entry.value)}\0${files}`;
}

export async function run(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const actionArg = args[0] || 'list';
  if (actionArg === '--help' || actionArg === '-h') {
    printUsage();
    return;
  }
  const action = ACTION_ALIASES.get(String(actionArg).toLowerCase());
  if (!action) {
    throw new Error(`Unknown ignores action: ${actionArg}. Run "impeccable ignores --help".`);
  }
  const rest = args.slice(1);
  let out;
  switch (action) {
    case 'list': out = list(cwd); break;
    case 'add-rule': out = addRule(cwd, rest); break;
    case 'add-file': out = addFile(cwd, rest); break;
    case 'add-value': out = addValue(cwd, rest); break;
    case 'remove-rule': out = removeRule(cwd, rest); break;
    case 'remove-file': out = removeFile(cwd, rest); break;
    case 'remove-value': out = removeValue(cwd, rest); break;
    case 'clear': out = clear(cwd, rest); break;
  }
  if (out) console.log(out);
}
