// The walk's driver: the one tab a walk has, and every op the socket may ask of it (the walk protocol). It
// decides nothing: the session engine on the other end does the thinking. worker.js holds the socket and answers;
// guard.js says where the tab may be and what it may start.
import { ASK_AFTER_INPUT_MS, MAX_OTHER_SITES, MAX_SITE_QUESTIONS, admit, arm, askable, held, onSite, onlyThisTab, popupWatch, reads, refuseDownload, siteOrigins, stillHome, webOrigin } from './guard.js';
import { COPY } from './panel/copy.js';
import { asksForPassword, isSignInPage, lookInPage, signingIn } from './signin.js';
import { seenAs } from './sight.js';

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
 * debugger event of the walked tab; `withheld` each write the Fetch hold kept back while paused at a sign-in.
 */
export const hooks = { opened: [], closing: [], closed: [], said: [], event: [], held: [], withheld: [] };

/**
 * Set while the walk is paused, by the person or at a sign-in: no picture is taken and nothing of the page (its
 * address, a dialog's text, a frame, what the guard stopped) goes to the other end. Only these do: what the person
 * did, and the walk's own end. The guard keeps holding the tab as ever.
 */
let hush = false;
export const hushed = () => hush;

/**
 * Counts each time the walk stops walking (paused, taken over, ended): an op that sees it change while it runs was
 * overtaken by it (control.js). Typing and clicking look between their keys and presses too.
 */
let fences = 0;
export const fenced = () => fences;
export function fence() {
  fences += 1;
  // Writes opened for a deed close with it: whatever stops the walk walking settles that deed (REN-2034).
  shutWrites();
}

/**
 * The write hold (REN-2034): every write the tab sends is held, unless writes are open: by the server's `writes`, or
 * by the person's Yes to a deed ({@link letWrite}). The person drives once they took the tab over. Paused at a sign-in
 * (which a page can bring on itself, never a take-over), only what the tab sends soon after the person's own press or
 * key in it is theirs ({@link feelInput}): a page's timer or autosave stays held. A plain pause holds them as walking does.
 */
let driver = { by: null, since: 0 };
export function drivenBy(by) { if (by !== driver.by) { driver = { by, since: Date.now() }; void heldMayChange(); } }
/** How long after the person's own press or key, at a sign-in pause, what the tab sends is taken for theirs. */
export const INPUT_WINDOW_MS = 5000;
/** When the person last pressed or typed in the tab while it was paused at a sign-in. */
let touched = -Infinity;
const persons = (at) => driver.by === 'takeover' || (driver.by === 'sign-in' && touched >= driver.since && at - touched <= INPUT_WINDOW_MS);
const holding = (tab, at) => !tab.writesOpen && !persons(at);
/** Whether the walk's writes are held right now, for the network rules beside this hold (net-hold.js). */
export const writesHeld = (at = Date.now()) => Boolean(walk) && holding(walk, at);
/** Tells whoever follows the hold that it may have changed: resolves once they have caught up. */
const heldMayChange = () => Promise.all(hooks.held.map((hook) => Promise.resolve().then(hook).catch(() => undefined)));
/** Counts each close: a Yes given after one opens nothing (a late Yes to a deed the server already gave up on). */
let writesShut = 0;
export const writesNow = () => writesShut;
function shutWrites() {
  writesShut += 1;
  if (walk) walk.writesOpen = false;
  void heldMayChange();
}
/** The person said Yes to a deed, asked when the closes stood at `asked`: its writes go out until the server closes them, or the walk stops walking. */
export function letWrite(asked) {
  if (walk && asked === writesShut) walk.writesOpen = true;
  return heldMayChange();
}

/**
 * Network on, with the tab's service workers bypassed: a write a service worker would answer or send for the page
 * passes the walk's Fetch hold instead (the server's own browser bypasses them for its hold too). Chrome keeps the
 * bypass only while Network is on (measured: `Network.disable` drops it), so a pause leaves Network on. A tab that
 * will not be bypassed is not walked.
 */
async function watchNetwork() {
  await cmd('Network.enable');
  await cmd('Network.setBypassServiceWorker', { bypass: true });
}
const overtaken = (at) => { if (fences !== at) throw fail('Paused', 'the journey was paused before this was done'); };
// `answered`: a pause during a question settles it, and the other end waits on that answer.
const TOLD_WHILE_HUSHED = new Set(['paused', 'resumed', 'takeover', 'handback', 'stopped', 'detached', 'answered']);

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

/**
 * The person's own tab a walk main started is to walk (`{ tabId, site, device }`, `device` one of DEVICES or none), or
 * null: the walk opens a tab of its own.
 * Such a walk opens and closes no tab, starts where the tab is, keeps its size, takes stills only, and may go to
 * another site when the person says yes (guard.js `askable`).
 */
let adopted = null;
export function adoptIn(tab) { adopted = tab; }

/**
 * A walk watched from the terminal (its page's address says `from=terminal`): the tab of the page that handed it over,
 * or null. That page goes once the walk's own tab is open, and the walk's own tab goes when the walk lets go of it: the
 * terminal shows the steps, and opens the result.
 */
let terminal = null;
export function watchedFromTerminal(pageTabId) { terminal = typeof pageTabId === 'number' ? pageTabId : null; }

/** Whom to ask before a deed or another site (control.js): resolves to `yes`, `no`, or `void` when the walk stopped walking. */
let asker = async () => 'no';
export function onAsk(listener) { asker = listener; }

/**
 * Whether the walked tab of the person's own walk may go to `url`, another site: only when the person says yes to it,
 * which makes it the walk's for the rest of it. Asked only of a move the walk's own click or key made, never while
 * going back, paused or already asking, once per site, and only so many times (guard.js). A No is kept: that site is
 * refused unasked from then on. The other end hears the question and its answer before the move goes on or fails.
 */
async function mayGo(url) {
  const tab = walk;
  const origin = webOrigin(url);
  if (!tab?.adopted || !askable(url, tab.allowed) || tab.refused.has(origin) || tab.goingBack || tab.asking || hush) return false;
  if (!(Date.now() - tab.lastInputAt <= ASK_AFTER_INPUT_MS) || tab.sites >= MAX_OTHER_SITES || tab.questions >= MAX_SITE_QUESTIONS) return false;
  tab.questions += 1;
  tab.asking = true;
  say({ event: 'asking', kind: 'go', origin });
  const said = await asker({ kind: 'go', what: new URL(url).host });
  tab.asking = false;
  say({ event: 'answered', kind: 'go', origin, said });
  if (walk !== tab || said === 'void') return false;
  if (said === 'no') { for (const one of siteOrigins(origin)) tab.refused.add(one); return false; }
  tab.sites += 1;
  tab.allowed.push(...siteOrigins(origin));
  // The move goes on from the Yes: a redirect it makes to yet another site may still be asked about.
  tab.lastInputAt = Date.now();
  return true;
}

/**
 * The widths a walk of the person's own tab may run at, picked in the side panel (REN-1890): the server's own sizes for
 * them (its `mobile` and `tablet`). Desktop is not here: the tab keeps its own size. Both take touch and name
 * themselves as Chrome on Android, a phone as a mobile one.
 *
 * At the screen's own pixel density, as a desktop walk is, not one device pixel a CSS pixel: Chrome takes every
 * picture of a tab whose density differs from its screen's by laying it out again at that density for the moment,
 * which on a 2x screen drew the page at a quarter of its size and back on every film frame (the flicker beside the
 * page) and put a press made meanwhile at twice its coordinates. Its pictures are drawn back down to the CSS size.
 */
