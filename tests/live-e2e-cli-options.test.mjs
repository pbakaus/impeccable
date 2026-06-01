import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCliOption } from './live-e2e/cli-options.mjs';

describe('live-e2e readCliOption', () => {
  const baseArgv = ['node', 'runner.mjs'];

  it('reads --name=value form', () => {
    assert.equal(readCliOption([...baseArgv, '--llm-model=foo'], 'llm-model'), 'foo');
  });

  it('reads --name value form', () => {
    assert.equal(readCliOption([...baseArgv, '--llm-model', 'foo'], 'llm-model'), 'foo');
  });

  it('returns undefined when the flag is absent', () => {
    assert.equal(readCliOption(baseArgv, 'llm-model'), undefined);
  });

  it('returns the first match when the flag appears more than once', () => {
    assert.equal(
      readCliOption([...baseArgv, '--llm-model=first', '--llm-model=second'], 'llm-model'),
      'first',
    );
  });

  it('throws when --name appears as the last argument with no value', () => {
    assert.throws(
      () => readCliOption([...baseArgv, '--llm-model'], 'llm-model'),
      /--llm-model requires a value \(received no value\)/,
    );
  });

  it('throws when the next argv would consume another flag as the value', () => {
    assert.throws(
      () => readCliOption([...baseArgv, '--llm-model', '--llm-provider=deepseek'], 'llm-model'),
      /--llm-model requires a value \(received "--llm-provider=deepseek"\)/,
    );
  });

  it('treats --name= (empty `=`) as an empty-string value, not a throw', () => {
    assert.equal(readCliOption([...baseArgv, '--llm-model='], 'llm-model'), '');
  });
});
