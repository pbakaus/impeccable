import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkDocuments } from '../scripts/check-engine-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'scripts/engine-capabilities.json'), 'utf8'));
const historical = {
  version: '0.1.14',
  tagCommit: '866f3557a13847bf450d8d09d23459243d2fb7c3',
  commands: {
    'concept-seed': {
      evidence: [{ file: 'crates/context/src/concept_seed.rs', symbol: 'run, lines 611-637; idx/val, chosen/kind, then PRODUCT.md gate' }],
      options: {
        '--scope': { values: 1, form: 'separate', value: 'any' },
        '--mode': { values: 1, form: 'separate', value: 'any' },
      },
    },
    'comp-diff': { evidence: [{ file: 'crates/cli/src/main.rs', symbol: 'run, comp-diff route' }] },
  },
};

function check(text, release = contract, file = 'example.md') {
  return checkDocuments([{ file, text }], release);
}

function inline(command, release = contract) {
  return check('`' + command + '`', release);
}

function fence(command) {
  return check('```sh\n' + command + '\n```');
}

function repository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-docs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.mkdirSync(path.join(directory, 'skill/reference'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'skill/agents'));
  fs.copyFileSync(path.join(root, 'scripts/check-engine-docs.mjs'), path.join(directory, 'scripts/check-engine-docs.mjs'));
  fs.writeFileSync(path.join(directory, 'ENGINE_VERSION'), '0.1.15\n');
  fs.writeFileSync(path.join(directory, 'skill/SKILL.src.md'), '`impeccable concept-seed --check-seed <reference>`\n');
  const git = (...args) => execFileSync('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('add', 'ENGINE_VERSION');
  git('commit', '--quiet', '-m', 'Fixture release');
  const release = { ...contract, tagCommit: git('rev-parse', 'HEAD') };
  fs.writeFileSync(path.join(directory, 'scripts/engine-capabilities.json'), JSON.stringify(release));
  git('tag', 'engine-v0.1.15');
  const run = () => spawnSync(process.execPath, [path.join(directory, 'scripts/check-engine-docs.mjs')], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, IMPECCABLE_BIN: path.join(directory, 'must-not-execute') },
  });
  return { directory, git, run };
}

test('the actual #1030 reviewer invocation fails against audited 0.1.14 and passes against 0.1.15', () => {
  const file = 'skill/agents/impeccable-finish-reviewer.md';
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const invocation = '`impeccable concept-seed --check-seed <reference>`';
  assert.ok(text.includes(invocation));
  const line = text.slice(0, text.indexOf(invocation)).split('\n').length;
  const old = check(text, historical, file);
  assert.equal(old.diagnostics.length, 1);
  assert.equal(old.diagnostics[0].file, file);
  assert.equal(old.diagnostics[0].line, line);
  assert.match(old.diagnostics[0].message, /--check-seed.*concept-seed.*0\.1\.14/);
  const current = check(text, contract, file);
  assert.deepEqual(current.diagnostics, []);
  assert.ok(current.references.some((ref) => ref.line === line && ref.options.some((option) => option.name === '--check-seed')));
});

test('unknown literal commands and prototype property names fail, with or without aliases', () => {
  for (const name of ['unknown-command', 'constructor', 'toString', '__proto__']) {
    for (const release of [contract, { ...contract, aliases: undefined }]) {
      const result = inline(`impeccable ${name}`, release);
      assert.equal(result.diagnostics.length, 1, name);
      assert.match(result.diagnostics[0].message, /Unsupported or unreviewed engine command/);
    }
  }
});

test('flags stay in their root command and subcommand scopes', () => {
  for (const command of [
    'impeccable detect --check-seed seed:1234',
    'impeccable concept-seed --json',
    'impeccable build-phase advance --direction seed:1234',
    'impeccable component-review plan --manifest components.json',
    'impeccable critique-storage close target snapshot.md --json',
    'impeccable hooks ignore-file path --reason intentional',
    'impeccable live-server stop --background',
  ]) {
    assert.match(inline(command).diagnostics[0]?.message ?? '', /Unsupported or unreviewed option/, command);
  }
  for (const command of ['impeccable build-phase constructor', 'impeccable hooks __proto__', 'impeccable build-phase record unknown']) {
    assert.match(inline(command).diagnostics[0]?.message ?? '', /Unsupported or unreviewed subcommand/, command);
  }
  assert.deepEqual(inline('impeccable build-phase start --direction seed:1234 --artifact index.html').diagnostics, []);
  assert.deepEqual(inline('impeccable build-phase record hero').diagnostics, []);
});

