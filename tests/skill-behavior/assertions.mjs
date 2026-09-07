import assert from 'node:assert/strict';

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
