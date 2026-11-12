// The account's half of the background worker: it answers the popup (popup/account.js), and nobody else. A message
// is taken only when Chrome itself says it came from one of this extension's popup pages: never from a page, a
// content script, another extension, or the walk's side panel. No answer ever carries a token: only whether the
// server takes sign-ins, whether this browser is signed in, the email, the personas' names, and how a walk's start
// went. A walk the person starts on their tab goes to the walk helper as the server's block and the tab's id alone.
import { BUILD } from '../shared/build.js';
import { HELPER_ID } from '../shared/ids.js';
import { helper, onboard } from '../onboarding/contact.js';
import { PRODUCTION, issuerAllowed } from './flow.js';
import { createSession, idbStore } from './session.js';

const POPUP = chrome.runtime.getURL('popup/');
/** A development build (shared/build.js): only such a build may sign in to another server. */
const UNPACKED = BUILD.devHosts;

/** Whether a message came from this extension's own popup. */
export const fromPopup = (sender) => sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(POPUP);

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

/** The socket's origin for a walk the account server `at` starts: its fixed pair, as the helper holds it too. */
function socketOf(at) {
  const url = new URL(at);
  if (url.hostname === 'api.localhost') return `ws://localhost${url.port ? `:${url.port}` : ''}`;
  return { 'api.impeccable.style': 'wss://impeccable.reviews', 'api.staging.impeccable.style': 'wss://staging.impeccable.reviews' }[url.hostname] ?? null;
}

/** The presets' ids, as popup/words.js lists them (that file is the popup's alone): the server holds each one's card. */
const PRESETS = ['ines', 'kofi', 'priya', 'tomasz', 'hana', 'noor'];
const TASK_MAX = 2000;

/**
 * A walk of the tab the person is on: the tab must be a web page, the helper here (else its onboarding opens), and
 * then the server is asked. What the server answers goes to the helper; the popup hears only how it went.
 */
async function walk({ persona, task, tabId }) {
  const ref = PRESETS.includes(persona?.preset) ? { preset: persona.preset } : typeof persona?.own === 'string' && persona.own ? { own: persona.own } : null;
  const goal = typeof task === 'string' ? task.trim() : '';
  if (!ref || !goal || goal.length > TASK_MAX || !Number.isInteger(tabId)) return { ok: false, why: 'failed' };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!/^https?:\/\//.test(tab?.url ?? '') || tab.url.length > 2048) return { ok: false, why: 'tab' };
  if ((await helper()) !== 'ready') { await onboard(tab).catch(() => undefined); return { ok: false, why: 'helper' }; }
  const at = issuer;
  const started = await session.startWalk({ persona: ref, task: goal, url: tab.url });
  if (!started.ok) return started;
  const socket = socketOf(at);
  if (!socket || typeof started.handoff.socket !== 'string' || !started.handoff.socket.startsWith(`${socket}/api/outings/`) || issuer !== at) return { ok: false, why: 'failed' };
  const taken = await chrome.runtime.sendMessage(HELPER_ID, { walks: 'walk', handoff: JSON.stringify(started.handoff), tabId }).catch(() => null);
  return taken?.ok ? { ok: true, panel: taken.panel === true } : { ok: false, why: 'failed' };
}

const ANSWERS = {
  walk,
  status,
  async 'sign-in'() { const done = await session.signIn(); return done.ok ? status() : { ok: false, why: done.why }; },
  async 'sign-out'() { await session.signOut(); return status(); },
  async personas() { const personas = await session.personas(); return personas ? { ok: true, personas } : { ok: false, why: 'personas' }; },
  async server({ server }) {
    if (!issuerAllowed(server, UNPACKED)) return { ok: false, why: 'server' };
    issuer = server;
    await chrome.storage.local.set({ accountServer: server });
    return status();
  },
};

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.account !== 'string') return false;
  if (!fromPopup(sender)) { respond({ ok: false, why: 'sender' }); return false; }
  if (!Object.hasOwn(ANSWERS, message.account)) { respond({ ok: false, why: 'unknown' }); return false; }
  // Every answer is for the server chosen, once it is known: a worker Chrome just started reads it first.
  void chosen.then(() => ANSWERS[message.account](message)).then(respond, () => respond({ ok: false, why: 'failed' }));
  return true;
});
