// The walk's driver: the one tab a walk has, and every op the socket may ask of it (the walk protocol). It
// decides nothing: the session engine on the other end does the thinking. worker.js holds the socket and answers;
// guard.js says where the tab may be and what it may start.
import { admit, arm, held, onlyThisTab, popupWatch, refuseDownload, stillHome } from './guard.js';
import { COPY } from './panel/copy.js';
import { asksForPassword, isSignInPage, lookInPage, signingIn } from './signin.js';

/** What filming a wait needs, and nothing that closes or steers a target. */
const CDP_METHODS = new Set(['Page.startScreencast', 'Page.stopScreencast', 'Page.screencastFrameAck']);

/** The one tab this worker walks, while it does. */
export let walk = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function fail(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Where what the tab does is told: the worker's socket, once it has said so. */
let through = () => undefined;
export function speak(to) { through = to; }

/**
 * What the rest of the extension hangs on a walk: `opened` runs once the debugger is on the tab and the guard is
 * armed, before the tab goes anywhere; `closing` while the debugger can still reach the tab; `closed` with why the
 * walk let go of it (`closed`, or Chrome's reason for a detach); `said` hears every event told; `event` every
 * debugger event of the walked tab.
 */
export const hooks = { opened: [], closing: [], closed: [], said: [], event: [] };

/**
 * Set while the walk is paused, by the person or at a sign-in: no picture is taken and nothing of the page (its
 * address, a dialog's text, a frame, what the guard stopped) goes to the other end. Only these do: what the person
 * did, and the walk's own end. The guard keeps holding the tab as ever.
 */
let hush = false;
export const hushed = () => hush;
const TOLD_WHILE_HUSHED = new Set(['paused', 'resumed', 'takeover', 'handback', 'stopped', 'detached']);

/** Tells the other end, and whoever in here listens. */
export function say(message) {
  if (!hush || TOLD_WHILE_HUSHED.has(message.event)) through(hush && message.url !== undefined ? { ...message, url: '' } : message);
  for (const heard of hooks.said) heard(message);
}

/** The origins the hand-off allowed beyond this machine (guard.js `admit`). */
let granted = [];
export function grant(origins) { granted = Array.isArray(origins) ? origins : []; }

/**
 * The origins one `open` may walk: what the hand-off granted, less whatever the op's own list leaves out. The server
 * names the walk's one origin on `open`; it can hold a walk to fewer origins than its hand-off allowed, never to one more.
 */
const allowedFor = (allow) => (Array.isArray(allow) ? granted.filter((origin) => allow.includes(origin)) : granted);

/** The window a walk opens in: the one its hand-off came from, so the tab appears beside the page that started it. */
let home = null;
export function openIn(windowId) { home = typeof windowId === 'number' ? windowId : null; }

/** A debugger command on a tab, as Chrome answers it. */
export const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
const sendTo = (tabId) => (method, params) => send(tabId, method, params);

/** The walk lets go of the tab, whoever ended it. The debugger is already off, or never coming back. */
async function letGo(tab, why) {
  hush = false;
  for (const hook of hooks.closed) { try { await hook(why, tab); } catch { /* a listener's failure is its own */ } }
}

/** Ends the walk from in here: the debugger leaves at once, and the other end is told why. */
export async function endWalk(told, why, { tidy = false } = {}) {
  const tab = walk;
  if (!tab) return;
  if (tidy) for (const hook of hooks.closing) { try { await hook(tab); } catch { /* the tab may be gone */ } }
  if (walk !== tab) return;
  walk = null;
  await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined);
  say(told);
  await letGo(tab, why);
}

/** A debugger command on the walked tab. Chrome rejects with the protocol's error as JSON text: only its message is kept. */
async function cmd(method, params) {
  if (!walk) throw fail('OutingClosed', 'no tab is open');
  try {
    return await chrome.debugger.sendCommand({ tabId: walk.tabId }, method, params);
  } catch (err) {
    let message = String(err?.message ?? err);
    try { message = JSON.parse(message).message ?? message; } catch { /* not JSON: as it came */ }
    throw fail('Error', message);
  }
}

