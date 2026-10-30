import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// IMPECCABLE_HOOK_SCOPE=ui: the POSIX launcher decides from the hook input,
// with shell builtins only, whether a hook event is interface work, and exits
// before starting the engine when it is not. A stub engine (IMPECCABLE_BIN)
// records whether it ran and the stdin it received.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null;

function setup(t, { design } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  if (design) {
    fs.mkdirSync(path.dirname(path.join(project, design)), { recursive: true });
    fs.writeFileSync(path.join(project, design), '# Design\n');
  }
  const launcher = path.join(root, 'impeccable');
  fs.copyFileSync(path.join(ROOT, 'skill/scripts/impeccable'), launcher);
  const seen = path.join(root, 'seen');
  const stub = path.join(root, 'engine');
  fs.writeFileSync(stub, `#!/bin/sh\ncat > "${seen.replaceAll('\\', '/')}"\n`, { mode: 0o755 });
  return { project, launcher, seen, stub };
}

function run(t, input, { scope = 'ui', design } = {}) {
  const { project, launcher, seen, stub } = setup(t, { design });
  const env = { ...process.env, IMPECCABLE_BIN: stub, CLAUDE_PROJECT_DIR: project };
  delete env.IMPECCABLE_HOOK_SCOPE;
  if (scope !== null) env.IMPECCABLE_HOOK_SCOPE = scope;
  const res = spawnSync(SH, [launcher, 'hook'], { cwd: project, env, input });
  assert.equal(res.status, 0, String(res.stderr));
  return fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8') : null;
}

const event = (name, extra = {}) => JSON.stringify({ session_id: 's', cwd: 'C:\\p', hook_event_name: name, ...extra });
const edit = (file) => event('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: file, new_string: 'a "q" \\ $HOME `x`' } });

test('without the setting every event reaches the engine', { skip: !SH }, (t) => {
  for (const input of [event('Stop'), event('SessionStart'), edit('/p/README.md')]) {
    assert.equal(run(t, input, { scope: null }), input);
  }
});

test('ui scope skips Stop and SessionStart outside a design project', { skip: !SH }, (t) => {
  assert.equal(run(t, event('Stop')), null);
  assert.equal(run(t, event('SessionStart')), null);
});

test('ui scope skips an edit to a file that is not markup, style or a component', { skip: !SH }, (t) => {
  assert.equal(run(t, edit('/p/README.md')), null);
  assert.equal(run(t, edit('/p/src/server.ts')), null);
  assert.equal(run(t, edit('C:\\p\\tools\\hook.js')), null);
});

test('ui scope passes a front-end edit on with its input unchanged', { skip: !SH }, (t) => {
  for (const file of ['/p/src/App.tsx', 'C:\\p\\site\\index.html', '/p/styles/main.scss', '/p/src/Card.vue']) {
    const input = edit(file);
    assert.equal(run(t, input), `${input}\n`);
  }
});

test('ui scope keeps every event in a design project', { skip: !SH }, (t) => {
  for (const design of ['DESIGN.md', 'PRODUCT.md', '.impeccable/config.json']) {
    assert.equal(run(t, event('Stop'), { design }), event('Stop'));
    assert.equal(run(t, edit('/p/src/server.ts'), { design }), edit('/p/src/server.ts'));
  }
});

test('ui scope passes on events it does not recognise', { skip: !SH }, (t) => {
  const grok = JSON.stringify({ hookEventName: 'stop', reason: 'end_turn' });
  assert.equal(run(t, grok), `${grok}\n`);
  const patch = event('PostToolUse', { tool_name: 'apply_patch', tool_input: { command: 'x' } });
  assert.equal(run(t, patch), `${patch}\n`);
});
