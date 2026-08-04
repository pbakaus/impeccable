// Nothing in this repo imports this module. Its consumers are the Cloudflare
// Pages Functions in the private impeccable-site repo (functions/api/download/
// bundle/[provider].js and [type]/[provider]/[id].js), which share cli/lib/.
// Do not remove it as dead code; keep the provider list in sync with the
// harness dirs the build emits.
export const FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS = Object.freeze({
  cursor: '.cursor',
  'claude-code': '.claude',
  gemini: '.gemini',
  codex: '.codex',
  agents: '.agents',
  antigravity: '.agent',
  github: '.github',
  grok: '.grok',
  kiro: '.kiro',
  opencode: '.opencode',
  pi: '.pi',
  qoder: '.qoder',
  vibe: '.vibe',
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
