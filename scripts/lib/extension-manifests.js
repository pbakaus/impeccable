/**
 * The builds scripts/build-extension.js derives from the one source `extension/`:
 *
 * - main ("Impeccable"): the source manifest is its own, the one Load unpacked reads. The detector, the account and
 *   the first-walk onboarding. Its store build is the published detector exactly: no account, no onboarding.
 * - the walk helper ("Impeccable Walks"): everything that drives a tab (walks/), with the permissions that do.
 *   Chrome asks for those when a person adds it during their first walk, so main never adds a warning.
 * - Firefox: main's detector alone.
 */
import fs from 'fs';
import path from 'path';
import { IDS } from '../../extension/shared/ids.js';

/** The hosts a store build's content scripts may run on: the web app's production hosts. */
const STORE_HOSTS = ['https://impeccable.reviews/', 'https://app.impeccable.style/'];
/** Every host of the web app a development build knows: production, staging, and this machine's stack. */
const APP_HOSTS = [
  'https://impeccable.reviews', 'https://app.impeccable.style', 'https://staging.impeccable.reviews',
  'https://app.staging.impeccable.style', 'http://localhost', 'http://app.localhost',
];
const OUTING_PAGES = APP_HOSTS.map((host) => `${host}/app/*/outings/*`);
/** The two pages of ours a walk starts from: an outing's page and the command's sign-in page. */
export const START_PAGES = [...OUTING_PAGES, ...APP_HOSTS.map((host) => `${host}/app/cli/authorize*`)];

/** The helper's public key: a build loaded unpacked always gets the id shared/ids.js names. */
export const HELPER_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs5hgqekZpfVdlZSWCXDaqT8U8JqEAXklU6BPOHDUTliUokg+JizAuYgvCFBimD6w6oM5lwMnNhUqfYkuXGutT55U8wgkwPH1C101HKN2fSGMCyjKAOURnbDEBCXgqEmjLUTXT/qb09nEX3KGzL37wTUhUDIOUjrY++A8fs6so/9+xAqGcvIeC6JPA/7G8VkxE1UAm+5wOs32PpPT0ItYwOcauzbWC2GWvA6zgLWj9KWVqMJOFx2xinq8sCHazdWtX/ro9zm1ANwzkrxCO3RWRqs918F4WpRMYsPssFQB6DhohXFiSNDab6IX9/gfY2dylFES7YwKs6/d6TUG10phLwIDAQAB';

/** The detector's worker: main's store build and Firefox load it alone. */
export const DETECTOR_WORKER = 'background/service-worker.js';
/** What drives a tab: the helper alone asks for these. */
export const WALK_PERMISSIONS = ['debugger', 'tabs', 'tabGroups', 'sidePanel', 'downloads'];

const under = (folder, file) => file === folder || file.startsWith(`${folder}/`);
const isWalkFile = (file) => under('walks', file);
/** Main's parts its store build and Firefox leave out: the account, its half of the popup, the onboarding. */
const isAccountFile = (file) => under('account', file) || under('onboarding', file) || ['popup/account.js', 'popup/words.js'].includes(file);
const notListing = (rel) => !['STORE_LISTING.md', '.DS_Store'].includes(path.basename(rel));
const onlyStoreHosts = (entries) => entries
  .map((entry) => ({ ...entry, matches: entry.matches.filter((match) => STORE_HOSTS.some((host) => match.startsWith(host))) }))
  .filter((entry) => entry.matches.length > 0);

/** Main's source manifest without what only a development build has: the key, the helper's door, the onboarding, the account. */
function detectorOnly(source) {
  const { key: _key, externally_connectable: _door, content_scripts: _onboarding, ...rest } = source;
  return { ...rest, permissions: source.permissions.filter((permission) => permission !== 'identity') };
}

/** The Chrome Web Store manifest of main: the detector as published, its worker loaded alone. */
export function storeManifest(source) {
  return { ...detectorOnly(source), background: { service_worker: DETECTOR_WORKER } };
}

/** Whether a path in extension/ goes into main's store build: the detector alone. */
export const isStoreFile = (rel) => notListing(rel) && !isWalkFile(rel) && !isAccountFile(rel)
  && !['background/chrome-worker.js', 'shared/build.js', 'shared/ids.js'].includes(rel);

