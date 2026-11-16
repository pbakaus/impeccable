// The badge on the walked tab: who is here, which step, and Stop. Chrome opens a side panel only on a click, so this
// is what a person sees of a walk before they have opened it.
//
// It is put there through the debugger, into a world of its own in the walked tab and no other: it needs no host
// permission and no content script on anyone's sites. The page's script cannot reach it (a closed shadow root in another world)
// and cannot press Stop for it (the binding exists in that world alone). The persona never sees it: it is hidden
// for every picture and film the engine takes. Chrome refuses to open the side panel from here ("only in response
// to a user gesture"; a debugger event carries none), so the panel opens from a click on
// the walk's page (handoff-content.js) or, while a walk is under way, from the toolbar icon (toolbar.js). So a
// question the walk asks (delete, pay, send, another site) is asked here too, with Yes and No.
//
// On a walk of the person's own tab it also draws the glow: a soft moving border inside the page, in the same world,
// that takes no clicks. It is out of every picture the way the badge is (the veil), shows only while the walk is
// walking, and goes with the badge at the end. Should the debugger leave without a word (nothing can reach the page
// then), it goes by itself when its heartbeat stops: within GLOW_LIFE_MS.
import { hooks, send, walk } from './driver.js';
import { COPY } from './panel/copy.js';
import { current, onView } from './store.js';
import { ON_TAB } from './view.js';

const WORLD = 'impeccable-walk-badge';
const BINDING = '__impeccableWalkStop';
const BEAT_MS = 1000;
/** How long the glow stays without a heartbeat. */
const GLOW_LIFE_MS = 1500;

/** Runs in the walked tab, in the badge's own world, at the start of every document. Self-contained: it is sent as text. */
export function badgeInPage(binding, lifeMs, glowLifeMs) {
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
    button.resume { background: oklch(99.5% 0 0); color: oklch(13% 0 0); box-shadow: inset 0 0 0 1px oklch(13% 0 0 / 0.45); }
    button.resume:hover { background: oklch(96% 0 0); }
    button:focus-visible { outline: 2px solid oklch(70% 0.12 188); outline-offset: 2px; }
    button[hidden] { display: none; }
  `;
  const GLOW = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
    .glow { position: absolute; inset: 0; border-radius: 2px; pointer-events: none;
      box-shadow: inset 0 0 0 2px oklch(68% 0.17 300 / 0.85), inset 0 0 18px 4px oklch(68% 0.17 300 / 0.45);
      animation: breathe 2.4s ease-in-out infinite; }
    @keyframes breathe { 50% { box-shadow: inset 0 0 0 2px oklch(68% 0.17 300 / 0.55), inset 0 0 28px 8px oklch(68% 0.17 300 / 0.25); } }
    @media (prefers-reduced-motion: reduce) { .glow { animation: none; } }
  `;
  const glowHost = document.createElement('impeccable-walk-glow');
  const glowRoot = glowHost.attachShadow({ mode: 'closed' });
  const glowSheet = new CSSStyleSheet();
  glowSheet.replaceSync(GLOW);
  glowRoot.adoptedStyleSheets = [glowSheet];
  const glow = document.createElement('div');
  glow.className = 'glow';
  glowRoot.append(glow);
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
  const resume = el('button', 'resume');
  resume.type = 'button';
  const no = el('button', 'resume');
  no.type = 'button';
  const stop = el('button', 'stop');
  stop.type = 'button';
  pill.append(el('span', 'dot'), title, sub, no, resume, stop);
  root.append(pill);
  // Only a press a person or the walk really made: a click the page's script made up is not one. While the walk asks,
  // it makes none: every op waits on the answer.
  let go = 'resume';
  resume.addEventListener('click', (event) => { if (event.isTrusted) globalThis[binding](go); });
  no.addEventListener('click', (event) => { if (event.isTrusted) globalThis[binding]('no'); });
  stop.addEventListener('click', (event) => { if (event.isTrusted) globalThis[binding]('stop'); });

  let expires = 0;
  let glowing = 0;
  let fit = null;
  let gone = false;
  let veiled = false;
  const showGlow = () => { glowHost.style.visibility = veiled || !glowing || Date.now() > glowing ? 'hidden' : ''; };
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
    document.documentElement.append(glowHost, host);
    place();
  };
  // Nobody has said the walk is still on: it is over, however it ended, and this goes with it.
  const timer = setInterval(() => { if (expires && Date.now() > expires) api.remove(); else showGlow(); }, 250);
  const api = {
    set(state) {
      if (gone) return;
      title.textContent = state.title;
      sub.textContent = state.sub;
      stop.textContent = state.stop;
      stop.hidden = !state.stop;
      resume.textContent = state.resume;
      resume.hidden = !state.resume;
      go = state.go ?? 'resume';
      no.textContent = state.no ?? '';
      no.hidden = !state.no;
      pill.dataset.state = state.state;
      pill.dataset.step = String(state.step);
      veiled = state.hidden === true;
      host.style.visibility = veiled ? 'hidden' : '';
      fit = state.fit ?? fit;
      expires = Date.now() + lifeMs;
      glowing = state.glow ? Date.now() + glowLifeMs : 0;
      showGlow();
      if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount, { once: true });
      place();
    },
    beat() { expires = Date.now() + lifeMs; if (glowing) glowing = Date.now() + glowLifeMs; },
    veil(on) { veiled = on; host.style.visibility = on ? 'hidden' : ''; showGlow(); },
    remove() { gone = true; clearInterval(timer); host.remove(); glowHost.remove(); },
  };
  globalThis.__impeccableWalkBadge = api;
}

