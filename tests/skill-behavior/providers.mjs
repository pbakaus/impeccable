/**
 * Multi-provider model factory for the skill-behavior test harness.
 *
 * The lineup runs production-tier models on Anthropic and OpenAI
 * (claude-sonnet-4-6, gpt-5.5) so the suite reflects what users actually
 * run, not a cheap proxy. Google stays on gemini-3.1-flash-lite. Costlier
 * per run than the old cheap tier, but the pass/fail signal is more
 * representative of real agent behavior against the skill body.
 *
 * Anthropic and OpenAI use the Vercel AI SDK providers. Google uses
 * @ai-sdk/google for the same reason — uniform tool-use semantics across all
 * three keeps the harness tiny.
 *
 * .env is loaded from the repo root (copied from impeccable-evals). Tests
 * skip cleanly when the matching key is unset rather than failing CI.
 */
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

export const PROVIDERS = {
  anthropic: { envKey: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
  openai: { envKey: 'OPENAI_API_KEY', label: 'OpenAI' },
  google: { envKey: 'GOOGLE_CLOUD_API_KEY', label: 'Google' },
};

export function detectProvider(modelId) {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  throw new Error(`Unsupported model id: "${modelId}"`);
}

export function hasKey(provider) {
  const meta = PROVIDERS[provider];
  if (!meta) return false;
  return Boolean(process.env[meta.envKey]);
}

export function getModel(modelId) {
  const provider = detectProvider(modelId);
  if (provider === 'anthropic') return anthropic(modelId);
  if (provider === 'openai') return openai(modelId);
  if (provider === 'google') {
    // The @ai-sdk/google provider reads GOOGLE_GENERATIVE_AI_API_KEY by
    // default; the evals .env stores the same value under
    // GOOGLE_CLOUD_API_KEY. Mirror it so the SDK picks it up automatically.
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_CLOUD_API_KEY) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_CLOUD_API_KEY;
    }
    return google(modelId);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Default model lineup. Production-tier on Anthropic and OpenAI to match what
 * users actually run; gemini stays on the flash-lite tier. The test is about
 * routing/loading behavior, not design output quality.
 * Override with IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-foo,gpt-bar.
 */
export const DEFAULT_MODELS = ['claude-sonnet-4-6', 'gpt-5.5', 'gemini-3.1-flash-lite'];

export function resolveModelList() {
  const override = process.env.IMPECCABLE_SKILL_BEHAVIOR_MODELS;
  if (override && override.trim()) {
    return override.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_MODELS;
}
