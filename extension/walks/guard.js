// The guard: what holds a walk to one tab and one site.
//
// THREAT NOTE
//
// A walk is our server's persona engine clicking in the person's own Chrome, signed in as them everywhere. The
// engine's own safety layer (the request boundary it installs on a browser it owns) does not exist here, so this
// file is the whole of it. It is fixed code: nothing a page shows the persona, and nothing the server asks, changes
// what it allows.
//
// It defends against a page talking the persona into
//   - leaving the site: a link, a script, a redirect, a meta refresh, a form or a `goto` to another origin never
//     leaves the browser. Every document the tab asks for is held by the debugger's Fetch domain until this file
//     answers, and the tab is opened empty with that already on, so there is no first request to race. A refused
//     navigation is aborted (the tab stays on the page it was on) and told as `blocked`.
//   - opening other tabs: a tab or window the walked tab opens is closed as soon as it starts to load, and told.
//   - acting elsewhere in this Chrome: the debugger is attached to one tab, and no op may name another. It is the tab
//     this extension opened for the walk, or, for a walk the person started from main's popup on the tab they were on,
//     that tab and no other (driver.js `adopt`). Only loopback addresses and the origins the hand-off allowed may be
//     walked from a new tab; the person's own tab is walked on its own site, and refused before anything if it is ours.
//   - wandering off on the person's own tab: another site is gone to only once the person says yes to it, and never
//     to our own pages, this machine or a private network address (`askable`). Only a move soon after the walk's own
//     click or key is asked about, each site once and only so many; there the walk only looks (driver.js `mayGo`).
//   - reaching our own account: our app, API and sign-in pages are refused in every build (`isOwnPage`), even when
//     the hand-off allowed them or they are on this machine.
//   - changing things elsewhere: a request that is not a GET, HEAD or OPTIONS (a form post, a fetch that writes) goes
//     only to the walk's own origins, the hand-off's `allow`; to any other origin it fails before it leaves.
//   - saving or sending files: a download the tab starts is cancelled and its file removed; a file picker never
//     opens; a native dialog is dismissed.
// And it fails closed: a walked tab seen anywhere it should not be loses the debugger at once, which ends the walk.
//
// It knowingly does NOT defend
//   - the walked site from the walk. The site is trusted to be walked as whoever is signed in to it: the persona
//     can do there whatever that person can.
//   - against a popup's first moments. Chrome gives an extension no way to hold a new tab before it loads (the
//     debugger's auto-attach does not reach a popup; measured on Chrome 156). A popup is closed as soon as it has an
//     address or starts to load, and a second after it exists at the latest, so the address it was opened on can be
//     requested, with that site's cookies, and its page can begin to run before the tab is gone. The persona never
//     sees or touches it. How much gets out in a person's Chrome is not measured: the test browser holds new tabs.
//   - frames inside the page. An embedded frame may be on any origin, as on the open web; only the top-level
//     document is held to the site. A frame Chrome runs in a process of its own (most frames on another site) is
//     another debugger target, which the walk does not attach to: its requests, writes included, are not held. Nor
//     are a service worker's, or what an open WebSocket sends.
//   - a read that changes something: a GET is let through wherever it goes.
//   - the instant a small download takes: the file can exist for a moment before it is removed.
//
// Mechanism, with the evidence (a real Chrome, each attempt against a second local server that counts requests):
// Fetch at Document level stopped a link, `location =`, a meta refresh, a redirect and a `goto` with 0 requests
// off-site, and `failRequest(Aborted)` left the tab where it was. `declarativeNetRequest` would also hold the
// request, but lands the tab on Chrome's error page and cannot tell an origin from a port without one rule each.
// `webNavigation` only hears of a navigation after the request has left. `Page.setDownloadBehavior` is refused to an
// extension ("browser-level command"), hence `chrome.downloads`.

function refuse(message) {
  const err = new Error(message);
  err.name = 'NotAllowed';
  return err;
}

