/**
 * Multi-provider model factory for the skill-behavior test harness.
 *
 * The default lineup stays on current, economical models so the entire
 * routing suite remains practical to run. Frontier quality is measured by
 * the sibling impeccable-evals harness; this suite measures skill protocol.
 *
 * Anthropic and OpenAI use the Vercel AI SDK providers. Google uses
 * @ai-sdk/google for the same reason — uniform tool-use semantics across all
 * three keeps the harness tiny.
 *
 * .env is loaded from the repo root (copied from impeccable-evals). Tests
 * skip cleanly when the matching key is unset rather than failing CI.
 */
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
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
  deepseek: { envKey: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
};

export function detectProvider(modelId) {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('deepseek-')) return 'deepseek';
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
  if (provider === 'deepseek') {
    // DeepSeek's official Claude Code integration exposes an Anthropic-
    // compatible endpoint authenticated with a Bearer token.
    const deepseek = createAnthropic({
      baseURL: 'https://api.deepseek.com/anthropic',
      authToken: process.env.DEEPSEEK_API_KEY,
      name: 'deepseek.anthropic',
    });
    return deepseek(modelId);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Per-model provider options, merged into generateText by the harness.
 *
 * gpt-5.6-terra is a reasoning model, and at the provider's default effort it
 * is not the tier this suite is meant to measure. Setup and routing behavior is
 * exactly the kind of multi-step instruction-following that reasoning effort
 * moves, so pin it high rather than inherit whatever the default happens to be.
 * Override with IMPECCABLE_SKILL_BEHAVIOR_EFFORT=xhigh.
 */
export function getProviderOptions(modelId) {
  let provider;
  try {
    provider = detectProvider(modelId);
  } catch {
    // Resolved from a live model object rather than the lineup, so an id this
    // module does not recognize is not an error; it just gets no options.
    return undefined;
  }
  if (provider === 'openai') {
    const effort = process.env.IMPECCABLE_SKILL_BEHAVIOR_EFFORT || 'high';
    return { openai: { reasoningEffort: effort } };
  }
  return undefined;
}

/**
 * Default model lineup. Frontier tiers only.
 *
 * gpt-5.6-luna and deepseek-v4-flash were dropped in 2026-08: below the
 * frontier tier, they fail scenarios for reasons that are model-floor behavior
 * rather than skill-text defects (stopping mid-run, archiving a report without
 * ever stating it), and a permanently red suite teaches everyone to ignore it.
 *
 * They stay selectable, and running a wider sweep deliberately is still worth
 * doing when Setup or routing text changes in a way that could go wrong in an
 * unfamiliar direction. Divergence between families is what surfaces the
 * non-obvious failures; the cheap tier just could not tell divergence from
 * its own floor:
 *   IMPECCABLE_SKILL_BEHAVIOR_MODELS=gpt-5.6-luna,deepseek-v4-flash
 */
export const DEFAULT_MODELS = ['claude-sonnet-5', 'gpt-5.6-terra', 'gemini-3.7-flash'];

export function resolveModelList() {
  const override = process.env.IMPECCABLE_SKILL_BEHAVIOR_MODELS;
  if (override && override.trim()) {
    return override.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_MODELS;
}
