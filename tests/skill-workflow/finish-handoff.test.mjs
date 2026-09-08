import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareWorkspace, cleanupWorkspace, runTurn, fileLoaded, ENGINE_BIN } from '../skill-behavior/harness.mjs';
import { getModel, detectProvider, hasKey } from '../skill-behavior/providers.mjs';
import { assertCompleted, assertNoChangeDocumentation } from './assertions.mjs';
import { missingReferences } from '../skill-behavior/assertions.mjs';

// A synthetic post-review checkpoint, not another full-build simulation.
// The page and system agree. A missing sidecar predates this task and is not
// permission to repair drift or rewrite the incumbent DESIGN.md.
const DESIGN = `# Field Manual

## Overview
An established, plain reading surface. Preserve this identity.

## Colors
White background (#ffffff), near-black text (#222222), blue links (#0645ad).

## Typography
System-ui body at 16px, line-height 1.6. Headings at 24px, weight 700.

## Layout
One column, max-width 65ch, padding 24px; no decorative containers.
`;
const PAGE = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Keyboard guide</title><style>body{background:#fff;color:#222;font:16px/1.6 system-ui;max-width:65ch;margin:auto;padding:24px}h1{font-size:24px;font-weight:700}a{color:#0645ad}</style><main><h1>Keyboard guide</h1><p>Use Tab to move between controls. Press Enter to activate a link.</p><a href="#top" id="top">Back to top</a></main></html>';
const BRIEF = '# Keyboard guide\n\n## Direction contract\nTHESIS: A short reading page.\nOWN-WORLD: Inherit Field Manual.\nSTORY: Read keyboard instructions.\nFIRST VIEWPORT: Title, paragraph, link.\nFORM: Direct, precisely specified page; no seed required.\nFINISH: unreviewed and undocumented is unfinished.\n';

for (const modelId of (process.env.IMPECCABLE_SKILL_BEHAVIOR_MODELS || 'claude-sonnet-5').split(',').map((id) => id.trim()).filter(Boolean)) {
  for (const existingSystem of [true, false]) {
    it(`post-review ${existingSystem ? 'extension preserves' : 'new world records'} its system :: ${modelId}`,
      { skip: !ENGINE_BIN || !hasKey(detectProvider(modelId)) }, async (t) => {
        const files = {
          'PRODUCT.md': '# Field Manual\n\n## Platform\nweb\n\nA reference guide for keyboard users.\n',
          ...(existingSystem ? { 'DESIGN.md': DESIGN } : {}),
          'index.html': PAGE,
          '.impeccable/surfaces/index-html.md': BRIEF,
        };
        const workspace = prepareWorkspace({ files });
        try {
          const reference = fs.readFileSync(path.join(workspace, '.claude/skills/impeccable/reference/new-work.md'), 'utf8');
          const result = await runTurn({
            workspace, model: getModel(modelId), maxSteps: 12, timeoutMs: 180000, contextOnlyBash: true,
            environment: 'This is a resumed post-review checkpoint. No subagent or browser tools are available. The review is closed; no further UI edits or screenshots are needed. Read/list/write tools are available.',
            priorMessages: [
              { role: 'user', content: existingSystem
                ? 'Use /impeccable to add the specified keyboard guide page inside the established Field Manual world. Keep the existing visual system. Do not repair unrelated project drift.'
                : 'Use /impeccable to create Field Manual’s first keyboard guide page. The chosen identity is plain, single-column, system fonts, white background and blue links.' },
              { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'load-new-work', toolName: 'read', input: { path: '.claude/skills/impeccable/reference/new-work.md' } }] },
              { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'load-new-work', toolName: 'read', output: { type: 'text', value: reference } }] },
              { role: 'assistant', content: `Checkpoint: context and PRODUCT.md were loaded. The user confirmed the exact page and identity. The surface brief and index.html are written. Desktop/mobile captures were validated, the detector ran once, and the shipped finish reviewer returned ship with no open findings. ${existingSystem
                ? 'DESIGN.md was loaded. No durable system changes were requested or introduced. The pre-existing missing .impeccable/design.json was reported but not repaired.'
                : 'This is the first completed surface of the approved new world. No DESIGN.md or design sidecar exists yet.'}` },
            ],
            userPrompt: 'Continue from this checkpoint and finish the task.',
          });
          assertCompleted(result);
          t.diagnostic(`Documentation wrapper coverage gaps (non-blocking for evidenced no-op): ${missingReferences(result.trace, ['degraded/documenter.md']).join(', ') || 'none'}`);
          assert.ok(fileLoaded(result.trace, 'reference/document.md'), 'must consult the documentation contract');
          for (const name of existingSystem ? ['index.html', 'DESIGN.md'] : ['index.html']) {
            assert.ok(fileLoaded(result.trace, name), `documentation must check ${name}, not merely announce a no-op`);
          }
          for (const [name, contents] of Object.entries(files)) {
            assert.equal(fs.readFileSync(path.join(workspace, name), 'utf8'), contents, `${name} must remain unchanged`);
          }
          if (existingSystem) {
            assertNoChangeDocumentation(result, { target: 'index.html', evidence: [/system-ui/i, /65\s*ch/i, /#0645ad/i] });
            assert.equal(fs.existsSync(path.join(workspace, '.impeccable/design.json')), false, 'must not repair pre-existing sidecar drift unasked');
            assert.deepEqual(result.trace.toolCalls.flatMap((call) => call.mutatedPaths || []), [], 'a no-change check must not mutate other project files');
          } else {
            assert.ok(fileLoaded(result.trace, 'degraded/documenter.md'), 'new-world documentation must run the shipped documentation pass');
            const design = fs.readFileSync(path.join(workspace, 'DESIGN.md'), 'utf8');
            assert.match(design, /^---\n/);
            assert.match(design, /^colors:/m);
            assert.match(design, /system-ui/);
            const sidecar = JSON.parse(fs.readFileSync(path.join(workspace, '.impeccable/design.json'), 'utf8'));
            assert.equal(sidecar.schemaVersion, 2);
            assert.ok(sidecar.extensions && sidecar.narrative);
          }
        } finally {
          cleanupWorkspace(workspace);
        }
      });
  }
}
