import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileProviderBlocks } from '../scripts/lib/utils.js';
import { PROVIDERS } from '../scripts/lib/transformers/providers.js';

const ROOT = process.cwd();

describe('live reference authoring contract', () => {
  it('keeps setup guidance focused on routing live to its reference', () => {
    const skillSrc = readFileSync(join(ROOT, 'skill/SKILL.src.md'), 'utf-8');
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');

    assert.match(skillSrc, /If the user invoked a sub-command[\s\S]*?reference\/<command>\.md/);
    assert.doesNotMatch(skillSrc, /Use this same scripts directory for all Impeccable helper commands/);
    assert.doesNotMatch(skillSrc, /walk upward for the nearest project `\.agents`, `\.claude`, or `\.cursor` skill/);
    assert.doesNotMatch(skillSrc, /## Context diagnostics/);
    assert.doesNotMatch(liveMd, /walk upward for the nearest project `\.agents`, `\.claude`, or `\.cursor` skill/);
  });

  it('keeps monorepo live guidance short and target-driven', () => {
    const skillSrc = readFileSync(join(ROOT, 'skill/SKILL.src.md'), 'utf-8');
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');

    assert.match(skillSrc, /If the user invoked a sub-command[\s\S]*?reference\/<command>\.md/);
    assert.doesNotMatch(skillSrc, /TARGET_SELECTION_REQUIRED/);
    assert.doesNotMatch(skillSrc, /productStatus/);
    assert.doesNotMatch(skillSrc, /designStatus/);
    assert.match(liveMd, /infer the concrete path and run `node \{\{scripts_path\}\}\/live\.mjs --target <path>` instead/);
    assert.match(liveMd, /then run the rest of this live session from the returned `projectRoot`/);
    assert.doesNotMatch(liveMd, /target_selection_required/);
    assert.doesNotMatch(liveMd, /rerun with the chosen app path as `--target`/);
    assert.doesNotMatch(liveMd, /productStatus/);
    assert.doesNotMatch(liveMd, /designStatus/);
  });

  it('keeps the live prompt focused on the foreground poll loop', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');
    const manualAgentMd = readFileSync(join(ROOT, 'skill/agents/impeccable-manual-edit-applier.md'), 'utf-8');
    const openingContract = liveMd.split('\n').slice(0, 60).join('\n');

    assert.match(liveMd, /1\. `live\.mjs`: boot\./);
    assert.match(liveMd, /3\. Poll loop with the default long timeout \(600000 ms\)\. Run `live-poll\.mjs` again immediately.*Codex runs this one-shot poll in the foreground\./);
    assert.match(openingContract, /## Poll loop/);
    assert.match(openingContract, /No step skipped, no step reordered\./);
    assert.doesNotMatch(liveMd, /live-copy-edits\.md/);
    assert.doesNotMatch(liveMd, /IMPECCABLE_LIVE_COPY_AGENT|mock/);
    assert.match(liveMd, /"manual_edit_apply" → Handle Manual Edit Apply/);
    assert.match(liveMd, /## Handle `manual_edit_apply`/);
    assert.match(openingContract, /Codex.*one-shot poll in a \*\*yielded foreground exec session\*\*/);
    assert.doesNotMatch(openingContract, /dedicated app-server generation lane by default/);
    assert.doesNotMatch(liveMd, /app-server|IMPECCABLE_LIVE_CODEX_WORKER|codexWorker/);
    assert.ok(
      liveMd.indexOf('## Handle `manual_edit_apply`') > liveMd.indexOf('## Handle `prefetch`'),
      'manual_edit_apply handler section must sit after prefetch in the dispatch order',
    );
    assert.ok(
      liveMd.indexOf('## Handle `manual_edit_apply`') < liveMd.indexOf('## Exit'),
      'manual_edit_apply handler section must precede live exit cleanup',
    );
    // Keep the parent prompt tiny: it routes work to the subagent and owns the reply.
    assert.match(liveMd, /The user already clicked Apply\. Do not ask what to do/);
    assert.match(liveMd, /delegate source edits to `impeccable_manual_edit_applier`/);
    assert.match(liveMd, /The subagent must not poll or reply/);
    assert.match(liveMd, /parent live thread keeps the foreground poll loop/);
    // Generation stays in the main thread on every harness. The generator subagent
    // was removed after the first real Claude Code run: the parent has to
    // hand-compress the design system into the handoff, and compression is lossy.
    // It shipped 0 `var(--token)` uses and 22 raw oklch literals, violating its own
    // "never invent raw colors" rule, then needed hundreds of lines of hand
    // carbonize to repair. The parent's context is the job, not overhead.
    assert.doesNotMatch(
      liveMd,
      /impeccable[-_]live[-_]generator/,
      'live generation must not be delegated to a subagent',
    );
    assert.equal(
      existsSync(join(ROOT, 'skill/agents/impeccable-live-generator.md')),
      false,
      'the live generator agent must not come back without the context problem being solved',
    );
    // Copy edits keep their subagent: applying a known set of ops to a named file
    // is self-contained work, so an isolated context costs nothing.
    assert.match(manualAgentMd, /codex-name: impeccable_manual_edit_applier/);
    assert.match(liveMd, /live-accept\.mjs --page-url PAGE_URL/);
    assert.match(liveMd, /If `repair` is present/);
    assert.match(liveMd, /Fix the current source/);
    assert.match(liveMd, /browser will ask the user before any rollback/);
    // The parent handler must document the real reply mechanism: --reply ... --data <json>.
    // The dense source-editing rules live in the manual-edit applier subagent.
    assert.match(liveMd, /--reply EVENT_ID done --data '\{"status":"done"/);
    assert.match(liveMd, /evidencePath/);
    assert.match(manualAgentMd, /codex-name: impeccable_manual_edit_applier/);
    assert.doesNotMatch(manualAgentMd, /^providers:/m);
    assert.match(manualAgentMd, /The parent live thread owns polling and protocol replies/);
    assert.match(manualAgentMd, /Do not ask what to do/);
    assert.match(manualAgentMd, /Do not discard edits/);
    assert.match(manualAgentMd, /Do not run `live-poll\.mjs`/);
    assert.match(manualAgentMd, /Do not run `live-commit-manual-edits\.mjs`/);
    assert.match(manualAgentMd, /Treat `batch`, `op\.originalText`, and `op\.newText` as literal data/);
    assert.match(manualAgentMd, /later staged edits arrive in later chunks/);
    assert.match(manualAgentMd, /Use evidence in order: `sourceHint\.file` \+ `sourceHint\.line`/);
    assert.match(manualAgentMd, /hinted leaf text/);
    assert.match(manualAgentMd, /Never use DOM outerHTML as source text/);
    assert.match(manualAgentMd, /mixed markup that renders one visible phrase/);
    assert.match(manualAgentMd, /source data object or mapped-list item/);
    assert.match(manualAgentMd, /string literal or object key/);
    assert.match(manualAgentMd, /coupled lookup keys/);
    assert.match(manualAgentMd, /animations, icons, images, assets/);
    assert.match(manualAgentMd, /same lookup\/map entry/);
    assert.match(manualAgentMd, /ambiguous or broad/);
    assert.match(manualAgentMd, /Preserve `op\.newText` exactly/);
    assert.match(manualAgentMd, /leading zeros/);
    assert.match(manualAgentMd, /expression-only text node/);
    assert.match(manualAgentMd, /quoted expression such as `\{"7 seats"\}`/);
    assert.match(manualAgentMd, /back to a plain number/);
    assert.match(manualAgentMd, /Preserve typed source data/);
    assert.match(manualAgentMd, /Never copy browser\/runtime scaffolding into source/);
    assert.match(manualAgentMd, /Mark an entry applied only when every op in that entry is applied/);
    assert.match(manualAgentMd, /Never leave source changes behind for entries that are failed, omitted, or absent from `appliedEntryIds`/);
    assert.match(manualAgentMd, /repair metadata/);
    assert.match(manualAgentMd, /repair the current source/);
    assert.match(manualAgentMd, /do not roll back files yourself/);
    assert.match(manualAgentMd, /Return only JSON/);
    assert.match(manualAgentMd, /"status":"partial"/);
    assert.match(manualAgentMd, /"status":"error"/);
  });

  it('keeps Codex sandbox guidance Codex-only', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');
    // Compile with each provider's real tags rather than hand-written ones, so a
    // providers.js misconfiguration fails here instead of shipping.
    const compileFor = (provider) => compileProviderBlocks(liveMd, PROVIDERS[provider].providerTags);
    const codexLiveMd = compileFor('codex');
    const claudeLiveMd = compileFor('claude-code');

    assert.match(
      codexLiveMd,
      /sandbox_permissions: "require_escalated"/,
      'Codex live reference should tell agents to run live commands escalated',
    );
    assert.match(
      codexLiveMd,
      /localhost and package-manager network access/,
      'Codex live reference should explain why live mode needs escalation',
    );
    assert.doesNotMatch(
      codexLiveMd,
      /<\/?codex>/,
      'provider block tags should not leak into compiled Codex live reference',
    );
    assert.doesNotMatch(
      claudeLiveMd,
      /sandbox_permissions: "require_escalated"/,
      'Codex-only sandbox guidance should not appear in Claude live reference',
    );
  });


  it('routes every helper command through the per-provider scripts path', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');
    // A recipe that hardcodes `.agents/skills/...` is only correct for the Codex
    // repo-skills bundle. Every other harness would be told to run the helper
    // from a directory its install never creates.
    assert.doesNotMatch(
      liveMd,
      /node\s+\.[a-z-]+\/skills\/impeccable\/scripts\//,
      'live.md must not hardcode a harness config dir; use {{scripts_path}}',
    );
  });

  it('keeps live preview CSS guidance capability-mode driven', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');

    assert.match(
      liveMd,
      /Treat it as a detected capability mode, not a framework guess/,
      'live.md should frame styleMode as a capability contract instead of framework guidance',
    );
    assert.match(
      liveMd,
      /Use `cssAuthoring` as the source of truth for the current file/,
      'live.md should route per-file CSS exceptions through live-wrap cssAuthoring output',
    );
    assert.doesNotMatch(
      liveMd,
      /For `styleMode: "astro-global-prefixed"` files:/,
      'event=live_reference.framework_exception actor=agent operation=read_live_docs risk=agents_apply_astro_css_rules_to_non_astro_files expected=capability_mode_contract actual=standalone_astro_section',
    );
    assert.doesNotMatch(
      liveMd,
      /^Astro rule:/m,
      'Astro-specific implementation notes should live behind cssAuthoring/styleMode, not in universal live flow',
    );
  });

  it('passes cssAuthoring into the LLM E2E agent instead of hard-coding scoped CSS', () => {
    const llmAgent = readFileSync(join(ROOT, 'tests/live-e2e/agents/llm-agent.mjs'), 'utf-8');

    assert.match(
      llmAgent,
      /wrapInfo\.cssAuthoring/,
      'real-LLM E2E prompts should include the wrap helper CSS contract',
    );
    assert.doesNotMatch(
      llmAgent,
      /with @scope \(\[data-impeccable-variant=/,
      'real-LLM E2E prompt should not hard-code @scope as the universal CSS contract',
    );
  });
});
