/**
 * Next.js registry entry.
 *
 * Next takes the generic tag strategy: the App Router's root layout renders
 * `<html>…<body>` in JSX, so the marker-wrapped script block goes in there
 * verbatim. Nothing about injection differs from a plain Vite app, which is
 * why live-inject.mjs never had a Next branch. The entry exists so the
 * registry can name what it is looking at.
 */

import { fileExists, findConfigFile, hasAnyDependency } from './detect-utils.mjs';

const NEXT_CONFIG_RE = /^next\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

const ROUTER_ENTRY_CANDIDATES = [
  'app/layout.tsx', 'app/layout.jsx', 'app/layout.ts', 'app/layout.js',
  'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.ts', 'src/app/layout.js',
  'pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.ts', 'pages/_app.js',
  'pages/_document.tsx', 'pages/_document.jsx',
  'src/pages/_app.tsx', 'src/pages/_app.jsx',
];

export function detectNextProject(cwd = process.cwd()) {
  const configFile = findConfigFile(cwd, NEXT_CONFIG_RE);
  if (configFile) return { configFile, via: 'config' };
  if (hasAnyDependency(cwd, ['next'])) return { configFile: null, via: 'package' };
  // Next's file conventions are distinctive enough to stand alone: a root
  // `app/layout.*` or `pages/_app.*` is not a shape other bundlers produce.
  const entry = ROUTER_ENTRY_CANDIDATES.find((rel) => fileExists(cwd, rel));
  if (entry) return { configFile: null, via: 'router-entry', entry };
  return null;
}

export const nextjs = {
  name: 'nextjs',

  detect(cwd) {
    return detectNextProject(cwd);
  },

  inject: { kind: 'tag' },

  source: {
    extensions: ['.tsx', '.jsx'],
    preview: 'source',
    styleMode: 'scoped',
    commentSyntax: 'jsx',
  },
};
