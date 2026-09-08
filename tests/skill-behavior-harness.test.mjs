import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { prepareWorkspace, cleanupWorkspace, makeTools, runTurn, fileLoaded, SKILL_BODY } from './skill-behavior/harness.mjs';
import { assertPlanningFallbackWarning, assertNewWorkLifecycle, assertWorkflowAdvice, assertCommandComparison, missingReferences } from './skill-behavior/assertions.mjs';
import { CASE_STUDY_ANSWER } from './skill-behavior/fixtures.mjs';
import { sourceHash as hashSources } from './skill-workflow/source-hash.mjs';
import { assertCompleted, assertFreshCaptures, assertNoChangeDocumentation, assertDocumentationArtifacts } from './skill-workflow/assertions.mjs';

it('documentation artifacts require tokens and the v2 sidecar independently of wrapper coverage', () => {
  const design = '---\ncolors:\n  ink: "#222"\ntypography:\n  body:\n    fontFamily: system-ui\n---\n## Overview\nA reading surface.\n';
  const sidecar = JSON.stringify({ schemaVersion: 2, extensions: { colorMeta: {} }, narrative: { northStar: 'Manual' } });
  assert.doesNotThrow(() => assertDocumentationArtifacts(design, sidecar));
  assert.throws(() => assertDocumentationArtifacts('## Colors\nInk: #222\n', sidecar), /frontmatter/);
  assert.throws(() => assertDocumentationArtifacts(design.replace('colors:', 'palette:'), sidecar), /color tokens/);
  assert.throws(() => assertDocumentationArtifacts(design.replace('typography:', 'type:'), sidecar), /typography tokens/);
  assert.throws(() => assertDocumentationArtifacts(design, ''), SyntaxError);
  assert.throws(() => assertDocumentationArtifacts(design, sidecar.replace('"schemaVersion":2', '"schemaVersion":1')), /v2 sidecar/);
  for (const key of ['extensions', 'narrative']) {
    for (const value of [undefined, {}, []]) {
      assert.throws(() => assertDocumentationArtifacts(design, JSON.stringify({ ...JSON.parse(sidecar), [key]: value })), /metadata/);
    }
  }
});

it('advice outcomes do not depend on opening every reference, but keep consent and prerequisite gates', () => {
  const trace = { toolCalls: [], writePaths: [], questionCalls: [], bashCommands: [] };
  const advice = 'For index.html, start with init to capture context and document to record the existing identity.';
  const comparison = 'Critique is an assessment. Polish makes fixes. Critique is optional; polish can run directly.';
  const check = (text, observation = trace) => assertCommandComparison(observation, text);
  assert.doesNotThrow(() => assertWorkflowAdvice(trace, advice, { missingContext: true }));
  assert.doesNotThrow(() => check(comparison));
  assert.doesNotThrow(() => check("Critique reviews the surface. Polish refines it. Critique isn't required before polish."));
  assert.doesNotThrow(() => check('Critique gives a report. Polish edits the surface independently, without a critique.'));
  assert.deepEqual(missingReferences(trace, ['reference/critique.md']), ['reference/critique.md']);
  for (const wrong of ['You must run critique before polish.', 'Critique is required before polish.', 'Polish requires a critique.']) {
    assert.throws(() => check(`${comparison} ${wrong}`), /invent a critique prerequisite/);
  }
  for (const wrong of ['You must run init before polishing.', 'You need to document before refinement.', 'Polish requires PRODUCT.md.']) {
    assert.throws(() => assertWorkflowAdvice(trace, `${advice} ${wrong}`, { missingContext: true }), /mandatory prerequisite/);
  }
  assert.throws(() => check(''), /advice must reach/);
  assert.throws(() => check('I loaded critique.md and polish.md.'), /explain critique/);
  for (const mutation of ['index.html', '.impeccable/critique/report.md']) {
    assert.throws(() => check(comparison, { ...trace, toolCalls: [{ mutatedPaths: [mutation] }] }), /must not edit/);
  }
  assert.throws(() => check(comparison, { ...trace, writePaths: ['DESIGN.md'] }), /write tool/);
  assert.throws(() => check(comparison, { ...trace, questionCalls: [{}] }), /interview/);
  assert.throws(() => check(comparison, { ...trace, bashCommands: ['impeccable detect index.html'] }), /menu scans/);
});

