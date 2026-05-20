#!/usr/bin/env node
/**
 * Compatibility helper for the retired deterministic copy-edit applier.
 *
 * Live copy edits are now applied by the batched AI apply path, not by this
 * script. The server still imports validateNewTextChars() from here for
 * browser-side staging validation, and older callers get a clear JSON response
 * instead of a silent source mutation.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reject characters that would land in source as markup, template delimiters,
// or template-string punctuation. The browser edit flow is plain-text only; to
// insert markup the user asks the AI to edit source directly.
const FORBIDDEN_NEWTEXT_CHARS = ['<', '>', '{', '}', '`'];

export function validateNewTextChars(newText) {
  if (typeof newText !== 'string') return null;
  const hits = FORBIDDEN_NEWTEXT_CHARS.filter((char) => newText.includes(char));
  return hits.length > 0 ? hits : null;
}

export async function editCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node live-edit.mjs --ops <json-array>');
    console.log('Manual copy edits are staged and then applied by live-commit-manual-edits.mjs.');
    process.exit(0);
  }

  console.log(JSON.stringify({
    ok: true,
    requiresAgent: true,
    reason: 'manual_edit_requires_batched_ai_apply',
    files: [],
    applied: [],
    failed: [],
    message: 'Manual copy edits are staged and AI-applied as a batch. Run live-commit-manual-edits.mjs.',
  }));
}

const _running = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (_running === fileURLToPath(import.meta.url)) {
  editCli();
}
