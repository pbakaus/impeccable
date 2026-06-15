#!/usr/bin/env node
import { startQuestionnaireServer } from './server.mjs';

const args = process.argv.slice(2);
const prompt = readArg('--prompt') || args.filter((arg) => !arg.startsWith('--')).join(' ');
const targetPath = readArg('--target-path') || readArg('--targetPath') || null;
const port = Number(readArg('--port') || 0);

const handle = await startQuestionnaireServer({ cwd: process.cwd(), port });
const session = handle.runtime.createSession({
  command: 'init',
  prompt,
  targetPath,
});

console.log(JSON.stringify({
  ok: true,
  ...session,
  baseUrl: handle.baseUrl,
  pollUrl: `${handle.baseUrl}/poll?token=${encodeURIComponent(handle.token)}&sessionId=${encodeURIComponent(session.sessionId)}`,
  eventsUrl: `${handle.baseUrl}/events?token=${encodeURIComponent(handle.token)}&sessionId=${encodeURIComponent(session.sessionId)}`,
}, null, 2));

process.on('SIGINT', async () => {
  await handle.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await handle.stop();
  process.exit(0);
});

function readArg(name) {
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1] || '';
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : '';
}