/** Whether a host is this machine: `localhost`, a name under it, 127.0.0.0/8 or ::1. By name only; nothing is resolved. */
export function isLoopback(hostname) {
  const host = String(hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return true;
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Our own app, API and sign-in pages, which no walk opens in any build: a walk in a signed-in Chrome must never reach
 * the account that started it. By name: `impeccable.reviews` and every host under it, every host under
 * `impeccable.style`, the local stand-ins `app.localhost` and `api.localhost`, and the sign-in dialog's path on any
 * host. Plain `localhost` stays walkable: it is where a person's own app runs.
 */
const OWN_HOSTS = [/^(.+\.)?impeccable\.reviews$/, /^.+\.impeccable\.style$/, /^(app|api)\.localhost$/];
const OWN_PATHS = ['/app/oauth/authorize'];

/** Whether an address is one of our own app's pages that a walk never opens. */
export function isOwnPage(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  return OWN_HOSTS.some((own) => own.test(host)) || OWN_PATHS.some((own) => path === own || path.startsWith(`${own}/`));
}

/** The origin of a web address, or null for anything that is not http or https. */
export function webOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origins a walk that starts on `url` may be on: the allow-list as given, and the address's own origin when it
 * is loopback. Throws `NotAllowed` for an address that is neither, so nothing opens.
 */
export function admit(url, allow = []) {
  const origin = webOrigin(url);
  if (!origin) throw refuse('a journey opens http and https addresses only');
  if (isOwnPage(url)) throw refuse(`a journey never opens ${origin}${new URL(url).pathname}`);
  const listed = allow.filter((entry) => typeof entry === 'string' && webOrigin(entry) === entry);
  if (!listed.includes(origin) && !isLoopback(new URL(url).hostname)) throw refuse(`${origin} is not on this machine and not on the journey's allow-list`);
  return { origin, allowed: [...new Set([origin, ...listed])] };
}

/** Whether a host is a private-network address by name (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10). */
function isPrivate(hostname) {
  const host = String(hostname).toLowerCase();
  if (/^\[(f[cd]|fe[89ab])[0-9a-f]*:/.test(host)) return true;
  const [a, b] = host.split('.').map(Number);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254));
}

/**
 * Whether the person may be asked to let a walk of their own tab go to `url`: a web address on another origin, not
 * one of our own pages, and not on this machine or a private network (unless it is already allowed).
 */
export function askable(url, allowed) {
  const origin = webOrigin(url);
  if (!origin || allowed.includes(origin) || isOwnPage(url)) return false;
  const { hostname } = new URL(url);
  return !isLoopback(hostname) && !isPrivate(hostname);
}

/**
 * What one Yes to another site lets the walk of the person's own tab do: at most this many sites besides the start,
 * and this many questions in all. A contract with the web app, which says the first to the persona.
 */
export const MAX_OTHER_SITES = 8;
export const MAX_SITE_QUESTIONS = 12;
/** Only a move this soon after the walk's own click or key is the walk's doing, so only then is the person asked. */
export const ASK_AFTER_INPUT_MS = 10_000;

/**
 * The origins one site is, for a question: its host with and without `www.`, on the scheme asked for and on https. One
 * Yes or No covers them all, so a redirect from http to https, or to `www.`, does not ask again.
 */
export function siteOrigins(origin) {
  const { protocol, hostname, port } = new URL(origin);
  const bare = hostname.replace(/^www\./, '');
  // An address by number has no `www.` form.
  const hosts = /^[\d.]+$|^\[/.test(bare) ? [bare] : [bare, `www.${bare}`];
  const schemes = protocol === 'https:' ? ['https:'] : [protocol, 'https:'];
  return schemes.flatMap((scheme) => hosts.map((host) => new URL(`${scheme}//${host}${port ? `:${port}` : ''}`).origin));
}

/** Whether the top-level document may be at `url`. A blob the site made is the site's; nothing else without an origin is. */
export function onSite(url, allowed) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') return false;
    if (isOwnPage(parsed.protocol === 'blob:' ? parsed.origin : url)) return false;
    return allowed.includes(parsed.origin);
  } catch {
    return false;
  }
}

/** Where a tab is before it has gone anywhere, or after a load failed: nowhere, so not somewhere else. */
const NOWHERE = /^(about:blank|chrome-error:\/\/)/;
export const stillHome = (url, allowed) => !url || NOWHERE.test(url) || onSite(url, allowed);

const OTHER_TAB = ['tabId', 'tab', 'targetId', 'target', 'sessionId', 'windowId', 'frameId', 'contextId'];
/** The key by which a request names a tab, a frame or a session other than the walk's own, if it has one. */
export const namesAnotherTab = (req) => OTHER_TAB.find((key) => Object.hasOwn(req, key)) ?? null;

/** Throws `NotAllowed` for a request that names where to act: an op acts on the walked tab and nowhere else. */
export function onlyThisTab(req) {
  const key = namesAnotherTab(req);
  if (key) throw refuse(`an op acts on the journey's tab only; this one names a ${key}`);
}

/** The methods that only read. Any other asks a server to change something. */
const READS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * What to do with a request the tab is held on: `continue`; `block` for a top-level document off the site (aborted,
 * and told); `refuse` for a request that would change something on an origin that is not `writable` (failed,
 * untold: pages send these all the time, to counters and the like). The walk's own site may be written to: a walk
 * exists to add, change and delete there. Another site the person let it go to is only looked at. A frame's documents
 * and reads are its own.
 */
export function verdict(paused, mainFrame, allowed, writable = allowed) {
  const url = paused.request?.url;
  const writes = !reads(paused) && !(writable.includes(webOrigin(url)) && !isOwnPage(url));
  // A form sent from the top of the page is a write too.
  if (paused.resourceType === 'Document' && paused.frameId === mainFrame) return onSite(url, allowed) && !writes ? 'continue' : 'block';
  return writes ? 'refuse' : 'continue';
}

