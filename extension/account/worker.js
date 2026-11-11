// The account's half of the background worker: it answers the popup (popup/account.js), and nobody else. A message
// is taken only when Chrome itself says it came from one of this extension's popup pages: never from a page, a
// content script, another extension, or the walk's side panel. No answer ever carries a token: only whether the
// server takes sign-ins, whether this browser is signed in, the email, and the personas' names.
import { BUILD } from '../shared/build.js';
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
  const server = UNPACKED ? { server: issuer } : {};
  if (!(await session.available())) return { ok: true, available: false, ...server };
  if (!(await session.signedIn())) return { ok: true, available: true, signedIn: false, ...server };
  const me = await session.me();
  return me ? { ok: true, available: true, signedIn: true, email: me.email, ...server } : { ok: true, available: true, signedIn: await session.signedIn(), ...server };
}

const ANSWERS = {
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
