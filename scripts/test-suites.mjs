import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SUITES = ['core', 'detector', 'live', 'framework'];
export const OPT_IN_SUITES = [
  'cli-remote-e2e',
  'live-e2e',
  'live-e2e-accept-cleanup',
  'skill-behavior',
  'live-svelte-adapter-deepseek',
];

const COMMON_INFRA_PATTERNS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^scripts\/run-tests\.mjs$/,
  /^scripts\/test-suites\.mjs$/,
  /^scripts\/ci-test-plan\.mjs$/,
  /^\.github\/workflows\/ci\.yml$/,
];

export const SUITES = {
  core: {
    description: 'Build, provider transforms, CLI helpers, context, and storage unit tests.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^scripts\/(?!benchmark-detector|build-browser-detector|build-extension)/,
      /^skill\/(SKILL\.src\.md|agents\/|reference\/|scripts\/(cleanup-deprecated|context|context-signals|critique-storage|design-parser|hook|impeccable-paths|is-generated))/,
      /^site\/(pages|content|components|layouts)\//,
      /^README(\.npm)?\.md$/,
      /^cli\/bin\//,
      /^tests\/(build|cleanup-deprecated|cli-ignores|context|context-signals|critique-storage|design-parser|docs-integrity|hook|hook-build|impeccable-paths|shiki-theme|skills-cli|target-args|test-suites|windows-path-fix|zip)\.test\.(js|mjs)$/,
      /^tests\/lib\//,
    ],
    commands: [
      {
        runner: 'bun',
        files: [
          'tests/build.test.js',
          'tests/cli-ignores.test.js',
          'tests/windows-path-fix.test.js',
          'tests/lib/provider-blocks.test.js',
          'tests/lib/transformers/provider-blocks.test.js',
          'tests/lib/utils.test.js',
          'tests/lib/impeccable-config.test.js',
          'tests/lib/transformers/factory.test.js',
          'tests/lib/transformers/providers.test.js',
          'tests/docs-integrity.test.js',
          'tests/skills-cli.test.js',
          'tests/validate-plugin-versions.test.js',
        ],
      },
      {
        runner: 'node',
        files: [
          'tests/ci-test-plan.test.mjs',
          'tests/context.test.mjs',
          'tests/context-signals.test.mjs',
          'tests/critique-storage.test.mjs',
          'tests/design-parser.test.mjs',
          'tests/hook-build.test.mjs',
          'tests/hook.test.mjs',
          'tests/impeccable-paths.test.mjs',
          'tests/target-args.test.mjs',
          'tests/shiki-theme.test.mjs',
          'tests/test-suites.test.mjs',
          'tests/zip.test.mjs',
        ],
      },
    ],
  },
  detector: {
    description: 'Anti-pattern detector tests across text, jsdom fixtures, and Puppeteer browser paths.',
    needsPuppeteer: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^cli\/engine\//,
      /^extension\/(background|content|detector|devtools|popup|manifest\.json)/,
      /^scripts\/(benchmark-detector|build-browser-detector|build-extension)\.js$/,
      /^site\/(pages\/detector|public\/antipattern|data\/anti-patterns-catalog\.js)/,
      /^tests\/design-system\.test\.mjs$/,
      /^tests\/(detect-antipatterns|inline-ignores|extension-build|fixtures\/antipatterns)/,
    ],
    commands: [
      {
        runner: 'bun',
        files: [
          'tests/detect-antipatterns.test.js',
          'tests/inline-ignores.test.mjs',
          'tests/lib/detector-bundle.test.js',
        ],
      },
      {
        runner: 'node',
        files: [
          'tests/extension-build.test.mjs',
          'tests/design-system.test.mjs',
          'tests/detect-antipatterns-fixtures.test.mjs',
          'tests/detect-antipatterns-browser.test.mjs',
        ],
      },
    ],
  },
  live: {
    description: 'Fast live-mode unit and local-server integration tests, excluding full browser fixture sweeps.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/(reference\/live\.md|scripts\/(detect-csp|lib\/is-generated|live\/|live|live-|modern-screenshot|pin|palette))/,
      /^tests\/live-/,
      /^tests\/live-e2e\/(agent|agents\/llm-agent|cli-options|preactions|session|steer|ui)\.mjs$/,
      /^tests\/live-e2e\/agent-insert\.test\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        files: [
          'tests/live-accept.test.mjs',
          'tests/live-accept-scrub.test.mjs',
          'tests/live-browser-dom.test.mjs',
          'tests/live-browser-script-parts.test.mjs',
          'tests/live-browser-regression.test.mjs',
          'tests/live-browser-session.test.mjs',
          'tests/live-browser-source.test.mjs',
          'tests/live-commit-manual-edits.test.mjs',
          'tests/live-completion.test.mjs',
          'tests/live-copy-edit-agent.test.mjs',
          'tests/live-discard-manual-edits.test.mjs',
          'tests/live-e2e-agent-output.test.mjs',
          'tests/live-e2e-cli-options.test.mjs',
          'tests/live-e2e-llm-agent.test.mjs',
          'tests/live-e2e-steer-agent.test.mjs',
          'tests/live-e2e/agent-insert.test.mjs',
          'tests/live-event-validation.test.mjs',
          'tests/live-inject.test.mjs',
          'tests/live-insert.test.mjs',
          'tests/live-insert-ui.test.mjs',
          'tests/live-manual-edits-buffer.test.mjs',
          'tests/live-poll.test.mjs',
          'tests/live-poll-stream.test.mjs',
          'tests/live-recovery-commands.test.mjs',
          'tests/live-reference.test.mjs',
          'tests/live-server.test.mjs',
          'tests/live-session-store.test.mjs',
          'tests/live-target-context.test.mjs',
          'tests/live-wrap.test.mjs',
          'tests/live-wrap-buffer-aware.test.mjs',
        ],
      },
    ],
  },
  framework: {
    description: 'Framework fixture coverage for live injection, CSP, generated-file detection, and wrapping.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^tests\/framework-fixtures/,
      /^tests\/framework-fixtures\.test\.mjs$/,
      /^skill\/scripts\/(detect-csp|live-inject|live-wrap)\.mjs$/,
      /^skill\/scripts\/lib\/is-generated\.mjs$/,
      /^skill\/scripts\/live\/sveltekit-adapter\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        files: ['tests/framework-fixtures.test.mjs'],
      },
    ],
  },
  'cli-e2e': {
    description: 'Deterministic CLI install/update tests against a local universal bundle.',
    commands: [
      {
        runner: 'bun',
        files: ['tests/skills-cli.test.js'],
      },
    ],
  },
  'cli-remote-e2e': {
    description: 'Remote CLI install/update smoke tests against impeccable.style.',
    optIn: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^cli\/bin\/commands\/skills\.mjs$/,
      /^tests\/skills-cli\.test\.js$/,
    ],
    commands: [
      {
        runner: 'bun',
        env: { IMPECCABLE_CLI_REMOTE_E2E: '1' },
        files: ['tests/skills-cli.test.js'],
      },
    ],
  },
  'live-e2e': {
    description: 'Full Playwright live-mode click-to-accept sweep across runtime framework fixtures.',
    optIn: true,
    needsPlaywright: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/scripts\/live/,
      /^tests\/framework-fixtures/,
      /^tests\/live-e2e(\.test\.mjs|\/)/,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 600000,
        forceExit: true,
        files: ['tests/live-e2e.test.mjs'],
      },
    ],
  },
  'live-e2e-accept-cleanup': {
    description: 'Provider-backed post-accept cleanup regression.',
    optIn: true,
    needsPlaywright: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/scripts\/(live-accept|live-browser|live-server|live-wrap)\.mjs$/,
      /^skill\/scripts\/live\/sveltekit-adapter\.mjs$/,
      /^tests\/live-e2e-accept-cleanup-regression\.test\.mjs$/,
      /^tests\/live-e2e\//,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 600000,
        files: ['tests/live-e2e-accept-cleanup-regression.test.mjs'],
      },
    ],
  },
  'live-e2e-agent': {
    description: 'Focused insert-mode fake-agent helper tests.',
    commands: [
      {
        runner: 'node',
        files: ['tests/live-e2e/agent-insert.test.mjs'],
      },
    ],
  },
  'skill-behavior': {
    description: 'LLM-backed skill setup behavior scenarios.',
    optIn: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/SKILL\.src\.md$/,
      /^skill\/reference\/(init|document|brand|product|shape|craft|audit|polish|live)\.md$/,
      /^skill\/scripts\/(context|context-signals|detect|detect-csp)\.mjs$/,
      /^tests\/skill-behavior\//,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 300000,
        files: ['tests/skill-behavior/scenarios.test.mjs'],
      },
    ],
  },
  'live-svelte-adapter-deepseek': {
    description: 'DeepSeek-backed Svelte adapter browser sweep.',
    optIn: true,
    needsPlaywright: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/scripts\/(live-server|live-wrap)\.mjs$/,
      /^skill\/scripts\/live\/(sveltekit-adapter|svelte-component)\.mjs$/,
      /^tests\/framework-fixtures\/vite8-sveltekit-stateful\//,
      /^tests\/live-svelte-adapter-deepseek\.test\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 1200000,
        files: ['tests/live-svelte-adapter-deepseek.test.mjs'],
      },
    ],
  },
};

