/**
 * The builds scripts/build-extension.js derives from the one source `extension/`, whose manifest is the one Load
 * unpacked reads:
 *
 * - Chrome Web Store: the detector and walks, held to the web app's production hosts, with the account left out.
 * - Firefox: the detector alone. Firefox cannot drive a tab through the debugger.
 */
import fs from 'fs';
import path from 'path';

/** The hosts a store build's content scripts may run on: the web app's production hosts. */
const STORE_HOSTS = ['https://impeccable.reviews/', 'https://app.impeccable.style/'];
/** The detector's worker: Chrome's module worker imports it, and Firefox loads it alone. */
export const DETECTOR_WORKER = 'background/service-worker.js';
/** What drives a tab: walks ask for these, and Firefox has none of them. */
export const WALK_PERMISSIONS = ['debugger', 'tabs', 'tabGroups', 'sidePanel', 'downloads', 'declarativeNetRequestWithHostAccess'];

const under = (folder, file) => file === folder || file.startsWith(`${folder}/`);
const isWalkFile = (file) => under('walks', file);
/** What the store build and Firefox leave out: the account, its half of the popup and its options page. */
const isAccountFile = (file) => under('account', file) || ['popup/words.js', 'popup/settings.html', 'popup/settings.js'].includes(file);
/** Files of a developer's checkout no build ships: the listing's text, Finder's litter, and a browser test's `outing.json` (walks/link.js). */
const notListing = (rel) => !['STORE_LISTING.md', '.DS_Store'].includes(path.basename(rel)) && rel !== 'outing.json';
const onlyStoreHosts = (entries) => entries
  .map((entry) => ({ ...entry, matches: entry.matches.filter((match) => STORE_HOSTS.some((host) => match.startsWith(host))) }))
  .filter((entry) => entry.matches.length > 0);

/** The account's own permissions: signing in, and the check-in with its notice (account/waiting.js). */
const ACCOUNT_PERMISSIONS = ['identity', 'alarms', 'notifications'];
/**
 * The person's own agent's line to the CLI (walks/agent.js, REN-2053): the developer build alone until its threat
 * review and its own store submission, so the store's stated purpose doesn't change mid-review (REN-2005).
 */
const AGENT_PERMISSIONS = ['nativeMessaging'];

/** The store manifest: no key, none of the account's permissions (the store build does not sign in), content scripts on production hosts only. */
export function storeManifest(source) {
  const { key: _key, content_scripts: scripts = [], options_ui: _options, ...rest } = source;
  const kept = onlyStoreHosts(scripts.filter((entry) => !entry.js.some(isAccountFile)));
  return { ...rest, permissions: source.permissions.filter((permission) => ![...ACCOUNT_PERMISSIONS, ...AGENT_PERMISSIONS].includes(permission)), ...(kept.length ? { content_scripts: kept } : {}) };
}

/** Whether a path in extension/ goes into the store build: everything but the account. */
export const isStoreFile = (rel) => notListing(rel) && !isAccountFile(rel);

/** Whether a path in extension/ goes into the Firefox build: the store's files without walks or the module worker that loads them. */
const isFirefoxFile = (rel) => isStoreFile(rel) && !isWalkFile(rel) && !['background/chrome-worker.js', 'shared/build.js'].includes(rel);

/** The lines the store build changes so that what it switches off is never loaded. */
const STORE_LINES = {
  'shared/build.js': ['export const BUILD = { account: true, devHosts: true };', 'export const BUILD = { account: false, devHosts: false };'],
  'background/chrome-worker.js': ["import '../account/worker.js';\n", ''],
};

/** Replaces `line` in `file` with `instead`; a line not found exactly as written stops the build. */
function rewrite(file, [line, instead]) {
  const text = fs.readFileSync(file, 'utf-8');
  const found = typeof line === 'string' ? text.includes(line) : line.test(text);
  if (!found) throw new Error(`${file}: the store build expects the line ${String(line)}`);
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
  for (const [rel, change] of Object.entries(STORE_LINES)) rewrite(path.join(to, rel), change);
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

/** Copies extension/ (`from`) to `to` as the Firefox build has it: the detector's files, with the Firefox manifest. */
export function stageFirefox(from, to) {
  return stage(from, to, isFirefoxFile, firefoxManifest(sourceManifest(from)));
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
    // Firefox has no side panel, which is the whole extension in Chrome: the detector keeps its popup here.
    action: { ...rest.action, default_popup: 'popup/popup.html' },
    permissions: rest.permissions.filter((permission) => ![...WALK_PERMISSIONS, 'offscreen', ...ACCOUNT_PERMISSIONS, ...AGENT_PERMISSIONS].includes(permission)),
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
