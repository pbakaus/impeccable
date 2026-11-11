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

// A session on a stand-in server and disk: every request it sends, in order.
function harness({ grant = null, me = 401, launched } = {}) {
  const sent = [];
  const disk = { grant };
  const gates = [];
  const server = {
    [`${ISSUER}/.well-known/oauth-authorization-server`]: () => json(200, META),
    [META.token_endpoint]: () => new Promise((resolve) => gates.push(() => resolve(json(200, { token_type: 'Bearer', access_token: `access-${sent.length}`, refresh_token: `refresh-${sent.length}`, expires_in: 900 })))),
    [META.revocation_endpoint]: () => json(200, {}),
    [`${ISSUER}/extension/v1/me`]: (init) => (init.headers.authorization ? json(200, { email: 'mira@example.com', name: 'Mira' }) : json(me, {})),
  };
  const fetch = async (url, init = {}) => {
    sent.push({ url, body: init.body ? String(init.body) : '', at: disk.grant ? 'kept' : 'none' });
    if (!server[url]) throw new TypeError('network');
    return server[url](init);
  };
  const store = { get: async () => disk.grant, set: async (value) => { disk.grant = value; }, clear: async () => { disk.grant = null; } };
  const session = createSession({ fetch, store, issuer: () => ISSUER, redirectUri: REDIRECT, launch: launched ?? (async () => REDIRECT) });
  const open = () => { for (const go of gates.splice(0)) go(); };
  return { session, sent, disk, open };
}

describe('account session', () => {
  for (const [label, answer, available] of [['404', 404, false], ['401', 401, true], ['no answer', null, false]]) {
    it(`takes a ${label} from the door asked with no token as sign-in ${available ? 'on offer' : 'off'}`, async () => {
      const { session, sent } = harness({ me: answer ?? 404 });
      if (answer === null) sent.push = () => { throw new TypeError('offline'); };
      assert.equal(await session.available(), available);
    });
  }

  it('refreshes once for callers that ask at the same time', async () => {
    const { session, sent, open } = harness({ grant: { issuer: ISSUER, refresh: 'refresh-0' } });
    const asked = Promise.all([session.me(), session.me(), session.me()]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open();
    const answers = await asked;
    assert.deepEqual(answers.map((me) => me?.email), ['mira@example.com', 'mira@example.com', 'mira@example.com']);
    assert.equal(sent.filter((r) => r.url === META.token_endpoint).length, 1);
  });

  it('signs out by revoking on the server, then forgetting the grant here', async () => {
    const { session, sent, disk } = harness({ grant: { issuer: ISSUER, refresh: 'refresh-0' } });
    await session.signOut();
    const revoke = sent.find((r) => r.url === META.revocation_endpoint);
    assert.equal(new URLSearchParams(revoke.body).get('token'), 'refresh-0');
    assert.equal(revoke.at, 'kept', 'the grant was still kept when the server was asked to end it');
    assert.equal(disk.grant, null);
  });

  it('keeps nothing from a sign-in that comes back with the wrong state', async () => {
    const { session, sent, disk } = harness({ launched: async (url) => `${REDIRECT}?code=code-0123456789&state=other&iss=${encodeURIComponent(ISSUER)}` });
    assert.deepEqual(await session.signIn(), { ok: false, why: 'state' });
    assert.equal(sent.some((r) => r.url === META.token_endpoint), false);
    assert.equal(disk.grant, null);
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
