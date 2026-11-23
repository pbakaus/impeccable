// The extension's one signed-in session, kept by the background worker alone.
//
//   - The refresh token outlives a browser restart, so it is kept on disk: in this extension's own IndexedDB. No
//     content script can open it (a content script has its page's storage, never the extension's), and no website.
//     Every page of this extension could (the popup, the side panel, the DevTools panel, the offscreen document): the
//     boundary is this extension's own code, and only this file opens it. chrome.storage.local could be held to the
//     same pages with `setAccessLevel('TRUSTED_CONTEXTS')`, but content scripts can read it until that call has run;
//     IndexedDB needs no such call.
//   - The access token lives in the worker's memory only, and is fetched again when it runs out or the worker starts.
//   - One refresh at a time for each server: the server rotates refresh tokens on every use.
//   - What it is doing is kept on disk as it does it (see STATES), so a worker Chrome ends at any moment starts again
//     from where it was: a new refresh token is on disk before it is used or anyone hears of it.
//   - Signing out is at once, here; the server is asked to end the grant after, and again until it answers.
// Nothing here hands a token to anyone: worker.js answers the popup with facts (signed in, the email), never tokens.
import {
  CLIENT_ID, authorizeUrl, challengeFor, codeBody, metadataUrl, randomText, readCallback, readMetadata, readTokens, refreshBody, resourceFor, revokeBody,
} from './flow.js';
import { isOutingPage } from '../walks/handoff.js';

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
        const tx = db.transaction('grant', mode);
        const req = act(tx.objectStore('grant'));
        // Done once the transaction commits: a write whose request went through can still be aborted before then.
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error ?? req.error ?? new Error('the account record was not saved'));
        tx.onerror = () => reject(req.error ?? tx.error ?? new Error('the account record was not saved'));
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
 * STATES. Each server's record on disk says where its sign-in is, and is written before each step it names is taken:
 *   - `signing-in`: the sign-in window is open for the `pending` sign-in (its `state` only; the verifier stays in
 *     memory). A worker that starts again finds the window gone with the one before it: signed out.
 *   - `signed-in`: `refresh` is the refresh token.
 *   - `refreshing`: `refresh` is being traded. Started again, it is traded again: the server takes a refresh token
 *     just used once more for a while, so a worker ended between the server's answer and the disk keeps its sign-in.
 *   - `signing-out`: signed out here; the server has yet to hear it. Signed out is no record at all.
 * Beside the state, `retire` holds refresh tokens the server is still to be told to end (a sign-out, or tokens that
 * came back after their sign-in was over): asked on each start and each status, until the server answers.
 */
const SIGNED_IN = ['signed-in', 'refreshing'];
/** A persona's name in the person's own list, as the server gives it. */
const SLUG = /^[a-z0-9-]{1,80}$/;
/** A listed persona's slug: an app's or the person's own, or one of the six everyone has (`default:maya`). */
const LISTED = /^(?:[a-z0-9-]{1,80}|default:[a-z]{1,20})$/;
/** An app as the server lists it (`/apps`): its workspace, repository and app, and its name. */
const APP_PART = /^[A-Za-z0-9._-]{1,100}$/;
/** An app's three keys, or null: each must be a string, as a regex's test reads a missing one as "undefined". */
export const appOf = (p) => (['workspace', 'repo', 'app'].every((key) => typeof p?.[key] === 'string' && APP_PART.test(p[key])) ? { workspace: p.workspace, repo: p.repo, app: p.app } : null);
/**
 * A persona as the server lists it, field by field: `{ name, role, slug?, mine?, default?, app?, sees?, about? }`
 * (`mine`: the person's own, by slug; `default`: one of the six; `app`: the app whose cast it is, as slugs repeat across
 * apps; `sees`: how it sees the page). Its face is fetched apart (`faceOf`).
 */
