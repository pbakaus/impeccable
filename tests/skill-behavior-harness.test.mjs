import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareWorkspace, cleanupWorkspace, makeTools } from './skill-behavior/harness.mjs';

it('denied-launcher tools reject every shell attempt without executing or modifying the skill', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { denyBash: true });
    for (const command of [
      '.claude/skills/impeccable/scripts/impeccable context',
      '.claude/skills/impeccable/scripts/impeccable context; echo bad > index.html',
      'echo bad > index.html',
    ]) {
      assert.match(await tools.bash.execute({ command }), /permission denied/i);
    }
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'before');
    assert.ok(trace.toolCalls.every((call) => call.denied && call.mutatedPaths.length === 0));
    const skillPath = '.claude/skills/impeccable/reference/polish.md';
    const before = await tools.read.execute({ path: skillPath });
    assert.match(await tools.write.execute({ path: skillPath, contents: 'bad' }), /^Error:/);
    assert.equal(await tools.read.execute({ path: skillPath }), before);
    await tools.read.execute({ path: 'missing.md' });
    assert.deepEqual(trace.toolCalls.filter((call) => call.name === 'read').map((call) => call.succeeded), [true, true, false]);
    await tools.write.execute({ path: 'index.html', contents: 'after' });
    assert.deepEqual(trace.toolCalls.flatMap((call) => call.mutatedPaths), ['index.html']);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('context-only routing tools reject shell searches and compound commands before execution', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    for (const command of [
      'find / -name routing.md',
      '.claude/skills/impeccable/scripts/impeccable context; echo bad > index.html',
      'echo bad > index.html',
    ]) {
      assert.match(await tools.bash.execute({ command }), /^Error:/);
    }
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'before');
    assert.equal(trace.bashCommands.length, 3, 'rejected attempts remain observable');
    assert.ok(trace.toolCalls.every((call) => call.mutatedPaths.length === 0));
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('context-only routing tools keep project writes observable but protect the staged skill', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    const skillPath = '.claude/skills/impeccable/reference/routing.md';
    const before = await tools.read.execute({ path: skillPath });
    assert.match(await tools.write.execute({ path: skillPath, contents: 'bad' }), /^Error:/);
    assert.equal(await tools.read.execute({ path: skillPath }), before);
    await tools.write.execute({ path: 'index.html', contents: 'after' });
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'after');
    assert.deepEqual(trace.writePaths, [skillPath, 'index.html']);
    assert.deepEqual(trace.toolCalls.flatMap((call) => call.mutatedPaths), ['index.html']);
  } finally {
    cleanupWorkspace(workspace);
  }
});
