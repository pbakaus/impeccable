export const FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS = Object.freeze({
  cursor: '.cursor',
  'claude-code': '.claude',
  gemini: '.gemini',
  codex: '.codex',
  agents: '.agents',
  github: '.github',
  kiro: '.kiro',
  opencode: '.opencode',
  pi: '.pi',
  qoder: '.qoder',
});

export const FILE_DOWNLOAD_PROVIDERS = Object.freeze(
  Object.keys(FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS)
);

export const BUNDLE_DOWNLOAD_PROVIDERS = Object.freeze([
  'universal',
]);

export const DOWNLOAD_PROVIDERS = Object.freeze([
  ...FILE_DOWNLOAD_PROVIDERS,
  ...BUNDLE_DOWNLOAD_PROVIDERS,
]);
