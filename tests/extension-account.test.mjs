import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { CLIENT_ID, PRODUCTION, authorizeUrl, challengeFor, issuerAllowed, readCallback, readMetadata } from '../extension/account/flow.js';
import { createSession, idbStore } from '../extension/account/session.js';

const ISSUER = PRODUCTION;
const REDIRECT = 'https://ext.chromiumapp.org/callback';
const META = {
  issuer: ISSUER,
  authorization_endpoint: 'https://app.impeccable.style/app/oauth/authorize',
  token_endpoint: `${ISSUER}/oauth/token`,
  revocation_endpoint: `${ISSUER}/oauth/revoke`,
};
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('account sign-in flow', () => {
  it('asks for a code with an S256 challenge of its verifier, for the extension resource', async () => {
    const url = new URL(authorizeUrl({ endpoint: META.authorization_endpoint, issuer: ISSUER, redirectUri: REDIRECT, state: 's1', challenge: await challengeFor('verifier') }));
    const q = Object.fromEntries(url.searchParams);
    assert.deepEqual(
      { client: q.client_id, method: q.code_challenge_method, challenge: q.code_challenge, resource: q.resource, redirect: q.redirect_uri, state: q.state, type: q.response_type },
      { client: CLIENT_ID, method: 'S256', challenge: 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ', resource: `${ISSUER}/extension/v1`, redirect: REDIRECT, state: 's1', type: 'code' },
    );
  });

  const back = (query) => `${REDIRECT}?${new URLSearchParams(query)}`;
  const good = { code: 'code-0123456789', state: 's1', iss: ISSUER };
  for (const [label, returned, why] of [
    ['another state', back({ ...good, state: 's2' }), 'state'],
    ['no state', back({ code: good.code, iss: ISSUER }), 'state'],
    ['another issuer', back({ ...good, iss: 'https://evil.example' }), 'iss'],
    ['no issuer', back({ code: good.code, state: 's1' }), 'iss'],
    ['no code', back({ state: 's1', iss: ISSUER }), 'code'],
    ['a malformed code', back({ ...good, code: 'a b' }), 'code'],
    ['a refusal', back({ state: 's1', iss: ISSUER, error: 'access_denied' }), 'denied'],
    ['another callback', `https://evil.chromiumapp.org/callback?${new URLSearchParams(good)}`, 'callback'],
    ['another path', `${REDIRECT}/more?${new URLSearchParams(good)}`, 'callback'],
    ['a name before the host', `${REDIRECT.replace('https://', 'https://evil@')}?${new URLSearchParams(good)}`, 'callback'],
    ...['code', 'state', 'iss'].map((key) => [`${key} twice`, `${back(good)}&${key}=${encodeURIComponent(good[key])}`, 'repeated']),
  ]) {
    it(`refuses a callback with ${label}`, () => {
      assert.deepEqual(readCallback(returned, { redirectUri: REDIRECT, state: 's1', issuer: ISSUER }), { ok: false, why });
    });
  }

  it('takes a callback with our state, issuer and a code', () => {
    assert.deepEqual(readCallback(back(good), { redirectUri: REDIRECT, state: 's1', issuer: ISSUER }), { ok: true, code: good.code });
  });

  it('takes a server only on its own word, its own origin and its paired sign-in dialog', () => {
    assert.ok(readMetadata(META, ISSUER));
    assert.equal(readMetadata({ ...META, issuer: 'https://other.example' }, ISSUER), null);
    assert.equal(readMetadata({ ...META, token_endpoint: 'https://evil.example/token' }, ISSUER), null);
    assert.equal(readMetadata({ ...META, authorization_endpoint: 'https://evil.example/app/oauth/authorize' }, ISSUER), null);
    assert.ok(readMetadata({ ...META, issuer: 'http://api.localhost:8787', authorization_endpoint: 'http://app.localhost:8787/app/oauth/authorize', token_endpoint: 'http://api.localhost:8787/oauth/token', revocation_endpoint: 'http://api.localhost:8787/oauth/revoke' }, 'http://api.localhost:8787'));
  });

  // An unknown scope fails the sign-in: the one that starts walks is asked for once the server lists it.
  for (const [listed, scope] of [
    [undefined, 'account:read personas:read'],
    [['account:read', 'personas:read', 'outings:start'], 'account:read personas:read outings:start'],
    [['account:read', 'personas:read', 'personas:create', 'outings:start'], 'account:read personas:read outings:start personas:create'],
  ]) {
    it(`asks for ${scope}`, () => { assert.equal(readMetadata({ ...META, scopes_supported: listed }, ISSUER).scope, scope); });
  }

  for (const [issuer, unpacked, allowed] of [
    [PRODUCTION, false, true],
    ['https://api.staging.impeccable.style', false, false],
    ['https://api.staging.impeccable.style', true, true],
    ['http://api.localhost:8787', true, true],
    ['http://localhost:8787', true, false],
    ['https://evil.example', true, false],
  ]) {
    it(`${allowed ? 'signs in' : 'never signs in'} to ${issuer} from a ${unpacked ? 'build loaded unpacked' : 'store build'}`, () => {
      assert.equal(issuerAllowed(issuer, unpacked), allowed);
    });
  }
});

// A session on stand-in servers and disk: every request it sends, in order. `issuers` are the servers that answer;
// `use` is the one in use, which a test may change mid-way.
const LOCAL = 'http://api.localhost:8787';
const metaOf = (at) => ({ ...META, issuer: at, authorization_endpoint: `${at.replace('api.', 'app.')}/app/oauth/authorize`, token_endpoint: `${at}/oauth/token`, revocation_endpoint: `${at}/oauth/revoke` });
function harness({ grant = null, me = 401, launched, issuers = [ISSUER], gated = true } = {}) {
  const sent = [];
  const disk = new Map(grant ? [[grant.issuer, grant]] : []);
  const gates = [];
  // The token server's books: refresh tokens it takes (one just used it takes again, as the real one does for a
  // while), and those it was told to end.
  const live = new Set(grant ? [grant.refresh] : []);
  const ended = [];
  let issued = 0;
  const server = {};
  for (const at of issuers) {
    const meta = metaOf(at);
    const issue = () => { issued += 1; live.add(`refresh-${at}-${issued}`); return json(200, { token_type: 'Bearer', access_token: `access-${at}-${issued}`, refresh_token: `refresh-${at}-${issued}`, expires_in: 900 }); };
    Object.assign(server, {
      [`${at}/.well-known/oauth-authorization-server`]: () => json(200, meta),
      [meta.token_endpoint]: (init) => {
        const body = new URLSearchParams(String(init.body));
        if (body.get('grant_type') === 'refresh_token' && !live.has(body.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
        return gated ? new Promise((resolve) => gates.push(() => resolve(issue()))) : issue();
      },
      [meta.revocation_endpoint]: (init) => { const token = new URLSearchParams(String(init.body)).get('token'); live.delete(token); ended.push(token); return json(200, {}); },
      [`${at}/extension/v1/me`]: (init) => (init.headers?.authorization ? json(200, { email: 'mira@example.com', name: 'Mira', pro: true }) : json(401, {})),
      // The availability probe, marked so the server's logs tell its 401 from a real one.
      [`${at}/extension/v1/me?probe=1`]: () => json(me, {}),
      [`${at}/extension/v1/personas?can=hears`]: () => json(200, { personas: [] }),
    });
  }
  const state = { use: issuers[0], now: 0 };
  const store = { get: async (key) => disk.get(key) ?? null, set: async (key, value) => { disk.set(key, value); }, clear: async (key) => { disk.delete(key); } };
  const answer = launched ?? (async (url) => `${REDIRECT}?code=code-0123456789&state=${new URL(url).searchParams.get('state')}&iss=${encodeURIComponent(state.use)}`);
  // A worker: `dies` names the step (a request's address, or `launch`) at which Chrome ends it. A request it dies on
  // reaches the server; its answer never comes back.
  const boot = ({ dies = () => false } = {}) => {
    const never = new Promise(() => {});
    const fetch = async (url, init = {}) => {
      sent.push({ url, body: init.body ? String(init.body) : '', auth: init.headers?.authorization ?? '', redirect: init.redirect, at: disk.has(state.use) ? 'kept' : 'none' });
      if (!server[url]) throw new TypeError('network');
      const answered = server[url](init);
      return dies(url) ? never : answered;
    };
    return createSession({ fetch, store, issuer: () => state.use, redirectUri: REDIRECT, now: () => state.now, launch: (url) => (dies('launch') ? never : answer(url)) });
  };
  const open = () => { for (const go of gates.splice(0)) go(); };
  return { session: boot(), boot, sent, disk, open, state, live, ended };
}
const kept = (at = ISSUER, refresh = 'refresh-0') => ({ state: 'signed-in', issuer: at, resource: `${at}/extension/v1`, client: CLIENT_ID, refresh, retire: [] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
/** IndexedDB over `records`, as Chrome runs it: a request succeeds, then its transaction commits, or aborts (and keeps nothing) while `disk.aborts`. */
const fakeIndexedDB = (records, disk = {}) => {
  const later = (fn) => { setTimeout(fn); };
  const transaction = () => {
    const tx = {};
    const ask = (value) => {
      const req = {};
      later(() => { req.result = value(); req.onsuccess?.(); later(() => (disk.aborts ? tx.onabort?.() : tx.oncomplete?.())); });
      return req;
    };
    const unlessAborted = (change) => () => { if (!disk.aborts) change(); };
    tx.objectStore = () => ({ get: (key) => ask(() => records.get(key)), put: (value, key) => ask(unlessAborted(() => records.set(key, value))), delete: (key) => ask(unlessAborted(() => records.delete(key))) });
    return tx;
  };
  return { open() { const req = {}; later(() => { req.result = { createObjectStore() {}, close() {}, transaction }; req.onsuccess(); }); return req; } };
};

describe('account session', () => {
  for (const [label, answer, available] of [['404', 404, false], ['401', 401, true], ['no answer', null, false]]) {
    it(`takes a ${label} from the door asked with no token as sign-in ${available ? 'on offer' : 'off'}`, async () => {
      const { session, sent } = harness({ me: answer ?? 404 });
      if (answer === null) sent.push = () => { throw new TypeError('offline'); };
      assert.equal(await session.available(), available);
    });
  }

  // Catches a write said saved before its transaction committed: a rotated refresh token, or a sign-out, lost to an abort.
  it('says an account record is saved only once the disk committed it', async () => {
    const was = globalThis.indexedDB;
    const records = new Map();
    const disk = { aborts: true };
    globalThis.indexedDB = fakeIndexedDB(records, disk);
    try {
      // A server the account worker's own start, still under way, never writes for.
      const at = 'https://disk.example';
      const store = idbStore();
      await assert.rejects(store.set(at, kept(at)));
      disk.aborts = false;
      assert.equal(await store.get(at), null);
      await store.set(at, kept(at));
      assert.deepEqual(await store.get(at), kept(at));
    } finally {
      globalThis.indexedDB = was;
    }
  });

  it('refreshes once for callers that ask at the same time', async () => {
    const { session, sent, open } = harness({ grant: kept() });
    const asked = Promise.all([session.me(), session.me(), session.me()]);
    await settle();
    open();
    const answers = await asked;
    assert.deepEqual(answers.map((me) => me?.email), ['mira@example.com', 'mira@example.com', 'mira@example.com']);
    assert.equal(sent.filter((r) => r.url === META.token_endpoint).length, 1);
  });

  it('sends nothing of one server’s sign-in to another, even mid-refresh, and never follows a redirect with a token', async () => {
    const { session, sent, open, state, disk } = harness({ issuers: [ISSUER, LOCAL] });
    const signingIn = session.signIn();
    await settle();
    open();
    assert.deepEqual(await signingIn, { ok: true });
    // A refresh for the first server is under way when the server in use changes.
    state.now = 3_600_000;
    const late = session.me();
    await settle();
    state.use = LOCAL;
    open();
    assert.equal(await late, null, 'the first server’s answer is handed to nobody');
    const meanwhile = Promise.all([session.me(), session.personas(), session.signedIn(), session.signOut(), session.available()]);
    await settle();
    assert.deepEqual((await meanwhile).slice(0, 3), [null, null, false]);
    const second = session.signIn();
    await settle();
    open();
    assert.deepEqual(await second, { ok: true });
    assert.equal((await session.me())?.email, 'mira@example.com');
    // Every token the first server gave out (they name it), and everything the second one was sent.
    const words = (r) => [...new URLSearchParams(r.body).values(), r.auth.replace(/^Bearer /, '')];
    assert.ok(sent.filter((r) => r.url.startsWith(ISSUER)).flatMap(words).some((word) => word.startsWith(`refresh-${ISSUER}`)), 'the first server’s refresh token was used');
    assert.ok(sent.some((r) => r.url.startsWith(LOCAL)), 'the second server was asked');
    assert.deepEqual(sent.filter((r) => r.url.startsWith(LOCAL)).flatMap(words).filter((word) => word.includes(ISSUER)), []);
    assert.equal(disk.get(ISSUER)?.issuer, ISSUER, 'the first server’s sign-in is kept for it alone');
    assert.deepEqual(sent.filter((r) => (r.auth || /token=|refresh_token=|code=/.test(r.body)) && r.redirect !== 'error'), []);
  });

  // Chrome ends the worker at each step of signing in, refreshing and signing out; the next worker starts from the
  // disk. `then` is what the next worker finds: signed in or not, and whether the server still takes the grant.
  const TOKEN = META.token_endpoint;
  const REVOKE = META.revocation_endpoint;
  for (const [label, grant, act, dies, after] of [
    ['with the sign-in window open', null, 'signIn', 'launch', { signedIn: false }],
    ['as the code is traded for tokens', null, 'signIn', TOKEN, { signedIn: false }],
    ['as the refresh token is traded', kept(), 'me', TOKEN, { signedIn: true, refreshes: true }],
    ['once the new refresh token is kept', kept(), 'me', `${ISSUER}/extension/v1/me`, { signedIn: true, refreshes: true }],
    ['as the server is told of a sign-out', kept(), 'signOut', REVOKE, { signedIn: false, ended: true }],
    ['before the server is told of a sign-out', kept(), 'signOut', `${ISSUER}/.well-known/oauth-authorization-server`, { signedIn: false, ended: true }],
  ]) {
    it(`starts again from the disk when the worker is ended ${label}`, async () => {
      const h = harness({ grant, gated: false });
      h.state.now = 3_600_000;
      const first = h.boot({ dies: (step) => step === dies });
      void first[act]();
      await settle();
      if (dies === `${ISSUER}/extension/v1/me`) assert.notEqual(h.disk.get(ISSUER).refresh, 'refresh-0', 'the new refresh token is on disk before it is used');
      if (act === 'signOut') assert.equal(await first.signedIn(), false, 'signed out at once, before the server answers');
      const next = h.boot();
      await next.recover();
      await settle();
      assert.equal(await next.signedIn(), after.signedIn);
      if (after.refreshes) assert.equal((await next.me())?.email, 'mira@example.com', 'the next worker refreshes and reads');
      if (after.ended) assert.deepEqual(h.ended.filter((token) => token === 'refresh-0').length > 0, true, 'the server was told to end the grant');
      if (!after.signedIn) assert.equal(h.disk.size, 0, 'and nothing is left on disk');
    });
  }

  it('signs out at once offline, and tells the server on a later start', async () => {
    const h = harness({ grant: kept(), gated: false });
    const offline = h.boot({ dies: () => true });
    await offline.signOut();
    assert.equal(await offline.signedIn(), false);
    assert.deepEqual(h.ended, []);
    await h.boot().recover();
    await settle();
    assert.deepEqual([h.ended, h.disk.size], [['refresh-0'], 0]);
  });

  it('takes a sign-in window back only for the sign-in still waiting', async () => {
    const windows = [];
    const h = harness({ gated: false, launched: (url) => new Promise((resolve) => windows.push(() => resolve(`${REDIRECT}?code=code-0123456789&state=${new URL(url).searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`))) });
    const first = h.session.signIn();
    await settle();
    const second = h.session.signIn();
    await settle();
    windows[0]();
    assert.deepEqual(await first, { ok: false, why: 'pending' });
    assert.equal(h.sent.some((r) => r.url === META.token_endpoint), false, 'its code is never traded');
    windows[1]();
    assert.deepEqual(await second, { ok: true });
  });

  it('keeps nothing from a sign-in that comes back with the wrong state', async () => {
    const { session, sent, disk } = harness({ launched: async () => `${REDIRECT}?code=code-0123456789&state=other&iss=${encodeURIComponent(ISSUER)}` });
    assert.deepEqual(await session.signIn(), { ok: false, why: 'state' });
    assert.equal(sent.some((r) => r.url === META.token_endpoint), false);
    assert.equal(disk.size, 0);
  });
});

// The account worker on a stubbed Chrome: who it answers.
describe('account worker', () => {
  const listeners = [];
  /** The tabs the worker opened, and the side panels. */
  const opened = [];
  const panels = [];
  /** What the toolbar icon was pointed at, in order; and whether Chrome offers the side panel, in order. */
  const toolbar = [];
  const offered = [];
  const session = {};
  const local = {};
  const area = (kept) => ({ async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } });
  const none = { addListener() {} };
  /** The alarms kept, the notices shown, and the worker's alarm and notice-button listeners. */
  const alarms = new Map();
  const notices = [];
  const heard = { alarm: [], button: [] };
  globalThis.chrome = {
    alarms: { onAlarm: { addListener: (listener) => heard.alarm.push(listener) }, async get(name) { return alarms.get(name); }, async create(name, info) { alarms.set(name, info); }, async clear(name) { alarms.delete(name); } },
    notifications: { onButtonClicked: { addListener: (listener) => heard.button.push(listener) }, onClicked: none, async create(id, options) { notices.push({ id, ...options }); }, async clear() {} },
    runtime: {
      id: 'ext', getURL: (file) => `chrome-extension://ext/${file}`, getManifest: () => ({ action: { default_popup: 'popup/popup.html' } }), onMessage: { addListener: (listener) => listeners.push(listener) }, onConnect: none,
      async sendMessage() {},
    },
    storage: { local: area(local), session: area(session), sync: { async get(defaults) { return defaults; } } },
    tabs: { onCreated: none, onUpdated: none, onRemoved: none, onReplaced: none, async create(tab) { opened.push(tab); }, async get(id) { return { id, index: 0, windowId: 1, url: id === 9 ? 'chrome://settings/' : 'https://news.example.com/' }; } },
    debugger: { onEvent: none, onDetach: none },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {}, async setPopup({ popup }) { toolbar.push({ popup }); } },
    sidePanel: { async open(where) { panels.push(where); }, async setPanelBehavior({ openPanelOnActionClick }) { toolbar.push({ openPanelOnActionClick }); }, async setOptions({ enabled }) { offered.push(enabled); } },
    identity: { getRedirectURL: (path) => `https://ext.chromiumapp.org/${path}`, async launchWebAuthFlow() { return ''; } },
  };
  // The worker's start asks the server whether sign-in is on offer: told no here, before any test, so its start never
  // checks in on a later test's server (nor reaches a real one).
  let probed;
  const started = new Promise((resolve) => { probed = resolve; });
  globalThis.fetch = async (url) => { if (String(url).endsWith('/me?probe=1')) probed(); return json(404, {}); };
  const loaded = import('../extension/account/worker.js').then(() => started);
  const ask = (message, sender) => new Promise((resolve) => { for (const listener of listeners) listener(message, sender, resolve); });

  const fromPanel = { id: 'ext', url: 'chrome-extension://ext/walks/panel/panel.html' };
  // The popup and the side panel may ask; a page or another extension may not.
  for (const [label, sender, asks] of [
    ['a page', { id: 'ext', url: 'https://example.com/', tab: { id: 1 } }, ['status', 'sign-in', 'get-pro', 'create', 'remove', 'walk']],
    ['another extension', { id: 'other', url: 'chrome-extension://other/popup/popup.html' }, ['status', 'sign-in', 'get-pro', 'create', 'remove', 'walk']],
  ]) {
    it(`refuses ${label}`, async () => {
      await loaded;
      for (const account of asks) assert.deepEqual(await ask({ account, description: 'A night-shift nurse.', slug: 'ada', tabId: 7 }, sender), { ok: false, why: 'sender' });
      assert.equal(panels.length, 0, 'no side panel opens for anyone but the popup');
    });
  }

  it('tells the popup sign-in is off when the server answers 404, and nothing else', async () => {
    await loaded;
    globalThis.fetch = async () => json(404, {});
    for (const sender of [{ id: 'ext', url: 'chrome-extension://ext/popup/popup.html' }, fromPanel]) {
      const answer = await ask({ account: 'status' }, sender);
      assert.equal(answer.ok, true);
      assert.equal(answer.available, false);
    }
  });

  const fromPopup = { id: 'ext', url: 'chrome-extension://ext/popup/popup.html' };
  // "Walk this tab", against a stand-in account server that speaks the start door, signed in on a stand-in disk.
  const records = new Map([[ISSUER, kept(ISSUER, 'refresh-walk')]]);
  globalThis.indexedDB = fakeIndexedDB(records);
  const HANDOFF = { v: 1, outing: 'o9', socket: 'wss://impeccable.reviews/api/outings/o9/socket', ticket: 'ticket-0123456789', persona: { name: 'Ines', role: '' }, errand: { name: '', goal: 'Read the top story.', doneWhen: [] }, url: 'https://news.example.com/', allow: [] };
  const posted = [];
  const cancelled = [];
  const made = [];
  const startServer = (walks, mine = () => json(404, {})) => {
    globalThis.fetch = async (url, init = {}) => {
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
      if (url === META.token_endpoint) return json(200, { token_type: 'Bearer', access_token: 'access-walk', refresh_token: 'refresh-walk-2', expires_in: 900 });
      if (url.endsWith('/cancel') && url.startsWith(`${ISSUER}/extension/v1/walks/`)) { cancelled.push([url.slice(ISSUER.length), init.method]); return json(204, null); }
      if (url === `${ISSUER}/extension/v1/walks?can=hears`) { posted.push({ body: JSON.parse(init.body), auth: init.headers.authorization, method: init.method }); return walks(); }
      if (url === `${ISSUER}/extension/v1/personas?can=hears` && !init.method) return json(200, { personas: [{ ...PERSONA, role: 1 }] });
      if (url.startsWith(`${ISSUER}/extension/v1/personas`) && init.method) { made.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return mine(); }
      return json(404, {});
    };
  };
  it('checks in on the alarm, shows each journey an agent asked for once, opens only our outing page on Start, and tells the server Not now until it hears', async () => {
    await loaded;
    const page = 'https://app.impeccable.style/app/acme/outings/o7';
    const journeys = [
      { id: 'o7', page, persona: 'Dana', site: 'shop.example.com', task: 'Buy a mug.', at: '2026-11-14T10:00:00Z' },
      { id: 'o8', page: 'https://evil.example.com/app/acme/outings/o8', persona: 'Eve', site: 'evil.example.com', task: 'Sign up.', at: '2026-11-14T10:00:00Z' },
    ];
    const asked = [];
    let down = false;
    globalThis.fetch = async (url, init = {}) => {
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
      if (url === META.token_endpoint) return json(200, { token_type: 'Bearer', access_token: 'access-in', refresh_token: 'refresh-walk', expires_in: 900 });
      if (url.startsWith(`${ISSUER}/extension/v1/me`)) return json(init.headers?.authorization ? 200 : 401, { email: 'mira@example.com', pro: true });
      if (url.startsWith(`${ISSUER}/extension/v1/waiting`)) { asked.push([url.slice(ISSUER.length), init.method ?? 'GET', init.headers.authorization]); return init.method ? json(down ? 503 : 204, null) : json(200, { journeys }); }
      return json(404, {});
    };
    // Signed in with Pro: the alarm is kept, every half minute.
    await ask({ account: 'status' }, fromPopup);
    assert.deepEqual(alarms.get('check-in'), { periodInMinutes: 0.5 });
    const tick = () => Promise.all(heard.alarm.map((listener) => listener({ name: 'check-in' }))).then(settle);
    await tick();
    await tick();
    const GET = ['/extension/v1/waiting', 'GET', 'Bearer access-in'];
    const no = (id) => [`/extension/v1/waiting/${id}/decline`, 'POST', 'Bearer access-in'];
    // Twice asked, one notice: never the page that isn't ours, which the server is told No for, so no agent waits on it.
    assert.deepEqual(asked, [GET, no('o8'), GET]);
    assert.deepEqual(notices.map(({ id, buttons }) => [id, buttons.length]), [['journey:o7', 2]]);
    assert.match(notices[0].message, /Dana.*shop\.example\.com.*Buy a mug\./);
    const press = (id, button) => Promise.all(heard.button.map((listener) => listener(id, button))).then(settle);
    await press('journey:o8', 0);
    await press('journey:o7', 0);
    assert.deepEqual(opened.slice(-1), [{ url: page, active: true }]);
    assert.equal(opened.filter((tab) => tab.url.includes('evil')).length, 0);
    // A Not now the server doesn't hear is told again at the next check-in, and only until it hears.
    down = true;
    await press('journey:o7', 1);
    down = false;
    await tick();
    await tick();
    assert.deepEqual(asked.slice(3), [no('o7'), GET, no('o7'), GET]);
    assert.equal(notices.length, 1);
  });

  // Before any walk (a walk under way keeps the icon on its panel too). Chrome offers no side panel to an account without Pro.
  it('reads History for the side panel: the server’s rows, and never one whose link is off our app, counting the dropped once', async () => {
    await loaded;
    const warned = [];
    const { warn } = console;
    console.warn = (...args) => warned.push(args);
    const row = (id, url) => ({ id, task: 'Buy a mug.', persona: { name: 'Dana' }, at: 1, outcome: 'issues', issues: 2, url });
    globalThis.fetch = async (url) => {
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
      if (url === META.token_endpoint) return json(200, { token_type: 'Bearer', access_token: 'access-history', refresh_token: 'refresh-walk', expires_in: 900 });
      if (url === `${ISSUER}/extension/v1/journeys`) return json(200, { ok: true, journeys: [row('o7', 'https://app.impeccable.style/app/acme/outings/o7'), row('o8', 'https://evil.example.com/app/acme/outings/o8')] });
      return json(404, {});
    };
    const answer = await ask({ account: 'journeys' }, fromPanel);
    await ask({ account: 'journeys' }, fromPanel);
    console.warn = warn;
    assert.deepEqual([answer.ok, answer.journeys.map((j) => [j.id, j.outcome, j.issues, j.url])], [true, [['o7', 'issues', 2, 'https://app.impeccable.style/app/acme/outings/o7']]]);
    // Said once however often asked: the list and the count, never the row's id or link.
    assert.deepEqual([warned.length, warned[0]?.slice(1), /o8|evil/.test(JSON.stringify(warned))], [1, ['journeys', 1], false]);
  });
  // The side panel is the whole extension in Chrome (the decider, 18 Nov): the icon opens it signed in or out, with Pro
  // or without, during a walk and after, and nothing points it at a popup.
  it('opens the side panel from the toolbar icon whatever the account, never a popup', async () => {
    await loaded;
    startServer(() => json(404, {}));
    await ask({ account: 'status' }, fromPopup);
    const served = globalThis.fetch;
    for (const said of [{ pro: false }, {}]) {
      globalThis.fetch = async (url, init = {}) => (url.startsWith(`${ISSUER}/extension/v1/me`) ? json(init.headers?.authorization ? 200 : 401, { email: 'mira@example.com', ...said }) : served(url, init));
      assert.equal((await ask({ account: 'status' }, fromPopup)).pro, false, JSON.stringify(said));
    }
    const { dispatch } = await import('../extension/walks/store.js');
    dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
    dispatch({ type: 'stop' });
    globalThis.fetch = served;
    await ask({ account: 'status' }, fromPopup);
    await ask({ account: 'sign-out' }, fromPopup);
    assert.deepEqual(toolbar.filter((step) => 'popup' in step), []);
    assert.deepEqual([toolbar.filter((step) => 'openPanelOnActionClick' in step).map((step) => step.openPanelOnActionClick), offered.filter((on) => on === false)], [[true], []]);
    records.set(ISSUER, kept(ISSUER, 'refresh-walk'));
  });

  const start = (tabId = 7) => ask({ account: 'walk', persona: { preset: 'ines' }, task: ' Read the top story. ', tabId }, fromPopup);

  for (const [label, walks, answer, cancels = false] of [
    ['hands the server’s block and the tab to the walk, and nothing of the sign-in', () => json(201, { handoff: HANDOFF }), { ok: true, panel: true }],
    ['says walks are not there yet when the door answers 404', () => json(404, {}), { ok: false, why: 'unavailable' }],
    ['asks to sign in again for a grant made before walks', () => json(403, { error: 'insufficient_scope' }), { ok: false, why: 'scope' }],
    ['says the account has no Pro when the server refuses it', () => json(403, { error: 'not-pro' }), { ok: false, why: 'not-pro' }],
    ['says too many when the server caps the person’s journeys', () => json(429, { error: 'too-many' }), { ok: false, why: 'too-many' }],
    // Refused after the server made the outing: called off at once, so it does not block the next start for two minutes.
    ['hands nothing over for a socket off the server’s pair, and calls the outing off', () => json(201, { handoff: { ...HANDOFF, socket: 'wss://example.com/api/outings/o9/socket' } }), { ok: false, why: 'failed' }, true],
    ['hands nothing over for a block of another site than the tab’s, and calls the outing off', () => json(201, { handoff: { ...HANDOFF, url: 'https://other.example.com/' } }), { ok: false, why: 'failed' }, true],
  ]) {
    it(`walks the person’s tab: ${label}`, async () => {
      await loaded;
      startServer(walks);
      delete session.handoff;
      (await import('../extension/walks/store.js')).dispatch({ type: 'stop' });
      const before = cancelled.length;
      assert.deepEqual(await start(), answer);
      await settle();
      assert.deepEqual(cancelled.slice(before), cancels ? [['/extension/v1/walks/o9/cancel', 'POST']] : []);
      assert.deepEqual(posted.at(-1), { body: { persona: { preset: 'ines' }, task: 'Read the top story.', url: 'https://news.example.com/' }, auth: 'Bearer access-walk', method: 'POST' });
      assert.deepEqual(panels.at(-1), { tabId: 7 });
      assert.deepEqual(session.handoff ? [session.handoff.outing, session.handoff.adopt] : null, answer.ok ? ['o9', 7] : null);
      assert.equal(JSON.stringify(session.handoff ?? {}).includes('access-walk') || JSON.stringify(session.handoff ?? {}).includes('refresh-walk'), false, 'no token ever reaches the walk');
    });
  }

  it('starts no walk on a tab that is not a web page', async () => {
    await loaded;
    startServer(() => json(201, { handoff: HANDOFF }));
    const sent = posted.length;
    assert.deepEqual(await start(9), { ok: false, why: 'tab' });
    assert.equal(posted.length, sent, 'the server is not asked');
  });

  // The hand-off would be refused: an outing made then would wait two minutes for nothing, and block the next start.
  it('starts no walk while another is under way: the server is not asked', async () => {
    await loaded;
    startServer(() => json(201, { handoff: HANDOFF }));
    const { dispatch } = await import('../extension/walks/store.js');
    dispatch({ type: 'stop' });
    dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
    const sent = posted.length;
    assert.deepEqual(await start(), { ok: false, why: 'failed' });
    assert.equal(posted.length, sent);
    dispatch({ type: 'stop' });
  });

  for (const [label, persona] of [['one of the person’s own personas as `mine`, never `own`', { mine: 'night-nurse' }], ['a default persona, which has no app', { own: 'default:robert' }]]) {
    it(`starts a walk with ${label}`, async () => {
      await loaded;
      startServer(() => json(201, { handoff: HANDOFF }));
      (await import('../extension/walks/store.js')).dispatch({ type: 'stop' });
      const sent = posted.length;
      await ask({ account: 'walk', persona, task: 'Read the top story.', tabId: 7 }, fromPopup);
      assert.deepEqual(posted.slice(sent).map((p) => p.body.persona), [persona]);
    });
  }

  // The width picked goes to the server only where its /me says it takes one (`widths`); the walk runs at it either way.
  // Likewise an app persona's app beside its slug (`ownApp`), as slugs repeat across apps.
  const TIDY = { workspace: 'acme', repo: 'tidy', app: 'web' };
  for (const [label, widths, device] of [['a server that takes widths and apps', true, 'mobile'], ['an older server, which refuses a key it does not know', false, undefined]]) {
    it(`starts a walk at Phone width, telling ${label} ${device ? 'the device and the app' : 'nothing of them'}`, async () => {
      await loaded;
      startServer(() => json(201, { handoff: HANDOFF }));
      const served = globalThis.fetch;
      globalThis.fetch = async (url, init = {}) => (url === `${ISSUER}/extension/v1/me` ? json(200, { email: 'mira@example.com', pro: true, ...(widths ? { widths, ownApp: true } : {}) }) : served(url, init));
      delete session.handoff;
      // The walks before this one are still waiting for their tab: ended, so this one may start.
      (await import('../extension/walks/store.js')).dispatch({ type: 'stop' });
      assert.deepEqual(await ask({ account: 'walk', persona: { own: 'mira', app: TIDY }, task: 'Read the top story.', tabId: 7, device: 'phone', sees: 'older' }, fromPopup), { ok: true, panel: true });
      assert.deepEqual([posted.at(-1).body.device, posted.at(-1).body.persona], [device, widths ? { own: 'mira', app: TIDY } : { own: 'mira' }]);
      // How the persona sees goes with this journey alone (sight.js), and never to the server.
      assert.deepEqual([session.handoff.device, session.handoff.sees, 'sees' in posted.at(-1).body], ['phone', 'older', false]);
    });
  }

  // When /me can't be read, the last answer this server gave on widths stands; with none ever, the walk runs at Desktop and its plan says so.
  for (const [label, kept, width] of [['its last answer, kept', true, 'phone'], ['no answer ever', undefined, 'desktop']]) {
    it(`plans and starts a Phone walk when the server can't be asked about widths: ${label}`, async () => {
      await loaded;
      startServer(() => json(201, { handoff: HANDOFF }));
      const served = globalThis.fetch;
      globalThis.fetch = async (url, init = {}) => {
        if (url === `${ISSUER}/extension/v1/me`) return json(503, {});
        if (url === `${ISSUER}/extension/v1/walks/plan?can=hears`) return json(200, { plan: { id: 'plan_0123456789abcdef', steps: [{ text: 'Read it', risky: false }] } });
        return served(url, init);
      };
      await chrome.storage.local.remove(`widths:${ISSUER}`);
      if (kept !== undefined) await chrome.storage.local.set({ [`widths:${ISSUER}`]: kept });
      const planned = await ask({ account: 'plan', persona: { preset: 'ines' }, task: 'Read the top story.', tabId: 7, device: 'phone' }, fromPopup);
      assert.equal(planned.width, width, JSON.stringify(planned));
      delete session.handoff;
      (await import('../extension/walks/store.js')).dispatch({ type: 'stop' });
      assert.equal((await ask({ account: 'walk', persona: { preset: 'ines' }, task: 'Read the top story.', tabId: 7, device: 'phone' }, fromPopup)).ok, true);
      assert.deepEqual([posted.at(-1).body.device, session.handoff.device], width === 'phone' ? ['mobile', 'phone'] : [undefined, undefined]);
    });
  }

  // Making a persona: each answer the server gives, as the popup (or the side panel's empty home) hears it.
  const PERSONA = { name: 'Rosa', role: 'A night-shift nurse', slug: 'rosa', mine: true };
  const create = (description, sender = fromPopup) => ask({ account: 'create', description }, sender);
  for (const [status, body, answer, sender] of [
    [201, { persona: PERSONA }, { ok: true, persona: PERSONA }, fromPanel],
    [200, { persona: PERSONA }, { ok: true, persona: PERSONA }],
    [400, { error: 'invalid', field: 'description' }, { ok: false, why: 'short' }],
    [403, { error: 'insufficient_scope' }, { ok: false, why: 'scope' }],
    [404, {}, { ok: false, why: 'unavailable' }],
    [409, { error: 'limit', max: 3 }, { ok: false, why: 'limit', max: 3 }],
    [429, { error: 'quota', retryAt: 0 }, { ok: false, why: 'quota' }],
    [502, { error: 'draft' }, { ok: false, why: 'failed' }],
  ]) {
    it(`creates a persona: a ${status} is ${answer.ok ? 'the persona' : answer.why}`, async () => {
      await loaded;
      startServer(() => json(404, {}), () => json(status, body));
      session.personaCreate = null;
      assert.deepEqual(await create(`  A night-shift nurse, answer ${status}.  `, sender), answer);
      assert.deepEqual(Object.keys(made.at(-1).body), ['description', 'requestId']);
      assert.equal(made.at(-1).body.description, `A night-shift nurse, answer ${status}.`);
    });
  }

  it('sends a retry of the same description with the same request id, and a new one after it was made', async () => {
    await loaded;
    const answers = [json(502, { error: 'draft' }), json(201, { persona: PERSONA }), json(201, { persona: PERSONA })];
    startServer(() => json(404, {}), () => answers.shift());
    session.personaCreate = null;
    const before = made.length;
    assert.equal((await create('A night-shift nurse.')).ok, false);
    assert.equal((await create('A night-shift nurse.')).ok, true);
    await create('A night-shift nurse.');
    const ids = made.slice(before).map((m) => m.body.requestId);
    assert.match(ids[0], /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual([ids[1] === ids[0], ids[2] === ids[0]], [true, false]);
  });

  // The device and disability picked go to the server only where its /me says it takes them (`ownTraits`): an older
  // one refuses a key it does not know, so the persona is made from the words alone.
  for (const [label, ownTraits, sent] of [['a server that takes them', true, { device: 'mobile', disability: 'low-vision' }], ['an older server', undefined, {}]]) {
    it(`creates a persona on Phone with low vision, telling ${label} ${ownTraits ? 'both' : 'neither'}`, async () => {
      await loaded;
      startServer(() => json(404, {}), () => json(201, { persona: PERSONA }));
      const served = globalThis.fetch;
      globalThis.fetch = async (url, init = {}) => (url === `${ISSUER}/extension/v1/me` ? json(200, { email: 'mira@example.com', pro: true, widths: true, ownApp: true, ...(ownTraits ? { ownTraits } : {}) }) : served(url, init));
      session.personaCreate = null;
      const before = made.length;
      await create('A night-shift nurse.');
      assert.equal((await ask({ account: 'create', description: 'A night-shift nurse.', device: 'phone', disability: 'low-vision' }, fromPopup)).ok, true);
      const [plain, picked] = made.slice(before).map((m) => m.body);
      // The same words with a device and disability picked are another persona: a new id.
      const { requestId, description, ...traits } = picked;
      assert.deepEqual([requestId === plain.requestId, description, traits], [false, 'A night-shift nurse.', sent]);
    });
  }

  it('tells the next popup of a persona sent and never answered (the worker ended), and resends it with its request id', async () => {
    await loaded;
    startServer(() => json(404, {}), () => json(201, { persona: PERSONA }));
    session.personaCreate = { description: 'A night-shift nurse.', requestId: 'kept-0123456789', open: true };
    assert.deepEqual(await ask({ account: 'personas' }, fromPopup), { ok: true, personas: [{ ...PERSONA, role: '' }], creating: 'A night-shift nurse.' });
    await create('A night-shift nurse.');
    assert.equal(made.at(-1).body.requestId, 'kept-0123456789');
  });

  // The side panel's home asks for the personas itself, and is told whether signing in again would help.
  for (const [label, personas, token, answer, asked = {}, path = '/extension/v1/personas?can=hears'] of [
    ['lists them', () => json(200, { personas: [PERSONA] }), () => json(200, {}), { ok: true, personas: [PERSONA] }],
    // One of the six everyone has: its `default:` slug, and how it sees, kept for the walk.
    ['lists a default persona', () => json(200, { personas: [{ name: 'Robert', role: '', profile: 'Retired.', slug: 'default:robert', default: true, sees: 'older-eyes' }] }), () => json(200, {}),
      { ok: true, personas: [{ name: 'Robert', role: '', slug: 'default:robert', default: true, sees: 'older-eyes', about: 'Retired.' }] }],
    // A card on a phone or tablet: its screen, kept for the panel's Screen.
    ['lists a default persona on her phone', () => json(200, { personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true, situation: { device: 'mobile', minutes: 3 } }] }), () => json(200, {}),
      { ok: true, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true, device: 'mobile' }] }],
    // The tab's origin alone, never its path: the server answers the personas of the app at that host, or the defaults.
    ['for the tab’s address', () => json(200, { personas: [PERSONA], defaults: true, reason: 'no-app-here' }), () => json(200, {}), { ok: true, personas: [PERSONA] },
      { url: 'https://tidy.example/todos/7?q=milk' }, '/extension/v1/personas?url=https%3A%2F%2Ftidy.example&can=hears'],
    ['for one app', () => json(200, { personas: [PERSONA] }), () => json(200, {}), { ok: true, personas: [PERSONA] },
      { app: { workspace: 'acme', repo: 'tidy', app: 'web' } }, '/extension/v1/personas?workspace=acme&repo=tidy&app=web&can=hears'],
    ['says try again when the server fails', () => json(500, {}), () => json(200, {}), { ok: false, why: 'personas' }],
    ['says sign in again when the server ended the sign-in', () => json(401, {}), () => json(400, { error: 'invalid_grant' }), { ok: false, why: 'signed-out' }],
  ]) {
    it(`answers the side panel’s personas: ${label}`, async () => {
      await loaded;
      session.personaCreate = null;
      globalThis.fetch = async (url) => {
        if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
        if (url === META.token_endpoint) return token();
        return url === `${ISSUER}${path}` ? personas() : json(404, {});
      };
      assert.deepEqual(await ask({ account: 'personas', ...asked }, fromPanel), answer);
      records.set(ISSUER, kept(ISSUER, 'refresh-walk'));
    });
  }

  // The server's face link answers only with the bearer, so the panel gets the picture itself; a link off the door never sees the token.
  it('hands the side panel each listed face as a picture fetched with the bearer, and sends no token off the door', async () => {
    await loaded;
    session.personaCreate = null;
    const door = `${ISSUER}/extension/v1/faces?link=a.b`, away = 'https://elsewhere.example/extension/v1/faces?link=a.b';
    const asked = [];
    globalThis.fetch = async (url, init = {}) => {
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
      if (url === META.token_endpoint) return json(200, { token_type: 'Bearer', access_token: 'access-face', refresh_token: 'refresh-walk', expires_in: 900 });
      if (url === `${ISSUER}/extension/v1/personas?can=hears`) return json(200, { personas: ['Maya', 'Sam', 'Grace'].map((name, i) => ({ name, role: '', slug: `default:${name.toLowerCase()}`, default: true, face: { src: [door, away, `${door}x`][i], crop: { x: 0.17, y: 0.2, zoom: 3.6 } } })) });
      asked.push(url);
      return url === door && init.headers?.authorization?.startsWith('Bearer ') ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }) : new Response(null, { status: 404 });
    };
    const answer = await ask({ account: 'personas' }, fromPanel);
    assert.deepEqual(answer.personas.map((p) => p.face ?? null), ['data:image/jpeg;base64,AQID', null, null]);
    assert.equal(asked.includes(away), false);
    records.set(ISSUER, kept(ISSUER, 'refresh-walk'));
  });

  // The panel waiting for a new persona's photo asks again every few seconds: one face a round, not every one.
  it('fetches only the faces of the person’s own personas the side panel says are still faceless', async () => {
    await loaded;
    session.personaCreate = null;
    const asked = [];
    globalThis.fetch = async (url) => {
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(200, META);
      if (url === META.token_endpoint) return json(200, { token_type: 'Bearer', access_token: 'access-face', refresh_token: 'refresh-walk', expires_in: 900 });
      if (url === `${ISSUER}/extension/v1/personas?can=hears`) {
        return json(200, { personas: [['Nora', 'nora', true], ['Ada', 'ada', true], ['Maya', 'default:maya', false]].map(([name, slug, mine]) => ({ name, role: '', slug, ...(mine ? { mine } : { default: true }), face: { src: `${ISSUER}/extension/v1/faces?link=${name}`, crop: { x: 0, y: 0, zoom: 1 } } })) });
      }
      asked.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    };
    const answer = await ask({ account: 'personas', faceless: ['nora', 'default:maya'] }, fromPanel);
    assert.deepEqual([asked, answer.personas.map((p) => Boolean(p.face))], [[`${ISSUER}/extension/v1/faces?link=Nora`], [true, false, false]]);
    records.set(ISSUER, kept(ISSUER, 'refresh-walk'));
  });

  it('sends nothing for a description under eight characters', async () => {
    await loaded;
    startServer(() => json(404, {}), () => json(201, { persona: PERSONA }));
    const before = made.length;
    assert.deepEqual(await create(' Nurse '), { ok: false, why: 'short' });
    assert.equal(made.length, before);
  });

  // From the popup or the side panel's Your personas.
  for (const [status, ok, sender] of [[204, true, fromPopup], [404, true, fromPopup], [500, false, fromPopup], [204, true, fromPanel]]) {
    it(`removes one of the person’s own personas: a ${status} is ${ok ? 'done' : 'not'}${sender === fromPanel ? ', asked from the side panel' : ''}`, async () => {
      await loaded;
      startServer(() => json(404, {}), () => json(status, null));
      assert.deepEqual(await ask({ account: 'remove', slug: 'rosa' }, sender), { ok });
      assert.deepEqual(made.at(-1), { url: `${ISSUER}/extension/v1/personas/mine/rosa`, method: 'DELETE', body: null });
    });
  }

  // A sign-in from the extension opens the Pro welcome page; that page's button (welcome.js) opens the side panel on its tab.
  it('opens the Pro welcome page on the server’s website after the first sign-in only, and the side panel when that page alone asks', async () => {
    await loaded;
    startServer(() => json(404, {}));
    chrome.identity.launchWebAuthFlow = async ({ url }) => `${REDIRECT}?${new URLSearchParams({ code: 'code-0123456789', state: new URL(url).searchParams.get('state'), iss: ISSUER })}`;
    const tabs = opened.length;
    for (let n = 0; n < 2; n += 1) assert.equal((await ask({ account: 'sign-in' }, fromPanel)).signedIn, true);
    assert.deepEqual([opened.slice(tabs).map((tab) => tab.url), session.connected], [['https://impeccable.reviews/pro/welcome'], true], 'and the side panel says it is connected');
    const page = { id: 'ext', frameId: 0, url: 'https://impeccable.reviews/pro/welcome', tab: { id: 12, windowId: 3 } };
    const before = panels.length;
    for (const sender of [{ ...page, url: 'https://impeccable.reviews/pricing' }, { ...page, url: 'https://evil.example/pro/welcome' }, { ...page, id: 'other' }, page]) {
      for (const listener of listeners) listener({ panel: 'open' }, sender, () => undefined);
    }
    assert.deepEqual(panels.slice(before), [{ windowId: 3 }]);
  });
});

