/**
 * Provider-backed workflow contract tests. Unlike scenarios.test.mjs, these
 * assert the attended turns and writes that make init/redesign/refinement real.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  prepareWorkspace,
  cleanupWorkspace,
  runTurn,
  fileLoaded,
  summarizeTrace,
} from './harness.mjs';
import { detectProvider, getModel, hasKey, resolveModelList, PROVIDERS } from './providers.mjs';
import { PRODUCT_MD_SAMPLE, DESIGN_MD_SAMPLE } from './fixtures.mjs';

const LEGACY_DESIGN = `# Design

## Identity
BORING_BEIGE_CARDS. Quiet beige panels, timid scale, rounded cards everywhere.

## Color
Warm gray background with a muted tan accent.
`;

const EXISTING_PAGE = `<!doctype html>
<html><head><style>
:root { --legacy-beige: #e8e1d5; --legacy-tan: #a78969; }
body { background: var(--legacy-beige); color: #3c3833; font-family: Arial, sans-serif; }
.card { border: 1px solid #cfc5b6; border-radius: 18px; padding: 24px; }
</style></head><body>
<header data-untouched="header"><a href="/">Harbor Desk</a></header>
<main><section id="case-study" class="card"><h1>Harbor Desk</h1><p>Challenge. Approach. Outcome.</p><p>Image placeholder</p></section></main>
<footer data-untouched="footer">Operational since 1987</footer>
</body></html>`;

function firstCall(trace, predicate) {
  return trace.toolCalls.findIndex(predicate);
}

function firstWrite(trace, pattern) {
  return firstCall(trace, ({ name, input }) => name === 'write' && pattern.test(input?.path ?? ''));
}

function workflowTraceMessage(trace) {
  return JSON.stringify(summarizeTrace(trace), null, 2);
}

for (const modelId of resolveModelList()) {
  const provider = detectProvider(modelId);
  const keyPresent = hasKey(provider);

  describe(`skill workflow contract :: ${modelId}`, () => {
    if (!keyPresent) {
      it(`skipped — ${PROVIDERS[provider].envKey} is unset`, { skip: true }, () => {});
      return;
    }
    const model = getModel(modelId);

    it('fresh init asks, writes PRODUCT without Register, then establishes DESIGN', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable init for a harbor operations product, then finish setup.',
          maxSteps: 24,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const productWrite = firstWrite(trace, /(^|\/)PRODUCT\.md$/i);
        const designWrite = firstWrite(trace, /(^|\/)DESIGN\.md$/i);
        assert.ok(fileLoaded(trace, 'init.md'), `init.md was not loaded.\n${workflowTraceMessage(trace)}`);
        assert.ok(question >= 0, `structured user was never asked.\n${workflowTraceMessage(trace)}`);
        assert.ok(productWrite > question, `PRODUCT.md must follow a user answer.\n${workflowTraceMessage(trace)}`);
        assert.ok(designWrite > productWrite, `DESIGN.md must follow PRODUCT.md.\n${workflowTraceMessage(trace)}`);
        const product = fs.readFileSync(path.join(workspace, 'PRODUCT.md'), 'utf8');
        assert.doesNotMatch(product, /^## Register\s*$/im);
        assert.match(product, /ferry|dispatch|harbor/i, 'PRODUCT.md should incorporate the simulated user context');
        assert.ok(fs.existsSync(path.join(workspace, 'DESIGN.md')));
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('initialized craft asks for the task concept before implementation', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE, 'DESIGN.md': DESIGN_MD_SAMPLE },
      });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable craft a concise evidence-led case-study page. Leave it at index.html.',
          maxSteps: 22,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const implementation = firstWrite(trace, /\.(?:html?|astro|svelte|jsx?|tsx?)$/i);
        assert.ok(fileLoaded(trace, 'new-work.md'), `new-work.md was not loaded.\n${workflowTraceMessage(trace)}`);
        assert.ok(question >= 0, `task concept was never put to the user.\n${workflowTraceMessage(trace)}`);
        assert.ok(implementation > question, `implementation began before the attended concept checkpoint.\n${workflowTraceMessage(trace)}`);
        const artifact = fs.readFileSync(path.join(workspace, 'index.html'), 'utf8');
        assert.match(artifact.slice(0, 1400), /DIRECTION CONTRACT/i);
        for (const field of ['UNIQUE', 'NOT-TEMPLATE', 'OWN-WORLD', 'STORY', 'FIRST VIEWPORT', 'FORM']) {
          assert.match(artifact.slice(0, 1800), new RegExp(`${field}:`, 'i'));
        }
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('redesign replaces DESIGN before touching the existing page', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': LEGACY_DESIGN,
          'current.html': EXISTING_PAGE,
        },
      });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable craft redesign current.html for this product. Leave the result at current.html.',
          maxSteps: 26,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const designWrite = firstWrite(trace, /(^|\/)DESIGN\.md$/i);
        const implementation = firstWrite(trace, /(^|\/)current\.html$/i);
        assert.ok(fileLoaded(trace, 'init.md'), `redesign did not route through init.\n${workflowTraceMessage(trace)}`);
        assert.ok(question >= 0, `replacement world was not put to the user.\n${workflowTraceMessage(trace)}`);
        assert.ok(designWrite > question, `replacement DESIGN.md must follow user choice.\n${workflowTraceMessage(trace)}`);
        assert.ok(implementation > designWrite, `redesign touched the page before replacing DESIGN.md.\n${workflowTraceMessage(trace)}`);
        const design = fs.readFileSync(path.join(workspace, 'DESIGN.md'), 'utf8');
        assert.notEqual(design.trim(), LEGACY_DESIGN.trim(), 'redesign preserved the old visual world verbatim');
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('bolder refinement preserves the world and everything outside scope', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': DESIGN_MD_SAMPLE,
          'current.html': EXISTING_PAGE,
        },
      });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable bolder current.html, only the #case-study section. Keep everything else untouched.',
          maxSteps: 16,
        });
        const productWrite = firstWrite(trace, /(^|\/)PRODUCT\.md$/i);
        const designWrite = firstWrite(trace, /(^|\/)DESIGN\.md$/i);
        const implementation = firstWrite(trace, /(^|\/)current\.html$/i);
        assert.ok(fileLoaded(trace, 'bolder.md'), `bolder.md was not loaded.\n${workflowTraceMessage(trace)}`);
        assert.equal(productWrite, -1, `refinement rewrote PRODUCT.md.\n${workflowTraceMessage(trace)}`);
        assert.equal(designWrite, -1, `refinement rewrote DESIGN.md.\n${workflowTraceMessage(trace)}`);
        assert.ok(implementation >= 0, `refinement did not write current.html.\n${workflowTraceMessage(trace)}`);
        const artifact = fs.readFileSync(path.join(workspace, 'current.html'), 'utf8');
        assert.match(artifact, /data-untouched="header"/);
        assert.match(artifact, /data-untouched="footer"/);
        assert.match(artifact, /id="case-study"/);
      } finally {
        cleanupWorkspace(workspace);
      }
    });
  });
}
