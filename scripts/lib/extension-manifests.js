/**
 * The builds scripts/build-extension.js derives from the one source `extension/`, whose manifest is the one Load
 * unpacked reads:
 *
 * - Chrome Web Store: everything (the detector, walks and the account), held to production hosts, without the
 *   stand-in screens a developer looks at.
 * - Development: extension/ as Load unpacked reads it, plus the servers named in the untracked
 *   extension/dev-hosts.local.json (the shape is in dev-hosts.example.json).
 * - Firefox: the detector alone. Firefox cannot drive a tab through the debugger.
 */
import fs from 'fs';
import path from 'path';

/** The hosts a store build's content scripts may run on: production's website and app. */
const [SITE, APP] = ['https://impeccable.reviews/', 'https://app.impeccable.style/'];
const STORE_HOSTS = [SITE, APP];
/** A developer's own servers, never committed (.gitignore), which a development build also signs in to and takes journeys from. */
export const DEV_HOSTS = 'dev-hosts.local.json';
/** The detector's worker: Chrome's module worker imports it, and Firefox loads it alone. */
export const DETECTOR_WORKER = 'background/service-worker.js';
/** What drives a tab: walks ask for these, and Firefox has none of them. */
export const WALK_PERMISSIONS = ['debugger', 'tabs', 'tabGroups', 'sidePanel', 'downloads'];

const under = (folder, file) => file === folder || file.startsWith(`${folder}/`);
const isWalkFile = (file) => under('walks', file);
/** What Firefox leaves out with walks: the account, its half of the popup and its options page. */
const isAccountFile = (file) => under('account', file) || ['popup/account.js', 'popup/words.js', 'popup/settings.html', 'popup/settings.js'].includes(file);
/** What no build ships: the listing, and the dev-hosts files (dev-hosts.local.json and its example). */
const notListing = (rel) => !['STORE_LISTING.md', '.DS_Store'].includes(path.basename(rel)) && !/^dev-hosts\.[^/]*\.json$/.test(rel);
const onlyStoreHosts = (entries) => entries
  .map((entry) => ({ ...entry, matches: entry.matches.filter((match) => STORE_HOSTS.some((host) => match.startsWith(host))) }))
  .filter((entry) => entry.matches.length > 0);

/** The store manifest: no key (the store holds the item's own), content scripts on production hosts only. */
export function storeManifest(source) {
  const { key: _key, content_scripts: scripts = [], ...rest } = source;
  const kept = onlyStoreHosts(scripts);
  return { ...rest, ...(kept.length ? { content_scripts: kept } : {}) };
}

/** Whether a path in extension/ goes into the store build: everything but the side panel's stand-in screens. */
const isStoreFile = (rel) => notListing(rel) && rel !== 'walks/panel/stub.js';

/** Whether a path in extension/ goes into the Firefox build: the detector's files, without walks, the account or the module worker that loads them. */
const isFirefoxFile = (rel) => notListing(rel) && !isAccountFile(rel) && !isWalkFile(rel) && !['background/chrome-worker.js', 'shared/build.js'].includes(rel);

/** The lines of popup.html that are the account's half (the Impeccable Pro button and its scripts), which Firefox drops with its files. */
const POPUP_ACCOUNT = /  <footer class="pro">[^\n]*\n([\s\S]*?)  <script src="words\.js"><\/script>\n  <script src="account\.js"><\/script>\n/;
/** The line the store build changes: it signs in to, and runs journeys from, production alone. */
const BUILD_FILE = 'shared/build.js';
const BUILD_LINE = 'export const BUILD = { devHosts: true, servers: [] };';
const buildLine = (build) => `export const BUILD = ${JSON.stringify(build)};`;

/** Replaces `line` in `file` with `instead`; a line not found exactly as written stops the build. */
function rewrite(file, [line, instead]) {
  const text = fs.readFileSync(file, 'utf-8');
  const found = typeof line === 'string' ? text.includes(line) : line.test(text);
  if (!found) throw new Error(`${file}: the build expects the line ${String(line)}`);
  fs.writeFileSync(file, text.replace(line, instead));
}

function stage(from, to, keep, manifest) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => { const rel = path.relative(from, src).split(path.sep).join('/'); return rel === '' || keep(rel); } });
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

const sourceManifest = (from) => JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf-8'));

/** Copies extension/ (`from`) to `to` as the store build has it: its files, its lines, its manifest. */
export function stageStore(from, to) {
  const manifest = stage(from, to, isStoreFile, storeManifest(sourceManifest(from)));
  rewrite(path.join(to, BUILD_FILE), [BUILD_LINE, buildLine({ devHosts: false, servers: [] })]);
  return manifest;
}

/**
 * The servers in a dev-hosts file, `{ servers: [{ api, app, site }] }`, each an https origin without a port as
 * production's are; none without the file.
 */
export function devServers(file) {
  if (!fs.existsSync(file)) return [];
  const { servers = [] } = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return servers.map((server) => Object.fromEntries(['api', 'app', 'site'].map((key) => {
    const url = new URL(server[key]);
    if (url.protocol !== 'https:' || url.port !== '' || url.origin !== server[key]) throw new Error(`${file}: each server's ${key} must be an https origin without a port or path`);
    return [key, url.origin];
  })));
}

/** The development manifest: each content script's production matches copied onto every server's website and app. */
export function devManifest(source, servers) {
  const moved = (match) => servers.flatMap(({ app, site }) => [[SITE, site], [APP, app]])
    .filter(([host]) => match.startsWith(host)).map(([host, own]) => `${own}/${match.slice(host.length)}`);
  const scripts = (source.content_scripts ?? []).map((entry) => ({ ...entry, matches: [...new Set([...entry.matches, ...entry.matches.flatMap(moved)])] }));
  return { ...source, content_scripts: scripts };
}

/** Copies extension/ (`from`) to `to` as a development build: the source with the servers `hostsFile` names. */
export function stageDev(from, to, hostsFile = path.join(from, DEV_HOSTS)) {
  const servers = devServers(hostsFile);
  const manifest = stage(from, to, notListing, devManifest(sourceManifest(from), servers));
  rewrite(path.join(to, BUILD_FILE), [BUILD_LINE, buildLine({ devHosts: true, servers })]);
  return { manifest, servers };
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

/** Copies extension/ (`from`) to `to` as the Firefox build has it: the detector's files, with the Firefox manifest. */
export function stageFirefox(from, to) {
  const manifest = stage(from, to, isFirefoxFile, firefoxManifest(sourceManifest(from)));
  rewrite(path.join(to, 'popup/popup.html'), [POPUP_ACCOUNT, '$1']);
  return manifest;
}

/**
 * The Firefox (AMO) manifest: the detector. Its worker is declared as an event-page `scripts` entry (the
 * universally-supported path on Gecko), and `browser_specific_settings.gecko` is added for AMO signing.
 */
export function firefoxManifest(source) {
  const { key: _key, content_scripts: _scripts, side_panel: _panel, options_ui: _options, ...rest } = source;
  return {
    ...rest,
    // Gecko supports MV3 via non-persistent event pages. Declaring `scripts`
    // (rather than `service_worker`) is the path supported across all MV3 Firefox
    // releases. The shared worker hosts the rule core in a background-page
    // iframe when Chrome's offscreen API is unavailable.
    background: { scripts: [DETECTOR_WORKER] },
    permissions: rest.permissions.filter((permission) => ![...WALK_PERMISSIONS, 'offscreen', 'identity'].includes(permission)),
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
