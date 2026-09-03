import { describe, test, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, detectUrl, splitScanUrl } from '../cli/engine/engines/browser/detect-url.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// launchBrowser prefers the system-installed Chrome on Windows to dodge the
// bundled-Chrome GPU crash-loop (issue #372), and keeps the pinned bundled
// build everywhere else. The function takes the puppeteer module as a
// parameter, so a fake lets us assert the launch strategy without a real
// browser or a real OS.

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform);
});

function makePuppeteer({ failChannel = false } = {}) {
  const calls = [];
  const fakeBrowser = { __fake: true };
  return {
    calls,
    fakeBrowser,
    mod: {
      default: {
        async launch(opts) {
          calls.push(opts);
          if (failChannel && opts.channel === 'chrome') {
            throw new Error('Could not find Chrome (channel: chrome)');
          }
          return fakeBrowser;
        },
      },
    },
  };
}

function runWithoutPuppeteer(args, files = {}, { nodeArgs = [] } = {}) {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-no-puppeteer-'));
  try {
    const cliRoot = path.join(isolatedRoot, 'cli');
    fs.mkdirSync(cliRoot, { recursive: true });
    fs.cpSync(path.join(ROOT, 'cli', 'engine'), path.join(cliRoot, 'engine'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'cli', 'lib'), path.join(cliRoot, 'lib'), { recursive: true });
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(isolatedRoot, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
    }
    return spawnSync(
      'node',
      [...nodeArgs, path.join(cliRoot, 'engine', 'detect-antipatterns.mjs'), '--json', ...args],
      { cwd: isolatedRoot, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

const DENY_READ_PRELOAD = `
const fs = require('node:fs');
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (String(file).endsWith('unreadable.css')) {
    const error = new Error('simulated EACCES');
    error.code = 'EACCES';
    throw error;
  }
  return originalReadFileSync.call(this, file, ...args);
};
`;

describe('launchBrowser', () => {
  test('Windows: prefers system Chrome via channel:chrome', async () => {
    setPlatform('win32');
    const p = makePuppeteer();
    const browser = await launchBrowser(p.mod, { headless: true, args: ['--foo'] });

    expect(browser).toBe(p.fakeBrowser);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].channel).toBe('chrome');
    expect(p.calls[0].headless).toBe(true);
    expect(p.calls[0].args).toEqual(['--foo']);
  });

  test('Windows: falls back to bundled when system Chrome is unavailable', async () => {
    setPlatform('win32');
    const p = makePuppeteer({ failChannel: true });
    const browser = await launchBrowser(p.mod, { headless: true, args: [] });

    expect(browser).toBe(p.fakeBrowser);
    expect(p.calls).toHaveLength(2);
    expect(p.calls[0].channel).toBe('chrome'); // first attempt
    expect(p.calls[1].channel).toBeUndefined(); // fallback: bundled, no channel
  });

  test('non-Windows: uses bundled Chrome directly, no channel', async () => {
    setPlatform('linux');
    const p = makePuppeteer();
    const browser = await launchBrowser(p.mod, { headless: true, args: [] });

    expect(browser).toBe(p.fakeBrowser);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].channel).toBeUndefined();
  });

  test('non-Windows: never attempts channel:chrome even if it would succeed', async () => {
    setPlatform('darwin');
    const p = makePuppeteer();
    await launchBrowser(p.mod, {});

    expect(p.calls.every(c => c.channel === undefined)).toBe(true);
  });
});

