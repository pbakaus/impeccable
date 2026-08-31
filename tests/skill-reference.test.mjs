import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('skill reference authoring contracts', () => {
  it('keeps reduced-motion guidance on the animation build path', () => {
    const animate = readFileSync(join(ROOT, 'skill/reference/animate.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const accessibility = animate.match(/## Accessibility and control\n([\s\S]*?)\n## Verify/)?.[1] ?? '';
    const verify = animate.match(/## Verify\n([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';

    assert.match(accessibility, /prefers-reduced-motion/);
    assert.match(accessibility, /intentional alternative/);
    assert.match(accessibility, /not disabling all motion/);
    assert.match(verify, /reduced[- ]motion/i);
  });

  it('checks target-scoped working-tree changes before inheriting a critique snapshot', () => {
    const polish = readFileSync(join(ROOT, 'skill/reference/polish.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const statusCheck = polish.indexOf('git status --short --untracked-files=all ":(literal)<resolved target>"');
    const commitCheck = polish.indexOf('TZ=UTC git log -1');

    assert.ok(statusCheck >= 0, 'polish must inspect staged, unstaged, and untracked target changes');
    assert.ok(commitCheck > statusCheck, 'the working-tree check must run before the commit timestamp check');
    assert.match(polish, /treat it as newer than the snapshot, close the snapshot, and do not inherit/);
  });
});
