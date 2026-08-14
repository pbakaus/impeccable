/**
 * The one place that builds the `/live.js` URL the browser loads.
 *
 * Every injection path needs it (the generic script tag, the Nuxt client
 * plugin, the SvelteKit root component, the TanStack mount component), and a
 * separate module keeps that shared leaf free of import cycles: the framework
 * entries import it, and nothing here imports a framework entry.
 */

/**
 * When a token is supplied it rides as a `?token=...` query param so the
 * server's token-gated /live.js handler authorizes the fetch.
 */
export function buildLiveScriptSrc(port, token) {
  const base = 'http://localhost:' + port + '/live.js';
  return token ? base + '?token=' + encodeURIComponent(token) : base;
}
