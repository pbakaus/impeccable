// How a walk gets here and stays connected. A hand-off (handoff.js) names the socket and carries a ticket, which
// goes to the server beside the socket's subprotocol. The ticket is kept in memory only (chrome.storage.session).
//
// THE RULE FOR CONNECTING AGAIN
//
// A ticket opens one socket, once (the server's sign-in for walks): the server spends it as it admits the
// socket, and a second socket on it is not there. So:
//   - A socket that never opened may be tried again on the same ticket, a few times: nothing was spent.
//   - Once a socket has opened, its ticket is spent, and it is marked so here, where a worker that starts again can
//     read it. Connecting again then needs a new ticket, and only our own outing page can give one: the worker
//     reloads the tab the hand-off came from, the page hands over a fresh block for the same outing, and the worker
//     connects on that. At most REFRESHES times a walk; after that the walk is called failed.
//   - Only while the walk still waits for its tab. Once the debugger is on a tab, a lost socket is a lost walk: the
//     server's engine has no way back to where it was.
//
// A worker with no debugger attached is ended by Chrome after 30 s in which nothing reached it. While a walk waits
// for its tab the hub's keep-alive is what reaches it, every 20 s, over the open socket. If the worker is ended
// anyway, nothing of its own wakes it: the outing page's content script holds a port to it, sees the port drop, and
// opens another, which starts the worker; it finds its ticket spent and asks the page for a fresh one.
import { BUILD } from '../shared/build.js';
import { rearm } from './control.js';
import { adoptIn, grant, openIn, watchedFromTerminal } from './driver.js';
import { isOutingPage, readHandoff, readStartedHandoff } from './handoff.js';
import { current, dispatch, ready } from './store.js';
import { ON_TAB, isLive } from './view.js';

const AGAIN_MS = [500, 1000, 2000, 4000, 8000];
/** How many times one walk may ask its page for a fresh ticket, and how long it waits for the page to hand one over. */
const REFRESHES = 2;
const FRESH_MS = 15_000;
let tries = 0;
let connect = () => undefined;
let hangUp = () => undefined;
/** The worker's own connect, and a way to drop the socket it holds. */
export function dial(dialer, drop) { connect = dialer; hangUp = drop; }

/**
 * A development build with an `outing.json` beside the worker (the browser tests write one) walks without a
 * hand-off. The store build never does.
 */
let built = BUILD.devHosts ? undefined : null;
async function builtIn() {
  if (built === undefined) {
    try { built = await (await fetch(chrome.runtime.getURL('outing.json'))).json(); } catch { built = null; }
  }
  return built;
}

const kept = async () => (await chrome.storage.session.get('handoff')).handoff ?? null;

/** The walk is over for want of a connection. */
function lost() {
  dispatch({ type: 'fail', reason: 'connection' });
  void chrome.storage.session.remove('handoff');
}

/** Asks our outing page for a fresh ticket by reloading it: its content script hands the new block over ({@link take}). */
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const handoff = await kept();
    if (!handoff || current().state !== 'waiting') return;
    if ((handoff.refreshes ?? 0) >= REFRESHES || typeof handoff.tabId !== 'number') { lost(); return; }
    await chrome.storage.session.set({ handoff: { ...handoff, refreshes: (handoff.refreshes ?? 0) + 1 } });
    // Only the tab the hand-off came from, and only while it is still our outing page.
    const tab = await chrome.tabs.get(handoff.tabId).catch(() => null);
    if (!tab || !isOutingPage(tab.url ?? '')) { lost(); return; }
    await chrome.tabs.reload(handoff.tabId);
    // A page that hands nothing new over (the outing ended meanwhile) leaves nothing to wait for.
    setTimeout(async () => {
      const now = await kept();
      if (now?.ticket === handoff.ticket && current().state === 'waiting') lost();
    }, FRESH_MS);
  } catch {
    lost();
  } finally {
    refreshing = false;
  }
}

/** Where to connect, if anywhere: a hand-off still waiting for its walk, on a ticket not yet spent, else the build's own address. */
export async function whereTo() {
  await ready;
  const handoff = await kept();
  if (handoff && current().state === 'waiting') {
    // A spent ticket opens nothing: the page is asked for another.
    if (handoff.spent) { void refresh(); return null; }
    grant(handoff.allow);
    openIn(handoff.windowId);
    watchedFromTerminal(handoff.terminal ? handoff.tabId : null);
    adoptIn(typeof handoff.adopt === 'number' ? { tabId: handoff.adopt, site: handoff.site } : null);
    return { socket: handoff.socket, ticket: handoff.ticket };
  }
  const own = await builtIn();
  if (typeof own?.socket !== 'string') return null;
  grant(own.allow);
  openIn(null);
  watchedFromTerminal(null);
  adoptIn(null);
  return { socket: own.socket };
}

/** The socket opened: its ticket is spent, and said so where a worker that starts again reads it. */
export async function linked() {
  tries = 0;
  const handoff = await kept();
  if (handoff && !handoff.spent) await chrome.storage.session.set({ handoff: { ...handoff, spent: true } });
}

