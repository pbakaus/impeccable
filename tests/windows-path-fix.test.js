import { describe, test, expect } from 'bun:test';
import path from 'path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Regression: Windows drive-letter doubling (#95)
//
// On Windows, `new URL(import.meta.url).pathname` returns `/C:/foo/bar`
// (leading slash). Passing that to `path.resolve()` or `path.join()` on
// Windows produces a doubled drive letter like `C:\C:\...`. The canonical
// fix is to use `fileURLToPath()` from `node:url`, which strips the leading
// slash on Windows.
//
// These tests verify the contract that `fileURLToPath` behaves correctly on
// both POSIX and Windows-style file URLs, and that the source no longer uses
// the raw `.pathname` accessor for local path construction.
// ---------------------------------------------------------------------------

describe('Windows path doubling fix (#95)', () => {
  test('fileURLToPath strips leading slash from Windows file URLs', () => {
    // Simulates the exact scenario: file:///C:/Users/foo/detect-antipatterns.mjs
    const winUrl = new URL('file:///C:/Users/foo/cli/engine/detect-antipatterns.mjs');

    // Raw .pathname returns '/C:/Users/foo/cli/engine/detect-antipatterns.mjs'
    expect(winUrl.pathname).toBe('/C:/Users/foo/cli/engine/detect-antipatterns.mjs');

    // fileURLToPath returns 'C:\\Users\\...' on Windows or '/C:/Users/...' on POSIX,
    // but crucially never returns '/C:/...' on Windows (which causes the double-drive bug)
    const resolved = fileURLToPath(winUrl);

    // The resolved path should NOT start with /C: on either platform when joined
    // On POSIX, fileURLToPath('file:///C:/...') returns '/C:/...' which is fine
    // because POSIX doesn't have drive letters.
    // The key assertion: path.resolve won't produce a doubled drive letter
    const dirPart = path.dirname(resolved);
    const joined = path.resolve(dirPart, 'detect-antipatterns-browser.js');
    // Should never contain doubled drive pattern like C:\C:\ or /C:/C:/
    expect(joined).not.toMatch(/[A-Z]:[/\\][A-Z]:/i);
  });

  test('fileURLToPath handles POSIX file URLs correctly', () => {
    const posixUrl = new URL('file:///home/user/cli/engine/detect-antipatterns.mjs');
    const resolved = fileURLToPath(posixUrl);
    expect(resolved).toBe('/home/user/cli/engine/detect-antipatterns.mjs');
  });

  test('import.meta.url produces a valid file URL', () => {
    // Ensure import.meta.url is a file:// URL that fileURLToPath can handle
    expect(import.meta.url).toMatch(/^file:\/\//);
    const thisFile = fileURLToPath(import.meta.url);
    expect(thisFile).toContain('windows-path-fix.test');
  });

  test('source file no longer uses raw .pathname for path construction', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
      'utf-8'
    );

    // The bug pattern: using new URL(import.meta.url).pathname in path.resolve/join
    // After the fix, all occurrences should use fileURLToPath instead
    const pathnameBugPattern = /path\.(resolve|join|dirname)\(\s*new URL\(import\.meta\.url\)\.pathname/g;
    const matches = src.match(pathnameBugPattern);
    expect(matches).toBeNull();

    // Verify fileURLToPath is imported
    expect(src).toContain('fileURLToPath');

    // Verify fileURLToPath is used with import.meta.url
    expect(src).toMatch(/fileURLToPath\(import\.meta\.url\)/);
  });
});
