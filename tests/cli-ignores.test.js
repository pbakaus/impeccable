import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = resolve('cli/bin/cli.js');

describe('impeccable ignores CLI', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'imp-ignores-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(args, options = {}) {
    const result = spawnSync(process.execPath, [CLI, 'ignores', ...args], {
      cwd: root,
      encoding: 'utf-8',
      ...options,
    });
    if (result.error) throw result.error;
    return result;
  }

  function detect(args, options = {}) {
    const result = spawnSync(process.execPath, [CLI, 'detect', '--json', ...args], {
      cwd: root,
      encoding: 'utf-8',
      ...options,
    });
    if (result.error) throw result.error;
    return result;
  }

  function readConfig(name = 'config.json') {
    return JSON.parse(readFileSync(join(root, '.impeccable', name), 'utf-8'));
  }

  test('adds and lists shared file and value ignores under detector', () => {
    expect(run(['add-file', 'src/legacy/**']).status).toBe(0);
    expect(run(['add-value', 'overused-font', 'Inter', '--reason', 'Brand font']).status).toBe(0);

    const raw = readConfig();
    expect(raw.hook).toBeUndefined();
    expect(raw.detector.ignoreFiles).toEqual(['src/legacy/**']);
    expect(raw.detector.ignoreValues.map(({ rule, value, reason }) => ({ rule, value, reason }))).toEqual([
      { rule: 'overused-font', value: 'inter', reason: 'Brand font' },
    ]);
    expect(raw.detector.designSystem).toBeUndefined();

    const listed = run(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('ignoreFiles:  src/legacy/**');
    expect(listed.stdout).toContain('overused-font=inter');
  });

  test('supports scoped wildcard value ignores and removal', () => {
    expect(run(['add-value', 'design-system-color', '*', '--file', 'site/styles/demo.css']).status).toBe(0);
    let raw = readConfig();
    expect(raw.detector.ignoreValues).toEqual([
      expect.objectContaining({
        rule: 'design-system-color',
        value: '*',
        files: ['site/styles/demo.css'],
      }),
    ]);

    expect(run(['remove-value', 'design-system-color', '*', '--file', 'site/styles/demo.css']).status).toBe(0);
    raw = readConfig();
    expect(raw.detector.ignoreValues).toEqual([]);
  });

  test('file-scoped wildcard value ignores suppress non-value-bearing rules only in matching files', () => {
    mkdirSync(join(root, 'components'), { recursive: true });
    const triangle = [
      'export function TopicCard() {',
      '  return (',
      '    <div style={{',
      '      width: 0, height: 0,',
      "      borderLeft: '7px solid transparent',",
      "      borderRight: '7px solid transparent',",
      "      borderTop: '7px solid #fff',",
      '    }} />',
      '  );',
      '}',
      '',
    ].join('\n');
    writeFileSync(join(root, 'components', 'TopicCard.jsx'), triangle);
    writeFileSync(join(root, 'components', 'Other.jsx'), triangle.replace('TopicCard', 'Other'));

    const before = detect(['components/TopicCard.jsx']);
    expect(before.status).toBe(2);
    expect(before.stdout).toContain('side-tab');

    expect(run(['add-value', 'side-tab', '*', '--file', '**/TopicCard.jsx']).status).toBe(0);

    const afterTarget = detect(['components/TopicCard.jsx']);
    expect(afterTarget.status).toBe(0);
    expect(afterTarget.stdout.trim()).toBe('[]');

    const afterOther = detect(['components/Other.jsx']);
    expect(afterOther.status).toBe(2);
    expect(afterOther.stdout).toContain('side-tab');
  });

  test('rejects broad wildcard value ignores', () => {
    const result = run(['add-value', 'design-system-color', '*']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Wildcard value ignores must be scoped');
    expect(existsSync(join(root, '.impeccable', 'config.json'))).toBe(false);
  });

  test('removes an existing broad wildcard value ignore', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(join(root, '.impeccable', 'config.json'), JSON.stringify({
      detector: {
        ignoreValues: [{ rule: 'design-system-color', value: '*' }],
      },
    }));

    const result = run(['remove-value', 'design-system-color', '*']);
    expect(result.status).toBe(0);
    expect(readConfig().detector.ignoreValues).toEqual([]);
  });

  test('writes local ignores without overriding shared design-system config', () => {
    expect(run(['add-value', 'overused-font', 'Inter', '--local']).status).toBe(0);

    const local = readConfig('config.local.json');
    expect(local.detector.ignoreValues.map(({ rule, value }) => ({ rule, value }))).toEqual([
      { rule: 'overused-font', value: 'inter' },
    ]);
    expect(local.detector.designSystem).toBeUndefined();
  });
});
