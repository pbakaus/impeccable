// The account's half of the background worker: it answers the popup (popup/account.js), and nobody else, but for
// the walk's side panel, which may ask only whether this browser is signed in and to sign in. A message is taken only
// when Chrome itself says it came from one of this extension's popup pages (or its panel): never from a page, a
// content script or another extension. No answer ever carries a token: only whether the
// server takes sign-ins, whether this browser is signed in, the email, the personas' names, how a walk's start went,
// and how making or removing a persona went. A walk the person starts on their tab goes to the walks (walks/link.js)
// as the server's block and the tab's id alone.
import { BUILD } from '../shared/build.js';
import { adopt } from '../walks/link.js';
import { PRODUCTION, issuerAllowed, randomText } from './flow.js';
import { createSession, idbStore } from './session.js';

const POPUP = chrome.runtime.getURL('popup/');
/** A development build (shared/build.js): only such a build may sign in to another server. */
const UNPACKED = BUILD.devHosts;

/** Whether a message came from this extension's own popup. */
export const fromPopup = (sender) => sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(POPUP);
const PANEL = chrome.runtime.getURL('walks/panel/');
/** What the side panel may ask: its empty state offers Sign in, or points at the popup's Personas. */
const PANEL_ASKS = ['status', 'sign-in'];
const fromPanel = (sender, account) => PANEL_ASKS.includes(account) && sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(PANEL);

let issuer = PRODUCTION;
const chosen = chrome.storage.local.get('accountServer').then(({ accountServer }) => {
  if (issuerAllowed(accountServer, UNPACKED)) issuer = accountServer;
}, () => undefined).then(() => session.recover()).catch(() => undefined);

const session = createSession({
  fetch: (...args) => fetch(...args),
  store: idbStore(),
  issuer: () => issuer,
  launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  redirectUri: chrome.identity.getRedirectURL('callback'),
});

/** What the popup is told of the account. */
async function status() {
  await chosen;
  session.retry();
  const server = UNPACKED ? { server: issuer, unpacked: true } : {};
  if (!(await session.available())) return { ok: true, available: false, ...server };
  if (!(await session.signedIn())) return { ok: true, available: true, signedIn: false, ...server };
  const me = await session.me();
  return me ? { ok: true, available: true, signedIn: true, email: me.email, ...server } : { ok: true, available: true, signedIn: await session.signedIn(), ...server };
}

/** The socket's origin for a walk the account server `at` starts: its fixed pair, as walks/handoff.js holds it too. */
function socketOf(at) {
  const url = new URL(at);
  if (url.hostname === 'api.localhost') return `ws://localhost${url.port ? `:${url.port}` : ''}`;
  return { 'api.impeccable.style': 'wss://impeccable.reviews', 'api.staging.impeccable.style': 'wss://staging.impeccable.reviews' }[url.hostname] ?? null;
}

/** The presets' ids, as popup/words.js lists them (that file is the popup's alone): the server holds each one's card. */
const PRESETS = ['ines', 'kofi', 'priya', 'tomasz', 'hana', 'noor'];
const TASK_MAX = 2000;

/**
 * A walk of the tab the person is on: the tab must be a web page, and then the server is asked. What the server
 * answers goes to the walks; the popup hears only how it went. `panel`: whether the side panel opened on the click.
 */
async function walk({ persona, task, tabId }, panel = Promise.resolve(false)) {
  const kind = ['own', 'mine'].find((key) => typeof persona?.[key] === 'string' && persona[key]);
  const ref = PRESETS.includes(persona?.preset) ? { preset: persona.preset } : kind ? { [kind]: persona[kind] } : null;
  const goal = typeof task === 'string' ? task.trim() : '';
  if (!ref || !goal || goal.length > TASK_MAX || !Number.isInteger(tabId)) return { ok: false, why: 'failed' };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!/^https?:\/\//.test(tab?.url ?? '') || tab.url.length > 2048) return { ok: false, why: 'tab' };
  const at = issuer;
  const started = await session.startWalk({ persona: ref, task: goal, url: tab.url });
  if (!started.ok) return started;
  const socket = socketOf(at);
  if (!socket || typeof started.handoff.socket !== 'string' || !started.handoff.socket.startsWith(`${socket}/api/outings/`) || issuer !== at) return { ok: false, why: 'failed' };
  const taken = await adopt(JSON.stringify(started.handoff), tabId).catch(() => null);
  if (!taken?.ok) return { ok: false, why: 'failed' };
  return { ok: true, panel: await panel };
}

/**
 * Making a persona of the person's own: one at a time, in this worker, so a popup that closes does not stop it. Its
 * description and request id are kept in chrome.storage.session until the server makes it: a retry of the same
 * description, or a worker Chrome ended mid-way, sends the same id again, and the server answers with the persona it
 * made rather than a second. `open` marks one sent and not answered yet.
 */
let making = null;
const kept = () => chrome.storage.session.get('personaCreate').then(({ personaCreate }) => personaCreate ?? null, () => null);
async function create({ description }) {
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.length < 8 || text.length > 1500) return { ok: false, why: 'short' };
  if (making) return making.description === text ? making.done : { ok: false, why: 'busy' };
  making = { description: text, done: (async () => {
    try {
      const was = await kept();
      const requestId = was?.description === text ? was.requestId : randomText();
      await chrome.storage.session.set({ personaCreate: { description: text, requestId, open: true } });
      const made = await session.createPersona({ description: text, requestId });
      await chrome.storage.session.set({ personaCreate: made.ok ? null : { description: text, requestId, open: false } });
      return made;
    } finally {
      making = null;
    }
  })() };
  return making.done;
}

/** The personas, and the description of one still being made (or sent and never answered), for the popup to wait on. */
async function personas() {
  const [list, was] = await Promise.all([session.personas(), making ? null : kept()]);
  const creating = making?.description ?? (was?.open ? was.description : null);
  return list ? { ok: true, personas: list, ...(creating ? { creating } : {}) } : { ok: false, why: 'personas' };
}

const ANSWERS = {
  create,
  personas,
  async remove({ slug }) { return session.removePersona(slug); },
  walk,
  status,
  async 'sign-in'() { const done = await session.signIn(); return done.ok ? status() : { ok: false, why: done.why }; },
  async 'sign-out'() { await session.signOut(); await chrome.storage.session.set({ personaCreate: null }); return status(); },
  async server({ server }) {
    if (!issuerAllowed(server, UNPACKED)) return { ok: false, why: 'server' };
    issuer = server;
    await chrome.storage.local.set({ accountServer: server });
    return status();
  },
};

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.account !== 'string') return false;
  if (!fromPopup(sender) && !fromPanel(sender, message.account)) { respond({ ok: false, why: 'sender' }); return false; }
  if (!Object.hasOwn(ANSWERS, message.account)) { respond({ ok: false, why: 'unknown' }); return false; }
  // At once, while Chrome still counts the popup's click: whether the side panel opened is said in the answer.
  if (message.account === 'walk' && Number.isInteger(message.tabId)) {
    const panel = chrome.sidePanel.open({ tabId: message.tabId }).then(() => true, () => false);
    void chosen.then(() => walk(message, panel)).then(respond, () => respond({ ok: false, why: 'failed' }));
    return true;
  }
  // Every answer is for the server chosen, once it is known: a worker Chrome just started reads it first.
  void chosen.then(() => ANSWERS[message.account](message)).then(respond, () => respond({ ok: false, why: 'failed' }));
  return true;
});
