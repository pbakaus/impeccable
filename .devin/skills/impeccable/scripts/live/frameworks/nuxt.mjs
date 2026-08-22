/**
 * Nuxt registry entry, and the Nuxt adapter itself.
 *
 * A script element placed in app.vue is compiled as Vue-rendered DOM and is
 * not executed. Nuxt instead auto-discovers client plugins. Keep the adapter
 * generated, dev-only, and outside user-authored source: Live creates one
 * marked .client.ts plugin on start and removes it on stop.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildLiveScriptSrc } from './script-src.mjs';
import { findConfigFile } from './detect-utils.mjs';

export const NUXT_PLUGIN_MARKER = 'impeccable-live-nuxt-plugin';
export const NUXT_PLUGIN_NAME = 'impeccable-live.client.ts';

const NUXT_CONFIG_RE = /^nuxt\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

export function detectNuxtProject(cwd = process.cwd()) {
  const configFile = findConfigFile(cwd, NUXT_CONFIG_RE);
  if (!configFile) return null;

  const config = fs.readFileSync(path.join(cwd, configFile), 'utf-8');
  const literalSrcDir = config.match(/\bsrcDir\s*:\s*(['"])([^'"]+)\1/);
  let appDir = '';
  if (literalSrcDir) {
    const candidate = literalSrcDir[2]
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/+$/, '');
    const normalized = path.posix.normalize(candidate);
    if (normalized !== '..' && !normalized.startsWith('../') && !path.isAbsolute(normalized)) {
      appDir = normalized === '.' ? '' : normalized;
    }
  } else if (
    fs.existsSync(path.join(cwd, 'app', 'app.vue'))
    || fs.existsSync(path.join(cwd, 'app', 'pages'))
  ) {
    appDir = 'app';
  }

  const pluginFile = [appDir, 'plugins', NUXT_PLUGIN_NAME].filter(Boolean).join('/');
  return { configFile, appDir, pluginFile };
}

export function buildNuxtPlugin(port, token) {
  return `/* ${NUXT_PLUGIN_MARKER} */
const liveSrc = '${buildLiveScriptSrc(port, token)}';
const liveSelector = 'script[data-impeccable-live-nuxt]';

export default defineNuxtPlugin(() => {
  if (!import.meta.dev || typeof document === 'undefined') return;

  const expectedSrc = new URL(liveSrc, window.location.href).href;
  let script = document.querySelector(liveSelector);
  if (script?.src === expectedSrc) return;
  script?.remove();

  script = document.createElement('script');
  script.src = liveSrc;
  script.async = true;
  script.dataset.impeccableLiveNuxt = '';
  document.head.appendChild(script);

  import.meta.hot?.dispose(() => {
    if (script?.isConnected) script.remove();
  });
});
/* /${NUXT_PLUGIN_MARKER} */
`;
}

export function applyNuxtLiveAdapter({ cwd = process.cwd(), port, token, project = detectNuxtProject(cwd) }) {
  if (!project) return { error: 'nuxt_not_detected' };
  const absFile = path.join(cwd, project.pluginFile);
  const existing = fs.existsSync(absFile) ? fs.readFileSync(absFile, 'utf-8') : null;
  if (existing !== null && !existing.includes(NUXT_PLUGIN_MARKER)) {
    return {
      file: project.pluginFile,
      error: 'nuxt_plugin_conflict',
      hint: `${project.pluginFile} already exists and is not managed by Impeccable Live`,
    };
  }

  const content = buildNuxtPlugin(port, token);
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  if (content !== existing) fs.writeFileSync(absFile, content, 'utf-8');
  return {
    file: project.pluginFile,
    inserted: true,
    changed: content !== existing,
    devOnly: true,
  };
}

export function removeNuxtLiveAdapter({ cwd = process.cwd(), project = detectNuxtProject(cwd) }) {
  if (!project) return { error: 'nuxt_not_detected' };
  const absFile = path.join(cwd, project.pluginFile);
  if (!fs.existsSync(absFile)) {
    return { file: project.pluginFile, removed: false, note: 'no adapter present' };
  }
  const content = fs.readFileSync(absFile, 'utf-8');
  if (!content.includes(NUXT_PLUGIN_MARKER)) {
    return {
      file: project.pluginFile,
      removed: false,
      error: 'nuxt_plugin_conflict',
      hint: `${project.pluginFile} is not managed by Impeccable Live`,
    };
  }
  fs.unlinkSync(absFile);
  const pluginDir = path.dirname(absFile);
  if (fs.readdirSync(pluginDir).length === 0) fs.rmdirSync(pluginDir);
  return { file: project.pluginFile, removed: true };
}

export const nuxt = {
  name: 'nuxt',

  detect(cwd) {
    return detectNuxtProject(cwd);
  },

  inject: {
    kind: 'adapter',

    apply({ cwd, port, token, project }) {
      return applyNuxtLiveAdapter({ cwd, port, token, project });
    },

    remove({ cwd, project }) {
      return removeNuxtLiveAdapter({ cwd, project });
    },

    // The plugin path depends on the resolved srcDir, so it cannot live in the
    // static ignore list the way the SvelteKit paths do.
    ignorePatterns(project) {
      return project?.pluginFile ? [project.pluginFile] : [];
    },

    artifacts({ project }) {
      if (!project?.pluginFile) return [];
      return [{
        kind: 'created',
        path: project.pluginFile,
        marker: NUXT_PLUGIN_MARKER,
        // Mirrors removeNuxtLiveAdapter: the generated `plugins/` directory
        // goes when it empties, its parent stays.
        pruneTo: path.posix.dirname(path.posix.dirname(project.pluginFile)),
      }];
    },
  },

  source: {
    extensions: ['.vue'],
    preview: 'source',
    styleMode: 'scoped',
    commentSyntax: 'html',
  },
};