/** The lines of popup.html that load the account's half, which main's store build drops with its files. */
const POPUP_ACCOUNT = '  <script src="words.js"></script>\n  <script src="account.js"></script>\n';
/** The switches (extension/shared/build.js) a store build of the helper is written with. */
const STORE_SWITCHES = ['export const BUILD = { account: true, devHosts: true };', 'export const BUILD = { account: false, devHosts: false };'];

/** Replaces `line` in `file` with `instead`; a line not found exactly as written stops the build. */
function rewrite(file, [line, instead]) {
  const text = fs.readFileSync(file, 'utf-8');
  if (!text.includes(line)) throw new Error(`${file}: the store build expects the line ${JSON.stringify(line)}`);
  fs.writeFileSync(file, text.replace(line, instead));
}

function stage(from, to, keep, manifest) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => { const rel = path.relative(from, src).split(path.sep).join('/'); return rel === '' || keep(rel); } });
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

const sourceManifest = (from) => JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf-8'));

/** Copies extension/ (`from`) to `to` as main's store build has it: its files, its popup, its manifest. */
export function stageStore(from, to) {
  const manifest = stage(from, to, isStoreFile, storeManifest(sourceManifest(from)));
  rewrite(path.join(to, 'popup/popup.html'), [POPUP_ACCOUNT, '']);
  return manifest;
}

/**
 * The helper's manifest, from main's source manifest (its version and icons). Only main may talk to it
 * (`externally_connectable`, checked again in walks/contact.js). A store build keeps the production hosts alone and
 * carries no key.
 */
export function helperManifest(source, { store = false } = {}) {
  const scripts = [
    { matches: OUTING_PAGES, js: ['walks/handoff-content.js'], run_at: 'document_idle' },
    { matches: START_PAGES, js: ['walks/present.js'], run_at: 'document_start' },
  ];
  return {
    manifest_version: 3,
    name: 'Impeccable Walks',
    description: 'Lets an Impeccable persona walk your site in a tab of its own, while you watch.',
    version: source.version,
    ...(store ? {} : { key: HELPER_KEY }),
    permissions: [...WALK_PERMISSIONS, 'storage'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'walks/worker.js', type: 'module' },
    side_panel: { default_path: 'walks/panel/panel.html' },
    action: { default_title: 'Impeccable Walks', default_icon: source.action.default_icon },
    icons: source.icons,
    externally_connectable: { ids: [IDS[store ? 'store' : 'unpacked'].main] },
    content_scripts: store ? onlyStoreHosts(scripts) : scripts,
  };
}

/** Whether a path in extension/ goes into the helper: the walks, the icons, and the shared pieces walks load. */
export const isHelperFile = (rel) => notListing(rel)
  && (['shared', 'shared/build.js', 'shared/ids.js', 'shared/kinpaku.css'].includes(rel) || isWalkFile(rel) || under('icons', rel));

/** Copies the helper's files of extension/ (`from`) to `to`, unpacked or as its store build has them. */
export function stageHelper(from, to, { store = false } = {}) {
  const manifest = stage(from, to, isHelperFile, helperManifest(sourceManifest(from), { store }));
  if (store) rewrite(path.join(to, 'shared/build.js'), STORE_SWITCHES);
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

/** Copies extension/ (`from`) to `to` as the Firefox build has it: main's store files, with the Firefox manifest. */
export function stageFirefox(from, to) {
  const manifest = stage(from, to, isStoreFile, firefoxManifest(sourceManifest(from)));
  rewrite(path.join(to, 'popup/popup.html'), [POPUP_ACCOUNT, '']);
  return manifest;
}

/**
 * The Firefox (AMO) manifest: main's detector. Its worker is declared as an event-page `scripts` entry (the
 * universally-supported path on Gecko), and `browser_specific_settings.gecko` is added for AMO signing.
 */
export function firefoxManifest(source) {
  const rest = detectorOnly(source);
  return {
    ...rest,
    // Gecko supports MV3 via non-persistent event pages. Declaring `scripts`
    // (rather than `service_worker`) is the path supported across all MV3 Firefox
    // releases. The shared worker hosts the rule core in a background-page
    // iframe when Chrome's offscreen API is unavailable.
    background: { scripts: [DETECTOR_WORKER] },
    permissions: rest.permissions.filter((permission) => permission !== 'offscreen'),
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
