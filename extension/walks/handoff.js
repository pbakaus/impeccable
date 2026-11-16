// The hand-off: how a walk reaches this extension. Our own app's page for an outing carries one JSON block; a
// content script on that page alone (handoff-content.js) passes its text here, and the worker takes it only when
// Chrome itself says the message came from the top frame of such a page. Nothing a page's own script can send (a
// window message, an event) is ever read, and no other origin can hand a walk over.
//
// Pure: every field is checked here, strictly, and anything unknown is refused.
import { BUILD } from '../shared/build.js';
import { admit, isOwnPage, webOrigin } from './guard.js';

/** The block's version (the walk protocol's hand-off). */
const HANDOFF_VERSION = 1;

const hostOf = (origin) => new URL(origin).hostname;
/**
 * Where our app's outing pages are, and the host each one's socket is on: the public host, which serves the machine
 * API, for itself and for the app's own host, which serves none of it (the server builds the address
 * the same way). A fixed pairing: no block can name another host, and no other
 * page can hand a walk over. On a developer's own stack the two are `app.localhost` and `localhost`, on one port; a
 * development build's own servers (shared/build.js) pair their app and website the same way.
 */
const SOCKET_HOST = {
  'impeccable.reviews': 'impeccable.reviews',
  'app.impeccable.style': 'impeccable.reviews',
  ...Object.fromEntries(BUILD.servers.flatMap(({ app, site }) => [[hostOf(site), hostOf(site)], [hostOf(app), hostOf(site)]])),
};
const LOCAL_SOCKET_HOST = { localhost: 'localhost', 'app.localhost': 'localhost' };
const OUTING_PATH = /^\/app\/[^/]+\/outings\/[^/]+\/?$/;

const TICKET = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{8,1024}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_TEXT = 16 * 1024;
const MAX_ALLOW = 8;
const MAX_DONE_WHEN = 6;
/** The screen sizes a walk runs at. A contract with the web app: change it there and here together. */
const DEVICES = ['desktop', 'mobile', 'tablet'];
/**
 * The most each line may hold. `errand`, `goal` and `check` are the web app's own limits, copied here because this
 * folder loads with no build step. A contract with the web app: change it there and here together
 * (tests/extension-walks.test.mjs pins this side). A person's name and role have no limit of the API's.
 */
const MAX = { name: 120, role: 200, errand: 120, goal: 2000, check: 300 };

/**
 * The socket's origin for a page of ours, or null for any other page: `wss:` on the paired host, `ws:` on this machine
 * at the page's own port. The store build knows the production hosts alone.
 */
function socketOrigin(page) {
  if (page.protocol === 'https:' && page.port === '' && Object.hasOwn(SOCKET_HOST, page.hostname)) return `wss://${SOCKET_HOST[page.hostname]}`;
  if (BUILD.devHosts && page.protocol === 'http:' && Object.hasOwn(LOCAL_SOCKET_HOST, page.hostname)) return `ws://${LOCAL_SOCKET_HOST[page.hostname]}${page.port ? `:${page.port}` : ''}`;
  return null;
}

/**
 * A walk's result link, when it is on the walk's own server: its public host or its app host (the pairing above), and
 * this machine's on the socket's own port. Null for anything else, which is neither shown nor opened.
 */
export function resultLink(url, socket) {
  try {
    const link = new URL(url);
    return socketOrigin(link) !== null && socketOrigin(link) === new URL(socket).origin ? link.href : null;
  } catch {
    return null;
  }
}

/** Whether an address is one of our app's outing pages: the only place a hand-off is taken from. */
export function isOutingPage(pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return false; }
  return socketOrigin(page) !== null && OUTING_PATH.test(page.pathname);
}

/**
 * Whether an address is one of the two pages of ours a walk starts from, which look for this extension's mark
 * (present.js): an outing's page, or the command's sign-in page. The worker reloads these, and no others, when it is
 * added or updated, so a page that was waiting for it finds it.
 */
export function isStartPage(pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return false; }
  return socketOrigin(page) !== null && (OUTING_PATH.test(page.pathname) || page.pathname === '/app/cli/authorize');
}

const no = (why) => ({ ok: false, why });
const fits = (value, max) => typeof value === 'string' && value.length <= max;
const line = (value, max) => fits(value, max) && value.trim() !== '';
const only = (object, keys) => object !== null && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every((key) => keys.includes(key));

