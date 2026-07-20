/**
 * Tests for scripts/lib/cli-args.mjs — the shared argv parser for the Live
 * benchmark / judging scripts.
 * Run with: node --test tests/cli-args.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { boolFlag, parseArgs, positiveIntFlag, resolveEnum, toCamel } from '../scripts/lib/cli-args.mjs';

describe('parseArgs', () => {
  it('reads space-separated values', () => {
    // The regression: without the argv[i+1] lookahead this yielded
    // {fixture: true, iterations: true}, silently benchmarking the defaults.
    assert.deepEqual(
      parseArgs(['--fixture', 'vite8-react-modal', '--iterations', '20']),
      { fixture: 'vite8-react-modal', iterations: '20' },
    );
  });

  it('reads --flag=value values', () => {
    assert.deepEqual(parseArgs(['--fixture=vite8-react-plain']), { fixture: 'vite8-react-plain' });
  });

  it('treats a flag followed by another flag as boolean', () => {
    assert.deepEqual(parseArgs(['--headed', '--quiet']), { headed: true, quiet: true });
  });

  it('treats a trailing flag as boolean', () => {
    assert.deepEqual(parseArgs(['--append']), { append: true });
  });

  it('camel-cases kebab keys so both spellings land on one key', () => {
    assert.deepEqual(parseArgs(['--simulated-tail-ms=250']), { simulatedTailMs: '250' });
    assert.deepEqual(parseArgs(['--simulatedTailMs=250']), { simulatedTailMs: '250' });
    assert.deepEqual(parseArgs(['--median-target', '0.4']), { medianTarget: '0.4' });
  });

  it('keeps a value that contains an equals sign intact', () => {
    assert.deepEqual(parseArgs(['--model=claude-sonnet-4-6=x']), { model: 'claude-sonnet-4-6=x' });
  });

  it('ignores positional args and a bare --', () => {
    assert.deepEqual(parseArgs(['positional', '--', '--real', 'v']), { real: 'v' });
  });

  it('lets a later occurrence win', () => {
    assert.deepEqual(parseArgs(['--agent', 'fake', '--agent', 'llm']), { agent: 'llm' });
  });
});

describe('toCamel', () => {
  it('upcases after hyphens only', () => {
    assert.equal(toCamel('simulated-tail-ms'), 'simulatedTailMs');
    assert.equal(toCamel('p95-target'), 'p95Target');
    assert.equal(toCamel('already'), 'already');
  });
});

describe('boolFlag', () => {
  it('accepts the bare-flag sentinel and the explicit spellings alike', () => {
    // --headed and --headed=true must not diverge.
    assert.equal(boolFlag(true), true);
    assert.equal(boolFlag('true'), true);
    assert.equal(boolFlag('1'), true);
    assert.equal(boolFlag('yes'), true);
    assert.equal(boolFlag(''), true);
  });

  it('recognizes negative spellings', () => {
    assert.equal(boolFlag('false'), false);
    assert.equal(boolFlag('0'), false);
    assert.equal(boolFlag('no'), false);
  });

  it('falls back when absent or unrecognized', () => {
    assert.equal(boolFlag(undefined), false);
    assert.equal(boolFlag(undefined, true), true);
    assert.equal(boolFlag('maybe', true), true);
  });
});

describe('positiveIntFlag', () => {
  it('parses positive integers', () => {
    assert.equal(positiveIntFlag('20', 5), 20);
  });

  it('falls back when absent or given as a bare flag', () => {
    assert.equal(positiveIntFlag(undefined, 5), 5);
    assert.equal(positiveIntFlag(true, 5), 5);
  });

  it('throws rather than silently using the default', () => {
    // Quietly benchmarking 5 iterations when 20 were asked for is the failure
    // this replaces.
    for (const bad of ['abc', '0', '-3', '2.5', '20x']) {
      assert.throws(() => positiveIntFlag(bad, 5), /positive integer/, `accepted ${bad}`);
    }
  });
});

describe('resolveEnum', () => {
  it('accepts an allowed value, case-insensitively', () => {
    assert.equal(resolveEnum('llm', ['fake', 'llm'], 'fake', '--agent'), 'llm');
    assert.equal(resolveEnum('LLM', ['fake', 'llm'], 'fake', '--agent'), 'llm');
  });

  it('falls back when absent or given as a bare flag', () => {
    assert.equal(resolveEnum(undefined, ['fake', 'llm'], 'fake', '--agent'), 'fake');
    assert.equal(resolveEnum(true, ['fake', 'llm'], 'fake', '--agent'), 'fake');
  });

  it('throws on an unrecognized value instead of silently using the default', () => {
    // The private evals Live runner passes --agent=codex. Falling back to the
    // canned fake agent produced a clean report of a deterministic stub labelled
    // as a real harness run.
    assert.throws(
      () => resolveEnum('codex', ['fake', 'llm'], 'fake', '--agent'),
      /--agent must be one of fake, llm; got: codex/,
    );
    assert.throws(
      () => resolveEnum('progresive', ['atomic', 'progressive'], 'atomic', '--delivery'),
      /--delivery must be one of atomic, progressive/,
    );
  });
});
