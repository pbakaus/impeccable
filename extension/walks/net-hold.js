// The write hold's second layer: Chrome's own request rules, beside the debugger's Fetch hold (guard.js).
//
// The Fetch hold sees what the walked tab's page asks for. It does not see a form the page posts into a new tab (that
// tab's first request is the post itself), a shared worker's or a service worker's requests (no tab: Chrome's tab -1),
// nor a frame Chrome runs in a process of its own. While a walk drives and its writes are closed, two session rules
// block every request that is not a GET, HEAD or OPTIONS (measured on Chrome for Testing 156):
//   - FRAMES: in the walked tab, sent by anything but the walk's own sites: a frame on another site.
//   - ELSEWHERE: anywhere but the walked tab and the tabs open when the walk began, sent by the walk's own sites: a
//     tab the walk opened, and every worker of those sites.
// Neither touches what the walked tab's own page sends: a rule beats the Fetch hold to it (measured: a fetch then sees a
// network error, not the hold's 403, and a held form lands the tab on Chrome's error page), so that stays the Fetch
// hold's.
//
// Trade-off: a worker has no tab, so a rule can only tell its site, and only by name: no port, subdomains included. While
// writes are closed, a worker of the walk's site in the person's other tabs (`localhost` on any port, too) cannot write
// either, nor can a tab on that site the person opens during the walk. Their other tabs' pages are untouched.
//
// Not held, by choice: WebSockets. A rule can stop a socket opening, not what it sends. Most sockets open with the page,
// while writes are closed, and live on once they open, so blocking opens would leave live pages and dev servers'
// reloads dead without holding a socket a deed opened.
//
// The rules follow the Fetch hold's own word (driver.js `writesHeld`), so the two never disagree: up while a walk drives
// with its writes closed; down when writes open, the person takes over, for the moments after the person's own press or
// key at a sign-in pause, and when the walk ends. Every rule of ours is removed when this worker starts, looked at again
// with each request the tab asks for, and often while any is up, so none outlives its walk.
import { hooks, note, walk, writesHeld } from './driver.js';

const FRAMES = 20541;
const ELSEWHERE = 20542;
const OURS = [FRAMES, ELSEWHERE];
const WRITES = ['post', 'put', 'patch', 'delete', 'connect', 'other'];
/** Every kind of request, the top of a tab included: a rule leaves that out unless it is named. */
const EVERY_KIND = { resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] };
const RECHECK_MS = 250;

/** The tabs that were open when the walk began, besides its own: the person's, left alone. None when Chrome would not list them. */
let theirs = [];

/** The walk's sites by name, as a rule takes them: no scheme, no port, no brackets. */
const hostsOf = (origins) => [...new Set(origins.map((origin) => {
  try { return new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return ''; }
}).filter(Boolean))];

/** The rules the walk needs right now: none unless it drives with its writes closed. */
function wanted() {
  if (!walk || !writesHeld()) return [];
  const sites = hostsOf(walk.allowed);
  if (sites.length === 0) return [];
  const block = { type: 'block' };
  return [
    { id: FRAMES, priority: 1, action: block, condition: { tabIds: [walk.tabId], excludedInitiatorDomains: sites, requestMethods: WRITES, ...EVERY_KIND } },
    { id: ELSEWHERE, priority: 1, action: block, condition: { excludedTabIds: [walk.tabId, ...theirs], initiatorDomains: sites, requestMethods: WRITES, ...EVERY_KIND } },
  ];
}

let shown = null;
let chain = Promise.resolve();
let recheck = null;

async function apply() {
  const rules = wanted();
  const key = JSON.stringify(rules);
  if (key === shown) return;
  const dnr = chrome.declarativeNetRequest;
  // A build without the permission has no rules to set: the Fetch hold holds the tab as ever, and the walk goes on.
  if (!dnr) { shown = '[]'; return; }
  // Both ours, always, whether or not they are up: Chrome ignores an id it does not have.
  try {
    await dnr.updateSessionRules({ removeRuleIds: OURS, addRules: rules });
    shown = key;
  } catch (err) {
    // Rules Chrome will not take still leave none of ours behind; the Fetch hold holds the tab as ever.
    console.warn('walk network rules not set', String(err?.message ?? err));
    note('net-rules');
    await dnr.updateSessionRules({ removeRuleIds: OURS }).then(() => { shown = '[]'; }, () => undefined);
  }
  // While any rule is up, looked at again and again: nothing that ends a walk is missed.
  const up = shown !== '[]';
  if (up && !recheck) recheck = setInterval(sync, RECHECK_MS);
  if (!up && recheck) { clearInterval(recheck); recheck = null; }
}

/** Brings the rules in line with the walk, in order: resolves once Chrome has them. */
function sync() {
  chain = chain.then(apply, apply);
  return chain;
}

hooks.opened.push(async (tab) => {
  // Asked twice. Still unknown, the person's tabs are not left out: ELSEWHERE is all that holds a form the walk posts
  // into a new tab, and the site's workers, and a rule cannot leave out tabs it is not told of without letting those
  // through too. Their tabs on the walk's site then cannot write either while the walk's writes are held.
  const list = () => Promise.resolve().then(() => chrome.tabs.query({}));
  const open = (await list().catch(() => null)) ?? (await list().catch(() => null));
  if (!open) { console.warn('walk network rules: the person’s tabs could not be listed', 'tabs'); note('tab-query'); }
  theirs = (open ?? []).map((one) => one.id).filter((id) => Number.isInteger(id) && id !== tab.tabId);
  await sync();
});
hooks.closed.push(() => sync());
hooks.held.push(() => sync());
// The Fetch hold decides each request as it comes, on the same clock: the rules are brought in line as it does.
hooks.event.push((method) => { if (method === 'Fetch.requestPaused') void sync(); });

// A worker that starts has no walk: whatever rules a last one left go.
void sync();
