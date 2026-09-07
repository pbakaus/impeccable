import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

const directory = new URL('../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(readdirSync(directory)
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => [name, Bun.YAML.parse(readFileSync(new URL(name, directory), 'utf8'))]));

describe('workflow execution boundaries', () => {
  test('repository actions are pinned to full commit SHAs', () => {
    for (const [name, workflow] of Object.entries(workflows)) {
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps || []) {
          if (!step.uses || step.uses.startsWith('./')) continue;
          expect(step.uses, `${name}: ${jobName}`).toMatch(/@[a-f0-9]{40}$/);
        }
      }
    }
  });

  test('CI uses a read-only repository token without job-level escalation', () => {
    const ci = workflows['ci.yml'];
    expect(ci.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(ci.jobs)) {
      expect(job.permissions).toBeUndefined();
    }
  });

  test('generated-output sync and sheriff retain their required write access', () => {
    expect(workflows['sync-generated-output.yml'].permissions).toEqual({ contents: 'write' });
    expect(workflows['sheriff.yml'].permissions).toEqual({
      actions: 'read', checks: 'read', contents: 'read', issues: 'write', 'pull-requests': 'write',
    });
  });
});
