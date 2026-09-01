import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('skill reference authoring contracts', () => {
  it('keeps direction contracts in development-only surface briefs', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const recordDecision = newWork.match(/## 5\. Record the decision\n([\s\S]*?)\n## 6\./)?.[1] ?? '';

    assert.match(recordDecision, /development-only contract/);
    assert.match(recordDecision, /under `## Direction contract` in the relevant surface brief/);
    assert.match(recordDecision, /read the brief once more/i);
    assert.match(recordDecision, /all six contract blocks and the seed key/);

    for (const block of ['THESIS', 'OWN-WORLD', 'STORY', 'FIRST VIEWPORT', 'FORM', 'FINISH']) {
      assert.match(recordDecision, new RegExp(`${block}:`));
    }

    for (const browserArtifact of [
      /HTML or framework comments/,
      /hidden DOM/,
      /<template>/,
      /`data-\*` attributes/,
      /serialized props or state/,
      /React Server Component payloads/,
      /client bundles/,
      /metadata or JSON-LD/,
      /accessibility-only text/,
    ]) {
      assert.match(recordDecision, browserArtifact);
    }

    assert.match(recordDecision, /Never copy the direction contract into implementation source or any browser-delivered artifact/);
    assert.doesNotMatch(newWork, /contract in the artifact's opening comment/);
    assert.doesNotMatch(newWork, /survives the production build/);
    assert.doesNotMatch(newWork, /grep the built output/);
    assert.doesNotMatch(newWork, /emitted markup/);
    assert.doesNotMatch(newWork, /first child of the document's body/);
  });

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

  it('finish capture forbids installing a Playwright browser and names the installed-browser fallback', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const inspectAndFinish = newWork.match(/## 7\. Inspect and finish\n([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';

    assert.match(inspectAndFinish, /native or browser-canvas screenshot path/);
    assert.match(inspectAndFinish, /Never run `npx playwright install`/);
    assert.match(inspectAndFinish, /installed Chrome, Chromium, or Edge/);
    assert.match(inspectAndFinish, /fail fast if none is present/);
    assert.match(inspectAndFinish, /leftover page from another process on the same localhost port/);
  });
});
