#!/usr/bin/env node
/**
 * Mark an AI-applied copy-edit handoff complete.
 *
 * The AI agent runs this after it has manually updated source files. It clears
 * only the pending buffer ops represented by the handoff, avoiding the discard
 * path so applied edits are not reported as thrown away.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countByPage, readBuffer, writeBuffer } from './live-manual-edits-buffer.mjs';
import { getManualEditHandoffPath } from './live-manual-edit-handoff.mjs';

function argVal(args, name) {
  const prefix = name + '=';
  for (const arg of args) {
    if (arg === name) return true;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function fatal(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

export function completeManualEditHandoff({
  cwd = process.cwd(),
  handoffId,
  completedAt = new Date().toISOString(),
} = {}) {
  if (!handoffId || !/^[0-9a-f]{8,32}$/i.test(handoffId)) {
    throw new Error('missing_or_invalid_handoff_id');
  }

  const handoffPath = getManualEditHandoffPath(cwd, handoffId);
  if (!fs.existsSync(handoffPath)) {
    throw new Error('handoff_not_found');
  }

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf-8'));
  const targets = new Map();
  for (const op of handoff.ops || []) {
    if (!op.pageUrl || !op.ref) continue;
    const key = op.pageUrl;
    if (!targets.has(key)) targets.set(key, new Set());
    targets.get(key).add(op.ref);
  }

  const buffer = readBuffer(cwd);
  let removed = 0;
  for (const entry of buffer.entries) {
    const refs = targets.get(entry.pageUrl);
    if (!refs) continue;
    const before = entry.ops.length;
    entry.ops = entry.ops.filter((op) => !refs.has(op.ref));
    removed += before - entry.ops.length;
  }
  buffer.entries = buffer.entries.filter((entry) => entry.ops.length > 0);
  writeBuffer(cwd, buffer);

  const completed = {
    ...handoff,
    completedAt,
    removedOps: removed,
  };
  fs.writeFileSync(handoffPath, JSON.stringify(completed, null, 2));

  const { totalCount, perPage } = countByPage(cwd);
  return {
    ok: true,
    handoffId,
    handoffPath: path.relative(cwd, handoffPath),
    removed,
    totalCount,
    perPage,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node live-complete-manual-edits.mjs --handoff-id=<id>');
    process.exit(0);
  }
  try {
    const result = completeManualEditHandoff({
      cwd: process.cwd(),
      handoffId: argVal(args, '--handoff-id'),
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    fatal(err.message || String(err));
  }
}

const _running = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (_running === fileURLToPath(import.meta.url)) {
  main();
}