function within(work, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(fail('TimeoutError', message)), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * A wait's film: pictures of the walk's own viewport, one after another, each sent as a screencast frame.
 *
 * Chrome's own screencast films the tab's box in the window. A walk lays its page out at a size of its own
 * (`setViewport`), which a person's window seldom is, so those frames were the window's shape, not the page's: a
 * strip of nothing beside the page, and a size that changed with the window (705x441, 700x450 for a 1440x900 page).
 * The replay lays a step's film over its stills, so every frame must be the still's own picture, smaller. These are:
 * the same viewport the stills are taken of, scaled to fit what was asked for (the engine asks for one no wider than
 * 720: half a desktop's still, a phone's whole).
 *
 * How often one is sent. The engine keeps a frame only when it arrives 70 ms or more after the last it kept
 * (the server's least gap between film frames), and its own browser's screencast, a frame every 16 ms, gives it one
 * about every 83. A picture here costs about 66 ms (48 to take, 18 to make smaller), so sent as fast as they came
 * they arrived 67 ms apart and the engine kept every other one: half the film a review's replay has. Each is now
 * sent no sooner than this after the last, which the engine keeps every one of.
 */
const FILM_GAP_MS = 84;
/**
 * How long one picture may take. One asked for as the page leaves for another is never answered (Chrome drops it with
 * the old document, and rejects it only when the debugger leaves), so it is given up on and the next one asked for.
 */
const FILM_SHOT_MS = 150;
/** The least time between two pictures asked for when one fails at once. */
const FILM_RETRY_MS = 45;
let filmed = 0;

async function roll({ format = 'jpeg', quality = 50, maxWidth, maxHeight }) {
  await cut();
  const tab = walk;
  if (!tab) throw fail('OutingClosed', 'no tab is open');
  if (hush) throw fail('Paused', 'no film starts while the walk is paused');
  const film = { on: true, id: (filmed += 1), done: null, last: '', sentAt: 0 };
  tab.film = film;
  film.done = (async () => {
    while (film.on && walk === tab) {
      // Paused: the film stands still, taking nothing, until the walk goes on (or the film is cut).
      if (hush) { await sleep(FILM_RETRY_MS); continue; }
      const started = Date.now();
      try {
        let size = tab.viewport;
        if (!size) {
          const { cssLayoutViewport } = await cmd('Page.getLayoutMetrics');
          size = { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight };
        }
        const scale = Math.min(1, maxWidth > 0 ? maxWidth / size.width : 1, maxHeight > 0 ? maxHeight / size.height : 1);
        if (hush) continue;
        // A sign-in on the page is a pause before it is a picture; a page that cannot be read is not filmed.
        const seen = await look();
        if (signingIn(seen) || isSignInPage(tab.url)) { spotted(); continue; }
        if (!seen || hush) { await sleep(FILM_RETRY_MS); continue; }
        // Taken exactly as a still is (`screenshot`): the viewport, whole. It is made smaller here.
        const asked = cmd('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false });
        asked.catch(() => undefined);
        const shot = await Promise.race([asked, sleep(FILM_SHOT_MS).then(() => null)]);
        if (!shot) continue;
        const frame = await smaller(shot.data, Math.round(size.width * scale), Math.round(size.height * scale), format, quality);
        if (!film.on || walk !== tab) break;
        // Taken as the walk was paused: never sent.
        if (hush) continue;
        // A page that has not changed is not sent again: a film held open (the walk paused mid-wait) would otherwise send the same picture until it ends.
        if (frame === film.last) continue;
        // Held until the last one sent is `FILM_GAP_MS` old: paced where it is sent, so a picture that took longer or
        // shorter to take does not close the gap. In short sleeps, so a film that is cut is not kept waiting on one.
        while (film.on && walk === tab && Date.now() - film.sentAt < FILM_GAP_MS) await sleep(Math.min(8, FILM_GAP_MS - (Date.now() - film.sentAt)));
        if (!film.on || walk !== tab) break;
        if (hush) continue;
        film.last = frame;
        film.sentAt = Date.now();
        say({ event: 'cdp', method: 'Page.screencastFrame', params: { data: frame, sessionId: film.id, metadata: { deviceWidth: size.width, deviceHeight: size.height, pageScaleFactor: 1, offsetTop: 0, scrollOffsetX: 0, scrollOffsetY: 0, timestamp: Date.now() / 1000 } } });
      } catch {
        // A picture the tab would not give is not a frame; the next one may be: asked for after a moment, not at once.
        await sleep(Math.max(0, FILM_RETRY_MS - (Date.now() - started)));
      }
    }
  })();
}

/** A picture (base64) drawn at `width` by `height`, as base64 again. */
async function smaller(data, width, height, format, quality) {
  const picture = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(picture, 0, 0, width, height);
  picture.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: `image/${format}`, quality: quality / 100 })).arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** Ends the film under way, if there is one: no frame of it is sent once this has returned. */
async function cut() {
  const film = walk?.film;
  if (!film) return;
  film.on = false;
  walk.film = null;
  await film.done;
}

/** The walk is paused: from here nothing is taken or told of the page, and the network is not watched, until {@link unhold}. */
export async function hold() {
  if (hush) return;
  hush = true;
  if (walk) await cmd('Network.disable').catch(() => undefined);
}

/** The walk goes on: the network is watched again, afresh, and the other end is told where the tab now is. */
export async function unhold() {
  if (!hush) return;
  hush = false;
  const tab = walk;
  if (!tab) return;
  // What the network was busy with went unheard while paused: only what it asks from now on counts.
  tab.inflight.clear();
  tab.quietSince = Date.now();
  await cmd('Network.enable').catch(() => undefined);
  say({ event: 'url', url: tab.url });
}

/** The world the walk reads the page in for itself (signin.js), never the page's own. */
const LOOKOUT = 'impeccable-walk-lookout';

/**
 * What the walk's own reading of the top document sees (signin.js `lookInPage`), or null when it could not be read
 * (the document is between pages). Its world is made once a document.
 */
export async function look() {
  const tab = walk;
  if (!tab) return null;
  for (let tries = 0; tries < 2; tries++) {
    try {
      if (tab.lookout?.loader !== tab.loader) {
        const { executionContextId } = await cmd('Page.createIsolatedWorld', { frameId: tab.mainFrame, worldName: LOOKOUT });
        tab.lookout = { loader: tab.loader, context: executionContextId };
      }
      const { result, exceptionDetails } = await cmd('Runtime.evaluate', { expression: `(${lookInPage})()`, contextId: tab.lookout.context, returnByValue: true });
      if (!exceptionDetails && result?.value) return result.value;
    } catch { /* its world went with its document */ }
    tab.lookout = null;
  }
  return null;
}

/** Whom to tell of a sign-in (control.js pauses the walk). Told synchronously, so the pause holds before anything else is done. */
let spotted = () => undefined;
export function onSignIn(listener) { spotted = listener; }

/** Whether the walked tab is at a sign-in right now: by its address, or by what the page shows. */
export async function signInNow() {
  if (!walk) return false;
  if (isSignInPage(walk.url)) return true;
  return signingIn(await look());
}

/** How long `open` waits for its page to answer before it says the tab is open anyway. */
const OPEN_MS = 8000;

const navigationTimeout = (ms) => `Navigation timeout of ${ms} ms exceeded`;

/** The tab's page events from now on: `wait` resolves on the first one `match` accepts, one already seen included. */
function watch() {
  const seen = [];
  const waiting = new Set();
  const listener = (event) => {
    seen.push(event);
    for (const check of waiting) check(event);
  };
  walk.watchers.add(listener);
  const tab = walk;
  return {
    saw: (match) => seen.some(match),
    wait(match, ms, message) {
      if (seen.some(match)) return Promise.resolve();
      return within(new Promise((resolve) => {
        const check = (event) => { if (match(event)) { waiting.delete(check); resolve(); } };
        waiting.add(check);
      }), ms, message);
    },
    stop() { tab.watchers.delete(listener); },
  };
}

function setUrl(url) {
  if (!walk || walk.url === url) return;
  walk.url = url;
  say({ event: 'url', url });
  escaped(url);
}

/** Fails closed: a walked tab seen off its site is no longer walked. The guard holds every request, so this is the net under it. */
function escaped(url) {
  if (!walk || stillHome(url, walk.allowed)) return;
  void endWalk({ event: 'stopped', by: 'guard', url: String(url).slice(0, 500) }, 'left-site');
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!walk || source.tabId !== walk.tabId) return;
  // The tab as it was when the event came: one that shows the tab off its site ends the walk mid-way through.
  const watchers = walk.watchers;
  const tell = (event) => { for (const listener of watchers) listener(event); };
  for (const hook of hooks.event) hook(method, params);
  switch (method) {
    case 'Fetch.requestPaused': {
      const tab = walk;
      // A sign-in page asked for: paused before the guard answers, whatever it answers.
      if (params.resourceType === 'Document' && params.frameId === tab.mainFrame && isSignInPage(params.request?.url)) spotted();
      void held(sendTo(tab.tabId), params, tab.mainFrame, tab.allowed, (url) => {
        for (const listener of tab.watchers) listener({ kind: 'refused', url });
        say({ event: 'blocked', what: 'navigation', url });
      }).then((became) => {
        // A request that never went out never finishes either: it is not something the network is busy with.
        if (became === 'continued' || !params.networkId || !tab.inflight.delete(params.networkId)) return;
        if (tab.inflight.size === 0) tab.quietSince = Date.now();
      });
      break;
    }
    case 'Page.fileChooserOpened':
      // Intercepted, so no picker opened; nothing answers it, so the page gets no file.
      say({ event: 'blocked', what: 'file-picker' });
      break;
    case 'Page.downloadWillBegin':
      say({ event: 'blocked', what: 'download', url: String(params.url).slice(0, 500) });
      void refuseDownload(params.url);
      break;
    case 'Page.windowOpen': {
      const seen = popups.announce(params.url);
      if (seen !== null) closePopup(seen.id, params.url, addressOf(seen) !== undefined);
      break;
    }
    case 'Page.frameNavigated':
      if (params.frame.parentId) break;
      walk.mainFrame = params.frame.id;
      walk.loader = params.frame.loaderId;
      // What the page before was still loading went with it, and Chrome does not always say so: only what the new
      // document asked for is the network being busy.
      for (const [id, loader] of walk.inflight) if (loader !== params.frame.loaderId) walk.inflight.delete(id);
      if (walk.inflight.size === 0) walk.quietSince = Date.now();
      setUrl(params.frame.url + (params.frame.urlFragment ?? ''));
      tell({ kind: 'navigated', type: params.type });
      break;
    case 'Page.navigatedWithinDocument':
      if (params.frameId !== walk.mainFrame) break;
      setUrl(params.url);
      tell({ kind: 'within' });
      break;
    case 'Page.lifecycleEvent':
      if (params.frameId === walk.mainFrame) tell({ kind: 'lifecycle', name: params.name, loaderId: params.loaderId });
      break;
    case 'Network.requestWillBeSent':
      walk.inflight.set(params.requestId, params.loaderId);
      break;
    case 'Network.responseReceived':
      if (params.type === 'Document' && params.frameId === walk.mainFrame) {
        walk.statuses.set(params.loaderId, params.response.status);
        if (asksForPassword(params.response)) spotted();
      }
      break;
    case 'Network.loadingFinished':
    case 'Network.loadingFailed':
      walk.inflight.delete(params.requestId);
      if (walk.inflight.size === 0) walk.quietSince = Date.now();
      break;
    case 'Page.javascriptDialogOpening':
      // A native dialog holds every later command on the tab until it is answered. Dismissed, never accepted.
      chrome.debugger.sendCommand({ tabId: walk.tabId }, 'Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined);
      say({ event: 'dialog', type: params.type, message: String(params.message).slice(0, 200) });
      break;
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!walk || source.tabId !== walk.tabId) return;
  const tab = walk;
  walk = null;
  say({ event: 'detached', reason });
  void letGo(tab, reason);
});

