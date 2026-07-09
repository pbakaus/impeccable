import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  extractFindingIgnoreValue,
  filterDetectionFindings,
  getHookConsent,
  setHookConsent,
  getLocalConfigPath,
  getConfigPath,
  ensureConfigGitExclude,
  readDetectionConfig,
  readRawDetectionConfig,
  shouldIgnoreDetectionFile,
  writeDetectionConfig,
} from '../../cli/lib/impeccable-config.mjs';

describe('cli/lib/impeccable-config', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'imp-cfg-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('getHookConsent is undefined until a decision is recorded, then round-trips', () => {
    expect(getHookConsent(root)).toBeUndefined();
    setHookConsent(root, 'declined');
    expect(getHookConsent(root)).toBe('declined');
    setHookConsent(root, 'accepted');
    expect(getHookConsent(root)).toBe('accepted');
  });

  test('setHookConsent preserves unrelated keys in config.local.json', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getLocalConfigPath(root), JSON.stringify({ updateCheck: false, hook: { quiet: true } }));
    setHookConsent(root, 'declined');
    const raw = JSON.parse(readFileSync(getLocalConfigPath(root), 'utf-8'));
    expect(raw.updateCheck).toBe(false);
    expect(raw.hook.quiet).toBe(true);
    expect(raw.hook.consent).toBe('declined');
  });

  test('config.local.json (per-developer) overrides config.json for consent', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({ hook: { consent: 'accepted' } }));
    writeFileSync(getLocalConfigPath(root), JSON.stringify({ hook: { consent: 'declined' } }));
    expect(getHookConsent(root)).toBe('declined');
  });

  test('malformed config is tolerated (no throw, undefined consent)', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getLocalConfigPath(root), '{ not json');
    expect(getHookConsent(root)).toBeUndefined();
  });

  test('writing consent gitignores config.local.json via .git/info/exclude', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    setHookConsent(root, 'declined');
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('.impeccable/config.local.json');
    // Idempotent: a second write does not duplicate the marker block.
    ensureConfigGitExclude(root);
    const again = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    expect((again.match(/impeccable-config-ignore-start/g) || []).length).toBe(1);
    // It uses .git/info/exclude, not a tracked .gitignore.
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });

  test('ensureConfigGitExclude is a no-op outside a git repo', () => {
    expect(ensureConfigGitExclude(root)).toBe(false);
  });

  test('readDetectionConfig merges shared and local detector filters', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({
      detector: {
        ignoreRules: ['side-tab'],
        ignoreFiles: ['src/legacy/**'],
        ignoreValues: [
          { rule: 'overused-font', value: 'Avenir Next', reason: 'team default' },
          { rule: 'design-system-color', value: '*', files: ['src/demo.css'] },
        ],
        designSystem: { enabled: false },
      },
    }));
    writeFileSync(getLocalConfigPath(root), JSON.stringify({
      detector: {
        ignoreRules: ['gradient-text'],
        ignoreFiles: ['src/local/**'],
        ignoreValues: [
          { rule: 'overused-font', value: 'Avenir Next', reason: 'local override' },
          { rule: 'bounce-easing', value: 'bounce-ball' },
        ],
        designSystem: { enabled: true },
      },
    }));

    const cfg = readDetectionConfig(root);
    expect(cfg.ignoreRules).toEqual(['side-tab', 'gradient-text']);
    expect(cfg.ignoreFiles).toEqual(['src/legacy/**', 'src/local/**']);
    expect(cfg.ignoreValues).toEqual([
      { rule: 'overused-font', value: 'avenir next', reason: 'local override' },
      { rule: 'design-system-color', value: '*', files: ['src/demo.css'] },
      { rule: 'bounce-easing', value: 'bounce-ball' },
    ]);
    expect(cfg.designSystem).toEqual({ enabled: true });
  });

  test('readDetectionConfig remains backward-compatible with legacy hook filters', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({
      hook: {
        ignoreRules: ['side-tab'],
        ignoreFiles: ['src/legacy/**'],
        ignoreValues: [{ rule: 'overused-font', value: 'Avenir Next' }],
        designSystem: { enabled: false },
      },
    }));
    const cfg = readDetectionConfig(root);
    expect(cfg.ignoreRules).toEqual(['side-tab']);
    expect(cfg.ignoreFiles).toEqual(['src/legacy/**']);
    expect(cfg.ignoreValues).toEqual([{ rule: 'overused-font', value: 'avenir next' }]);
    expect(cfg.designSystem).toEqual({ enabled: false });
  });

  test('writeDetectionConfig writes detector config and strips legacy hook filters', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({
      updateCheck: false,
      hook: {
        consent: 'accepted',
        quiet: true,
        ignoreRules: ['legacy-rule'],
        ignoreFiles: ['legacy/**'],
        ignoreValues: [{ rule: 'overused-font', value: 'Legacy' }],
      },
    }));

    const config = readRawDetectionConfig(root);
    config.ignoreRules.push('side-tab');
    config.ignoreFiles.push('src/legacy/**');
    writeDetectionConfig(root, config);

    const raw = JSON.parse(readFileSync(getConfigPath(root), 'utf-8'));
    expect(raw.updateCheck).toBe(false);
    expect(raw.hook).toEqual({ consent: 'accepted', quiet: true });
    expect(raw.detector.ignoreRules).toEqual(['legacy-rule', 'side-tab']);
    expect(raw.detector.ignoreFiles).toEqual(['legacy/**', 'src/legacy/**']);
    expect(raw.detector.ignoreValues).toEqual([{ rule: 'overused-font', value: 'legacy' }]);
    expect(raw.detector.designSystem).toBeUndefined();
  });

  test('writeDetectionConfig local ignores do not create an implicit design-system override', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({
      detector: { designSystem: { enabled: false } },
    }));

    const local = readRawDetectionConfig(root, { local: true });
    local.ignoreValues.push({ rule: 'overused-font', value: 'Inter' });
    writeDetectionConfig(root, local, { local: true });

    const rawLocal = JSON.parse(readFileSync(getLocalConfigPath(root), 'utf-8'));
    expect(rawLocal.detector.designSystem).toBeUndefined();
    expect(readDetectionConfig(root).designSystem).toEqual({ enabled: false });
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8')).toContain('.impeccable/config.local.json');
  });

  test('shouldIgnoreDetectionFile matches relative and absolute paths', () => {
    const cfg = { ignoreFiles: ['src/legacy/**', '*.generated.tsx'] };
    expect(shouldIgnoreDetectionFile(join(root, 'src', 'legacy', 'Card.tsx'), root, cfg)).toBe(true);
    expect(shouldIgnoreDetectionFile(join(root, 'src', 'Card.generated.tsx'), root, cfg)).toBe(true);
    expect(shouldIgnoreDetectionFile(join(root, 'src', 'Card.tsx'), root, cfg)).toBe(false);
  });

  test('filterDetectionFindings matches hook ignore value semantics', () => {
    const findings = [
      { antipattern: 'overused-font', file: join(root, 'src', 'main.css'), line: 1, snippet: 'Primary font: Avenir Next' },
      { antipattern: 'overused-font', file: join(root, 'src', 'other.css'), line: 2, snippet: 'Primary font: Karla' },
      { antipattern: 'design-system-color', file: join(root, 'src', 'demo.css'), line: 3, ignoreValue: '#8b5cf6' },
      { antipattern: 'design-system-color', file: join(root, 'src', 'real.css'), line: 4, ignoreValue: '#8b5cf6' },
      { antipattern: 'design-system-font', file: join(root, 'src', 'demo.css'), line: 5, ignoreValue: 'Avenir Next' },
    ];
    const filtered = filterDetectionFindings(findings, {
      ignoreRules: [],
      ignoreValues: [
        { rule: 'overused-font', value: 'avenir next' },
        { rule: 'design-system-color', value: '*', files: ['src/demo.css'] },
        { rule: 'design-system-font', value: '*' },
      ],
    });

    expect(filtered.map((f) => `${f.antipattern}:${f.line}`)).toEqual([
      'overused-font:2',
      'design-system-color:4',
      'design-system-font:5',
    ]);
  });

  test('filterDetectionFindings honors file-scoped wildcard ignores for non-value-bearing rules', () => {
    const findings = [
      { antipattern: 'side-tab', file: join(root, 'components', 'TopicCard.jsx'), line: 331, snippet: "borderLeft: '7px solid" },
      { antipattern: 'side-tab', file: join(root, 'components', 'Other.jsx'), line: 12, snippet: "borderLeft: '7px solid" },
    ];
    const filtered = filterDetectionFindings(findings, {
      ignoreRules: [],
      ignoreValues: [{ rule: 'side-tab', value: '*', files: ['**/TopicCard.jsx'] }],
    });
    expect(filtered.map((f) => `${f.antipattern}:${f.line}`)).toEqual(['side-tab:12']);
  });

  test('filterDetectionFindings matches equivalent design-system color values', () => {
    const findings = [
      { antipattern: 'design-system-color', file: join(root, 'src', 'rgb.css'), line: 1, ignoreValue: 'rgb(139, 92, 246)' },
      { antipattern: 'design-system-color', file: join(root, 'src', 'hex.css'), line: 2, ignoreValue: '#8b5cf6' },
      { antipattern: 'design-system-color', file: join(root, 'src', 'alpha.css'), line: 3, ignoreValue: 'rgba(139, 92, 246, 0.5)' },
      { antipattern: 'design-system-color', file: join(root, 'src', 'other.css'), line: 4, ignoreValue: '#8b5cf7' },
      { antipattern: 'design-system-radius', file: join(root, 'src', 'radius.css'), line: 5, ignoreValue: 'rgb(139, 92, 246)' },
    ];
    const filtered = filterDetectionFindings(findings, {
      ignoreValues: [
        { rule: 'design-system-color', value: '#8b5cf6' },
        { rule: 'design-system-color', value: 'rgb(139 92 246 / 100%)' },
      ],
    });

    expect(filtered.map((f) => `${f.antipattern}:${f.line}`)).toEqual([
      'design-system-color:3',
      'design-system-color:4',
      'design-system-radius:5',
    ]);
  });

  test('extractFindingIgnoreValue handles fonts, Google font URLs, and motion snippets', () => {
    expect(extractFindingIgnoreValue({ antipattern: 'overused-font', snippet: 'Primary font: Avenir Next (80% of text)' })).toBe('avenir next');
    expect(extractFindingIgnoreValue({ antipattern: 'overused-font', snippet: 'https://fonts.googleapis.com/css2?family=Alumni+Sans:wght@700' })).toBe('alumni sans');
    expect(extractFindingIgnoreValue({ antipattern: 'bounce-easing', snippet: 'animation: bounce-ball 1s infinite' })).toBe('bounce-ball');
  });
});
