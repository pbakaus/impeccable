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
  ENGINE_BIN,
  ENGINE_MISSING_MESSAGE,
} from './harness.mjs';
import { detectProvider, getModel, hasKey, resolveModelList, PROVIDERS } from './providers.mjs';
import {
  PRODUCT_MD_SAMPLE,
  PRODUCT_MD_SAMPLE_NO_REGISTER,
  PRODUCT_MD_SAMPLE_IOS,
  MINIMAL_IOS_SOURCE,
  DESIGN_MD_SAMPLE,
  MINIMAL_LANDING_HTML,
  WORKFLOW_ADVICE_FILES,
  SVELTE_PROJECT_FILES,
} from './fixtures.mjs';

const CRAFT_PROMPT = '/impeccable craft a landing page for the project in this workspace';
const SHAPE_PROMPT = '/impeccable shape a landing page for the project in this workspace';
const NATURAL_BUILD_PROMPT = 'Build a landing page for the project in this workspace.';
const TEACH_PROMPT = '/impeccable teach';
const PRIMER_PROMPT =
  'Take a quick look at the project. What context should guide later design work? Run the impeccable context loader once if you need to.';

const VERBOSE = process.env.IMPECCABLE_SKILL_BEHAVIOR_VERBOSE === '1';

function logTrace(label, scenario, model, trace, extras = {}) {
  if (!VERBOSE) return;
  const summary = summarizeTrace(trace);
  console.error(
    `\n[${label}] ${scenario} (${model})\n${JSON.stringify({ ...summary, ...extras }, null, 2)}\n`,
  );
}

function loadedBeforeImplementationWrite(trace, filename) {
  const needle = filename.toLowerCase();
  const loadIndex = trace.toolCalls.findIndex(({ name, input }) => {
    if (name === 'read') return input?.path?.toLowerCase().includes(needle);
    if (name === 'bash') return input?.command?.toLowerCase().includes(needle);
    return false;
  });
  const writeIndex = trace.toolCalls.findIndex(
    ({ name, input }) => name === 'write' && /\.(html?|css|svelte|jsx?|tsx?)$/i.test(input?.path ?? ''),
  );
  return loadIndex >= 0 && (writeIndex < 0 || loadIndex < writeIndex);
}

