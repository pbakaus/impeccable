import assert from 'node:assert/strict';

// These are bounded English-fixture checks, not a general semantic grader.
// Reference coverage is reported separately: opening a file proves neither
// useful advice nor permission to execute it.
export function missingReferences(trace, filenames) {
  return filenames.filter((filename) => !trace.toolCalls.some((call) =>
    (call.loadedFiles || []).some((file) => file === filename || file.endsWith(`/${filename}`))));
}

export function assertAdviceOnly(trace, text) {
  assert.ok(text.trim(), 'advice must reach the user, not stop at reference loading');
  assert.deepEqual(trace.writePaths, [], 'advice must not use the write tool');
  const mutations = trace.toolCalls.flatMap((call) => call.mutatedPaths ?? [])
    .filter((file) => !file.startsWith('.impeccable/') || file.startsWith('.impeccable/critique/'));
  assert.deepEqual(mutations, [], 'advice must not edit project files or archive an unsolicited critique');
  assert.deepEqual(trace.questionCalls, [], 'advice must not start an init or design interview');
  assert.ok(!trace.bashCommands.some((command) => command.includes('impeccable detect')), 'workflow advice does not run menu scans');
}

function normalizedAdvice(text) {
  return text.replace(/[`*_]/g, '').replace(/[’]/g, "'").toLowerCase();
}

export function assertWorkflowAdvice(trace, text, { missingContext = false } = {}) {
  assertAdviceOnly(trace, text);
  const advice = normalizedAdvice(text);
  assert.match(advice, /index\.html/, 'advice should address the existing surface');
  assert.match(advice, missingContext ? /\binit\b/ : /\b(?:critique|audit|polish)\b/, 'advice must recommend a relevant starting point');
  if (missingContext) assert.match(advice, /\bdocument\b/, 'advice should explain how to record the existing identity');
  assert.doesNotMatch(advice, /(?:must|need to|have to|required to)\s+(?:run\s+)?(?:\/impeccable\s+)?(?:init|document)\b[^.!?\n]{0,100}\bbefore\s+(?:you\s+can\s+)?(?:run(?:ning)?\s+)?(?:polish(?:ing)?|refin(?:e|ing|ement))\b|(?:polish|refinement)\s+(?:requires|is blocked by|cannot run without)\s+(?:init|document|product\.md|design\.md)/,
    'setup is not a mandatory prerequisite for narrow refinement');
}

export function assertCommandComparison(trace, text) {
  assertAdviceOnly(trace, text);
  const advice = normalizedAdvice(text);
  assert.match(advice, /critique[^.!?\n]{0,120}(?:review|assess|evaluat|report|findings)/, 'comparison must explain critique as assessment');
  assert.match(advice, /polish[^.!?\n]{0,120}(?:fix|refin|implement|edit)/, 'comparison must explain polish as implementation');
  assert.match(advice, /critique\s+(?:is\s+)?(?:isn't|is not|not)\s+(?:required|necessary)|critique[^.!?\n]{0,50}\boptional\b|polish[^.!?\n]{0,100}(?:directly|without\s+(?:a\s+)?critique|independent)/,
    'comparison must explain that critique is optional before polish');
  assert.doesNotMatch(advice, /(?:must|need to|have to)\s+(?:run\s+)?critique[^.!?\n]{0,80}before\s+(?:run(?:ning)?\s+)?polish|critique\s+(?:is\s+)?(?:required|mandatory|necessary)\s+before\s+polish|polish\s+(?:requires|cannot run without)\s+(?:a\s+)?critique/,
    'comparison must not invent a critique prerequisite');
}

export function assertNewWorkLifecycle(trace, { target, redesign = false }) {
  const calls = trace.toolCalls;
  const writes = (call, file) => (call.mutatedPaths || []).includes(file);
  const implementation = calls.findIndex((call) => writes(call, target));
  const question = calls.findIndex((call) => call.name === 'ask_user_question');
  const brief = calls.findIndex((call) => (call.mutatedPaths || []).some((file) => file.startsWith('.impeccable/surfaces/')));
  assert.ok(implementation >= 0, `new-work did not produce the requested artifact: ${target}`);
  assert.ok(question >= 0 && question < implementation, 'implementation must follow a user answer');
  assert.ok(brief >= 0 && brief < implementation, 'the direction contract must be recorded in a surface brief before implementation');
  if (redesign) {
    const lastImplementation = calls.findLastIndex((call) => writes(call, target));
    const documentation = calls.findLastIndex((call) => writes(call, 'DESIGN.md'));
    assert.ok(documentation > lastImplementation, 'redesign must record DESIGN.md from the finished build, after the last page edit');
  }
}

export const LAUNCHER_FAILURE_WARNING = /(?:context|launcher|bash)[^.!?\n]{0,160}(?:denied|refused|unavailable|blocked|could(?:n't| not)|cannot|can't|did(?:n't| not)|fail|unable)|(?:denied|refused|unavailable|blocked|could(?:n't| not)|cannot|can't|unable)[^.!?\n]{0,160}(?:context|launcher|bash)/i;

export function assertPlanningFallbackWarning(responseMessages) {
  const blocks = responseMessages.flatMap((message) =>
    (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content)
      .map((block) => ({ ...block, role: message.role })),
  );
  const contextCalls = new Set(blocks.filter((block) => block.role === 'assistant'
    && block.type === 'tool-call' && block.toolName === 'bash'
    && /impeccable\s+context\b/.test(block.input?.command ?? '')).map((block) => block.toolCallId));
  const denialIndex = blocks.findIndex((block) => block.role === 'tool'
    && block.type === 'tool-result' && contextCalls.has(block.toolCallId)
    && block.output?.type === 'text' && /Bash permission denied by the host/.test(block.output.value));
  assert.ok(denialIndex >= 0, 'must observe the context launcher denial in the response sequence');
  const warningIndex = blocks.findIndex((block, index) => index > denialIndex
    && block.role === 'assistant' && block.type === 'text' && LAUNCHER_FAILURE_WARNING.test(block.text));
  const contextReadIndex = blocks.findIndex((block, index) => index > denialIndex
    && block.role === 'assistant' && block.type === 'tool-call' && block.toolName === 'read'
    && /(?:^|\/)(?:PRODUCT|DESIGN)\.md$/.test(block.input?.path ?? ''));
  assert.ok(warningIndex > denialIndex && contextReadIndex > warningIndex,
    'planning fallback must warn after denial and before reading project context, not only in the final response');
}
