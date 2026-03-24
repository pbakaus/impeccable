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
};
