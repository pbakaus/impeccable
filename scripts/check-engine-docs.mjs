import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+$/;
const LAUNCHER = /^(?:.*[/\\])?impeccable(?:\.cmd)?$/;
const COMMAND_TEXT = /(?:^|[\s/\\}"'$])impeccable(?:\.cmd)?(?=[\s"']|$)/;
const SHELLS = new Set(['', 'sh', 'bash', 'shell', 'zsh', 'console', 'text', 'cmd', 'powershell', 'ps1']);
const own = (map, key) => map && Object.hasOwn(map, key) ? map[key] : undefined;

function validateContract(contract) {
  if (!VERSION.test(contract.version) || !/^[a-f0-9]{40}$/.test(contract.tagCommit)) {
    throw new Error('The capability contract needs an exact release version and tag commit.');
  }
  const visit = (commands) => {
    if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
      throw new Error('The capability contract needs a command map.');
    }
    for (const [name, command] of Object.entries(commands)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name) || !Array.isArray(command.evidence) || !command.evidence.length
        || command.evidence.some((item) => !item.file?.endsWith('.rs') || !item.symbol)) {
        throw new Error(`The contract needs source evidence for ${name}.`);
      }
      for (const [option, shape] of Object.entries(command.options ?? {})) {
        if (!/^--?[a-z][a-z0-9-]*$/.test(option) || !shape
          || !(Number.isInteger(shape.values) && shape.values >= 0 || ['optional', 'rest'].includes(shape.values))
          || !['separate', 'equals', 'both'].includes(shape.form)
          || shape.values === 0 && shape.form !== 'separate'
          || shape.values !== 0 && !['any', 'non-option', 'non-long-option'].includes(shape.value)
          || shape.values > 1 && shape.form !== 'separate'
          || shape.values === 'rest' && shape.value !== 'non-long-option') {
          throw new Error(`Invalid option contract for ${name} ${option}.`);
        }
      }
      if (command.subcommands) visit(command.subcommands);
    }
  };
  visit(contract.commands);
  for (const [alias, target] of Object.entries(contract.aliases ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(alias) || own(contract.commands, alias) || !own(contract.commands, target)) {
      throw new Error(`Invalid root alias ${alias}.`);
    }
  }
  for (const template of contract.templates ?? []) {
    if (!template.file || !template.text || !['verb-template', 'action-template', 'argument-template', 'code-mention'].includes(template.kind)) {
      throw new Error('Invalid documented command template.');
    }
    if (!['verb-template', 'code-mention'].includes(template.kind) && !template.paths?.length) throw new Error('A command template needs reviewed paths.');
    for (const names of template.paths ?? []) {
      let scope = { subcommands: contract.commands };
      for (const name of names) scope = own(scope?.subcommands, name);
      if (!scope) throw new Error(`Unreviewed command template path ${names.join(' ')}.`);
    }
  }
}

function markdownRegions(text) {
  const regions = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const lines = clean.split('\n');
  let fence;
  let prose = [];
  let proseLine = 1;
  const spans = () => {
    const text = prose.join('\n');
    for (const match of text.matchAll(/(`+)([\s\S]*?)\1(?!`)/g)) {
      regions.push({ text: match[2], line: proseLine + text.slice(0, match.index).split('\n').length - 1, shell: true, complete: false });
    }
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^\s*(`{3,}|~{3,})([^`]*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
        regions.push({ text: fence.lines.join('\n'), line: fence.line, language: fence.language, shell: SHELLS.has(fence.language), complete: true });
        fence = undefined;
        proseLine = i + 2;
      } else fence.lines.push(lines[i]);
      continue;
    }
    if (marker) {
      spans();
      fence = { marker: marker[1], language: marker[2].trim().toLowerCase(), lines: [], line: i + 2 };
      continue;
    }
    prose.push(lines[i]);
  }
  spans();
  if (fence) regions.push({ text: fence.lines.join('\n'), line: fence.line, unclosed: true, complete: true });
  return regions.map((region) => {
    const sourceLines = [];
    let line = region.line;
    for (let i = 0; i < region.text.length; i++) {
      sourceLines.push(line);
      if (region.text[i] === '\n') line++;
    }
    return { ...region, input: { text: region.complete ? region.text : region.text.replace(/\n/g, ' '), sourceLines } };
  });
}

