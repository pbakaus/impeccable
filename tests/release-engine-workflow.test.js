import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflow = Bun.YAML.parse(readFileSync(new URL('../.github/workflows/release-engine.yml', import.meta.url), 'utf8'));
const action = (job, name) => job.steps.find(step => step.uses?.startsWith(`${name}@`));

describe('engine release signing boundary', () => {
  test('only the protected signing job receives an OIDC token', () => {
    expect(workflow.on).toEqual({ push: { tags: ['engine-v*'] } });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const sign = workflow.jobs['sign-windows'];
    expect(sign.environment).toBe('windows-signing');
    expect(sign.needs).toBe('build');
    expect(sign.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(workflow.jobs.build.permissions?.['id-token']).toBeUndefined();
    expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write' });
    expect(sign.steps.some(step => step.uses?.startsWith('actions/checkout@'))).toBe(false);
  });

  test('publication waits for signing and cannot collect the unsigned artifact', () => {
    const unsignedName = 'unsigned-windows-x64';
    expect(action(workflow.jobs.build, 'actions/upload-artifact').with.name).toContain(unsignedName);
    const sign = workflow.jobs['sign-windows'];
    expect(action(sign, 'actions/download-artifact').with.name).toBe(unsignedName);
    expect(action(sign, 'actions/upload-artifact').with.name).toBe('impeccable-windows-x64');
    expect(workflow.jobs.publish.needs).toEqual(['build', 'sign-windows']);
    expect(action(workflow.jobs.publish, 'actions/download-artifact').with.pattern).toBe('impeccable-*');
    expect(unsignedName.startsWith('impeccable-')).toBe(false);
    expect(workflow.jobs.publish.steps.find(step => step.name === 'Lay out release assets with checksums').run).toContain('sha256sum');
  });

  test('artifact downloads stay on the same-run runtime-token path', () => {
    for (const name of ['sign-windows', 'publish']) {
      const download = action(workflow.jobs[name], 'actions/download-artifact');
      // Supplying github-token opts into the public API path, which requires
      // separate Actions permissions and can read other workflow runs.
      for (const input of ['github-token', 'repository', 'run-id']) {
        expect(download.with[input]).toBeUndefined();
      }
    }
  });

  test('signs exactly the engine with timestamping, then verifies before upload', () => {
    const sign = workflow.jobs['sign-windows'];
    const signing = action(sign, 'azure/artifact-signing-action');
    expect(signing.with.files).toBe('${{ github.workspace }}\\unsigned\\impeccable.exe');
    expect(signing.with['certificate-profile-name']).toBe('impeccable-windows');
    expect(signing.with['signing-account-name']).toBe('impeccable-signing');
    expect(signing.with['timestamp-rfc3161']).toBe('http://timestamp.acs.microsoft.com');
    expect(signing.with['file-digest']).toBe('SHA256');
    expect(signing.with['timestamp-digest']).toBe('SHA256');
    expect(signing.with['exclude-environment-credential']).toBe(true);
    expect(signing.with['cache-dependencies']).toBe(false);
    const verify = sign.steps.find(step => step.name === 'Verify signed engine');
    expect(sign.steps.indexOf(verify)).toBeGreaterThan(sign.steps.indexOf(signing));
    expect(sign.steps.indexOf(verify)).toBeLessThan(sign.steps.indexOf(action(sign, 'actions/upload-artifact')));
    expect(verify.run).toContain("$signature.Status -ne 'Valid'");
    expect(verify.run).toContain("$publisher -cne 'Renaissance Geek, Inc.'");
    expect(verify.run).toContain('$null -eq $signature.TimeStamperCertificate');
    expect(verify.run).toContain('throw');
    expect(sign.steps.some(step => step['continue-on-error'])).toBe(false);
    expect(action(sign, 'actions/upload-artifact').if).toBeUndefined();
  });

  test('the release is created in one gh call that publishes only after every asset is up', () => {
    const run = workflow.jobs.publish.steps.find(step => step.name === 'Publish the GitHub Release').run;
    // gh only drafts, uploads, then publishes when the assets are passed to create.
    expect(run).toMatch(/gh release create[\s\S]*\bout\/\*/);
    for (const flag of ['gh release upload', '--draft']) expect(run).not.toContain(flag);
  });

  test('every third-party action is pinned to a commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});

// Runs each step's own script, the way `shell: bash` does, so a broken sed fails
// here instead of on the next release.
describe.skipIf(process.platform === 'win32')('engine release version agreement', () => {
  const step = name => workflow.jobs.build.steps.find(s => s.name === name);
  const bash = (script, cwd, env = {}) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  const inTree = (files, script, env) => {
    const dir = mkdtempSync(join(tmpdir(), 'release-engine-'));
    try {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content, { mode: 0o755 });
      }
      return bash(script, dir, env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  describe('tag check', () => {
    const { run: script, if: condition } = step('Check the tag and Cargo.toml match ENGINE_VERSION');
    const check = ({ engine = '1.2.3', cargo = '1.2.3', tag = 'engine-v1.2.3', eol = '\n' } = {}) => inTree({
      ENGINE_VERSION: `${engine}${eol}`,
      'Cargo.toml': ['[workspace]', '', '[workspace.package]', `version = "${cargo}"`, '', '[workspace.dependencies]', 'version = "9.9.9"', ''].join(eol),
    }, script, { GITHUB_REF_NAME: tag });

    test('runs on every target, the cross build included', () => {
      expect(condition).toBeUndefined();
    });

    test('passes when all three agree, on a CRLF checkout too', () => {
      expect(check().status).toBe(0);
      expect(check({ eol: '\r\n' }).status).toBe(0);
    });

    test('fails on a workspace version or a tag that disagrees', () => {
      const drifted = check({ cargo: '1.2.4' });
      expect(drifted.status).toBe(1);
      expect(drifted.stdout).toContain("'1.2.4' != ENGINE_VERSION 1.2.3");
      expect(check({ tag: 'engine-v1.2.4' }).status).toBe(1);
    });

    test('fails when it cannot find the workspace version', () => {
      const missing = inTree({ ENGINE_VERSION: '1.2.3\n', 'Cargo.toml': '[workspace]\n' }, script, { GITHUB_REF_NAME: 'engine-v1.2.3' });
      expect(missing.status).toBe(1);
    });

    test('passes on this checkout', () => {
      const root = fileURLToPath(new URL('..', import.meta.url));
      const version = readFileSync(join(root, 'ENGINE_VERSION'), 'utf8').trim();
      expect(bash(script, root, { GITHUB_REF_NAME: `engine-v${version}` }).status).toBe(0);
    });
  });

  describe('smoke step', () => {
    const { run, if: condition } = step('Smoke the binary');
    const script = run
      .replace('${{ matrix.target }}', 'host')
      .replace("${{ runner.os == 'Windows' && '.exe' || '' }}", '');
    const probe = body => inTree({
      ENGINE_VERSION: '1.2.3\n',
      'target/host/release/impeccable': `#!/bin/sh\n[ "$1" = engine-probe ] || exit 9\n${body}\n`,
    }, script);

    test('skips only the cross target', () => {
      expect(condition).toBe('${{ !matrix.cross }}');
      expect(script).not.toContain('${{');
    });

    test('passes only on the exact handshake', () => {
      expect(probe('echo impeccable-engine 1.2.3').status).toBe(0);
      for (const printed of ['impeccable-engine 1.2.4', 'impeccable-engine 1.2.3-dirty', 'impeccable-engine', '']) {
        const mismatch = probe(`echo ${printed}`);
        expect(mismatch.status).toBe(1);
        expect(mismatch.stdout).toContain("want 'impeccable-engine 1.2.3'");
      }
    });

    test('fails when the probe exits non-zero', () => {
      expect(probe('echo impeccable-engine 1.2.3; exit 3').status).not.toBe(0);
    });
  });
});
