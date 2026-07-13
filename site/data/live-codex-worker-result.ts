export const liveCodexWorkerResult = {
  generatedAt: '2026-07-13T01:05:15.178Z',
  codexVersion: '0.144.0-alpha.4',
  transport: 'stdio JSONL',
  model: 'GPT-5.3-Codex-Spark',
  effort: 'low',
  timings: {
    coldHandshakeMs: 36.83,
    coldThreadStartMs: 400.19,
    turnStartResponseMs: 0.45,
    wakeToTurnStartedMs: 1.47,
    trivialTurnCompletedMs: 2060.18,
  },
  result: 'READY',
  passed: true,
  architecture: 'A dedicated persistent Live app-server connection and worker thread. Do not attach a second app-server to the desktop task.',
} as const;