describe('detect CLI browser failures', () => {
  test('exits 1 with valid empty JSON when Puppeteer is unavailable', () => {
    const result = runWithoutPuppeteer(['https://example.com']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('[]\n');
    expect(result.stderr).toContain('puppeteer is required for URL scanning');
  });

  test('reports a shared multi-URL setup failure once and exits 1', () => {
    const result = runWithoutPuppeteer(['https://example.com', 'https://example.org']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('[]\n');
    expect(result.stderr.match(/puppeteer is required for URL scanning/g)).toHaveLength(1);
  });

  test('operational failure takes precedence over findings from another target', () => {
    const result = runWithoutPuppeteer(
      ['https://example.com', 'page.css'],
      { 'page.css': '.hero { animation: bounce 1s linear infinite; }\n' },
    );
    const findings = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(findings.some(finding => finding.antipattern === 'bounce-easing')).toBe(true);
    expect(result.stderr).toContain('puppeteer is required for URL scanning');
  });

  test('exits 1 when an explicitly requested local target cannot be accessed', () => {
    const result = runWithoutPuppeteer(['missing.css']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('[]\n');
    expect(result.stderr).toContain('Warning: cannot access missing.css');
  });

  test('missing local target takes precedence over findings from another target', () => {
    const result = runWithoutPuppeteer(
      ['missing.css', 'page.css'],
      { 'page.css': '.hero { animation: bounce 1s linear infinite; }\n' },
    );
    const findings = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(findings.some(finding => finding.antipattern === 'bounce-easing')).toBe(true);
    expect(result.stderr).toContain('Warning: cannot access missing.css');
  });

  test('unreadable local file exits 1 with valid empty JSON and no stack trace', () => {
    const result = runWithoutPuppeteer(
      ['unreadable.css'],
      {
        'deny-read.cjs': DENY_READ_PRELOAD,
        'unreadable.css': '.hero { color: red; }\n',
      },
      { nodeArgs: ['--require=./deny-read.cjs'] },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('[]\n');
    expect(result.stderr).toContain('Error: cannot scan unreadable.css: simulated EACCES');
    expect(result.stderr).not.toContain('at detectLocalFile');
  });

  test('unreadable directory file preserves findings from readable siblings', () => {
    const result = runWithoutPuppeteer(
      ['styles'],
      {
        'deny-read.cjs': DENY_READ_PRELOAD,
        'styles/unreadable.css': '.hero { color: red; }\n',
        'styles/page.css': '.hero { animation: bounce 1s linear infinite; }\n',
      },
      { nodeArgs: ['--require=./deny-read.cjs'] },
    );
    const findings = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(findings.some(finding => finding.antipattern === 'bounce-easing')).toBe(true);
    expect(result.stderr.match(/simulated EACCES/g)).toHaveLength(1);
  });
});

describe('splitScanUrl', () => {
  test('strips http(s) userinfo and returns credentials', () => {
    expect(splitScanUrl('https://user:pass@example.com')).toEqual({
      href: 'https://example.com/',
      credentials: { username: 'user', password: 'pass' },
    });
    expect(splitScanUrl('https://user:p%40ss@example.com/path?q=1')).toEqual({
      href: 'https://example.com/path?q=1',
      credentials: { username: 'user', password: 'p@ss' },
    });
    expect(splitScanUrl('https://user@example.com')).toEqual({
      href: 'https://example.com/',
      credentials: { username: 'user', password: '' },
    });
    expect(splitScanUrl('http://:secret@host.com/')).toEqual({
      href: 'http://host.com/',
      credentials: { username: '', password: 'secret' },
    });
  });

  test('preserves original string when no userinfo', () => {
    expect(splitScanUrl('https://example.com')).toEqual({
      href: 'https://example.com',
      credentials: null,
    });
    expect(splitScanUrl('https://example.com/path?email=a@b.com')).toEqual({
      href: 'https://example.com/path?email=a@b.com',
      credentials: null,
    });
  });

  test('handles IPv6 and non-http(s) URLs', () => {
    expect(splitScanUrl('https://user:pass@[::1]:8080/x')).toEqual({
      href: 'https://[::1]:8080/x',
      credentials: { username: 'user', password: 'pass' },
    });
    expect(splitScanUrl('file:///tmp/a.html')).toEqual({
      href: 'file:///tmp/a.html',
      credentials: null,
    });
  });

  test('returns original string for invalid URLs', () => {
    expect(splitScanUrl('not a url')).toEqual({
      href: 'not a url',
      credentials: null,
    });
  });
});

function makeFakeBrowser() {
  const calls = { intercept: false, requestHandler: null, authenticate: [], goto: [] };
  const page = {
    on(event, handler) {
      if (event === 'request') calls.requestHandler = handler;
    },
    async setViewport() {},
    async setRequestInterception() { calls.intercept = true; },
    async authenticate(creds) { calls.authenticate.push(creds); },
    async goto(url, opts) { calls.goto.push({ url, opts }); },
    async evaluate(fn) {
      if (typeof fn === 'function' && fn.toString().includes('impeccableDetect')) {
        return [{ findings: [{ type: 'low-contrast', detail: 'x', ignoreValue: '', severity: '' }] }];
      }
      return [];
    },
    async close() {},
  };
  return {
    calls,
    browser: {
      async newPage() { return page; },
    },
  };
}

function fakeRequest(url, calls) {
  return {
    url: () => url,
    headers: () => ({ accept: 'text/html' }),
    continue(overrides) {
      calls.continues.push({ url, overrides });
      return Promise.resolve();
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}/`);
    });
  });
}

describe('detectUrl credential redaction', () => {
  test('scopes Authorization to the scan origin and redacts findings', async () => {
    const { calls, browser } = makeFakeBrowser();
    calls.continues = [];
    const findings = await detectUrl('https://user:p%40ss@example.com/path', {
      browser,
      visualContrast: false,
      contentHidden: false,
    });

    expect(calls.authenticate).toEqual([]);
    expect(calls.intercept).toBe(true);
    expect(typeof calls.requestHandler).toBe('function');
    expect(calls.goto).toHaveLength(1);
    expect(calls.goto[0].url).toBe('https://example.com/path');

    const expected = `Basic ${Buffer.from('user:p@ss').toString('base64')}`;
    await calls.requestHandler(fakeRequest('https://example.com/path', calls));
    await calls.requestHandler(fakeRequest('https://evil.example/steal', calls));
    expect(calls.continues[0].overrides.headers.authorization).toBe(expected);
    expect(calls.continues[1].overrides).toBeUndefined();

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.file).toBe('https://example.com/path');
    }
  });

  test('does not intercept when URL has no userinfo', async () => {
    const { calls, browser } = makeFakeBrowser();
    const url = 'https://example.com/path';
    const findings = await detectUrl(url, {
      browser,
      visualContrast: false,
      contentHidden: false,
    });

    expect(calls.authenticate).toEqual([]);
    expect(calls.intercept).toBe(false);
    expect(calls.requestHandler).toBe(null);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.file).toBe(url);
    }
  });
});

describe('detectUrl origin-scoped basic auth', () => {
  test('does not send URL credentials to a cross-origin redirect that challenges', async () => {
    const user = 'qa-scanner';
    const pass = 'Hunter2-657-SHOULD-NOT-LEAK';
    const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    const seenOnB = [];

    const serverB = http.createServer((req, res) => {
      seenOnB.push(req.headers.authorization || '');
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="b"' });
      res.end('b');
    });
    const urlB = await listen(serverB);
    const serverA = http.createServer((req, res) => {
      res.writeHead(302, { Location: urlB });
      res.end();
    });
    const urlA = await listen(serverA);

    try {
      try {
        await detectUrl(urlA.replace('http://', `http://${user}:${pass}@`), {
          visualContrast: false,
          contentHidden: false,
          waitUntil: 'domcontentloaded',
        });
      } catch {
        // B's 401 may fail navigation once credentials are withheld.
      }
      expect(seenOnB.includes(expected)).toBe(false);
    } finally {
      await Promise.all([
        new Promise((resolve) => serverA.close(resolve)),
        new Promise((resolve) => serverB.close(resolve)),
      ]);
    }
  }, { timeout: 30000 });

  test('still authenticates the original scan origin', async () => {
    const user = 'qa-scanner';
    const pass = 'Hunter2-657-SHOULD-NOT-LEAK';
    const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization || '');
      if (req.headers.authorization !== expected) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="a"' });
        res.end('no');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>ok</h1></body></html>');
    });
    const origin = await listen(server);

    try {
      await detectUrl(origin.replace('http://', `http://${user}:${pass}@`), {
        visualContrast: false,
        contentHidden: false,
        waitUntil: 'domcontentloaded',
      });
      expect(seen.includes(expected)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, { timeout: 30000 });
});
