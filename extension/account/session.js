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
  authorizeUrl, challengeFor, codeBody, metadataUrl, randomText, readCallback, readMetadata, readTokens, refreshBody, resourceFor, revokeBody,
} from './flow.js';

/** The refresh token's place on disk: one record in this extension's IndexedDB. */
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
    get: async () => (await run('readonly', (s) => s.get('grant'))) ?? null,
    set: (grant) => run('readwrite', (s) => s.put(grant, 'grant')),
    clear: () => run('readwrite', (s) => s.delete('grant')),
  };
}

const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };

/**
 * A session against the server `issuer()` names. `fetch` and `store` are the network and the disk; `launch` opens
 * the sign-in window and resolves to the address it came back on.
 */
export function createSession({ fetch, store, issuer, launch, redirectUri, now = () => Date.now() }) {
  let access = null;
  let refreshing = null;
  const doors = new Map();

  async function server() {
    const at = issuer();
    if (!doors.has(at)) {
      const answer = await fetch(metadataUrl(at), { headers: { accept: 'application/json' }, credentials: 'omit' });
      const read = answer.ok ? readMetadata(await answer.json().catch(() => null), at) : null;
      if (!read) throw new Error('the account server did not describe itself');
      doors.set(at, read);
    }
    return { at, ...doors.get(at) };
  }

  /** The grant kept here, if it is for the server in use. */
  const kept = async () => {
    const grant = await store.get();
    return grant && grant.issuer === issuer() ? grant : null;
  };

  const forget = async () => { access = null; await store.clear(); };

  async function trade(token, body, at) {
    const answer = await fetch(token, { method: 'POST', headers: form, body, credentials: 'omit' });
    const json = await answer.json().catch(() => null);
    if (!answer.ok) return { refused: json?.error === 'invalid_grant' };
    const tokens = readTokens(json);
    if (!tokens) return { refused: false };
    await store.set({ issuer: at, refresh: tokens.refresh });
    access = { token: tokens.access, until: now() + tokens.expiresIn * 1000 - 30_000, issuer: at };
    return { tokens };
  }

  /** Fresh tokens from the kept refresh token. One at a time: a second caller waits for the first. */
  function refresh() {
    refreshing ??= (async () => {
      try {
        const grant = await kept();
        if (!grant) return null;
        const { at, token } = await server();
        const traded = await trade(token, refreshBody({ refresh: grant.refresh, issuer: at }), at);
        // The grant ended (revoked, expired, or a refresh token used twice): signed out.
        if (traded.refused) await forget();
        return traded.tokens ? access.token : null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function token() {
    if (access && access.issuer === issuer() && access.until > now()) return access.token;
    return refresh();
  }

  /** A GET on the extension's door with the access token: once more after a refresh if the server says it is stale. */
  async function read(path) {
    for (let tries = 0; tries < 2; tries++) {
      const bearer = tries === 0 ? await token() : await refresh();
      if (!bearer) return null;
      const answer = await fetch(`${resourceFor(issuer())}${path}`, { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, credentials: 'omit' });
      if (answer.status === 401) { access = null; continue; }
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
        const answer = await fetch(`${resourceFor(issuer())}/me`, { headers: { accept: 'application/json' }, credentials: 'omit' });
        return answer.status === 401;
      } catch {
        return false;
      }
    },

    /** Who is signed in: `{ email, name }`, or null. */
    async me() {
      const me = await read('/me');
      return typeof me?.email === 'string' ? { email: me.email, name: typeof me.name === 'string' ? me.name : '' } : null;
    },

    /** The signed-in person's personas: `[{ name, role }]`, or null. */
    async personas() {
      const list = await read('/personas');
      const rows = Array.isArray(list?.personas) ? list.personas : null;
      return rows?.filter((p) => typeof p?.name === 'string').slice(0, 100).map((p) => ({ name: p.name, role: typeof p.role === 'string' ? p.role : '' })) ?? null;
    },

    /** Opens the sign-in window and keeps the grant it ends in. Resolves to whether it did, or why not. */
    async signIn() {
      const { at, authorize, token } = await server();
      const verifier = randomText();
      const state = randomText();
      const returned = await launch(authorizeUrl({ endpoint: authorize, issuer: at, redirectUri, state, challenge: await challengeFor(verifier) }));
      const back = readCallback(returned, { redirectUri, state, issuer: at });
      if (!back.ok) return back;
      const traded = await trade(token, codeBody({ code: back.code, verifier, redirectUri, issuer: at }), at);
      return traded.tokens ? { ok: true } : { ok: false, why: 'token' };
    },

    /**
     * Ends the grant on the server, then forgets it here. Forgotten here even when the server cannot be reached: a
     * person who signed out is signed out of this browser; the grant then lapses on its own or from Connected apps.
     */
    async signOut() {
      const grant = await kept();
      if (grant) {
        try {
          const { revoke } = await server();
          await fetch(revoke, { method: 'POST', headers: form, body: revokeBody({ refresh: grant.refresh }), credentials: 'omit' });
        } catch { /* forgotten here all the same */ }
      }
      await forget();
    },

    /** Whether a grant is kept for the server in use. */
    async signedIn() { return (await kept()) !== null; },
  };
}
