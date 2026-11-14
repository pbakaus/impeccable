// Signing this extension in to an Impeccable account: OAuth 2.1, authorization code with PKCE (S256), as one more
// public app of the account server. Pure: it builds what is sent and checks what comes back, and touches nothing of
// Chrome or the network, so it runs anywhere. session.js does the sending; worker.js answers the popup.
import { BUILD } from '../shared/build.js';

/** This extension's name at the account server. */
export const CLIENT_ID = 'impeccable-extension';
/** What it asks for: who is signed in, and their personas; and to start walks and create personas, where the server offers each. */
export const SCOPES = 'account:read personas:read';
const OFFERED = ['outings:start', 'personas:create'];
/** The account server every build signs in to unless told otherwise. */
export const PRODUCTION = 'https://api.impeccable.style';
/** This machine's stand-in, on any port, which a development build may sign in to as well. */
const LOCAL = /^http:\/\/api\.localhost(:\d{1,5})?$/;

/** The part of the server this extension's token is for (RFC 8707), and the doors it talks to. */
export const resourceFor = (issuer) => `${issuer}/extension/v1`;

/**
 * Whether `issuer` may be signed in to: production in every build; the local stand-in and the servers the build was
 * made for only in a development build (extension/shared/build.js).
 */
export function issuerAllowed(issuer, build = BUILD) {
  if (issuer === PRODUCTION) return true;
  return build.devHosts === true && (build.servers.some((server) => server.api === issuer) || LOCAL.test(String(issuer)));
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A fresh random string for a verifier or a `state`: 32 bytes, base64url. */
export const randomText = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** The S256 challenge for a verifier. */
export async function challengeFor(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The address of the server's own description of itself (RFC 8414). */
export const metadataUrl = (issuer) => `${issuer}/.well-known/oauth-authorization-server`;

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

/** Where the account server's sign-in dialog is: on the app host paired with its API host (`api.` to `app.`), a fixed pairing. */
export function dialogOrigin(issuer) {
  const url = new URL(issuer);
  url.hostname = url.hostname.replace(/^api\./, 'app.');
  return url.origin;
}

/**
 * Reads the server's description of itself. Only one that names `issuer` as itself, keeps its token and revoke
 * doors on the issuer's own origin and its sign-in dialog there or on the paired app host is taken:
 * `{ authorize, token, revoke }`, or null.
 */
export function readMetadata(json, issuer) {
  if (json?.issuer !== issuer) return null;
  const doors = { authorize: json.authorization_endpoint, token: json.token_endpoint, revoke: json.revocation_endpoint ?? `${issuer}/oauth/revoke` };
  if (!Object.values(doors).every((url) => typeof url === 'string')) return null;
  const home = originOf(issuer);
  if (originOf(doors.token) !== home || originOf(doors.revoke) !== home) return null;
  if (![home, dialogOrigin(issuer)].includes(originOf(doors.authorize))) return null;
  // A scope the server does not list would fail the sign-in: each is asked for only once it is there.
  const listed = Array.isArray(json.scopes_supported) ? json.scopes_supported : [];
  const scope = [SCOPES, ...OFFERED.filter((each) => listed.includes(each))].join(' ');
  return { ...doors, scope };
}

/** Where the person is sent to sign in and consent. */
export function authorizeUrl({ endpoint, issuer, redirectUri, state, challenge, scope = SCOPES }) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: resourceFor(issuer),
  })) url.searchParams.set(key, value);
  return url.href;
}

const CODE = /^[A-Za-z0-9._~-]{8,512}$/;

/**
 * Checks the address the sign-in came back on: our own callback to the letter (origin and path, nothing before the
 * host), our `state`, the issuer it was sent to (RFC 9207), and a code, each said once. `{ ok: true, code }`, or
 * `{ ok: false, why }` with `why` one of `callback`, `repeated`, `denied`, `state`, `iss`, `code`.
 */
export function readCallback(returned, { redirectUri, state, issuer }) {
  let url;
  try { url = new URL(returned); } catch { return { ok: false, why: 'callback' }; }
  if (`${url.origin}${url.pathname}` !== redirectUri || url.username || url.password) return { ok: false, why: 'callback' };
  const query = url.searchParams;
  if (['code', 'state', 'iss'].some((key) => query.getAll(key).length > 1)) return { ok: false, why: 'repeated' };
  if (query.get('state') !== state) return { ok: false, why: 'state' };
  if (query.get('iss') !== issuer) return { ok: false, why: 'iss' };
  if (query.has('error')) return { ok: false, why: 'denied' };
  const code = query.get('code');
  if (!code || !CODE.test(code)) return { ok: false, why: 'code' };
  return { ok: true, code };
}

/** The body that trades a code for tokens. */
export const codeBody = ({ code, verifier, redirectUri, issuer }) => new URLSearchParams({
  grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirectUri, resource: resourceFor(issuer),
});

/** The body that trades a refresh token for fresh tokens. */
export const refreshBody = ({ refresh, issuer }) => new URLSearchParams({
  grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh, resource: resourceFor(issuer),
});

/** The body that ends the grant. */
export const revokeBody = ({ refresh }) => new URLSearchParams({ token: refresh, token_type_hint: 'refresh_token', client_id: CLIENT_ID });

/** Reads the token server's answer: `{ access, refresh, expiresIn }`, or null for anything else. */
export function readTokens(json) {
  if (json === null || typeof json !== 'object') return null;
  if (String(json.token_type).toLowerCase() !== 'bearer') return null;
  if (typeof json.access_token !== 'string' || json.access_token === '' || typeof json.refresh_token !== 'string' || json.refresh_token === '') return null;
  const expiresIn = Number.isFinite(json.expires_in) && json.expires_in > 0 ? json.expires_in : 900;
  return { access: json.access_token, refresh: json.refresh_token, expiresIn };
}