const personaOf = (p) => ({
  name: p.name, role: typeof p.role === 'string' ? p.role : '',
  ...(LISTED.test(p.slug) ? { slug: p.slug, ...(p.mine === true ? { mine: true } : p.default === true ? { default: true } : appOf(p) ? { app: appOf(p) } : {}) } : {}),
  ...(p.sees === 'older-eyes' || p.sees === 'colour-blind' ? { sees: p.sees } : {}),
  ...(p.situation?.device === 'mobile' || p.situation?.device === 'tablet' ? { device: p.situation.device } : {}),
  ...(typeof (p.profile ?? p.about) === 'string' && (p.profile ?? p.about) ? { about: (p.profile ?? p.about).slice(0, 1500) } : {}),
});
/** A face sheet's small copy, as the server's face door answers it: a picture of at most this many bytes. */
const FACE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FACE_BYTES = 256 * 1024;
/** A waiting journey's id: an outing's, as the hand-off takes it (walks/handoff.js `ID`). */
const WAITING_ID = /^[A-Za-z0-9_-]{1,80}$/;
/** How a journey in History ended, as the server says it. */
const OUTCOMES = ['issues', 'done', 'stopped', 'failed', 'running'];
/** A plan's id: a signed string the server reads back, bound to the persona, task and site it was made for. */
export const PLAN_ID = /^[A-Za-z0-9._~+/=-]{1,4096}$/;
/** A plan as the server answers it: `{ id, steps: [{ text, risky }], risky }`, or null. */
function planOf(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps.filter((s) => typeof s?.text === 'string' && s.text.trim()).slice(0, 12).map((s) => ({ text: s.text.slice(0, 200), risky: s.risky === true })) : [];
  if (typeof plan?.id !== 'string' || !PLAN_ID.test(plan.id) || steps.length === 0) return null;
  return { id: plan.id, steps, risky: plan.risky === true || steps.some((s) => s.risky) };
}
/** Why creating a persona did not happen, by the server's answer. */
const CREATE_WHY = { 404: 'unavailable', 409: 'limit', 429: 'quota' };
/** The server's refusal of a person whose account has no Impeccable Pro: it decides on every request, never this code. */
const notPro = (answer) => answer?.status === 403 && answer.json?.error === 'not-pro';

/**
 * A session against the server `issuer()` names. `fetch` and `store` are the network and the disk; `launch` opens
 * the sign-in window and resolves to the address it came back on.
 *
 * Every kept sign-in is tied to the server it was made with: its record names that issuer, the resource its tokens
 * are for and this extension's client id, and is kept under that issuer's exact origin. Refreshing and signing out
 * only ever go to the recorded issuer. Each call reads the server in use once, at its start, and works for that server
 * alone; one that finds the server changed under it when an answer comes back hands nothing on.
 */
