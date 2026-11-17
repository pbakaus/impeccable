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
import { current, ready } from '../walks/store.js';
import { faceOf, isLive } from '../walks/view.js';
import { offerPanel, signedIn as pointToolbar, withoutPro } from '../walks/toolbar.js';
import { PRODUCTION, issuerAllowed, randomText } from './flow.js';
import { PLAN_ID, appOf, createSession, idbStore } from './session.js';
import { ALARM, checkIns } from './waiting.js';

const POPUP = chrome.runtime.getURL('popup/');
/** A development build (shared/build.js): only such a build may sign in to another server. */
const UNPACKED = BUILD.devHosts;

/** Whether a message came from this extension's own popup. */
export const fromPopup = (sender) => sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(POPUP);
const PANEL = chrome.runtime.getURL('walks/panel/');
/** What the side panel may ask: who is signed in, to sign in, and, signed in, the personas, the apps, to make or remove one of their own, a plan, the walk and History. */
const PANEL_ASKS = ['status', 'sign-in', 'sign-out', 'get-pro', 'personas', 'apps', 'create', 'remove', 'plan', 'walk', 'journeys'];
const fromPanel = (sender, account) => PANEL_ASKS.includes(account) && sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(PANEL);

let issuer = PRODUCTION;
const chosen = chrome.storage.local.get('accountServer').then(({ accountServer }) => {
  if (issuerAllowed(accountServer, UNPACKED)) issuer = accountServer;
}, () => undefined).then(() => session.recover()).catch(() => undefined);
// Signed in with Impeccable Pro, the toolbar icon opens the side panel rather than the popup: from the worker's start,
// by the server's word (`status`); out of its reach, by the sign-in kept on disk.
// The worker's start is also a check-in for journeys an agent asked for (waiting.js).
void chosen.then(() => status()).then((answer) => checkedIn(answer, { start: true })).catch(() => undefined);

const session = createSession({
  fetch: (...args) => fetch(...args),
  store: idbStore(),
  issuer: () => issuer,
  launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  redirectUri: chrome.identity.getRedirectURL('callback'),
});

const agent = checkIns({ session, chrome, issuer: () => issuer });
// A build without these permissions has no such APIs: the rest of the worker (the detector, walks) still starts.
chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void chosen.then(() => agent.checkIn()); });
chrome.notifications?.onButtonClicked.addListener((notice, button) => { void chosen.then(() => agent.pressed(notice, button)).catch(() => undefined); });
chrome.notifications?.onClicked.addListener((notice) => { void chosen.then(() => agent.pressed(notice)).catch(() => undefined); });
/** Signed in with Pro, by the server's word now: true, false, or null when it is not known (out of reach). */
const proOf = (answer) => (answer.signedIn === false || answer.pro === false ? false : answer.signedIn === true && answer.pro === true ? true : null);
/** A check-in for an `answer` that says signed in with Pro (waiting.js). */
const checkedIn = (answer, how) => { if (proOf(answer) === true) void agent.checkIn(how); return answer; };

/** What the popup is told of the account. */
async function status() {
  const answer = await account();
  const signedIn = await session.signedIn().catch(() => false);
  // The server says who has Impeccable Pro (`pro`), on this and every request: without it, the popup alone.
  pointToolbar(signedIn && answer.pro !== false);
  withoutPro(signedIn && answer.pro === false);
  void agent.keep(signedIn ? proOf(answer) : false).catch(() => undefined);
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
  return { 'api.impeccable.style': 'https://impeccable.reviews', 'api.staging.impeccable.style': 'https://staging.impeccable.reviews' }[url.hostname] ?? null;
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
  // An app persona's app goes with its slug (slugs repeat across apps), to a server that says it takes it.
  // A default (`default:robert`) and an app persona from an older list have none.
  const app = kind === 'own' ? appOf(persona.app) : null;
  const ref = PRESETS.includes(persona?.preset) ? { preset: persona.preset } : kind ? { [kind]: persona[kind], ...(app && (await takes('ownApp')) ? { app } : {}) } : null;
  const goal = typeof task === 'string' ? task.trim() : '';
  if (!ref || !goal || goal.length > TASK_MAX || !Number.isInteger(tabId)) return { why: 'failed' };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!/^https?:\/\//.test(tab?.url ?? '') || tab.url.length > 2048) return { why: 'tab' };
  return { body: { persona: ref, task: goal, url: tab.url } };
}

