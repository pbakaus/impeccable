#!/usr/bin/env node
/**
 * DeepSeek-only Svelte live browser recorder.
 *
 * This intentionally refuses to fall back to fake/mock agents. It runs the
 * same browser recorder as record:live-ui-parity, forced through the DeepSeek
 * LLM provider, and saves artifacts under tmp/.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY is required for the DeepSeek Svelte recorder. Refusing to use a fake/mock AI.');
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'live-ui-parity-recorder.mjs');
const result = spawnSync(process.execPath, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    IMPECCABLE_PARITY_AGENT: 'llm',
    IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
    IMPECCABLE_PARITY_FIXTURE: 'vite8-sveltekit-stateful',
  },
});

process.exit(result.status ?? 1);
