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
});
