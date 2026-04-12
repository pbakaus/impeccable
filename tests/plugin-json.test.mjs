import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('plugin.json skills path ends with trailing slash', () => {
  const plugin = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
  assert.equal(plugin.skills, './.claude/skills/');
});
