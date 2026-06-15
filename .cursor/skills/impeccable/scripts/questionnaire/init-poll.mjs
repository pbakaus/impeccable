#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getQuestionnaireServerPath } from './server.mjs';

const args = process.argv.slice(2);
const sessionId = readArg('--session-id') || readArg('--sessionId') || args.find((arg) => !arg.startsWith('--'));
const timeoutMs = Number(readArg('--timeout-ms') || readArg('--timeoutMs') || 600000);
const replyPath = readArg('--reply');
const redactImages = hasArg('--redact-images') || hasArg('--redactImages') || hasArg('--summary');
const serverInfo = JSON.parse(fs.readFileSync(getQuestionnaireServerPath(process.cwd()), 'utf-8'));

if (!sessionId) {
  console.error('Usage: init-poll.mjs --session-id <id> [--timeout-ms 600000] [--reply reply.json]');
  process.exit(2);
}

if (replyPath) {
  const reply = JSON.parse(fs.readFileSync(path.resolve(replyPath), 'utf-8'));
  const res = await fetch(`${serverInfo.baseUrl}/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: serverInfo.token,
      sessionId,
      ...reply,
    }),
  });
  const text = await res.text();
  process.stdout.write(text);
  process.exit(res.ok ? 0 : 1);
}

const url = new URL('/poll', serverInfo.baseUrl);
url.searchParams.set('token', serverInfo.token);
url.searchParams.set('sessionId', sessionId);
url.searchParams.set('timeoutMs', String(timeoutMs));
const res = await fetch(url);
const text = await res.text();
process.stdout.write(redactImages ? JSON.stringify(redactImagePayloads(JSON.parse(text))) : text);
process.exit(res.ok ? 0 : 1);

function readArg(name) {
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1] || '';
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : '';
}

function hasArg(name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function redactImagePayloads(value) {
  if (Array.isArray(value)) return value.map(redactImagePayloads);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'dataUrl' && typeof item === 'string' && item.startsWith('data:image/')) {
      next[key] = `[redacted:${Math.round(item.length / 1024)}kb-image-data-url]`;
    } else if (key === 'prompt' && typeof item === 'string' && item.length > 1000) {
      next[key] = `${item.slice(0, 1000)}... [truncated]`;
    } else {
      next[key] = redactImagePayloads(item);
    }
  }
  return next;
}
