import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';

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

  it('rejects unsupported providers', () => {
    assert.throws(
      () => resolveLlmAgentConfig({}, { IMPECCABLE_E2E_LLM_PROVIDER: 'other' }),
      /Unsupported IMPECCABLE_E2E_LLM_PROVIDER: other/,
    );
  });
});
