// The badge on the walked tab: who is here, which step, and Stop. Chrome opens a side panel only on a click, so this
// is what a person sees of a walk before they have opened it.
//
// It is put there through the debugger, into a world of its own in the walked tab and no other: it needs no host
// permission and no content script on anyone's sites. The page's script cannot reach it (a closed shadow root in another world)
// and cannot press Stop for it (the binding exists in that world alone). The persona never sees it: it is hidden
// for every picture and film the engine takes. Chrome refuses to open the side panel from here ("only in response
// to a user gesture"; a debugger event carries none), so the panel opens from a click on
// the walk's page (handoff-content.js) or from Chrome's side panel menu. The toolbar icon keeps the detector's popup.
import { hooks, send, walk } from './driver.js';
import { COPY } from './panel/copy.js';
import { current, onView } from './store.js';
import { ON_TAB } from './view.js';

const WORLD = 'impeccable-walk-badge';
const BINDING = '__impeccableWalkStop';
const BEAT_MS = 2000;

/** Runs in the walked tab, in the badge's own world, at the start of every document. Self-contained: it is sent as text. */
function badgeInPage(binding, lifeMs) {
  if (globalThis.__impeccableWalkBadge) return;
  const CSS = `
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
    .pill { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px; border: 1px solid oklch(13% 0 0 / 0.45); border-radius: 999px;
      background: oklch(99.5% 0 0); color: oklch(13% 0 0); box-shadow: 0 1px 1px oklch(13% 0 0 / 0.05), 0 2px 3px oklch(13% 0 0 / 0.04), 0 6px 12px oklch(13% 0 0 / 0.08);
      font: 500 12px/1 "Avenir Next", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; white-space: nowrap; -webkit-font-smoothing: antialiased; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: oklch(84% 0.19 80.46); box-shadow: 0 0 0 1px oklch(13% 0 0 / 0.12), 0 0 4px oklch(84% 0.19 80 / 0.6); }
    .pill[data-state="paused"] .dot, .pill[data-state="takeover"] .dot { background: oklch(70% 0.12 188); box-shadow: 0 0 0 1px oklch(13% 0 0 / 0.12); }
    .title { font-weight: 600; }
    .sub { color: oklch(46% 0 0); font-variant-numeric: tabular-nums; }
    button { all: unset; box-sizing: border-box; min-height: 24px; padding: 0 12px; border-radius: 999px; background: oklch(13% 0 0); color: oklch(99.5% 0 0); font: inherit; line-height: 24px; cursor: pointer; }
    button:hover { background: oklch(22% 0 0); }
    button:focus-visible { outline: 2px solid oklch(70% 0.12 188); outline-offset: 2px; }
    button[hidden] { display: none; }
  `;
  const host = document.createElement('impeccable-walk');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];
  const el = (tag, name) => { const made = document.createElement(tag); made.className = name; return made; };
  const pill = el('div', 'pill');
  pill.setAttribute('role', 'status');
  const title = el('span', 'title');
  const sub = el('span', 'sub');
  const stop = el('button', 'stop');
  stop.type = 'button';
  pill.append(el('span', 'dot'), title, sub, stop);
  root.append(pill);
  // Only a press a person or the walk really made: a click the page's script made up is not one.
  stop.addEventListener('click', (event) => { if (event.isTrusted) globalThis[binding]('stop'); });

  let expires = 0;
  let fit = null;
  let gone = false;
  const place = () => {
    // The walk lays the page out at its own size, which can be larger than the window: keep to the part on screen.
    if (!fit || !host.isConnected) return;
    const box = pill.getBoundingClientRect();
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${Math.max(8, Math.min(fit.w, innerWidth) - box.width - 16)}px`;
    host.style.top = `${Math.max(8, Math.min(fit.h, innerHeight) - box.height - 16)}px`;
  };
  const mount = () => {
    if (host.isConnected || !document.documentElement) return;
    document.documentElement.append(host);
    place();
  };
  // Nobody has said the walk is still on: it is over, however it ended, and this goes with it.
  const timer = setInterval(() => { if (expires && Date.now() > expires) api.remove(); }, 1000);
  const api = {
    set(state) {
      if (gone) return;
      title.textContent = state.title;
      sub.textContent = state.sub;
      stop.textContent = state.stop;
      stop.hidden = !state.stop;
      pill.dataset.state = state.state;
      pill.dataset.step = String(state.step);
      host.style.visibility = state.hidden ? 'hidden' : '';
      fit = state.fit ?? fit;
      expires = Date.now() + lifeMs;
      if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount, { once: true });
      place();
    },
    beat() { expires = Date.now() + lifeMs; },
    veil(on) { host.style.visibility = on ? 'hidden' : ''; },
    remove() { gone = true; clearInterval(timer); host.remove(); },
  };
  globalThis.__impeccableWalkBadge = api;
}

/** What the badge says for a view. */
export function badgeState(view) {
  const name = view.who?.name ?? '';
  const step = view.steps.at(-1)?.n ?? 0;
  const title = view.state === 'paused' ? COPY.badge.paused(name) : view.state === 'takeover' ? COPY.badge.yours : COPY.badge.here(name);
  return { state: view.state, step, title, sub: COPY.badge.step(step), stop: COPY.badge.stop };
}

let badge = null;
/** Why the badge is out of sight right now: a film under way, and pictures being taken. */
const veil = { film: false, shots: 0 };
/** Hidden only from a walk that is walking: paused or in the person's hands, the badge and its Stop are theirs to see. */
const hidden = () => (veil.film || veil.shots > 0) && current().state === 'walking';
let pressed = () => undefined;
/** What Stop on the badge does. */
export function whenStopPressed(act) { pressed = act; }

async function call(what) {
  if (!badge || badge.context === null) return;
  await send(badge.tabId, 'Runtime.evaluate', { expression: `globalThis.__impeccableWalkBadge?.${what}`, contextId: badge.context }).catch(() => undefined);
}

async function push() {
  if (!badge || !ON_TAB.includes(current().state)) return;
  const tab = await chrome.tabs.get(badge.tabId).catch(() => null);
  // Said with every state, so a document that begins mid-film starts out hidden too.
  await call(`set(${JSON.stringify({ ...badgeState(current()), hidden: hidden(), ...(tab?.width ? { fit: { w: tab.width, h: tab.height } } : {}) })})`);
}

hooks.opened.push(async (tab) => {
  badge = { tabId: tab.tabId, context: null, beat: setInterval(() => { void call('beat()'); }, BEAT_MS) };
  await send(tab.tabId, 'Runtime.enable');
  await send(tab.tabId, 'Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
  await send(tab.tabId, 'Page.addScriptToEvaluateOnNewDocument', { source: `(${badgeInPage})(${JSON.stringify(BINDING)}, ${BEAT_MS * 3})`, worldName: WORLD });
});

hooks.event.push((method, params) => {
  if (!badge) return;
  // The top document's own copy of the badge's world, not a frame's: a frame gets nothing said into it.
  if (method === 'Runtime.executionContextCreated' && params.context.name === WORLD && params.context.auxData?.frameId === walk?.mainFrame) {
    badge.context = params.context.id;
    void push();
  }
  if (method === 'Runtime.bindingCalled' && params.name === BINDING && params.executionContextId === badge.context && params.payload === 'stop') pressed();
});

const drop = () => {
  if (!badge) return;
  clearInterval(badge.beat);
  badge = null;
  veil.film = false;
  veil.shots = 0;
};
hooks.closing.push(async () => { await call('remove()'); });
hooks.closed.push(drop);
onView(() => { void push(); });

/**
 * An op as the persona must see the page: without the badge. A picture is taken with it hidden; a film hides it from
 * its first frame to its last, across any page it loads on the way.
 */
export function unseen(name, run) {
  const draw = () => call(`veil(${hidden()})`);
  if (name === 'screenshot') {
    return async (req) => {
      veil.shots += 1;
      await draw();
      try { return await run(req); } finally { veil.shots -= 1; await draw(); }
    };
  }
  if (name === 'cdp') {
    return async (req) => {
      if (req.method === 'Page.startScreencast') { veil.film = true; await draw(); }
      try { return await run(req); } finally { if (req.method === 'Page.stopScreencast') { veil.film = false; await draw(); } }
    };
  }
  return run;
}
