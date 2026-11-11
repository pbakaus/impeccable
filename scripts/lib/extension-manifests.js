/**
 * The manifests and the store tree scripts/build-extension.js derives from the
 * source `extension/`, which is the one Load unpacked reads.
 */
import fs from 'fs';
import path from 'path';

/** The hosts a store build's content scripts may run on: the web app's production hosts. */
const STORE_HOSTS = ['https://impeccable.reviews/', 'https://app.impeccable.style/'];

/**
 * The Chrome Web Store manifest: the source manifest with its content scripts
 * held to the production hosts, and no `identity`: the store build does not
 * sign in (see {@link stageStore}). Staging and this machine's hosts are for
 * development builds only.
 */
export function storeManifest(source) {
  const contentScripts = (source.content_scripts || [])
    .map((entry) => ({ ...entry, matches: entry.matches.filter((match) => STORE_HOSTS.some((host) => match.startsWith(host))) }))
    .filter((entry) => entry.matches.length > 0);
  const { content_scripts: _all, ...rest } = source;
  const kept = { ...rest, permissions: (source.permissions || []).filter((permission) => permission !== 'identity') };
  return contentScripts.length ? { ...kept, content_scripts: contentScripts } : kept;
}

/**
 * The store build's switches (extension/shared/build.js), and the lines it
 * changes so that what it switches off is never loaded: each must be found
 * exactly as written, or the build stops.
 */
const STORE_LINES = {
  'shared/build.js': ['export const BUILD = { account: true, devHosts: true };', 'export const BUILD = { account: false, devHosts: false };'],
  'background/chrome-worker.js': ["import '../account/worker.js';\n", ''],
  'popup/popup.html': ['  <script src="account.js"></script>\n', ''],
};

/** Whether a path in extension/ goes into the store build: not the account, nor its half of the popup. */
export const isStoreFile = (rel) => !under(ACCOUNT, rel) && rel !== 'popup/account.js' && !['STORE_LISTING.md', '.DS_Store'].includes(path.basename(rel));

/** Copies extension/ (`from`) to `to` as the store build has it: its files, its lines, its manifest. */
export function stageStore(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => isStoreFile(path.relative(from, src).split(path.sep).join('/')) });
  for (const [rel, [line, instead]] of Object.entries(STORE_LINES)) {
    const text = fs.readFileSync(path.join(to, rel), 'utf-8');
    if (!text.includes(line)) throw new Error(`extension/${rel}: the store build expects the line ${JSON.stringify(line)}`);
    fs.writeFileSync(path.join(to, rel), text.replace(line, instead));
  }
  const manifest = storeManifest(JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf-8')));
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Every file a module worker loads through static imports, itself included, relative to `dir`. */
export function moduleReferences(dir, entry) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf-8');
    for (const spec of source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec[1])));
    }
  };
  visit(entry);
  return [...seen];
}

/** The detector's worker: Chrome's module worker imports it, and Firefox loads it alone. */
export const DETECTOR_WORKER = 'background/service-worker.js';
/**
 * Walks are Chrome's alone: Firefox cannot drive a tab through the debugger. So is signing in to an account, which
 * goes through `chrome.identity` and is loaded by the same module worker.
 */
const WALKS = 'walks';
const ACCOUNT = 'account';
export const CHROME_ONLY_PERMISSIONS = ['offscreen', 'debugger', 'tabs', 'tabGroups', 'sidePanel', 'downloads', 'identity'];

const under = (folder, file) => file === folder || file.startsWith(`${folder}/`);
const isWalkFile = (file) => under(WALKS, file);

/** Whether a path in extension/ goes into the Firefox build: not walks or the account, nor the module worker that loads them. */
export function isFirefoxFile(rel, source) {
  return !isWalkFile(rel) && !under(ACCOUNT, rel) && rel !== source.background?.service_worker;
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
