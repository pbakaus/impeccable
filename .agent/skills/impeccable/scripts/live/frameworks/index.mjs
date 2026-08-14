/**
 * The live-mode framework registry.
 *
 * Before this existed, framework knowledge was smeared across live-inject.mjs
 * (detection order, the Nuxt adapter, the Astro `is:inline` branch), the two
 * adapter modules, and live-wrap.mjs (which extension gets component preview,
 * which gets Astro's global-prefixed CSS, which gets JSX comments). Adding or
 * fixing a framework meant reading all of them.
 *
 * One entry per framework now declares everything the live scripts need:
 *
 *   name        stable identifier; also the `adapter` value in inject JSON.
 *   detect      (cwd, config) → falsy when this is not the project, otherwise
 *               a truthy project descriptor that apply/remove/artifacts read.
 *               Order in FRAMEWORKS is priority order; first truthy wins.
 *   inject      { kind: 'adapter', apply, remove, ignorePatterns, artifacts,
 *               unpatch } for frameworks that server-render their document
 *               shell, or { kind: 'tag' } for the generic marker-wrapped
 *               <script src> block.
 *   source      how live-wrap treats files this framework authors:
 *               extensions, preview ('source' | 'component'), styleMode,
 *               styleTag, commentSyntax, injectScriptAttrs. Anything omitted
 *               falls back to SOURCE_TRAIT_DEFAULTS.
 *
 * Two rules hold the thing together:
 *
 * 1. **Detection order is injection priority.** SvelteKit → Nuxt → TanStack
 *    Start → Astro → Next → Vite → static HTML, exactly the order
 *    live-inject.mjs used to hard-code. static-html always matches, so
 *    resolveFramework never returns null.
 * 2. **Source traits resolve by file extension, not by project.** A SvelteKit
 *    project's injection target is `src/app.html`; a Vite app can contain
 *    `.astro` partials. live-wrap has always keyed these off the target file,
 *    and resolveSourceTraits keeps it that way. Several entries may claim the
 *    same extension (`.tsx` belongs to three); when they do, the values must
 *    agree, which tests/live-frameworks.test.mjs asserts.
 */

import path from 'node:path';

import { sveltekit } from './sveltekit.mjs';
import { nuxt } from './nuxt.mjs';
import { tanstackStart } from './tanstack-start.mjs';
import { astro } from './astro.mjs';
import { nextjs } from './nextjs.mjs';
import { viteGeneric } from './vite-generic.mjs';
import { staticHtml } from './static-html.mjs';
import { TAG_PATCH_MARKERS, unpatchTagFile } from './tag-strategy.mjs';

/** Priority order. Do not reorder without re-reading rule 1 above. */
export const FRAMEWORKS = Object.freeze([
  sveltekit,
  nuxt,
  tanstackStart,
  astro,
  nextjs,
  viteGeneric,
  staticHtml,
]);

export const PREVIEW_MODES = Object.freeze(['source', 'component']);
export const STYLE_MODES = Object.freeze(['scoped', 'astro-global-prefixed']);
export const COMMENT_SYNTAXES = Object.freeze(['html', 'jsx']);
export const INJECT_KINDS = Object.freeze(['adapter', 'tag']);

export const SOURCE_TRAIT_DEFAULTS = Object.freeze({
  preview: 'source',
  styleMode: 'scoped',
  styleTag: '<style data-impeccable-css="SESSION_ID">',
  commentSyntax: 'html',
  injectScriptAttrs: '',
});

/** The patch kind the generic tag strategy records in the journal. */
export const TAG_PATCH_KIND = 'live-tag';

/**
 * Undo functions keyed by the `patch` value an artifact carries. Built from
 * the entries so a new adapter registers its own undo alongside its apply.
 */
export const PATCH_UNDOERS = Object.freeze(Object.assign(
  { [TAG_PATCH_KIND]: unpatchTagFile },
  ...FRAMEWORKS.map((framework) => framework.inject.unpatch || {}),
));

/**
 * First entry whose detect() matches. Returns { framework, project } where
 * project is the detector's descriptor (adapters read it; tag frameworks
 * mostly ignore it).
 */
export function resolveFramework(cwd = process.cwd(), config = null) {
  for (const framework of FRAMEWORKS) {
    const project = framework.detect(cwd, config);
    if (project) return { framework, project };
  }
  // Unreachable while static-html stays terminal, but a caller that reorders
  // the array should get a diagnosable null rather than a silent tag inject.
  return null;
}

/**
 * Source-authoring traits for one file, merged over SOURCE_TRAIT_DEFAULTS.
 * `framework` names the entry that claimed the extension, or null.
 */
export function resolveSourceTraits(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  for (const framework of FRAMEWORKS) {
    const source = framework.source;
    if (!source || !source.extensions.includes(ext)) continue;
    const { extensions, ...traits } = source;
    return { framework: framework.name, ...SOURCE_TRAIT_DEFAULTS, ...traits };
  }
  return { framework: null, ...SOURCE_TRAIT_DEFAULTS };
}

/**
 * Extra gitignore patterns the resolved framework needs beyond the static
 * LIVE_IGNORE_PATTERNS list (paths that depend on a detected srcDir or file
 * extension and so cannot be written down ahead of time).
 */
export function frameworkIgnorePatterns(resolved) {
  const fn = resolved?.framework?.inject?.ignorePatterns;
  return typeof fn === 'function' ? (fn(resolved.project) || []) : [];
}

/**
 * The files this injection will create or patch, in journal-artifact form.
 * Adapters declare their own; the tag strategy patches exactly the resolved
 * config files.
 */
export function describeInjectArtifacts(resolved, { cwd = process.cwd(), files = [] } = {}) {
  if (!resolved) return [];
  const { framework, project } = resolved;
  if (framework.inject.kind === 'adapter') {
    return (framework.inject.artifacts?.({ cwd, project }) || []).filter((a) => a && a.path);
  }
  return files.map((file) => ({
    kind: 'patched',
    path: file,
    patch: TAG_PATCH_KIND,
    markers: [...TAG_PATCH_MARKERS],
  }));
}
