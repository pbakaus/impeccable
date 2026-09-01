/**
 * SvelteKit registry entry.
 *
 * Detection and the apply/remove pair are the existing adapter's
 * (`../sveltekit-adapter.mjs`); this file only declares them to the registry
 * and names the artifacts the journal has to be able to heal.
 */

import {
  SVELTE_LAYOUT_MARKER_OPEN,
  SVELTE_LIVE_ROOT_COMPONENT,
  applySvelteKitLiveAdapter,
  detectSvelteKitProject,
  removeSvelteKitLiveAdapter,
  unpatchSvelteLayout,
} from '../sveltekit-adapter.mjs';

export const sveltekit = {
  name: 'sveltekit',

  detect(cwd, config) {
    return detectSvelteKitProject(cwd, config);
  },

  inject: {
    kind: 'adapter',

    apply({ cwd, port, token, config }) {
      return applySvelteKitLiveAdapter({ cwd, port, token, config });
    },

    remove({ cwd, config }) {
      return removeSvelteKitLiveAdapter({ cwd, config });
    },

    // The generated root component and the `src/lib/impeccable/` runtime paths
    // are already in the static LIVE_IGNORE_PATTERNS list, so nothing extra.
    ignorePatterns() {
      return [];
    },

    artifacts({ project }) {
      return [
        {
          kind: 'created',
          path: SVELTE_LIVE_ROOT_COMPONENT,
          marker: 'impeccable-live-root',
          pruneTo: 'src',
        },
        {
          kind: 'patched',
          path: project?.layoutFile || 'src/routes/+layout.svelte',
          patch: 'sveltekit-layout',
          markers: [SVELTE_LAYOUT_MARKER_OPEN],
        },
      ];
    },

    unpatch: {
      'sveltekit-layout': unpatchSvelteLayout,
    },
  },

  source: {
    extensions: ['.svelte'],
    // Svelte resets component-local state on markup HMR updates, so variants
    // are mounted from generated components rather than written into the route.
    preview: 'component',
    commentSyntax: 'html',
  },
};
