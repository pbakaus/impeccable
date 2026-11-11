import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CLIENT_ID, PRODUCTION, authorizeUrl, challengeFor, issuerAllowed, readCallback, readMetadata } from '../extension/account/flow.js';
import { createSession } from '../extension/account/session.js';

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
      [`${at}/extension/v1/me`]: (init) => (init.headers?.authorization ? json(200, { email: 'mira@example.com', name: 'Mira' }) : json(me, {})),
      [`${at}/extension/v1/personas`]: () => json(200, { personas: [] }),
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

describe('account session', () => {
  for (const [label, answer, available] of [['404', 404, false], ['401', 401, true], ['no answer', null, false]]) {
    it(`takes a ${label} from the door asked with no token as sign-in ${available ? 'on offer' : 'off'}`, async () => {
      const { session, sent } = harness({ me: answer ?? 404 });
      if (answer === null) sent.push = () => { throw new TypeError('offline'); };
      assert.equal(await session.available(), available);
    });
  }

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
  globalThis.chrome = {
    runtime: { id: 'ext', getURL: (file) => `chrome-extension://ext/${file}`, getManifest: () => ({}), onMessage: { addListener: (listener) => listeners.push(listener) } },
    storage: { local: { async get() { return {}; }, async set() {} } },
    identity: { getRedirectURL: (path) => `https://ext.chromiumapp.org/${path}`, async launchWebAuthFlow() { return ''; } },
  };
  const loaded = import('../extension/account/worker.js');
  const ask = (message, sender) => new Promise((resolve) => { for (const listener of listeners) listener(message, sender, resolve); });

  for (const [label, sender] of [
    ['a page', { id: 'ext', url: 'https://example.com/', tab: { id: 1 } }],
    ['the walk side panel', { id: 'ext', url: 'chrome-extension://ext/walks/panel/panel.html' }],
    ['another extension', { id: 'other', url: 'chrome-extension://other/popup/popup.html' }],
  ]) {
    it(`refuses ${label}`, async () => {
      await loaded;
      assert.deepEqual(await ask({ account: 'status' }, sender), { ok: false, why: 'sender' });
    });
  }

  it('tells the popup sign-in is off when the server answers 404, and nothing else', async () => {
    await loaded;
    globalThis.fetch = async () => json(404, {});
    const answer = await ask({ account: 'status' }, { id: 'ext', url: 'chrome-extension://ext/popup/popup.html' });
    assert.equal(answer.ok, true);
    assert.equal(answer.available, false);
  });
});