/** A short plan of the walk, for the person to approve in the side panel before it starts. */
async function plan(message) {
  const ask = await asked(message);
  if (!ask.body) return { ok: false, why: ask.why };
  const planned = await session.planWalk(ask.body);
  // The width the walk will run at: the one picked, unless this server's word on widths was never heard (`takesWidths`).
  return planned.ok && Object.hasOwn(SERVER_DEVICE, message.device) ? { ...planned, width: (await takesWidths()) === null ? 'desktop' : message.device } : planned;
}

/** Who walks, as the side panel picked them: a name, and the face sheet when there is one (session.js `faceOf`, a `data:` picture). */
const walkerOf = (who) => (typeof who?.name === 'string' && who.name ? { name: who.name.slice(0, 120), face: faceOf(who.face) } : null);

/** The width the side panel picked, as the server names it (walks/driver.js `DEVICES`); none is the tab as it is. */
const SERVER_DEVICE = { phone: 'mobile', tablet: 'tablet' };
/** A persona's own device, as the server names it: a computer is said too, where a walk's width leaves it out. */
const MAKE_DEVICE = { desktop: 'desktop', ...SERVER_DEVICE };

/**
 * Whether the server in use takes a walk's width (`widths` on /me), an app persona's app (`ownApp`), or a new persona's
 * device and disability (`ownTraits`): its answer now, else the last it gave, kept per server; null when it never
 * answered. A walk then runs at Desktop rather than at a width it could not file.
 */
const TAKES = ['widths', 'ownApp', 'ownTraits'];
async function takes(field) {
  const me = await session.me().catch(() => null);
  if (me) { await chrome.storage.local.set(Object.fromEntries(TAKES.map((one) => [`${one}:${issuer}`, me[one]]))).catch(() => undefined); return me[field]; }
  const kept = (await chrome.storage.local.get(`${field}:${issuer}`).catch(() => ({})))[`${field}:${issuer}`];
  return typeof kept === 'boolean' ? kept : null;
}
const takesWidths = () => takes('widths');

