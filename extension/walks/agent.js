// The person's own agent in their own Chrome (REN-2053). The CLI's `impeccable mcp` reaches this worker through
// Chrome native messaging (the `style.impeccable.browser` host, which relays one local agent at a time); each of its
// four tools becomes ops of one walk (driver.js), so the guard, the pause at a sign-in, the covered secret fields, the
// refused password keys, the panel's Stop and its live log hold here as they do for a persona.
//
// THREAT NOTE (the one-page review is on REN-2053).
// Who can send: a process of this OS user that can open the relay's owner-only socket; Chrome starts the host only
// for this extension's ID. Impeccable's servers never reach it. What it may do: on a site the person allowed (Allow
// once for this session, or Always allow), anything the person could, as with Claude's own extension: the threat is
// controlled at the agent (the decider, 15 Nov). What stays out of reach whatever the agent asks: our own pages
// (guard.js `isOwnPage`), other tabs, other origins' top documents, password, card and one-time-code keys
// (driver.js `typable`), a secret field in any picture, scripts of its own (no `evaluate`, no `cdp`), files, and
// downloads. The person's Allow comes from the side panel only, never from the page. How it ends: Stop, the tab
// closing, `browser_end`, the agent going away, the host going away, ten minutes idle, or an hour in all.
import { AGENT, DEVICES, ops, stopOpening, walk, hooks } from './driver.js';
import { askSite } from './control.js';
import { isConsentPage, isOwnPage, webOrigin } from './guard.js';
import { current, dispatch, onView } from './store.js';
import { isLive } from './view.js';
import { COPY } from './panel/copy.js';

export const HOST = 'style.impeccable.browser';
/** Sites the person always allows their agent on, kept in this browser alone. */
export const SITES_KEY = 'agentSites';
const IDLE_MS = 10 * 60_000;
const LEASE_MS = 60 * 60_000;
const LOAD_MS = 30_000;
/** What one answer may carry back: every listed byte costs the agent's every turn. */
const TREE_CHARS = 12_000;
const FILM_FRAMES = 6;

/** The relay's port, while Chrome keeps the host running. */
let port = null;
/**
 * The agent's session: who it is, the sites allowed for it, when it started and was last heard from, and whether the
 * person stopped it. One at a time: the relay admits one agent, and the walk one tab.
 */
let session = null;
/**
 * Set by the person's Stop and by the hour running out: the next site is asked about in the panel even when it is
 * always allowed, whichever agent or connection asks. Cleared by the person's own Allow.
 */
let askNext = false;
/**
 * Whether the side panel was open when the session began, and the window the agent works in: an agent run leaves the
 * panel as it found it (the decider, 18 Nov). Open before, it goes back to its default view; opened for the run, it
 * closes again.
 */
let panelBefore = null;
/** Ends a session nobody has used for a while. */
let idle = null;
/** The refs of the last tree the agent read: its number for a control, to what that control is called. */
let refs = new Map();

/** An app's consent or install page: what the agent reads instead, there or when a click led there. */
const CONSENT_LINE = 'That page grants an app access. Only the person can, in their own tab: ask them.';
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const refused = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const KNOWN = { 'claude-code': 'Claude Code', codex: 'Codex', 'codex-mcp-client': 'Codex', cursor: 'Cursor', 'cursor-vscode': 'Cursor', gemini: 'Gemini', 'gemini-cli-mcp-client': 'Gemini', windsurf: 'Windsurf', zed: 'Zed' };
/** The agent as the panel names it: its own client name, made plain. */
export function agentName(raw) {
  const id = String(raw ?? '').toLowerCase().trim().slice(0, 60);
  if (KNOWN[id]) return KNOWN[id];
  const plain = id.replace(/[^a-z0-9 ._-]/g, '').replace(/[-_.]+/g, ' ').trim();
  return plain ? plain.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) : 'Your agent';
}

async function alwaysSites() {
  const kept = (await chrome.storage.local.get(SITES_KEY).catch(() => ({})))[SITES_KEY];
  return Array.isArray(kept) ? kept.filter((origin) => typeof origin === 'string' && webOrigin(origin) === origin) : [];
}

