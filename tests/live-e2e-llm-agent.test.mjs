import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLlmAgent,
  parseVariantResponse,
  resolveLlmAgentConfig,
} from './live-e2e/agents/llm-agent.mjs';

describe('live-e2e LLM agent provider config', () => {
  it('defaults to Anthropic and Claude Haiku when no keys are present', () => {
    const config = resolveLlmAgentConfig({}, {});

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-haiku-4-5');
    assert.equal(config.requiredEnv, 'ANTHROPIC_API_KEY');
    assert.equal(config.apiKey, undefined);
    assert.equal(config.baseURL, undefined);
  });

  it('prefers Anthropic when both provider keys are present', () => {
    const config = resolveLlmAgentConfig({}, {
      ANTHROPIC_API_KEY: 'claude-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-haiku-4-5');
    assert.equal(config.requiredEnv, 'ANTHROPIC_API_KEY');
    assert.equal(config.apiKey, 'claude-key');
    assert.equal(config.baseURL, undefined);
  });

  it('falls back to DeepSeek V4 Flash when only DEEPSEEK_API_KEY is present', () => {
    const config = resolveLlmAgentConfig({}, {
      DEEPSEEK_API_KEY: 'test-key',
    });

    assert.equal(config.provider, 'deepseek');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.requiredEnv, 'DEEPSEEK_API_KEY');
    assert.equal(config.apiKey, 'test-key');
    assert.equal(config.baseURL, 'https://api.deepseek.com/anthropic');
  });

  it('explicitly selects DeepSeek over Anthropic', () => {
    const config = resolveLlmAgentConfig({}, {
      IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
      ANTHROPIC_API_KEY: 'claude-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    assert.equal(config.provider, 'deepseek');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.requiredEnv, 'DEEPSEEK_API_KEY');
    assert.equal(config.apiKey, 'deepseek-key');
    assert.equal(config.baseURL, 'https://api.deepseek.com/anthropic');
  });

  it('allows explicit model and base URL overrides', () => {
    const config = resolveLlmAgentConfig(
      { model: 'custom-model', baseURL: 'https://example.test/anthropic' },
      {
        IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
        IMPECCABLE_E2E_LLM_MODEL: 'ignored-model',
        DEEPSEEK_API_KEY: 'test-key',
      },
    );

    assert.equal(config.model, 'custom-model');
    assert.equal(config.baseURL, 'https://example.test/anthropic');
  });

  it('allows the DeepSeek API base URL to come from env', () => {
    const config = resolveLlmAgentConfig({}, {
      IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_API_BASE_URL: 'https://proxy.example.test/anthropic',
    });

    assert.equal(config.baseURL, 'https://proxy.example.test/anthropic');
  });

  it('rejects unsupported providers', () => {
    assert.throws(
      () => resolveLlmAgentConfig({}, { IMPECCABLE_E2E_LLM_PROVIDER: 'other' }),
      /Unsupported IMPECCABLE_E2E_LLM_PROVIDER: other/,
    );
  });
});

describe('live-e2e LLM agent createLlmAgent', () => {
  it('uses an explicit opts.config without re-reading env', async () => {
    const agent = await createLlmAgent({
      config: {
        provider: 'anthropic',
        model: 'test-model',
        apiKey: 'test-key',
        baseURL: undefined,
        requiredEnv: 'ANTHROPIC_API_KEY',
      },
    });
    assert.ok(agent, 'agent should be returned when config.apiKey is set');
    assert.equal(typeof agent.generateVariants, 'function');
  });

  it('returns null when the resolved config has no apiKey', async () => {
    const agent = await createLlmAgent({
      config: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        apiKey: undefined,
        baseURL: 'https://api.deepseek.com/anthropic',
        requiredEnv: 'DEEPSEEK_API_KEY',
      },
    });
    assert.equal(agent, null);
  });
});

describe('live-e2e LLM agent parseVariantResponse', () => {
  const validParsed = {
    scopedCss: '@scope ([data-impeccable-variant="1"]) {}',
    variants: [{ innerHtml: '<h1 class="hero-title">Title</h1>' }],
  };

  it('parses a well-formed response', () => {
    const parsed = parseVariantResponse(JSON.stringify(validParsed));
    assert.deepEqual(parsed, validParsed);
  });

  it('strips a single surrounding ```json fence', () => {
    const parsed = parseVariantResponse(
      '```json\n' + JSON.stringify(validParsed) + '\n```',
    );
    assert.deepEqual(parsed, validParsed);
  });

  it('echoes the raw payload (first 500 chars) on JSON-parse failure', () => {
    assert.throws(
      () => parseVariantResponse('not valid json {'),
      (err) => err.message.includes('First 500 chars:') && err.message.includes('not valid json {'),
    );
  });

  it('echoes the parsed payload on missing scopedCss', () => {
    const body = JSON.stringify({ variants: [{ innerHtml: '<h1>x</h1>' }] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /missing or non-string scopedCss/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message)
        && err.message.includes('"variants"'),
    );
  });

  it('echoes the parsed payload on empty variants array', () => {
    const body = JSON.stringify({ scopedCss: '', variants: [] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants must be a non-empty array/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });

  it('echoes the parsed payload on empty innerHtml', () => {
    const body = JSON.stringify({ scopedCss: '', variants: [{ innerHtml: '' }] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants\[0\]\.innerHtml missing or empty/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });

  it('echoes the parsed payload on non-array params', () => {
    const body = JSON.stringify({
      scopedCss: '',
      variants: [{ innerHtml: '<h1>x</h1>', params: 'not-an-array' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants\[0\]\.params must be an array/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });
});
