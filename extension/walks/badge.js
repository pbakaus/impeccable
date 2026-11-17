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
// While it walks or asks it also draws the glow: a soft gold blur along the page's edges, in the same world,
// that takes no clicks. It is out of every picture the way the badge is (the veil), shows only while the walk is
// walking, and goes with the badge at the end. Should the debugger leave without a word (nothing can reach the page
// then), it goes by itself when its heartbeat stops: within GLOW_LIFE_MS.
import { hooks, send, walk } from './driver.js';
import { atAPoint } from './page-helpers.js';
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
    .pill { all: initial; visibility: inherit; direction: ltr; display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px; border: 1px solid oklch(13% 0 0 / 0.45); border-radius: 999px;
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
  // A soft blur along the screen's edges in the brand's gold, breathing by opacity alone (cheap on the GPU, unlike an
  // animated box-shadow), and still where motion is reduced.
  const GLOW = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
    .glow { position: absolute; inset: 0; pointer-events: none; will-change: opacity;
      box-shadow: inset 0 0 28px 6px oklch(84% 0.19 80.46 / 0.55), inset 0 0 90px 24px oklch(84% 0.19 80.46 / 0.22);
      animation: breathe 2.8s ease-in-out infinite; }
    @keyframes breathe { 50% { opacity: 0.55; } }
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
  // A Yes lets a deed through (delete, pay, send), so it counts only when the person could see what it said yes to:
  // the badge whole and on top, unfaded, where it was put, and since a moment before (Chrome's own visibility check).
  // A page that fades it, covers it or slides it under a control of its own gets nothing from the press: the side
  // panel asks the same question.
  const SEEN_MS = 500;
  let seenSince = null;
  let askedAt = 0;
  let asked = '';
  let spot = null;
  const look = (entry) => { seenSince = entry.isVisible && entry.intersectionRatio > 0.99 ? (seenSince ?? performance.now()) : null; };
  const watch = typeof IntersectionObserver === 'function' && 'isVisible' in (globalThis.IntersectionObserverEntry?.prototype ?? {})
    ? new IntersectionObserver((entries) => entries.forEach(look), { threshold: [0, 1], trackVisibility: true, delay: 100 })
    : null;
  watch?.observe(pill);
  const plain = (node, own) => {
    const css = getComputedStyle(node);
    return css.opacity === '1' && css.visibility === 'visible' && css.transform === 'none' && css.filter === 'none' && css.clipPath === 'none'
      && [css.maskImage, css.webkitMaskImage].every((mask) => !mask || mask === 'none') && (!css.mixBlendMode || css.mixBlendMode === 'normal')
      && (!own || ((!css.zoom || css.zoom === '1') && css.pointerEvents !== 'none'));
  };
  const seen = (event, button) => {
    if (!watch || !spot || host.parentNode !== document.documentElement) return false;
    watch.takeRecords().forEach(look);
    if (seenSince === null || performance.now() - Math.max(seenSince, askedAt) < SEEN_MS) return false;
    if (!plain(host, true) || !plain(document.documentElement, false)) return false;
    const box = host.getBoundingClientRect();
    if (Math.abs(box.left - spot.left) > 1 || Math.abs(box.top - spot.top) > 1) return false;
    // A key press clicks at no point: its button's middle stands in.
    const at = button.getBoundingClientRect();
    const [x, y] = event.detail > 0 ? [event.clientX, event.clientY] : [at.left + at.width / 2, at.top + at.height / 2];
    return document.elementFromPoint(x, y) === host;
  };
  resume.addEventListener('click', (event) => { if (event.isTrusted && (go !== 'yes' || seen(event, resume))) globalThis[binding](go); });
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
    spot = { left: Math.max(8, Math.min(fit.w, innerWidth) - box.width - 16), top: Math.max(8, Math.min(fit.h, innerHeight) - box.height - 16) };
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${spot.left}px`;
    host.style.top = `${spot.top}px`;
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
      // A new question is read before it is answered: its moment starts now.
      const question = go === 'yes' ? state.sub : '';
      if (question && question !== asked) askedAt = performance.now();
      asked = question;
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
    // A badge that went is gone from its world too: one put there again starts afresh.
    remove() { gone = true; clearInterval(timer); watch?.disconnect(); host.remove(); glowHost.remove(); if (globalThis.__impeccableWalkBadge === api) delete globalThis.__impeccableWalkBadge; },
  };
  globalThis.__impeccableWalkBadge = api;
}

/** What the badge says for a view. */
export function badgeState(view) {
  const name = view.who?.name ?? '';
  const step = view.steps.at(-1)?.n ?? 0;
  if (view.ask?.kind === 'site') return { state: 'asking', step, title: COPY.ask.site(name, view.ask.what), sub: '', resume: '', no: COPY.ask.notNow, stop: COPY.badge.stop, glow: true };
  if (view.ask) {
    const what = view.ask.kind === 'go' ? COPY.ask.go(name, view.ask.what) : view.ask.what;
    return { state: 'asking', step, title: COPY.ask.title, sub: what, resume: COPY.ask.yes, go: 'yes', no: COPY.ask.no, stop: COPY.badge.stop, glow: true };
  }
  const title = view.state === 'paused' ? COPY.badge.paused(name) : view.state === 'takeover' ? COPY.badge.yours : COPY.badge.here(name);
  return { state: view.state, step, title, sub: COPY.badge.step(step), resume: view.state !== 'paused' ? '' : view.held === 'sign-in' ? COPY.controls.signedIn : COPY.controls.resume, stop: COPY.badge.stop, glow: view.state === 'walking' };
}

let badge = null;
/** Why the badge is out of sight right now: a film under way, and pictures being taken or points pressed. A new one for each walk. */
let veil = { film: false, shots: 0 };
/**
 * Hidden only from a walk that is walking: paused or in the person's hands, the badge and its Stop are theirs to see,
 * but for the moment of the one still of a sign-in page the walk takes as it pauses there (control.js `stillAtSignIn`).
 * So is a question, film or not: a walk from the terminal films its steps, and the panel may not be open.
 */
const hidden = () => (veil.film || veil.shots > 0) && (current().state === 'walking' || (veil.shots > 0 && current().state === 'paused' && current().held === 'sign-in')) && !current().ask;
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
  await call(`set(${JSON.stringify({ ...badgeState(current()), hidden: hidden(), ...(tab?.width ? { fit: { w: tab.width, h: tab.height } } : {}) })})`);
}

// `again`: the debugger came back to the tab (driver.js `rearm`), whose document is already there.
hooks.opened.push(async (tab, again = false) => {
  if (badge) clearInterval(badge.beat);
  badge = { tabId: tab.tabId, context: null, beat: setInterval(() => { void call('beat()'); }, BEAT_MS) };
  await send(tab.tabId, 'Runtime.enable');
  await send(tab.tabId, 'Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
  const source = `(${badgeInPage})(${JSON.stringify(BINDING)}, ${BEAT_MS * 3}, ${GLOW_LIFE_MS})`;
  await send(tab.tabId, 'Page.addScriptToEvaluateOnNewDocument', { source, worldName: WORLD });
  // The person's own tab already has its document: the badge goes into it now, in a world made for it.
  if (tab.adopted || again) {
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

/** The page helpers that find what lies at a point: the badge, over the page's corner, must never be what they find. */
const AT_A_POINT = new Set(atAPoint);

const draw = () => call(`veil(${hidden()})`);

/** `run` with the badge out of sight, as a picture is taken: what it finds or presses on the page is never the badge. */
export async function withoutBadge(run) {
  const mine = veil;
  mine.shots += 1;
  await draw();
  try { return await run(); } finally { mine.shots -= 1; await draw(); }
}

/**
 * An op as the persona must see the page: without the badge. A picture is taken with it hidden; a film hides it from
 * its first frame to its last, across any page it loads on the way. A press, and a look for what lies at a point, are
 * made with it hidden too: a page's own button under it ("Go to shopping bag" in a corner toast) is then pressed, and
 * never the badge's Stop.
 */
export function unseen(name, run) {
  // A screen reader's tree is read without the badge too: its words are not the page's.
  if (name === 'screenshot' || name === 'hear' || name === 'mouse' || name === 'upload' || name === 'evaluate') {
    return async (req) => {
      if (name === 'hear' && req?.what !== 'tree') return run(req);
      if (name === 'evaluate' && !AT_A_POINT.has(req?.helper)) return run(req);
      return withoutBadge(() => run(req));
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
