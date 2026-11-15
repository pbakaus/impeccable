import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { devEnvView, devKey, devKeysFile, withoutProviderKeys } from './dev-keys.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-dev-keys-'));
let n = 0;
function keysFile(body, mode = 0o600) {
  const file = path.join(dir, `dev-${n++}.env`);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, mode);
  return file;
}

describe('dev keys file', () => {
  it('IMPECCABLE_DEV_KEYS names the file, else ~/.config/impeccable/dev.env', () => {
    assert.equal(devKeysFile({ IMPECCABLE_DEV_KEYS: '/k/dev.env' }), '/k/dev.env');
    assert.equal(devKeysFile({}), path.join(os.homedir(), '.config', 'impeccable', 'dev.env'));
  });

  // Catches a parser that keeps `export `, quotes, comments or CRLF in a value.
  for (const [line, expected] of [
    ['A_API_KEY=plain', 'plain'],
    ['export A_API_KEY=exported', 'exported'],
    ['A_API_KEY="double # kept"', 'double # kept'],
    ["A_API_KEY='single'", 'single'],
    ['A_API_KEY=trailing # note', 'trailing'],
    ['A_API_KEY=crlf\r', 'crlf'],
  ]) {
    it(`parses ${JSON.stringify(line)}`, () => {
      const env = { IMPECCABLE_DEV_KEYS: keysFile(`# comment\n\n${line}\n`) };
      assert.equal(devKey('A_API_KEY', env), expected);
    });
  }

  // Catches the environment losing to the file, which would break CI secrets.
  it('a real environment variable wins over the file', () => {
    const env = { IMPECCABLE_DEV_KEYS: keysFile('A_API_KEY=file\nB_API_KEY=file\n'), A_API_KEY: 'env' };
    assert.equal(devKey('A_API_KEY', env), 'env');
    assert.equal(devKey('B_API_KEY', env), 'file');
    assert.deepEqual(
      [devEnvView(env).A_API_KEY, devEnvView(env).B_API_KEY],
      ['env', 'file'],
    );
  });

  // Catches reading keys from a file other users can read.
  it('refuses a file other users can read', { skip: process.platform === 'win32' }, () => {
    const env = { IMPECCABLE_DEV_KEYS: keysFile('A_API_KEY=x\n', 0o644) };
    assert.throws(() => devKey('A_API_KEY', env), /chmod 600/);
  });

  it('a missing file means no keys', () => {
    assert.equal(devKey('A_API_KEY', { IMPECCABLE_DEV_KEYS: path.join(dir, 'absent.env') }), undefined);
  });

  // Catches a key reaching a child's launch environment, or a base URL being dropped.
  it('strips credential names from a child environment and keeps the rest', () => {
    const child = withoutProviderKeys({
      OPENAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'x', CLAUDE_AUTH_TOKEN: 'x', GH_ACCESS_TOKEN: 'x',
      OPENAI_BASE_URL: 'u', DEEPSEEK_API_BASE_URL: 'u', PATH: '/bin',
    });
    assert.deepEqual(Object.keys(child).sort(), ['DEEPSEEK_API_BASE_URL', 'OPENAI_BASE_URL', 'PATH']);
  });
});
