import { afterEach, describe, expect, it } from 'vitest';
import { configuredKeys, isAuthorized } from '../src/security/auth.js';

describe('MCP key auth', () => {
  const original = process.env.IMPECCABLE_MCP_KEYS;

  afterEach(() => {
    process.env.IMPECCABLE_MCP_KEYS = original;
  });

  it('allows requests when no keys are configured', () => {
    delete process.env.IMPECCABLE_MCP_KEYS;
    expect(configuredKeys()).toEqual([]);
    expect(isAuthorized({})).toBe(true);
  });

  it('requires x-impeccable-mcp-key when keys are configured', () => {
    process.env.IMPECCABLE_MCP_KEYS = 'alpha,beta';
    expect(isAuthorized({})).toBe(false);
    expect(isAuthorized({ 'x-impeccable-mcp-key': 'alpha' })).toBe(true);
    expect(isAuthorized({ 'x-impeccable-mcp-key': 'wrong' })).toBe(false);
  });

  it('also accepts authorization bearer tokens', () => {
    process.env.IMPECCABLE_MCP_KEYS = 'alpha,beta';
    expect(isAuthorized({ authorization: 'Bearer beta' })).toBe(true);
    expect(isAuthorized({ Authorization: 'Bearer beta' })).toBe(true);
    expect(isAuthorized({ authorization: 'Bearer wrong' })).toBe(false);
  });
});
