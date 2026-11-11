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

/** The detector's worker: Chrome's module worker imports it, and Firefox loads it alone. */
export const DETECTOR_WORKER = 'background/service-worker.js';
/** Walks are Chrome's alone: Firefox cannot drive a tab through the debugger. */
const WALKS = 'walks';
export const CHROME_ONLY_PERMISSIONS = ['offscreen', 'debugger', 'tabs', 'tabGroups', 'sidePanel', 'downloads'];

const isWalkFile = (file) => file === WALKS || file.startsWith(`${WALKS}/`);

/** Whether a path in extension/ goes into the Firefox build: not walks, nor the module worker that loads them. */
export function isFirefoxFile(rel, source) {
  return !isWalkFile(rel) && rel !== source.background?.service_worker;
}

/**
 * The Firefox (AMO) manifest. The detector's worker is declared as an
 * event-page `scripts` entry (the universally-supported path on Gecko), and
 * `browser_specific_settings.gecko` is added for AMO signing. Walks are
 * dropped: their permissions, side panel and content scripts. Any other
 * content script stays.
 */
export function firefoxManifest(source) {
  const { side_panel: _sidePanel, content_scripts: contentScripts = [], ...rest } = source;
  const kept = contentScripts.filter((entry) => !(entry.js || []).every(isWalkFile));
  return {
    ...rest,
    ...(kept.length ? { content_scripts: kept } : {}),
    // Gecko supports MV3 via non-persistent event pages. Declaring `scripts`
    // (rather than `service_worker`) is the path supported across all MV3 Firefox
    // releases. The shared worker hosts the rule core in a background-page
    // iframe when Chrome's offscreen API is unavailable.
    background: { scripts: [DETECTOR_WORKER] },
    permissions: source.permissions.filter((permission) => !CHROME_ONLY_PERMISSIONS.includes(permission)),
    // Required by AMO for signing/distribution. Ignored by Chrome.
    browser_specific_settings: {
      gecko: {
        id: 'impeccable@bakaus.com',
        // `data_collection_permissions` (below) is required by AMO for new
        // submissions and is only honored on Firefox 140+. We set the floor to
        // 140 so the declared min version actually supports every key we ship;
        // everything else this extension uses (MV3 action, scripting, devtools,
        // object-form web_accessible_resources, storage.sync) landed long before.
        strict_min_version: '140.0',
        // The rules run in the extension's own document; nothing is
        // transmitted off-device.
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}
