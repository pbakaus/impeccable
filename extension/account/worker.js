// The account's half of the background worker: it answers the popup (popup/account.js), and nobody else, but for
// the walk's side panel, which may ask only whether this browser is signed in and to sign in. A message is taken only
// when Chrome itself says it came from one of this extension's popup pages (or its panel): never from a page, a
// content script or another extension. No answer ever carries a token: only whether the
// server takes sign-ins, whether this browser is signed in, the email, the personas' names, how a walk's start went,
// and how making or removing a persona went. A walk the person starts on their tab goes to the walks (walks/link.js)
// as the server's block and the tab's id alone. The welcome page (welcome.js) may ask one thing: to open the side panel.
import { BUILD } from '../shared/build.js';
import { adopt, opensPanel } from '../walks/link.js';
import { planned } from '../walks/control.js';
import { signedIn as pointToolbar } from '../walks/toolbar.js';
import { PRODUCTION, issuerAllowed, randomText } from './flow.js';
import { PLAN_ID, createSession, idbStore } from './session.js';

const POPUP = chrome.runtime.getURL('popup/');
/** A development build (shared/build.js): only such a build may sign in to another server. */
const UNPACKED = BUILD.devHosts;

/** Whether a message came from this extension's own popup. */
export const fromPopup = (sender) => sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(POPUP);
const PANEL = chrome.runtime.getURL('walks/panel/');
/** What the side panel may ask: who is signed in, to sign in, and, signed in, the personas, a plan and the walk. */
const PANEL_ASKS = ['status', 'sign-in', 'personas', 'plan', 'walk'];
const fromPanel = (sender, account) => PANEL_ASKS.includes(account) && sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(PANEL);

let issuer = PRODUCTION;
const chosen = chrome.storage.local.get('accountServer').then(({ accountServer }) => {
  if (issuerAllowed(accountServer)) issuer = accountServer;
}, () => undefined).then(() => session.recover()).catch(() => undefined);
// Signed in with Impeccable Pro, the toolbar icon opens the side panel rather than the popup: from the worker's start,
// by the server's word (`status`); out of its reach, by the sign-in kept on disk.
void chosen.then(() => status()).catch(() => undefined);

const session = createSession({
  fetch: (...args) => fetch(...args),
  store: idbStore(),
  issuer: () => issuer,
  launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  redirectUri: chrome.identity.getRedirectURL('callback'),
});

/** What the popup is told of the account. */
async function status() {
  const answer = await account();
  const signedIn = await session.signedIn().catch(() => false);
  // The server says who has Impeccable Pro (`pro`), on this and every request: without it, the popup alone.
  pointToolbar(signedIn && answer.pro !== false);
  // A kept sign-in is said even while the server is out of reach, so it can still be signed out.
  return answer.ok && answer.signedIn === undefined && signedIn ? { ...answer, signedIn } : answer;
}

async function account() {
  await chosen;
  session.retry();
  const server = UNPACKED ? { server: issuer, unpacked: true } : {};
  if (!(await session.available())) return { ok: true, available: false, ...server };
  if (!(await session.signedIn())) return { ok: true, available: true, signedIn: false, ...server };
  const me = await session.me();
  return me ? { ok: true, available: true, signedIn: true, email: me.email, pro: me.pro, ...server } : { ok: true, available: true, signedIn: await session.signedIn(), ...server };
}

/** The website paired with the account server `at`: a fixed pair, as walks/handoff.js holds it too. */
function siteOf(at) {
  const url = new URL(at);
  if (url.hostname === 'api.localhost') return `http://localhost${url.port ? `:${url.port}` : ''}`;
  const own = BUILD.servers.find((server) => server.api === url.origin);
  return own ? own.site : url.hostname === 'api.impeccable.style' ? 'https://impeccable.reviews' : null;
}
/** The socket's origin for a walk the account server `at` starts: its website's, over a socket. */
const socketOf = (at) => siteOf(at)?.replace(/^http/, 'ws') ?? null;

/** After the first sign-in with Impeccable Pro, its welcome page, on the website of the server signed in to; once (`welcomeSeen`). */
async function welcome(answer) {
  const site = answer.signedIn === true && answer.pro !== false ? siteOf(issuer) : null;
  if (!site || (await chrome.storage.local.get('welcomeSeen').catch(() => ({}))).welcomeSeen) return answer;
  await chrome.storage.local.set({ welcomeSeen: true }).catch(() => undefined);
  void chrome.tabs.create({ url: `${site}/pro/welcome`, active: true }).catch(() => undefined);
  return answer;
}
/** The welcome page's button (welcome.js) opens the panel as our outing page's does: on the website signed in to alone. */
const isWelcomePage = (url) => { try { const at = new URL(url); return at.origin === siteOf(issuer) && /^\/pro\/welcome\/?$/.test(at.pathname); } catch { return false; } };
opensPanel(isWelcomePage);