/**
 * Whether the agent may use `origin`: allowed for this session, always allowed, or the person says so now. By exact
 * scheme, host and port: one site's Allow covers none of its neighbours.
 */
async function mayUse(origin) {
  if (session.allowed.includes(origin)) return allow(origin);
  if (!askNext && (await alwaysSites()).includes(origin)) return allow(origin);
  const said = await askSite(new URL(origin).host);
  if (said === 'once' || said === 'always') askNext = false;
  if (said === 'always') await chrome.storage.local.set({ [SITES_KEY]: [...new Set([...(await alwaysSites()), origin])] });
  if (said !== 'once' && said !== 'always') return false;
  return allow(origin);
}
/** The session may use `origin`, and so may its open tab (guard.js holds the tab to `walk.allowed`). */
function allow(origin) {
  if (!session.allowed.includes(origin)) session.allowed.push(origin);
  if (walk?.agent && !walk.allowed.includes(origin)) walk.allowed.push(origin);
  return true;
}

/** Tells the panel's live log what the agent did, as a persona's steps are told. */
function logged(did) {
  if (!walk?.agent) return;
  session.n += 1;
  dispatch({ type: 'step', step: { n: session.n, did: did.slice(0, 400) } });
}

/** The page's accessibility tree as the agent reads it: one line a node, a [ref] on each control, cut at its size. */
async function treeText() {
  const { value } = await ops.hear({ what: 'tree' });
  const nodes = new Map((value?.nodes ?? []).map((n) => [n.nodeId, n]));
  const root = value?.nodes?.find((n) => !n.parentId && n.role?.value === 'RootWebArea') ?? value?.nodes?.[0];
  const CONTROLS = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem']);
  const QUIET = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak', 'presentation']);
  refs = new Map();
  const lines = [];
  let size = 0;
  let cut = false;
  const visit = (node, depth, parentName) => {
    if (!node || cut) return;
    const role = node.role?.value ?? '';
    const name = String(node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const shown = !node.ignored && !QUIET.has(role) && !(role === 'StaticText' && (!name || name === parentName));
    let next = depth;
    if (shown) {
      const ref = CONTROLS.has(role) && Number.isInteger(node.backendDOMNodeId) ? node.backendDOMNodeId : null;
      if (ref !== null) refs.set(ref, name || role);
      const val = node.value?.value;
      const line = `${'  '.repeat(depth)}${role}${name ? ` "${name}"` : ''}${val !== undefined && val !== '' ? ` = "${String(val).slice(0, 80)}"` : ''}${ref !== null ? ` [${ref}]` : ''}`;
      size += line.length + 1;
      if (size > TREE_CHARS) { cut = true; return; }
      lines.push(line);
      next = depth + 1;
    }
    for (const id of node.childIds ?? []) visit(nodes.get(id), next, name || parentName);
  };
  visit(root, 0, '');
  if (cut) lines.push('… (cut here: scroll, or look at a screenshot)');
  return lines.join('\n');
}

/** What the agent reads after a step: where the tab is now, and its tree. */
async function page(note = '') {
  const tab = await chrome.tabs.get(walk.tabId).catch(() => null);
  const head = `${tab?.title ? `${tab.title.slice(0, 200)}\n` : ''}${walk.url}`;
  return text(`${note ? `${note}\n` : ''}${head}\n\n${await treeText()}`);
}

/** Where a control by its ref is, at its middle, once scrolled into view. */
async function pointOf(args) {
  if (Number.isInteger(args.ref)) {
    await ops.hear({ what: 'show', node: args.ref });
    const { value: quad } = await ops.hear({ what: 'box', node: args.ref });
    if (!Array.isArray(quad) || quad.length < 8) throw Object.assign(new Error(`nothing with ref ${args.ref} is on the page now; read the tree again`), { name: 'NotFound' });
    return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
  }
  if (Number.isFinite(args.x) && Number.isFinite(args.y)) return { x: args.x, y: args.y };
  return null;
}

const settle = () => ops.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => undefined);
const hostPath = (url) => { try { const u = new URL(url); return `${u.host}${u.pathname === '/' ? '' : u.pathname}`; } catch { return String(url).slice(0, 200); } };