/** What the badge says for a view. */
export function badgeState(view, adopted = false) {
  const name = view.who?.name ?? '';
  const step = view.steps.at(-1)?.n ?? 0;
  if (view.ask) {
    const what = view.ask.kind === 'go' ? COPY.ask.go(name, view.ask.what) : view.ask.what;
    return { state: 'asking', step, title: COPY.ask.title, sub: what, resume: COPY.ask.yes, go: 'yes', no: COPY.ask.no, stop: COPY.badge.stop, glow: adopted };
  }
  const title = view.state === 'paused' ? COPY.badge.paused(name) : view.state === 'takeover' ? COPY.badge.yours : COPY.badge.here(name);
  return { state: view.state, step, title, sub: COPY.badge.step(step), resume: view.state === 'paused' ? COPY.controls.resume : '', stop: COPY.badge.stop, glow: adopted && view.state === 'walking' };
}

let badge = null;
/** Why the badge is out of sight right now: a film under way, and pictures being taken. A new one for each walk. */
let veil = { film: false, shots: 0 };
/**
 * Hidden only from a walk that is walking: paused or in the person's hands, the badge and its Stop are theirs to see.
 * So is a question, film or not: a walk from the terminal films its steps, and the panel may not be open.
 */
const hidden = () => (veil.film || veil.shots > 0) && current().state === 'walking' && !current().ask;
let pressed = () => undefined;
/** What a press on the badge does: it names the control, `stop` or `resume`. */
export function whenPressed(act) { pressed = act; }

async function call(what) {
  if (!badge || badge.context === null) return;
  await send(badge.tabId, 'Runtime.evaluate', { expression: `globalThis.__impeccableWalkBadge?.${what}`, contextId: badge.context }).catch(() => undefined);
}

async function push() {
  if (!badge || !ON_TAB.includes(current().state)) return;
  const tab = await chrome.tabs.get(badge.tabId).catch(() => null);
  // Said with every state, so a document that begins mid-film starts out hidden too.
  await call(`set(${JSON.stringify({ ...badgeState(current(), badge.adopted), hidden: hidden(), ...(tab?.width ? { fit: { w: tab.width, h: tab.height } } : {}) })})`);
}

hooks.opened.push(async (tab) => {
  badge = { tabId: tab.tabId, adopted: tab.adopted === true, context: null, beat: setInterval(() => { void call('beat()'); }, BEAT_MS) };
  await send(tab.tabId, 'Runtime.enable');
  await send(tab.tabId, 'Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
  const source = `(${badgeInPage})(${JSON.stringify(BINDING)}, ${BEAT_MS * 3}, ${GLOW_LIFE_MS})`;
  await send(tab.tabId, 'Page.addScriptToEvaluateOnNewDocument', { source, worldName: WORLD });
  // The person's own tab already has its document: the badge goes into it now, in a world made for it.
  if (tab.adopted) {
    const { executionContextId } = await send(tab.tabId, 'Page.createIsolatedWorld', { frameId: tab.mainFrame, worldName: WORLD });
    await send(tab.tabId, 'Runtime.evaluate', { expression: source, contextId: executionContextId });
    if (badge) badge.context = executionContextId;
  }
});

hooks.event.push((method, params) => {
  if (!badge) return;
  // The top document's own copy of the badge's world, not a frame's: a frame gets nothing said into it.
  if (method === 'Runtime.executionContextCreated' && params.context.name === WORLD && params.context.auxData?.frameId === walk?.mainFrame) {
    badge.context = params.context.id;
    void push();
  }
  if (method === 'Runtime.bindingCalled' && params.name === BINDING && params.executionContextId === badge.context && ['stop', 'resume', 'yes', 'no'].includes(params.payload)) pressed(params.payload);
});

const drop = () => {
  if (!badge) return;
  clearInterval(badge.beat);
  badge = null;
  // A picture still being taken as the walk ends counts against the old veil, not the next walk's.
  veil = { film: false, shots: 0 };
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
      const mine = veil;
      mine.shots += 1;
      await draw();
      try { return await run(req); } finally { mine.shots -= 1; await draw(); }
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