function shellCommands({ text, sourceLines }, language) {
  const commands = [];
  let tokens = [];
  let value = '';
  let started = false;
  let quote;
  let tokenLine;
  let problem;
  const token = () => {
    if (started) tokens.push({ value, line: tokenLine });
    value = '';
    started = false;
  };
  const command = () => {
    token();
    if (tokens.length) commands.push({ tokens, problem });
    tokens = [];
    problem = undefined;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c === '\\' || language === 'cmd' && c === '^' || ['powershell', 'ps1'].includes(language) && c === '`')
      && text[i + 1] === '\n' && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && /["\\$`]/.test(text[i + 1] ?? '')) value += text[++i];
      else {
        if (quote === '"' && (c === '`' || c === '$' && text[i + 1] === '(')) problem = 'command substitution';
        value += c;
      }
      continue;
    }
    if (c === '#' && !started) {
      while (i < text.length && text[i] !== '\n') i++;
      command();
      continue;
    }
    if (/\s/.test(c)) {
      token();
      if (c === '\n') command();
      continue;
    }
    if (!started) { started = true; tokenLine = sourceLines[i]; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '<' && /^[a-zA-Z]/.test(text[i + 1] ?? '') && text.indexOf('>', i) >= 0) {
      const end = text.indexOf('>', i);
      value += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      if (text[i + 1] === c) i++;
      if (tokens.length || value) command();
      continue;
    }
    if (c === '[' || c === ']') continue;
    if (c === '`' || c === '$' && text[i + 1] === '(' || c === '<' || c === '>') problem = 'shell expansion or redirection';
    if (c === '\\' && /[\s"'\\]/.test(text[i + 1] ?? '')) value += text[++i];
    else value += c;
  }
  if (quote) problem = 'unclosed quote';
  command();
  return commands;
}

export function checkDocuments(documents, contract) {
  validateContract(contract);
  const references = [];
  const classifications = [];
  const diagnostics = [];
  for (const { file, text } of documents) {
    for (const region of markdownRegions(text)) {
      if (!COMMAND_TEXT.test(region.text)) continue;
      if (!region.shell) {
        if (region.unclosed) diagnostics.push({ file, line: region.line, message: `Unclosed command fence (engine ${contract.version}).` });
        else classifications.push({ file, line: region.line, kind: 'non-shell-code', text: region.text.trim() });
        continue;
      }
      const template = contract.templates?.find((item) => item.file === file && item.text === region.text.trim());
      if (template) {
        classifications.push({ file, line: region.line, kind: template.kind, text: template.text });
        continue;
      }
      const commands = shellCommands(region.input, region.language);
      let found = false;
      for (const { tokens, problem } of commands) {
        const index = tokens.findIndex((token) => LAUNCHER.test(token.value)
          || ['{{command_prefix}}impeccable', '$impeccable'].includes(token.value));
        if (index < 0) continue;
        found = true;
        const location = { file, line: tokens[index].line };
        const fail = (message, line = location.line) => diagnostics.push({ file, line, message: `${message} (engine ${contract.version}).` });
        const executable = tokens[index].value;
        if (['/impeccable', '{{command_prefix}}impeccable', '$impeccable'].includes(executable)) {
          classifications.push({ ...location, kind: 'skill-command', text: region.text.trim() });
          continue;
        }
        if (problem) {
          fail(`Cannot inspect command-shaped text with ${problem}`);
          continue;
        }
        const prefix = tokens.slice(0, index).map((token) => token.value);
        if (prefix.some((value) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value) && !['npx', 'env', 'command', '$'].includes(value))) {
          fail('Cannot inspect the launcher prefix');
          continue;
        }
        const args = tokens.slice(index + 1);
        if (!args.length) {
          classifications.push({ ...location, kind: 'launcher-mention', text: region.text.trim() });
          continue;
        }
        const root = own(contract.aliases, args[0].value) ?? args[0].value;
        let scopes = [own(contract.commands, root)];
        const reference = { ...location, path: [args[0].value], options: [] };
        references.push(reference);
        if (!scopes[0]) { fail(`Unsupported or unreviewed engine command ${args[0].value}`); continue; }
        let cursor = 1;
        while (scopes.every((scope) => scope.subcommands) && cursor < args.length && !args[cursor].value.startsWith('-')) {
          const name = args[cursor++].value;
          reference.path.push(name);
          const alternatives = /^<[a-z-]+(?:\|[a-z-]+)+>$/.test(name) ? name.slice(1, -1).split('|') : [name];
          scopes = scopes.flatMap((scope) => alternatives.map((name) => own(scope.subcommands, name)));
          if (scopes.some((scope) => !scope)) {
            fail(`Unsupported or unreviewed subcommand ${reference.path.join(' ')}`);
            break;
          }
        }
        if (scopes.some((scope) => !scope)) continue;
        for (; cursor < args.length; cursor++) {
          const arg = args[cursor].value;
          if (!arg.startsWith('-')) continue;
          const line = args[cursor].line;
          if (arg === '--') { fail(`Unreviewed -- terminator in ${reference.path.join(' ')}`, line); continue; }
          const equals = arg.indexOf('=');
          const name = equals < 0 ? arg : arg.slice(0, equals);
          const form = equals < 0 ? 'separate' : 'equals';
          reference.options.push({ name, form, line });
          const options = scopes.map((scope) => own(scope.options, name));
          if (options.some((option) => !option)) { fail(`Unsupported or unreviewed option ${name} for ${reference.path.join(' ')}`, line); continue; }
          if (options.some((option) => option.form !== 'both' && option.form !== form)) {
            fail(`Unsupported ${form} form of ${name} for ${reference.path.join(' ')}`, line);
          }
          const option = options[0];
          if (options.some((other) => other.values !== option.values || other.value !== option.value)) {
            fail(`Ambiguous value requirements for ${name} in ${reference.path.join(' ')}`, line);
            continue;
          }
          if (form === 'equals') {
            if (region.complete && arg.slice(equals + 1) === '') fail(`Missing value for ${name}`, line);
            continue;
          }
          const count = option.values === 'rest' ? Infinity : option.values === 'optional' ? 1 : option.values;
          for (let n = 0; n < count; n++) {
            const next = args[cursor + 1]?.value;
            if (next === undefined || next === '' || option.value === 'non-option' && next.startsWith('-')
              || option.value === 'non-long-option' && next.startsWith('--')) {
              if (region.complete && Number.isInteger(option.values)) fail(`Missing value for ${name}`, line);
              break;
            }
            cursor++;
          }
        }
      }
      if (!found) {
        if (!commands.length) classifications.push({ file, line: region.line, kind: 'shell-comment', text: region.text.trim() });
        else diagnostics.push({ file, line: region.line, message: `Cannot inspect command-shaped text (engine ${contract.version}).` });
      }
    }
  }
  return { references, classifications, diagnostics };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const version = fs.readFileSync(path.join(root, 'ENGINE_VERSION'), 'utf8').trim();
  if (!VERSION.test(version)) throw new Error('ENGINE_VERSION must be an exact x.y.z version.');
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'scripts/engine-capabilities.json'), 'utf8'));
  validateContract(contract);
  if (version !== contract.version) throw new Error(`ENGINE_VERSION ${version} has no reviewed capability contract. Review scripts/engine-capabilities.json.`);
  const tag = `refs/tags/engine-v${version}`;
  let commit;
  try { commit = execFileSync('git', ['rev-parse', '--verify', `${tag}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error(`Missing ${tag}. Fetch the pinned tag from https://github.com/pbakaus/impeccable.git before running this check.`); }
  if (commit !== contract.tagCommit) throw new Error(`${tag} resolves to ${commit}, but the reviewed contract requires ${contract.tagCommit}.`);
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : file.endsWith('.md') ? [file] : [];
  });
  const files = ['skill/SKILL.src.md', ...walk('skill/reference'), ...walk('skill/agents')];
  const result = checkDocuments(files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') })), contract);
  for (const diagnostic of result.diagnostics) console.error(`${diagnostic.file}:${diagnostic.line}: ${diagnostic.message}`);
  const counts = new Map();
  for (const item of result.classifications) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  console.log(`Engine ${version}: checked ${result.references.length} references in ${files.length} authored Markdown files; classified ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(', ')}.`);
  console.log('Coverage: command names, subcommands and option forms in code spans and shell fences. Detached prose flags and runtime behavior require review. Capability changes require a release-source audit.');
  if (result.diagnostics.length) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Engine documentation check: ${error.message}`); process.exitCode = 1; }
}