/** Which new tabs are the walked tab's (guard.js). */
const popups = popupWatch();

/** Popups told and not yet closed: each with the timer that closes it if Chrome never says it started. */
const doomed = new Map();
const POPUP_GRACE_MS = 1000;

function removePopup(tabId) {
  clearTimeout(doomed.get(tabId));
  doomed.delete(tabId);
  const walked = walk?.tabId;
  void (async () => {
    // A popup that took the front of the walked tab's window gives it back: the person is watching the walk.
    const popup = await chrome.tabs.get(tabId).catch(() => null);
    const home = walked === undefined ? null : await chrome.tabs.get(walked).catch(() => null);
    await chrome.tabs.remove(tabId).catch(() => undefined);
    if (popup?.active && home && popup.windowId === home.windowId) await chrome.tabs.update(walked, { active: true }).catch(() => undefined);
  })();
}

const addressOf = (tab) => [tab.pendingUrl, tab.url].find((url) => url && url !== 'about:blank');

/**
 * A tab the walked tab opened is closed at once when it is already going somewhere, and otherwise the moment it starts
 * to. Not before that: where something holds a new tab before it runs (a debugger that waits on popups does), closing
 * it then leaves the page that called `window.open` waiting on it for good. The engine is told its address (`popup`),
 * and that it was stopped.
 */
