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

// Deliberately broken enough that any honest critique lists three or more
// Priority Issues, so the run cannot reach the "fewer than 3" skip branch by
// merit. Low contrast, an icon-tile stack, a kicker over the heading, dead
// hierarchy, and a placeholder CTA.
const FLAWED_PAGE = `<!doctype html>
<html><head><style>
body { background:#f4f4f5; color:#b9b9c0; font-family: Arial, sans-serif; font-size:15px; }
h1, h2, h3, p { font-size:15px; font-weight:400; margin:8px 0; }
.tile { width:48px; height:48px; background:#e6e6ea; border-radius:12px; }
.card { border:1px solid #e6e6ea; border-radius:12px; padding:16px; }
</style></head><body>
<main>
  <p class="kicker">INTRODUCING</p>
  <h1>Harbor Desk</h1>
  <p>A platform that helps teams do more of what matters, faster.</p>
  <section class="card"><div class="tile"></div><h3>Lightning Fast</h3><p>Blazing performance.</p></section>
  <section class="card"><div class="tile"></div><h3>Rock Solid</h3><p>Enterprise grade.</p></section>
  <section class="card"><div class="tile"></div><h3>Fully Secure</h3><p>Bank level security.</p></section>
  <button style="background:#e6e6ea;color:#c9c9d0;border:none;padding:8px 12px">Learn More</button>
</main>
</body></html>`;

/**
 * Flatten assistant output into ordered parts.
 *
 * `generateText` only returns `text` for the FINAL step, which is empty when a
 * turn ends on a tool call. Reading the report out of that field silently tests
 * nothing. Walking responseMessages instead preserves emission order, which is
 * the point: critique's invariant is that report prose precedes the question
 * inside the message, since prose after a structured question is withheld until
 * the user answers.
 */
function assistantParts(responseMessages) {
  const parts = [];
  for (const message of responseMessages) {
    if (message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') {
      parts.push({ kind: 'text', value: content });
      continue;
    }
    for (const part of content ?? []) {
      if (part.type === 'text') parts.push({ kind: 'text', value: part.text ?? '' });
      else if (part.type === 'tool-call') parts.push({ kind: 'tool', value: part.toolName ?? '' });
    }
  }
  return parts;
}

function firstCall(trace, predicate) {
  return trace.toolCalls.findIndex(predicate);
}

function firstMutation(trace, pattern) {
  return firstCall(trace, ({ mutatedPaths = [] }) => mutatedPaths.some((file) => pattern.test(file)));
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

    it('fresh init asks and writes PRODUCT without inventing a visual system', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable init for a harbor operations product, then finish setup.',
          maxSteps: 24,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const productWrite = firstMutation(trace, /(^|\/)PRODUCT\.md$/i);
        assert.ok(fileLoaded(trace, 'init.md'), `init.md was not loaded.\n${workflowTraceMessage(trace)}`);
        assert.ok(question >= 0, `structured user was never asked.\n${workflowTraceMessage(trace)}`);
        assert.ok(productWrite > question, `PRODUCT.md must follow a user answer.\n${workflowTraceMessage(trace)}`);
        const product = fs.readFileSync(path.join(workspace, 'PRODUCT.md'), 'utf8');
        assert.doesNotMatch(product, /^## Register\s*$/im);
        assert.match(product, /ferry|dispatch|harbor/i, 'PRODUCT.md should incorporate the simulated user context');
        assert.equal(fs.existsSync(path.join(workspace, 'DESIGN.md')), false, 'init must not create DESIGN.md');
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('an initialized natural build request asks for the task concept before implementation', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE, 'DESIGN.md': DESIGN_MD_SAMPLE },
      });
      try {
        const { trace } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable create a concise evidence-led case-study page. Leave it at index.html.',
          maxSteps: 22,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const implementation = firstMutation(trace, /\.(?:html?|astro|svelte|jsx?|tsx?)$/i);
        assert.ok(fileLoaded(trace, 'new-work.md'), `new-work.md was not loaded.\n${workflowTraceMessage(trace)}`);
        assert.ok(question >= 0, `task concept was never put to the user.\n${workflowTraceMessage(trace)}`);
        assert.ok(implementation > question, `implementation began before the attended concept checkpoint.\n${workflowTraceMessage(trace)}`);
        assert.equal(fs.existsSync(path.join(workspace, 'index.html')), true, 'new-work must still produce the requested artifact');
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
          userPrompt: '/impeccable redesign current.html for this product. Leave the result at current.html.',
          maxSteps: 26,
        });
        const question = firstCall(trace, ({ name }) => name === 'ask_user_question');
        const designWrite = firstMutation(trace, /(^|\/)DESIGN\.md$/i);
        const implementation = firstMutation(trace, /(^|\/)current\.html$/i);
        assert.ok(fileLoaded(trace, 'new-work.md'), `redesign did not route through new-work.\n${workflowTraceMessage(trace)}`);
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
        const productWrite = firstMutation(trace, /(^|\/)PRODUCT\.md$/i);
        const designWrite = firstMutation(trace, /(^|\/)DESIGN\.md$/i);
        const implementation = firstMutation(trace, /(^|\/)current\.html$/i);
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

    // Regression guard for the failure mode that shipped in PR #576: the report
    // landed and the run then stopped, asking nothing and printing no skip
    // line. The close is the deliverable's other half, so a critique that ends
    // on the report is incomplete. Asserted on the trace rather than on prose
    // because the model's own account of why it skipped is not evidence.
    it('critique closes with the question or an explicit skip line', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': DESIGN_MD_SAMPLE,
          'current.html': FLAWED_PAGE,
        },
      });
      try {
        const { trace, responseMessages } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable critique current.html',
          maxSteps: 30,
        });
        assert.ok(fileLoaded(trace, 'critique.md'), `critique.md was not loaded.\n${workflowTraceMessage(trace)}`);

        const parts = assistantParts(responseMessages);
        const allText = parts.filter((p) => p.kind === 'text').map((p) => p.value).join('\n');
        const reportPattern = /priority issue|heuristic|design health/i;
        assert.match(allText, reportPattern, `no report reached the user.\n${workflowTraceMessage(trace)}`);

        const askIndex = parts.findIndex((p) => p.kind === 'tool' && p.value === 'ask_user_question');
        const skipped = /Questions skipped:/i.test(allText);
        assert.ok(
          askIndex >= 0 || skipped,
          `critique ended without the questions and without a "Questions skipped: <reason>" line.\n` +
            `This is the PR #576 regression: the report is not the finish, the close is.\n${workflowTraceMessage(trace)}`,
        );

        // The ordering invariant. Only meaningful when a question was actually
        // asked; a skip-line close has nothing to order against.
        if (askIndex >= 0) {
          const reportIndex = parts.findIndex((p) => p.kind === 'text' && reportPattern.test(p.value));
          assert.ok(
            reportIndex >= 0 && reportIndex < askIndex,
            `the question was emitted before the report text, so the report stays hidden until the user answers.\n` +
              `${workflowTraceMessage(trace)}`,
          );
        }
      } finally {
        cleanupWorkspace(workspace);
      }
    });
  });
}
