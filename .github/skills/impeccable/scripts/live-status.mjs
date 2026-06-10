#!/usr/bin/env node
/**
 * Print durable recovery status for Impeccable live sessions.
 */

import { createLiveSessionStore } from './live/session-store.mjs';
import { readLiveServerInfo, samePath } from './lib/impeccable-paths.mjs';
import { manualApplyResumeHint } from './live-resume.mjs';
import { chdirToLiveTarget } from './live-target.mjs';

function readServerInfo() {
  const record = readLiveServerInfo(process.cwd());
  if (record?.ambiguous) return { ambiguous: true, candidates: record.candidates || [] };
  return record?.info || null;
}

async function fetchServerStatus(info) {
  if (!info) return null;
  try {
    const res = await fetch(`http://localhost:${info.port}/status?token=${info.token}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function statusCli() {
  const liveTarget = chdirToLiveTarget(process.argv.slice(2));
  if (!liveTarget.targetPath) chdirToSingleDiscoveredProjectRoot();
  const info = readServerInfo();
  const ambiguous = info?.ambiguous ? info : null;
  const server = ambiguous ? null : await fetchServerStatus(info);
  const store = createLiveSessionStore({ cwd: process.cwd() });
  const activeSessions = store.listActiveSessions();
  const manualApply = findPendingManualApply(server, activeSessions);
  const payload = {
    liveServer: server ? {
      status: server.status,
      port: server.port,
      connectedClients: server.connectedClients,
      agentPolling: server.agentPolling,
      pendingEvents: server.pendingEvents,
    } : ambiguous ? { ambiguous: true, candidates: ambiguous.candidates } : null,
    activeSessions: server?.activeSessions || activeSessions,
    recoveryHint: manualApply
      ? manualApplyResumeHint(manualApply)
      : server
        ? 'Run live-poll.mjs to continue pending work, or live-complete.mjs --id <session> after manual cleanup.'
        : ambiguous
          ? 'Multiple child live servers found. Re-run with --target <path>.'
          : 'Start live-server.mjs to requeue pending durable events, then run live-poll.mjs.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

function findPendingManualApply(server, activeSessions) {
  const fromServer = server?.pendingEvents?.find((event) => event?.type === 'manual_edit_apply');
  if (fromServer) return fromServer;
  const fromSession = activeSessions
    ?.map((session) => session.pendingEvent)
    .find((event) => event?.type === 'manual_edit_apply');
  return fromSession || null;
}

function chdirToSingleDiscoveredProjectRoot() {
  const record = readLiveServerInfo(process.cwd());
  if (!record?.info?.projectRoot) return;
  if (!samePath(record.info.projectRoot, process.cwd())) process.chdir(record.info.projectRoot);
}

const _running = process.argv[1];
if (_running?.endsWith('live-status.mjs') || _running?.endsWith('live-status.mjs/')) {
  statusCli();
}