test('only root-routed aliases are accepted', () => {
  for (const command of ['impeccable context-signals', 'impeccable hook-admin status', 'impeccable ignore']) {
    assert.deepEqual(inline(command).diagnostics, [], command);
  }
  for (const command of ['impeccable complete', 'impeccable status', 'impeccable wrap']) {
    assert.equal(inline(command).diagnostics.length, 1, command);
  }
});

test('inline references can omit values while complete examples require them', () => {
  assert.deepEqual(inline('impeccable generate-image --ref').diagnostics, []);
  assert.deepEqual(inline('impeccable live-poll --reply EVENT_ID').diagnostics, []);
  for (const command of ['impeccable generate-image --ref', 'impeccable live-poll --reply EVENT_ID']) {
    assert.match(fence(command).diagnostics[0]?.message ?? '', /Missing value/, command);
  }
  assert.deepEqual(fence('impeccable live-poll --reply EVENT_ID done').diagnostics, []);
  assert.match(inline('impeccable generate-image --unknown').diagnostics[0]?.message ?? '', /--unknown/);
});

test('separate and equals forms follow the reviewed parser', () => {
  for (const command of ['impeccable context --target=src/App.jsx', 'impeccable detect --scope=layout', 'impeccable live-wrap --id=EVENT_ID']) {
    assert.deepEqual(inline(command).diagnostics, [], command);
  }
  for (const command of ['impeccable concept-seed --check-seed=seed:1234', 'impeccable live-insert --id=EVENT_ID', 'impeccable comp-spec --comp=comp.png', 'impeccable detect --json=true']) {
    assert.match(inline(command).diagnostics[0]?.message ?? '', /Unsupported equals form/, command);
  }
  assert.match(fence('impeccable live-wrap --id=').diagnostics[0]?.message ?? '', /Missing value/);
});

test('quoted data, comments, separators, continuations, and paths retain their command boundaries and lines', () => {
  const text = [
    '<!-- `impeccable absent --bad` -->',
    '```bash',
    '# impeccable absent --bad',
    'env COLOR=0 npx impeccable detect --json \\',
    '  --scope "type" # --not-a-flag',
    'impeccable embed-prompt photo.png --prompt "A hero; --not-an-option"',
    'command "/tmp/Skill Dir/impeccable" comp-spec --crop "hero area"',
    'impeccable live-poll --reply ID done --data \'{"notes":"--not-a-flag"}\'',
    'impeccable detect --json && impeccable doctor --fix; impeccable signals',
    '```',
    '`impeccable detect --bad`',
  ].join('\n');
  const result = check(text);
  assert.equal(result.references.length, 8);
  assert.deepEqual(result.references.map((ref) => ref.line), [4, 6, 7, 8, 9, 9, 9, 11]);
  assert.deepEqual(result.references[0].options.map((option) => [option.name, option.line]), [['--json', 4], ['--scope', 5]]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].line, 11);
  assert.match(result.diagnostics[0].message, /--bad/);
});

test('Windows and placeholder launchers are inspected', () => {
  for (const command of [
    '"C:\\Tools\\Skill Folder\\impeccable.cmd" detect --json',
    '"{{scripts_path}}/impeccable" detect --json',
    '{{scripts_path}}/impeccable.cmd detect --json',
    '<skill-base-dir>/scripts/impeccable detect --json',
    './skill/scripts/impeccable detect --json',
  ]) {
    assert.deepEqual(inline(command).diagnostics, [], command);
    assert.equal(inline(command.replace('--json', '--bad')).diagnostics.length, 1, command);
  }
  for (const [language, continuation] of [['cmd', '^'], ['powershell', '`']]) {
    const result = check('```' + language + '\nimpeccable.cmd detect ' + continuation + '\n  --json\nimpeccable.cmd doctor --fix\n```');
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.references.map((ref) => [ref.path, ref.line, ref.options]), [
      [['detect'], 2, [{ name: '--json', form: 'separate', line: 3 }]],
      [['doctor'], 4, [{ name: '--fix', form: 'separate', line: 4 }]],
    ]);
  }
});