/** Opens the agent's tab on `url`, or goes there on the one it has. */
async function open(url) {
  const origin = webOrigin(url);
  if (!origin) return refused('Only http and https addresses open.');
  if (isOwnPage(url)) return refused('Impeccable’s own pages don’t open for agents.');
  if (isConsentPage(url)) return refused(CONSENT_LINE);
  if (walk?.agent) return go(url);
  if (isLive(current())) return refused('A journey is using the browser right now. Try again when it has finished.');
  if (!session.started) {
    await notePanel();
    dispatch({ type: 'agent', name: session.name, site: origin });
  }
  try {
    if (!(await mayUse(origin))) { endWaiting(); return refused(`The person didn’t allow ${new URL(origin).host}.`); }
    session.opening = true;
    await ops.open({ url, name: session.name, allow: [...session.allowed], free: true, helpers: true, [AGENT]: true });
  } catch (err) {
    endWaiting();
    throw err;
  } finally {
    if (session) session.opening = false;
  }
  session.started = true;
  await settle();
  logged(COPY.yourAgent.opened(hostPath(url)));
  return page();
}

/** A wait for the person's Allow that ended without a tab: the panel goes back to how it was. */
function endWaiting() {
  dispatch({ type: 'unwait' });
  leavePanel();
}

/** At the session's start: was the side panel open? If not, it opens for the run (where Chrome lets it). */
async function notePanel() {
  if (panelBefore) return;
  const open = await Promise.resolve(chrome.runtime.getContexts?.({ contextTypes: ['SIDE_PANEL'] })).catch(() => null);
  const [front] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const windowId = front?.windowId ?? null;
  // The panel of the agent's own window: one open in another window is that window's.
  panelBefore = { open: Array.isArray(open) && open.some((context) => context.windowId === windowId), windowId };
  // Chrome may want a press of the person's for this: then the toolbar icon opens it, as for any question.
  if (!panelBefore.open && panelBefore.windowId !== null) await Promise.resolve(chrome.sidePanel?.open?.({ windowId: panelBefore.windowId })).catch(() => undefined);
}

/** At the session's end: the panel as it was before, its default view or closed. */
function leavePanel() {
  dispatch({ type: 'agent-over' });
  const was = panelBefore;
  panelBefore = null;
  if (!was || was.open || was.windowId === null) return;
  if (typeof chrome.sidePanel?.close === 'function') void Promise.resolve(chrome.sidePanel.close({ windowId: was.windowId })).catch(() => undefined);
  // A Chrome without `sidePanel.close`: that window's panel closes itself (panel.js), and no other.
  else void Promise.resolve(chrome.runtime.sendMessage({ agentPanel: 'close', windowId: was.windowId })).catch(() => undefined);
}

async function go(url) {
  const origin = webOrigin(url);
  if (!origin) return refused('Only http and https addresses open.');
  if (isOwnPage(url)) return refused('Impeccable’s own pages don’t open for agents.');
  if (isConsentPage(url)) return refused(CONSENT_LINE);
  if (!(await mayUse(origin))) return refused(`The person didn’t allow ${new URL(origin).host}.`);
  await ops.goto({ url, waitUntil: 'load', timeout: LOAD_MS });
  logged(COPY.yourAgent.opened(hostPath(url)));
  return page();
}

/** Each blocked move while `run` acts: a page that tried to take the tab to a site the agent may not be on. */
async function watching(run) {
  const blocked = [];
  const hear = (message) => { if (message.event === 'blocked' && message.what === 'navigation') blocked.push(message.url); };
  hooks.said.push(hear);
  try {
    return { out: await run(), blocked };
  } finally {
    hooks.said.splice(hooks.said.indexOf(hear), 1);
  }
}
const blockedNote = (blocked) => (blocked.length && isConsentPage(blocked[0]) ? CONSENT_LINE : blocked.length ? `The page tried to go to ${blocked[0]}, a site you aren't allowed on. To go there, call browser_act with op goto and that url: the person is asked.` : '');