export function createSession({ fetch, store, issuer, launch, redirectUri, now = () => Date.now(), warn = (...args) => console.warn(...args) }) {
  /** The access token, in memory only: `{ token, until, issuer }`. */
  let access = null;
  /** The refresh under way for each issuer: a second caller for the same one waits for the first. */
  const refreshing = new Map();
  const doors = new Map();
  /** Each server's record is changed one change at a time, so no change is lost to another. */
  const queues = new Map();

  async function server(at) {
    if (!doors.has(at)) {
      const answer = await fetch(metadataUrl(at), { headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error' });
      const read = answer.ok ? readMetadata(await answer.json().catch(() => null), at) : null;
      if (!read) throw new Error('the account server did not describe itself');
      doors.set(at, read);
    }
    return doors.get(at);
  }

  /** `at`'s record, if it is whole and its own. */
  const record = async (at) => {
    const kept = await store.get(at);
    return kept?.issuer === at && kept.client === CLIENT_ID && kept.resource === resourceFor(at) ? { retire: [], ...kept } : null;
  };

  /** Changes `at`'s record: `change` gets it (or null) and answers the next one, or null for none. Resolves to it. */
  function edit(at, change) {
    const done = (queues.get(at) ?? Promise.resolve()).then(async () => {
      let next = change(await record(at));
      // Signed out with something still to end is signing out; with nothing, no record at all.
      if (next && ['signed-out', 'signing-out'].includes(next.state)) next = next.retire.length ? { state: 'signing-out', retire: next.retire } : null;
      if (next) {
        const kept = { ...next, issuer: at, resource: resourceFor(at), client: CLIENT_ID };
        await store.set(at, kept);
        return kept;
      }
      await store.clear(at);
      return null;
    });
    queues.set(at, done.catch(() => undefined));
    return done;
  }
  /** The record moved to `state`, keeping what it must still tell the server; `extra` fields beside it. */
  const to = (state, extra = {}) => (was) => ({ state, retire: was?.retire ?? [], ...extra });

  /** The grant kept for `at`, if signed in. */
  const grantOf = async (at) => {
    const kept = await record(at);
    return kept && SIGNED_IN.includes(kept.state) && typeof kept.refresh === 'string' ? kept : null;
  };

  /** Sends `body` to `at`'s token door: `{ tokens }`, or `{ refused }` when the server ended the grant. */
  async function trade(at, body) {
    const { token } = await server(at);
    const answer = await fetch(token, { method: 'POST', headers: form, body, ...sealed });
    const json = await answer.json().catch(() => null);
    if (!answer.ok) return { refused: json?.error === 'invalid_grant' };
    const tokens = readTokens(json);
    return tokens ? { tokens } : { refused: false };
  }

  /**
   * Keeps the tokens a trade for `at` came back with, if the sign-in they are for (`expected`, the state it was in)
   * is still the one on disk; else they are only kept to be ended. The new refresh token is on disk before anyone
   * uses the access token.
   */
  async function keep(at, expected, tokens) {
    let current = false;
    await edit(at, (was) => {
      current = was?.state === expected;
      return current ? { state: 'signed-in', retire: was.retire, refresh: tokens.refresh } : { ...(was ?? { state: 'signed-out' }), retire: [...(was?.retire ?? []), tokens.refresh] };
    });
    if (!current) { void retire(at); return false; }
    access = { token: tokens.access, until: now() + tokens.expiresIn * 1000 - 30_000, issuer: at };
    return true;
  }

  /** Fresh tokens for `at` from its kept refresh token. One at a time for each server. */
  function refresh(at) {
    if (!refreshing.has(at)) {
      refreshing.set(at, (async () => {
        try {
          const grant = await grantOf(at);
          if (!grant) return null;
          await edit(at, (was) => (was?.refresh === grant.refresh && SIGNED_IN.includes(was.state) ? { ...was, state: 'refreshing' } : was));
          const traded = await trade(at, refreshBody({ refresh: grant.refresh, issuer: at }));
          // The grant ended (revoked, expired, or a refresh token used too often): signed out.
          if (traded.refused) await edit(at, (was) => (was?.refresh === grant.refresh ? to('signed-out')(was) : was));
          if (!traded.tokens) return null;
          return (await keep(at, 'refreshing', traded.tokens)) ? traded.tokens.access : null;
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

  /**
   * A request to `at`'s extension door with its access token (a GET, `body` posted as JSON, or `method`): once more
   * after a refresh if the server says it is stale. Resolves to `{ status, json }`, or null when nothing could be sent.
   */
  async function call(at, path, body, method = body ? 'POST' : undefined) {
    for (let tries = 0; tries < 2; tries++) {
      const bearer = tries === 0 ? await token(at) : await refresh(at);
      // No token, or one that came back after the server in use changed: nothing is sent anywhere.
      if (!bearer || issuer() !== at) return null;
      const headers = { authorization: `Bearer ${bearer}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) };
      const answer = await fetch(`${resourceFor(at)}${path}`, { headers, ...(method ? { method } : {}), ...(body ? { body: JSON.stringify(body) } : {}), ...sealed });
      if (answer.status === 401) { if (access?.token === bearer) access = null; continue; }
      return { status: answer.status, json: await answer.json().catch(() => null) };
    }
    return null;
  }
  const read = async (at, path) => { const answer = await call(at, path); return answer && answer.status >= 200 && answer.status < 300 ? answer.json : null; };

  /** The lists whose dropped rows were said: once each for this worker, as the check-in reads `waiting` every half minute. */
  const warned = new Set();
  /**
   * `list[key]`'s rows that `keep` reads, or null when there is no list. Rows it can't read (the server's answer moved
   * on from this build) are counted and said once: the list's `name` and the count, never an id or a link.
   */
  function rowsOf(list, key, keep, name = key) {
    const all = Array.isArray(list?.[key]) ? list[key] : null;
    const rows = all?.filter(keep) ?? null;
    if (rows && rows.length < all.length && !warned.has(name)) { warned.add(name); warn('account rows dropped', name, all.length - rows.length); }
    return rows;
  }

  /**
   * A listed persona's face (`face: { src, crop }`) as a `data:` address the panel can paint: `src` is a short-lived
   * link on `at`'s own face door that answers only with the bearer, so a CSS `url()` could never load it. A link
   * anywhere else is never sent the token. Anything that goes wrong: null, and the panel shows the initial.
   */
  async function faceOf(at, face) {
    const src = face?.src;
    if (typeof src !== 'string' || src.length > 4096 || !src.startsWith(`${resourceFor(at)}/faces?link=`)) return null;
    try {
      const bearer = await token(at);
      if (!bearer || issuer() !== at) return null;
      const answer = await fetch(src, { headers: { authorization: `Bearer ${bearer}`, accept: FACE_TYPES.join(', ') }, ...sealed });
      const type = answer.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!answer.ok || !FACE_TYPES.includes(type) || Number(answer.headers.get('content-length') ?? 0) > FACE_BYTES) return null;
      const bytes = new Uint8Array(await answer.arrayBuffer());
      if (bytes.length === 0 || bytes.length > FACE_BYTES) return null;
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${type};base64,${btoa(binary)}`;
    } catch {
      return null;
    }
  }

  /** Asks `at`'s server to end each refresh token its record still holds to be ended, and forgets those it answered for. */
  async function retire(at) {
    const kept = await record(at).catch(() => null);
    if (!kept?.retire.length) return;
    const told = [];
    try {
      const { revoke } = await server(at);
      for (const refresh of kept.retire) {
        const answer = await fetch(revoke, { method: 'POST', headers: form, body: revokeBody({ refresh }), ...sealed }).catch(() => null);
        // Any answer but the server's own trouble is final (RFC 7009 answers 200 for a token it no longer knows).
        if (answer && answer.status < 500) told.push(refresh);
      }
    } catch { /* not reached: asked again later */ }
    if (told.length) await edit(at, (was) => (was ? { ...was, retire: was.retire.filter((refresh) => !told.includes(refresh)) } : was)).catch(() => undefined);
  }

  return {
    /**
     * Whether the server takes extension sign-ins at all: its door asked with no token answers 401. A 404 (the door
     * is off), any other answer, or no answer: no. `?probe=1` tells the server's logs this 401 from a real one; a
     * `HEAD` would do it too, but the door answers that 404.
     */
    async available() {
      try {
        const answer = await fetch(`${resourceFor(issuer())}/me?probe=1`, { headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error' });
        return answer.status === 401;
      } catch {
        return false;
      }
    },

    /**
     * Picks up where a worker that was ended left the server in use: a sign-in window that went with it is a sign-in
     * that did not happen, and what is still to be ended is asked again (not waited for).
     */
    async recover() {
      const at = issuer();
      await edit(at, (was) => (was?.state === 'signing-in' ? to('signed-out')(was) : was));
      void retire(at);
    },

    /** Asks the server in use again to end what it has yet to (not waited for). */
    retry() { void retire(issuer()); },

    /**
     * Who is signed in: `{ email, name, pro, widths, ownApp }`, or null. `pro` is the server's word alone: true only when it
     * says so. `widths`: its walk door takes the width the person picked; `ownApp`: an app persona's app beside
     * its slug.
     */
    async me() {
      const me = await read(issuer(), '/me');
      return typeof me?.email === 'string' ? { email: me.email, name: typeof me.name === 'string' ? me.name : '', pro: me.pro === true, widths: me.widths === true, ownApp: me.ownApp === true, ownTraits: me.ownTraits === true } : null;
    },

    /**
     * The signed-in person's personas, `[{ name, role, slug?, mine?, face? }]`, or null. `url`: the tab's address, for
     * the personas of the app there, else the six defaults (the server matches by host). `app`: one app's
     * (`{ workspace, repo, app }`) instead. `face`: the face sheet as a `data:` address, for those with one stored.
     * `faceless`: the slugs of the person's own still waiting for a face: only theirs are fetched (the panel's re-asks).
     */
    async personas({ url, app, faceless } = {}) {
      const at = issuer();
      const one = appOf(app);
      // `can`: this extension reads a page out (`hears`), so the server lists a persona who hears it too.
      const query = `?${new URLSearchParams({ ...(one ? { workspace: app.workspace, repo: app.repo, app: app.app } : url ? { url } : {}), can: 'hears' })}`;
      const list = await read(at, `/personas${query}`);
      const rows = rowsOf(list, 'personas', (p) => typeof p?.name === 'string')?.slice(0, 100);
      if (!rows) return null;
      const only = Array.isArray(faceless) ? faceless : null;
      const faces = await Promise.all(rows.map((p) => (!only || (p.mine === true && only.includes(p.slug)) ? faceOf(at, p.face) : null)));
      return rows.map((p, i) => ({ ...personaOf(p), ...(faces[i] ? { face: faces[i] } : {}) }));
    },

    /**
     * History: the person's own journeys, newest first, `[{ id, task, persona: { name, face? }, at, outcome, issues, url }]`,
     * or null. A row opens its `url`, so only one of our app's outing pages (walks/handoff.js) is kept.
     */
    async journeys() {
      const at = issuer();
      const list = await read(at, '/journeys');
      const rows = rowsOf(list, 'journeys', (j) => typeof j?.id === 'string' && typeof j.task === 'string' && typeof j.persona?.name === 'string'
        && Number.isFinite(j.at) && OUTCOMES.includes(j.outcome) && typeof j.url === 'string' && isOutingPage(j.url))?.slice(0, 100);
      if (!rows) return null;
      // One fetch per face, however many of the person's journeys it walked.
      const faces = new Map();
      const faceFor = (face) => { if (!faces.has(face?.src)) faces.set(face?.src, faceOf(at, face)); return faces.get(face?.src); };
      const drawn = await Promise.all(rows.map((j) => faceFor(j.persona.face)));
      return rows.map((j, i) => ({ id: j.id, task: j.task.slice(0, 2000), persona: { name: j.persona.name.slice(0, 120), ...(drawn[i] ? { face: drawn[i] } : {}) },
        at: j.at, outcome: j.outcome, issues: Number.isInteger(j.issues) && j.issues > 0 ? j.issues : 0, url: j.url }));
    },

    /** The person's apps, `[{ workspace, repo, app, name }]`, or null. */
    async apps() {
      const list = await read(issuer(), '/apps');
      return rowsOf(list, 'apps', (a) => appOf(a))?.slice(0, 50)
        .map((a) => ({ workspace: a.workspace, repo: a.repo, app: a.app, name: typeof a.name === 'string' && a.name ? a.name.slice(0, 80) : `${a.repo}/${a.app}` })) ?? null;
    },

    /**
     * The check-in: the server hears Chrome is open, and answers the journeys an agent asked for that wait
     * for the person's Start, `[{ id, page, persona, site, task }]` (at most 3), or null.
     */
    async waiting() {
      const list = await read(issuer(), '/waiting');
      // Short enough for one line of a notice.
      const text = (value, max) => (typeof value !== 'string' ? '' : value.length > max ? `${value.slice(0, max - 1)}…` : value);
      return rowsOf(list, 'journeys', (j) => typeof j?.id === 'string' && WAITING_ID.test(j.id) && typeof j.page === 'string' && j.page.length <= 2048, 'waiting')?.slice(0, 3)
        .map((j) => ({ id: j.id, page: j.page, persona: text(j.persona, 40), site: text(j.site, 60), task: text(j.task, 120) })) ?? null;
    },

    /** Tells the server the person said Not now to a waiting journey. A 404 is one already gone. `{ ok }`. */
    async decline(id) {
      if (!WAITING_ID.test(id)) return { ok: false };
      const answer = await call(issuer(), `/waiting/${id}/decline`, undefined, 'POST').catch(() => null);
      return { ok: answer?.status === 204 || answer?.status === 404 };
    },

    /**
     * Asks the server to make the person a persona of their own from `description`, on `device` and with `disability`
     * where the person picked them. The same `requestId` sent again
     * is answered with the persona it made, never a second. `{ ok: true, persona }`, or `{ ok: false, why }`: `short`,
     * `scope` (signed in before personas could be created), `unavailable`, `limit` (with the server's `max`), `quota`,
     * `failed`.
     */
    async createPersona({ description, device, disability, requestId }) {
      const answer = await call(issuer(), '/personas', { description, ...(device ? { device } : {}), ...(disability ? { disability } : {}), requestId }).catch(() => null);
      const made = [200, 201].includes(answer?.status) ? answer.json?.persona : null;
      if (typeof made?.name === 'string' && SLUG.test(made.slug)) return { ok: true, persona: personaOf({ ...made, mine: true }) };
      if (answer?.status === 400 && answer.json?.field === 'description') return { ok: false, why: 'short' };
      if (answer?.status === 403 && answer.json?.error === 'insufficient_scope') return { ok: false, why: 'scope' };
      if (notPro(answer)) return { ok: false, why: 'not-pro' };
      if (answer?.status === 409 && Number.isInteger(answer.json?.max)) return { ok: false, why: 'limit', max: answer.json.max };
      return { ok: false, why: CREATE_WHY[answer?.status] ?? 'failed' };
    },

    /** Removes one of the person's own personas. A 404 is one already gone. `{ ok }`. */
    async removePersona(slug) {
      if (!SLUG.test(slug)) return { ok: false };
      const answer = await call(issuer(), `/personas/mine/${slug}`, undefined, 'DELETE').catch(() => null);
      return { ok: answer?.status === 204 || answer?.status === 404 };
    },

    /**
     * Asks the server to start a walk of the person's tab (`{ persona, task, url }`). `{ ok: true, handoff }` with the
     * block it answered, or `{ ok: false, why }`: `unavailable` (no such door yet), `scope` (signed in before walks
     * could be started), `failed`.
     */
    async startWalk(body) {
      // `can`: this extension reads a page out, so a persona who hears it may walk here (as `personas` says).
      const answer = await call(issuer(), '/walks?can=hears', body).catch(() => null);
      if (answer?.status === 404) return { ok: false, why: 'unavailable' };
      if (notPro(answer)) return { ok: false, why: 'not-pro' };
      if (answer?.status === 403 && answer.json?.error === 'insufficient_scope') return { ok: false, why: 'scope' };
      if (answer?.status === 429) return { ok: false, why: 'too-many' };
      const handoff = answer && answer.status >= 200 && answer.status < 300 ? answer.json?.handoff : null;
      if (!handoff || typeof handoff !== 'object') return { ok: false, why: answer?.json?.error === 'bad-plan' ? 'plan' : 'failed' };
      // The walk's page, where its results are: beside the block, which takes no key it does not know.
      return { ok: true, handoff, ...(typeof answer.json.walkUrl === 'string' ? { walkUrl: answer.json.walkUrl } : {}) };
    },

    /** Calls off a walk the server made that this browser then refused to start, so it does not wait out its browser and block the next. `{ ok }`; a 404 is one already gone. */
    async cancelWalk(id) {
      if (typeof id !== 'string' || !WAITING_ID.test(id)) return { ok: false };
      const answer = await call(issuer(), `/walks/${id}/cancel`, undefined, 'POST').catch(() => null);
      return { ok: answer?.status === 204 || answer?.status === 404 };
    },

    /**
     * Asks the server for a short plan of a walk (`{ persona, task, url }`). `{ ok: true, plan }`, or `{ ok: false, why }` as
     * `startWalk`. `early`: asked before the person sent the task, as they paused writing it; a server that doesn't know
     * the word plans it all the same.
     */
    async planWalk(body, { early = false } = {}) {
      const answer = await call(issuer(), `/walks/plan?can=hears${early ? '&early=1' : ''}`, body).catch(() => null);
      if (answer?.status === 404) return { ok: false, why: 'unavailable' };
      if (notPro(answer)) return { ok: false, why: 'not-pro' };
      if (answer?.status === 403 && answer.json?.error === 'insufficient_scope') return { ok: false, why: 'scope' };
      if (answer?.status === 429) return { ok: false, why: 'too-many' };
      if (answer?.status === 502) return { ok: false, why: 'no-plan' };
      const plan = answer && answer.status >= 200 && answer.status < 300 ? planOf(answer.json?.plan) : null;
      return plan ? { ok: true, plan } : { ok: false, why: 'failed' };
    },

    /** Opens the sign-in window and keeps the grant it ends in. Resolves to whether it did, or why not. */
    async signIn() {
      const at = issuer();
      const { authorize, scope } = await server(at);
      const verifier = randomText();
      const state = randomText();
      await edit(at, to('signing-in', { pending: { state } }));
      const returned = await launch(authorizeUrl({ endpoint: authorize, issuer: at, redirectUri, state, scope, challenge: await challengeFor(verifier) }));
      const ours = (was) => was?.state === 'signing-in' && was.pending?.state === state;
      const over = (why) => edit(at, (was) => (ours(was) ? to('signed-out')(was) : was)).then(() => ({ ok: false, why }));
      // The server in use changed while the window was open: this sign-in was for another one, and is dropped.
      if (issuer() !== at) return over('server');
      const back = readCallback(returned, { redirectUri, state, issuer: at });
      if (!back.ok) return over(back.why);
      // Only the sign-in still waiting on disk: a window that comes back after another sign-in began is not it.
      if (!ours(await record(at))) return { ok: false, why: 'pending' };
      const traded = await trade(at, codeBody({ code: back.code, verifier, redirectUri, issuer: at }));
      if (!traded.tokens) return over('token');
      return (await keep(at, 'signing-in', traded.tokens)) ? { ok: true } : { ok: false, why: 'pending' };
    },

    /** Signs this browser out of the server in use at once; the server is asked to end the grant after, not waited for. */
    async signOut() {
      const at = issuer();
      if (access?.issuer === at) access = null;
      await edit(at, (was) => (was ? { state: 'signing-out', retire: [...was.retire, ...(SIGNED_IN.includes(was.state) && was.refresh ? [was.refresh] : [])] } : null));
      void retire(at);
    },

    /** Whether a grant is kept for the server in use. */
    async signedIn() { return (await grantOf(issuer())) !== null; },
  };
}