async function walk({ plan: approved, walker, ...message }, panel = Promise.resolve(false)) {
  const ask = await asked(message);
  if (!ask.body) return { ok: false, why: ask.why };
  if (approved !== undefined && !PLAN_ID.test(approved)) return { ok: false, why: 'failed' };
  // A walk under way would refuse this one's hand-off (link.js `adopt`): refused before the server makes an outing that
  // nothing would come for.
  await ready;
  if (isLive(current())) return { ok: false, why: 'failed' };
  const at = issuer;
  // Told only to a server that says it takes it: an older one refuses a key it does not know. The tab is laid
  // out at the width either way (link.js `adopt`).
  const widths = Object.hasOwn(SERVER_DEVICE, message.device) ? await takesWidths() : false;
  if (widths === null) message.device = 'desktop';
  const device = widths ? { device: SERVER_DEVICE[message.device] } : {};
  const started = await session.startWalk({ ...ask.body, ...(approved ? { plan: approved } : {}), ...device });
  if (!started.ok) return started;
  // The server made the outing: one refused here is called off at once, once, not waited for. Only on the server
  // that made it: one changed since has no such outing.
  const refused = () => { if (issuer === at) void session.cancelWalk(started.handoff.outing).catch(() => undefined); return { ok: false, why: 'failed' }; };
  const socket = socketOf(at);
  if (!socket || typeof started.handoff.socket !== 'string' || !started.handoff.socket.startsWith(`${socket}/api/outings/`) || issuer !== at) return refused();
  const taken = await adopt(JSON.stringify(started.handoff), message.tabId, message.device, message.sees).catch(() => null);
  if (!taken?.ok) return refused();
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
 * made rather than a second. `open` marks one sent and not answered yet. The same words with another device or
 * disability are another persona (`picked`).
 */
let making = null;
const kept = () => chrome.storage.session.get('personaCreate').then(({ personaCreate }) => personaCreate ?? null, () => null);
async function create({ description, device, disability }) {
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.length < 8 || text.length > 1500) return { ok: false, why: 'short' };
  // The device and disability picked in the panel; the server holds the disability to its own list.
  const picked = { ...(Object.hasOwn(MAKE_DEVICE, device) ? { device: MAKE_DEVICE[device] } : {}), ...(typeof disability === 'string' && /^[a-z-]{1,24}$/.test(disability) ? { disability } : {}) };
  const same = (one) => one?.description === text && JSON.stringify(one.picked ?? {}) === JSON.stringify(picked);
  if (making) return same(making) ? making.done : { ok: false, why: 'busy' };
  making = { description: text, picked, done: (async () => {
    try {
      const was = await kept();
      const requestId = same(was) ? was.requestId : randomText();
      await chrome.storage.session.set({ personaCreate: { description: text, picked, requestId, open: true } });
      // Told only to a server that says it takes them: an older one refuses a key it does not know, and makes the
      // persona from the words alone. The panel still shows what was picked.
      const traits = Object.keys(picked).length && await takes('ownTraits') === true ? picked : {};
      const made = await session.createPersona({ description: text, ...traits, requestId });
      await chrome.storage.session.set({ personaCreate: made.ok ? null : { description: text, picked, requestId, open: false } });
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
async function personas({ url, app, faceless }) {
  // `url`: the side panel's tab, by its origin alone (the server matches an app by host); `app`: one app's, from Make a persona.
  // `faceless`: the panel waiting for its own personas' faces, by slug: only theirs are fetched.
  let origin = null;
  try { origin = /^https?:\/\//.test(url) ? new URL(url).origin : null; } catch { /* no address */ }
  const only = Array.isArray(faceless) ? { faceless: faceless.filter((slug) => typeof slug === 'string').slice(0, 10) } : {};
  const [list, was] = await Promise.all([session.personas({ ...(origin ? { url: origin } : {}), ...(app ? { app } : {}), ...only }), making ? null : kept()]);
  const creating = making?.description ?? (was?.open ? was.description : null);
  if (list) return { ok: true, personas: list, ...(creating ? { creating } : {}) };
  return { ok: false, why: (await session.signedIn().catch(() => true)) ? 'personas' : 'signed-out' };
}

const ANSWERS = {
  create,
  personas,
  async apps() { const apps = await session.apps(); return apps ? { ok: true, apps } : { ok: false, why: 'apps' }; },
  async journeys() { const journeys = await session.journeys(); return journeys ? { ok: true, journeys } : { ok: false, why: (await session.signedIn().catch(() => true)) ? 'journeys' : 'signed-out' }; },
  plan,
  async remove({ slug }) { return session.removePersona(slug); },
  walk,
  status,
  // `connected`: the side panel says "You're connected" once, even when the sign-in started in the popup, which the sign-in window closes.
  async 'sign-in'() {
    const done = await session.signIn();
    if (!done.ok) return { ok: false, why: done.why };
    const answer = await status().then(checkedIn).then(welcome);
    if (answer.signedIn === true && answer.pro !== false) await Promise.resolve(chrome.storage.session?.set({ connected: true })).catch(() => undefined);
    return answer;
  },
  /** Get Pro: the pricing page's own link, on the website of the server signed in to (its checkout, after sign-in and terms). */
  async 'get-pro'() {
    const site = siteOf(issuer);
    if (!site) return { ok: false };
    await chrome.tabs.create({ url: `${site}/app/-/billing/checkout?start=1`, active: true }).catch(() => undefined);
    return { ok: true };
  },
  async 'sign-out'() { await chrome.storage.local.remove('appForSite').catch(() => undefined); await session.signOut(); await agent.forget(); await chrome.storage.session.set({ personaCreate: null }); return status(); },
  async server({ server }) {
    if (!issuerAllowed(server, UNPACKED)) return { ok: false, why: 'server' };
    if (server !== issuer) { await agent.forget(); await chrome.storage.local.remove('appForSite').catch(() => undefined); }
    issuer = server;
    await chrome.storage.local.set({ accountServer: server });
    return status().then(checkedIn);
  },
};

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.account !== 'string') return false;
  if (!fromPopup(sender) && !fromPanel(sender, message.account)) { respond({ ok: false, why: 'sender' }); return false; }
  if (!Object.hasOwn(ANSWERS, message.account)) { respond({ ok: false, why: 'unknown' }); return false; }
  // At once, while Chrome still counts the popup's click: whether the side panel opened is said in the answer.
  if (message.account === 'walk' && Number.isInteger(message.tabId)) {
    offerPanel();
    const panel = chrome.sidePanel.open({ tabId: message.tabId }).then(() => true, () => false);
    void chosen.then(() => walk(message, panel)).then(respond, () => respond({ ok: false, why: 'failed' }));
    return true;
  }
  // Every answer is for the server chosen, once it is known: a worker Chrome just started reads it first.
  void chosen.then(() => ANSWERS[message.account](message)).then(respond, () => respond({ ok: false, why: 'failed' }));
  return true;
});