async function act(args) {
  const { op } = args;
  if (op === 'goto') return go(String(args.url ?? ''));
  if (op === 'back') { await ops.goBack({ waitUntil: 'load', timeout: LOAD_MS }); logged(COPY.yourAgent.back); return page(); }
  if (op === 'viewport') {
    const width = Number.isFinite(args.width) ? Math.round(args.width) : DEVICES.phone.width;
    const height = Number.isFinite(args.height) ? Math.round(args.height) : width === DEVICES.phone.width ? DEVICES.phone.height : 900;
    if (width < 200 || width > 3840 || height < 200 || height > 2160) return refused('The viewport is between 200 and 3840 wide, and 200 and 2160 high.');
    await ops.setViewport({ width, height, mobile: width < 600 });
    logged(COPY.yourAgent.viewport(width, height));
    return page();
  }
  const at = await pointOf(args);
  const name = Number.isInteger(args.ref) ? refs.get(args.ref) : null;
  const { blocked } = await watching(async () => {
    if (op === 'click') {
      if (!at) throw Object.assign(new Error('click needs a ref or x and y'), { name: 'Error' });
      await ops.mouse({ action: 'click', x: at.x, y: at.y });
      logged(name ? COPY.yourAgent.clicked(name) : COPY.yourAgent.clickedAt(Math.round(at.x), Math.round(at.y)));
    } else if (op === 'type') {
      if (at) await ops.mouse({ action: 'click', x: at.x, y: at.y });
      await ops.keyboard({ action: 'type', text: String(args.text ?? '') });
      logged(COPY.yourAgent.typed(String(args.text ?? '').slice(0, 60), name));
    } else if (op === 'press') {
      await ops.keyboard({ action: 'press', key: String(args.key ?? '') });
      logged(COPY.yourAgent.pressed(String(args.key ?? '').slice(0, 30)));
    } else if (op === 'scroll') {
      await ops.mouse({ action: 'wheel', ...(at ?? {}), dx: Number(args.dx) || 0, dy: Number.isFinite(args.dy) ? args.dy : 600 });
      logged(COPY.yourAgent.scrolled);
    } else {
      throw Object.assign(new Error(`browser_act has no op ${String(op).slice(0, 30)}`), { name: 'Error' });
    }
    await settle();
  });
  return page(blockedNote(blocked));
}

const image = (data, mimeType) => ({ content: [{ type: 'image', data, mimeType }] });

async function look(args) {
  const { kind } = args;
  if (kind === 'tree') return page();
  if (kind === 'screenshot') return image((await ops.screenshot({ format: 'jpeg', quality: 70 })).value.data, 'image/jpeg');
  if (kind === 'zoom') {
    const clip = { x: Number(args.x), y: Number(args.y), width: Number(args.w), height: Number(args.h) };
    if (![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite) || clip.width < 4 || clip.height < 4 || clip.width * clip.height > 1200 * 1200) return refused('zoom needs x, y, w and h, at most 1200 by 1200.');
    return image((await ops.screenshot({ format: 'png', clip })).value.data, 'image/png');
  }
  if (kind === 'styles' || kind === 'ink') {
    const at = await pointOf(args);
    if (!at) return refused(`${kind} needs a ref or x and y.`);
    const { value } = await ops.inspect({ what: kind, x: at.x, y: at.y });
    return value ? text(JSON.stringify(value)) : refused('Nothing is at that point.');
  }
  if (kind === 'filmstrip') return filmstrip(Math.min(5, Math.max(0.5, Number(args.seconds) || 2)));
  return refused(`browser_look has no kind ${String(kind).slice(0, 30)}.`);
}