/** Why the hub closed the socket, as its close says it (the server's close reasons). */
const CLOSED = { replaced: 'replaced', over: 'outing over', cancelled: 'cancelled', undriven: 'no driver came', switchedOff: 'switched off' };

/**
 * The socket closed. A walk on its tab has lost whoever was driving it, unless the server said the outing was called
 * off or is over. A walk still waiting for its tab connects again, by the rule above.
 */
export function unlinked({ opened = false, reason = '' } = {}) {
  const { state } = current();
  // The person called it off somewhere else (the command): that is a stop, not a failure.
  if (reason === CLOSED.cancelled) { dispatch({ type: 'stop' }); void chrome.storage.session.remove('handoff'); return; }
  // Walks were switched off on the server: said once, waiting or on the tab, and nothing tries again.
  if (reason === CLOSED.switchedOff) { dispatch({ type: 'fail', reason: 'switched-off' }); void chrome.storage.session.remove('handoff'); return; }
  if (ON_TAB.includes(state)) { dispatch({ type: 'fail', reason: 'connection' }); return; }
  if (state !== 'waiting') return;
  // Another socket of this walk took this one's place: that one is the walk's now.
  if (reason === CLOSED.replaced) return;
  // The server let go before any tab opened: no walk is coming on this hand-off.
  if (reason === CLOSED.over || reason === CLOSED.undriven) { lost(); return; }
  if (opened) { void refresh(); return; }
  if (tries >= AGAIN_MS.length) { void refresh(); return; }
  setTimeout(() => { void connect(); }, AGAIN_MS[tries]);
  tries += 1;
}

async function take(text, sender) {
  await ready;
  // Chrome's own account of who sent it: the top frame of a tab on our outing page, through this extension's script.
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !isOutingPage(sender.url ?? '')) return { ok: false, why: 'origin' };
  const read = readHandoff(text, sender.url);
  if (!read.ok) return read;
  const before = await kept();
  const from = { windowId: sender.tab.windowId, tabId: sender.tab.id, terminal: new URL(sender.url).searchParams.get('from') === 'terminal' };
  if (isLive(current())) {
    if (before?.outing !== read.handoff.outing) return { ok: false, why: 'busy' };
    // The same walk, handed over again. While it still waits for its tab, a new ticket is a fresh way in (the page
    // was reloaded for one, or the person reloaded it); the same ticket again changes nothing.
    if (current().state !== 'waiting') return { ok: true };
    if (before.ticket !== read.handoff.ticket) {
      await chrome.storage.session.set({ handoff: { ...read.handoff, ...from, refreshes: before.refreshes ?? 0 } });
      tries = 0;
      hangUp();
      void connect();
    }
    return { ok: true };
  }
  await chrome.storage.session.set({ handoff: { ...read.handoff, ...from } });
  await chrome.storage.local.set({ linked: true });
  rearm();
  dispatch({ type: 'handoff', handoff: read.handoff });
  tries = 0;
  // A socket left open by an earlier walk is not this one's.
  hangUp();
  void connect();
  return { ok: true };
}

/**
 * A walk of the person's own tab, which main started (contact.js): its block, and the tab. Kept as `adopt`, never as
 * `tabId`: there is no page of ours to reload for a fresh ticket, so a spent one ends the walk.
 */
export async function adopt(text, tabId) {
  await ready;
  const read = readStartedHandoff(text);
  if (!read.ok) return read;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let at = null;
  try { at = new URL(tab?.url ?? '').origin; } catch { /* no address */ }
  if (at !== read.handoff.site) return { ok: false, why: 'tab' };
  if (isLive(current())) return { ok: false, why: 'busy' };
  await chrome.storage.session.set({ handoff: { ...read.handoff, adopt: tabId, windowId: tab.windowId } });
  await chrome.storage.local.set({ linked: true });
  rearm();
  dispatch({ type: 'handoff', handoff: read.handoff });
  tries = 0;
  hangUp();
  void connect();
  return { ok: true };
}

// The outing page's content script keeps a port open to this worker, so that it hears when the worker is ended
// (handoff-content.js). One thing is said on it: that no walk is waiting, so the page need not wake the worker again.
// Any other port is left alone.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'outing-page') return;
  void ready.then(() => { if (current().state !== 'waiting') port.postMessage({ rest: true }); }).catch(() => undefined);
});

/** Our pages whose click opens the panel: the outing page, and those the account adds (account/worker.js, the Pro welcome page). */
const panelPages = [isOutingPage];
export const opensPanel = (test) => { panelPages.push(test); };

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.handoff === 'string') {
    void take(message.handoff, sender).then(respond, () => respond({ ok: false, why: 'malformed' }));
    return true;
  }
  // A click on one of those pages opens the panel: called here and now, while Chrome still counts the click.
  if (message?.panel === 'open' && sender.id === chrome.runtime.id && sender.tab && panelPages.some((test) => test(sender.url ?? ''))) {
    void chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => undefined);
  }
  return false;
});
