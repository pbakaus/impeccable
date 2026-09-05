import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

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