// The welcome page's script (manifest.json), on a stub page: the mark the page reads, and its button.
describe('agent check-in', () => {
  // A worker Chrome ended and started again: the same session storage and alarms, a new check-in.
  it('never shows a journey twice across a worker started again, and shows a server its own journeys alone', async () => {
    const { checkIns } = await import('../extension/account/waiting.js');
    const kept = {};
    const made = [];
    const notices = [];
    const cleared = [];
    const alarms = new Map();
    const chrome = {
      runtime: { getURL: (file) => `chrome-extension://ext/${file}` },
      storage: { session: { async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } } },
      alarms: { async get(name) { return alarms.get(name); }, async create(name, info) { made.push(name); alarms.set(name, info); }, async clear(name) { alarms.delete(name); } },
      notifications: { async create(id) { notices.push(id); }, async getAll() { return { 'journey:o7': true, other: true }; }, async clear(id) { cleared.push(id); } },
    };
    const session = { async waiting() { return [{ id: 'o7', page: 'https://app.impeccable.style/app/acme/outings/o7', persona: 'Dana', site: 'shop.example.com', task: 'Buy a mug.' }]; } };
    let server = 'https://api.impeccable.style';
    const worker = () => checkIns({ session, chrome, issuer: () => server });
    for (let start = 0; start < 2; start++) {
      const again = worker();
      await again.keep(true);
      await Promise.all([again.checkIn(), again.checkIn({ start: true })]);
    }
    assert.deepEqual(notices, ['journey:o7']);
    assert.deepEqual(made, ['check-in']);
    // Another server, then signed out: each starts from nothing, and only our notices are cleared.
    server = 'http://api.localhost:8787';
    await worker().checkIn();
    await worker().forget();
    await worker().checkIn();
    assert.deepEqual(notices, ['journey:o7', 'journey:o7', 'journey:o7']);
    assert.deepEqual(cleared, ['journey:o7']);
    // The server out of reach leaves the alarm; signed out or no Pro drops it.
    await worker().keep(null);
    assert.equal(alarms.size, 1);
    await worker().keep(false);
    assert.equal(alarms.size, 0);
  });

  // Catches server A's journeys shown, kept as B's and declined to B after a switch mid-check-in.
  for (const [label, after] of [['the person switches server', 'http://api.localhost:8787'], ['the person signs out', null]]) {
    it(`shows and keeps nothing from a check-in still under way when ${label}`, async () => {
      const { checkIns } = await import('../extension/account/waiting.js');
      const kept = {};
      const notices = [];
      const declined = [];
      const chrome = {
        runtime: { getURL: (file) => `chrome-extension://ext/${file}` },
        storage: { session: { async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } } },
        notifications: { async create(id) { notices.push(id); }, async getAll() { return {}; }, async clear() {} },
      };
      let answer;
      const session = {
        waiting: () => new Promise((resolve) => { answer = resolve; }),
        async decline(id) { declined.push(id); return { ok: true }; },
      };
      let server = 'https://api.impeccable.style';
      const agent = checkIns({ session, chrome, issuer: () => server });
      const checking = agent.checkIn();
      await new Promise((resolve) => setImmediate(resolve));
      await agent.forget();
      if (after) server = after;
      answer([{ id: 'o7', page: 'https://app.impeccable.style/app/acme/outings/o7', persona: 'Dana', site: 'shop.example.com', task: 'Buy a mug.' }]);
      await checking;
      assert.deepEqual([notices, declined, kept.agentJourneys], [[], [], undefined]);
    });
  }
});

describe('welcome page', () => {
  it('marks the page as having the extension, and its open-panel button asks the worker instead of following its link', () => {
    const root = { dataset: {} };
    let click;
    const sent = [];
    const document = { documentElement: root, addEventListener: (type, listener) => { if (type === 'click') click = listener; } };
    vm.runInNewContext(readFileSync(new URL('../extension/account/welcome.js', import.meta.url), 'utf8'), { document, chrome: { runtime: { async sendMessage(message) { sent.push(message); } } } });
    assert.equal(root.dataset.impeccableExtension, 'ready');
    const press = (marked) => {
      const event = { prevented: false, preventDefault() { this.prevented = true; }, target: { closest: (selector) => (marked && selector === '[data-impeccable-open-panel]' ? {} : null) } };
      click(event);
      return event.prevented;
    };
    assert.deepEqual([press(false), press(true), JSON.parse(JSON.stringify(sent))], [false, true, [{ panel: 'open' }]]);
  });
});
