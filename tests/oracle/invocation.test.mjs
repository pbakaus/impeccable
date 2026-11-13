import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvocation } from './lib.mjs';
import contextCases from './cases/context.mjs';

const opts = { impl: 'bin', bin: '/test/impeccable', ws: '/test/workspace', isolatedHome: '/test/home' };

test('every oracle verb disables personal taste by default', () => {
  for (const verb of ['context', 'detect', 'doctor', 'taste-refresh']) {
    const { env } = buildInvocation({ verb }, opts);
    assert.equal(env.IMPECCABLE_NO_TASTE, '1');
  }
});

test('the taste case explicitly enables only its isolated copy', () => {
  const tasteCase = contextCases.find(c => c.id === 'context-taste-ready');
  const { env } = buildInvocation(tasteCase, opts);
  assert.equal(env.IMPECCABLE_NO_TASTE, undefined);
  assert.equal(env.IMPECCABLE_HOME, '/test/workspace/.oracle-taste');
});