/** A motion filmstrip: stills across `seconds`, as one contact sheet of three by two, oldest first. */
async function filmstrip(seconds) {
  const stills = [];
  const gap = (seconds * 1000) / (FILM_FRAMES - 1);
  for (let n = 0; n < FILM_FRAMES; n++) {
    const started = Date.now();
    stills.push((await ops.screenshot({ format: 'jpeg', quality: 70 })).value.data);
    if (n < FILM_FRAMES - 1) await new Promise((resolve) => setTimeout(resolve, Math.max(0, gap - (Date.now() - started))));
  }
  const bitmaps = await Promise.all(stills.map(async (data) => createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob())));
  const cell = { w: 480, h: Math.round((480 * (bitmaps[0].height || 1)) / (bitmaps[0].width || 1)) };
  const sheet = new OffscreenCanvas(cell.w * 3, cell.h * 2);
  const draw = sheet.getContext('2d');
  bitmaps.forEach((bitmap, n) => { draw.drawImage(bitmap, (n % 3) * cell.w, Math.floor(n / 3) * cell.h, cell.w, cell.h); bitmap.close?.(); });
  const blob = await sheet.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // Chrome pauses motion in a tab nobody is looking at: said, so still frames aren't read as nothing moving.
  const shown = (await chrome.tabs.get(walk.tabId).catch(() => null))?.active === true;
  const said = `${FILM_FRAMES} stills over ${seconds}s, left to right then down.${shown ? '' : ' The tab is in the background, where Chrome pauses motion: ask the person to bring it to the front for a true filmstrip.'}`;
  return { content: [{ type: 'text', text: said }, { type: 'image', data: btoa(binary), mimeType: 'image/jpeg' }] };
}

/** Ends the agent's walk: the debugger leaves, and the tab it opened stays as it left it. */
async function end() {
  clearTimeout(idle);
  // A tab still opening for the agent never finishes opening.
  if (session?.opening) stopOpening();
  if (walk?.agent) await ops.close();
  endWaiting();
  over();
}
/** What a session's end takes with it: its Allow once sites and its log; a Stop stays. The panel goes as it was. */
function over() {
  leavePanel();
  if (!session) return;
  Object.assign(session, { allowed: [], n: 0, started: false, since: Date.now() });
}

/** One call, answered with what the agent reads. A pause (a sign-in, the person's own) answers at once. */
async function call(frame) {
  // One session a connection: the relay says when its agent goes. A name it sends only labels the panel.
  session ??= { name: agentName(frame.agent), allowed: [], n: 0, since: Date.now(), started: false, stopped: false };
  if (session.stopped) return refused('The person stopped your browser session.');
  if (Date.now() - session.since > LEASE_MS) { await end(); askNext = true; }
  armIdle();
  const { tool, arguments: args = {} } = frame;
  if (tool === 'browser_end') { await end(); return text('Ended. The tab is the person’s again.'); }
  const { state } = current();
  if (walk?.agent && (state === 'paused' || state === 'takeover')) return pausedLine();
  if (tool === 'browser_open') return open(String(args.url ?? ''));
  if (!walk?.agent) return refused('No page is open: call browser_open first.');
  // Handed back on a consent page the person went to: theirs to finish.
  if (isConsentPage(walk.url)) return refused(CONSENT_LINE);
  if (tool === 'browser_act') return act(args);
  if (tool === 'browser_look') return look(args);
  return refused(`No tool ${String(tool).slice(0, 40)}.`);
}

/** Answers with the call's own result, or, the moment a pause lands while it runs, with that. */
const pausedLine = () => refused(current().held === 'sign-in' ? 'The page asks the person to sign in. They do it themselves; try again once they continue.' : current().state === 'takeover' ? 'The person has the tab. Try again when they hand it back.' : 'The person paused you. Try again when they continue.');
/**
 * Runs one call, answering with its result or, the moment a pause lands while it runs, with that. The call itself
 * is refused once the pause ends (control.js), and resolves `run` only then: the next call waits for it.
 */
