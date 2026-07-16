import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SUITES = ['core', 'detector', 'live', 'framework', 'plugin-e2e'];
export const OPT_IN_SUITES = [
  'cli-remote-e2e',
  'live-e2e',
  'live-e2e-accept-cleanup',
  'new-work-e2e',
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
      /^picker\//,
      /^scripts\/(?!benchmark-detector|build-browser-detector|build-extension)/,
      /^skill\/(SKILL\.src\.md|agents\/|reference\/|scripts\/(cleanup-deprecated|comp-diff|comp-spec|build-phase|font-match|data\/font-index|concept-seed|generate-image|context|context-signals|critique-storage|design-parser|doctor|hook|impeccable-paths|is-generated|lib\/(artifact-schema|png|raster|image-metrics|font-fingerprint|font-index|hero-checks|composition-catalog|concept-catalog|provider|staleness|staleness-deep|staleness-notice|surface-briefs|target-slug|template-extensions)|picker|pin|surface-brief))/,
      /^site\/(pages|content|components|layouts)\//,
      /^README(\.npm)?\.md$/,
      /^cli\/bin\//,
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
          'tests/skills-cli.test.js',
          'tests/validate-plugin-versions.test.js',
          'tests/validate-plugin-manifest.test.js',
          'tests/plugin-paths.test.js',
        ],
      },
      {
        runner: 'node',
        files: [
          'tests/ci-test-plan.test.mjs',
          'tests/cli-args.test.mjs',
          'tests/concept-seed.test.mjs',
          'tests/generate-image-embed.test.mjs',
          'tests/comp-diff.test.mjs',
          'tests/build-phase.test.mjs',
          'tests/font-match.test.mjs',
          'tests/hero-checks.test.mjs',
          'tests/serve-question.test.mjs',
          'tests/context.test.mjs',
          'tests/context-signals.test.mjs',
          'tests/critique-storage.test.mjs',
          'tests/design-parser.test.mjs',
          'tests/github-sheriff.test.mjs',
          'tests/hook-build.test.mjs',
          'tests/hook.test.mjs',
          'tests/impeccable-paths.test.mjs',
          'tests/openai-plugin.test.mjs',
          'tests/picker-server.test.mjs',
          'tests/pin.test.mjs',
          'tests/release.test.mjs',
          'tests/doctor.test.mjs',
          'tests/staleness.test.mjs',
          'tests/skill-reference.test.mjs',
          'tests/readme-gitignore.test.mjs',
          'tests/target-args.test.mjs',
          'tests/surface-brief.test.mjs',
          'tests/template-extensions.test.mjs',
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
      /^tests\/fixtures\/antipatterns/,
    ],
    commands: [
      {
        runner: 'bun',
        files: [
          'tests/detect-antipatterns.test.js',
          'tests/detect-url-launch.test.mjs',
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
          'tests/detect-cli-design-contamination.test.mjs',
          'tests/detect-cli-design-monorepo.test.mjs',
          'tests/detect-cli-stdin-dispatch.test.mjs',
        ],
      },
    ],
  },
  live: {
    description: 'Fast live-mode unit and local-server integration tests, excluding full browser fixture sweeps.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      // `palette` is deliberately absent: skill/scripts/palette.mjs has no
      // test anywhere, and listing it here made edits run a suite that never
      // touches it, which reads as coverage that does not exist.
      /^skill\/(reference\/live\.md|scripts\/(detect-csp|lib\/is-generated|lib\/template-extensions|live\/|live|live-|modern-screenshot|pin))/,
      /^tests\/live-/,
    ],
    commands: [
      {
        runner: 'node',
        files: [
          'tests/live-accept.test.mjs',
          'tests/live-accept-css.test.mjs',
          'tests/live-accept-scrub.test.mjs',
          'tests/live-browser-dom.test.mjs',
          'tests/live-browser-ignores.test.mjs',
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
          'tests/live-frameworks.test.mjs',
          'tests/live-generation-preflight.test.mjs',
          'tests/live-inject.test.mjs',
          'tests/live-insert.test.mjs',
          'tests/live-insert-ui.test.mjs',
          'tests/live-manual-edits-buffer.test.mjs',
          'tests/live-poll.test.mjs',
          'tests/live-project-ignores.test.mjs',
          'tests/live-poll-lanes.test.mjs',
          'tests/live-poll-stream.test.mjs',
          'tests/live-recovery-commands.test.mjs',
          'tests/live-reference.test.mjs',
          'tests/live-roots.test.mjs',
          'tests/live-server.test.mjs',
          'tests/live-session-store.test.mjs',
          'tests/live-source-lock.test.mjs',
          'tests/live-source-search.test.mjs',
          'tests/live-svelte-ast.test.mjs',
          'tests/live-svelte-component-accept.test.mjs',
          'tests/live-svelte-props-script.test.mjs',
          'tests/live-tanstack-adapter.test.mjs',
          'tests/live-target-context.test.mjs',
          'tests/live-ui-surfaces.test.mjs',
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
      /^skill\/scripts\/lib\/template-extensions\.mjs$/,
      /^skill\/scripts\/live\/(source-search|sveltekit-adapter|tanstack-adapter)\.mjs$/,
      /^skill\/scripts\/live\/frameworks\//,
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
  'plugin-e2e': {
    description: 'Install the committed ./plugin subtree into a real (sandboxed) Claude Code and assert skills, agents, and hooks all load. Skips when the claude CLI is not on PATH.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^plugin\//,
      /^skill\/agents\//,
      /^scripts\/build\.js$/,
      /^scripts\/lib\/validate-plugin-manifest\.js$/,
      /^scripts\/lib\/plugin-paths\.js$/,
      /^tests\/plugin-e2e\.test\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 300000,
        forceExit: true,
        files: ['tests/plugin-e2e.test.mjs'],
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
  'new-work-e2e': {
    description: 'Playwright smoke sweep of the new-work concept/serve-question decision page plus the offline fake image generator.',
    optIn: true,
    needsPlaywright: true,
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/scripts\/(serve-question|generate-image|concept-seed)\.mjs$/,
      /^tests\/new-work-e2e(\.test\.mjs|\/)/,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 600000,
        forceExit: true,
        files: ['tests/new-work-e2e.test.mjs'],
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
        // 300000 was too low to measure what these scenarios assert. The
        // workflow-contract turns run 20+ steps against a frontier model, and
        // the *correct* path is the slow one: a run that stops to put the
        // concept to the user before building was measured at 579s, while the
        // runs that skipped that checkpoint and failed the assertion finished
        // in 130-200s. At a 300s cap the thorough path is killed and the hasty
        // path is graded, so the cap was selecting for the behavior the suite
        // exists to forbid.
        timeoutMs: 900000,
        files: [
          'tests/skill-behavior/scenarios.test.mjs',
          'tests/skill-behavior/workflow-contract.test.mjs',
        ],
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every suite must select itself when one of its own test files changes.
// Generated from the files lists so the hand-written trigger patterns above
// only carry source paths and fixture directories; before this, four test
// files were registered in a suite that change-based CI could never select
// by editing them (serve-question, ci-test-plan, both validate-plugin-*),
// and tests/lib/detector-bundle.test.js triggered core while running in
// detector. The meta-test in tests/test-suites.test.mjs pins this invariant.
for (const suite of Object.values(SUITES)) {
  const ownFiles = suite.commands.flatMap((command) => command.files);
  suite.triggers = [
    ...(suite.triggers ?? []),
    ...ownFiles.map((file) => new RegExp(`^${escapeRegExp(file)}$`)),
  ];
}

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
