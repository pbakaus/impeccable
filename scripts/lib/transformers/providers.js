/**
 * Provider configurations for the transformer factory.
 *
 * Each config specifies:
 * - provider: key into PROVIDER_PLACEHOLDERS (e.g. 'claude-code')
 * - configDir: dot-directory name (e.g. '.claude')
 * - displayName: human-readable name for log output (e.g. 'Claude Code')
 * - frontmatterFields: which optional fields to emit beyond name + description
 * - bodyTransform: optional function (body, skill) => transformed body
 */
export const PROVIDERS = {
  cursor: {
    provider: 'cursor',
    configDir: '.cursor',
    displayName: 'Cursor',
    frontmatterFields: ['license', 'compatibility', 'metadata'],
  },
  'claude-code': {
    provider: 'claude-code',
    configDir: '.claude',
    displayName: 'Claude Code',
    frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata', 'allowed-tools'],
  },
  gemini: {
    provider: 'gemini',
    configDir: '.gemini',
    displayName: 'Gemini',
    frontmatterFields: [],
  },
  codex: {
    provider: 'codex',
    configDir: '.codex',
    displayName: 'Codex',
    frontmatterFields: ['argument-hint', 'license'],
  },
  agents: {
    provider: 'agents',
    configDir: '.agents',
    displayName: 'Agents',
    frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata'],
  },
  kiro: {
    provider: 'kiro',
    configDir: '.kiro',
    displayName: 'Kiro',
    frontmatterFields: ['license', 'compatibility', 'metadata'],
  },
  opencode: {
    provider: 'opencode',
    configDir: '.opencode',
    displayName: 'OpenCode',
    frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata', 'allowed-tools'],
  },
  pi: {
    provider: 'pi',
    configDir: '.pi',
    displayName: 'Pi',
    frontmatterFields: ['license', 'compatibility', 'metadata', 'allowed-tools'],
  },
  'trae-cn': {
    provider: 'trae-cn',
    configDir: '.trae-cn',
    displayName: 'Trae China',
    placeholderProvider: 'trae',
    frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata'],
  },
  trae: {
    provider: 'trae',
    configDir: '.trae',
    displayName: 'Trae',
    frontmatterFields: ['user-invocable', 'argument-hint', 'license', 'compatibility', 'metadata'],
  },
  openclaw: {
    provider: 'openclaw',
    configDir: '.openclaw',
    displayName: 'OpenClaw',
    frontmatterFields: ['license', 'compatibility'],
    // OpenClaw uses an extended SKILL.md frontmatter schema with permissions,
    // triggers, and metadata. These are injected via frontmatterEnrich rather
    // than FIELD_SPECS since they have a fixed structure per-provider.
    // See: https://github.com/rohitg00/skillkit/pull/86
    frontmatterEnrich: (fm) => {
      fm.version = '1.0.0';
      fm.permissions = { filesystem: 'none', network: false };
      fm.triggers = [{ command: `/${fm.name}` }];
      fm.metadata = {
        openclaw: {
          requires: { bins: [], env: [] },
        },
      };
      // OpenClaw gateway routes skills by trigger-phrase descriptions.
      // Descriptions must start with a verb phrase like "Use when".
      if (
        fm.description &&
        !/^(Use when|Use for|Use to|Run when|Run |Invoke when|Invoke )/i.test(fm.description)
      ) {
        const desc = fm.description;
        // Bridge naturally: "Run X" → "Use when you want to run X"
        const lower = desc[0].toLowerCase() + desc.slice(1);
        fm.description = `Use when you want to ${lower}`;
      }
    },
  },
};