function answer(frame) {
  let reply;
  const replied = new Promise((resolve) => { reply = resolve; });
  let done = false;
  const finish = (out) => { if (!done) { done = true; reply(out); } };
  const off = onPause(() => finish(pausedLine()));
  const run = call(frame).then(finish, (err) => finish(refused(String(err?.message ?? err).slice(0, 300)))).finally(off);
  return { replied, run };
}

const pauses = new Set();
const onPause = (heard) => { pauses.add(heard); return () => pauses.delete(heard); };
onView((view) => { if (view.agent && (view.state === 'paused' || view.state === 'takeover')) for (const heard of [...pauses]) heard(); });

function armIdle() {
  clearTimeout(idle);
  idle = setTimeout(() => { void end(); }, IDLE_MS);
}

// A site the person takes out of Always allow (Options) ends a session that may use it: they asked it to stop there.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes[SITES_KEY] || !session) return;
  const now = new Set(Array.isArray(changes[SITES_KEY].newValue) ? changes[SITES_KEY].newValue : []);
  const taken = (Array.isArray(changes[SITES_KEY].oldValue) ? changes[SITES_KEY].oldValue : []).filter((origin) => !now.has(origin));
  if (taken.some((origin) => session.allowed.includes(origin))) void end();
});

// The person's Stop, or the tab closing, ends the agent's session (a persona's walk ending is not its): what the agent
// asks after a Stop is refused until it goes, and its next one asks the person again.
hooks.closed.push((why) => {
  if (!session?.started) return;
  if (why === 'stopped' || why === 'canceled_by_user') stop();
  clearTimeout(idle);
  over();
});
function stop() {
  askNext = true;
  if (session) session.stopped = true;
}
// The person's Stop on the agent's walk, heard as the panel shows it: before the debugger has left, and while the
// agent waits for its first Allow, when no tab closes at all. An agent that leaves meanwhile can't undo it.
let agentLive = false;
onView((view) => {
  if (agentLive && view.state === 'stopped') stop();
  agentLive = view.agent && isLive(view);
});

/** The agent left: its walk ends, and the next connection starts afresh (a Stop's ask stays, `askNext`). */
async function gone() {
  session = null;
  await end().catch(() => undefined);
}

/** One call at a time, in the order they came. */
let queue = Promise.resolve();
function heard(frame) {
  // At once, not behind a call a pause holds: the agent is gone.
  if (frame?.type === 'agent-gone') { void gone(); return; }
  if (typeof frame?.id !== 'number' || typeof frame.tool !== 'string') return;
  const from = port;
  // Ending always ends, at once: not behind a call a pause holds.
  if (frame.tool === 'browser_end') { void end().catch(() => undefined).then(() => from?.postMessage({ id: frame.id, result: text('Ended. The tab is the person’s again.') })); return; }
  // Paused or taken over: answered at once, never queued to run after Continue.
  const { state } = current();
  if (walk?.agent && (state === 'paused' || state === 'takeover')) { from?.postMessage({ id: frame.id, result: pausedLine() }); return; }
  queue = queue.then(async () => {
    const { replied, run } = answer(frame);
    void replied.then((result) => from?.postMessage({ id: frame.id, result }));
    await run;
  }).catch(() => undefined);
}

/**
 * Connects to the CLI's host while Chrome can start it: a store build without `nativeMessaging` never does, and one
 * without the CLI installed is told so at once and tries again a minute later.
 */
export function connect() {
  if (port || typeof chrome.runtime.connectNative !== 'function') return;
  let p;
  try { p = chrome.runtime.connectNative(HOST); } catch { return; }
  port = p;
  p.onMessage.addListener(heard);
  p.onDisconnect.addListener(() => {
    if (port !== p) return;
    port = null;
    void chrome.runtime.lastError;
    void gone();
  });
}

if (typeof chrome.runtime.connectNative === 'function') {
  chrome.alarms?.create('agent-host', { periodInMinutes: 1 });
  chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === 'agent-host') connect(); });
  chrome.runtime.onStartup.addListener(connect);
  connect();
}