function closePopup(tabId, url, started) {
  if (started) removePopup(tabId);
  else doomed.set(tabId, setTimeout(() => removePopup(tabId), POPUP_GRACE_MS));
  say({ event: 'popup', url });
  say({ event: 'blocked', what: 'popup', url: String(url).slice(0, 500) });
}

chrome.tabs.onCreated.addListener((tab) => {
  if (!walk || tab.id === walk.tabId) return;
  const url = popups.created(tab, walk.tabId);
  if (url !== null) closePopup(tab.id, url, addressOf(tab) !== undefined);
});
// Chrome's own word for where the walked tab is, beside the debugger's: the net under the guard does not rest on one.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (doomed.has(tabId) && (change.status || change.url)) removePopup(tabId);
  if (walk && tabId === walk.tabId && change.url) escaped(change.url);
});

/** The network has been quiet for `idleTime`, or the wait ran out. */
async function idle(idleTime, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    if (!walk) throw fail('OutingClosed', 'the tab is gone');
    const quiet = walk.inflight.size === 0 ? Date.now() - walk.quietSince : 0;
    if (quiet >= idleTime) return;
    if (Date.now() >= end) throw fail('TimeoutError', `Timeout of ${timeout} ms exceeded waiting for the network to go quiet`);
    await sleep(Math.max(10, Math.min(50, idleTime - quiet)));
  }
}

