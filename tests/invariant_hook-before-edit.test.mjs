import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  proposedFilePath,
  shellHereDocContent,
} from '../plugin/skills/impeccable/scripts/hook-before-edit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('proposedFilePath – path hardening', () => {
  const cwd = '/test';

  const blocked = [
    ['script tag payload', '<script>alert(1)</script>'],
    ['img onerror payload', '<img onerror=alert(1) src=x>'],
    ['attribute break payload', '"><svg onload=alert(1)>'],
  ];

  for (const [label, input] of blocked) {
    it(`rejects ${label}`, () => {
      const result = proposedFilePath({ tool_input: { file_path: input } }, cwd);
      assert.equal(result, '', `expected empty string for: ${input}`);
    });
  }

  it('resolves a normal filename', () => {
    const result = proposedFilePath({ tool_input: { file_path: 'normal_file.txt' } }, cwd);
    assert.equal(result, path.resolve(cwd, 'normal_file.txt'));
  });

  it('accepts filenames with single quotes', () => {
    const result = proposedFilePath({ tool_input: { file_path: "it's a file.txt" } }, cwd);
    assert.equal(result, path.resolve(cwd, "it's a file.txt"));
  });

  it('returns empty string for empty input', () => {
    const result = proposedFilePath({ tool_input: { file_path: '' } }, cwd);
    assert.equal(result, '');
  });
});

describe('shellHereDocContent – heredoc body extraction', () => {
  it('extracts body between heredoc markers', () => {
    const cmd = 'cat <<EOF\nline1\nline2\nEOF\n';
    assert.equal(shellHereDocContent(cmd), 'line1\nline2');
  });

  it('does not cut at a token that starts with the marker name', () => {
    // body contains "EOFfoo" which starts with marker "EOF" — must not cut there
    const cmd = 'cat <<EOF\nline1\nEOFfoo\nline3\nEOF\n';
    assert.equal(shellHereDocContent(cmd), 'line1\nEOFfoo\nline3');
  });

  it('returns empty string when no closing marker is found', () => {
    const cmd = 'cat <<EOF\nline1\nline2\n';
    assert.equal(shellHereDocContent(cmd), '');
  });

  it('handles CRLF line endings', () => {
    const cmd = 'cat <<EOF\r\nline1\r\nEOF\r\n';
    assert.equal(shellHereDocContent(cmd), 'line1');
  });
});