test('a flag-shaped required value follows its parser, while standalone quotes do not hide options', () => {
  for (const command of [
    'impeccable embed-prompt image.png --prompt "--literal-prompt"',
    'impeccable concept-seed --check-seed "--literal-reference"',
    'impeccable generate-image --ref -reference.png',
  ]) assert.deepEqual(fence(command).diagnostics, [], command);
  assert.match(inline('impeccable detect "--unknown"').diagnostics[0]?.message ?? '', /--unknown/);
  assert.deepEqual(inline('impeccable detect "--json"').diagnostics, []);
  assert.match(fence('impeccable context --target -reference').diagnostics[0]?.message ?? '', /Missing value/);
  assert.match(fence('impeccable generate-image --ref "--unknown"').diagnostics[0]?.message ?? '', /Missing value/);
  assert.match(inline('impeccable detect -- --unknown').diagnostics[0]?.message ?? '', /Unreviewed -- terminator/);
  for (const action of ['ignore-rule', 'ignore-value']) {
    assert.deepEqual(fence(`impeccable hooks ${action} overused-font --reason allow -weight`).diagnostics, []);
    assert.match(fence(`impeccable hooks ${action} overused-font --reason allow -weight --future`).diagnostics[0]?.message ?? '', /--future/);
  }
});

test('known templates are file-bound and finite actions are checked', () => {
  for (const template of contract.templates) {
    const result = check('`' + template.text + '`', contract, template.file);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.classifications[0].kind, template.kind);
    assert.equal(result.classifications[0].text, template.text);
    assert.ok(check('`' + template.text + '`', contract, 'unreviewed.md').diagnostics.length > 0);
    assert.ok(check('`' + template.text + ' --unknown`', contract, template.file).diagnostics.length > 0);
  }
  assert.deepEqual(inline('impeccable pin <pin|unpin> <command>').diagnostics, []);
  assert.match(inline('impeccable pin <pin|unknown> <command>').diagnostics[0]?.message ?? '', /subcommand/);
  for (const command of ['impeccable <verb>', 'impeccable $VERB', 'impeccable hooks <action>', 'impeccable detect --${FLAG}']) {
    assert.ok(inline(command).diagnostics.length > 0, command);
  }
  assert.deepEqual(inline('impeccable comp-spec --crop $REGION').diagnostics, []);
});

test('skill prefixes and non-shell code are explicitly classified', () => {
  for (const command of ['/impeccable polish', '{{command_prefix}}impeccable polish', '$impeccable critique']) {
    const result = inline(command);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.classifications[0].kind, 'skill-command');
  }
  const result = check('```js\n// impeccable live mode loads here.\n```');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.classifications[0].kind, 'non-shell-code');
  assert.equal(check('```sh\n# impeccable unknown\n```').classifications[0].kind, 'shell-comment');
});

test('multiline spans and longer backtick delimiters are inspected', () => {
  const result = check('`impeccable generate-image\n--ref <image>`');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.references[0].options, [{ name: '--ref', form: 'separate', line: 2 }]);
  assert.deepEqual(check("``impeccable embed-prompt image.png --prompt '`literal`'``").diagnostics, []);
  assert.match(check('```sh\nimpeccable detect --json').diagnostics[0]?.message ?? '', /Unclosed command fence/);
  assert.match(fence('impeccable comp-spec --crop "unclosed').diagnostics[0]?.message ?? '', /unclosed quote/);
});

test('wrapped inline options are validated at their original source lines', () => {
  const result = inline('impeccable detect\n--unknown');
  assert.deepEqual(result.references[0].options, [{ name: '--unknown', form: 'separate', line: 2 }]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].line, 2);
  assert.match(result.diagnostics[0].message, /Unsupported or unreviewed option --unknown/);
});