/** A function's source called with its arguments, or an expression as it is. */
function expression({ fn, args, undef }) {
  if (!Array.isArray(args)) return fn;
  return `(${fn}\n)(${args.map((arg, i) => (undef?.includes(i) ? 'undefined' : JSON.stringify(arg))).join(',')})`;
}

/** The keys a press may name (the engine's `normalizeKey`), as the protocol wants them. */
const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
};

function keyOf(name) {
  const named = KEYS[name];
  if (named) return { key: named.key ?? name, code: named.code, windowsVirtualKeyCode: named.vk, ...(named.text ? { text: named.text } : {}) };
  if ([...name].length !== 1) throw fail('Error', `Unknown key: "${name}"`);
  const upper = name.toUpperCase();
  const code = /^[A-Z]$/.test(upper) ? `Key${upper}` : /^[0-9]$/.test(name) ? `Digit${name}` : undefined;
  return { key: name, text: name, ...(code ? { code, windowsVirtualKeyCode: upper.charCodeAt(0) } : {}) };
}

async function press(name) {
  const key = keyOf(name);
  await cmd('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', ...key });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, ...(key.code ? { code: key.code, windowsVirtualKeyCode: key.windowsVirtualKeyCode } : {}) });
}

export const ops = {
  // The tab is this walk's own, opened empty: the guard is on it before it asks for anything.
  async open({ url, name, allow }) {
    if (walk) throw fail('NotSupported', 'an outing has one tab');
    const site = admit(url, allowedFor(allow));
    // In the hand-off's window if it is still there, else wherever Chrome puts a new tab.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true, ...(home === null ? {} : { windowId: home }) }).catch(() => chrome.tabs.create({ url: 'about:blank', active: true }));
    let group;
    try {
      // In the tab's own window: left to itself, a new group lands in whichever window was last in front, and takes the tab with it.
      const id = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(id, { title: COPY.tabGroup(name), color: 'purple' });
      group = { id, title: (await chrome.tabGroups.get(id)).title };
    } catch (err) {
      group = { error: String(err?.message ?? err) };
    }
    const before = await chrome.tabs.get(tab.id);
    try {
      await chrome.debugger.attach({ tabId: tab.id }, '1.3');
      walk = { tabId: tab.id, name, url: 'about:blank', origin: site.origin, allowed: site.allowed, mainFrame: undefined, loader: undefined, inflight: new Map(), quietSince: Date.now(), statuses: new Map(), watchers: new Set(), mouse: { x: 0, y: 0, down: false } };
      await cmd('Page.enable');
      await cmd('Network.enable');
      await cmd('Page.setLifecycleEventsEnabled', { enabled: true });
      const { frameTree } = await cmd('Page.getFrameTree');
      walk.mainFrame = frameTree.frame.id;
      walk.loader = frameTree.frame.loaderId;
      await arm(cmd);
      for (const hook of hooks.opened) await hook(walk);
      // Until the page has answered, or for a few seconds: a `goto` that follows at once then starts from a tab at
      // rest, not across a navigation still under way. A page that did not load is the engine's to find, with its own patience.
      await within(cmd('Page.navigate', { url }), OPEN_MS, 'slow').catch(() => undefined);
    } catch (err) {
      // A walk that could not be guarded does not start, and leaves no empty tab behind.
      walk = null;
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => undefined);
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      throw err;
    }
    return { value: { tabId: tab.id, group, before: { width: before.width, height: before.height } } };
  },

  async goto({ url, waitUntil, timeout }) {
    if (!stillHome(url, walk.allowed)) {
      say({ event: 'blocked', what: 'navigation', url: String(url).slice(0, 500) });
      throw fail('NotAllowed', `a walk stays on ${walk.origin}`);
    }
    const want = waitUntil === 'domcontentloaded' ? 'DOMContentLoaded' : 'load';
    const started = Date.now();
    const page = watch();
    try {
      const sent = await within(cmd('Page.navigate', { url }), timeout, navigationTimeout(timeout));
      // The address was on the site and something it led to was not: refused by name, not as a load that failed.
      if (sent.errorText && page.saw((e) => e.kind === 'refused')) throw fail('NotAllowed', `a walk stays on ${walk.origin}`);
      if (sent.errorText) throw fail('Error', `${sent.errorText} at ${url}`);
      // The same document (a fragment): nothing loads.
      if (!sent.loaderId) return { value: { status: null } };
      await page.wait((e) => e.kind === 'lifecycle' && e.loaderId === sent.loaderId && e.name === want, Math.max(1, timeout - (Date.now() - started)), navigationTimeout(timeout));
      if (waitUntil === 'networkidle0') await idle(500, Math.max(1, timeout - (Date.now() - started))).catch(() => { throw fail('TimeoutError', navigationTimeout(timeout)); });
      return { value: { status: walk.statuses.get(sent.loaderId) ?? null } };
    } finally {
      page.stop();
    }
  },

  async goBack({ waitUntil, timeout }) {
    const want = waitUntil === 'domcontentloaded' ? 'DOMContentLoaded' : 'load';
    const history = await cmd('Page.getNavigationHistory');
    if (history.currentIndex < 1) return { value: null };
    const page = watch();
    try {
      let navigated = false;
      await cmd('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id });
      // A page kept whole in the back/forward cache comes back with no load; one in the same document, with no navigation.
      await page.wait((e) => {
        if (e.kind === 'within') return true;
        if (e.kind === 'navigated') { navigated = true; return e.type === 'BackForwardCacheRestore'; }
        return navigated && e.kind === 'lifecycle' && e.name === want;
      }, timeout, navigationTimeout(timeout));
      return { value: { status: walk.statuses.get(walk.loader) ?? null } };
    } finally {
      page.stop();
    }
  },

  async url() {
    const { frameTree } = await cmd('Page.getFrameTree');
    setUrl(frameTree.frame.url + (frameTree.frame.urlFragment ?? ''));
    return { value: walk.url };
  },

  async evaluate(req) {
    const { result, exceptionDetails } = await cmd('Runtime.evaluate', { expression: expression(req), returnByValue: true, awaitPromise: true, userGesture: true });
    if (exceptionDetails) throw fail('Error', String(exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 500));
    return result.unserializableValue ? { unserializable: result.unserializableValue } : { value: result.value };
  },

  async evaluateOnNewDocument(req) {
    return { value: await cmd('Page.addScriptToEvaluateOnNewDocument', { source: expression(req) }) };
  },

  async setViewport({ width, height, deviceScaleFactor, mobile }) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
    walk.viewport = { width, height };
    return {};
  },

  // Page.captureScreenshot alone: no Page.bringToFront, so the person's own tab stays in front.
  async screenshot({ format, quality, clip }) {
    const { data } = await cmd('Page.captureScreenshot', { format, ...(quality === undefined ? {} : { quality }), ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
    return { value: { data } };
  },

  async mouse({ action, x, y }) {
    const m = walk.mouse;
    if (action === 'move' || action === 'click') {
      m.x = x;
      m.y = y;
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: m.down ? 'left' : 'none', buttons: m.down ? 1 : 0 });
    }
    if (action === 'down' || action === 'click') {
      m.down = true;
      await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.x, y: m.y, button: 'left', buttons: 1, clickCount: 1 });
    }
    if (action === 'up' || action === 'click') {
      m.down = false;
      await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m.x, y: m.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    return {};
  },

  async keyboard({ action, key, text }) {
    if (action === 'press') await press(key);
    else {
      for (const ch of text) {
        if (ch === '\n' || ch === '\r') await press('Enter');
        // One code point a key where it has one; anything else is put in as text, as an input method would.
        else if (ch.length === 1 && ch >= ' ' && ch <= '~') await press(ch === ' ' ? 'Space' : ch);
        else await cmd('Input.insertText', { text: ch });
      }
    }
    return {};
  },

  async waitForNetworkIdle({ idleTime, timeout }) {
    await idle(idleTime, timeout);
    return {};
  },

  // Filming a wait (the server asks in the protocol's own words, and hears its frames in them).
  async cdp({ method, params }) {
    if (!CDP_METHODS.has(method)) throw fail('NotAllowed', `${method} is not passed to the tab`);
    if (method === 'Page.startScreencast') await roll(params ?? {});
    else if (method === 'Page.stopScreencast') await cut();
    // An acknowledgement asks for the next frame of Chrome's own screencast; these frames wait for none.
    return { value: {} };
  },

  async tab() {
    if (!walk) throw fail('OutingClosed', 'no tab is open');
    const tab = await chrome.tabs.get(walk.tabId);
    const win = await chrome.windows.get(tab.windowId);
    return { value: { active: tab.active, width: tab.width, height: tab.height, groupId: tab.groupId, window: { focused: win.focused, state: win.state, width: win.width, height: win.height } } };
  },

  // The debugger leaves; the tab stays as the walk left it.
  async close() {
    const tab = walk;
    if (tab) for (const hook of hooks.closing) { try { await hook(tab); } catch { /* the tab may be gone */ } }
    walk = null;
    if (tab) {
      await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined);
      await letGo(tab, 'closed');
    }
    return {};
  },
};

// No op names where it acts: the walked tab, and nowhere else (guard.js).
for (const [name, run] of Object.entries(ops)) ops[name] = (req = {}) => { onlyThisTab(req); return run(req); };