/** Whether a held request only reads. */
export const reads = (paused) => READS.includes(String(paused.request?.method ?? 'GET').toUpperCase());

/* ------------------------------ on the tab ------------------------------ */

/**
 * Arms the guard on a tab the debugger has just attached to, before the tab has gone anywhere. `send` is a debugger
 * command on that tab. From here every document it asks for waits for {@link held}.
 */
export async function arm(send) {
  // Every request, not only documents: a write to another origin is caught as it is asked.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
}

/**
 * Answers one held request, always: let through, or aborted. A request this cannot judge is aborted. `refused` hears
 * the address before the abort is sent, so whoever asked for the navigation knows why it failed by the time it does.
 * Resolves to what became of the request: `continued`, `refused` or `gone`.
 */
export async function held(send, paused, mainFrame, allowed, writable, refused) {
  let answer = 'block';
  try { answer = verdict(paused, mainFrame, allowed, writable); } catch { /* unreadable: refused */ }
  const pass = answer === 'continue';
  if (answer === 'block') refused(String(paused.request?.url ?? '').slice(0, 500));
  try {
    if (pass) await send('Fetch.continueRequest', { requestId: paused.requestId });
    else await send('Fetch.failRequest', { requestId: paused.requestId, errorReason: answer === 'block' ? 'Aborted' : 'BlockedByClient' });
  } catch {
    // The request is already gone with its page (a newer navigation took its place while it was held).
    return 'gone';
  }
  return pass ? 'continued' : 'refused';
}

/* ------------------------------ popups ------------------------------ */

const POPUP_WINDOW_MS = 2000;
const blank = (url) => !url || url === 'about:blank';

/**
 * Which new tabs are the walked tab's doing. The walked tab's own `Page.windowOpen` says a window is coming, and the
 * next tab within two seconds that is still empty, or already on that address, is it, whichever of the two Chrome
 * tells first. Chrome's `openerTabId` is the other sign, and only a sign: it names the tab that was in front, which
 * after one popup is not the walked tab (measured). A tab the person opens has an address of its own from the start
 * (a new tab page, a link they followed), so it is not taken for one.
 */
export function popupWatch(now = () => Date.now()) {
  let announced = [];
  let orphans = [];
  let claimed = [];
  const fresh = (list) => list.filter((entry) => now() - entry.at <= POPUP_WINDOW_MS);
  const matches = (tabUrl, url) => blank(tabUrl) || tabUrl === url;
  const take = (list, match) => { const at = list.findIndex(match); return at >= 0 ? list.splice(at, 1)[0] : null; };
  return {
    /** The walked tab said it is opening `url`. Returns a tab already seen that it explains (`id`, `url`), if any. */
    announce(url) {
      orphans = fresh(orphans);
      claimed = fresh(claimed);
      // Already closed on Chrome's word: this is the same popup, said second.
      if (take(claimed, (tab) => matches(tab.url, url))) return null;
      const seen = take(orphans, (tab) => matches(tab.url, url));
      if (seen) return seen;
      announced.push({ url, at: now() });
      return null;
    },
    /** A tab was created. Returns the address it was opened for when it is the walked tab's, else null. */
    created(tab, walkedTabId) {
      const url = tab.pendingUrl || tab.url || '';
      announced = fresh(announced);
      const said = take(announced, (entry) => matches(url, entry.url));
      if (said) return said.url;
      if (tab.openerTabId === walkedTabId) {
        claimed = [...fresh(claimed), { url, at: now() }];
        return blank(url) ? 'about:blank' : url;
      }
      // Not explained yet: the walked tab may still be about to say it opened this one.
      orphans = [...fresh(orphans), { id: tab.id, url, at: now() }];
      return null;
    },
  };
}

/* ------------------------------ downloads ------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refuses a download the walked tab began: cancelled if it is still coming, its file removed if it already landed,
 * and its row taken out of Chrome's list. The tab's own event names the address; Chrome's list is asked for it.
 */
export async function refuseDownload(url, since = Date.now()) {
  for (let tries = 0; tries < 40; tries += 1) {
    const [item] = (await chrome.downloads.search({ url, orderBy: ['-startTime'], limit: 3 }).catch(() => []))
      .filter((found) => Date.parse(found.startTime) >= since - 5000);
    if (item) {
      await chrome.downloads.cancel(item.id).catch(() => undefined);
      const [now] = await chrome.downloads.search({ id: item.id }).catch(() => []);
      if (now?.state === 'complete' && now.exists) await chrome.downloads.removeFile(item.id).catch(() => undefined);
      await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
      return true;
    }
    await sleep(50);
  }
  return false;
}