/** The presets' ids, as popup/words.js lists them (that file is the popup's alone): the server holds each one's card. */
const PRESETS = ['ines', 'kofi', 'priya', 'tomasz', 'hana', 'noor'];
const TASK_MAX = 2000;

/**
 * A walk of the tab the person is on: the tab must be a web page, and then the server is asked. What the server
 * answers goes to the walks; the popup hears only how it went. `panel`: whether the side panel opened on the click.
 */
/** The walk asked for, checked: `{ body, tab }`, or `{ why }`. */
async function asked({ persona, task, tabId }) {
  const kind = ['own', 'mine'].find((key) => typeof persona?.[key] === 'string' && persona[key]);
  const ref = PRESETS.includes(persona?.preset) ? { preset: persona.preset } : kind ? { [kind]: persona[kind] } : null;
  const goal = typeof task === 'string' ? task.trim() : '';
  if (!ref || !goal || goal.length > TASK_MAX || !Number.isInteger(tabId)) return { why: 'failed' };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!/^https?:\/\//.test(tab?.url ?? '') || tab.url.length > 2048) return { why: 'tab' };
  return { body: { persona: ref, task: goal, url: tab.url } };
}

/** A short plan of the walk, for the person to approve in the side panel before it starts. */
async function plan(message) {
  const ask = await asked(message);
  return ask.body ? session.planWalk(ask.body) : { ok: false, why: ask.why };
}

/** Who walks, as the side panel picked them: a name, and the face sheet's address when there is one. */
const walkerOf = (who) => (typeof who?.name === 'string' && who.name ? { name: who.name.slice(0, 120), face: typeof who.face === 'string' && /^https?:\/\//.test(who.face) ? who.face.slice(0, 2048) : null } : null);

async function walk({ plan: approved, walker, ...message }, panel = Promise.resolve(false)) {
  const ask = await asked(message);
  if (!ask.body) return { ok: false, why: ask.why };
  if (approved !== undefined && !PLAN_ID.test(approved)) return { ok: false, why: 'failed' };
  const at = issuer;
  const started = await session.startWalk({ ...ask.body, ...(approved ? { plan: approved } : {}) });
  if (!started.ok) return started;
  const socket = socketOf(at);
  if (!socket || typeof started.handoff.socket !== 'string' || !started.handoff.socket.startsWith(`${socket}/api/outings/`) || issuer !== at) return { ok: false, why: 'failed' };
  const taken = await adopt(JSON.stringify(started.handoff), message.tabId).catch(() => null);
  if (!taken?.ok) return { ok: false, why: 'failed' };
  // An approved plan approved its steps: the walk asks nothing mid-way, and its results wait behind the panel's button.
  planned(Boolean(approved));
  // After the hand-off, which forgot the last walk's (control.js `rearm`): this walk's page and walker only.
  await chrome.storage.session.set({ walkUrl: started.walkUrl ?? null, walker: walkerOf(walker) }).catch(() => undefined);
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

/**
 * The personas, and the description of one still being made (or sent and never answered), for the popup to wait on.
 * None: `signed-out` when no sign-in is kept any more (the server ended it), else `personas`.
 */
async function personas() {
  const [list, was] = await Promise.all([session.personas(), making ? null : kept()]);
  const creating = making?.description ?? (was?.open ? was.description : null);
  if (list) return { ok: true, personas: list, ...(creating ? { creating } : {}) };
  return { ok: false, why: (await session.signedIn().catch(() => true)) ? 'personas' : 'signed-out' };
}

const ANSWERS = {
  create,
  personas,
  plan,
  async remove({ slug }) { return session.removePersona(slug); },
  walk,
  status,
  async 'sign-in'() { const done = await session.signIn(); return done.ok ? status().then(welcome) : { ok: false, why: done.why }; },
  async 'sign-out'() { await session.signOut(); await chrome.storage.session.set({ personaCreate: null }); return status(); },
  async server({ server }) {
    if (!issuerAllowed(server)) return { ok: false, why: 'server' };
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
