// The extension's one signed-in session, kept by the background worker alone.
//
//   - The refresh token outlives a browser restart, so it is kept on disk: in this extension's own IndexedDB, which
//     no page and no content script can open, and which only the worker writes. Never in chrome.storage, which
//     content scripts can read.
//   - The access token lives in the worker's memory only, and is fetched again when it runs out or the worker starts.
//   - One refresh at a time: the server rotates refresh tokens and revokes the grant when one is used twice.
//   - Signing out ends the grant on the server, then forgets it here.
// Nothing here hands a token to anyone: worker.js answers the popup with facts (signed in, the email), never tokens.
import {
  CLIENT_ID, authorizeUrl, challengeFor, codeBody, metadataUrl, randomText, readCallback, readMetadata, readTokens, refreshBody, resourceFor, revokeBody,
} from './flow.js';

/** The refresh tokens' place on disk: one record per account server, by its exact origin, in this extension's IndexedDB. */
export function idbStore(name = 'impeccable-account') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('grant');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, act) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const req = act(db.transaction('grant', mode).objectStore('grant'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: async (key) => (await run('readonly', (s) => s.get(key))) ?? null,
    set: (key, record) => run('readwrite', (s) => s.put(record, key)),
    clear: (key) => run('readwrite', (s) => s.delete(key)),
  };
}

const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
/** Every request that carries a token goes where it was sent or nowhere: a redirect is an error, never followed. */
const sealed = { credentials: 'omit', redirect: 'error' };

/**
 * A session against the server `issuer()` names. `fetch` and `store` are the network and the disk; `launch` opens
 * the sign-in window and resolves to the address it came back on.
 *
 * Every kept sign-in is tied to the server it was made with: its record names that issuer, the resource its tokens
 * are for and this extension's client id, and is kept under that issuer's exact origin. Refreshing and signing out
 * only ever go to the recorded issuer. Each call reads the server in use once, at its start, and works for that server
 * alone; one that finds the server changed under it when an answer comes back hands nothing on.
 */
export function createSession({ fetch, store, issuer, launch, redirectUri, now = () => Date.now() }) {
  /** The access token, in memory only: `{ token, until, issuer }`. */
  let access = null;
  /** The refresh under way for each issuer: a second caller for the same one waits for the first. */
  const refreshing = new Map();
  const doors = new Map();

  async function server(at) {
    if (!doors.has(at)) {
      const answer = await fetch(metadataUrl(at), { headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error' });
      const read = answer.ok ? readMetadata(await answer.json().catch(() => null), at) : null;
      if (!read) throw new Error('the account server did not describe itself');
      doors.set(at, read);
    }
    return doors.get(at);
  }

  /** The grant kept for `at`, if it is whole and its own. */
  const kept = async (at) => {
    const grant = await store.get(at);
    return grant?.issuer === at && grant.client === CLIENT_ID && grant.resource === resourceFor(at) && typeof grant.refresh === 'string' ? grant : null;
  };

  const forget = async (at) => { if (access?.issuer === at) access = null; await store.clear(at); };

  /** Trades a code or a refresh token at `at`'s token door; the tokens it ends in are kept for `at` before anything uses them. */
  async function trade(at, body) {
    const { token } = await server(at);
    const answer = await fetch(token, { method: 'POST', headers: form, body, ...sealed });
    const json = await answer.json().catch(() => null);
    if (!answer.ok) return { refused: json?.error === 'invalid_grant' };
    const tokens = readTokens(json);
    if (!tokens) return { refused: false };
    await store.set(at, { issuer: at, resource: resourceFor(at), client: CLIENT_ID, refresh: tokens.refresh });
    access = { token: tokens.access, until: now() + tokens.expiresIn * 1000 - 30_000, issuer: at };
    return { tokens };
  }

  /** Fresh tokens for `at` from its kept refresh token. One at a time for each server. */
  function refresh(at) {
    if (!refreshing.has(at)) {
      refreshing.set(at, (async () => {
        try {
          const grant = await kept(at);
          if (!grant) return null;
          const traded = await trade(at, refreshBody({ refresh: grant.refresh, issuer: at }));
          // The grant ended (revoked, expired, or a refresh token used too often): signed out.
          if (traded.refused) await forget(at);
          return traded.tokens ? traded.tokens.access : null;
        } finally {
          refreshing.delete(at);
        }
      })());
    }
    return refreshing.get(at);
  }

  async function token(at) {
    if (access && access.issuer === at && access.until > now()) return access.token;
    return refresh(at);
  }

  /** A GET on `at`'s extension door with its access token: once more after a refresh if the server says it is stale. */
  async function read(at, path) {
    for (let tries = 0; tries < 2; tries++) {
      const bearer = tries === 0 ? await token(at) : await refresh(at);
      // No token, or one that came back after the server in use changed: nothing is sent anywhere.
      if (!bearer || issuer() !== at) return null;
      const answer = await fetch(`${resourceFor(at)}${path}`, { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, ...sealed });
      if (answer.status === 401) { if (access?.token === bearer) access = null; continue; }
      return answer.ok ? answer.json().catch(() => null) : null;
    }
    return null;
  }

  return {
    /**
     * Whether the server takes extension sign-ins at all: its door asked with no token answers 401. A 404 (the door
     * is off), any other answer, or no answer: no.
     */
    async available() {
      try {
        const answer = await fetch(`${resourceFor(issuer())}/me`, { headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error' });
        return answer.status === 401;
      } catch {
        return false;
      }
    },

    /** Who is signed in: `{ email, name }`, or null. */
    async me() {
      const me = await read(issuer(), '/me');
      return typeof me?.email === 'string' ? { email: me.email, name: typeof me.name === 'string' ? me.name : '' } : null;
    },

    /** The signed-in person's personas: `[{ name, role }]`, or null. */
    async personas() {
      const list = await read(issuer(), '/personas');
      const rows = Array.isArray(list?.personas) ? list.personas : null;
      return rows?.filter((p) => typeof p?.name === 'string').slice(0, 100).map((p) => ({ name: p.name, role: typeof p.role === 'string' ? p.role : '' })) ?? null;
    },

    /** Opens the sign-in window and keeps the grant it ends in. Resolves to whether it did, or why not. */
    async signIn() {
      const at = issuer();
      const { authorize } = await server(at);
      const verifier = randomText();
      const state = randomText();
      const returned = await launch(authorizeUrl({ endpoint: authorize, issuer: at, redirectUri, state, challenge: await challengeFor(verifier) }));
      // The server in use changed while the window was open: this sign-in was for another one, and is dropped.
      if (issuer() !== at) return { ok: false, why: 'server' };
      const back = readCallback(returned, { redirectUri, state, issuer: at });
      if (!back.ok) return back;
      const traded = await trade(at, codeBody({ code: back.code, verifier, redirectUri, issuer: at }));
      return traded.tokens ? { ok: true } : { ok: false, why: 'token' };
    },

    /**
     * Ends the grant on its own server, then forgets it here. Forgotten here even when the server cannot be reached: a
     * person who signed out is signed out of this browser; the grant then lapses on its own or from Connected apps.
     */
    async signOut() {
      const at = issuer();
      const grant = await kept(at);
      if (grant) {
        try {
          const { revoke } = await server(grant.issuer);
          await fetch(revoke, { method: 'POST', headers: form, body: revokeBody({ refresh: grant.refresh }), ...sealed });
        } catch { /* forgotten here all the same */ }
      }
      await forget(at);
    },

    /** Whether a grant is kept for the server in use. */
    async signedIn() { return (await kept(issuer())) !== null; },
  };
}
