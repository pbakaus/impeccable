/**
 * The manifests scripts/build-extension.js derives from the source
 * `extension/manifest.json`, which is the one Load unpacked reads.
 */

/** The hosts a store build's content scripts may run on: the web app's production hosts. */
const STORE_HOSTS = ['https://impeccable.reviews/', 'https://app.impeccable.style/'];

/**
 * The Chrome Web Store manifest: the source manifest with its content scripts
 * held to the production hosts. Staging and this machine's hosts are for
 * development builds only.
 */
export function storeManifest(source) {
  const contentScripts = (source.content_scripts || [])
    .map((entry) => ({ ...entry, matches: entry.matches.filter((match) => STORE_HOSTS.some((host) => match.startsWith(host))) }))
    .filter((entry) => entry.matches.length > 0);
  const { content_scripts: _all, ...rest } = source;
  return contentScripts.length ? { ...rest, content_scripts: contentScripts } : rest;
}