/** The socket is the one this outing has on the page's paired host, to the letter: no other host, port, path, query or sign-in. */
function ownSocket(socket, page, outing) {
  const origin = socketOrigin(page);
  if (!origin) return false;
  try { return new URL(socket).href === new URL(`${origin}/api/outings/${outing}/socket`).href; } catch { return false; }
}

/**
 * Reads a hand-off block's text as it came from `pageUrl`. `{ ok: true, handoff }`, or `{ ok: false, why }` with
 * `why` one of: `origin` (not our outing page), `malformed` (not the JSON object it must be), or the name of the
 * field that is missing or wrong.
 */
export function readHandoff(text, pageUrl) {
  if (!isOutingPage(pageUrl)) return no('origin');
  return readBlock(text, (socket, outing) => ownSocket(socket, new URL(pageUrl), outing), admit);
}

/** The sockets a walk main started may be on: our servers' (the pairing main signed in to), never another host. */
function startedSocket(socket, outing) {
  let url;
  try { url = new URL(socket); } catch { return false; }
  const origins = [...new Set(Object.values(SOCKET_HOST))].map((host) => `wss://${host}`);
  const local = BUILD.devHosts && url.protocol === 'ws:' && url.hostname === 'localhost' ? [url.origin] : [];
  return [...origins, ...local].some((origin) => url.href === new URL(`${origin}/api/outings/${outing}/socket`).href);
}

/**
 * Reads the block main passes on for a walk of the person's own tab: the same block, its socket on one of our servers.
 * The tab's own origin is walked (never one of our pages). Its `allow` is empty: only the person's Yes adds a site.
 */
export function readStartedHandoff(text) {
  const read = readBlock(text, startedSocket, (url) => {
    const origin = webOrigin(url);
    if (!origin || isOwnPage(url)) throw new Error('no journey can start here');
    return { origin };
  });
  return read.ok && read.handoff.allow.length > 0 ? no('allow') : read;
}

function readBlock(text, socketOk, admitted) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return no('malformed');
  let block;
  try { block = JSON.parse(text); } catch { return no('malformed'); }
  if (!only(block, ['v', 'outing', 'socket', 'ticket', 'persona', 'errand', 'url', 'allow'])) return no('malformed');
  if (block.v !== HANDOFF_VERSION) return no('v');
  if (typeof block.outing !== 'string' || !ID.test(block.outing)) return no('outing');
  if (typeof block.socket !== 'string' || !socketOk(block.socket, block.outing)) return no('socket');
  if (typeof block.ticket !== 'string' || !TICKET.test(block.ticket)) return no('ticket');
  const { persona, errand } = block;
  // A role may be empty (a cast's person need not have one), and an errand's name is, for a goal given for the occasion.
  if (!only(persona, ['name', 'role', 'visit', 'device']) || !line(persona.name, MAX.name) || !fits(persona.role, MAX.role)) return no('persona');
  if (persona.visit !== undefined && persona.visit !== 'new' && persona.visit !== 'returning') return no('persona');
  if (persona.device !== undefined && !DEVICES.includes(persona.device)) return no('persona');
  if (!only(errand, ['name', 'goal', 'doneWhen']) || !fits(errand.name, MAX.errand) || !line(errand.goal, MAX.goal)) return no('errand');
  if (!Array.isArray(errand.doneWhen) || errand.doneWhen.length > MAX_DONE_WHEN || !errand.doneWhen.every((check) => line(check, MAX.check))) return no('errand');
  if (!Array.isArray(block.allow) || block.allow.length > MAX_ALLOW || !block.allow.every((origin) => typeof origin === 'string' && webOrigin(origin) === origin)) return no('allow');
  let site;
  try { site = admitted(block.url, block.allow); } catch { return no('url'); }
  return {
    ok: true,
    handoff: {
      outing: block.outing, socket: block.socket, ticket: block.ticket, url: block.url, allow: block.allow, site: site.origin,
      persona: { name: persona.name, role: persona.role, ...(persona.visit ? { visit: persona.visit } : {}), ...(persona.device ? { device: persona.device } : {}) },
      errand: { name: errand.name, goal: errand.goal, doneWhen: errand.doneWhen },
    },
  };
}
