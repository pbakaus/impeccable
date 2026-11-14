import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkTokenBudget } from '../scripts/lib/token-budget.js';
import { findEngineBinary } from './lib/engine-bin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'token-budget.json'), 'utf-8'));

function tree(files, budget) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-budget-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'token-budget.json'), JSON.stringify(budget));
  return dir;
}

describe('token budget', () => {
  it('holds for the skill as it stands', () => {
    const { errors } = checkTokenBudget(ROOT);
    assert.deepEqual(errors, []);
  });

  it('fails a file over its cap, a file with no cap, and a use over its cap', () => {
    const dir = tree(
      { 'skill/SKILL.src.md': '---\nname: x\n---\nbody', 'skill/reference/a.md': 'x'.repeat(200), 'skill/reference/new.md': 'y' },
      { files: { 'SKILL.src.md': 100, 'reference/a.md': 100 }, uses: { edit: { loads: ['SKILL.src.md', 'reference/a.md'], max: 150 } } },
    );
    try {
      const { errors } = checkTokenBudget(dir);
      assert.ok(errors.some((e) => e.startsWith('reference/a.md is 200 bytes')), errors.join('\n'));
      assert.ok(errors.some((e) => e.startsWith('reference/new.md (1 bytes) has no cap')), errors.join('\n'));
      assert.ok(errors.some((e) => e.startsWith('use "edit" loads 205 bytes')), errors.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const bin = findEngineBinary();
  it('keeps what the engine prints to the agent under its caps', { skip: bin ? false : 'no engine binary' }, () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-budget-project-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-budget-home-'));
    try {
      fs.mkdirSync(path.join(project, 'src'));
      fs.writeFileSync(path.join(project, 'PRODUCT.md'), '# Product\n\n<!-- impeccable:product-schema 2 -->\n\n## Platform\n\nweb\n\n## Users\n\nShop owners who check orders between customers.\n');
      fs.writeFileSync(path.join(project, 'DESIGN.md'), '---\nname: Ledger\ncolors:\n  ink: "#1a1a1a"\n---\n\n# Ledger\n\nQuiet paper and ink.\n');
      fs.writeFileSync(path.join(project, 'src', 'index.html'), '<main><h1>Orders</h1></main>\n');
      spawnSync('git', ['init', '-q'], { cwd: project });
      const env = {
        PATH: process.env.PATH, HOME: home, USERPROFILE: home, IMPECCABLE_SKILL_DIR: path.join(ROOT, 'skill'),
        IMPECCABLE_QUESTION_DISABLED: '1', CI: '1', IMPECCABLE_TELEMETRY_CHANNEL: 'test', IMPECCABLE_NO_TELEMETRY: '1',
        IMPECCABLE_NO_STALENESS_CHECK: '1', IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_CREDENTIAL_STORE: 'file',
      };
      const run = (args, input) => spawnSync(bin, args, { cwd: project, env, input, encoding: 'utf-8' });
      const bytes = (out) => Buffer.byteLength(out, 'utf8');
      const context = run(['context']);
      assert.equal(context.status, 0, context.stderr);
      assert.ok(bytes(context.stdout) <= BUDGET.cli.context, `context printed ${bytes(context.stdout)} bytes, over its ${BUDGET.cli.context}-byte cap:\n${context.stdout}`);
      const targeted = run(['context', '--target', 'src/index.html']);
      assert.equal(targeted.status, 0, targeted.stderr);
      assert.ok(bytes(targeted.stdout) <= BUDGET.cli['context-target'], `context --target printed ${bytes(targeted.stdout)} bytes, over its ${BUDGET.cli['context-target']}-byte cap:\n${targeted.stdout}`);
      const event = JSON.stringify({ session_id: 's', cwd: project, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 't1', tool_input: { file_path: path.join(project, 'src', 'index.html') } });
      const hook = run(['hook'], event);
      assert.ok(bytes(hook.stdout) > 0, 'the hook printed nothing for a clean edit');
      assert.ok(bytes(hook.stdout) <= BUDGET.cli['hook-clean'], `a clean hook pass printed ${bytes(hook.stdout)} bytes, over its ${BUDGET.cli['hook-clean']}-byte cap:\n${hook.stdout}`);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
