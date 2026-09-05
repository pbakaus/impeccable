import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SUITES = ['core', 'oracle', 'detector', 'live', 'framework', 'plugin-e2e'];
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
  /^scripts\/lib\/(live-server-processes|process-group|test-orphan-reaper)\.mjs$/,
  /^tests\/lib\/live-servers\.mjs$/,
  /^scripts\/lib\/(live-server-processes|process-group|test-orphan-reaper)\.mjs$/,
  /^tests\/lib\/live-servers\.mjs$/,
  /^\.github\/workflows\/ci\.yml$/,
];

export const SUITES = {
  core: {
    description: 'Build, provider transforms, hook manifests, plugin validators, and prose gates.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^scripts\/(?!build-extension)/,
      /^skill\/(SKILL\.src\.md|agents\/|reference\/|scripts\/)/,
      /^ENGINE_VERSION$/,
      /^README(\.npm)?\.md$/,
      /^cli\/bin\//,
    ],
    commands: [
      {
        runner: 'bun',
        files: [
          'tests/build.test.js',
          'tests/lib/provider-blocks.test.js',
          'tests/lib/transformers/provider-blocks.test.js',
          'tests/lib/utils.test.js',
          'tests/lib/transformers/factory.test.js',
          'tests/lib/transformers/opencode-commands.test.js',
          'tests/lib/transformers/providers.test.js',
          'tests/root-commands-sync.test.js',
          'tests/validate-plugin-versions.test.js',
          'tests/validate-plugin-manifest.test.js',
          'tests/plugin-paths.test.js',
        ],
      },
      {
        runner: 'node',
        // A finite per-test cap so an async hang is cancelled and reported
        // rather than left running with `--test-timeout` unset (Infinity).
        // Note: this timer lives in the event loop, so it cannot interrupt a
        // test blocked in a synchronous spawnSync; the runner's wall-clock
        // group-kill covers that case. The slowest core test is ~11s, so 180s
        // is safe.
        timeoutMs: 180000,
        files: [
          'tests/ci-test-plan.test.mjs',
          'tests/cli-shim.test.mjs',
          'tests/launcher-download.test.mjs',
          'tests/publish-platform-packages.test.mjs',
          'tests/github-sheriff.test.mjs',
          'tests/hook-build.test.mjs',
          'tests/openai-plugin.test.mjs',
          'tests/process-group.test.mjs',
          'tests/release.test.mjs',
          'tests/bundle-signing.test.mjs',
          'tests/skill-reference.test.mjs',
          'tests/readme-gitignore.test.mjs',
          'tests/test-suites.test.mjs',
        ],
      },
    ],
  },
  // The verbs live in the engine binary; this repo pins its behavior with the
  // oracle goldens (tests/oracle) and drives its live-mode verbs over the
  // framework fixtures. Both skip when no binary is present (bun run
  // fetch:engine, or IMPECCABLE_BIN).
  oracle: {
    description: 'Oracle corpus replay against the engine binary; skips without a binary.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^ENGINE_VERSION$/,
      /^tests\/oracle\//,
      /^tests\/fixtures\//,
      /^tests\/lib\/engine-bin\.mjs$/,
      /^skill\/(reference\/|scripts\/)/,
    ],
    commands: [
      {
        runner: 'node',
        timeoutMs: 900000,
        files: ['tests/oracle.test.mjs'],
      },
    ],
  },
  detector: {
    description: 'Extension packaging checks (the rule logic itself is covered by the crate tests and the oracle).',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^extension\/(background|content|detector|devtools|offscreen|popup|shared|manifest\.json)/,
      /^scripts\/build-extension\.js$/,
      /^browser-bundle\//,
      // Everything `cargo xtask bundle` reads: the rules and the registry
      // rows (core, foundation), the wasm module (wasm), the assembly and the
      // registry serialization (bundle), and the task itself (xtask). Leaving
      // one out means a PR that changes what the bundle emits never rebuilds
      // it, and the tracked-output check in ci.yml then compares a committed
      // artifact against an untouched tree and passes on stale bytes.
      /^crates\/(bundle|core|foundation|wasm|xtask)\//,
      // The tracked artifacts themselves, so a hand-edit is regenerated over.
      /^crates\/live\/assets\//,
    ],
    commands: [
      {
        runner: 'node',
        files: ['tests/extension-build.test.mjs'],
      },
    ],
  },
  live: {
    description: 'Live-mode reference contract checks plus the live-e2e helper units (agent output, CLI options, LLM agent parsing, steer loop against the binary); the live verbs themselves are covered by the oracle and framework suites.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^skill\/(reference\/live\.md|scripts\/live-browser)/,
      /^tests\/live-e2e\//,
      /^tests\/lib\/engine-bin\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        files: [
          'tests/live-reference.test.mjs',
          'tests/live-browser-ignores.test.mjs',
          'tests/live-browser-source.test.mjs',
          'tests/live-e2e-agent-output.test.mjs',
          'tests/live-e2e-cli-options.test.mjs',
          'tests/live-e2e-llm-agent.test.mjs',
          'tests/live-e2e-steer-agent.test.mjs',
          'tests/live-e2e/agent-insert.test.mjs',
          'tests/live-server-leak.test.mjs',
        ],
      },
    ],
  },
  framework: {
    description: 'Framework fixture coverage for live injection, CSP detection, and wrapping through the engine binary; skips without a binary.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^ENGINE_VERSION$/,
      /^tests\/framework-fixtures/,
      /^tests\/framework-fixtures\.test\.mjs$/,
      /^tests\/lib\/engine-bin\.mjs$/,
    ],
    commands: [
      {
        runner: 'node',
        files: ['tests/framework-fixtures.test.mjs'],
      },
    ],
  },
  // `impeccable install/update/check` and their remote smoke moved into the
  // engine binary and its repo; the deterministic coverage here is the oracle
  // corpus. The lane name stays so ci.yml and package.json keep resolving.
  'cli-remote-e2e': {
    description: 'Remote CLI install/update smoke (moved to the engine repo; no tests here).',
    optIn: true,
    triggers: [...COMMON_INFRA_PATTERNS],
    commands: [],
  },
  'plugin-e2e': {
    description: 'Install the committed ./plugin subtree into a real (sandboxed) Claude Code and assert skills, agents, and hooks all load. Skips when the claude CLI is not on PATH.',
    triggers: [
      ...COMMON_INFRA_PATTERNS,
      /^plugin\//,
      /^skill\/agents\//,
      /^scripts\/build\.js$/,
      /^scripts\/lib\/validate-plugin-manifest\.js$/,
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
      /^skill\/scripts\/live-browser/,
      /^ENGINE_VERSION$/,
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
      /^ENGINE_VERSION$/,
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
      /^ENGINE_VERSION$/,
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
      /^skill\/reference\/(init|document|brand|product|shape|craft|audit|polish|live|routing)\.md$/,
      /^ENGINE_VERSION$/,
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
        // Overall wall-clock safety cap for the whole sweep: if a provider
        // call wedges past every inner guard (the harness's 840s per-turn
        // AbortSignal and the 900s per-test timeout), the runner SIGKILLs the
        // process group so the sweep still ends with a per-provider tally
        // instead of hanging overnight. Sized well above a healthy two-provider
        // sweep; override with IMPECCABLE_TEST_WALL_CLOCK_MS to scope it down.
        wallClockMs: 3_600_000,
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
      /^ENGINE_VERSION$/,
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