export const DEVICES = { tablet: { width: 820, height: 1180, phone: false }, phone: { width: 390, height: 844, phone: true } };

/** What the tab says it is at `device`: this Chrome's own version, on Android. */
function agentOf(device) {
  const major = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '120';
  const mobile = DEVICES[device].phone;
  const brands = navigator.userAgentData?.brands ?? [];
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${mobile ? ' Mobile' : ''} Safari/537.36`,
    userAgentMetadata: { brands, platform: 'Android', platformVersion: '10', architecture: '', model: mobile ? 'K' : '', mobile },
  };
}

/** Lays the walked tab out as `device` (DEVICES); the tab as it is for any other. */
async function sizeTo(device) {
  const size = DEVICES[device];
  if (!size) return;
  walk.sized = device;
  // Kept beyond this worker: one Chrome ends mid-journey leaves the tab to the next to give back (`giveBack`).
  await chrome.storage.session.set({ sizedTab: { tabId: walk.tabId, device } }).catch(() => undefined);
  await cmd('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cmd('Emulation.setUserAgentOverride', agentOf(device));
}

/**
 * Gives the tab its own size back, before the debugger leaves it: past `cmd`, which refuses once the walk is ending.
 * A debugger that left without this (Cancel on Chrome's bar) is `unstick`'s.
 */
async function unsize(tab) {
  if (!tab?.sized) return;
  tab.sized = false;
  const to = sendTo(tab.tabId);
  await Promise.all([to('Emulation.clearDeviceMetricsOverride'), to('Emulation.setTouchEmulationEnabled', { enabled: false }), to('Emulation.setUserAgentOverride', { userAgent: '' })]
    .map((done) => done.catch(() => undefined)));
  await chrome.storage.session.remove('sizedTab').catch(() => undefined);
}

/** The walked tab's page, loaded again once under its new size and user agent, before anything is taken of it. */
async function reloadSized() {
  const page = watch();
  const was = walk.loader;
  try {
    await cmd('Page.reload');
    await page.wait((e) => e.kind === 'lifecycle' && e.name === 'load' && e.loaderId !== was, OPEN_MS, 'slow').catch(() => undefined);
  } finally {
    page.stop();
  }
}

/** Whether the walked tab is on a site the walk only looks at: another site the person let it go to. */
export const lookOnly = () => Boolean(walk?.adopted && !stillHome(walk.url, walk.writable));

/** A debugger command on a tab, as Chrome answers it. */
export const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
const sendTo = (tabId) => (method, params) => send(tabId, method, params);

/** The tab's requests are no longer held, before the debugger leaves it: past `cmd`, which refuses once the walk is ending. */
async function unhook(tab) {
  shutWrites();
  tab.writesOpen = false;
  await send(tab.tabId, 'Fetch.disable').catch(() => undefined);
}

/** The walk lets go of the tab, whoever ended it. The debugger is already off, or never coming back. */
async function letGo(tab, why) {
  hush = false;
  if (tab.grouped) await chrome.tabs.ungroup(tab.tabId).catch(() => undefined);
  for (const hook of hooks.closed) { try { await hook(why, tab); } catch { /* a listener's failure is its own */ } }
}

/** Ends the walk from in here: the debugger leaves at once, and the other end is told why. */
export async function endWalk(told, why, { tidy = false } = {}) {
  const tab = walk;
  if (!tab) return;
  tab.ending = true;
  if (tidy) for (const hook of hooks.closing) { try { await hook(tab); } catch { /* the tab may be gone */ } }
  if (walk !== tab) return;
  walk = null;
  await unsize(tab);
  await unhook(tab);
  await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined);
  say(told);
  await letGo(tab, why);
}

/** A debugger command on the walked tab. Chrome rejects with the protocol's error as JSON text: only its message is kept. */
async function cmd(method, params) {
  // Once the walk is ending, nothing more reaches the tab: not an op a pause held, not the rest of one under way.
  if (!walk || walk.ending) throw fail('OutingClosed', 'no tab is open');
  const own = method.startsWith('Input.');
  if (own) ownInput.busy += 1;
  try {
    return await chrome.debugger.sendCommand({ tabId: walk.tabId }, method, params);
  } catch (err) {
    let message = String(err?.message ?? err);
    try { message = JSON.parse(message).message ?? message; } catch { /* not JSON: as it came */ }
    // On the tab, and refused it while another extension's frame is in the page: as good as pushed off (`lost`).
    if (message.includes('URL of different extension') && walk) void lost(walk);
    throw fail('Error', message);
  } finally {
    if (own) { ownInput.busy -= 1; ownInput.at = Date.now(); }
  }
}

/** The walk's own presses and keys under way, and when the last one was answered: Chrome makes them trusted too. */
const ownInput = { busy: 0, at: -Infinity };
/** How long after its own press or key is answered the page may still be telling of it. */
const OWN_INPUT_MS = 250;

/*
 * The person's own press or key in the tab, told by the walk's world (never the page's, which cannot reach its
 * binding), and only if Chrome made it: a page can dispatch a pointerdown or a keydown, never a trusted one. Not a
 * submit or a click, which a page's `requestSubmit()` or a label can bring about. Installed before the page's own
 * scripts, so it hears first.
 */
const FELT = '__impeccableWalkFelt';
function feelInput(binding) {
  if (globalThis.__impeccableWalkFeels) return;
  globalThis.__impeccableWalkFeels = true;
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, (event) => { if (event.isTrusted) globalThis[binding]?.(type); }, { capture: true, passive: true });
}
hooks.opened.push(async (tab, again = false) => {
  const source = `(${feelInput})(${JSON.stringify(FELT)})`;
  await cmd('Runtime.enable');
  await cmd('Runtime.addBinding', { name: FELT, executionContextName: LOOKOUT });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source, worldName: LOOKOUT });
  // A document already there (the person's own tab, or the debugger back on it) is felt from now on.
  if (tab.adopted || again) await inLookout(source);
});

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

/**
 * A film's picture and the walk's pointer never overlap. Measured (Chrome for Testing on a 2x Mac display, the tab at
 * the engine's 1280x800, scale 1): a mouse event Chrome takes while `Page.captureScreenshot` runs lands at twice its
 * coordinates, so a click on a link at (1150, 32) reached the page at (2300, 64), on nothing (HR Pilot's login links,
 * which never navigated). The film takes no picture while the pointer acts, and the pointer waits out the one being
 * taken, no longer than a picture may take (`FILM_SHOT_MS`): one Chrome never answers is not one it is taking.
 */
let capturing = null;
let pointing = 0;
async function pointer(work) {
  pointing += 1;
  try {
    if (capturing) await Promise.race([capturing, sleep(FILM_SHOT_MS)]);
    return await work();
  } finally {
    pointing -= 1;
  }
}
/** Set while the person has taken the tab over (control.js): the film takes nothing of what they do. */
let theirs = false;
export function personHas(on) { theirs = on; }
/** Whether the film takes nothing now: paused, the person's, or after a sign-in until the server's scripts are back on (`seal`). */
const blind = (tab) => hush || theirs || Boolean(tab.withdrawn && tab.secret);

async function roll({ format = 'jpeg', quality = 50, maxWidth, maxHeight }) {
  await cut();
  const tab = walk;
  if (!tab) throw fail('OutingClosed', 'no tab is open');
  if (hush) throw fail('Paused', 'no film starts while the journey is paused');
  const film = { on: true, id: (filmed += 1), done: null, last: '', sentAt: 0 };
  tab.film = film;
  film.done = (async () => {
    while (film.on && walk === tab) {
      // Paused, or in the person's hands: the film stands still, taking nothing, until the walk goes on (or the film is cut).
      if (blind(tab)) { await sleep(FILM_RETRY_MS); continue; }
      const started = Date.now();
      try {
        let size = tab.viewport;
        if (!size) {
          const { cssLayoutViewport } = await cmd('Page.getLayoutMetrics');
          size = { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight };
        }
        const scale = Math.min(1, maxWidth > 0 ? maxWidth / size.width : 1, maxHeight > 0 ? maxHeight / size.height : 1);
        if (blind(tab)) continue;
        // A sign-in on the page is a pause before it is a picture; a page that cannot be read is not filmed.
        const seen = await look();
        if (signInShows(tab, seen)) { spotted(); continue; }
        if (!seen || blind(tab)) { await sleep(FILM_RETRY_MS); continue; }
        // Not while the pointer acts (`pointer`).
        if (pointing > 0) { await sleep(FILM_RETRY_MS); continue; }
        // Taken exactly as a still is (`screenshot`): the viewport, whole. It is made smaller here.
        const asked = cmd('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false });
        const taking = asked.then(() => undefined, () => undefined);
        capturing = taking;
        void taking.then(() => { if (capturing === taking) capturing = null; });
        const shot = await Promise.race([asked, sleep(FILM_SHOT_MS).then(() => null)]);
        if (!shot) continue;
        const frame = await smaller(await seenAs(shot.data, 'jpeg', 80), Math.round(size.width * scale), Math.round(size.height * scale), format, quality);
        if (!film.on || walk !== tab) break;
        // Taken as the walk was paused or taken over: never sent.
        if (blind(tab)) continue;
        // A page that has not changed is not sent again: a film held open (the walk paused mid-wait) would otherwise send the same picture until it ends.
        if (frame === film.last) continue;
        // Held until the last one sent is `FILM_GAP_MS` old: paced where it is sent, so a picture that took longer or
        // shorter to take does not close the gap. In short sleeps, so a film that is cut is not kept waiting on one.
        while (film.on && walk === tab && Date.now() - film.sentAt < FILM_GAP_MS) await sleep(Math.min(8, FILM_GAP_MS - (Date.now() - film.sentAt)));
        if (!film.on || walk !== tab) break;
        if (blind(tab)) continue;
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

/**
 * Set while the person has taken the tab over at a sign-in (control.js): the walk does nothing then, so what the tab
 * does is the person signing in (or the page they are on). Only then may the tab go to a sign-in page (signin.js)
 * and send it what it asks.
 */
let heldAtSignIn = false;

/**
 * The walk is paused: from here nothing is taken or told of the page, and the network is not heard, until
 * {@link unhold}. `signIn` when it is held at a sign-in.
 */
export async function hold(signIn = false) {
  heldAtSignIn = signIn;
  hush = true;
}

/** The walk goes on: the network is watched again, afresh, and the other end is told where the tab now is. */
export async function unhold() {
  heldAtSignIn = false;
  if (!hush) return;
  hush = false;
  const tab = walk;
  if (!tab) return;
  // What the network was busy with went unheard while paused: only what it asks from now on counts.
  tab.inflight.clear();
  tab.quietSince = Date.now();
  say({ event: 'url', url: tab.url });
}

/** The world the walk reads the page in for itself (signin.js), never the page's own. */
const LOOKOUT = 'impeccable-walk-lookout';

/*
 * What the server put in the page never meets the person signing in (REN-2052). At a sign-in pause or a take-over its
 * scripts for new documents are taken off the tab ({@link seal}), so no page the person opens then runs them. Before
 * the walk's next op ({@link fresh}):
 *   1. A sign-in on the page keeps them off, so the page the person signs in on runs none of them.
 *   2. `window.name` is cleared: it outlives a navigation on the same site.
 *   3. The scripts go back on, and run once in a document that started without them.
 * The page is never left or loaded again to clean it: that reuses one-time links, gets a posted form's result again,
 * and adds a history entry. So code the server put in a document from before the pause (a listener copying keys)
 * stays in it, as does what it wrote to the address or the site's storage. Only fixed page reads close that.
 */
export function seal(kind = 'sign-in') {
  const tab = walk;
  if (!tab) return;
  tab.seals = (tab.seals ?? 0) + 1;
  // Sent before anything else the tab is told: a sign-in page the guard is about to let load gets none of them.
  for (const script of tab.newDocument ?? []) {
    if (script.identifier) takeOff(tab, script.identifier);
    script.identifier = null;
  }
  tab.secret = kind === 'sign-in' || Boolean(tab.withdrawn && tab.secret);
  tab.withdrawn = true;
}

/** How many times a script is asked off the tab before the walk counts it as maybe still on. */
const TAKE_OFF_TRIES = 2;

/** Asks one of the server's scripts off the tab: until it is known to be, the walk does not go on (`sealed`). */
function takeOff(tab, identifier, tries = TAKE_OFF_TRIES) {
  (tab.unsealed ??= new Set()).add(identifier);
  const going = (async () => {
    for (let n = 0; n < tries && tab.unsealed.has(identifier); n++) {
      try {
        await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      } catch (err) {
        // Not found: already off.
        if (!/not found/i.test(err.message)) continue;
      }
      tab.unsealed.delete(identifier);
    }
  })();
  tab.sealing = Promise.all([tab.sealing, going]);
}

/** Whether every script `seal` asked off the tab is off: each one not yet known to be is asked once more. */
export async function sealed(tab = walk) {
  if (!tab) return true;
  await tab.sealing;
  for (const identifier of [...(tab.unsealed ?? [])]) takeOff(tab, identifier, 1);
  await tab.sealing;
  return !tab.unsealed?.size;
}

/**
 * Resolves once the walk may act on the page: its scripts back on (`seal`). It also resolves when the walk was paused
 * again meanwhile, or the page shows a sign-in, with the scripts still off: the op waits for that pause as for any
 * other (control.js `clear`).
 */
export function fresh() {
  const tab = walk;
  if (!tab || (!tab.withdrawn && !tab.freshening)) return Promise.resolve();
  // One at a time, each looking afresh: one that started before another pause returns early. An op that comes while
  // one is under way waits for all of it, the scripts run in a page that started without them too.
  const run = (tab.freshening ?? Promise.resolve()).then(() => renew(tab));
  const settled = run.catch(() => undefined);
  tab.freshening = settled;
  void settled.then(() => { if (tab.freshening === settled) tab.freshening = null; });
  return run;
}

async function renew(tab) {
  if (walk !== tab || !tab.withdrawn) return;
  const seals = tab.seals;
  // A page that could not be read is no sign-in seen: the scripts go back on, or the walk would wait on them for good.
  if ((await signInNow()) === true || tab.seals !== seals) return;
  // Not cleared: the scripts stay off, and the op is refused; the next one tries again.
  const named = await cmd('Runtime.evaluate', { expression: `window.name = ''` }).catch(() => null);
  if (!named || named.exceptionDetails) throw fail('NotAllowed', 'the page could not be read after the sign-in');
  if (tab.seals !== seals || !(await scriptsOn(tab, seals))) return;
  tab.withdrawn = false;
  tab.secret = false;
  // A document that started with them off gets them now: written to run more than once (pristine persona-session.ts).
  // Only while it is still that document: one the tab moved on to since started with them on, or is a sign-in.
  const loader = tab.loader;
  if (!tab.clean?.delete(loader)) return;
  for (const script of tab.newDocument ?? []) {
    if (walk !== tab || tab.seals !== seals || tab.loader !== loader) return;
    await cmd('Runtime.evaluate', { expression: script.source }).catch(() => undefined);
  }
}

/** Puts the server's new-document scripts back on the tab: false, with none of them on, if a seal came meanwhile. */
async function scriptsOn(tab, seals) {
  for (const script of tab.newDocument ?? []) {
    // On already: put back before a later one failed.
    if (script.identifier) continue;
    const identifier = (await cmd('Page.addScriptToEvaluateOnNewDocument', { source: script.source }))?.identifier;
    // Sealed while this was on its way: `seal` took off the ones before it, this one goes now.
    if (tab.seals !== seals || walk !== tab) {
      if (identifier) takeOff(tab, identifier);
      return false;
    }
    script.identifier = identifier;
  }
  return true;
}

/** Whether a password-like field on the page holds a value (signin.js `lookInPage`): no script runs then. */
export const passwordIn = async () => (await look())?.filled === true;

/**
 * The world the server's page reads run in: one of their own, not the page's, nor the walk's lookout (whose binding
 * tells the person's input). Not a wall: code there shares the DOM, and can add a script element to the page's world
 * wherever the page's CSP lets it.
 */
const READER = 'impeccable-walk-read';
/**
 * The one read that needs the page's own world: the consent rules the server loads into each document
 * (pristine consent.ts `loadConsent`) keep their state there, and `readConsentState`, `consentSeen` and
 * `markConsentSeen` read it.
 */
const PAGE_WORLD = /__impeccableConsent/;

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

/** An expression in the walk's own world on the top document: `{ value }`, or null when it could not be run. */
async function inLookout(expression) {
  const tab = walk;
  if (!tab) return null;
  for (let tries = 0; tries < 2; tries++) {
    try {
      if (tab.lookout?.loader !== tab.loader) {
        const { executionContextId } = await cmd('Page.createIsolatedWorld', { frameId: tab.mainFrame, worldName: LOOKOUT });
        tab.lookout = { loader: tab.loader, context: executionContextId };
      }
      const { result, exceptionDetails } = await cmd('Runtime.evaluate', { expression, contextId: tab.lookout.context, returnByValue: true });
      if (!exceptionDetails) return { value: result?.value };
    } catch { /* its world went with its document */ }
    tab.lookout = null;
  }
  return null;
}

/*
 * A native list (a `<select>` showing one option) opens a menu of Chrome's own, drawn outside the page: no picture the
 * persona sees shows it, and on a Mac a click or an arrow key opens it rather than changing the choice (measured: a
 * click and two ArrowDowns left Northside Live's "How did you hear about us?" on "Choose one"). So a click on one only
 * gives it focus, and an arrow key, Home or End on a focused one steps its choice the way Chrome does on Windows,
 * with the `input` and `change` a person's choice fires. Space and Enter, which only open the menu, do nothing there.
 */
function focusListAt(x, y) {
  const list = document.elementFromPoint(x, y)?.closest('select');
  if (!list || list.multiple || list.size > 1 || list.disabled) return false;
  list.focus();
  return true;
}
function stepList(key, change) {
  const list = document.activeElement;
  if (!(list instanceof HTMLSelectElement) || list.multiple || list.size > 1 || list.disabled) return false;
  if (key === 'Space' || key === ' ' || key === 'Enter') return true;
  const open = [...list.options].filter((o) => !o.disabled && !(o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled));
  const at = open.indexOf(list.options[list.selectedIndex]);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, PageUp: 0, End: open.length - 1, PageDown: open.length - 1 }[key];
  if (to === undefined) return false;
  const pick = open[Math.max(0, Math.min(open.length - 1, to))];
  if (change && pick && !pick.selected) {
    pick.selected = true;
    list.dispatchEvent(new Event('input', { bubbles: true }));
    list.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

/**
 * The person pressed Continue at a sign-in on this page: its empty password field no longer pauses the walk while the
 * tab stays at this very address, query and fragment too, so a page routed by its hash is a new page (a page the
 * detector got wrong would pause it forever). A sign-in host and a 401 still do.
 */
export function letPast(on = true) { if (walk) walk.past = on && walk.url ? walk.url : null; }

/** Whether what {@link lookInPage} saw on the walked tab is a sign-in the walk pauses at. */
const signInShows = (tab, seen) => isSignInPage(tab.url) || seen?.status === 401 || (signingIn(seen) && (!tab.past || tab.past !== tab.url || seen.filled === true));

/** Whom to tell of a sign-in (control.js pauses the walk). Told synchronously, so the pause holds before anything else is done. */
let spotted = () => undefined;
export function onSignIn(listener) { spotted = listener; }

/** How often, and how far apart, a page between documents is read again before it counts as unreadable. */
const READS = 5;
const READ_GAP_MS = 100;

/**
 * Whether the walked tab is at a sign-in right now: by its address, or by what the page shows. Null when the page
 * could not be read, even after a few tries: nothing is taken of a page the walk cannot check.
 */
export async function signInNow() {
  for (let tries = 0; tries < READS; tries++) {
    if (!walk) return false;
    // Pushed off the tab (`lost`): nothing to read until the walk is back on it.
    if (walk.lost) return null;
    if (isSignInPage(walk.url)) return true;
    const seen = await look();
    if (seen) return signInShows(walk, seen);
    await sleep(READ_GAP_MS);
  }
  return null;
}

/** How long `open` waits for its page to answer before it says the tab is open anyway. */
const OPEN_MS = 8000;

/** The `open` under way, if one is: Stop or `close` (the socket going calls it) marks it, and it starts no walk. */
let opening = null;
export function stopOpening() { if (opening) opening.stopped = true; }

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
  // Another page: a sign-in on it pauses again.
  if (walk.past && walk.past !== url) walk.past = null;
  say({ event: 'url', url });
  escaped(url);
}

/** A document the top frame now has: one that started while the server's scripts were off gets them once (`renew`). */
function noteDocument(tab, { type, frame }) {
  if (tab.documents?.has(frame.loaderId)) return;
  (tab.documents ??= new Set()).add(frame.loaderId);
  // Kept whole by Chrome from before: it ran them then.
  if (tab.withdrawn && type !== 'BackForwardCacheRestore') (tab.clean ??= new Set()).add(frame.loaderId);
}

/** Fails closed: a walked tab seen off its site is no longer walked. The guard holds every request, so this is the net under it. */
function escaped(url) {
  if (!walk || stillHome(url, walk.allowed) || (heldAtSignIn && isSignInPage(url))) return;
  void endWalk({ event: 'stopped', by: 'guard', url: String(url).slice(0, 500) }, 'left-site');
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!walk || source.tabId !== walk.tabId) return;
  // Paused, the network is not heard: it stays on only so the service-worker bypass holds (`watchNetwork`).
  if (hush && method.startsWith('Network.')) return;
  // The tab as it was when the event came: one that shows the tab off its site ends the walk mid-way through.
  const watchers = walk.watchers;
  const tell = (event) => { for (const listener of watchers) listener(event); };
  for (const hook of hooks.event) hook(method, params);
  switch (method) {
    case 'Fetch.requestPaused': {
      const tab = walk;
      // Decided as it arrives, before anything below can pause the walk: a write that came with the cause of a pause is not the person's.
      const holds = holding(tab, Date.now());
      const atSignIn = driver.by === 'sign-in';
      // Whether the walk was already held at a sign-in when this was asked: only then is it the person's (or the
      // page's), never the walk's own doing, and only then may it reach a sign-in page.
      const signIn = heldAtSignIn && isSignInPage(params.request?.url) ? [new URL(params.request.url).origin] : [];
      const allowed = signIn.length ? [...tab.allowed, ...signIn] : tab.allowed;
      const writable = [...tab.writable, ...signIn];
      // A sign-in page asked for: paused before the guard answers, whatever it answers; unless the person is the one
      // signing in.
      const top = params.resourceType === 'Document' && params.frameId === tab.mainFrame;
      if (!heldAtSignIn && top && isSignInPage(params.request?.url)) spotted();
      // Another site, on a walk of the person's own tab: held until the person says whether it may go there.
      // A form sent to it is never asked about; a question that fails leaves the move refused.
      const asking = top && tab.adopted && !heldAtSignIn && reads(params) && !onSite(params.request?.url, allowed) ? mayGo(params.request.url).catch(() => false) : Promise.resolve();
      void asking.then(() => held(sendTo(tab.tabId), params, tab.mainFrame, allowed, writable, (url) => {
        for (const listener of tab.watchers) listener({ kind: 'refused', url });
        say({ event: 'blocked', what: 'navigation', url });
      }, holds).then((became) => {
        if (became === 'held') {
          tab.heldWrites = (tab.heldWrites ?? 0) + 1;
          if (atSignIn) for (const hook of hooks.withheld) hook();
          // For whoever debugs a walk in this worker's console: what was held, never its path (a path can carry a token).
          let host = '?';
          try { host = new URL(params.request.url).host; } catch { /* no address to name */ }
          console.info('walk held a write', params.request?.method, host, params.resourceType);
        }
        // A request that never went out never finishes either: it is not something the network is busy with.
        if (became === 'continued' || !params.networkId || !tab.inflight.delete(params.networkId)) return;
        if (tab.inflight.size === 0) tab.quietSince = Date.now();
      }));
      break;
    }
    case 'Runtime.bindingCalled':
      // The walk sends no input while paused: a press or key then, not one of its own still being answered, is the person's.
      if (params.name === FELT && driver.by === 'sign-in' && ownInput.busy === 0 && Date.now() - ownInput.at > OWN_INPUT_MS) {
        touched = Date.now();
        // The network rules follow both ways: down now, up again as the window lapses (net-hold.js).
        void heldMayChange();
        setTimeout(() => void heldMayChange(), INPUT_WINDOW_MS + 1);
      }
      break;
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
      noteDocument(walk, params);
      // What the page before was still loading went with it, and Chrome does not always say so: only what the new
      // document asked for is the network being busy.
      for (const [id, loader] of walk.inflight) if (loader !== params.frame.loaderId) walk.inflight.delete(id);
      if (walk.inflight.size === 0) walk.quietSince = Date.now();
      setUrl(params.frame.url + (params.frame.urlFragment ?? ''));
      tell({ kind: 'navigated', type: params.type, loaderId: params.frame.loaderId });
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
  // Chrome says `target_closed` of a tab that is still open, too: another extension put a frame of its own in the page
  // (a password manager's "Save login?" after a sign-in), and no extension's debugger may stay on a page that has one.
  // Only the tab's own going ends the walk (`onRemoved`, or a tab no longer there when the walk tries to come back).
  if (reason === 'target_closed') void lost(walk);
  else gone(walk, reason);
});

/** The walk is over because its debugger is: the other end is told why. */
function gone(tab, reason) {
  if (walk !== tab) return;
  walk = null;
  say({ event: 'detached', reason });
  void letGo(tab, reason);
  void unstick(tab, reason);
}

chrome.tabs.onRemoved.addListener((tabId) => { if (walk?.tabId === tabId) gone(walk, 'target_closed'); });
// A tab Chrome swapped for another (a prerendered page taking its place): the walk follows it to the new one.
chrome.tabs.onReplaced.addListener((added, removed) => {
  if (walk?.tabId !== removed) return;
  walk.tabId = added;
  void lost(walk);
});

/** How often a walk pushed off its tab tries to get back on, while the tab is there. */
const REGAIN_MS = 500;

/**
 * The debugger was pushed off a tab that is still open. The walk keeps it, and gets back on as soon as Chrome lets it
 * (once the other extension's frame is gone); the other end hears nothing of it meanwhile. A pause holds every op;
 * a walk that is walking has its commands refused until then.
 */
async function lost(tab) {
  tab.lost = true;
  tab.lookout = null;
  tab.reader = null;
  // Gone with the debugger that added them, as are any `seal` asked off.
  for (const script of tab.newDocument ?? []) script.identifier = null;
  tab.unsealed = new Set();
  if (tab.regaining) return;
  tab.regaining = true;
  try {
    while (walk === tab && tab.lost && !(await regain(tab))) await sleep(REGAIN_MS);
  } finally {
    tab.regaining = false;
  }
}

/** Gets the debugger back on the walked tab, if it was pushed off: resolves to whether the walk has its tab now. */
export async function regain(tab = walk) {
  if (!tab || walk !== tab) return false;
  if (!tab.lost) return true;
  tab.attaching ??= (async () => {
    if (!(await chrome.tabs.get(tab.tabId).catch(() => null))) { gone(tab, 'target_closed'); return false; }
    try {
      await chrome.debugger.attach({ tabId: tab.tabId }, '1.3');
    } catch {
      // A refused attach can leave this extension's half of one behind ("Another debugger is already attached" on
      // every try after): let go of it, so the next try starts clean.
      await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined);
      return false;
    }
    if (walk !== tab) { await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined); return false; }
    tab.lost = false;
    try {
      await rearm(tab);
    } catch {
      // Chrome can let the debugger on and still refuse it the page while the other extension's frame is there
      // ("Cannot access a chrome-extension:// URL of different extension"): off again, and `lost` tries again.
      if (walk === tab) { tab.lost = true; await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined); }
      return false;
    }
    return walk === tab && !tab.lost;
  })().finally(() => { tab.attaching = null; });
  return tab.attaching;
}

/**
 * A new debugger starts with nothing on: the guard first, then what the walk had set up on the tab. The tab is checked
 * against its site afresh, as the guard was off meanwhile.
 */
async function rearm(tab) {
  await arm(cmd);
  await cmd('Page.enable');
  await watchNetwork();
  await cmd('Page.setLifecycleEventsEnabled', { enabled: true });
  const { frameTree } = await cmd('Page.getFrameTree');
  tab.mainFrame = frameTree.frame.id;
  tab.loader = frameTree.frame.loaderId;
  if (tab.sized) await sizeTo(tab.sized);
  if (tab.metrics) await cmd('Emulation.setDeviceMetricsOverride', tab.metrics);
  // Not while a sign-in pause or a take-over has them off (`seal`): they go back on before the walk's next op.
  if (!tab.withdrawn) await scriptsOn(tab, tab.seals);
  for (const hook of hooks.opened) await hook(tab, true);
  setUrl(frameTree.frame.url + (frameTree.frame.urlFragment ?? ''));
}

/**
 * A sized tab whose debugger left without clearing (Cancel on Chrome's bar) keeps its phone or tablet size until it
 * reloads: Chrome drops the touch and the user agent with the debugger, not the size. One moment's debugger sets the
 * size and clears it, which gives the tab its own back. Not a tab that closed, nor one another debugger took.
 */
async function unstick(tab, reason) {
  if (!tab.sized || reason === 'target_closed' || reason === 'replaced_with_devtools') return;
  await giveBack(tab.tabId, tab.sized);
}

/**
 * Gives a tab sized as `device` its own size, touch and user agent back, from a debugger of its own: one attached for
 * the moment, or the one a worker Chrome ended left attached. Nothing for a tab that is gone.
 */
async function giveBack(tabId, device) {
  const target = { tabId };
  let attached = false;
  try { await chrome.debugger.attach(target, '1.3'); attached = true; } catch { /* still ours from before, or gone */ }
  try {
    const { width, height } = DEVICES[device];
    await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');
    await chrome.debugger.sendCommand(target, 'Emulation.setTouchEmulationEnabled', { enabled: false });
    await chrome.debugger.sendCommand(target, 'Emulation.setUserAgentOverride', { userAgent: '' });
  } catch { if (!attached) return; }
  await chrome.debugger.detach(target).catch(() => undefined);
  await chrome.storage.session.remove('sizedTab').catch(() => undefined);
}

// A worker that starts finds no journey under way: a tab the last one sized and never gave back is given back now.
void chrome.storage.session.get('sizedTab').then(({ sizedTab } = {}) => {
  if (Number.isInteger(sizedTab?.tabId) && Object.hasOwn(DEVICES, sizedTab.device) && walk?.tabId !== sizedTab.tabId) return giveBack(sizedTab.tabId, sizedTab.device);
}).catch(() => undefined);

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

/** The one picture a walk ever attaches: a drawn face shipped in this folder. Nothing from the person's computer. */
const SAMPLE = { file: 'walks/sample-photo.png', name: 'sample-photo.png', type: 'image/png' };
let sampleData = null;
async function samplePhoto() {
  if (sampleData) return sampleData;
  const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(SAMPLE.file))).arrayBuffer());
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return (sampleData = btoa(text));
}

/**
 * Runs in the page: gives the picture to what is at (x, y). A file field, or the label of one, takes it as if picked;
 * else a drop area that accepts a drag takes it as if dropped. 'picker', 'drop', or null when nothing there takes a file.
 */
function attach(x, y, data, name, type) {
  const at = document.elementFromPoint(x, y);
  if (!at) return null;
  const file = new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type });
  const files = () => { const dt = new DataTransfer(); dt.items.add(file); return dt; };
  const label = at.closest('label');
  const field = [at, label?.control, label?.querySelector('input[type=file]')].find((el) => el instanceof HTMLInputElement && el.type === 'file' && !el.disabled);
  if (field) {
    field.files = files().files;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return 'picker';
  }
  // A drop area says so by cancelling dragover (the HTML drag model). Only the box at the point, up to body's child,
  // counts: a page that cancels it on the document or body would make every point look like one.
  let box = at;
  while (box.parentElement && box.parentElement !== document.body) box = box.parentElement;
  if (box.parentElement !== document.body) return null;
  const dt = files();
  const drag = (kind) => {
    const e = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y });
    // Uncancelled on the way into the box, cancelled on the way out; or stopped inside it, so cancelled there.
    let before, after;
    const into = () => { before = e.defaultPrevented; };
    const out = () => { after = e.defaultPrevented; };
    box.addEventListener(kind, into, true);
    box.addEventListener(kind, out);
    at.dispatchEvent(e);
    box.removeEventListener(kind, into, true);
    box.removeEventListener(kind, out);
    return before === false && (after ?? e.defaultPrevented);
  };
  // One that does not cancel it is never dropped on, so no handler further out takes a file this says it did not give.
  const wanted = [drag('dragenter'), drag('dragover')].some(Boolean);
  if (!wanted) { drag('dragleave'); return null; }
  drag('drop');
  return 'drop';
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

/** What typing must never reach, by what has focus (signin.js `lookInPage`). */
const UNTYPABLE = { password: 'a password field', card: 'a payment card field', code: 'a one-time code field', frame: 'a frame on another origin' };

/** Throws `NotAllowed` unless a key may go where focus is now. A page that cannot be read is not typed into. */
async function typable() {
  const seen = await look();
  if (!seen) throw fail('NotAllowed', 'a journey types only where it can see the focus');
  if (seen.focus) throw fail('NotAllowed', `a journey does not type into ${UNTYPABLE[seen.focus] ?? 'this field'}`);
}

async function press(name) {
  const key = keyOf(name);
  await cmd('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', ...key });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, ...(key.code ? { code: key.code, windowsVirtualKeyCode: key.windowsVirtualKeyCode } : {}) });
}

/**
 * `open` for a walk of the person's own tab: the debugger goes on the tab main named, where it is now. It must still
 * be on the site it was on when the walk was started. No tab is opened, none is closed, and it does not move.
 */
async function adopt(name, allow) {
  const { tabId, site, device } = adopted;
  const me = { stopped: false };
  opening = me;
  const still = () => { if (me.stopped) throw fail('Stopped', 'the journey ended before its tab opened'); };
  let attached = false;
  let grouped = false;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || webOrigin(tab.url) !== site || !onSite(tab.url, [site])) throw fail('NotAllowed', 'the tab moved off the site it was started on');
    let group = { id: tab.groupId };
    if (tab.groupId === -1) {
      try {
        const id = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
        grouped = true;
        await chrome.tabGroups.update(id, { title: COPY.tabGroup(name), color: 'purple' });
        group = { id, title: (await chrome.tabGroups.get(id)).title };
      } catch (err) {
        group = { error: String(err?.message ?? err) };
      }
    }
    still();
    await chrome.debugger.attach({ tabId }, '1.3');
    attached = true;
    still();
    // `writable`: where the walk may change things, the start alone. `allowed` grows with each Yes; `refused` with each No.
    const writable = [...new Set([site, ...allowedFor(allow)])];
    walk = { tabId, name, url: tab.url, origin: site, allowed: [...writable], writable, refused: new Set(), sites: 0, questions: 0, lastInputAt: -Infinity, adopted: true, grouped, mainFrame: undefined, loader: undefined, inflight: new Map(), quietSince: Date.now(), statuses: new Map(), watchers: new Set(), mouse: { x: 0, y: 0, down: false } };
    await cmd('Page.enable');
    await watchNetwork();
    await cmd('Page.setLifecycleEventsEnabled', { enabled: true });
    const { frameTree } = await cmd('Page.getFrameTree');
    walk.mainFrame = frameTree.frame.id;
    walk.loader = frameTree.frame.loaderId;
    // The person's history before the walk is theirs: going back never reaches it.
    walk.firstIndex = (await cmd('Page.getNavigationHistory')).currentIndex ?? 0;
    await arm(cmd);
    await sizeTo(device);
    if (Object.hasOwn(DEVICES, device ?? '')) await reloadSized();
    for (const hook of hooks.opened) { still(); await hook(walk); }
    still();
    return { value: { tabId, group, before: { width: tab.width, height: tab.height } } };
  } catch (err) {
    // A walk that could not be guarded, or was stopped, does not start; the tab is left as it was.
    if (walk?.tabId === tabId) { await unsize(walk); walk = null; }
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => undefined);
    if (grouped) await chrome.tabs.ungroup(tabId).catch(() => undefined);
    throw err;
  } finally {
    if (opening === me) opening = null;
  }
}

export const ops = {
  // The tab is this walk's own, opened empty: the guard is on it before it asks for anything.
  async open({ url, name, allow }) {
    if (walk || opening) throw fail('NotSupported', 'an outing has one tab');
    if (adopted) return adopt(name, allow);
    const site = admit(url, allowedFor(allow));
    const me = { stopped: false };
    opening = me;
    // Stopped or let go at any point from here: the walk never starts, and the tab made for it goes.
    const still = () => { if (me.stopped) throw fail('Stopped', 'the journey ended before its tab opened'); };
    let tab = null;
    try {
      // In the hand-off's window if it is still there, else wherever Chrome puts a new tab.
      tab = await chrome.tabs.create({ url: 'about:blank', active: true, ...(home === null ? {} : { windowId: home }) }).catch(() => chrome.tabs.create({ url: 'about:blank', active: true }));
      still();
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
      still();
      await chrome.debugger.attach({ tabId: tab.id }, '1.3');
      still();
      walk = { tabId: tab.id, name, url: 'about:blank', origin: site.origin, allowed: site.allowed, writable: site.allowed, mainFrame: undefined, loader: undefined, inflight: new Map(), quietSince: Date.now(), statuses: new Map(), watchers: new Set(), mouse: { x: 0, y: 0, down: false } };
      await cmd('Page.enable');
      await watchNetwork();
      await cmd('Page.setLifecycleEventsEnabled', { enabled: true });
      const { frameTree } = await cmd('Page.getFrameTree');
      walk.mainFrame = frameTree.frame.id;
      walk.loader = frameTree.frame.loaderId;
      await arm(cmd);
      for (const hook of hooks.opened) { still(); await hook(walk); }
      // Until the page has answered, or for a few seconds: a `goto` that follows at once then starts from a tab at
      // rest, not across a navigation still under way. A page that did not load is the engine's to find, with its own patience.
      await within(cmd('Page.navigate', { url }), OPEN_MS, 'slow').catch(() => undefined);
      still();
      if (terminal !== null) await chrome.tabs.remove(terminal).catch(() => undefined);
      return { value: { tabId: tab.id, group, before: { width: before.width, height: before.height } } };
    } catch (err) {
      // A walk that could not be guarded, or was stopped, does not start, and leaves no tab behind.
      if (tab) {
        if (walk?.tabId === tab.id) walk = null;
        await chrome.debugger.detach({ tabId: tab.id }).catch(() => undefined);
        await chrome.tabs.remove(tab.id).catch(() => undefined);
      }
      throw err;
    } finally {
      if (opening === me) opening = null;
    }
  },

  async goto({ url, waitUntil, timeout }) {
    // Never a question: only a click of the walk's own reaches a new site.
    if (!stillHome(url, walk.allowed)) {
      say({ event: 'blocked', what: 'navigation', url: String(url).slice(0, 500) });
      throw fail('NotAllowed', `a journey stays on ${walk.origin}`);
    }
    const want = waitUntil === 'domcontentloaded' ? 'DOMContentLoaded' : 'load';
    const started = Date.now();
    const page = watch();
    try {
      const sent = await within(cmd('Page.navigate', { url }), timeout, navigationTimeout(timeout));
      // The address was on the site and something it led to was not: refused by name, not as a load that failed.
      if (sent.errorText && page.saw((e) => e.kind === 'refused')) throw fail('NotAllowed', `a journey stays on ${walk.origin}`);
      if (sent.errorText) throw fail('Error', `${sent.errorText} at ${url}`);
      // The same document (a fragment): nothing loads.
      if (!sent.loaderId) return { value: { status: null } };
      // A page that sends itself on by script (`location.replace` in its head) never loads: the document that replaced
      // it in the main frame does. Only one that came after ours; one off the site never commits (the guard).
      const ours = new Set([sent.loaderId]);
      let committed = false;
      let loaded = sent.loaderId;
      await page.wait((e) => {
        if (e.kind === 'navigated' && committed) ours.add(e.loaderId);
        if (e.kind === 'navigated' && e.loaderId === sent.loaderId) committed = true;
        if (e.kind !== 'lifecycle' || e.name !== want || !ours.has(e.loaderId)) return false;
        loaded = e.loaderId;
        return true;
      }, Math.max(1, timeout - (Date.now() - started)), navigationTimeout(timeout));
      if (waitUntil === 'networkidle0') await idle(500, Math.max(1, timeout - (Date.now() - started))).catch(() => { throw fail('TimeoutError', navigationTimeout(timeout)); });
      return { value: { status: walk.statuses.get(loaded) ?? walk.statuses.get(sent.loaderId) ?? null } };
    } finally {
      page.stop();
    }
  },

  async goBack({ waitUntil, timeout }) {
    const want = waitUntil === 'domcontentloaded' ? 'DOMContentLoaded' : 'load';
    const history = await cmd('Page.getNavigationHistory');
    const tab = walk;
    // On the person's own tab, back stays within the walk: never to a page from before it, nor to a site it may not be on.
    if (tab.adopted && (history.currentIndex - 1 < tab.firstIndex || !onSite(history.entries[history.currentIndex - 1]?.url, tab.allowed))) throw fail('NotAllowed', 'back would leave the sites this journey may be on');
    if (history.currentIndex < 1) return { value: null };
    const page = watch();
    tab.goingBack = true;
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
      tab.goingBack = false;
      page.stop();
    }
  },

  async url() {
    const { frameTree } = await cmd('Page.getFrameTree');
    setUrl(frameTree.frame.url + (frameTree.frame.urlFragment ?? ''));
    return { value: walk.url };
  },

  // In the server's own world (`READER`), made once a document, so what one read leaves (a listener) the next can find.
  async evaluate(req) {
    const source = expression(req);
    const tab = walk;
    if (!tab) throw fail('OutingClosed', 'no tab is open');
    const run = async () => {
      let world = {};
      if (!PAGE_WORLD.test(source)) {
        if (tab.reader?.loader !== tab.loader) {
          const { executionContextId } = await cmd('Page.createIsolatedWorld', { frameId: tab.mainFrame, worldName: READER });
          tab.reader = { loader: tab.loader, context: executionContextId };
        }
        world = { contextId: tab.reader.context };
      }
      return cmd('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true, userGesture: true, ...world });
    };
    let answer;
    try {
      answer = await run();
    } catch (err) {
      // Its world went with its document before the script started: made again, once. Never a script the page left
      // mid-way ("Execution context was destroyed"): the server reads that as the page having moved on.
      if (!tab.reader || !/Cannot find context/i.test(err.message)) throw err;
      tab.reader = null;
      answer = await run();
    }
    const { result, exceptionDetails } = answer;
    if (exceptionDetails) throw fail('Error', String(exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 500));
    return result.unserializableValue ? { unserializable: result.unserializableValue } : { value: result.value };
  },

  // In the page's own world, as the server's own browser runs them (its system face, its consent rules).
  async evaluateOnNewDocument(req) {
    const source = expression(req);
    const tab = walk;
    const seals = tab.seals;
    const added = await cmd('Page.addScriptToEvaluateOnNewDocument', { source });
    // A sign-in pause that landed meanwhile has the tab without it (`seal`); the op is asked again after Continue.
    if (tab.withdrawn || tab.seals !== seals) {
      if (added?.identifier) takeOff(tab, added.identifier);
      throw fail('Paused', 'the journey was paused before this was done');
    }
    // Kept to take off at a sign-in (`seal`), and for a debugger that has to come back (`rearm`).
    (tab.newDocument ??= []).push({ source, identifier: added?.identifier });
    return { value: added };
  },

  async setViewport({ width, height, deviceScaleFactor, mobile }) {
    // The person's own tab keeps its size, or the width picked in the panel (`sizeTo`).
    if (walk.adopted) return {};
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
    walk.viewport = { width, height };
    walk.metrics = { width, height, deviceScaleFactor, mobile };
    return {};
  },

  // Page.captureScreenshot alone: no Page.bringToFront, so the person's own tab stays in front.
  async screenshot({ format, quality, clip }) {
    const { data } = await cmd('Page.captureScreenshot', { format, ...(quality === undefined ? {} : { quality }), ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
    // A phone or tablet tab is at the screen's density (`DEVICES`): its picture is drawn at its CSS size.
    const size = walk.sized && (clip ?? DEVICES[walk.sized]);
    const shot = size ? await smaller(data, Math.round(size.width), Math.round(size.height), format, quality ?? 100) : data;
    return { value: { data: await seenAs(shot, format, quality) } };
  },

  // Never while a film's picture is being taken (`pointer`).
  async mouse({ action, x, y }) {
    const at = fences;
    return pointer(async () => {
      const m = walk.mouse;
      if (action === 'move' || action === 'click') {
        m.x = x;
        m.y = y;
        await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: m.down ? 'left' : 'none', buttons: m.down ? 1 : 0 });
      }
      // A native list is focused, never opened (`focusListAt`).
      if (action === 'click' && (await inLookout(`(${focusListAt})(${Number(x)}, ${Number(y)})`))?.value === true) return {};
      if (action === 'down' || action === 'click') {
        overtaken(at);
        m.down = true;
        walk.lastInputAt = Date.now();
        await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.x, y: m.y, button: 'left', buttons: 1, clickCount: 1 });
      }
      if (action === 'up' || action === 'click') {
        // A button pressed is let go of whatever came meanwhile: a pause never leaves it held down.
        m.down = false;
        await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m.x, y: m.y, button: 'left', buttons: 0, clickCount: 1 });
      }
      return {};
    });
  },

  // Every key is checked first: none reaches a password, card or one-time-code field, or a frame on another origin.
  async keyboard({ action, key, text }) {
    const at = fences;
    walk.lastInputAt = Date.now();
    if (action === 'press') {
      await typable();
      overtaken(at);
      // On a focused native list, its choice steps (`stepList`); on another site, where the walk only looks, it stays.
      const listed = await inLookout(`(${stepList})(${JSON.stringify(String(key))}, ${!lookOnly()})`);
      if (listed?.value !== true) await press(key);
    } else {
      for (const ch of text) {
        if (lookOnly()) throw fail('NotAllowed', 'on another site a journey only looks');
        await typable();
        overtaken(at);
        if (ch === '\n' || ch === '\r') await press('Enter');
        // One code point a key where it has one; anything else is put in as text, as an input method would.
        else if (ch.length === 1 && ch >= ' ' && ch <= '~') await press(ch === ' ' ? 'Space' : ch);
        else await cmd('Input.insertText', { text: ch });
      }
    }
    return {};
  },

  // Only where: the picture is always the one bundled here (SAMPLE), never a name, path or address from anyone.
  async upload({ x, y }) {
    const at = fences;
    if (lookOnly()) throw fail('NotAllowed', 'on another site a journey only looks');
    const data = await samplePhoto();
    overtaken(at);
    walk.lastInputAt = Date.now();
    // In a world of our own: the page sees the file and its events, never the code that made them.
    const { executionContextId } = await cmd('Page.createIsolatedWorld', { frameId: walk.mainFrame, worldName: 'impeccable-walk-upload' });
    // Looked at again after the wait, as a click looks before its press: a pause or another site meanwhile gives nothing.
    if (lookOnly()) throw fail('NotAllowed', 'on another site a journey only looks');
    overtaken(at);
    const { result, exceptionDetails } = await cmd('Runtime.evaluate', { expression: expression({ fn: String(attach), args: [Number(x), Number(y), data, SAMPLE.name, SAMPLE.type] }), contextId: executionContextId, returnByValue: true, userGesture: true });
    if (exceptionDetails || !result?.value) throw fail('NotFound', 'nothing there takes a file');
    return { value: result.value };
  },

  async waitForNetworkIdle({ idleTime, timeout }) {
    await idle(idleTime, timeout);
    return {};
  },

  // Filming a wait (the server asks in the protocol's own words, and hears its frames in them).
  async cdp({ method, params }) {
    if (!CDP_METHODS.has(method)) throw fail('NotAllowed', `${method} is not passed to the tab`);
    if (method === 'Page.startScreencast' && walk.adopted) throw fail('NotSupported', 'a journey of your own tab takes stills only');
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

  // Opens or closes the tab's writes (REN-2034): the server opens them only around a deed fixed code approved.
  // A close, at once and whoever drives; an open only while walking (control.js), at once, and never queued.
  async writes({ open }) {
    if (open !== true) shutWrites();
    else if (walk) walk.writesOpen = true;
    else throw fail('OutingClosed', 'no tab is open');
    // Open only once nothing else holds them either: the deed comes next.
    await heldMayChange();
    return {};
  },

  // The debugger leaves; the tab stays as the walk left it.
  async close() {
    stopOpening();
    const tab = walk;
    if (tab) tab.ending = true;
    if (tab) for (const hook of hooks.closing) { try { await hook(tab); } catch { /* the tab may be gone */ } }
    walk = null;
    if (tab) {
      await unsize(tab);
      await unhook(tab);
      await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => undefined);
      await letGo(tab, 'closed');
      if (terminal !== null && !tab.adopted) await chrome.tabs.remove(tab.tabId).catch(() => undefined);
    }
    return {};
  },
};

// No op names where it acts: the walked tab, and nowhere else (guard.js).
for (const [name, run] of Object.entries(ops)) ops[name] = (req = {}) => { onlyThisTab(req); return run(req); };
