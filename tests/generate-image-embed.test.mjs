import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'generate-image.mjs');
const EMBED_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'embed-prompt.mjs');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeSpacedInstall({ withEmbed = true } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'gen-img-parent-'));
  const installDir = path.join(parent, 'impeccable space');
  mkdirSync(installDir, { recursive: true });
  copyFileSync(SOURCE_SCRIPT, path.join(installDir, 'generate-image.mjs'));
  if (withEmbed) copyFileSync(EMBED_SCRIPT, path.join(installDir, 'embed-prompt.mjs'));
  const preload = path.join(parent, 'fetch-mock.mjs');
  writeFileSync(preload, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ b64_json: '${PNG_B64}' }] }) });\n`);
  const cwd = mkdtempSync(path.join(tmpdir(), 'gen-img-cwd-'));
  return { parent, installDir, cwd, script: path.join(installDir, 'generate-image.mjs'), preload };
}

function runGenerate(install, prompt) {
  const out = path.join(install.cwd, 'out.png');
  const env = { ...process.env, OPENAI_API_KEY: 'test-key' };
  delete env.IMPECCABLE_IMAGE_GEN_FAKE;
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(install.preload).href,
    install.script,
    '--prompt', prompt,
    '--out', out,
  ], {
    cwd: install.cwd,
    encoding: 'utf-8',
    env,
  });
  return { ...result, out, sidecar: `${out}.json` };
}

function cleanup(install) {
  rmSync(install.parent, { recursive: true, force: true });
  rmSync(install.cwd, { recursive: true, force: true });
}

describe('generate-image embed', () => {
  it('embeds prompt when install path contains a space', () => {
    const install = makeSpacedInstall({ withEmbed: true });
    try {
      const prompt = 'space-path embed test';
      const result = runGenerate(install, prompt);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /prompt embedded/);
      assert.ok(existsSync(result.out));
      assert.ok(existsSync(result.sidecar));
      assert.equal(JSON.parse(readFileSync(result.sidecar, 'utf8')).prompt, prompt);
      unlinkSync(result.sidecar);
      const readBack = spawnSync(process.execPath, [path.join(install.installDir, 'embed-prompt.mjs'), result.out, '--read'], {
        encoding: 'utf-8',
      });
      assert.equal(readBack.status, 0, readBack.stderr);
      assert.equal(readBack.stdout.trim(), prompt);
    } finally {
      cleanup(install);
    }
  });

  it('warns when embed helper is missing but keeps image and sidecar', () => {
    const install = makeSpacedInstall({ withEmbed: false });
    try {
      const prompt = 'missing helper test';
      const result = runGenerate(install, prompt);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /prompt embedded/);
      assert.match(result.stderr, /failed to embed prompt/);
      assert.ok(existsSync(result.out));
      assert.ok(existsSync(result.sidecar));
    } finally {
      cleanup(install);
    }
  });
});
