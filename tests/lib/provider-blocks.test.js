import { describe, expect, test } from 'bun:test';
import { PROVIDERS } from '../../scripts/lib/transformers/providers.js';
import { compileProviderBlocks, PROVIDER_BLOCK_TAGS } from '../../scripts/lib/utils.js';

describe('compileProviderBlocks', () => {
  test('keeps matching provider block bodies and removes tags', () => {
    const content = [
      'Before',
      '<codex>',
      'Codex-only guidance.',
      '</codex>',
      'After',
    ].join('\n');

    expect(compileProviderBlocks(content, ['codex'])).toBe([
      'Before',
      'Codex-only guidance.',
      'After',
    ].join('\n'));
  });

  test('removes non-matching provider blocks', () => {
    const content = [
      'Before',
      '<codex>',
      'Codex-only guidance.',
      '</codex>',
      'After',
    ].join('\n');

    expect(compileProviderBlocks(content, ['claude-code'])).toBe([
      'Before',
      '',
      'After',
    ].join('\n'));
  });

  test('does not leave extra blank lines around stripped blocks', () => {
    const content = [
      'Before',
      '',
      '<codex>',
      'Codex-only guidance.',
      '</codex>',
      '',
      'After',
    ].join('\n');

    expect(compileProviderBlocks(content, ['claude-code'])).toBe([
      'Before',
      '',
      'After',
    ].join('\n'));
  });

  test('preserves unknown standalone tags', () => {
    const content = [
      'Before',
      '<aside>',
      'Normal markdown HTML.',
      '</aside>',
      'After',
    ].join('\n');

    expect(compileProviderBlocks(content, ['codex'])).toBe(content);
  });

  test('keeps codex blocks for targets that opt into the codex tag', () => {
    const content = [
      '<codex>',
      'Codex repo skill guidance.',
      '</codex>',
    ].join('\n');

    expect(compileProviderBlocks(content, ['agents', 'codex'])).toBe('Codex repo skill guidance.');
  });

  test('all provider configs use known provider block tags', () => {
    for (const config of Object.values(PROVIDERS)) {
      expect(config.providerTags?.length).toBeGreaterThan(0);
      for (const tag of config.providerTags) {
        expect(PROVIDER_BLOCK_TAGS.has(tag)).toBe(true);
      }
    }
  });
});