function executedUpdateCommands(trace) {
  const executableSegments = trace.bashCommands.flatMap((command) =>
    command
      .split(/\r?\n|&&|\|\||;|\|/)
      .map((segment) => segment.trim())
      .filter((segment) => segment && !/^(?:#|echo\b|printf\b)/.test(segment)),
  );
  return executableSegments.filter((segment) =>
    /^(?:(?:npx|bunx|pnpx)\s+)?(?:impeccable|skills)\s+update\b/.test(segment),
  );
}

function assertAdviceOnly(trace, text) {
  assert.ok(text.trim(), 'advice must reach the user, not stop at reference loading');
  assert.deepEqual(trace.writePaths, [], 'advice must not use the write tool');
  const mutations = trace.toolCalls.flatMap((call) => call.mutatedPaths ?? [])
    .filter((file) => !file.startsWith('.impeccable/') || file.startsWith('.impeccable/critique/'));
  assert.deepEqual(mutations, [], 'advice must not edit project files or archive an unsolicited critique');
  assert.deepEqual(trace.questionCalls, [], 'advice must not start an init or design interview');
  assert.equal(bashCommandsMatching(trace, 'impeccable detect').length, 0, 'workflow advice does not run menu scans');
}

for (const modelId of resolveModelList()) {
  const provider = detectProvider(modelId);
  const keyPresent = hasKey(provider);

  describe(`skill behavior :: ${modelId}`, () => {
    if (!keyPresent) {
      it(`skipped — ${PROVIDERS[provider].envKey} is unset`, { skip: true }, () => {});
      return;
    }
    if (!ENGINE_BIN) {
      it(`skipped — ${ENGINE_MISSING_MESSAGE}`, { skip: true }, () => {});
      return;
    }
    const model = getModel(modelId);
    // Gemini Flash tends to inspect one file at a time, while the production
    // Anthropic/OpenAI models batch setup reads and then begin implementation.
    // Keep the latter tightly bounded so this routing suite does not turn into
    // a page-generation benchmark, but leave Gemini enough room to reach the
    // same required reference.
    const setupMaxSteps = provider === 'google' ? 6 : 3;

    it('scenario 1: no PRODUCT.md / DESIGN.md', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: setupMaxSteps,
        });
        logTrace('S1', 'no-context', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'impeccable context');
        assert.ok(
          loadCalls.length >= 1,
          `expected agent to run impeccable context at least once; got ${loadCalls.length}.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        assert.ok(
          fileLoaded(trace, 'init.md'),
          `craft should load init.md when no product or visual world exists; an automated harness is not a bypass.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        assert.ok(
          loadedBeforeImplementationWrite(trace, 'init.md'),
          `agent should resolve init before writing implementation files.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
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
          maxSteps: setupMaxSteps,
        });
        logTrace('S2', 'product-only', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'impeccable context');
        assert.ok(
          loadCalls.length >= 1 && loadCalls.length <= 3,
          `expected 1-3 impeccable context invocations; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        assert.ok(
          fileLoaded(trace, 'new-work.md'),
          `a greenfield request with PRODUCT.md should load new-work.md to establish the missing visual world.\n` +
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
          maxSteps: setupMaxSteps,
        });
        logTrace('S3', 'product-and-design', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'impeccable context');
        assert.ok(
          loadCalls.length >= 1 && loadCalls.length <= 3,
          `expected 1-3 impeccable context invocations; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        assert.ok(
          fileLoaded(trace, 'new-work.md'),
          `craft inside a committed PRODUCT.md + DESIGN.md world should load new-work.md for the task-specific concept.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        // The skill tells the agent to also familiarize with the existing
        // design system. DESIGN.md is bundled in impeccable context output, but
        // exploring CSS / tokens / theme files or a directory listing
        // also counts.
        const designSignal =
          readsMatching(trace, 'design.md').length > 0 ||
          trace.bashOutputs.some((output) => output.includes('# DESIGN.md')) ||
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
        // Turn 1: prime the conversation so impeccable context gets run and its
        // output enters the message history.
        const turn1 = await runTurn({
          workspace,
          model,
          userPrompt: PRIMER_PROMPT,
          maxSteps: setupMaxSteps,
        });
        logTrace('S4-T1', 'primer', modelId, turn1.trace, { textSample: turn1.text.slice(0, 200) });
        const turn1Loads = bashCommandsMatching(turn1.trace, 'impeccable context');
        assert.ok(
          turn1Loads.length >= 1,
          `primer turn should have run impeccable context. bash: ${JSON.stringify(turn1.trace.bashCommands, null, 2)}`,
        );

        // Turn 2: the real ask. The skill says "skip if you've already
        // loaded it". Verify the agent honors that.
        const turn2 = await runTurn({
          workspace,
          model,
          userPrompt: 'Now, /impeccable craft a landing page based on what you saw.',
          priorMessages: turn1.responseMessages,
          maxSteps: setupMaxSteps,
        });
        logTrace('S4-T2', 'follow-up', modelId, turn2.trace, { textSample: turn2.text.slice(0, 400) });
        const turn2Loads = bashCommandsMatching(turn2.trace, 'impeccable context');
        assert.equal(
          turn2Loads.length,
          0,
          `agent re-ran impeccable context on turn 2 despite it being in prior conversation. ` +
            `bashCommands: ${JSON.stringify(turn2.trace.bashCommands, null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 5: legacy PRODUCT.md enters new-work when DESIGN.md is missing', async () => {
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE_NO_REGISTER },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: CRAFT_PROMPT,
          maxSteps: setupMaxSteps,
        });
        logTrace('S5', 'legacy-product', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'impeccable context');
        assert.ok(
          loadCalls.length >= 1,
          `expected impeccable context invocation; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        assert.ok(fileLoaded(trace, 'new-work.md'),
          `greenfield craft should load new-work.md for visual authority and world discovery.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`);
        assert.equal(fileLoaded(trace, 'init.md'), false, 'existing PRODUCT.md must not re-enter init for missing DESIGN.md');
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
          maxSteps: setupMaxSteps,
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
          maxSteps: setupMaxSteps,
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
      // impeccable context reads a newer version from its (seeded) cache and appends
      // an UPDATE_AVAILABLE directive to the boot output. The agent must
      // surface it and keep working, but must NOT run `npx impeccable update`
      // on its own — modifying installed files mid-session without
      // consent is the exact failure this guards against.
      //
      // `skillVersion` forces copy-mode so impeccable context has a SKILL.md sibling
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
          maxSteps: setupMaxSteps,
          env: { IMPECCABLE_UPDATE_CACHE: path.join(workspace, '.impeccable-update.json') },
        });
        logTrace('S9', 'update-available', modelId, trace, { textSample: text.slice(0, 400) });

        // Boot ran, so the directive entered the agent's view.
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context. bash: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Setup sanity + proof the agent actually received the directive:
        // the boot output it read carried UPDATE_AVAILABLE.
        assert.ok(
          trace.bashOutputs.some((o) => o.includes('UPDATE_AVAILABLE')),
          `impeccable context should have emitted UPDATE_AVAILABLE (a newer version is cached).\n` +
            `bashOutputs: ${JSON.stringify(trace.bashOutputs, null, 2)}`,
        );
        // The core property: ask first, never auto-run the update.
        const ranUpdate = executedUpdateCommands(trace);
        assert.equal(
          ranUpdate.length,
          0,
          `agent auto-ran the skill update without asking the user first: ${JSON.stringify(ranUpdate, null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 10: scoped command with no PRODUCT.md proceeds without forcing init', async () => {
      // The counterpart to scenario 1. There, a from-scratch `craft` with no
      // context correctly diverts into init. Here a *scoped* command against
      // existing code must NOT: the code is the context. Missing PRODUCT.md is
      // a suggestion to run init, never a blocker on the requested work.
      const workspace = prepareWorkspace({
        files: {
          'index.html': MINIMAL_LANDING_HTML,
        },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable polish index.html',
          maxSteps: setupMaxSteps,
        });
        logTrace('S10', 'scoped-no-product', modelId, trace, { textSample: text.slice(0, 400) });
        // Boot still runs.
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context at least once.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        // It must load the scoped command's own reference and get on with it.
        assert.ok(
          fileLoaded(trace, 'polish.md'),
          `agent should load polish.md and proceed with the scoped command.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        // The core property: a scoped command on existing code must not divert
        // into init just because PRODUCT.md is absent.
        const initLoaded =
          readsMatching(trace, 'init.md').length > 0 ||
          bashCommandsMatching(trace, 'init.md').length > 0;
        assert.equal(
          initLoaded,
          false,
          `scoped /impeccable polish on existing code should not divert into init.md when PRODUCT.md is missing.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 11: shape with no PRODUCT.md resolves the build gate', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: SHAPE_PROMPT,
          maxSteps: setupMaxSteps,
        });
        logTrace('S11', 'shape-no-context', modelId, trace, { textSample: text.slice(0, 400) });
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context at least once.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        assert.ok(
          loadedBeforeImplementationWrite(trace, 'init.md'),
          `shape should resolve init.md before implementation when no world exists.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 12: intent-routed build with no PRODUCT.md resolves the build gate', async () => {
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: NATURAL_BUILD_PROMPT,
          maxSteps: setupMaxSteps,
        });
        logTrace('S12', 'natural-build-no-context', modelId, trace, { textSample: text.slice(0, 400) });
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context at least once.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        assert.ok(
          loadedBeforeImplementationWrite(trace, 'init.md'),
          `build intent should resolve init.md before implementation when no world exists.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 13: teach alias with no PRODUCT.md diverts into init', async () => {
      // `teach` is a deprecated alias for `init`, so it belongs to the same
      // missing-PRODUCT.md blocker path instead of the scoped-command path.
      const workspace = prepareWorkspace({ files: {} });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: TEACH_PROMPT,
          maxSteps: 6,
        });
        logTrace('S13', 'teach-no-context', modelId, trace, { textSample: text.slice(0, 400) });
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context at least once.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
        const initLoaded =
          readsMatching(trace, 'init.md').length > 0 ||
          bashCommandsMatching(trace, 'init.md').length > 0;
        assert.ok(
          initLoaded,
          `/impeccable teach should behave like init and load init.md when PRODUCT.md is missing.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 14: native iOS project (context loads ios.md)', async () => {
      // PRODUCT.md sets `## Platform` to `ios`. impeccable context now reads and emits
      // reference/ios.md itself, so native guidance enters the conversation
      // without relying on a second model-directed file read.
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE_IOS, 'TideDetailView.swift': MINIMAL_IOS_SOURCE },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable craft a tide detail screen for the project in this workspace',
          maxSteps: provider === 'google' ? 8 : 6,
        });
        logTrace('S14', 'native-ios', modelId, trace, { textSample: text.slice(0, 400) });
        const loadCalls = bashCommandsMatching(trace, 'impeccable context');
        assert.ok(
          loadCalls.length >= 1,
          `expected agent to run impeccable context at least once; got ${loadCalls.length}.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        // Proof the native reference itself entered the agent's view.
        assert.ok(
          trace.bashOutputs.some((o) => /# NATIVE PLATFORM REFERENCE: IOS \(reference\/ios\.md\)/.test(o)),
          `impeccable context should have emitted reference/ios.md content (platform is ios).\n` +
            `bashOutputs: ${JSON.stringify(trace.bashOutputs, null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 15: native audit routes to the native command variant', async () => {
      // The Commands table lists audit.native.md as the native variant and
      // Setup step 2 says to read the variant INSTEAD of audit.md when the
      // platform is native. This pins the route-instead behavior: a native
      // audit must reach audit.native.md (reading audit.md first and then
      // switching via its web-only guard is acceptable; never reaching the
      // variant is the failure).
      const workspace = prepareWorkspace({
        files: { 'PRODUCT.md': PRODUCT_MD_SAMPLE_IOS, 'TideDetailView.swift': MINIMAL_IOS_SOURCE },
      });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable audit the app in this workspace',
          maxSteps: 6,
        });
        logTrace('S15', 'native-audit-variant', modelId, trace, { textSample: text.slice(0, 400) });
        assert.ok(
          bashCommandsMatching(trace, 'impeccable context').length >= 1,
          `expected agent to run impeccable context at least once.\n` +
            `bashCommands: ${JSON.stringify(trace.bashCommands, null, 2)}`,
        );
        assert.ok(
          fileLoaded(trace, 'audit.native.md'),
          `agent should load audit.native.md (not just audit.md) when the platform is ios.\n` +
            `Trace: ${JSON.stringify(summarizeTrace(trace), null, 2)}`,
        );
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    for (const [label, files] of [
      ['existing project', WORKFLOW_ADVICE_FILES],
      ['missing product context', { 'index.html': MINIMAL_LANDING_HTML }],
    ]) {
      it(`scenario 16: workflow advice stays read-only (${label})`, async () => {
        const workspace = prepareWorkspace({ files });
        try {
          const { trace, text } = await runTurn({
            workspace,
            model,
            userPrompt: "I'm joining this project. Where should I start with Impeccable?",
            maxSteps: 8,
            contextOnlyBash: true,
          });
          logTrace('S16', label, modelId, trace, { textSample: text.slice(0, 300) });
          assert.ok(fileLoaded(trace, 'routing.md'), 'workflow advice loads the shared routing reference');
          assertAdviceOnly(trace, text);
        } finally {
          cleanupWorkspace(workspace);
        }
      });
    }

    it('scenario 17: command comparison reads references without running them', async () => {
      const workspace = prepareWorkspace({ files: WORKFLOW_ADVICE_FILES });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: 'Should I use critique or polish on index.html? Is a critique required before polishing?',
          maxSteps: 8,
          contextOnlyBash: true,
        });
        logTrace('S17', 'command-comparison', modelId, trace, { textSample: text.slice(0, 300) });
        assert.ok(fileLoaded(trace, 'routing.md'), 'a command name in a question still routes to advice');
        assert.ok(fileLoaded(trace, 'critique.md'), 'comparison consults the critique contract');
        assert.ok(fileLoaded(trace, 'polish.md'), 'comparison consults the polish contract');
        assertAdviceOnly(trace, text);
      } finally {
        cleanupWorkspace(workspace);
      }
    });

    it('scenario 18: explicit command request takes precedence over workflow advice', async () => {
      const workspace = prepareWorkspace({ files: WORKFLOW_ADVICE_FILES });
      try {
        const { trace, text } = await runTurn({
          workspace,
          model,
          userPrompt: '/impeccable polish index.html. Please do the polish pass now; afterward tell me which command would be useful next.',
          maxSteps: setupMaxSteps,
          contextOnlyBash: true,
        });
        logTrace('S18', 'explicit-command', modelId, trace, { textSample: text.slice(0, 300) });
        assert.ok(fileLoaded(trace, 'polish.md'), 'the requested command must not be replaced with advice');
      } finally {
        cleanupWorkspace(workspace);
      }
    });
  });
}
