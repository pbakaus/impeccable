/**
 * Static HTML registry entry: the terminal fallback.
 *
 * Hand-written pages, a multi-page site emitted by a generator, anything with
 * no bundler config at the app root. `detect` always matches, so this entry
 * must stay last in FRAMEWORKS. Its behavior is the plain tag strategy, which
 * is what live-inject.mjs did for every unrecognized project before the
 * registry existed.
 */

export const staticHtml = {
  name: 'static-html',

  detect() {
    return { via: 'fallback' };
  },

  inject: { kind: 'tag' },

  source: {
    extensions: ['.html', '.htm'],
    preview: 'source',
    styleMode: 'scoped',
    commentSyntax: 'html',
  },
};
