import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = Bun.YAML.parse(readFileSync(new URL('../.github/workflows/release-engine.yml', import.meta.url), 'utf8'));
const ci = Bun.YAML.parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const action = (job, name) => job.steps.find(step => step.uses?.startsWith(`${name}@`));

describe('engine release targets', () => {
  test('CI exercises native npm packages and launchers on both Windows architectures', () => {
    const rust = ci.jobs['native-cli-windows'];
    expect(rust.strategy.matrix.include).toEqual([
      { os: 'windows-latest', target: 'x86_64-pc-windows-msvc', arch: 'x64' },
      { os: 'windows-11-arm', target: 'aarch64-pc-windows-msvc', arch: 'arm64' },
    ]);
    expect(rust['runs-on']).toBe('${{ matrix.os }}');
    expect(action(rust, 'actions/setup-node').with.architecture).toBe('${{ matrix.arch }}');
    expect(rust.steps.some(step => step.run === 'cargo build -p impeccable --target ${{ matrix.target }}')).toBe(true);
    expect(ci.jobs['rust-windows'].steps.some(step => step.run === 'cargo test --workspace --no-fail-fast')).toBe(true);
    const launcher = ci.jobs['launcher-windows'];
    expect(launcher.strategy.matrix.os).toEqual(['windows-latest', 'windows-11-arm']);
    expect(launcher['runs-on']).toBe('${{ matrix.os }}');
    expect(action(launcher, 'actions/setup-node').with.architecture).toBe("${{ runner.arch == 'ARM64' && 'arm64' || 'x64' }}");
    const native = rust.steps.find(step => step.name === 'Exercise native npm package and skill installation');
    expect(native.run).toBe('node --test tests/cli-native.test.mjs');
    expect(native.env.IMPECCABLE_BIN).toBe('${{ github.workspace }}/target/${{ matrix.target }}/debug/impeccable.exe');
    expect(ci.jobs.changes.outputs.oracle).toBe('${{ steps.plan.outputs.oracle }}');
  });

  test('builds and probes Windows ARM64 on a native runner', () => {
    const build = workflow.jobs.build;
    expect(build.strategy.matrix.include).toContainEqual({
      os: 'windows-11-arm', target: 'aarch64-pc-windows-msvc', short: 'windows-arm64',
    });
    expect(build.strategy.matrix.include).toContainEqual({
      os: 'windows-latest', target: 'x86_64-pc-windows-msvc', short: 'windows-x64',
    });
    expect(build['runs-on']).toBe('${{ matrix.os }}');
    const smoke = build.steps.find(step => step.name === 'Smoke the binary');
    expect(smoke.if).toBe('${{ !matrix.cross }}');
    expect(smoke.run).toContain('target/${{ matrix.target }}/release/impeccable');
    expect(smoke.run).toContain('engine-probe');
  });
});

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
    const windowsTargets = workflow.jobs.build.strategy.matrix.include
      .filter(target => target.short.startsWith('windows-')).map(target => target.short).sort();
    expect(windowsTargets).toEqual(['windows-arm64', 'windows-x64']);
    expect(action(workflow.jobs.build, 'actions/upload-artifact').with.name).toBe(
      "${{ runner.os == 'Windows' && format('unsigned-{0}', matrix.short) || format('impeccable-{0}', matrix.short) }}",
    );
    const sign = workflow.jobs['sign-windows'];
    expect([...sign.strategy.matrix.short].sort()).toEqual(windowsTargets);
    expect(sign.strategy['fail-fast']).toBe(false);
    expect(action(sign, 'actions/download-artifact').with.name).toBe('unsigned-${{ matrix.short }}');
    expect(action(sign, 'actions/upload-artifact').with.name).toBe('impeccable-${{ matrix.short }}');
    expect(workflow.jobs.publish.needs).toEqual(['build', 'sign-windows']);
    expect(action(workflow.jobs.publish, 'actions/download-artifact').with.pattern).toBe('impeccable-*');
    expect(workflow.jobs.publish.steps.find(step => step.name === 'Lay out release assets with checksums').run).toContain('sha256sum');
  });

  test('the x64 signing runner verifies signatures without running either engine', () => {
    const sign = workflow.jobs['sign-windows'];
    expect(sign['runs-on']).toBe('windows-latest');
    for (const step of sign.steps) {
      if (step.run) {
        expect(step.name).toBe('Verify signed engine');
        expect(step.run).toContain('Get-AuthenticodeSignature');
        expect(step.run).not.toMatch(/engine-probe|Start-Process|Invoke-Expression|&\s/);
      }
    }
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

  test('every third-party action is pinned to a commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
