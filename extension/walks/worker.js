// The walk worker. It connects to the socket a hand-off names (link.js), opens one tab in a tab group of its own,
// attaches the debugger to that tab and no other, and does what the socket asks of it (the walk protocol). It
// decides nothing: the session engine on the other end does the thinking. guard.js holds the tab to its site;
// control.js lets the person pause it, take it over or stop it; the side panel (panel/) and the badge show it.

const PROTOCOL = 2;
/** The subprotocol the server's door asks for; the hand-off's ticket travels beside it (the server's subprotocol name). */
const SUBPROTOCOL = 'impeccable-outing';
/** The most text one socket message carries, in UTF-16 code units (the walk protocol's part size): the hub takes about 1 MiB a message. */
const PART_CHARS = 256 * 1024;
/** What this extension can do beyond the protocol: walk the person's own tab, ask the person before a deed, and go to another site on their Yes. */
const CAN = ['tab', 'ask', 'go'];
/** Made once each time this worker starts: a different one mid-outing tells the other end the worker was restarted. */
const BOOT = crypto.randomUUID();

let socket = null;

/** Counts the messages sent in pieces: each one's name among those under way. */
let parted = 0;

/**
 * One message's JSON as the socket takes it: itself when it fits, else its pieces in order (protocol 2 `OutingPart`;
 * the same cut as the server's, which the other end rejoins with).
 */
function pieces(text) {
  if (text.length <= PART_CHARS) return [text];
  const cuts = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(text.length, at + PART_CHARS);
    // Never between the two halves of one character: half a pair does not survive a text frame.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    cuts.push(text.slice(at, end));
    at = end;
  }
  const of = String(++parted);
  return cuts.map((data, n) => JSON.stringify({ part: { of, n, total: cuts.length }, data }));
}

function say(message) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  for (const piece of pieces(JSON.stringify(message))) socket.send(piece);
}

import { fail, hushed, ops, speak, walk } from './driver.js';
import { needsNoTab } from './control.js';
import { dial, linked, unlinked, whereTo } from './link.js';
import { isStartPage } from './handoff.js';
import './toolbar.js';

// What the driver tells of the tab goes out the way a reply does.
speak((message) => say(message));

/** Answers one request on the socket it came in on: a reply that settles after that socket is gone is dropped, never sent on the next walk's. */
async function handle(data, from) {
  let req;
  try { req = JSON.parse(data); } catch { return; }
  // The hub's keep-alive (protocol 2): its arrival is what keeps this worker awake while a walk waits for its tab. It
  // asks nothing and is answered nothing; nor is anything else that is not a request.
  if (req === null || typeof req !== 'object' || typeof req.op !== 'string' || typeof req.id !== 'number') return;
  const started = performance.now();
  let reply;
  try {
    const run = Object.hasOwn(ops, req.op) ? ops[req.op] : null;
    if (!run) throw fail('NotSupported', `unknown op ${String(req.op).slice(0, 40)}`);
    if (req.op !== 'open' && req.op !== 'close' && !needsNoTab(req.op) && !walk) throw fail('OutingClosed', 'no tab is open');
    reply = { id: req.id, ok: true, ...(await run(req)) };
  } catch (err) {
    reply = { id: req.id, ok: false, error: { name: err?.name || 'Error', message: String(err?.message ?? err).slice(0, 500) } };
  }
  if (socket !== from) return;
  say({ ...reply, ...(walk && !hushed() ? { url: walk.url } : {}), ms: Math.round((performance.now() - started) * 10) / 10, boot: BOOT });
}

async function connect() {
  if (socket) return;
  const to = await whereTo();
  if (!to || socket) return;
  // The hand-off's ticket travels beside the subprotocol's name: it is what lets the server know whose walk this is,
  // and a browser's socket can carry it nowhere else (never in the address, which is logged).
  const ws = new WebSocket(to.socket, to.ticket ? [SUBPROTOCOL, to.ticket] : []);
  socket = ws;
  let opened = false;
  ws.onopen = () => { opened = true; say({ hello: { protocol: PROTOCOL, boot: BOOT, agent: navigator.userAgent, can: CAN } }); void linked(); };
  ws.onmessage = (event) => { void handle(event.data, ws); };
  ws.onclose = (event) => {
    if (socket !== ws) return;
    socket = null;
    // First, while the walk is still as the socket left it; then nobody is left to ask anything of the tab, and the
    // debugger does not stay on it.
    unlinked({ opened, reason: event.reason });
    void ops.close();
  };
}

/** Lets go of the socket without a word: a new hand-off has its own. */
function hangUp() {
  const ws = socket;
  socket = null;
  ws?.close();
}
dial(connect, hangUp);

/**
 * Added or updated: a page of ours already open and looking for this extension is loaded again, so it finds it. Never
 * one this version's content script already runs on (it answers `here`; only such a page can be handing a walk over),
 * nor the tab a kept hand-off came from: a reload mid-hand-off loses it.
 */
async function reloadStartPages() {
  const kept = (await chrome.storage.session.get('handoff')).handoff;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number' || !isStartPage(tab.url ?? '') || tab.id === kept?.tabId) return;
    const here = await chrome.tabs.sendMessage(tab.id, { walks: 'here' }, { frameId: 0 }).catch(() => null);
    if (!here?.here) await chrome.tabs.reload(tab.id).catch(() => undefined);
  }));
}
chrome.runtime.onInstalled.addListener((details) => {
  void connect();
  if (details.reason === 'install' || details.reason === 'update') void reloadStartPages().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => { void connect(); });
void connect();
