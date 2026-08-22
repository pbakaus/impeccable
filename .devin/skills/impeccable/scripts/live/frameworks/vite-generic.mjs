/**
 * Generic Vite registry entry: a bundled app with a real `index.html` entry
 * and no framework-specific document ownership. React, Vue, Solid, Preact and
 * a plain TanStack Router SPA all land here — the marker-wrapped script block
 * goes straight into the HTML entry.
 *
 * This is the entry that catches everything with a bundler config; only
 * static-html sits below it.
 */

import { fileExists, findConfigFile, hasAnyDependency } from './detect-utils.mjs';

const VITE_CONFIG_RE = /^vite\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

export function detectViteProject(cwd = process.cwd()) {
  const configFile = findConfigFile(cwd, VITE_CONFIG_RE);
  if (configFile) return { configFile, via: 'config' };
  if (hasAnyDependency(cwd, ['vite'])) return { configFile: null, via: 'package' };
  // A zero-config Vite app is index.html + package.json, the same pair
  // roots.mjs treats as an app root.
  if (fileExists(cwd, 'index.html') && fileExists(cwd, 'package.json')) {
    return { configFile: null, via: 'zero-config' };
  }
  return null;
}

export const viteGeneric = {
  name: 'vite-generic',

  detect(cwd) {
    return detectViteProject(cwd);
  },

  inject: { kind: 'tag' },

  source: {
    extensions: ['.tsx', '.jsx'],
    preview: 'source',
    styleMode: 'scoped',
    commentSyntax: 'jsx',
  },
};
