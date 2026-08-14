/**
 * Astro registry entry.
 *
 * Astro takes the generic tag strategy, with two Astro-specific values that
 * used to sit as inline `endsWith('.astro')` branches in live-inject.mjs and
 * live-wrap.mjs:
 *
 *   injectScriptAttrs  Astro processes <script> tags by default and rewrites
 *                      src to its own bundled URL; is:inline opts out.
 *   styleMode          Astro scopes component styles, which strips preview CSS
 *                      off the generated variant wrappers, so preview rules are
 *                      authored global and prefixed instead of @scope'd.
 */

import { findConfigFile, hasAnyDependency, literalConfigFiles } from './detect-utils.mjs';

const ASTRO_CONFIG_RE = /^astro\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

export function detectAstroProject(cwd = process.cwd(), config = null) {
  const configFile = findConfigFile(cwd, ASTRO_CONFIG_RE);
  if (configFile) return { configFile, via: 'config' };
  if (hasAnyDependency(cwd, ['astro'])) return { configFile: null, via: 'package' };
  // A tree of .astro entry templates with no astro.config still belongs to
  // Astro; the configured injection target names it.
  const entry = literalConfigFiles(cwd, config).find((rel) => rel.endsWith('.astro'));
  if (entry) return { configFile: null, via: 'config-files', entry };
  return null;
}

export const astro = {
  name: 'astro',

  detect(cwd, config) {
    return detectAstroProject(cwd, config);
  },

  inject: { kind: 'tag' },

  source: {
    extensions: ['.astro'],
    preview: 'source',
    styleMode: 'astro-global-prefixed',
    styleTag: '<style is:inline data-impeccable-css="SESSION_ID">',
    commentSyntax: 'html',
    injectScriptAttrs: 'is:inline ',
  },
};