export function expandSuites(requested) {
  const names = requested.length === 0 ? ['default'] : requested;
  const expanded = [];
  for (const name of names) {
    if (name === 'default' || name === 'all-local') {
      expanded.push(...DEFAULT_SUITES);
    } else if (name === 'all') {
      expanded.push(...DEFAULT_SUITES, ...OPT_IN_SUITES);
    } else if (SUITES[name]) {
      expanded.push(name);
    } else {
      throw new Error(`Unknown test suite "${name}". Run: node scripts/run-tests.mjs --list`);
    }
  }
  return [...new Set(expanded)];
}

export function suiteFiles(suiteNames) {
  const files = [];
  for (const name of suiteNames) {
    const suite = SUITES[name];
    if (!suite) throw new Error(`Unknown test suite "${name}"`);
    for (const command of suite.commands) {
      files.push(...command.files);
    }
  }
  return files;
}

export function findTestFiles(root = process.cwd()) {
  const out = [];
  const stack = [path.join(root, 'tests')];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (/\.test\.(js|mjs)$/.test(entry.name)) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  }
  return out.sort();
}

export function matchesSuiteTriggers(suiteName, changedFiles) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown test suite "${suiteName}"`);
  return changedFiles.some((file) => suite.triggers?.some((pattern) => pattern.test(file)));
}