it('an unchanged documentation outcome needs real reads and a supported report, not a wrapper filename', () => {
  const files = ['reference/document.md', 'index.html', 'DESIGN.md'];
  const toolCalls = files.map((file) => ({ loadedFiles: [file] }));
  const result = { outcome: 'complete', trace: { toolCalls }, text: 'No changes: index.html matches DESIGN.md: system-ui, 65ch, #0645ad.' };
  const options = { target: 'index.html', evidence: [/system-ui/, /65ch/, /#0645ad/] };
  const check = (value) => assertNoChangeDocumentation(value, options);
  assert.doesNotThrow(() => check(result));
  assert.deepEqual(missingReferences(result.trace, ['degraded/documenter.md']), ['degraded/documenter.md']);
  for (const missing of files) {
    assert.throws(() => check({ ...result, trace: { toolCalls: toolCalls.filter((call) => !call.loadedFiles.includes(missing)) } }), /inspect the actual source/);
  }
  assert.throws(() => check({ ...result, trace: { toolCalls: [{ input: { path: 'reference/document.md' }, succeeded: false }] } }), /inspect the actual source/);
  assert.throws(() => check({ ...result, text: 'No changes: index.html matches DESIGN.md.' }), /report evidence/);
  assert.throws(() => check({ ...result, outcome: 'step-budget' }), /did not finish/);
  for (const file of ['DESIGN.md', '.impeccable/design.json', 'index.html']) {
    assert.throws(() => check({ ...result, trace: { toolCalls: [...toolCalls, { mutatedPaths: [file] }] } }), /must not mutate/);
  }
});

it('full workflows reject exhausted budgets and stale or absent visual evidence', () => {
  for (const outcome of ['checkpoint', 'step-budget', 'output-limit', 'error']) {
    assert.throws(() => assertCompleted({ outcome, steps: 50 }), /did not finish/);
  }
  assert.doesNotThrow(() => assertCompleted({ outcome: 'complete', steps: 12 }));
  const workspace = prepareWorkspace({ files: { 'index.html': '<h1>Test</h1>' } });
  try {
    const sourceHash = hashSources(workspace);
    const edit = { mutatedPaths: ['index.html'] };
    const shots = ['desktop', 'mobile'].map((viewport) => ({ capture: { target: 'index.html', viewport, sourceHash } }));
    const check = (toolCalls) => assertFreshCaptures({ toolCalls }, workspace, 'index.html');
    assert.doesNotThrow(() => check([edit, ...shots]));
    assert.throws(() => check([edit]), /missing desktop screenshot/);
    assert.throws(() => check([...shots, edit]), /missing desktop screenshot/);
    assert.throws(() => check([edit, shots[0]]), /missing mobile screenshot/);
    fs.writeFileSync(path.join(workspace, 'style.css'), 'h1 { color: red; }');
    assert.throws(() => check([edit, ...shots]), /missing desktop screenshot/);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('case-study user supplies evidence now instead of promising a future message', async () => {
  const workspace = prepareWorkspace();
  try {
    const { tools, trace } = makeTools(workspace, {}, { answer: () => CASE_STUDY_ANSWER });
    for (const question of ['What real customer proof do you have?', 'Please paste the promised details.']) {
      const result = JSON.parse(await tools.ask_user_question.execute({ questions: [{
        question, options: [{ label: 'I will paste real customer quotes in my next message' }],
      }] }));
      assert.equal(result.answers[question], CASE_STUDY_ANSWER);
      assert.match(result.answers[question], /clearly labeled synthetic case/);
    }
    assert.equal(trace.questionAnswers.length, 2);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('new-work requires approval and a brief before code, then documents the finished redesign', () => {
  const ask = { name: 'ask_user_question' };
  const brief = { name: 'bash', mutatedPaths: ['.impeccable/surfaces/current-html.md'] };
  const page = { name: 'write', mutatedPaths: ['current.html'] };
  const design = { name: 'write', mutatedPaths: ['DESIGN.md'] };
  const check = (toolCalls) => assertNewWorkLifecycle({ toolCalls }, { target: 'current.html', redesign: true });
  assert.doesNotThrow(() => check([ask, brief, page, design]));
  assert.doesNotThrow(() => check([ask, brief, page, design, page, design]));
  assert.throws(() => check([ask, brief]), /did not produce/);
  assert.throws(() => check([brief, page, ask, design]), /user answer/);
  assert.throws(() => check([ask, page, brief, design]), /surface brief before/);
  assert.throws(() => check([ask, brief, design, page]), /finished build/);
  assert.throws(() => check([ask, brief, page, design, page]), /finished build/);
});

it('stages resolved references independently of the source skill', async () => {
  const workspace = prepareWorkspace();
  try {
    const base = path.join(workspace, '.claude/skills/impeccable');
    assert.equal(fs.lstatSync(base).isSymbolicLink(), false);
    const { tools } = makeTools(workspace);
    const critique = await tools.read.execute({ path: '.claude/skills/impeccable/reference/critique.md' });
    assert.match(critique, /Use the ask_user_question tool\./);
    assert.doesNotMatch(critique, /\{\{ask_instruction\}\}|\{\{scripts_path\}\}|<codex>/);
    for (const role of ['finish-reviewer', 'documenter']) {
      const reference = await tools.read.execute({ path: `.claude/skills/impeccable/reference/degraded/${role}.md` });
      assert.match(reference, /This harness has no subagent capability/);
      assert.doesNotMatch(reference, /\{\{scripts_path\}\}|<codex>/);
    }
    const shellRead = await tools.bash.execute({ command: 'cat .claude/skills/impeccable/reference/critique.md' });
    assert.ok(shellRead.includes(critique), 'shell and read tools must see the same resolved reference');
    assert.match(await tools.write.execute({ path: '.claude/skills/impeccable/reference/critique.md', contents: 'bad' }), /^Error:/);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('reference-loading evidence requires content, not a failed read or a filename mention', async () => {
  const workspace = prepareWorkspace();
  try {
    const ref = '.claude/skills/impeccable/reference/polish.md';
    const denied = makeTools(workspace, {}, {}, { denyBash: true });
    await denied.tools.bash.execute({ command: `cat ${ref}` });
    assert.equal(fileLoaded(denied.trace, 'polish.md'), false);
    await denied.tools.read.execute({ path: 'missing/polish.md' });
    assert.equal(fileLoaded(denied.trace, 'polish.md'), false);
    const allowed = makeTools(workspace);
    await allowed.tools.bash.execute({ command: `printf '%s' '${ref}'` });
    assert.equal(fileLoaded(allowed.trace, 'polish.md'), false);
    await allowed.tools.bash.execute({ command: `cat ${ref}` });
    assert.equal(fileLoaded(allowed.trace, 'polish.md'), true);
    await denied.tools.read.execute({ path: ref });
    assert.equal(fileLoaded(denied.trace, 'polish.md'), true);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('headless behavior shells disable unattended decision pages and omit provider credentials', async () => {
  const workspace = prepareWorkspace();
  try {
    const { tools } = makeTools(workspace, { OPENAI_API_KEY: 'synthetic-secret', IMPECCABLE_QUESTION_DISABLED: '0' });
    const result = await tools.bash.execute({ command: 'node -e \'console.log(JSON.stringify({disabled:process.env.IMPECCABLE_QUESTION_DISABLED,hasKey:!!process.env.OPENAI_API_KEY}))\'' });
    assert.match(result, /"disabled":"1"/);
    assert.match(result, /"hasKey":false/);
    assert.doesNotMatch(result, /synthetic-secret/);
    if (process.env.IMPECCABLE_BIN) {
      const question = await tools.bash.execute({ command: '.claude/skills/impeccable/scripts/impeccable serve-question --start --payload nonexistent.json' });
      assert.match(question, /^exit=2\n/);
      assert.match(question, /use the structured question tool instead/);
      assert.equal(fs.existsSync(path.join(workspace, '.impeccable/questions')), false);
    }
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('planning fallback requires an assistant warning between the denial and context reads', () => {
  const call = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'context', toolName: 'bash', input: { command: '.claude/skills/impeccable/scripts/impeccable context' } }] };
  const denial = { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'context', toolName: 'bash', output: { type: 'text', value: 'Error: Bash permission denied by the host. This command was not executed.' } }] };
  const warning = { role: 'assistant', content: 'Context loading did not run because the launcher was denied.' };
  const read = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read', input: { path: 'PRODUCT.md' } }] };
  assert.doesNotThrow(() => assertPlanningFallbackWarning([call, denial, warning, read]));
  assert.doesNotThrow(() => assertPlanningFallbackWarning([call, denial, { role: 'assistant', content: [{ type: 'text', text: warning.content }, ...read.content] }]));
  for (const messages of [
    [call, denial, read], // Silent continuation.
    [call, denial, read, warning], // Final-only disclosure.
    [warning, call, denial, read], // Not a response to the actual denial.
    [call, denial, { ...warning, role: 'user' }, read],
    [call, { ...denial, content: [{ ...denial.content[0], toolCallId: 'unrelated' }] }, warning, read],
  ]) {
    assert.throws(() => assertPlanningFallbackWarning(messages), assert.AssertionError);
  }
});

it('DeepSeek gets an explicit output ceiling instead of the compatibility SDK default', async () => {
  const workspace = prepareWorkspace();
  try {
    for (const modelId of ['deepseek-v4-flash', 'claude-sonnet-5']) {
      const model = new MockLanguageModelV3({
        modelId,
        doGenerate: {
          content: [{ type: 'text', text: 'done' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      });
      await runTurn({ workspace, model, userPrompt: 'Test the harness.', maxSteps: 1 });
      const request = model.doGenerateCalls[0];
      assert.equal(request.maxOutputTokens, modelId.startsWith('deepseek-') ? 16_384 : undefined);
      assert.ok(request.prompt.some((message) => message.role === 'system' && message.content === SKILL_BODY));
    }
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('protocol checkpoints stop at successful evidence without claiming task completion', async () => {
  const workspace = prepareWorkspace();
  try {
    const model = new MockLanguageModelV3({ modelId: 'claude-sonnet-5', doGenerate: {
      content: [{ type: 'tool-call', toolCallId: 'load', toolName: 'read', input: JSON.stringify({ path: '.claude/skills/impeccable/reference/polish.md' }) }],
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [],
    } });
    const result = await runTurn({ workspace, model, userPrompt: 'Route only.', maxSteps: 10,
      stopAfter: (trace) => fileLoaded(trace, 'polish.md') });
    assert.equal(result.outcome, 'checkpoint');
    assert.equal(result.steps, 1);
    assert.equal(model.doGenerateCalls.length, 1);
    const exhausted = await runTurn({ workspace, model, userPrompt: 'Complete work.', maxSteps: 1 });
    assert.equal(exhausted.outcome, 'step-budget');
  } finally { cleanupWorkspace(workspace); }
});

it('protocol notice checkpoints observe intermediate assistant text', async () => {
  const workspace = prepareWorkspace();
  try {
    let calls = 0;
    const model = new MockLanguageModelV3({ doGenerate: async () => {
      calls++;
      return {
        content: [{ type: 'text', text: 'Impeccable version 99.0.0 is available; may I update it?' },
          { type: 'tool-call', toolCallId: 'list', toolName: 'list', input: '{}' }],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [],
      };
    } });
    const result = await runTurn({ workspace, model, userPrompt: 'Inspect this page.', maxSteps: 10,
      stopAfter: (trace) => trace.assistantTexts?.some((text) => text.includes('99.0.0')) });
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'checkpoint');
    assert.match(result.trace.assistantTexts[0], /may I update/);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('optional diagnostics retain tool evidence when a provider turn fails', async () => {
  const workspace = prepareWorkspace({ files: { 'PRODUCT.md': 'Synthetic product context.' } });
  const previous = process.env.IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR;
  const traceDir = path.join(workspace, 'diagnostics');
  process.env.IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR = traceDir;
  try {
    let calls = 0;
    const model = new MockLanguageModelV3({
      modelId: 'claude-sonnet-5',
      doGenerate: async () => {
        if (calls++ === 0) return {
          content: [{ type: 'tool-call', toolCallId: 'read-product', toolName: 'read', input: JSON.stringify({ path: 'PRODUCT.md' }) }],
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
        throw new Error('synthetic provider failure');
      },
    });
    await assert.rejects(runTurn({ workspace, model, userPrompt: 'Synthetic diagnostic test.' }), /synthetic provider failure/);
    const files = fs.readdirSync(traceDir);
    assert.equal(files.length, 1);
    const diagnostic = JSON.parse(fs.readFileSync(path.join(traceDir, files[0]), 'utf8'));
    assert.equal(diagnostic.status, 'failed');
    assert.match(diagnostic.error, /synthetic provider failure/);
    assert.equal(diagnostic.trace.toolCalls.length, 1);
    assert.equal(fileLoaded(diagnostic.trace, 'PRODUCT.md'), true);
  } finally {
    if (previous === undefined) delete process.env.IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR;
    else process.env.IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR = previous;
    cleanupWorkspace(workspace);
  }
});

it('loaded-skill metadata resolves to the staged launcher and readable references', async () => {
  const workspace = prepareWorkspace();
  try {
    const baseDir = SKILL_BODY.match(/^Base directory for this skill \(workspace-relative\): (.+)$/m)?.[1];
    assert.ok(baseDir, 'the host must supply the skill directory separately from its instructions');
    assert.ok(fs.statSync(path.join(workspace, baseDir, 'scripts/impeccable')).isFile());
    const { tools, trace } = makeTools(workspace, {}, {}, { denyBash: true });
    await tools.read.execute({ path: `${baseDir}/reference/polish.md` });
    await tools.read.execute({ path: `${baseDir}/reference/craft-floor.md` });
    assert.ok(trace.toolCalls.every((call) => call.succeeded));
    assert.ok(SKILL_BODY.includes('<skill-base-dir>/scripts/impeccable context'), 'metadata must not rewrite away the path-resolution behavior under test');
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('denied-launcher tools reject every shell attempt without executing or modifying the skill', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { denyBash: true });
    for (const command of [
      '.claude/skills/impeccable/scripts/impeccable context',
      '.claude/skills/impeccable/scripts/impeccable context; echo bad > index.html',
      'echo bad > index.html',
    ]) {
      assert.match(await tools.bash.execute({ command }), /permission denied/i);
    }
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'before');
    assert.ok(trace.toolCalls.every((call) => call.denied && call.mutatedPaths.length === 0));
    const skillPath = '.claude/skills/impeccable/reference/polish.md';
    const before = await tools.read.execute({ path: skillPath });
    assert.match(await tools.write.execute({ path: skillPath, contents: 'bad' }), /^Error:/);
    assert.equal(await tools.read.execute({ path: skillPath }), before);
    await tools.read.execute({ path: 'missing.md' });
    assert.deepEqual(trace.toolCalls.filter((call) => call.name === 'read').map((call) => call.succeeded), [true, true, false]);
    await tools.write.execute({ path: 'index.html', contents: 'after' });
    assert.deepEqual(trace.toolCalls.flatMap((call) => call.mutatedPaths), ['index.html']);
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('context-only routing tools reject shell searches and compound commands before execution', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    for (const command of [
      'find / -name routing.md',
      '.claude/skills/impeccable/scripts/impeccable context; echo bad > index.html',
      '.claude/skills/impeccable/scripts/impeccable context --target index.html; echo bad > index.html',
      '.claude/skills/impeccable/scripts/impeccable context --target "$(echo bad > index.html)"',
      '.claude/skills/impeccable/scripts/impeccable context --target=index.html; echo bad > index.html',
      '.claude/skills/impeccable/scripts/impeccable context --target="$(echo bad > index.html)"',
      'echo bad > index.html',
    ]) {
      assert.match(await tools.bash.execute({ command }), /^Error:/);
    }
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'before');
    assert.equal(trace.bashCommands.length, 7, 'rejected attempts remain observable');
    assert.ok(trace.toolCalls.every((call) => call.mutatedPaths.length === 0));
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('successful-loader controls accept a workspace-relative target', { skip: !process.env.IMPECCABLE_BIN }, async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': '<html></html>' } });
  try {
    const { tools } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    assert.match(await tools.bash.execute({ command: '.claude/skills/impeccable/scripts/impeccable context --target index.html' }), /^exit=0\n/);
    for (const separator of [' ', '=']) {
      for (const target of ['index.html', 'src/routes/+page.svelte', '"src/routes/+page.svelte"', '"my page.html"', "'my page.html'"]) {
        assert.match(await tools.bash.execute({ command: `.claude/skills/impeccable/scripts/impeccable context --target${separator}${target}` }), /^exit=0\n/);
      }
      assert.match(await tools.bash.execute({ command: `.claude/skills/impeccable/scripts/impeccable context --target${separator}../outside.html` }), /^Error:/);
    }
  } finally {
    cleanupWorkspace(workspace);
  }
});

it('workspace tools reject symlink escapes and preserve staged-skill write protection', async () => {
  const workspace = prepareWorkspace({ files: { 'local/value.txt': 'local' } });
  const outside = prepareWorkspace({ files: { 'value.txt': 'outside' } });
  try {
    fs.symlinkSync(outside, path.join(workspace, 'escape'), 'junction');
    fs.symlinkSync(path.join(workspace, 'local'), path.join(workspace, 'alias'), 'junction');
    fs.symlinkSync(path.join(workspace, '.claude'), path.join(workspace, 'skill-alias'), 'junction');
    const { tools } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    assert.match(await tools.read.execute({ path: 'escape/value.txt' }), /^Error:/);
    assert.match(await tools.list.execute({ path: 'escape' }), /^Error:/);
    assert.match(await tools.write.execute({ path: 'escape/new/file.txt', contents: 'bad' }), /^Error:/);
    assert.match(await tools.bash.execute({ command: '.claude/skills/impeccable/scripts/impeccable context --target escape/value.txt' }), /^Error:/);
    assert.match(await tools.write.execute({ path: 'skill-alias/skills/impeccable/reference/routing.md', contents: 'bad' }), /^Error:/);
    assert.equal(await tools.read.execute({ path: 'alias/value.txt' }), 'local');
    await tools.write.execute({ path: 'alias/nested/new.txt', contents: 'allowed' });
    assert.equal(fs.readFileSync(path.join(workspace, 'local/nested/new.txt'), 'utf8'), 'allowed');
    assert.equal(fs.existsSync(path.join(outside, 'new')), false);
    assert.equal(fs.readFileSync(path.join(outside, 'value.txt'), 'utf8'), 'outside');
  } finally {
    cleanupWorkspace(workspace);
    cleanupWorkspace(outside);
  }
});

it('context-only routing tools keep project writes observable but protect the staged skill', async () => {
  const workspace = prepareWorkspace({ files: { 'index.html': 'before' } });
  try {
    const { tools, trace } = makeTools(workspace, {}, {}, { contextOnlyBash: true });
    const skillPath = '.claude/skills/impeccable/reference/routing.md';
    const before = await tools.read.execute({ path: skillPath });
    assert.match(await tools.write.execute({ path: skillPath, contents: 'bad' }), /^Error:/);
    assert.equal(await tools.read.execute({ path: skillPath }), before);
    await tools.write.execute({ path: 'index.html', contents: 'after' });
    assert.equal(fs.readFileSync(path.join(workspace, 'index.html'), 'utf8'), 'after');
    assert.deepEqual(trace.writePaths, [skillPath, 'index.html']);
    assert.deepEqual(trace.toolCalls.flatMap((call) => call.mutatedPaths), ['index.html']);
  } finally {
    cleanupWorkspace(workspace);
  }
});