test('wrapped check-seed retains the historical release mismatch', () => {
  const command = 'impeccable concept-seed\n--check-seed <reference>';
  const old = inline(command, historical);
  assert.equal(old.diagnostics.length, 1);
  assert.equal(old.diagnostics[0].line, 2);
  assert.match(old.diagnostics[0].message, /--check-seed.*concept-seed.*0\.1\.14/);
  const current = inline(command);
  assert.deepEqual(current.diagnostics, []);
  assert.deepEqual(current.references[0].options, [{ name: '--check-seed', form: 'separate', line: 2 }]);
});

test('inline line breaks become spaces before shell quotes, comments, or escapes', () => {
  for (const command of ['impeccable detect "--js\non"', 'impeccable detect --js\\\non']) {
    const result = inline(command);
    assert.deepEqual(result.references[0].options, [{ name: '--js on', form: 'separate', line: 1 }]);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0].message, /Unsupported or unreviewed option --js on/);
  }
  const comment = inline('# explanation\nimpeccable detect --unknown');
  assert.deepEqual(comment.references, []);
  assert.deepEqual(comment.diagnostics, []);
  assert.equal(comment.classifications[0].kind, 'shell-comment');
});

test('tokens after multiline quotes and placeholders retain source lines', () => {
  const quoted = inline('impeccable embed-prompt image.png --prompt "hero\nphoto" --unknown');
  assert.deepEqual(quoted.references[0].options, [
    { name: '--prompt', form: 'separate', line: 1 },
    { name: '--unknown', form: 'separate', line: 2 },
  ]);
  assert.equal(quoted.diagnostics[0].line, 2);
  for (const text of [
    '`impeccable generate-image --ref <image📷\npath> --unknown`',
    '```sh\nimpeccable generate-image --ref <image📷\npath> --unknown\n```',
  ]) {
    const result = check(text);
    const firstLine = text.startsWith('```') ? 2 : 1;
    assert.deepEqual(result.references[0].options, [
      { name: '--ref', form: 'separate', line: firstLine },
      { name: '--unknown', form: 'separate', line: firstLine + 1 },
    ]);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].line, firstLine + 1);
    assert.match(result.diagnostics[0].message, /--unknown/);
  }
});

test('the authored corpus passes and includes the historic invocation and explicit template classifications', () => {
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : file.endsWith('.md') ? [file] : [];
  });
  const files = ['skill/SKILL.src.md', ...walk('skill/reference'), ...walk('skill/agents')];
  const result = checkDocuments(files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') })), contract);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.references.some((ref) => ref.file === 'skill/agents/impeccable-finish-reviewer.md' && ref.options.some((option) => option.name === '--check-seed')));
  assert.deepEqual(result.classifications.filter((item) => contract.templates.some((template) => item.file === template.file && item.text === template.text)).map((item) => [item.file, item.text]).sort(),
    contract.templates.map((item) => [item.file, item.text]).sort());
});

test('CLI checks the pin and exact tag identity offline, regardless of IMPECCABLE_BIN or HEAD', (t) => {
  const fixture = repository(t);
  const initial = fixture.run();
  assert.equal(initial.status, 0);
  assert.match(initial.stdout, /checked 1 references/);
  fixture.git('commit', '--quiet', '--allow-empty', '-m', 'Unreleased source');
  assert.equal(fixture.run().status, 0);
  fixture.git('tag', '-f', 'engine-v0.1.15');
  const moved = fixture.run();
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, /reviewed contract requires/);
  fixture.git('tag', '-d', 'engine-v0.1.15');
  const missing = fixture.run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing refs\/tags\/engine-v0\.1\.15/);
});

test('CLI fails malformed or unaudited pins before checking documents', (t) => {
  const fixture = repository(t);
  for (const [version, expected] of [['0.1.14', /no reviewed capability contract/], ['0.1.15;touch injected', /exact x\.y\.z/], ['../0.1.15', /exact x\.y\.z/]]) {
    fs.writeFileSync(path.join(fixture.directory, 'ENGINE_VERSION'), version);
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test('CLI rejects shell substitution without executing documentation', (t) => {
  const fixture = repository(t);
  const marker = path.join(fixture.directory, 'must-not-exist');
  fs.writeFileSync(path.join(fixture.directory, 'skill/SKILL.src.md'), '```sh\nimpeccable embed-prompt image.png --prompt "$(touch ' + marker + ')"\n```');
  const result = fixture.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /command substitution/);
  assert.equal(fs.existsSync(marker), false);
});
