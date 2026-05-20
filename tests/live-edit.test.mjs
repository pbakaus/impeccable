import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNewTextChars } from '../skill/scripts/live-edit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-edit.mjs');

describe('live-edit.mjs compatibility wrapper', () => {
  it('does not apply source edits directly anymore', () => {
    const stdout = execFileSync('node', [
      SCRIPT,
      '--id',
      'aaaaaaaa',
      '--ops',
      JSON.stringify([{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'A', newText: 'B' }]),
    ], { encoding: 'utf-8', cwd: REPO_ROOT });

    const result = JSON.parse(stdout.trim());
    assert.equal(result.requiresAgent, true);
    assert.equal(result.reason, 'manual_edit_requires_batched_ai_apply');
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.applied, []);
  });

  it('keeps plain-text staging validation shared with the live server', () => {
    assert.deepEqual(validateNewTextChars('Plain copy'), null);
    assert.deepEqual(validateNewTextChars('<strong>Copy</strong>'), ['<', '>']);
    assert.deepEqual(validateNewTextChars('Hello {name}`'), ['{', '}', '`']);
  });
});
