/**
 * TanStack Start registry entry.
 *
 * Detection and the apply/remove pair are the existing adapter's
 * (`../tanstack-adapter.mjs`); this file only declares them to the registry
 * and names the artifacts the journal has to be able to heal.
 */

import {
  TANSTACK_MARKER_OPEN,
  applyTanStackLiveAdapter,
  detectTanStackStartProject,
  removeTanStackLiveAdapter,
  unpatchTanStackRoot,
} from '../tanstack-adapter.mjs';

export const tanstackStart = {
  name: 'tanstack-start',

  detect(cwd) {
    return detectTanStackStartProject(cwd);
  },

  inject: {
    kind: 'adapter',

    apply({ cwd, port, token, project }) {
      return applyTanStackLiveAdapter({ cwd, port, token, project });
    },

    remove({ cwd, project }) {
      return removeTanStackLiveAdapter({ cwd, project });
    },

    // The mount component's extension follows the root route's, so the path
    // cannot live in the static ignore list.
    ignorePatterns(project) {
      return project?.componentFile ? [project.componentFile] : [];
    },

    artifacts({ project }) {
      if (!project) return [];
      return [
        {
          kind: 'created',
          path: project.componentFile,
          marker: 'impeccable-live-tanstack',
          pruneTo: 'src',
        },
        {
          kind: 'patched',
          path: project.rootRoute,
          patch: 'tanstack-root',
          markers: [TANSTACK_MARKER_OPEN],
        },
      ];
    },

    unpatch: {
      'tanstack-root': unpatchTanStackRoot,
    },
  },

  source: {
    extensions: ['.tsx', '.jsx'],
    preview: 'source',
    styleMode: 'scoped',
    commentSyntax: 'jsx',
  },
};
