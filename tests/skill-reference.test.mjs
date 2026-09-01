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

  it('uses an exact content fingerprint before inheriting a critique snapshot', () => {
    const critique = readFileSync(join(ROOT, 'skill/reference/critique.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const polish = readFileSync(join(ROOT, 'skill/reference/polish.md'), 'utf-8').replace(/\r\n?/g, '\n');

    assert.match(critique, /records an exact content fingerprint/);
    assert.match(polish, /compares the file's exact current content fingerprint/);
    assert.match(polish, /Unchanged staged, unstaged, or untracked content remains current/);
    assert.match(polish, /any byte change, deletion, or replacement with a non-file closes the backlog/);
    assert.match(polish, /latest "<resolved target>" --json/);
    assert.match(polish, /exact `snapshot_file` identity/);
    assert.match(polish, /close "<resolved target>" "<snapshot_file returned by latest>"/);
    assert.match(polish, /if a newer critique landed meanwhile, its backlog stays live/);
    assert.doesNotMatch(polish, /git status|git log/);
  });
});
