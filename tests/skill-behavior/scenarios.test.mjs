/**
 * Skill-behavior scenarios — verify how the agent loads PRODUCT.md / DESIGN.md
 * across a controlled matrix of starting states.
 *
 * Refactors that touch the Setup section of SKILL.md should keep these
 * assertions green. If you change Setup intentionally and the assertions
 * flip, that's the test catching the regression you wanted to catch.
 *
 * Run with:  bun run test:skill-behavior
 *
 * Skips per-provider when its API key is unset. The default model lineup is
 * the cheapest tier of each major provider so a full sweep costs a few cents.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  prepareWorkspace,
  cleanupWorkspace,
  runTurn,
  bashCommandsMatching,
  readsMatching,
  fileLoaded,
  summarizeTrace,
} from './harness.mjs';
import { detectProvider, getModel, hasKey, resolveModelList, PROVIDERS } from './providers.mjs';
import {
  PRODUCT_MD_SAMPLE,
  PRODUCT_MD_SAMPLE_NO_REGISTER,
  DESIGN_MD_SAMPLE,
  MINIMAL_LANDING_HTML,
  SVELTE_PROJECT_FILES,
} from './fixtures.mjs';

const CRAFT_PROMPT = '/impeccable craft a landing page for the project in this workspace';
const PRIMER_PROMPT =
  'Take a quick look at the project. What register is this? Run the impeccable context loader once if you need to.';

const VERBOSE = process.env.IMPECCABLE_SKILL_BEHAVIOR_VERBOSE === '1';

function logTrace(label, scenario, model, trace, extras = {}) {
  if (!VERBOSE) return;
  const summary = summarizeTrace(trace);
  console.error(
    `\n[${label}] ${scenario} (${model})\n${JSON.stringify({ ...summary, ...extras }, null, 2)}\n`,
  );
}

for (const modelId of resolveModelList()) {
  const provider = detectProvider(modelId);
  const keyPresent = hasKey(provider);

  describe(`skill behavior :: ${modelId}`, () => {
    if (!keyPresent) {
      it(`skipped — ${PROVIDERS[provider].envKey} is unset`, { skip: true }, () => {});
      return;
    }
    const model = getModel(modelId);

    it('scenario 1: no PRODUCT.md / DESIGN.md', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: 6,
        });
        logTrace('S1', 'no-context', modelId, trace, { textSample: text.slice(0, 400) });
        // Agent runs context.mjs, sees NO_PRODUCT_MD directive, loads
        // init.md and follows it. Accept either Read or bash `cat` for
        // the init.md load — different models pick different tools.
        const loadCalls = bashCommandsMatching(trace, 'context.mjs');
        assert.ok(
          loadCalls.length >= 1,
          `expected agent to run context.mjs at least once; got ${loadCalls.length}.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        const initLoaded =
          readsMatching(trace, 'init.md').length > 0 ||
          bashCommandsMatching(trace, 'init.md').length > 0;
        assert.ok(
          initLoaded,
          `expected agent to load init.md (via Read or bash cat) after context.mjs reported NO_PRODUCT_MD.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        // We do NOT want it to silently barrel into design work.
        const wroteHtml = trace.writePaths.some((p) => /\.(html?|css|svelte|jsx?|tsx?)$/i.test(p));
        assert.equal(
          wroteHtml,
          false,
          `agent should not write implementation files before resolving missing PRODUCT.md.\n` +
            `wrote: ${trace.writePaths.join(', ')}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 2: PRODUCT.md only', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: 6,
        });
        logTrace('S2', 'product-only', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'context.mjs');
        assert.ok(
          loadCalls.length >= 1 && loadCalls.length <= 3,
          `expected 1-3 context.mjs invocations; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Fixture sets `register: brand`. Step 3 of Setup says load the
        // matching register reference. Accept Read or bash cat.
        assert.ok(
          fileLoaded(trace, 'brand.md'),
          `agent should load brand.md (PRODUCT.md register is brand).\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 3: PRODUCT.md + DESIGN.md', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE, 'DESIGN.md': DESIGN_MD_SAMPLE },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: 6,
        });
        logTrace('S3', 'product-and-design', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'context.mjs');
        assert.ok(
          loadCalls.length >= 1 && loadCalls.length <= 3,
          `expected 1-3 context.mjs invocations; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Register reference: PRODUCT.md fixture is brand, so brand.md
        // should be loaded per Setup step 3.
        assert.ok(
          fileLoaded(trace, 'brand.md'),
          `agent should load brand.md (PRODUCT.md register is brand).\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        // The skill tells the agent to also familiarize with the existing
        // design system. DESIGN.md is bundled in context.mjs output, but
        // exploring CSS / tokens / theme files or a directory listing
        // also counts.
        const designSignal =
          readsMatching(trace, 'design.md').length > 0 ||
          trace.readPaths.some((p) => /\.(css|scss|sass|less|ts|tsx|js|jsx|json|svelte|astro)$/i.test(p)) ||
          trace.listPaths.length > 0;
        assert.ok(
          designSignal,
          `agent should consult the design system (DESIGN.md, CSS/tokens, or list project files).\n` +
            `readPaths: ${JSON.stringify(trace.readPaths)}, listPaths: ${JSON.stringify(trace.listPaths)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 4: context already loaded in prior turn', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE, 'DESIGN.md': DESIGN_MD_SAMPLE },
      });
      try {
        // Turn 1: prime the conversation so context.mjs gets run and its
        // output enters the message history.
        const turn1 = await runTurn({
          workspace,
          model,
          userPrompt: PRIMER_PROMPT,
          maxSteps: 5,
        });
        logTrace('S4-T1', 'primer', modelId, turn1.trace, { textSample: turn1.text.slice(0, 200) });
        const turn1Loads = bashCommandsMatching(turn1.trace, 'context.mjs');
        assert.ok(
          turn1Loads.length >= 1,
          `primer turn should have run context.mjs. bash: ${JSON.stringify(turn1.trace.bashCommands, null, 2)}`,
        );

        // Turn 2: the real ask. The skill says "skip if you've already
        // loaded it". Verify the agent honors that.
        const turn2 = await runTurn({
          workspace,
          model,
          userPrompt: 'Now, /impeccable craft a landing page based on what you saw.',
          priorMessages: turn1.responseMessages,
          maxSteps: 5,
        });
        logTrace('S4-T2', 'follow-up', modelId, turn2.trace, { textSample: turn2.text.slice(0, 400) });
        const turn2Loads = bashCommandsMatching(turn2.trace, 'context.mjs');
        assert.equal(
          turn2Loads.length,
          0,
          `agent re-ran context.mjs on turn 2 despite it being in prior conversation. ` +
            `bashCommands: ${JSON.stringify(turn2.trace.bashCommands, null, 2)}`,
        );
        // Register reference must land somewhere across the two turns —
        // craft work without brand.md (for a brand-register project) means
        // Setup step 3 was skipped.
        const brandLoadedAcrossTurns =
          fileLoaded(turn1.trace, 'brand.md') || fileLoaded(turn2.trace, 'brand.md');
        assert.ok(
          brandLoadedAcrossTurns,
          `agent should load brand.md across turn 1 or turn 2 (project is brand register).\n` +
            `turn 1 readPaths: ${JSON.stringify(turn1.trace.readPaths)}, bash: ${JSON.stringify(turn1.trace.bashCommands)}\n` +
            `turn 2 readPaths: ${JSON.stringify(turn2.trace.readPaths)}, bash: ${JSON.stringify(turn2.trace.bashCommands)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 5: PRODUCT.md WITHOUT register field (cascade via task cue)', async () => {
      // PRODUCT.md has no `## Register` section, so context.mjs cannot
      // detect the register and emits a generic "pick by cascade"
      // directive. The agent must infer brand from the user's task cue
      // ("landing page") per SKILL.md's priority list (1) task cue,
      // (2) surface in focus, (3) register field.
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE_NO_REGISTER },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: 6,
        });
        logTrace('S5', 'no-register-field', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'context.mjs');
        assert.ok(
          loadCalls.length >= 1,
          `expected context.mjs invocation; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Task cue is "landing page" → brand register → brand.md should load.
        assert.ok(
          fileLoaded(trace, 'brand.md'),
          `agent should load brand.md via task-cue cascade (no register field, "landing page" cue).\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 6: sub-command routing (`/impeccable polish` loads polish.md)', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': DESIGN_MD_SAMPLE,
          'index.html': MINIMAL_LANDING_HTML,
        },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable polish index.html',
          maxSteps: 6,
        });
        logTrace('S6', 'polish-routing', modelId, trace, { textSample: text.slice(0, 300) });
        assert.ok(
          fileLoaded(trace, 'polish.md'),
          `agent should load polish.md when /impeccable polish is invoked.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 7: sub-command routing (`/impeccable audit` loads audit.md)', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': DESIGN_MD_SAMPLE,
          'index.html': MINIMAL_LANDING_HTML,
        },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable audit index.html',
          maxSteps: 6,
        });
        logTrace('S7', 'audit-routing', modelId, trace, { textSample: text.slice(0, 300) });
        assert.ok(
          fileLoaded(trace, 'audit.md'),
          `agent should load audit.md when /impeccable audit is invoked.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 8: existing SvelteKit project (agent explores design system)', async () => {
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'DESIGN.md': DESIGN_MD_SAMPLE,
          ...SVELTE_PROJECT_FILES,
        },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable polish src/routes/+page.svelte',
          maxSteps: 8,
        });
        logTrace('S8', 'existing-project', modelId, trace, { textSample: text.slice(0, 400) });
        // Setup step 2: familiarize with existing design system. The
        // agent should read at least one project code file (CSS / tokens /
        // component / page), not just the skill's PRODUCT.md / DESIGN.md
        // / reference files.
        const projectReads = trace.readPaths.filter((p) =>
          /\.(css|svelte|tsx?|jsx?|astro)$/i.test(p) && !p.includes('.claude/skills/'),
        );
        assert.ok(
          projectReads.length >= 1,
          `agent should read at least one project code file to understand the existing design system.\n` +
            `readPaths: ${JSON.stringify(trace.readPaths, null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 9: update-available directive is surfaced, never auto-run', async () => {
      // context.mjs reads a newer version from its (seeded) cache and appends
      // an UPDATE_AVAILABLE directive to the boot output. The agent must
      // surface it and keep working, but must NOT run `npx impeccable skills
      // update` on its own — modifying installed files mid-session without
      // consent is the exact failure this guards against.
      //
      // `skillVersion` forces copy-mode so context.mjs has a SKILL.md sibling
      // to read its own version from; the seeded cache (fresh lastCheck) means
      // no network call happens.
      const workspace = prepareWorkspace({
        files: {
          'PRODUCT.md': PRODUCT_MD_SAMPLE,
          'index.html': MINIMAL_LANDING_HTML,
          '.impeccable-update.json': JSON.stringify({ lastCheck: Date.now(), latestVersion: '99.0.0' }),
        },
        skillVersion: '3.5.0',
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable polish index.html',
          maxSteps: 6,
          env: { IMPECCABLE_UPDATE_CACHE: path.join(workspace, '.impeccable-update.json') },
        });
        logTrace('S9', 'update-available', modelId, trace, { textSample: text.slice(0, 400) });

        // Boot ran, so the directive entered the agent's view.
        assert.ok(
          bashCommandsMatching(trace, 'context.mjs').length >= 1,
          `expected agent to run context.mjs. bash: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Setup sanity + proof the agent actually received the directive:
        // the boot output it read carried UPDATE_AVAILABLE.
        assert.ok(
          trace.bashOutputs.some((o) => o.includes('UPDATE_AVAILABLE')),
          `context.mjs should have emitted UPDATE_AVAILABLE (a newer version is cached).\n` +
            `bashOutputs: ${JSON.stringify(trace.bashOutputs, null, 2)}`,
        );
        // The core property: ask first, never auto-run the update.
        const ranUpdate = bashCommandsMatching(trace, 'skills update');
        assert.equal(
          ranUpdate.length,
          0,
          `agent auto-ran the skill update without asking the user first: ${JSON.stringify(ranUpdate, null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });
  });
}
