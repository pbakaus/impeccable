import { after, describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

import { readHandoff, readStartedHandoff, resultLink } from '../extension/walks/handoff.js';
import { MAX_OTHER_SITES, MAX_SITE_QUESTIONS, admit, onlyThisTab, verdict } from '../extension/walks/guard.js';
import { isSignInPage, lookInPage } from '../extension/walks/signin.js';
import { listen } from '../extension/walks/panel/voice.js';
import { reduce } from '../extension/walks/view.js';
import { WALK_PERMISSIONS, firefoxManifest, isStoreFile, moduleReferences, stageFirefox, stageStore, storeManifest } from '../scripts/lib/extension-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
/** The store and Firefox trees, each staged once as scripts/build-extension.js stages it. */
const staged = {};
const stageOnce = (name, make) => () => (staged[name] ??= (() => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-store-')), 'extension');
  make(path.join(ROOT, 'extension'), root);
  return root;
})());
const STORE = stageOnce('main', stageStore);
const FIREFOX = stageOnce('firefox', stageFirefox);
after(() => { for (const root of Object.values(staged)) rmSync(path.dirname(root), { recursive: true, force: true }); });

const PAGE = 'https://app.impeccable.style/app/acme/outings/o1';
const block = (over = {}) => ({
  v: 1,
  outing: 'o1',
  socket: 'wss://impeccable.reviews/api/outings/o1/socket',
  ticket: 'ticket-0123456789',
  persona: { name: 'Mira', role: '' },
  errand: { name: '', goal: 'Add a to-do, then delete it.', doneWhen: [] },
  url: 'http://localhost:3000/',
  allow: [],
  ...over,
});

// Values the web app holds too. A change here must be made on the web app's side as well: this table fails so the
// author goes and looks.
describe('walk contract with the web app', () => {
  const source = (file) => readFileSync(path.join(ROOT, 'extension/walks', file), 'utf8');
  for (const [what, file, pattern, expected] of [
    ['protocol number', 'worker.js', /const PROTOCOL = (.+);/, '2'],
    ['socket subprotocol', 'worker.js', /const SUBPROTOCOL = (.+);/, "'impeccable-outing'"],
    ['part size', 'worker.js', /const PART_CHARS = (.+);/, '256 * 1024'],
    ['close reasons', 'link.js', /const CLOSED = (.+);/, "{ replaced: 'replaced', over: 'outing over', cancelled: 'cancelled', undriven: 'no driver came', switchedOff: 'switched off' }"],
    ['field limits', 'handoff.js', /const MAX = (.+);/, '{ name: 120, role: 200, errand: 120, goal: 2000, check: 300 }'],
    ['device names', 'handoff.js', /const DEVICES = (.+);/, "['desktop', 'mobile', 'tablet']"],
    ['capabilities', 'worker.js', /const CAN = (.+);/, "['tab', 'ask', 'go', 'upload', 'hold', 'submit-ask', 'helpers', 'hears', 'cover']"],
    ['most other sites a walk may go to', 'guard.js', /const MAX_OTHER_SITES = (.+);/, '8'],
  ]) {
    it(`keeps the ${what}`, () => { assert.equal(source(file).match(pattern)?.[1], expected); });
  }
});

describe('walk hand-off', () => {
  it('takes a block from our walk page, with the socket on its paired host', () => {
    const read = readHandoff(JSON.stringify(block()), PAGE);
    assert.equal(read.ok, true);
    assert.equal(read.handoff.site, 'http://localhost:3000');
    // How the persona sees the page is kept for the sight filter (sight.js).
    assert.equal(readHandoff(JSON.stringify(block({ persona: { name: 'Robert', role: '', sees: 'older-eyes' } })), PAGE).handoff.persona.sees, 'older-eyes');
  });

  // The store build takes a walk from our production pages alone; the build loaded unpacked, from staging too, and
  // from this machine only on the port of the local account server the person chose. A walk the account worker
  // started, on the same socket, follows the same rule.
  const LOCAL = 'http://api.localhost:8794';
  for (const [label, page, socket, server, unpacked] of [
    ['production', PAGE, block().socket, undefined, true],
    ['staging', 'https://app.staging.impeccable.style/app/acme/outings/o1', 'wss://staging.impeccable.reviews/api/outings/o1/socket', undefined, true],
    ['this machine', 'http://app.localhost:8794/app/acme/outings/o1', 'ws://localhost:8794/api/outings/o1/socket', LOCAL, true],
    ['this machine without the app host', 'http://localhost:8794/app/acme/outings/o1', 'ws://localhost:8794/api/outings/o1/socket', LOCAL, true],
    ['this machine on another port than the chosen server', 'http://localhost:9000/app/acme/outings/o1', 'ws://localhost:9000/api/outings/o1/socket', LOCAL, false],
    ['this machine with no local server chosen', 'http://localhost:8794/app/acme/outings/o1', 'ws://localhost:8794/api/outings/o1/socket', undefined, false],
  ]) {
    it(`${unpacked ? 'takes' : 'refuses'} a hand-off from ${label} in the build loaded unpacked${label === 'production' ? ', and the store build takes it' : ', and the store build refuses it'}`, async () => {
      const store = await import(pathToFileURL(path.join(STORE(), 'walks/handoff.js')).href);
      const text = JSON.stringify(block({ socket }));
      assert.deepEqual([readHandoff(text, page, server).ok, store.readHandoff(text, page, server).ok], [unpacked, label === 'production']);
      assert.deepEqual([readStartedHandoff(text, server).ok, store.readStartedHandoff(text, server).ok], [unpacked, label === 'production']);
    });
  }

  for (const [label, page, over, why] of [
    ['a page that is not ours', 'https://example.com/app/acme/outings/o1', {}, 'origin'],
    ['a socket on another host', PAGE, { socket: 'wss://example.com/api/outings/o1/socket' }, 'socket'],
    ['a socket on the app host instead of its pair', PAGE, { socket: 'wss://app.impeccable.style/api/outings/o1/socket' }, 'socket'],
    ['a socket for another walk', PAGE, { socket: 'wss://impeccable.reviews/api/outings/o2/socket' }, 'socket'],
    ['an unknown field', PAGE, { extra: true }, 'malformed'],
    ['a persona who sees in a way no filter draws', PAGE, { persona: { name: 'Robert', role: '', sees: 'x-ray' } }, 'persona'],
    ['another version', PAGE, { v: 2 }, 'v'],
    ['a start address off this machine and off the allow-list', PAGE, { url: 'https://example.com/' }, 'url'],
    ['an allow-list entry that is not an origin', PAGE, { allow: ['https://example.com/path'] }, 'allow'],
  ]) {
    it(`refuses ${label}`, () => {
      assert.deepEqual(readHandoff(JSON.stringify(block(over)), page), { ok: false, why });
    });
  }
});

describe('walk result link', () => {
  // The result is on the app host of the walk's own server (the web app links a walk's result there).
  for (const [label, link, socket, shown] of [
    ['the app host, production', 'https://app.impeccable.style/app/acme/runs/r1/personas/ines', block().socket, true],
    ['the public host, production', 'https://impeccable.reviews/app/acme/runs/r1/personas/ines', block().socket, true],
    ['the app host, staging', 'https://app.staging.impeccable.style/app/acme/runs/r1', 'wss://staging.impeccable.reviews/api/outings/o1/socket', true],
    ['the app host on this machine, same port', 'http://app.localhost:8794/app/acme/runs/r1', 'ws://localhost:8794/api/outings/o1/socket', true],
    ['the app host on this machine, another port', 'http://app.localhost:9000/app/acme/runs/r1', 'ws://localhost:8794/api/outings/o1/socket', false],
    ['staging, for a production walk', 'https://app.staging.impeccable.style/app/acme/runs/r1', block().socket, false],
    ['another site', 'https://example.com/app/acme/runs/r1', block().socket, false],
    ['plain http on our host', 'http://app.impeccable.style/app/acme/runs/r1', block().socket, false],
  ]) {
    it(`${shown ? 'opens' : 'neither shows nor opens'} a result on ${label}`, () => {
      assert.equal(resultLink(link, socket), shown ? link : null);
    });
  }
});

// Talk to type, against a stand-in for the browser's speech recognition: what the person says lands in the box after
// what was there, interim words included, and nothing is sent when they stop.
describe('talk to type', () => {
  class Speech {
    static last;
    constructor() { Speech.last = this; this.calls = []; }
    start() { this.calls.push('start'); this.onstart?.(); }
    stop() { this.calls.push('stop'); this.hear(['try signing up'], true); this.onend?.(); }
    abort() { this.calls.push('abort'); }
    hear(parts, final = false) { this.onresult?.({ results: parts.map((transcript) => Object.assign([{ transcript }], { isFinal: final })) }); }
  }
  const run = (base) => {
    const seen = { text: [], ended: [], started: 0 };
    const control = listen(Speech, { base, lang: 'en-GB', onStart: () => { seen.started += 1; }, onText: (text) => seen.text.push(text), onEnd: (why) => seen.ended.push(why) });
    return { seen, control, rec: Speech.last };
  };

  it('listens through pauses with interim words, writes them after the box’s text, and keeps them when stopped', () => {
    const { seen, control, rec } = run('On the pricing page ');
    assert.deepEqual([rec.continuous, rec.interimResults, rec.lang, seen.started], [true, true, 'en-GB', 1]);
    rec.hear(['try sign']);
    control.stop();
    assert.deepEqual(seen.text, ['On the pricing page try sign', 'On the pricing page try signing up']);
    assert.deepEqual(seen.ended, [null]);
  });

  // Chrome ends a session by itself after a pause or about a minute of talk: a new one starts, its words
  // follow the earlier ones once (last interim words kept), and only a long silence ends listening.
  it('starts again when Chrome ends a session, without doubling or losing words', () => {
    const { seen, control, rec: first } = run('');
    first.hear(['open the pricing page'], true);
    first.hear(['open the pricing page', ' and compare']);
    first.onend();
    const second = Speech.last;
    assert.notEqual(second, first);
    second.hear(['then click upgrade']);
    control.stop();
    assert.deepEqual(seen.text.slice(-3), ['open the pricing page and compare', 'open the pricing page and compare then click upgrade', 'open the pricing page and compare try signing up']);
    assert.deepEqual([seen.started, seen.ended], [2, [null]]);
  });

  it('starts a new session when words stop coming mid-talk', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { seen, rec: first } = run('');
    first.hear(['open the pricing page']);
    t.mock.timers.tick(8000);
    assert.deepEqual([first.calls, seen.started, seen.ended], [['start', 'stop'], 2, []]);
    Speech.last.hear(['then click upgrade']);
    assert.equal(seen.text.at(-1), 'try signing up then click upgrade');
  });

  it('keeps what the person types while listening, and adds only new words after it', () => {
    const { seen, control, rec } = run('');
    rec.hear(['open pricing']);
    control.retype('open pricing and log in');
    rec.hear(['open pricing', ' then upgrade']);
    assert.equal(seen.text.at(-1), 'open pricing and log in then upgrade');
  });

  it('frees the mic when Chrome never answers a stop', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { seen, control, rec } = run('');
    rec.stop = () => { rec.calls.push('stop'); };
    control.stop();
    assert.deepEqual(seen.ended, []);
    t.mock.timers.tick(2000);
    assert.deepEqual([rec.calls, seen.ended], [['start', 'stop', 'abort'], [null]]);
  });

  it('stops by itself after two silent sessions in a row', () => {
    const { seen, rec: first } = run('');
    first.onerror({ error: 'no-speech' });
    first.onend();
    assert.deepEqual(seen.ended, []);
    Speech.last.onerror({ error: 'no-speech' });
    Speech.last.onend();
    assert.deepEqual([seen.started, seen.ended], [2, [null]]);
  });

  it('starts again when the connection drops, and says so after two failures in a row', () => {
    const { seen, rec: first } = run('');
    first.hear(['open pricing'], true);
    first.onerror({ error: 'network' });
    first.onend();
    Speech.last.onerror({ error: 'network' });
    Speech.last.onend();
    assert.deepEqual(seen.ended, []);
    Speech.last.onerror({ error: 'network' });
    Speech.last.onend();
    assert.deepEqual([seen.started, seen.ended, seen.text.at(-1)], [3, ['network'], 'open pricing']);
  });

  for (const [error, ended] of [['not-allowed', 'not-allowed'], ['audio-capture', 'audio-capture'], ['aborted', null]]) {
    it(`ends once on ${error}, saying ${ended ?? 'nothing'}`, () => {
      const { seen, rec } = run('');
      rec.onerror({ error });
      rec.onend?.();
      assert.deepEqual([seen.started, seen.ended], [1, [ended]]);
    });
  }

  it('drops at once on Send: no more words and no end called back', () => {
    const { seen, control, rec } = run('');
    control.drop();
    rec.onresult?.({ results: [[{ transcript: 'late' }]] });
    rec.onend?.();
    assert.deepEqual([seen.text, seen.ended, rec.calls], [[], [], ['start', 'abort']]);
  });
});

describe('walk guard', () => {
  for (const [url, allow, origin] of [
    ['http://localhost:3000/a', [], 'http://localhost:3000'],
    ['http://127.0.0.1:8080/', [], 'http://127.0.0.1:8080'],
    ['https://app.example.com/start', ['https://app.example.com'], 'https://app.example.com'],
  ]) {
    it(`admits ${url}`, () => { assert.equal(admit(url, allow).origin, origin); });
  }

  for (const [url, allow] of [
    ['https://example.com/', []],
    ['https://example.com/', ['https://other.example.com']],
    ['file:///etc/hosts', []],
    // Our own app, API and sign-in pages, even when allowed or on this machine.
    ['https://impeccable.reviews/app', ['https://impeccable.reviews']],
    ['https://staging.impeccable.reviews/', ['https://staging.impeccable.reviews']],
    ['https://app.impeccable.style/app/acme', ['https://app.impeccable.style']],
    ['https://api.staging.impeccable.style/mcp', ['https://api.staging.impeccable.style']],
    ['http://app.localhost:8794/app', []],
    ['http://api.localhost:8794/', []],
    ['http://localhost:8794/app/oauth/authorize?client_id=x', []],
  ]) {
    it(`refuses to walk ${url} with ${allow.length} allowed`, () => { assert.throws(() => admit(url, allow), { name: 'NotAllowed' }); });
  }

  const allowed = ['http://localhost:3000'];
  for (const [label, paused, answer] of [
    ['the top document off the site', { resourceType: 'Document', frameId: 'main', request: { url: 'https://example.com/' } }, 'block'],
    ['the top document on the site', { resourceType: 'Document', frameId: 'main', request: { url: 'http://localhost:3000/b' } }, 'continue'],
    ['a frame off the site', { resourceType: 'Document', frameId: 'child', request: { url: 'https://example.com/' } }, 'continue'],
    ['the top document on our own sign-in dialog', { resourceType: 'Document', frameId: 'main', request: { url: 'http://localhost:3000/app/oauth/authorize' } }, 'block'],
    // Writes: to the walk's own site, yes; to anywhere else, no, whoever asks; reads go anywhere.
    ['a write to the site', { resourceType: 'XHR', frameId: 'main', request: { method: 'DELETE', url: 'http://localhost:3000/api/todos/1' } }, 'continue'],
    ['a write to another origin', { resourceType: 'Fetch', frameId: 'main', request: { method: 'POST', url: 'https://example.com/collect' } }, 'refuse'],
    ['a frame’s form posted to another origin', { resourceType: 'Document', frameId: 'child', request: { method: 'POST', url: 'https://example.com/form' } }, 'refuse'],
    ['a read from another origin', { resourceType: 'Script', frameId: 'main', request: { method: 'GET', url: 'https://cdn.example.com/a.js' } }, 'continue'],
  ]) {
    it(`lets ${label} ${answer}`, () => { assert.equal(verdict(paused, 'main', allowed), answer); });
  }

  it('refuses an op that names another tab', () => {
    assert.throws(() => onlyThisTab({ tabId: 3 }), { name: 'NotAllowed' });
    assert.doesNotThrow(() => onlyThisTab({ selector: '#go' }));
  });
});

// What the walk reads of the page for itself, on a stand-in document: the signs of a sign-in, and where typing lands.
describe('walk lookout', () => {
  // `autofill`: Chrome filled it, which a script sees only as the `:autofill` state (its value reads empty).
  const field = (attrs = {}, size = 10) => ({ tagName: 'INPUT', type: attrs.type ?? 'text', value: attrs.value ?? '', disabled: attrs.disabled === true, readOnly: attrs.readOnly === true, matches: (sel) => attrs.autofill === true && /autofill/.test(sel), getAttribute: (name) => attrs[name] ?? null, setAttribute: (name, value) => { attrs[name] = value; }, getBoundingClientRect: () => ({ width: size, height: size }), checkVisibility: () => size > 0 });
  // `inputs`: every field of the page (`input`), the passwords among them unless given.
  // A selector of password fields, read as Chrome would: by `type`, by the mark a field seen as one keeps, or by an
  // `autocomplete` token.
  const picks = (sel, f) => sel.split(', ').some((part) => (/type="password"/.test(part) && f.type === 'password') || (part === 'input[data-impeccable-secret-field]' && f.getAttribute('data-impeccable-secret-field') !== null) || [...part.matchAll(/autocomplete~="([\w-]+)"/g)].some(([, token]) => String(f.getAttribute('autocomplete') ?? '').split(/\s+/).includes(token)));
  const doc = ({ passwords = [], inputs = passwords, frames = [], hosts = [], active = null } = {}) => ({ activeElement: active, querySelectorAll: (sel) => (sel === '*' ? [...frames, ...hosts] : sel === 'input' ? inputs.filter((f) => f.tagName === 'INPUT') : sel === '[data-impeccable-secret-form]' ? [...new Set(inputs.map((f) => f.parentElement))].filter((own) => own?.getAttribute('data-impeccable-secret-form') != null) : passwords.filter((f) => picks(sel, f))) });
  // A form of these fields, in this order: each knows it (`field.form`, its `parentElement`), and the page holds them all.
  const form = (...fields) => {
    const attrs = {};
    const own = { tagName: 'FORM', children: fields, getAttribute: (name) => attrs[name] ?? null, setAttribute: (name, value) => { attrs[name] = value; }, removeAttribute: (name) => { delete attrs[name]; }, querySelectorAll: (sel) => (sel === 'input' ? fields.filter((f) => f.tagName === 'INPUT') : fields.filter((f) => f.type === 'password')) };
    for (const f of fields) f.form = f.parentElement = own;
    return fields;
  };
  const page = (...forms) => doc({ inputs: forms.flat(), passwords: forms.flat().filter((f) => f.type === 'password') });
  const host = (root) => ({ tagName: 'DIV', shadowRoot: root });
  const frame = (inner) => ({ tagName: 'IFRAME', contentDocument: inner });
  const seen = (document, status = 200) => JSON.parse(vm.runInNewContext(`JSON.stringify((${lookInPage})())`, { document, performance: { getEntriesByType: () => [{ responseStatus: status }] } }));

  for (const [label, document, expected] of [
    ['a visible password field', doc({ passwords: [field({ type: 'password' })] }), { password: true, focus: null }],
    ['a password field of no size', doc({ passwords: [field({ type: 'password' }, 0)] }), { password: false, focus: null }],
    ['a password field in a frame on its origin', doc({ frames: [frame(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    ['a password field in an open shadow root', doc({ hosts: [host(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    // hr-pilot-vercel's own pages, as read from them (15 Nov): its login, and its settings signed in.
    ['a login: a username and a password', page(form(field({ autocomplete: 'username' }), field({ type: 'password', autocomplete: 'current-password' }))), { password: true, focus: null }],
    ['a sign-up: an email and two passwords', page(form(field({ type: 'email' }), field({ type: 'password' }), field({ type: 'password' }))), { password: true, focus: null }],
    ['settings signed in: a profile with an email, and a change of password', page(form(field({}), field({ type: 'email' })), form(field({ type: 'password', id: 'current-password' }), field({ type: 'password', id: 'new-password' }))), { password: false, focus: null }],
    ['settings signed in, a password already in the change of password', page(form(field({ type: 'password', id: 'current-password', value: 'x' }), field({ type: 'password', id: 'new-password' }))), { password: true, filled: true, focus: null }],
    ['a login with its password filled', page(form(field({ autocomplete: 'username' }), field({ type: 'password', value: 'x' }))), { password: true, filled: true, focus: null }],
    ['a hidden password field holding a password', doc({ passwords: [field({ type: 'password', value: 'x' }, 0)] }), { password: true, filled: true, focus: null }],
    ['settings signed in, Chrome’s autofill in the change of password', page(form(field({ type: 'password', autofill: true }), field({ type: 'password' }))), { password: true, filled: true, focus: null }],
    ['a shown password: a text field for the current password, holding one', doc({ passwords: [field({ autocomplete: 'current-password', value: 'x' })] }), { password: true, filled: true, focus: null }],
    ['a one-time code step', doc({ passwords: [field({ autocomplete: 'one-time-code' })] }), { password: true, focus: null }],
    // Catches a walk started with the password already shown as text: no look saw it as a password field. A text field
    // named for one pauses the walk until Continue, and no longer: it may be a Company or a reset email.
    ['a password shown from the start: a text field named for one, holding one', doc({ passwords: [field({ name: 'user[password]', value: 'x' })] }), { password: true, maybe: true, focus: null }],
    // Catches a field named password let through because its label names an email.
    ['a text field named password whose label names an email, holding one', doc({ passwords: [field({ name: 'password', 'aria-label': 'Password for your email account', value: 'x' })] }), { password: true, maybe: true, focus: null }],
    ['a page signed in with an email field', page(form(field({ type: 'email' }))), { password: false, focus: null }],
    // Catches an ordinary page paused as a sign-in: a number field named for a password (a generator's length).
    ['a number field named for a password, holding a length', doc({ passwords: [field({ type: 'number', name: 'password_length', value: '20' })] }), { password: false, focus: null }],
    // Catches an email field that names a password held past Continue: the walk would never type the email.
    ['an email field to reset a password, holding one', doc({ passwords: [field({ placeholder: 'Email to reset your password', value: 'dana@example.com' })] }), { password: true, maybe: true, focus: null }],
    ['focus on a shown password (a text field marked current-password)', doc({ active: field({ autocomplete: 'current-password' }) }), { password: false, focus: 'password' }],
    ['a disabled placeholder holding dots', page(form(field({ type: 'email' })), form(field({ type: 'password', value: '••••••', disabled: true }))), { password: false, focus: null }],
    ['focus on a password field', doc({ active: field({ type: 'password' }) }), { password: false, focus: 'password' }],
    ['focus on a text field whose placeholder asks for a password, typed into', doc({ active: field({ placeholder: 'Password' }) }), { password: false, focus: null }],
    ['focus on a card number', doc({ active: field({ autocomplete: 'shipping cc-number' }) }), { password: false, focus: 'card' }],
    ['focus on a one-time code', doc({ active: field({ autocomplete: 'one-time-code' }) }), { password: false, focus: 'code' }],
    ['focus in a frame on another origin', doc({ active: frame(null) }), { password: false, focus: 'frame' }],
    ['focus on a password field in a frame on its origin', doc({ active: frame(doc({ active: field({ type: 'password' }) })) }), { password: false, focus: 'password' }],
    ['focus on a plain field', doc({ active: field({ autocomplete: 'email' }) }), { password: false, focus: null }],
  ]) {
    it(`sees ${label}`, () => { assert.deepEqual(seen(document), { filled: false, maybe: expected.filled === true, ...expected, status: 200 }); });
  }

  // Catches a password the person shows with the site's "show password" button, at a sign-in pause, let past by their
  // Continue as a plain text field, and typed into: a field seen as a password stays one.
  it('sees a password field it saw as one once a button shows it as text', () => {
    const shown = field({ type: 'password' });
    const page = doc({ passwords: [shown], active: shown });
    assert.deepEqual(seen(page), { password: true, filled: false, maybe: false, focus: 'password', status: 200 });
    Object.assign(shown, { type: 'text', value: 'x' });
    assert.deepEqual(seen(page), { password: true, filled: true, maybe: true, focus: 'password', status: 200 });
  });

  // Catches a "show password" button that swaps in a new, unmarked text field holding the password, before or after
  // it is typed: the walk went on and pictured it, and a guard that reads only the marks (the page helpers'
  // `clickByText`) read it. It is marked as a field that may hold a secret: covered and unread, and never a stop, so a
  // Company once a password field beside it went (a checkout's account unticked) costs a black box only. And, the other
  // way, a Company typed beside a password it never replaced, or in the next step drawn in the sign-in's form, is plain.
  for (const [label, swap, typed, expected, attrs = {}, kept = {}] of [
    ['a password a button swapped for a new text field', true, true, { filled: false, marked: true }],
    ['a password field a button swapped while empty, then typed into', true, false, { filled: false, marked: true }],
    ['a password a button swapped for a new text field named for one', true, true, { filled: false, maybe: true, marked: false }, { placeholder: 'Password' }],
    ['a sign-up’s company typed beside its password', false, true, { filled: false, marked: false }, { name: 'company' }],
    ['a company typed once the password field beside it went', 'gone', true, { filled: false, marked: true }, { name: 'company' }],
    ['a company typed in the next step, drawn in the sign-in’s form', 'step', true, { filled: false, marked: false }, { name: 'company' }],
    ['a company filled in the next step, drawn in the sign-in’s form with as many fields', 'next', true, { filled: false, marked: false }, { name: 'company' }],
    // Catches a new field that keeps the password field's placeholder, shown before typing, and a Show that also adds a
    // line beside it: each was let go.
    ['a password a button swapped while empty for a field with its placeholder, then typed into', true, false, { filled: false, marked: true }, { placeholder: '••••••••' }, { placeholder: '••••••••' }],
    ['a password a button swapped for a new text field and a line beside it', 'line', true, { filled: false, marked: true }],
    // Catches a filled name beside the password taking the mark at a Show before typing, and a text field named for a
    // password swapped for a bare one: the password typed in the new field was pictured and read. And a checkout whose
    // account section was hidden, not removed: its filled fields went black.
    ['a password a button swapped while empty beside a filled name, then typed into', 'beside', false, { filled: false, marked: true }],
    ['a text field named for a password a button swapped for a bare one', true, true, { filled: false, marked: true }, {}, { type: 'text', name: 'password' }],
    ['a text field named user[password] a button swapped for a bare one', true, true, { filled: false, marked: true }, {}, { type: 'text', name: 'user[password]' }],
    // Catches a swap hidden by an email field named for a password mounted with it (Forgot password?): no fewer fields.
    ['a password a button swapped while a reset email field mounts beside it', 'forgot', true, { filled: false, marked: true }],
    ['a text field named password_reset[password] a button swapped for a bare one', true, true, { filled: false, marked: true }, {}, { type: 'text', name: 'password_reset[password]' }],
    ['a company typed once the password field beside it was hidden', 'hide', true, { filled: false, marked: false }, { name: 'company' }],
  ]) {
    it(`sees ${label}`, () => {
      const fields = form(field({ type: 'email', value: 'dana@example.com' }), field({ type: 'password', ...kept }), ...(swap === 'beside' ? [field({ name: 'fullname', value: 'Dana Ray' })] : []));
      const page = doc({ inputs: fields, passwords: fields });
      seen(page);
      const text = field({ ...attrs, value: typed ? 'x' : '' });
      text.form = text.parentElement = fields[0].form;
      if (swap === 'step') fields.splice(0, 2, text);
      else if (swap === 'next') fields.splice(0, 2, field({ name: 'first-name' }), text);
      else if (swap === 'line') fields.splice(1, 1, text, { tagName: 'SMALL' });
      else if (swap === 'gone') fields.splice(1, 1) && fields.unshift(text);
      else if (swap === 'forgot') (fields[1] = text) && fields.push(Object.assign(field({ type: 'email', placeholder: 'Email to reset your password' }), { form: text.form, parentElement: text.form }));
      else if (swap === 'hide') (fields[1] = Object.assign(field({ type: 'password', 'data-impeccable-secret-field': '' }, 0), { form: text.form })) && fields.push(text);
      else if (swap) fields[1] = text;
      else fields.push(text);
      if (typed) text.value = 'x';
      else { seen(page); text.value = 'x'; }
      const now = seen(page);
      assert.deepEqual({ filled: now.filled, maybe: now.maybe, marked: text.getAttribute('data-impeccable-secret-maybe') !== null }, { maybe: expected.marked, ...expected });
    });
  }

  it('sees a 401 page', () => { assert.equal(seen(doc(), 401).status, 401); });

  for (const [url, expected] of [
    ['https://accounts.google.com/o/oauth2/auth', true],
    ['https://acme.okta.com/login', true],
    ['https://github.com/login/oauth/authorize', true],
    ['https://github.com/acme/web', false],
    ['https://okta.com.example.com/', false],
    ['http://localhost:3000/login', false],
  ]) {
    it(`takes ${url} ${expected ? 'for' : 'not for'} a sign-in page`, () => { assert.equal(isSignInPage(url), expected); });
  }
});

// The generated page helpers as carried: a regenerate that drops one of these fixes fails here.
describe('walk page helpers', () => {
  // Catches what a card code holds hashed into the page signature the server gets, which it could brute-force back.
  for (const [label, attrs, changes] of [
    ['a card security code', { autocomplete: 'cc-csc' }, false],
    ['a search', { placeholder: 'Search' }, true],
  ]) {
    it(`signs the page ${changes ? 'anew' : 'the same'} whatever ${label} field holds`, async () => {
      const { helpers } = await import('../extension/walks/page-helpers.js');
      const field = { tagName: 'INPUT', value: '', getAttribute: (n) => attrs[n] ?? null };
      const signed = (value) => { field.value = value; return vm.runInNewContext(`(${helpers.pageSignature})()`, { location: { href: 'https://shop.example/pay' }, document: { body: { innerText: 'Pay' }, querySelectorAll: () => [field] } }); };
      assert.equal(signed('123') !== signed('456'), changes);
    });
  }
});

describe('walk mark on our pages', () => {
  it('writes the extension version, which the app takes as current (0.2.0 or later)', () => {
    const root = { dataset: {} };
    let heard;
    const chrome = { runtime: { id: 'ext', getManifest: () => MANIFEST, onMessage: { addListener: (listener) => { heard = listener; } } } };
    vm.runInNewContext(readFileSync(path.join(ROOT, 'extension/walks/present.js'), 'utf8'), { document: { documentElement: root }, chrome });
    assert.equal(root.dataset.impeccableWalks, MANIFEST.version);
    // It tells the worker it is here (so the page is not reloaded mid-hand-off), and tells nobody else anything.
    const answers = [];
    for (const id of ['ext', 'other']) heard({ walks: 'here' }, { id }, (answer) => answers.push([id, answer.here]));
    assert.deepEqual(answers, [['ext', true]]);
    const [major, minor] = MANIFEST.version.split('.').map(Number);
    assert.ok(major > 0 || minor >= 2, MANIFEST.version);
  });
});

// The real Chrome worker (detector, then walks) on a stubbed browser: both halves share one set of listeners.
describe('walk worker', () => {
  const listeners = {};
  const event = (name) => ({ addListener(callback) { (listeners[name] ??= []).push(callback); } });
  const area = () => {
    const kept = {};
    return {
      async get(key) { return typeof key === 'string' ? { [key]: kept[key] } : { ...key }; },
      async set(values) { Object.assign(kept, values); },
      async remove(key) { delete kept[key]; },
    };
  };
  const sockets = [];
  globalThis.WebSocket = class { static OPEN = 1; constructor(url, protocols) { Object.assign(this, { url, protocols }); sockets.push(this); } close() {} };
  const toolbar = [];
  const titles = [];
  globalThis.chrome = {
    runtime: {
      id: 'ext', onMessage: event('message'), onConnect: event('connect'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (file) => `chrome-extension://ext/${file}`, async sendMessage() {}, getManifest: () => MANIFEST,
    },
    action: { async setPopup({ popup }) { toolbar.push({ popup }); }, async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle({ title }) { titles.push(title); } },
    debugger: { onEvent: event('debugger-event'), onDetach: event('detach') },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } } },
    tabs: { onRemoved: event('removed'), onReplaced: event('replaced'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {} },
    sidePanel: { async open() {}, async setPanelBehavior({ openPanelOnActionClick }) { toolbar.push({ openPanelOnActionClick }); } },
    // The walked tab's frames: the top document alone, unless a test gives it more.
    webNavigation: { frames: [{ frameId: 0, parentFrameId: -1 }], async getAllFrames() { return this.frames; } },
    // The extension's own cover, and its blank fields for a sign-in's still, run in the top document (frame 0); nothing else answers.
    scripting: { async executeScript({ func }) { return ['coverSecrets', 'coverHolds', 'blankFields'].includes(func?.name) ? [{ frameId: 0, result: 0 }] : []; } },
    // Chrome's session rules (net-hold.js), with the two a walk left before this worker restarted.
    declarativeNetRequest: {
      rules: [{ id: 20541 }, { id: 20542 }],
      async getSessionRules() { return this.rules; },
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) { this.rules = [...this.rules.filter((rule) => !removeRuleIds.includes(rule.id)), ...addRules]; },
    },
  };
  const loaded = import('../extension/walks/worker.js');

  it('clears the network rules a walk left when the worker starts', async () => {
    await loaded;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(chrome.declarativeNetRequest.rules, []);
  });

  const handOver = (sender) => new Promise((resolve) => {
    for (const listener of listeners.message) listener({ handoff: JSON.stringify(block()) }, sender, resolve);
  });
  const fromPage = { id: 'ext', frameId: 0, url: PAGE, tab: { id: 4, windowId: 1, url: PAGE } };

  for (const [label, sender] of [
    ['a frame inside our page', { ...fromPage, frameId: 1 }],
    ['another extension', { ...fromPage, id: 'other' }],
  ]) {
    it(`refuses a hand-off from ${label}`, async () => {
      await loaded;
      assert.deepEqual(await handOver(sender), { ok: false, why: 'origin' });
    });
  }

  it('takes a hand-off from our walk page and opens its socket with the ticket', async () => {
    await loaded;
    assert.deepEqual(await handOver(fromPage), { ok: true });
    for (let turn = 0; turn < 50 && sockets.length === 0; turn++) await new Promise((resolve) => setImmediate(resolve));
    const { url, protocols } = sockets.at(-1);
    assert.deepEqual({ url, protocols }, { url: block().socket, protocols: ['impeccable-outing', block().ticket] });
  });

  // The server walks the person's Chrome only with a helper that says it holds every write.
  it('says in its hello that it holds the tab’s writes, and which page helpers it carries', async () => {
    await loaded;
    const ws = sockets.at(-1);
    const heard = [];
    Object.assign(ws, { readyState: 1, send: (text) => heard.push(JSON.parse(text)) });
    ws.onopen();
    assert.ok(heard[0].hello.can.includes('hold'));
    assert.equal(heard[0].hello.version, MANIFEST.version);
    // Which page helpers it carries: the hash of the two files as they are, so a server can tell an older set.
    const [helperFile, consentFile] = ['page-helpers.js', 'consent-rules.js'].map((f) => readFileSync(path.join(ROOT, 'extension/walks', f), 'utf8'));
    const hashed = createHash('sha256').update(helperFile.slice(0, helperFile.indexOf('\n/** This file'))).update(consentFile).digest('hex').slice(0, 16);
    assert.equal(heard[0].hello.helpers, hashed);
  });

  it('points the toolbar icon at the walk panel while a walk is under way, and back at the popup after', async () => {
    await loaded;
    // The server calls the walk off.
    sockets.at(-1).onclose({ reason: 'cancelled' });
    assert.deepEqual(toolbar.slice(-4), [{ popup: '' }, { openPanelOnActionClick: true }, { popup: MANIFEST.action.default_popup }, { openPanelOnActionClick: false }]);
  });

  it('ends a walk the server switched off as failed, said once in the panel and the toolbar', async () => {
    await loaded;
    const { current } = await import('../extension/walks/store.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    const before = sockets.length;
    assert.deepEqual(await handOver(fromPage), { ok: true });
    for (let turn = 0; turn < 50 && sockets.length === before; turn++) await new Promise((resolve) => setImmediate(resolve));
    sockets.at(-1).onclose({ reason: 'switched off' });
    sockets.at(-1).onclose({ reason: 'switched off' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([current().state, current().failure.reason, titles.at(-1)], ['failed', 'switched-off', COPY.failed['switched-off']]);
    assert.equal(titles.filter((title) => title === COPY.failed['switched-off']).length, 1);
  });

  // A journey from the command or an agent comes through our page, with no panel to pick: the card's sight, beside the
  // block (an older build refuses it inside), draws its pictures. One pixel each: red, then white.
  it('draws the pictures of a journey our page hands over as the persona card’s sight sees them', async () => {
    await loaded;
    const { seenAs } = await import('../extension/walks/sight.js');
    const taken = btoa(String.fromCharCode(255, 0, 0, 255, 255, 255, 255, 255));
    const kept = { bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
    globalThis.createImageBitmap = async (blob) => ({ width: 2, height: 1, px: new Uint8ClampedArray(await blob.arrayBuffer()), close() {} });
    globalThis.OffscreenCanvas = class {
      getContext() { const canvas = this; return { drawImage(bitmap) { canvas.px = bitmap.px; }, getImageData: () => ({ data: canvas.px }), putImageData({ data }) { canvas.px = data; } }; }
      async convertToBlob() { return new Blob([this.px]); }
    };
    const walk = async (sees) => {
      const before = sockets.length;
      const answer = await new Promise((resolve) => { for (const listener of listeners.message) listener({ handoff: JSON.stringify(block()), ...(sees ? { sees } : {}) }, fromPage, resolve); });
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await new Promise((resolve) => setImmediate(resolve));
      const seen = await seenAs(taken, 'png');
      sockets.at(-1).onclose({ reason: 'cancelled' });
      return { ok: answer.ok, changed: seen !== taken };
    };
    try {
      assert.deepEqual(await walk('older-eyes'), { ok: true, changed: true });
      assert.deepEqual(await walk('x-ray'), { ok: true, changed: false }, 'a sight no filter draws: the picture as taken');
      assert.deepEqual(await walk(null), { ok: true, changed: false });
    } finally {
      Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas });
    }
  });

  // A reload mid-hand-off loses the walk: added, the extension reloads only the start pages that cannot have handed one over.
  it('reloads, once added, only the start pages its content script is not on and no hand-off came from', async () => {
    await loaded;
    const outing = (id) => ({ id, url: `http://app.localhost:8794/app/acme/outings/o${id}` });
    const reloaded = [];
    const { query, sendMessage, reload } = chrome.tabs;
    await chrome.storage.session.set({ handoff: { tabId: 2 } });
    Object.assign(chrome.tabs, {
      async query() { return [outing(1), outing(2), outing(3), { id: 4, url: 'https://example.com/' }]; },
      async sendMessage(id, message) { if (id === 3 && message.walks === 'here') return { here: true }; throw new Error('Receiving end does not exist'); },
      async reload(id) { reloaded.push(id); },
    });
    try {
      for (const listener of listeners.installed) listener({ reason: 'install' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(reloaded, [1]);
    } finally {
      Object.assign(chrome.tabs, { query, sendMessage, reload });
      await chrome.storage.session.remove('handoff');
    }
  });

  // A walked tab on a stubbed debugger, opened after the tests above: every command the walk sends it, in order,
  // and what the other end is told.
  const sent = [];
  /** Each command's params, beside `sent`. */
  const args = [];
  const told = [];
  const page = { seen: {} };
  const answers = {
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', loaderId: 'l1', url: 'about:blank' } } }),
    // Chrome commits a new document at the address, then loads it.
    'Page.navigate': ({ url }) => {
      const loaderId = `nav-${(navigations += 1)}`;
      setTimeout(() => {
        fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url } });
        fire('Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId });
      }, 1);
      return { loaderId };
    },
    'Page.getLayoutMetrics': () => ({ cssLayoutViewport: { clientWidth: 100, clientHeight: 80 } }),
    'Page.captureScreenshot': () => new Promise((resolve) => setTimeout(() => resolve({ data: btoa(String(sent.length)) }), 5)),
    // One context a world: the walk's lookout is 9, any other world its own.
    'Page.createIsolatedWorld': ({ worldName }) => ({ executionContextId: worlds[worldName] ??= 9 + Object.keys(worlds).length }),
    'Runtime.evaluate': () => ({ result: { value: page.seen } }),
    // Chrome commits a new document on the same address, then loads it.
    'Page.reload': () => {
      const loaderId = `reload-${(reloads += 1)}`;
      setTimeout(() => {
        fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url: page.url() } });
        fire('Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId });
      }, 1);
      return {};
    },
    'Page.addScriptToEvaluateOnNewDocument': () => ({ identifier: String((scripts += 1)) }),
  };
  const worlds = {};
  let reloads = 0;
  let navigations = 0;
  let scripts = 0;
  const fireOn = (tabId, method, params) => { for (const listener of listeners['debugger-event']) listener({ tabId }, method, params); };
  const fire = (method, params) => fireOn(11, method, params);
  const since = (at, method) => sent.slice(at).filter((m) => m === method).length;
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let opened;
  const walked = () => (opened ??= (async () => {
    await loaded;
    Object.assign(chrome.debugger, {
      async attach() {}, async detach() {},
      async sendCommand(_target, method, params) { sent.push(method); args.push(params); return (answers[method] ?? (() => ({})))(params); },
    });
    Object.assign(chrome.tabs, {
      async create() { return { id: 11, windowId: 1 }; }, async get() { return { id: 11, windowId: 1, width: 800, height: 600, active: true }; },
      async group() { return 5; }, async remove() {}, async update() {},
    });
    chrome.tabGroups = { async update() {}, async get() { return { title: 'Impeccable · Mira' }; } };
    chrome.windows = { async get() { return { focused: true, state: 'normal', width: 800, height: 600 }; } };
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob([String(sent.length)]); } };
    const driver = await import('../extension/walks/driver.js');
    page.url = () => driver.walk?.url;
    const control = await import('../extension/walks/control.js');
    const { current, dispatch } = await import('../extension/walks/store.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    driver.speak((message) => told.push(message));
    await driver.ops.open({ url: 'http://localhost:3000/', name: 'Mira', signInPage: true });
    return { ...driver, ...control, current, dispatch, COPY };
  })());

  after(async () => { if (opened) await (await opened).ops.close(); });

  // Chrome (a 2x display, the tab at the engine's size) lands a mouse event it takes while a picture is being taken at
  // twice its coordinates: a test app's login links were clicked on nothing while the step was filmed.
  // A native list's menu is Chrome's own, outside every picture, and on a Mac a click or an arrow opens it: Talia never
  // got past a test app's "How did you hear about us?".
  it('focuses a native list on a click and steps its choice by arrow key, with input and change, never opening its menu', async () => {
    const { ops } = await walked();
    page.seen = {};
    // The page, as the walk's own world reads it: one list of four, the third disabled, and a field beside it.
    class HTMLOptGroupElement {}
    class HTMLSelectElement {
      constructor(labels) {
        this.multiple = false; this.size = 0; this.disabled = false; this.fired = [];
        this.options = labels.map((label, n) => {
          const list = this;
          return { label, disabled: label.startsWith('-'), parentElement: null, get selected() { return list.selectedIndex === n; }, set selected(on) { if (on) list.selectedIndex = n; } };
        });
        this.selectedIndex = 0;
      }
      closest() { return this; }
      focus() { dom.document.activeElement = this; }
      dispatchEvent(event) { this.fired.push(event.type); }
    }
    const list = new HTMLSelectElement(['Choose one', 'Friend or family', '-Poster', 'Search']);
    const field = { closest: () => null };
    const dom = vm.createContext({ HTMLSelectElement, HTMLOptGroupElement, Event: class { constructor(type) { this.type = type; } }, document: { activeElement: field, elementFromPoint: (x) => (x === 5 ? list : field) } });
    const was = answers['Runtime.evaluate'];
    answers['Runtime.evaluate'] = (params) => (/focusListAt|stepList/.test(params.expression) ? { result: { value: vm.runInContext(params.expression, dom) } } : was(params));
    const keys = (from) => sent.slice(from).filter((m) => m === 'Input.dispatchKeyEvent').length;
    try {
      let at = sent.length;
      await ops.mouse({ action: 'click', x: 5, y: 5 });
      assert.deepEqual([dom.document.activeElement === list, since(at, 'Input.dispatchMouseEvent')], [true, 1], 'focused, the pointer only moved there');
      at = sent.length;
      for (const key of ['ArrowDown', 'ArrowDown', 'Enter', 'ArrowUp', 'End']) await ops.keyboard({ action: 'press', key });
      assert.deepEqual([list.selectedIndex, list.fired, keys(at)], [3, ['input', 'change', 'input', 'change', 'input', 'change', 'input', 'change'], 0], 'past the disabled option, and no key reaches Chrome');
      dom.document.activeElement = field;
      at = sent.length;
      await ops.keyboard({ action: 'press', key: 'ArrowDown' });
      assert.equal(keys(at), 2, 'anywhere else a key is pressed');
    } finally {
      answers['Runtime.evaluate'] = was;
    }
  });

  // A screen reader's reads: Chrome's tree of the walked tab and its same-site frames, never a secret field's value or
  // text, never another site's frame, never another tab, and never a protocol method the server names.
  it('hears the walked tab’s accessibility tree and its same-site frames, with no secret field’s value, and nothing else', async () => {
    const { ops } = await walked();
    page.seen = {};
    const text = (id, name, parent) => ({ nodeId: id, role: { value: 'StaticText' }, name: { value: name }, childIds: [], parent });
    const top = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '4', '6', '7'] },
      { nodeId: '2', role: { value: 'textbox' }, name: { value: 'Card number' }, value: { value: '4242 4242 4242 4242' }, backendDOMNodeId: 20, childIds: ['3'] }, text('3', '4242 4242 4242 4242'),
      { nodeId: '4', role: { value: 'searchbox' }, name: { value: 'Search' }, value: { value: 'milk' }, backendDOMNodeId: 40, childIds: ['5'] }, text('5', 'milk'),
      { nodeId: '6', role: { value: 'Iframe' }, backendDOMNodeId: 60, childIds: [] },
      { nodeId: '7', role: { value: 'Iframe' }, backendDOMNodeId: 70, childIds: [] },
    ];
    const inner = [{ nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3', '4'] }, { nodeId: '2', role: { value: 'textbox' }, name: { value: 'Code' }, value: { value: '123456' }, backendDOMNodeId: 90, childIds: [] }, { nodeId: '3', role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'hunter22' }, backendDOMNodeId: 91, childIds: [] }, { nodeId: '4', role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'hunter22' }, backendDOMNodeId: 92, childIds: [] }];
    const elements = { 20: { nodeName: 'INPUT', attributes: ['autocomplete', 'cc-number'] }, 40: { nodeName: 'INPUT', attributes: ['type', 'search'] }, 60: { nodeName: 'IFRAME', frameId: 'own' }, 70: { nodeName: 'IFRAME', frameId: 'away' }, 90: { nodeName: 'INPUT', attributes: ['autocomplete', 'one-time-code'] }, 91: { nodeName: 'INPUT', attributes: ['type', 'text', 'data-impeccable-secret-field', ''] }, 92: { nodeName: 'INPUT', attributes: ['type', 'text', 'placeholder', 'Password'] } };
    const was = { ...answers };
    Object.assign(answers, {
      'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', loaderId: 'l1', url: 'http://localhost:3000/' }, childFrames: [{ frame: { id: 'own', url: 'http://localhost:3000/pay' } }, { frame: { id: 'away', url: 'https://cards.example/' } }] } }),
      'Accessibility.getFullAXTree': (params) => ({ nodes: params?.frameId === 'own' ? inner : params?.frameId ? [text('1', 'another site')] : top }),
      'DOM.describeNode': (params) => ({ node: elements[params.backendNodeId] }),
    });
    try {
      const at = sent.length;
      const { value } = await ops.hear({ what: 'tree' });
      const byId = new Map(value.nodes.map((n) => [n.nodeId, n]));
      assert.deepEqual([byId.get('2').value, byId.get('2').name.value, byId.has('3'), byId.get('4').value.value, byId.has('5')], [undefined, 'Card number', false, 'milk', true], 'the card field keeps its label, not its number');
      assert.deepEqual(value.frames.map(([el, nodes]) => [el, nodes ? nodes.filter((n) => n.nodeId !== '1').map((n) => n.value ?? 'blank') : null]), [[60, ['blank', 'blank', 'blank']], [70, null]], 'the same site’s frame is read, its code field and its passwords shown as text (marked, or a new field a button swapped in) blank; another site’s is not');
      assert.deepEqual(args.slice(at).filter((_, i) => sent[at + i] === 'Accessibility.getFullAXTree').map((p) => p?.frameId ?? 'top'), ['top', 'own']);
      // One node by its number: its box, in view, focused. Nothing for another tab, a node by no number, or a method by name.
      answers['DOM.getBoxModel'] = () => ({ model: { border: [1, 2, 3, 2, 3, 4, 1, 4] } });
      assert.deepEqual(await ops.hear({ what: 'box', node: 40 }), { value: [1, 2, 3, 2, 3, 4, 1, 4] });
      const moved = sent.length;
      await ops.hear({ what: 'focus', node: 40 });
      assert.deepEqual(args.slice(moved).filter((_, i) => sent[moved + i] === 'DOM.focus'), [{ backendNodeId: 40 }]);
      await assert.rejects(async () => ops.hear({ what: 'tree', tabId: 3 }), { name: 'NotAllowed' });
      await assert.rejects(async () => ops.hear({ what: 'focus', node: '#pay' }), { name: 'Error' });
      await assert.rejects(async () => ops.hear({ what: 'Runtime.evaluate', node: 40, params: { expression: '1' } }), { name: 'NotSupported' });
    } finally {
      Object.assign(answers, was);
      for (const key of ['Accessibility.getFullAXTree', 'DOM.describeNode', 'DOM.getBoxModel']) if (!(key in was)) delete answers[key];
    }
  });

  it('never moves or clicks the pointer while a film’s picture is being taken, nor takes one while the pointer acts', async () => {
    const { ops } = await walked();
    page.seen = {};
    const was = answers['Page.captureScreenshot'];
    let answer;
    answers['Page.captureScreenshot'] = () => new Promise((resolve) => { answer = () => resolve({ data: btoa('frame') }); });
    try {
      await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
      for (let turn = 0; turn < 50 && !answer; turn++) await settle(5);
      const at = sent.length;
      const clicking = ops.mouse({ action: 'click', x: 5, y: 5 });
      await settle(20);
      assert.equal(since(at, 'Input.dispatchMouseEvent'), 0, 'not while the picture is being taken');
      answer();
      await clicking;
      const pointer = sent.slice(at).flatMap((m, i) => (m === 'Input.dispatchMouseEvent' ? [i] : []));
      assert.equal(pointer.length, 3);
      assert.equal(sent.slice(at + pointer[0], at + pointer[2]).filter((m) => m === 'Page.captureScreenshot').length, 0, 'no picture while it acts');
    } finally {
      answers['Page.captureScreenshot'] = was;
      answer?.();
      await ops.cdp({ method: 'Page.stopScreencast' });
    }
  });

  it('takes and tells nothing of the page while paused, and films again once it goes on', async () => {
    const { ops, command, current } = await walked();
    assert.equal(current().tab, 11, 'the view knows the walked tab, where the panel shows its result');
    await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
    await settle(150);
    assert.ok(since(0, 'Page.captureScreenshot') > 0, 'the film is rolling');
    assert.equal(await command('pause'), true);
    const paused = sent.length;
    const heard = told.length;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l2', url: 'http://localhost:3000/next' } });
    fire('Page.javascriptDialogOpening', { type: 'alert', message: 'Hello' });
    await settle(250);
    assert.equal(since(paused, 'Page.captureScreenshot'), 0, 'no picture is taken while paused');
    assert.ok(!sent.includes('Network.disable'), 'the network stays on: a service worker stays bypassed');
    assert.deepEqual(told.slice(heard).map((m) => m.event ?? 'reply'), [], 'nothing of the page is told');
    assert.equal(await command('resume'), true);
    await settle(150);
    assert.ok(since(paused, 'Page.captureScreenshot') > 0, 'the film rolls again');
    assert.equal(told.slice(heard).find((m) => m.event === 'url')?.url, 'http://localhost:3000/next', 'and the other end hears where the tab is now');
    await ops.cdp({ method: 'Page.stopScreencast' });
  });

  it('films none of the person’s screen while they have the tab, and films again once they hand it back', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
    await settle(100);
    assert.equal(await command('takeover'), true);
    await settle(20);
    const taken = sent.length;
    const frames = told.length;
    await settle(200);
    assert.deepEqual([since(taken, 'Page.captureScreenshot'), told.slice(frames).filter((m) => m.method === 'Page.screencastFrame').length], [0, 0]);
    assert.equal(await command('handback'), true);
    await settle(150);
    assert.ok(since(taken, 'Page.captureScreenshot') > 0, 'the film rolls again');
    await ops.cdp({ method: 'Page.stopScreencast' });
  });

  // `g1` is the goto's own document, committed before Page.navigate answers, as Chrome does it.
  const commit = (loaderId, status) => {
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url: `http://localhost:3000/${loaderId}` } });
    fire('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId, requestId: loaderId, response: { status, headers: {} } });
  };
  const load = (loaderId) => fire('Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId });
  for (const [label, then, status] of [
    ['its own load', () => load('g1'), 200],
    ['the load of the page a script sent it on to', () => { commit('g2', 203); load('g2'); }, 203],
    ['no load from a page that did not follow its own', () => load('l1'), 'TimeoutError'],
  ]) {
    it(`settles a goto on ${label}`, async () => {
      const { ops } = await walked();
      const navigate = answers['Page.navigate'];
      answers['Page.navigate'] = () => { commit('g1', 200); return { loaderId: 'g1' }; };
      try {
        const went = ops.goto({ url: 'http://localhost:3000/', waitUntil: 'load', timeout: 60 });
        await settle(5);
        then();
        assert.equal(await went.then((r) => r.value.status, (err) => err.name), status);
      } finally {
        answers['Page.navigate'] = navigate;
      }
    });
  }

  // Each sign on a document of its own, as Chrome commits it: the still is taken once a document.
  const fresh = (loaderId) => fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url: `http://localhost:3000/${loaderId}` } });
  // A sign-in page drawn for a persona's sight goes with the picture as taken, as WebP, while the message fits what the
  // server rejoins (16 Mi characters); past that without it, the walk going on. A 10M-character still at a screen's density.
  for (const [label, webpBytes, kept] of [['beside it as WebP', 600_000, true], ['without it where both would not fit', 6_000_000, false]]) {
    it(`sends a sign-in page seen with older eyes with the picture as taken ${label}`, async () => {
      const { ops, command, current } = await walked();
      const { handoff } = await chrome.storage.session.get('handoff');
      const was = { shot: answers['Page.captureScreenshot'], bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
      answers['Page.captureScreenshot'] = () => ({ data: 'Q'.repeat(10_000_000) });
      globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
      globalThis.OffscreenCanvas = class {
        getContext() { const px = new Uint8ClampedArray(8); return { drawImage() {}, getImageData: () => ({ data: px }), putImageData() {} }; }
        async convertToBlob({ type }) { return type === 'image/webp' ? new Blob(['RIFF', new Uint8Array(webpBytes)]) : new Blob([new Uint8Array(7_500_000)]); }
      };
      await chrome.storage.session.set({ handoff: { ...handoff, sees: 'older' } });
      const heard = told.length;
      let asked;
      try {
        fresh(`s9-${webpBytes}`);
        page.seen = { password: true };
        asked = ops.url();
        for (let turn = 0; turn < 400 && !told.slice(heard).some((m) => m.event === 'sign-in-page'); turn++) await settle(5);
      } finally {
        await chrome.storage.session.set({ handoff });
        answers['Page.captureScreenshot'] = was.shot;
        Object.assign(globalThis, { createImageBitmap: was.bitmap, OffscreenCanvas: was.canvas });
      }
      const message = told.slice(heard).find((m) => m.event === 'sign-in-page');
      assert.deepEqual([current().state, message.still.length, message.plain === undefined ? null : atob(message.plain.slice(0, 8)).slice(0, 4), JSON.stringify(message).length < 16 * 1024 * 1024], ['paused', 10_000_000, kept ? 'RIFF' : null, true]);
      page.seen = {};
      assert.equal(await command('resume'), true);
      await asked;
    });
  }
  // Each sign of a sign-in pauses the walk before anything else is done, and Continue keeps it paused while a 401 holds.
  // The page is pictured once as it pauses, every field blank, where it shows one to sign in with (`pictured`), and
  // never where a frame of it could not be drawn blank (`unblank`): a field Chrome filled would show, nor where the tab
  // moved on while it was taken or its title read (`moved`): the picture and the title would be of the next page. Its
  // title goes with its picture only, and neither to a server that never said it takes them (`older`).
  let blankFields;
  for (const [sign, show, pictured, unblank = false, older = false] of [
    ['a visible password field', () => { fresh('s1'); page.seen = { password: true }; }, true],
    ['a move to a sign-in host', () => { fresh('s2'); fire('Fetch.requestPaused', { requestId: 'r1', resourceType: 'Document', frameId: 'main', request: { url: 'https://accounts.google.com/signin' } }); }, false],
    ['a 401 asking for a password', () => { page.seen = { status: 401 }; fresh('l2'); fire('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId: 'l2', requestId: 'r2', response: { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } } }); }, false],
    ['a password field Chrome filled, on a page a frame of which can’t be drawn blank', () => { fresh('s4'); page.seen = { password: true, filled: true }; }, false, true],
    ['a visible password field, the tab moving on as it is pictured', () => {
      fresh('s5'); page.seen = { password: true };
      const was = answers['Page.captureScreenshot'];
      answers['Page.captureScreenshot'] = (params) => { answers['Page.captureScreenshot'] = was; fresh('s6'); return was(params); };
    }, false, 'moved'],
    ['a visible password field, the tab moving on as its title is read', () => {
      fresh('s7'); page.seen = { password: true };
      const at = sent.length, was = chrome.tabs.get;
      chrome.tabs.get = async (id) => {
        const tab = await was(id);
        if (!sent.slice(at).includes('Page.captureScreenshot')) return tab;
        chrome.tabs.get = was;
        fresh('s8');
        return { ...tab, title: 'Inbox (3)' };
      };
    }, false, 'moved'],
    ['a visible password field, for a server that never said it takes its picture', () => { fresh('s9'); page.seen = { password: true }; }, false, false, true],
  ]) {
    it(`pauses itself at ${sign}, until the sign-in is gone`, async () => {
      const { ops, command, current, COPY, walk } = await walked();
      const { get } = chrome.tabs;
      chrome.tabs.get = async (id) => ({ ...(await get(id)), title: 'Sign in' });
      walk.signInPage = !older;
      // What the walk was doing as the guard first answered the tab.
      const { sendCommand } = chrome.debugger;
      let answeredWhile;
      chrome.debugger.sendCommand = async (target, method, params) => { if (method.startsWith('Fetch.')) answeredWhile ??= current().state; return sendCommand(target, method, params); };
      const { executeScript } = chrome.scripting, blanks = [];
      chrome.scripting.executeScript = async (call) => { if (call.func?.name === 'blankFields') { blankFields = call.func; blanks.push(call.args[0]); if (unblank === true && call.args[0]) return []; } else if (call.func?.name === 'coverSecrets' && call.args[0]) blanks.push('cover'); return executeScript(call); };
      const shots = sent.length, heard = told.length;
      try { show(); } finally { setTimeout(() => { chrome.debugger.sendCommand = sendCommand; }, 10); }
      let answered = false;
      const asked = ops.url().then(() => { answered = true; });
      for (let turn = 0; turn < 40 && !told.slice(heard).some((m) => m.event === 'sign-in-page'); turn++) await settle(5);
      Object.assign(chrome.scripting, { executeScript });
      Object.assign(chrome.tabs, { get });
      walk.signInPage = true;
      // The pause says it kept a picture only where it did.
      assert.deepEqual([current().state, current().held, current().pictured, titles.at(-1), answered], ['paused', 'sign-in', pictured, pictured ? COPY.signInPictured : COPY.signIn, false]);
      // Fields blank, then secrets covered, the one picture, and both off again; none at all where nothing shows to sign in with.
      const pages = told.slice(heard).filter((m) => m.event === 'sign-in-page');
      assert.deepEqual([pages.map((m) => [typeof m.still, m.title]), since(shots, 'Page.captureScreenshot'), blanks], older ? [[], 0, []] : pictured || unblank === 'moved' ? [[pictured ? ['string', 'Sign in'] : ['undefined', undefined]], 1, [true, 'cover', false]] : [[['undefined', undefined]], 0, unblank ? [true, false] : []]);
      assert.equal(told.filter((m) => m.event === 'paused').length, told.filter((m) => m.event === 'resumed').length + 1, 'the other end is told once');
      if (sign === 'a move to a sign-in host') assert.equal(answeredWhile, 'paused', 'paused before the guard answered');
      else if (sign === 'a 401 asking for a password') {
        const at = told.length;
        assert.equal(await command('resume'), false, 'Continue while it still shows');
        assert.equal(await command('resume'), false);
        assert.equal(current().state, 'paused');
        // Told the other end while paused, once however often it is pressed.
        assert.deepEqual(told.slice(at).filter((m) => m.event === 'note'), [{ event: 'note', what: 'continue-refused', why: 'sign-in' }]);
      }
      assert.equal(told.filter((m) => m.event === 'paused').at(-1).why, 'sign-in');
      page.seen = {};
      assert.equal(await command('resume'), true);
      await asked;
      assert.deepEqual([answered, current().state, current().held, titles.at(-1)], [true, 'walking', null, MANIFEST.name]);
    });
  }

  // The page's own `!important` rules can't show a filled field: each field's own style says it, important, and is put
  // back as it was, also where a frame's run and the run of the page round it both reach it.
  it('blanks a sign-in page’s fields through their own style, and puts it back', () => {
    const style = (init) => {
      const props = new Map(Object.entries(init));
      return { props, setProperty(prop, value, priority = '') { props.set(prop, [value, priority]); }, removeProperty(prop) { props.delete(prop); }, getPropertyValue: (prop) => props.get(prop)?.[0] ?? '', getPropertyPriority: (prop) => props.get(prop)?.[1] ?? '' };
    };
    const field = (value, init = {}, autofill = false) => {
      const attrs = new Map([['style', 'x']]);
      return { value, isContentEditable: false, style: style(init), hasAttribute: (n) => attrs.has(n), getAttribute: (n) => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, String(v)), removeAttribute: (n) => attrs.delete(n), matches: (sel) => autofill && sel === ':-webkit-autofill' };
    };
    const [typed, empty, autofilled] = [field('dana@example.com'), field('', { color: ['red', ''] }), field('', {}, true)];
    class Sheet { cssRules = []; insertRule(rule) { this.cssRules.push({ cssText: rule }); } }
    const document = { adoptedStyleSheets: [], querySelectorAll: (sel) => (sel === '*' ? [] : [typed, empty, autofilled]) };
    const [page, frame] = [0, 1].map(() => vm.createContext({ CSSStyleSheet: Sheet, setTimeout: () => 0, clearTimeout() {}, document }));
    const of = (f) => Object.fromEntries([...f.style.props].map(([prop, [value, priority]]) => [prop, `${value}${priority ? ' !' : ''}`]));
    for (const world of [page, frame]) assert.equal(vm.runInContext(`(${blankFields})(true, 0)`, world), 3);
    assert.deepEqual([of(typed).filter, of(typed)['-webkit-text-fill-color'], of(empty).filter, of(empty).color, of(autofilled).filter], ['brightness(0) !', 'transparent !', undefined, 'transparent !', 'brightness(0) !']);
    for (const world of [page, frame]) vm.runInContext(`(${blankFields})(false)`, world);
    assert.deepEqual([of(typed), of(empty), of(autofilled), [typed, empty, autofilled].some((f) => f.hasAttribute('data-impeccable-still-blank')), document.adoptedStyleSheets.length], [{}, { color: 'red' }, {}, false, 0]);
  });

  it('tells the other end again when the person’s pause becomes a sign-in pause', async () => {
    const { command, current } = await walked();
    page.seen = {};
    const at = told.length;
    assert.equal(await command('pause'), true);
    fire('Fetch.requestPaused', { requestId: 'r-pause', resourceType: 'Document', frameId: 'main', request: { url: 'https://accounts.google.com/signin' } });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.deepEqual(told.slice(at).filter((m) => m.event === 'paused').map((m) => m.why), [undefined, 'sign-in']);
    assert.equal(await command('resume'), true);
  });

  // A page the detector reads as a sign-in that is not one (a settings page signed in): Continue is the person's word,
  // and the walk goes on there. Another page with a password field pauses it again.
  it('goes on at Continue past a password field on that page, and pauses again on the next', async () => {
    const { ops, command, current } = await walked();
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l8', url: 'http://localhost:3000/settings' } });
    page.seen = { password: true };
    // Pictures, as a terminal walk takes one each step (the address stays the page's).
    const asked = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.equal(await command('resume'), true, 'Continue while the field still shows');
    await asked;
    await ops.screenshot({ format: 'png' });
    await settle(20);
    assert.equal(current().state, 'walking', 'that page pauses no more');
    page.seen = { password: true, filled: true };
    const filled = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in'], 'a password in a field there pauses it again');
    assert.equal(await command('resume'), false, 'and Continue waits while it is filled');
    page.seen = { password: true };
    assert.equal(await command('resume'), true);
    await filled;
    // Another page of an app routed by its hash: a new address, so a new page.
    fire('Page.navigatedWithinDocument', { frameId: 'main', url: 'http://localhost:3000/settings#/elsewhere' });
    const next = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in'], 'the next page pauses');
    page.seen = {};
    await command('resume');
    await next;
    // Off the page Continue was pressed on, for the tests after.
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l10', url: 'http://localhost:3000/' } });
  });

  // A script can wait (`awaitPromise`) for a password to be filled, then read it: what it found never goes out.
  it('refuses a script whose page got a password filled while it ran, and pauses at the sign-in', async () => {
    const { ops, command, current } = await walked();
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l11', url: 'http://localhost:3000/account' } });
    page.seen = {};
    const { sendCommand } = chrome.debugger;
    let fill;
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (!String(params?.expression).includes('waitForFill')) return sendCommand(target, method, params);
      return new Promise((done) => { fill = () => { page.seen = { password: true, filled: true }; done({ result: { value: 'hunter2' } }); }; });
    };
    try {
      const read = ops.evaluate({ fn: 'waitForFill', args: [] }).then((out) => out, (err) => err.name);
      for (let turn = 0; turn < 50 && !fill; turn++) await settle(1);
      fill();
      assert.equal(await read, 'Paused', 'refused, as a paused op is, and never answered with what it read');
      assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    } finally {
      chrome.debugger.sendCommand = sendCommand;
      page.seen = {};
      await command('resume');
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l12', url: 'http://localhost:3000/' } });
    }
  });

  // The page's own world and the server's, as one window (`window.name` is the tab's, whichever world reads it): every
  // command outside the walk's lookout runs there, and what it cannot run is answered as before.
  const inWindow = () => {
    const world = vm.createContext({});
    world.window = world;
    const was = answers['Runtime.evaluate'];
    answers['Runtime.evaluate'] = (params) => {
      if (params.contextId === worlds['impeccable-walk-lookout']) return was(params);
      try { return { result: { value: vm.runInContext(params.expression, world) } }; } catch { return was(params); }
    };
    return { world, done: () => { answers['Runtime.evaluate'] = was; } };
  };

  // Off the page Continue was pressed on (its sign-in let past), for the tests after.
  const moveOff = () => fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `off-${(navigations += 1)}`, url: 'http://localhost:3000/' } });

  // Server code from before a pause never meets what the person typed. Each row: a page with a server script
  // for new pages, a pause (a sign-in, or a take-over), what happens meanwhile, then Continue or hand-back and the next
  // picture. The page is never left or loaded again; `window.name` is empty before the next server op; the script is
  // back on, and runs once in a page that started without it (`ran`).
  for (const [row, how, during, ran] of [
    // Catches: the scripts left on for the sign-in page, or never put back.
    ['a sign-in on the same page', 'sign-in', () => {}, 0],
    // Catches: a GET or reload of a page a form posted to (405, or the form sent again), or of a one-time link.
    ['a sign-in on a page a form posted to, its fragment changed', 'sign-in', (at) => fire('Page.navigatedWithinDocument', { frameId: 'main', url: `${at}#done` }), 0],
    // Catches: the page after the sign-in without its page-start scripts (consent rules, system face, locale).
    ['a sign-in the person moved on from', 'sign-in', () => fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `home-${(navigations += 1)}`, url: 'http://localhost:3000/home' } }), 1],
    // Catches: a take-over losing the person's page and their work on it.
    ['a take-over', 'takeover', () => {}, 0],
  ]) {
    it(`takes the server’s page scripts off for ${row}, and puts them back without leaving the page`, async () => {
      const { ops, command, current, walk } = await walked();
      page.seen = {};
      const before = `before-${(navigations += 1)}`;
      const address = `http://localhost:3000/login-${navigations}`;
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: before, url: address } });
      const key = `ran${navigations}`;
      const { identifier } = (await ops.evaluateOnNewDocument({ fn: `() => { window.${key} = (window.${key} ?? 0) + 1; window.${key}Name = window.name; }`, args: [] })).value;
      const { source } = args[sent.lastIndexOf('Page.addScriptToEvaluateOnNewDocument')];
      const { world, done } = inWindow();
      const at = sent.length;
      try {
        let shot;
        if (how === 'sign-in') {
          page.seen = { password: true };
          shot = ops.screenshot({ format: 'png' });
          await settle(20);
          assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
        } else assert.equal(await command('takeover'), true);
        assert.ok(sent.slice(at).some((m, i) => m === 'Page.removeScriptToEvaluateOnNewDocument' && args[at + i].identifier === identifier), 'off as the pause lands');
        await during(address);
        // What code from before the pause stashed where a navigation on the site keeps it.
        world.name = 'copy:hunter2';
        page.seen = {};
        assert.equal(await command(how === 'sign-in' ? 'resume' : 'handback'), true);
        await (shot ?? ops.screenshot({ format: 'png' }));
        assert.equal((await ops.evaluate({ fn: '() => window.name', args: [] })).value, '', 'the next server op finds no name');
        assert.deepEqual([since(at, 'Page.navigate'), since(at, 'Page.reload')], [0, 0], 'the page is never left or loaded again');
        assert.equal(args.slice(at).filter((p, i) => sent[at + i] === 'Page.addScriptToEvaluateOnNewDocument' && p.source === source).length, 1, 'back on');
        assert.deepEqual([world[key] ?? 0, ran ? world[`${key}Name`] : ''], [ran, ''], 'ran once where the page started without it, after the name went');
        if (ran === 0) assert.equal(walk.loader, before, 'the same page, the person’s work on it kept');
        const next = sent.length;
        await ops.screenshot({ format: 'png' });
        assert.deepEqual([since(next, 'Page.addScriptToEvaluateOnNewDocument'), world[key] ?? 0], [0, ran], 'once');
      } finally {
        done();
        moveOff();
      }
    });
  }

  // A script `seal` could not take off may still be on the tab. Each row: how many times Chrome refuses to take it off,
  // and what it says.
  for (const [refusals, said, going] of [
    // Catches: one failed removal ending the walk, where asking again took it off.
    [1, 'Internal error', true],
    // Catches: the walk going on with a script of the server's possibly still on (a failed removal swallowed).
    [3, 'Internal error', false],
    // Catches: a script Chrome no longer has (its debugger gone and back) keeping the walk paused for good.
    [Infinity, 'Script not found', true],
  ]) {
    it(`goes on after a sign-in only once the server’s scripts are off: ${refusals} refused, “${said}”`, async () => {
      const { ops, command, current } = await walked();
      page.seen = {};
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `stuck-${(navigations += 1)}`, url: `http://localhost:3000/stuck-${navigations}` } });
      const { identifier } = (await ops.evaluateOnNewDocument({ fn: `() => ${navigations}`, args: [] })).value;
      let refused = 0;
      answers['Page.removeScriptToEvaluateOnNewDocument'] = (p) => { if (p.identifier === identifier && (refused += 1) <= refusals) throw new Error(JSON.stringify({ code: -32000, message: said })); return {}; };
      try {
        page.seen = { password: true };
        const shot = ops.screenshot({ format: 'png' });
        await settle(20);
        const at = sent.length;
        page.seen = {};
        assert.equal(await command('resume'), going);
        assert.equal(current().state, going ? 'walking' : 'paused');
        if (!going) {
          await settle(20);
          assert.equal(since(at, 'Page.captureScreenshot'), 0, 'nothing taken');
          assert.equal(await command('resume'), true, 'the next press takes it off, and goes on');
        }
        await shot;
      } finally {
        delete answers['Page.removeScriptToEvaluateOnNewDocument'];
        moveOff();
      }
    });
  }

  // The server's scripts go back on after a sign-in whatever goes wrong on the way, each exactly once, and never
  // before `window.name` is cleared. Each row: the trouble, set after Continue, and whether the first op after is refused.
  for (const [row, trouble, refused] of [
    // Catches: an unreadable page leaving the scripts off, every later page-start script refused as Paused.
    ['the page cannot be read', () => { page.seen = null; }, false],
    // Catches: scripts put back before a failed one added a second time, the first copies never taken off.
    ['an add fails partway', (last) => { const add = answers['Page.addScriptToEvaluateOnNewDocument']; answers['Page.addScriptToEvaluateOnNewDocument'] = (p) => { if (p.source === last) { answers['Page.addScriptToEvaluateOnNewDocument'] = add; throw new Error('Internal error'); } return add(p); }; }, true],
    // Catches: the scripts put back with a copy left in `window.name` for them to read.
    ['window.name cannot be cleared', () => { const was = answers['Runtime.evaluate']; answers['Runtime.evaluate'] = (p) => { if (p.contextId !== undefined) return was(p); answers['Runtime.evaluate'] = was; throw new Error('Cannot find context with specified id'); }; }, true],
  ]) {
    it(`puts the server’s scripts back once after a sign-in when ${row}`, async () => {
      const { ops, command, dispatch, walk } = await walked();
      const kept = { ...answers };
      page.seen = {};
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `rough-${(navigations += 1)}`, url: `http://localhost:3000/rough-${navigations}` } });
      for (const n of [1, 2]) await ops.evaluateOnNewDocument({ fn: `() => 'rough${navigations}-${n}'`, args: [] });
      const { source: last } = args[sent.lastIndexOf('Page.addScriptToEvaluateOnNewDocument')];
      const at = sent.length;
      try {
        assert.ok(dispatch({ type: 'pause', why: 'sign-in' }));
        assert.equal(await command('resume'), true);
        trouble(last);
        const first = await ops.url().then(() => 'ok', (err) => err.name);
        assert.equal(first === 'ok', !refused, `first op: ${first}`);
        if (refused) assert.ok(walk.newDocument.some((script) => !script.identifier), 'not all back on yet');
        page.seen = {};
        await ops.url();
        // Asked for: the failed add of the last one asked again, every other once.
        const asked = walk.newDocument.map(({ source }) => args.slice(at).filter((p, i) => sent[at + i] === 'Page.addScriptToEvaluateOnNewDocument' && p.source === source).length);
        assert.deepEqual(asked, walk.newDocument.map(({ source }) => (row === 'an add fails partway' && source === last ? 2 : 1)), 'each back on, once');
        assert.ok(walk.newDocument.every((script) => script.identifier), 'all on');
      } finally {
        Object.assign(answers, kept);
        page.seen = {};
        moveOff();
      }
    });
  }

  // Catches: a page-start script run in the sign-in page a redirect landed on while they were being run.
  it('runs the server’s scripts once in a page that started without them only while the tab is still on it', async () => {
    const { ops, command, dispatch } = await walked();
    const { world, done } = inWindow();
    try {
      page.seen = {};
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `hop-${(navigations += 1)}`, url: `http://localhost:3000/hop-${navigations}` } });
      await ops.evaluateOnNewDocument({ fn: '() => { window.a = (window.a ?? 0) + 1; window.hop(); }', args: [] });
      await ops.evaluateOnNewDocument({ fn: '() => { window.b = (window.b ?? 0) + 1; }', args: [] });
      world.hop = () => {};
      assert.ok(dispatch({ type: 'pause', why: 'sign-in' }));
      // The person signs in on a page of its own, which started with the scripts off.
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `signed-${navigations}`, url: `http://localhost:3000/hop-${navigations}/home` } });
      assert.equal(await command('resume'), true);
      // The first script sends the tab on (a redirect to a sign-in) while the walk runs them.
      world.hop = () => fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `redirect-${navigations}`, url: 'http://localhost:3000/signin' } });
      await ops.url();
      assert.deepEqual([world.a, world.b], [1, undefined]);
    } finally {
      done();
      moveOff();
    }
  });

  // Catches: the server's scripts put back on a sign-in page the walk reached right after Continue.
  it('keeps the server’s scripts off while a sign-in shows after Continue, and puts them back once', async () => {
    const { ops, command, current, dispatch } = await walked();
    page.seen = {};
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `app-${(navigations += 1)}`, url: 'http://localhost:3000/app' } });
    await ops.evaluateOnNewDocument({ fn: `() => 'memory${navigations}'`, args: [] });
    const { source } = args[sent.lastIndexOf('Page.addScriptToEvaluateOnNewDocument')];
    const on = (from) => args.slice(from).filter((p, i) => sent[from + i] === 'Page.addScriptToEvaluateOnNewDocument' && p.source === source).length;
    const at = sent.length;
    assert.ok(dispatch({ type: 'pause', why: 'sign-in' }));
    assert.equal(await command('resume'), true);
    // The site sends the tab to its sign-in again before the walk's next op.
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: `again-${navigations}`, url: 'http://localhost:3000/app/signin' } });
    page.seen = { password: true };
    const shot = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held, on(at)], ['paused', 'sign-in', 0]);
    page.seen = {};
    assert.equal(await command('resume'), true);
    await shot;
    assert.equal(on(at), 1, 'back on once it was signed in');
    moveOff();
  });

  it('runs the server’s page reads in a world of their own, and only the consent rules’ reads in the page’s', async () => {
    const { ops } = await walked();
    page.seen = {};
    // The worlds each read ran in, besides the walk's own lookout.
    const worldsOf = async (fn) => {
      const at = sent.length;
      await ops.evaluate({ fn, args: [] });
      return args.slice(at).filter((p, i) => sent[at + i] === 'Runtime.evaluate' && p.contextId !== worlds['impeccable-walk-lookout']).map((p) => p.contextId);
    };
    assert.deepEqual(await worldsOf('() => document.title'), [worlds['impeccable-walk-read']], 'neither the page’s world nor the walk’s lookout');
    assert.deepEqual(await worldsOf('function readConsentState() { return globalThis.__impeccableConsent; }'), [undefined], 'the page’s own world');
  });

  // The store bars running code a server sent: a server that names helpers gets only this extension's own run, and no code.
  it('on a walk whose server names helpers, runs each of its own page helpers by name for its op and in its world, its own consent rules, and refuses code', async (t) => {
    const { ops, walk } = await walked();
    const { helpers, pageWorld, newDocument } = await import('../extension/walks/page-helpers.js');
    const consentRules = readFileSync(path.join(ROOT, 'extension/walks/consent-rules.js'), 'utf8');
    page.seen = {};
    const href = 'http://localhost:3000/list';
    const world = vm.createContext({ URL, setTimeout, clearTimeout, location: { href }, scrollTo(x, y) { world.scrolled = [x, y]; }, document: { documentElement: { lang: 'de' }, body: null, activeElement: null, querySelectorAll: (sel) => (sel === 'a[href]' ? [{ href: `${href}#1` }, { href: '' }] : []) } });
    world.globalThis = world;
    const was = answers['Runtime.evaluate'];
    const shot = answers['Page.captureScreenshot'];
    const fetched = globalThis.fetch;
    // The extension's own package, as Chrome serves it to its worker.
    globalThis.fetch = async (url) => (url === 'chrome-extension://ext/walks/consent-rules.js' ? new Response(consentRules) : new Response('', { status: 404 }));
    const ran = [];
    answers['Runtime.evaluate'] = (params) => {
      // The badge's own world (hidden while a helper looks at a point) runs no helper.
      if (params.contextId === worlds['impeccable-walk-lookout'] || params.expression.includes('__impeccableWalkBadge')) return was(params);
      ran.push(params);
      // By value, as Chrome hands it back. A helper may throw on a stub page, never reach for a name it does not have.
      try { const value = vm.runInContext(params.expression, world); return { result: value === undefined ? {} : { value: JSON.parse(JSON.stringify(value)) } }; } catch (err) { if (err?.name === 'ReferenceError' || err?.name === 'SyntaxError') throw err; return { result: {} }; }
    };
    walk.named = true;
    try {
      for (const [helper, args, value] of [
        ['pageAddress', [], href],
        ['currentUrlOf', [], href],
        ['documentLang', [], 'de'],
        ['pageLinks', [], [`${href}#1`]],
        ['relativeStylesMissedInPage', [], false],
        ['focusedText', [], null],
        ['scrollPageTo', [40], undefined],
      ]) assert.deepEqual((await ops.evaluate({ helper, args })).value, value, helper);
      assert.deepEqual(world.scrolled, [0, 40]);
      // Every read is called by its own name, with what the server gave: each one a script that runs.
      const reads = Object.keys(helpers).filter((h) => !newDocument.includes(h));
      for (const helper of reads) await ops.evaluate({ helper, args: [null] });
      assert.equal(ran.length, 7 + reads.length);
      // The reads' own world, but for the consent rules' readers: they read what the rules left in the page's.
      assert.deepEqual(ran.slice(7).map((p) => p.contextId), reads.map((h) => (pageWorld.includes(h) ? undefined : worlds['impeccable-walk-read'])));
      assert.deepEqual(ran.slice(0, 7).map((p) => p.contextId), Array(7).fill(worlds['impeccable-walk-read']));
      for (const req of [{ fn: '() => 1', args: [] }, { fn: 'document.title' }, { fn: 'function readConsentState() { return 1; }', args: [] }]) {
        await assert.rejects(ops.evaluate(req), { name: 'NotAllowed' });
        await assert.rejects(ops.evaluateOnNewDocument(req), { name: 'NotAllowed' });
      }
      // Each op its own helpers: a read never on every new document, a new document's script never as a read.
      for (const helper of ['nope', 'constructor', '__proto__', 'toString', 'browserLanguage', 'loadConsent']) await assert.rejects(ops.evaluate({ helper, args: [] }), { name: 'NotSupported' }, helper);
      for (const helper of ['clickByText', 'nope']) await assert.rejects(ops.evaluateOnNewDocument({ helper, args: [] }), { name: 'NotSupported' }, helper);
      assert.equal(ran.length, 7 + reads.length, 'nothing refused reached the page');
      const at = sent.length;
      await ops.evaluateOnNewDocument({ helper: 'browserLanguage', args: ['de'] });
      // The consent rules are the ones it carries: the address the server names is never loaded.
      await ops.evaluateOnNewDocument({ helper: 'loadConsent', args: ['https://elsewhere.example/consent.js'] });
      const added = args.slice(at).filter((p, i) => sent[at + i] === 'Page.addScriptToEvaluateOnNewDocument');
      assert.deepEqual(added.map((p) => p.source), [`(${helpers.browserLanguage}\n)("de")`, consentRules]);
      assert.match(consentRules, /autoconsent/);
      // A cookie banner with no decline button is never accepted: the rules' engine is told to press only a reject.
      const told = [];
      const consentPage = { autoconsentReceiveMessage: (m) => told.push(m) };
      try { vm.runInNewContext(consentRules, consentPage); } catch { /* the engine after the bridge needs a real page */ }
      await consentPage.autoconsentSendMessage({ type: 'init' });
      assert.equal(told[0]?.config?.heuristicMode, 'reject');
      // A password, card or one-time-code field is never typed into or read, whatever the server says of `noSecrets`,
      // nor pictured: a still or a film's frame is taken with it covered (`coverSecrets`, in the walk's own world).
      world.CSSStyleSheet = class { cssRules = []; replaceSync(text) { this.cssRules = [{ cssText: text }]; } insertRule(text, at) { this.cssRules.splice(at, 0, { cssText: text, selectorText: text.slice(0, text.indexOf(' {')) }); } };
      const lookout = answers['Runtime.evaluate'];
      answers['Runtime.evaluate'] = (params) => (params.contextId === worlds['impeccable-walk-lookout'] && params.expression.includes('coverSecrets') ? { result: { value: vm.runInContext(params.expression, world) } } : lookout(params));
      // The screen as Chrome draws it: the field's value, unless a rule of a sheet on it picks the field out, read as
      // Chrome reads the cover's selectors (by `type`, by the mark, by part of `autocomplete`).
      const picked = (el, part) => (part === 'input[type="password" i]' ? el.type === 'password' : part === '[data-impeccable-secret-field]' ? el.getAttribute('data-impeccable-secret-field') !== null : String(el.getAttribute('autocomplete') ?? '').includes(/^\[autocomplete\*="([\w-]+)" i\]$/.exec(part)?.[1] ?? '\0'));
      const covers = (el) => world.document.adoptedStyleSheets.some((sheet) => [...sheet.cssRules].some((r) => { const text = r.cssText.replace(/^@layer [\w-]+ \{ /, ''); return text.slice(0, text.indexOf(' {')).split(', ').some((part) => picked(el, part)); }));
      const drawn = [];
      answers['Page.captureScreenshot'] = () => ({ data: btoa(drawn[drawn.push(covers(world.document.activeElement) ? 'covered' : world.document.activeElement.value) - 1]) });
      for (const [attrs, kind] of [[{ type: 'password' }, 'password'], [{ autocomplete: 'section-pay cc-number' }, 'card'], [{ autocomplete: 'one-time-code' }, 'code']]) {
        const field = { tagName: 'INPUT', type: attrs.type ?? 'text', value: 'kept', focused: false, getAttribute: (n) => attrs[n] ?? (n === 'placeholder' ? 'Secret' : null), setAttribute: (n, v) => { attrs[n] = v; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 9, height: 9 }), scrollIntoView() {}, focus() { field.focused = true; }, select() {} };
        world.document = { activeElement: field, adoptedStyleSheets: [], querySelectorAll: (sel) => ((/^input\[type="password" i\]:not/.test(sel) && field.type !== 'password') || sel === '[data-impeccable-secret-form]' ? [] : [field]), elementFromPoint: () => field };
        field.value = '4242 4242 4242 4242';
        assert.equal(atob((await ops.screenshot({ format: 'png' })).value.data), 'covered', kind);
        assert.equal(world.document.adoptedStyleSheets.length, 0, 'the field as it was once the still is taken');
        // Drawn for a persona's sight, the picture as taken goes beside it: the same capture, so under the same cover.
        const sight = { bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas, handoff: (await chrome.storage.session.get('handoff')).handoff };
        globalThis.createImageBitmap = async (blob) => ({ width: 2, height: 1, px: new Uint8ClampedArray(await blob.arrayBuffer()), close() {} });
        globalThis.OffscreenCanvas = class { getContext() { const canvas = this; return { drawImage(bitmap) { canvas.px = bitmap.px; }, getImageData: () => ({ data: canvas.px }), putImageData({ data }) { canvas.px = data; } }; } async convertToBlob() { return new Blob([this.px]); } };
        await chrome.storage.session.set({ handoff: { ...sight.handoff, sees: 'older' } });
        try {
          const { data, plain } = (await ops.screenshot({ format: 'png', plain: true })).value;
          assert.deepEqual([atob(plain), data !== plain], ['covered', true], `${kind}: the plain still`);
        } finally {
          await chrome.storage.session.set({ handoff: sight.handoff });
          Object.assign(globalThis, { createImageBitmap: sight.bitmap, OffscreenCanvas: sight.canvas });
        }
        // A password field a "show password" button makes text after a still stays covered, unread and untyped.
        if (kind === 'password') {
          field.type = attrs.type = 'text';
          assert.equal(atob((await ops.screenshot({ format: 'png' })).value.data), 'covered', 'a password shown as text');
        }
        const from = drawn.length;
        await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
        await settle(40);
        await ops.cdp({ method: 'Page.stopScreencast' });
        assert.ok(drawn.length > from && drawn.slice(from).every((d) => d === 'covered'), 'no film frame shows it');
        assert.equal(world.document.adoptedStyleSheets.length, 0, 'nor once the film ends');
        field.value = 'kept';
        for (const [helper, args] of [['typeInto', ['Secret', 'hunter2', false]], ['typeInto', ['Secret', 'hunter2', true, false]], ['fieldReads', [{ x: 1, y: 1 }]], ['fieldReads', [null, false]]]) {
          assert.equal((await ops.evaluate({ helper, args })).value, null, `${helper} ${JSON.stringify(attrs)}`);
        }
        assert.deepEqual([field.value, field.focused], ['kept', false]);
        // A screen reader's keys never go there either: the server asks first, by name.
        assert.equal((await ops.evaluate({ helper: 'secretFocus', args: [] })).value, kind);
      }
      // A page of one frame is covered by the extension's own script too: only there does `chrome.dom` open a closed
      // root. Where that script can't run in the top document, no still is taken.
      const own = chrome.scripting.executeScript, pass = [];
      chrome.scripting.executeScript = async ({ target, func }) => { pass.push(target.allFrames === true && func === helpers.coverSecrets); return []; };
      await assert.rejects(ops.screenshot({ format: 'png' }), { name: 'NotAllowed' });
      // Catches a still of a field a site's own style kept uncovered (an inline `all: revert`, an earlier layer's
      // `!important`), or put back since the cover ran: checked as drawn right before the picture, it is not taken.
      chrome.scripting.executeScript = async ({ func }) => [{ frameId: 0, result: func === helpers.coverHolds ? 1 : 0 }];
      await assert.rejects(ops.screenshot({ format: 'png' }), { name: 'NotAllowed' });
      // Chrome's own page for a load that failed takes no script and holds no page: its still is taken, so a journey
      // that meets a dead link goes on.
      const listed = chrome.webNavigation.frames;
      chrome.webNavigation.frames = [{ frameId: 0, parentFrameId: -1, errorOccurred: true }];
      chrome.scripting.executeScript = async () => { throw new Error('Frame with ID 0 is showing error page'); };
      assert.ok((await ops.screenshot({ format: 'png' })).value.data, 'an error page pictured');
      chrome.webNavigation.frames = listed;
      chrome.scripting.executeScript = own;
      assert.ok(pass.includes(true), 'a one-frame page’s top document covered by the extension’s own script');
      const field = { tagName: 'INPUT', type: 'text', value: '123', getAttribute: (n) => (n === 'autocomplete' ? 'cc-csc' : null), setAttribute() {}, removeAttribute() {}, children: [] };
      const closed = { adoptedStyleSheets: [], querySelectorAll: (sel) => (sel === '*' || sel === '[data-impeccable-secret-form]' ? [] : [field]) };
      const payment = { tagName: 'PAY-CARD', shadowRoot: null };
      // Chrome opens only an HTML element's root: it throws on an icon's SVG ahead of the card, and here on one host too.
      const icon = { tagName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', shadowRoot: null };
      const odd = { tagName: 'ODD-CARD', namespaceURI: 'http://www.w3.org/1999/xhtml', shadowRoot: null, marks: [], setAttribute(n) { this.marks.push(n); } };
      const dom = { openOrClosedShadowRoot: (el) => { if (el === icon || el === odd) throw new Error('Error in invocation of dom.openOrClosedShadowRoot(HTMLElement element)'); return el === payment ? closed : null; } };
      const content = vm.createContext({ CSSStyleSheet: world.CSSStyleSheet, setTimeout: () => 0, clearTimeout() {}, document: { adoptedStyleSheets: [], querySelectorAll: (sel) => (sel === '*' ? [icon, odd, payment] : []) }, chrome: { dom } });
      assert.equal(typeof vm.runInContext(`(${helpers.coverSecrets})(true)`, content), 'number');
      assert.equal(closed.adoptedStyleSheets.length, 1, 'a card field in a closed shadow root covered');
      assert.deepEqual(odd.marks, ['data-impeccable-secret-maybe'], 'a host whose root can’t be opened drawn as one box');
      // Another site's frame (a hosted card box) is covered by the extension's own script in it; one that script can't
      // enter is drawn as a solid box by the frame around it (black behind a transparent frame, inside a closed shadow
      // root too), and one inside that box needs nothing more.
      const card = world.document.activeElement;
      const frame = { localName: 'iframe', tagName: 'IFRAME', nodeType: 1, contentDocument: null, contentWindow: { at: 1 } };
      const inPay = { nodeType: 11, adoptedStyleSheets: [], children: [frame], querySelectorAll: (sel) => (sel === '*' ? [frame] : []) };
      const pay = { localName: 'pay-frame', tagName: 'PAY-FRAME', nodeType: 1, shadowRoot: null };
      frame.parentNode = inPay;
      world.chrome = { dom };
      dom.openOrClosedShadowRoot = (el) => { if (el === icon) throw new Error('Error in invocation of dom.openOrClosedShadowRoot(HTMLElement element)'); return el === pay ? inPay : null; };
      world.document = { activeElement: card, adoptedStyleSheets: [], querySelectorAll: (sel) => (sel === '*' ? [icon, pay] : sel === '[data-impeccable-secret-form]' ? [] : [card]), elementFromPoint: () => card };
      // Chrome's list of the top document's frames: the card box first, then the one no script enters.
      Object.assign(world, { window: world, length: 2, 0: { at: 0 }, 1: frame.contentWindow });
      const tabs = chrome.webNavigation.frames, scripted = chrome.scripting.executeScript;
      let [cardBox, slow, passes] = [false, 0, 0];
      chrome.webNavigation.frames = [{ frameId: 0, parentFrameId: -1 }, { frameId: 7, parentFrameId: 0 }, { frameId: 9, parentFrameId: 0 }, { frameId: 11, parentFrameId: 9 }];
      chrome.scripting.executeScript = async ({ target, func, args }) => {
        if (func === helpers.coverSecrets) {
          passes += args[0] === true;
          if (args[0] && slow > 0) { slow -= 1; await new Promise((resolve) => setTimeout(resolve, 2500)); }
          cardBox = args[0];
          return [{ frameId: 0, result: 1 }, { frameId: 7, result: 1 }]; }
        if (func.name === 'frameIndex') return [{ frameId: 0, result: -1 }, { frameId: 7, result: 0 }];
        if (func === helpers.coverHolds) return [{ frameId: 0, result: 0 }, { frameId: 7, result: 0 }];
        assert.deepEqual(target.frameIds, [0]);
        return [{ frameId: 0, result: vm.runInContext(`(${func})(${JSON.stringify(args[0])})`, world) }];
      };
      answers['Page.captureScreenshot'] = () => ({ data: btoa(cardBox && inPay.adoptedStyleSheets[0]?.cssRules.some((r) => /^@layer [\w-]+ \{ iframe \{.*filter: brightness\(0\) !important; background-color: #000 !important;/.test(r.cssText)) ? 'covered' : 'shown') });
      try {
        assert.equal(atob((await ops.screenshot({ format: 'png' })).value.data), 'covered', 'frames from other sites');
        assert.deepEqual([cardBox, world.document.adoptedStyleSheets.length], [false, 0], 'each frame as it was once the still is taken');
        // A frame slower to cover than a cover lasts by itself: never pictured with the top document's cover gone. Tried
        // once more, then not pictured.
        const frames = chrome.webNavigation.frames, pictured = answers['Page.captureScreenshot'];
        chrome.webNavigation.frames = frames.slice(0, 2);
        answers['Page.captureScreenshot'] = () => ({ data: btoa(cardBox && world.document.adoptedStyleSheets.length ? 'covered' : 'shown') });
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        Object.assign(world, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
        try {
          for (const [times, seen] of [[1, 'covered'], [2, 'NotAllowed']]) {
            [slow, passes] = [times, 0];
            let got;
            ops.screenshot({ format: 'png' }).then((r) => { got = atob(r.value.data); }, (err) => { got = err.name; });
            for (let turn = 0; turn < 400 && got === undefined; turn++) {
              for (let flush = 0; flush < 10; flush++) await new Promise((resolve) => setImmediate(resolve));
              t.mock.timers.tick(50);
            }
            assert.deepEqual([got, passes], [seen, 2], `a frame slow to cover ${times === 1 ? 'once' : 'twice'}`);
          }
        } finally {
          t.mock.timers.reset();
          Object.assign(world, { setTimeout, clearTimeout });
          chrome.webNavigation.frames = frames;
          answers['Page.captureScreenshot'] = pictured;
        }
        // One whose box nothing could draw (its element not found) is not pictured, after a second try.
        chrome.webNavigation.frames = [...chrome.webNavigation.frames, { frameId: 13, parentFrameId: 0 }];
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const refused = assert.rejects(ops.screenshot({ format: 'png' }), { name: 'NotAllowed' }, 'a frame neither covered nor boxed');
        for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(1000);
        await refused;
      } finally {
        t.mock.timers.reset();
        chrome.webNavigation.frames = tabs;
        chrome.scripting.executeScript = scripted;
      }
      // A page it could not cover once is tried again, its world made again; one it could not cover twice is not pictured.
      answers['Page.captureScreenshot'] = () => ({ data: btoa('taken') });
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        for (const [fails, pictured] of [[1, true], [2, false]]) {
          let tries = 0;
          answers['Runtime.evaluate'] = (params) => (params.expression.includes('coverSecrets') && /\)\(true, \d+\)$/.test(params.expression) && ++tries <= fails * 2 ? { exceptionDetails: {} } : params.expression.includes('coverSecrets') ? { result: { value: 0 } } : lookout(params));
          const taken = ops.screenshot({ format: 'png' }).then(() => true, (err) => (err.name === 'NotAllowed' ? false : Promise.reject(err)));
          for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
          t.mock.timers.tick(1000);
          assert.equal(await taken, pictured, `a page it could not cover ${fails === 1 ? 'once' : 'twice'}`);
        }
      } finally {
        t.mock.timers.reset();
      }
    } finally {
      walk.named = false;
      answers['Runtime.evaluate'] = was;
      answers['Page.captureScreenshot'] = shot;
      globalThis.fetch = fetched;
    }
  });

  // Catches: a script run while the password is in its field, or refused where the server waits out a pause. And an
  // older server's own script run while a field that may hold a password (a "show password" swap) is filled: only the
  // named helpers keep it unread, so a walk that runs the server's code pauses there, and the person's Continue lets go
  // (a false alarm must not hold the walk for the page's life); a password field holds past it.
  for (const [label, seen, held] of [
    ['a password is in a field', { password: true, filled: true }, true],
    ['a field that may hold a password is filled, on an older server', { password: false, filled: false, maybe: true }, false],
  ]) {
    it(`holds a script while ${label}, and runs it after Continue on the same page`, async () => {
      const { ops, command, current, walk } = await walked();
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'filled', url: 'http://localhost:3000/join' } });
      page.seen = seen;
      const at = sent.length;
      const inRead = () => args.slice(at).filter((p, i) => sent[at + i] === 'Runtime.evaluate' && p.contextId !== undefined && p.contextId === worlds['impeccable-walk-read']).length;
      const read = ops.evaluate({ fn: '() => 1', args: [] });
      await settle(20);
      assert.deepEqual([current().state, current().held, inRead()], ['paused', 'sign-in', 0], 'not run while it is filled');
      if (held) {
        assert.equal(await command('resume'), false, 'and Continue waits while it is filled');
        page.seen = {};
      }
      assert.equal(await command('resume'), true);
      await read;
      assert.deepEqual([inRead(), since(at, 'Page.navigate') + since(at, 'Page.reload'), walk.loader], [1, 0, 'filled']);
      moveOff();
    });
  }

  it('runs a named helper while a field that may hold a password is filled', async () => {
    const { ops, current, walk } = await walked();
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'maybe', url: 'http://localhost:3000/join' } });
    page.seen = { password: false, filled: false, maybe: true };
    walk.named = true;
    try {
      await ops.evaluate({ helper: 'documentLang', args: [] });
      assert.equal(current().state, 'walking');
    } finally {
      walk.named = false;
      page.seen = {};
      moveOff();
    }
  });

  // The pause's one barrier: what was under way when it landed answers nothing of then, and nothing decided before it
  // is done after Continue.
  it('lets nothing through a pause: a late picture is taken again after Continue, and a click from before is never made', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    let release;
    answers['Page.captureScreenshot'] = () => new Promise((resolve) => { release = () => resolve({ data: 'before' }); });
    const shot = ops.screenshot({ format: 'png' });
    for (let turn = 0; turn < 50 && !release; turn++) await settle(1);
    assert.equal(await command('pause'), true);
    const typing = ops.keyboard({ action: 'type', text: 'hello' });
    const click = ops.mouse({ action: 'click', x: 5, y: 5 });
    answers['Page.captureScreenshot'] = () => ({ data: 'after' });
    release();
    await settle(20);
    assert.deepEqual(await ops.cdp({ method: 'Page.stopScreencast' }), { value: {} }, 'stopping the film passes through the pause');
    const atContinue = sent.length;
    assert.equal(await command('resume'), true);
    assert.deepEqual((await shot).value, { data: 'after' }, 'the picture from before the pause is never sent');
    await assert.rejects(click, { name: 'Paused' });
    await assert.rejects(typing, { name: 'Paused' });
    assert.deepEqual(sent.slice(atContinue).filter((m) => m.startsWith('Input.')), [], 'no click and no key from before the pause');
    await ops.mouse({ action: 'click', x: 5, y: 5 });
    assert.equal(sent.slice(atContinue).filter((m) => m === 'Input.dispatchMouseEvent').length, 3, 'one asked for after Continue is made');
  });

  // How the persona sees: the journey's pictures are drawn as the side panel picked for it, else as
  // the persona's card says, and go as taken for one who sees normally. A picture here is raw RGBA bytes, pixel by
  // pixel: red, green, blue, white, black.
  it('sends the persona pictures as this journey’s sight sees them, and untouched for normal eyes', async () => {
    const { ops } = await walked();
    page.seen = {};
    const PIXELS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0]];
    const taken = btoa(String.fromCharCode(...PIXELS.flatMap((rgb) => [...rgb, 255])));
    const kept = { shot: answers['Page.captureScreenshot'], bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
    answers['Page.captureScreenshot'] = () => ({ data: taken });
    globalThis.createImageBitmap = async (blob) => ({ width: PIXELS.length, height: 1, px: new Uint8ClampedArray(await blob.arrayBuffer()), close() {} });
    globalThis.OffscreenCanvas = class {
      constructor(width, height) { this.px = new Uint8ClampedArray(width * height * 4); }
      getContext() {
        const canvas = this;
        return { drawImage(bitmap) { canvas.px.set(bitmap.px); }, getImageData() { return { data: canvas.px }; }, putImageData({ data }) { canvas.px = data; }, measureText: () => ({ width: 0 }), beginPath() {}, roundRect() {}, fill() {}, fillText() {} };
      }
      async convertToBlob() { return new Blob([this.px]); }
    };
    const { handoff: was } = await chrome.storage.session.get('handoff');
    // `sight`: the panel's pick for this journey; `card`: the persona card's own.
    const seen = async (sight, card) => {
      await chrome.storage.session.set({ handoff: { ...was, ...(sight ? { sees: sight } : {}), persona: { name: 'Mira', role: '', ...(card ? { sees: card } : {}) } } });
      const { data, plain } = (await ops.screenshot({ format: 'png', plain: true })).value;
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      return { data, plain, px: PIXELS.map((_, i) => [...bytes.subarray(i * 4, i * 4 + 3)]) };
    };
    try {
      assert.deepEqual(await seen(null).then(({ data, plain }) => [data, plain]), [taken, undefined], 'none chosen: the picture as taken, and no second');
      assert.equal((await seen('normal', 'older-eyes')).data, taken, 'Normal picked for a persona with older eyes: the picture as taken');
      const card = await seen(null, 'colour-blind');
      assert.ok(card.data !== taken && card.data === (await seen('colour-blind')).data, 'none picked: the card’s own');
      assert.equal(card.plain, taken, 'and the picture as taken beside it');
      const [red, green, blue] = (await seen('colour-blind')).px;
      assert.ok(Math.abs(red[0] - red[1]) < 40 && Math.abs(green[0] - green[1]) < 40, `red and green both turn olive: ${red} ${green}`);
      assert.ok(blue[2] > blue[0] + 100, `blue stays blue: ${blue}`);
      const [, , , white, black] = (await seen('older')).px;
      assert.ok(white.every((v) => v < 230) && black.every((v) => v > 15), `older eyes see less contrast: ${white} ${black}`);
      assert.ok(white[2] < white[0] - 15, `and less blue: ${white}`);
      // A full page, taller than the tab: the replay keeps its top and right edge, so the label goes there, sized to it.
      let box = null;
      const context = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function () { return { ...context.call(this), roundRect: (x, y, w, h) => { box = { x, y, w, h }; } }; };
      globalThis.createImageBitmap = async () => ({ width: 2108, height: 1498, px: new Uint8ClampedArray(2108 * 1498 * 4), close() {} });
      await seen('older');
      assert.ok(box && box.y < 50 && box.x > 2108 / 2 && box.h >= 40, `the label sits top right, big enough to read when shrunk: ${JSON.stringify(box)}`);
    } finally {
      await chrome.storage.session.set({ handoff: was });
      answers['Page.captureScreenshot'] = kept.shot;
      Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas });
    }
  });

  // Chrome lays a tab out again for each picture of it at a density other than the screen's, and around a clip: on a 2x
  // screen the page flashed on every film frame and still, and a press meanwhile went to twice its coordinates.
  it('lays the engine’s size out at the screen’s density, and cuts a clip from the whole viewport at the size asked for', async () => {
    const { ops } = await walked();
    const driver = await import('../extension/walks/driver.js');
    const kept = { shot: answers['Page.captureScreenshot'], bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas, metrics: answers['Page.getLayoutMetrics'] };
    answers['Page.captureScreenshot'] = () => ({ data: 'eA==' });
    const drawn = [];
    globalThis.createImageBitmap = async () => ({ width: 2560, height: 1600, close() {} });
    globalThis.OffscreenCanvas = class {
      constructor(width, height) { this.size = [width, height]; }
      getContext() { return { drawImage: (_picture, ...at) => drawn.push([...this.size, ...at]) }; }
      async convertToBlob() { return new Blob(['x']); }
    };
    // Scrolled 400 down, the viewport 1280x800 in CSS pixels and twice that in the picture.
    answers['Page.getLayoutMetrics'] = () => ({ cssVisualViewport: { pageX: 0, pageY: 400, clientWidth: 1280, clientHeight: 800, scale: 1 }, visualViewport: { clientWidth: 2560, clientHeight: 1600 } });
    const at = sent.length;
    try {
      await ops.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await ops.screenshot({ format: 'png' });
      await ops.screenshot({ format: 'png', clip: { x: 320, y: 600, width: 640, height: 200 } });
      const asked = (method) => args.slice(at).filter((_, i) => sent[at + i] === method);
      assert.deepEqual(asked('Emulation.setDeviceMetricsOverride'), [{ width: 1280, height: 800, deviceScaleFactor: 0, mobile: false }]);
      assert.deepEqual(asked('Page.captureScreenshot').map((params) => 'clip' in params), [false, false], 'no clip reaches Chrome');
      // Whole, drawn at 1280x800; the clip, a quarter in and 200 below the viewport's top, drawn at 640x200.
      assert.deepEqual(drawn, [[1280, 800, 0, 0, 1280, 800], [640, 200, 640, 400, 1280, 400, 0, 0, 640, 200]]);
    } finally {
      Object.assign(answers, { 'Page.captureScreenshot': kept.shot, 'Page.getLayoutMetrics': kept.metrics });
      Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas });
      delete driver.walk.viewport;
      delete driver.walk.metrics;
    }
  });

  it('keeps a sign-in pause the person takes over hushed, and goes on when they hand back', async () => {
    const { command, current } = await walked();
    page.seen = { password: true };
    await command('pause');
    await command('resume');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.equal(await command('takeover'), true);
    const heard = told.length;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3', url: 'http://localhost:3000/callback?code=secret' } });
    assert.deepEqual(told.slice(heard).filter((m) => m.event !== 'takeover').map((m) => m.event), [], 'nothing of the page is told while they sign in');
    assert.equal(await command('handback'), true, 'handed back: the person is done, though a password field still shows');
    assert.equal(current().state, 'walking');
    page.seen = {};
    await settle(5);
    assert.equal(told.slice(heard).find((m) => m.event === 'url')?.url, 'http://localhost:3000/callback?code=secret', 'told once it goes on');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3b', url: 'http://localhost:3000/' } });
  });

  it('lets the person who took over at a sign-in sign in on a sign-in host, and neither the page nor the walk go there', async () => {
    const { command, current } = await walked();
    const ask = (url, extra = {}) => fire('Fetch.requestPaused', { requestId: `r-${url}`, resourceType: 'Document', frameId: 'main', request: { method: 'GET', url }, ...extra });
    const answered = async (act) => { const at = sent.length; act(); await settle(5); return sent.slice(at).filter((m) => m.startsWith('Fetch.')); };
    page.seen = { password: true };
    await command('pause');
    await command('resume');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.deepEqual(await answered(() => ask('https://acme.okta.com/login')), ['Fetch.failRequest'], 'a pause a page can fake opens nothing');
    assert.equal(await command('takeover'), true);
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin')), ['Fetch.continueRequest'], 'the person goes to sign in');
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin/v2', { resourceType: 'XHR', request: { method: 'POST', url: 'https://accounts.google.com/signin/v2' } })), ['Fetch.continueRequest'], 'and sends it what it asks');
    assert.deepEqual(await answered(() => ask('https://example.com/collect', { resourceType: 'XHR', request: { method: 'POST', url: 'https://example.com/collect' } })), ['Fetch.failRequest'], 'but nothing else is let through');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l4', url: 'https://accounts.google.com/signin' } });
    await settle(5);
    assert.equal(current().state, 'takeover', 'on the sign-in host the walk is held, not ended');
    assert.equal(await command('handback'), false, 'nor goes on there');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l5', url: 'http://localhost:3000/' } });
    page.seen = {};
    assert.equal(await command('resume'), true);
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin')), ['Fetch.failRequest'], 'walking, the walk never goes there itself');
    page.seen = {};
    await settle(5);
    await command('resume');
    assert.equal(current().state, 'walking');
  });

  // Every write the tab sends is held (refused), the walk's own site's too, unless writes are open.
  const SITE = 'http://localhost:3000';
  let writes = 0;
  const answeredAs = async (method, url, resourceType = 'XHR') => {
    const at = sent.length;
    fire('Fetch.requestPaused', { requestId: `w-${(writes += 1)}`, resourceType, frameId: 'main', request: { method, url } });
    await settle(5);
    return sent.slice(at).filter((m) => m.startsWith('Fetch.'));
  };

  it('bypasses the tab’s service workers once the network is on, so what one would send passes the hold', async () => {
    await walked();
    const at = sent.indexOf('Network.setBypassServiceWorker');
    assert.ok(at > sent.indexOf('Network.enable'));
    assert.deepEqual(args[at], { bypass: true });
  });

  it('holds every write while the walk drives, the site’s own too, lets one out only while the server has writes open, and never holds a read', async () => {
    const { ops } = await walked();
    for (const [method, url, resourceType, closed, open] of [
      ['POST', `${SITE}/api/todos`, 'XHR', 'fulfill', 'continue'],
      ['DELETE', `${SITE}/api/todos/1`, 'Fetch', 'fulfill', 'continue'],
      ['POST', `${SITE}/todos`, 'Document', 'fail', 'continue'],
      // A link to another page of the site, and the data a client-side router fetches for it (Next.js `?_rsc=`).
      ['GET', `${SITE}/login`, 'Document', 'continue', 'continue'],
      ['GET', `${SITE}/login?_rsc=1x`, 'Fetch', 'continue', 'continue'],
      ['HEAD', `${SITE}/`, 'Fetch', 'continue', 'continue'],
      ['OPTIONS', 'https://api.example.com/todos', 'Preflight', 'continue', 'continue'],
      ['POST', 'https://example.com/collect', 'Ping', 'fail', 'fail'],
    ]) {
      await ops.writes({ open: false });
      assert.deepEqual(await answeredAs(method, url, resourceType), [`Fetch.${closed}Request`], `${method} ${url}, closed`);
      await ops.writes({ open: true });
      assert.deepEqual(await answeredAs(method, url, resourceType), [`Fetch.${open}Request`], `${method} ${url}, open`);
    }
    await ops.writes({ open: false });
    // A held write is refused as a server would refuse it, with a 409 no sign-in library takes for signed out, so the
    // app neither sends it again nor signs the person out; a form the top of the page sent is aborted, so the tab
    // stays on its page.
    let at = sent.length;
    await answeredAs('POST', `${SITE}/api/todos`);
    assert.equal(args[sent.indexOf('Fetch.fulfillRequest', at)].responseCode, 409);
    at = sent.length;
    await answeredAs('POST', `${SITE}/todos`, 'Document');
    assert.equal(args[sent.indexOf('Fetch.failRequest', at)].errorReason, 'Aborted');
  });

  // What the Fetch hold cannot see (a form posted into a new tab, workers, a frame on another site) is blocked
  // by Chrome's rules while writes are held, and only then. The walked page's own requests stay the Fetch hold's.
  it('blocks writes the page cannot be held from only while the walk drives with writes closed', async () => {
    const { ops, command, rearm, dispatch } = await walked();
    page.seen = {};
    const { query } = chrome.tabs;
    // The person's own tab, open before the walk.
    chrome.tabs.query = async () => [{ id: 4 }, { id: 11 }];
    const blocking = async () => {
      await settle(5);
      const rules = chrome.declarativeNetRequest.rules.map(({ condition }) => condition);
      if (rules.length === 0) return false;
      for (const rule of rules) {
        assert.ok(rule.requestMethods.includes('post') && !['get', 'head', 'options'].some((read) => rule.requestMethods.includes(read)));
        assert.ok(rule.resourceTypes.includes('main_frame'), 'a form posted into a new tab');
      }
      const frames = rules.find((rule) => rule.tabIds);
      const elsewhere = rules.find((rule) => rule.excludedTabIds);
      assert.deepEqual([frames.tabIds, frames.excludedInitiatorDomains], [[11], ['localhost']], 'in the walked tab, only what other sites send');
      assert.deepEqual([elsewhere.excludedTabIds.sort(), elsewhere.initiatorDomains], [[11, 4].sort(), ['localhost']], 'the walk’s site anywhere else, workers too, not the person’s tabs');
      return true;
    };
    try {
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira' });
      for (const [step, act, blocked] of [
        ['walking', async () => {}, true],
        ['writes opened', () => ops.writes({ open: true }), false],
        ['writes closed', () => ops.writes({ open: false }), true],
        ['paused', () => command('pause'), true],
        ['going on', () => command('resume'), true],
        ['taken over', () => command('takeover'), false],
        ['handed back', () => command('handback'), true],
        ['ended', () => ops.close(), false],
      ]) {
        await act();
        assert.equal(await blocking(), blocked, step);
      }
    } finally {
      chrome.tabs.query = query;
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira' });
    }
  });

  // A tab list Chrome refuses is asked again; refused twice, the walk's site is held in every other tab rather than let
  // a form posted into a new tab, or a worker, write.
  it('asks Chrome for the person’s tabs again, and never leaves new tabs or workers unheld when it cannot list them', async (t) => {
    const { ops, rearm, dispatch } = await walked();
    const { query } = chrome.tabs;
    t.mock.method(console, 'warn', () => undefined);
    try {
      for (const [fails, spared] of [[1, [4]], [2, []]]) {
        let asked = 0;
        chrome.tabs.query = async () => { asked += 1; if (asked <= fails) throw new Error('no tabs'); return [{ id: 4 }, { id: 11 }]; };
        await ops.close();
        rearm();
        dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
        await ops.open({ url: `${SITE}/`, name: 'Mira' });
        await settle(5);
        const elsewhere = chrome.declarativeNetRequest.rules.find(({ condition }) => condition.excludedTabIds)?.condition;
        assert.deepEqual([elsewhere?.excludedTabIds, elsewhere?.initiatorDomains], [[11, ...spared], ['localhost']], `refused ${fails}`);
      }
    } finally {
      chrome.tabs.query = query;
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira' });
    }
  });

  // A journey's server that asks before a submit opens its walk `free`: no write is held and the page may write
  // to any origin but ours, while the tab still never goes off the site, nor sends a form there. An older server never
  // says `free`, so its walk holds as ever.
  it('holds no write on a free walk, to other origins too, and still keeps the tab on its site', async () => {
    const { ops, rearm, dispatch } = await walked();
    page.seen = {};
    const reopen = async (free) => {
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira', ...(free ? { free } : {}) });
      await settle(5);
    };
    try {
      await reopen(true);
      for (const [method, url, resourceType, done] of [
        ['POST', `${SITE}/api/basket`, 'XHR', 'continue'],
        ['POST', 'https://sik.search.example.com/search', 'Fetch', 'continue'],
        ['POST', 'https://impeccable.reviews/api/x', 'Fetch', 'fail'],
        ['GET', 'https://example.com/', 'Document', 'fail'],
        ['POST', 'https://example.com/form', 'Document', 'fail'],
      ]) assert.deepEqual(await answeredAs(method, url, resourceType), [`Fetch.${done}Request`], `${method} ${url} ${resourceType}`);
      assert.deepEqual(chrome.declarativeNetRequest.rules, [], 'no network rule either');
      await reopen(undefined);
      assert.deepEqual(await answeredAs('POST', `${SITE}/api/basket`), ['Fetch.fulfillRequest'], 'an older server: held');
      assert.deepEqual(await answeredAs('POST', 'https://sik.search.example.com/search', 'Fetch'), ['Fetch.failRequest']);
    } finally {
      await reopen(undefined);
    }
  });

  // On a free walk nothing holds a write, so a submit the server did not mark (a click, Enter or Space) is
  // asked here first, and the server told so its clock stops; a search, a GET form and a plain link are not.
  it('asks before a submit the server did not mark on a free walk, never before a search or a GET form', async () => {
    const { ops, rearm, dispatch, command, current } = await walked();
    page.seen = {};
    const node = (tag, text, attrs = {}, parent = null, control = true) => {
      const n = {
        tagName: tag.toUpperCase(), innerText: text, textContent: text, parentElement: parent,
        getAttribute: (a) => attrs[a] ?? null,
        querySelector: (sel) => (sel === 'input[type="search"]' && attrs.searches ? {} : null),
        closest: (sel) => { for (let e = n; e; e = e.parentElement) if (sel === 'form' ? e.tagName === 'FORM' : e.control) return e; return null; },
        control: control && tag !== 'form',
      };
      return n;
    };
    const post = node('form', '', { method: 'post' });
    const search = node('form', '', { role: 'search' });
    const filter = node('form', '', { method: 'get' });
    const at = { 1: node('button', 'Add to basket', { type: 'button' }), 2: node('button', 'Go', {}, search), 3: node('button', 'Filter', {}, filter), 4: node('a', 'Order history', { href: '/orders' }), 5: node('button', 'Place order', {}, post) };
    const dom = vm.createContext({ document: { elementFromPoint: (x) => at[x] ?? null, activeElement: null } });
    const was = answers['Runtime.evaluate'];
    answers['Runtime.evaluate'] = (params) => (/submitsAt/.test(params.expression) ? { result: { value: vm.runInContext(params.expression, dom) } } : was(params));
    const reopen = async (free) => {
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira', ...(free ? { free } : {}) });
      await settle(5);
    };
    const pressed = (from) => sent.slice(from).filter((m) => m === 'Input.dispatchMouseEvent' || m === 'Input.dispatchKeyEvent').length;
    /** Does the deed and answers any question it puts with `answer`: what was asked, and whether it was done. */
    const tried = async (op, req, answer = 'no') => {
      const from = sent.length;
      const heard = told.length;
      const deed = ops[op](req).then(() => true, (err) => err.name);
      await settle(20);
      const asked = current().ask;
      if (asked) await command(answer);
      return { asked: asked ? [asked.kind, asked.what.includes('"')] : null, told: told.slice(heard).filter((m) => m.event === 'asking').map((m) => m.kind), done: await deed, pressed: pressed(from) > 0 };
    };
    const NOT_ASKED = { asked: null, told: [], done: true, pressed: true };
    try {
      await reopen(true);
      assert.deepEqual(await tried('mouse', { action: 'click', x: 1, y: 1 }), { asked: ['send', true], told: ['send'], done: 'Declined', pressed: false }, 'a basket add, No');
      assert.deepEqual(await tried('mouse', { action: 'click', x: 5, y: 1 }, 'yes'), { asked: ['send', true], told: ['send'], done: true, pressed: true }, 'a form post, Yes');
      // The Yes opened the deed's writes; the server closes them as it settles.
      await ops.writes({ open: false });
      for (const [label, op, req] of [['a search', 'mouse', { action: 'click', x: 2, y: 1 }], ['a GET form', 'mouse', { action: 'click', x: 3, y: 1 }], ['a plain link', 'mouse', { action: 'click', x: 4, y: 1 }]]) assert.deepEqual(await tried(op, req), NOT_ASKED, label);
      dom.document.activeElement = node('input', '', { type: 'search', 'aria-label': 'Search' }, search);
      assert.deepEqual(await tried('keyboard', { action: 'press', key: 'Enter' }), NOT_ASKED, 'Enter in a search');
      dom.document.activeElement = node('input', '', { type: 'email', 'aria-label': 'Email' }, post);
      assert.deepEqual((await tried('keyboard', { action: 'press', key: 'Enter' })).asked, ['send', true], 'Enter in a form that posts');
      // A key reaches the control inside a shadow root or a same-site frame, not their host.
      dom.document.activeElement = Object.assign(node('div', 'Settings', {}, null, false), { shadowRoot: { activeElement: node('button', 'Delete account', { type: 'button' }) } });
      assert.deepEqual((await tried('keyboard', { action: 'press', key: 'Space' })).asked, ['send', true], 'Space on a delete in a shadow root');
      dom.document.activeElement = Object.assign(node('iframe', '', {}, null, false), { contentDocument: { activeElement: node('button', 'Pay now', {}, post) } });
      assert.deepEqual((await tried('keyboard', { action: 'press', key: 'Enter' })).asked, ['send', true], 'Enter on a pay in a same-site frame');
      dom.document.activeElement = Object.assign(node('div', 'Delete account', {}, null, false), { shadowRoot: { activeElement: node('button', 'Show more', { type: 'button' }) } });
      assert.deepEqual(await tried('keyboard', { action: 'press', key: 'Enter' }), NOT_ASKED, 'a harmless button in a shadow root');
      assert.deepEqual(await tried('mouse', { action: 'click', x: 1, y: 1, ask: { kind: 'send', what: 'Add the lamp' } }, 'yes'), { asked: ['send', false], told: [], done: true, pressed: true }, 'the server’s own ask, unannounced');
      await ops.writes({ open: false });
      await ops.writes({ open: true });
      assert.deepEqual(await tried('mouse', { action: 'click', x: 1, y: 1 }), NOT_ASKED, 'a deed the server opened writes for');
      await reopen(undefined);
      assert.deepEqual(await tried('mouse', { action: 'click', x: 1, y: 1 }), NOT_ASKED, 'an older server: held, never asked');
    } finally {
      answers['Runtime.evaluate'] = was;
      await reopen(undefined);
    }
  });

  // The badge sits over the page's corner, where a shop's toast put its "Go to shopping bag": the walk found that button
  // covered by the badge, twice, and a press there would have landed on Stop.
  it('hides the badge while it presses or looks at a point, and only then', async () => {
    const { ops, rearm, dispatch } = await walked();
    const badgeIn = async () => { fire('Runtime.executionContextCreated', { context: { id: 77, name: 'impeccable-walk-badge', auxData: { frameId: 'main' } } }); await settle(5); };
    const seenSince = (at) => args.slice(at).flatMap((p, i) => {
      if (sent[at + i] === 'Input.dispatchMouseEvent') return [p.type];
      if (sent[at + i] !== 'Runtime.evaluate') return [];
      if (p.contextId === 77) return /veil\((true|false)\)/.test(p.expression) ? [p.expression.includes('veil(true)') ? 'hide' : 'show'] : [];
      if (p.expression.includes('submitsAt')) return ['submitsAt'];
      return p.contextId === worlds['impeccable-walk-read'] ? [p.expression.includes('clickByText') ? 'clickByText' : 'read'] : [];
    });
    await badgeIn();
    let at = sent.length;
    await ops.mouse({ action: 'click', x: 700, y: 560 });
    await ops.evaluate({ helper: 'clickByText', args: ['Go to shopping bag', { locateOnly: true }] });
    await ops.evaluate({ helper: 'pageAddress', args: [] });
    assert.deepEqual(seenSince(at), ['hide', 'mouseMoved', 'mousePressed', 'mouseReleased', 'show', 'hide', 'clickByText', 'show', 'read']);
    // On a free walk the press is first looked at for a submit: there too, or a "Place order" under the badge goes unasked.
    const reopen = async (free) => {
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: SITE } });
      await ops.open({ url: `${SITE}/`, name: 'Mira', ...(free ? { free } : {}) });
      await settle(5);
    };
    try {
      await reopen(true);
      await badgeIn();
      at = sent.length;
      await ops.mouse({ action: 'click', x: 700, y: 560 });
      assert.deepEqual(seenSince(at), ['hide', 'submitsAt', 'show', 'hide', 'mouseMoved', 'mousePressed', 'mouseReleased', 'show']);
    } finally {
      await reopen(undefined);
    }
  });

  it('never queues an open: refused while paused, so a close before Continue leaves writes held', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    await ops.writes({ open: false });
    assert.equal(await command('pause'), true);
    await assert.rejects(ops.writes({ open: true }), { name: 'Paused' });
    assert.deepEqual(await ops.writes({ open: false }), {});
    assert.equal(await command('resume'), true);
    assert.deepEqual(await answeredAs('POST', `${SITE}/api/todos`), ['Fetch.fulfillRequest']);
  });

  it('holds writes through a plain pause, lets the person’s out once they take over, and holds them again once handed back', async () => {
    const { ops, command, current } = await walked();
    page.seen = {};
    await ops.writes({ open: true });
    assert.equal(await command('pause'), true);
    assert.deepEqual(await answeredAs('POST', `${SITE}/api/todos`), ['Fetch.fulfillRequest'], 'paused: the server’s writes closed with it');
    assert.equal(await command('resume'), true);
    await ops.writes({ open: true });
    assert.equal(await command('takeover'), true);
    assert.deepEqual(await answeredAs('POST', `${SITE}/api/todos`), ['Fetch.continueRequest'], 'the person’s own');
    await assert.rejects(ops.writes({ open: true }), { name: 'TakenOver' });
    assert.deepEqual(await ops.writes({ open: false }), {}, 'a close is done whoever drives');
    assert.equal(await command('handback'), true);
    assert.equal(current().state, 'walking');
    assert.deepEqual(await answeredAs('POST', `${SITE}/api/todos`), ['Fetch.fulfillRequest'], 'held again');
  });

  it('holds what the tab sends at a sign-in pause the page brought on, and lets out only what follows the person’s own press or key', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const { command, current, INPUT_WINDOW_MS } = await walked();
    page.seen = {};
    // The walk's own worlds on the page, run as Chrome would: the one that listens for presses tells its binding.
    const bindings = args.filter((a, n) => sent[n] === 'Runtime.addBinding');
    const heard = [];
    for (const { source, worldName } of args.filter((a, n) => sent[n] === 'Page.addScriptToEvaluateOnNewDocument' && a.worldName)) {
      const world = { addEventListener: (type, listener) => heard.push({ type, listener }) };
      for (const { name } of bindings.filter((b) => b.executionContextName === worldName)) world[name] = (payload) => fire('Runtime.bindingCalled', { name, payload, executionContextId: 1 });
      try { vm.runInContext(source, vm.createContext(world)); } catch { /* another world's script, which wants a whole page */ }
    }
    const input = (type, isTrusted) => { for (const one of heard.filter((h) => h.type === type)) one.listener({ type, isTrusted }); };
    const signIn = () => answeredAs('POST', `${SITE}/login`, 'Document');
    // The page moves itself to a sign-in host and writes at once: the pause is the page's doing, the write is not the person's.
    fire('Fetch.requestPaused', { requestId: 'w-signin', resourceType: 'Document', frameId: 'main', request: { method: 'GET', url: 'https://accounts.google.com/signin' } });
    fire('Fetch.requestPaused', { requestId: 'w-with-it', resourceType: 'XHR', frameId: 'main', request: { method: 'POST', url: `${SITE}/api/todos` } });
    await settle(5);
    assert.deepEqual(args.slice(-2).map((a) => a.responseCode ?? a.errorReason), ['Aborted', 409], 'the move refused, the write held');
    // The write held during the pause tells the panel to say how else to sign in (a passkey, a phone): until Continue.
    assert.deepEqual([current().state, current().held, current().withheld], ['paused', 'sign-in', true]);
    // Chrome's network rules say the same as the Fetch hold, row by row: up while it fails a write, down while it lets one go.
    const ruled = () => chrome.declarativeNetRequest.rules.length > 0;
    for (const [label, act, answer] of [
      ['however long the pause shows', () => t.mock.timers.tick(INPUT_WINDOW_MS * 2), 'fail'],
      ['after a press the page dispatched', () => input('pointerdown', false), 'fail'],
      ['after a key the page dispatched', () => input('keydown', false), 'fail'],
      ['just after the person’s own press', () => input('pointerdown', true), 'continue'],
      ['as long after it as the window', () => t.mock.timers.tick(INPUT_WINDOW_MS), 'continue'],
      ['once the window has passed', () => t.mock.timers.tick(1), 'fail'],
      ['just after the person’s own key', () => input('keydown', true), 'continue'],
    ]) {
      act();
      assert.deepEqual(await signIn(), [`Fetch.${answer}Request`], `the sign-in sent ${label}`);
      assert.equal(ruled(), answer === 'fail', `the network rules ${label}`);
    }
    assert.deepEqual(await answeredAs('POST', 'https://example.com/collect'), ['Fetch.failRequest'], 'never another site');
    assert.equal(await command('resume'), true);
    input('pointerdown', true);
    assert.deepEqual(await signIn(), ['Fetch.failRequest'], 'walking again: the press is not the person’s word');
    assert.equal(current().withheld, false, 'Continue ends the pause and what it held; a write held walking is not told');
  });

  it('takes no picture of a page it cannot read', async () => {
    const { ops } = await walked();
    page.seen = null;
    const before = sent.length;
    await assert.rejects(ops.screenshot({ format: 'png' }), { name: 'NotAllowed' });
    assert.equal(since(before, 'Page.captureScreenshot'), 0);
    page.seen = {};
  });

  for (const focus of ['password', 'card', 'code', 'frame']) {
    it(`types nothing when focus is a ${focus} field`, async () => {
      const { ops } = await walked();
      page.seen = { focus };
      const before = sent.length;
      await assert.rejects(ops.keyboard({ action: 'type', text: 'hunter2' }), { name: 'NotAllowed' });
      await assert.rejects(ops.keyboard({ action: 'press', key: 'Enter' }), { name: 'NotAllowed' });
      assert.equal(sent.slice(before).filter((m) => m.startsWith('Input.')).length, 0);
      // Tab, Shift+Tab and Escape only leave it: a screen reader's way out of another site's frame or a code field.
      for (const key of ['Tab', 'Shift+Tab', 'Escape']) await ops.keyboard({ action: 'press', key });
      const keys = args.slice(before).filter((p) => p?.type === 'rawKeyDown').map((p) => [p.key, p.modifiers ?? 0]);
      assert.deepEqual(keys, [['Tab', 0], ['Tab', 8], ['Escape', 0]]);
      page.seen = {};
      const typed = sent.length;
      await ops.keyboard({ action: 'type', text: 'ok' });
      assert.equal(sent.slice(typed).filter((m) => m === 'Input.dispatchKeyEvent').length, 4);
    });
  }

  it('presses not even Tab where it cannot see the focus', async () => {
    const { ops } = await walked();
    page.seen = null;
    const before = sent.length;
    await assert.rejects(ops.keyboard({ action: 'press', key: 'Tab' }), { name: 'NotAllowed' });
    assert.equal(sent.slice(before).filter((m) => m.startsWith('Input.')).length, 0);
    page.seen = {};
  });

  // The op says where, never what. Whatever else it carries, the page gets the plain picture the driver draws.
  it('attaches only the plain picture drawn in code, whatever file, path or address the op names', async () => {
    const { ops } = await walked();
    page.seen = {};
    const fetched = [];
    const given = [];
    const { fetch } = globalThis;
    const { sendCommand } = chrome.debugger;
    globalThis.fetch = async (url) => { fetched.push(String(url)); throw new Error('no network'); };
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (method !== 'Runtime.evaluate' || !params?.expression?.includes('elementFromPoint')) return sendCommand(target, method, params);
      given.push(params.expression);
      return { result: { value: 'picker' } };
    };
    try {
      const named = { file: '/etc/passwd', path: '/Users/me/secret.png', url: 'https://evil.example/x.png', data: 'ZXZpbA==', name: 'evil.exe', type: 'text/html' };
      assert.deepEqual(await ops.upload({ x: 5, y: 6, ...named }), { value: 'picker' });
      assert.deepEqual(fetched, []);
      const [, data, name, type] = given[0].match(/\)\(5,6,"([^"]+)","([^"]+)","([^"]+)"\)$/);
      assert.deepEqual([name, type], ['photo.png', 'image/png']);
      // A PNG any decoder takes: its signature, a 192 by 192 header, and every chunk's checksum right.
      const png = Buffer.from(data, 'base64');
      assert.deepEqual([png.subarray(0, 8).toString('hex'), png.readUInt32BE(16), png.readUInt32BE(20)], ['89504e470d0a1a0a', 192, 192]);
      const chunks = [];
      for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
        const length = png.readUInt32BE(at);
        assert.equal(png.readUInt32BE(at + 8 + length), zlib.crc32(png.subarray(at + 4, at + 8 + length)));
        chunks.push([png.toString('latin1', at + 4, at + 8), png.subarray(at + 8, at + 8 + length)]);
      }
      assert.deepEqual(chunks.map(([kind]) => kind), ['IHDR', 'IDAT', 'IEND']);
      assert.equal(zlib.inflateSync(chunks[1][1]).length, 192 * (1 + 192 * 3));
      for (const value of Object.values(named)) assert.ok(!given[0].includes(value), `${value} never reaches the page`);
    } finally {
      globalThis.fetch = fetch;
      chrome.debugger.sendCommand = sendCommand;
    }
  });

  // Dragover bubbles, so a page that cancels it on the document would make any point read as a drop box.
  // The page script runs against a stand-in page whose events go in and back out through the parents, as Chrome's do.
  for (const [cancels, gives] of [['document', 'NotFound'], ['box', 'drop']]) {
    it(`drops the picture only where the box at the point takes it: cancelled on the ${cancels} gives ${gives}`, async () => {
      const { ops } = await walked();
      page.seen = {};
      const node = (up, element = true) => ({
        up, parentElement: element ? up : null, heard: [], closest: () => null,
        addEventListener(type, fn, capture = false) { this.heard.push({ type, fn, capture }); },
        removeEventListener(type, fn, capture = false) { this.heard = this.heard.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture)); },
        dispatchEvent(e) {
          const path = [];
          for (let at = this; at; at = at.up) path.unshift(at);
          const run = (at, capture) => { for (const l of at.heard.filter((h) => h.type === e.type && h.capture === capture)) l.fn(e); };
          for (const at of path.slice(0, -1)) run(at, true);
          run(this, true);
          run(this, false);
          for (const at of path.slice(0, -1).reverse()) run(at, false);
        },
      });
      const document = node(null, false);
      const html = node(document, false);
      document.body = node(html);
      const box = node(document.body);
      const at = node(box);
      document.elementFromPoint = () => at;
      const dropped = [];
      const cancelling = cancels === 'document' ? document : box;
      for (const type of ['dragenter', 'dragover']) cancelling.addEventListener(type, (e) => e.preventDefault());
      cancelling.addEventListener('drop', (e) => { dropped.push(e.type); e.preventDefault(); });
      const stand = {
        document, File, Uint8Array, atob, Event: class {}, HTMLInputElement: class {},
        DataTransfer: class { constructor() { this.items = { add() {} }; } },
        DragEvent: class { constructor(type) { this.type = type; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } },
      };
      const { fetch } = globalThis;
      const { sendCommand } = chrome.debugger;
      globalThis.fetch = async (url) => new Response(readFileSync(path.join(ROOT, 'extension', String(url).replace('chrome-extension://ext/', ''))));
      chrome.debugger.sendCommand = async (target, method, params) => (String(params?.expression).includes('elementFromPoint') ? { result: { value: vm.runInNewContext(params.expression, stand) } } : sendCommand(target, method, params));
      try {
        const got = await ops.upload({ x: 5, y: 6 }).then((r) => r.value, (err) => err.name);
        assert.deepEqual([got, dropped], [gives, gives === 'drop' ? ['drop'] : []]);
      } finally {
        globalThis.fetch = fetch;
        chrome.debugger.sendCommand = sendCommand;
      }
    });
  }

  // A pause that lands while the upload's world is being made gives the page no picture.
  it('gives no picture when a pause lands while the upload is under way', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    const { fetch } = globalThis;
    globalThis.fetch = async (url) => new Response(readFileSync(path.join(ROOT, 'extension', String(url).replace('chrome-extension://ext/', ''))));
    let release;
    answers['Page.createIsolatedWorld'] = () => new Promise((resolve) => { release = () => resolve({ executionContextId: 9 }); });
    const given = [];
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => { if (String(params?.expression).includes('elementFromPoint')) given.push(method); return sendCommand(target, method, params); };
    try {
      const upload = ops.upload({ x: 5, y: 6 });
      for (let turn = 0; turn < 50 && !release; turn++) await settle(1);
      assert.equal(await command('pause'), true);
      release();
      await assert.rejects(upload, { name: 'Paused' });
      assert.deepEqual(given, [], 'nothing reaches the page');
    } finally {
      chrome.debugger.sendCommand = sendCommand;
      answers['Page.createIsolatedWorld'] = () => ({ executionContextId: 9 });
      globalThis.fetch = fetch;
      await command('resume');
    }
  });

  it('lets nothing a pause held reach the tab once Stop is pressed, even while the walk is still letting go', async () => {
    const { ops, command, hooks } = await walked();
    page.seen = {};
    const reached = [];
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (String(params?.expression).includes('held')) reached.push(method);
      return sendCommand(target, method, params);
    };
    const tidying = async () => { await settle(20); };
    hooks.closing.push(tidying);
    try {
      assert.equal(await command('pause'), true);
      const looked = ops.evaluate({ fn: '() => "held"', args: [] }).then(() => 'done', (err) => err.name);
      await settle(5);
      // What the tab sent meanwhile goes with the Stop: a write to its site held, one off its site refused.
      const { walk } = await import('../extension/walks/driver.js');
      const before = { held: walk.heldWrites ?? 0, refused: walk.refusedWrites ?? 0 };
      await answeredAs('POST', `${SITE}/api/todos`);
      await answeredAs('POST', 'https://elsewhere.example/api');
      assert.equal(await command('stop'), true);
      assert.deepEqual([await looked, reached], ['Stopped', []]);
      assert.deepEqual(told.findLast((m) => m.event === 'stopped').writes, { held: before.held + 1, refused: before.refused + 1 });
    } finally {
      chrome.debugger.sendCommand = sendCommand;
      hooks.closing.splice(hooks.closing.indexOf(tidying), 1);
    }
  });

  // Signing in while paused: Chrome pushes an extension's debugger off a tab that is still open, as `target_closed`,
  // when another extension puts a frame of its own in the page (1Password's "Save login?" on the page a sign-in lands
  // on), and refuses it back until that frame goes. The journey keeps its tab, or the one Chrome swapped in for it;
  // only a tab that is gone ends it.
  // `refusing`: what Chrome refuses while the frame is there: the debugger's attach, or every command once the frame
  // lands after the debugger got back on.
  for (const [label, kept, push, refusing = 'attach'] of [
    ['another extension’s frame pushes the debugger off the open tab', 11, ({ detach }) => detach(11)],
    ['another extension’s frame lets the debugger back on but refuses it the page', 11, ({ detach }) => detach(11), 'command'],
    ['Chrome swaps the tab for another', 12, ({ detach, replaced }) => { replaced(12, 11); detach(11); }],
    ['the tab is closed', null, ({ detach, removed }) => { detach(11); removed(11); }],
  ]) {
    it(`${kept === null ? 'ends' : 'keeps'} a journey paused at a sign-in when ${label}`, async () => {
      const { ops, command, current, rearm, dispatch } = await walked();
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
      await ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
      assert.equal(await command('pause'), true);
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 's1', url: 'http://localhost:3000/people' } });
      const heard = told.length;
      const { attach, sendCommand } = chrome.debugger;
      const { get } = chrome.tabs;
      const armed = [];
      let refused = refusing === 'attach';
      const refusal = () => new Error('Cannot access a chrome-extension:// URL of different extension');
      chrome.debugger.attach = async () => { if (refused && refusing === 'attach') throw refusal(); };
      chrome.debugger.sendCommand = async (target, method, params) => {
        if (refused && refusing === 'command') throw refusal();
        if (method === 'Fetch.enable') armed.push(target.tabId);
        return sendCommand(target, method, params);
      };
      chrome.tabs.get = async (id) => { if (kept === null) throw new Error(`No tab with id: ${id}.`); return get(id); };
      const fireAll = (name, ...args) => { for (const listener of listeners[name] ?? []) listener(...args); };
      try {
        push({ detach: (tabId) => fireAll('detach', { tabId }, 'target_closed'), replaced: (added, gone) => fireAll('replaced', added, gone), removed: (tabId) => fireAll('removed', tabId, {}) });
        await settle(10);
        refused = true;
        if (kept === null) {
          assert.deepEqual([current().state, current().failure?.reason], ['failed', 'tab-closed']);
          assert.deepEqual(told.slice(heard).filter((m) => m.event === 'detached').map((m) => m.reason), ['target_closed']);
          return;
        }
        assert.equal(await command('resume'), false, 'Continue waits while the debugger cannot get back on');
        assert.equal(current().state, 'paused');
        refused = false;
        assert.equal(await command('resume'), true);
        assert.equal(current().state, 'walking');
        assert.deepEqual([...new Set(armed)], [kept], 'the guard is on the tab again before the walk goes on');
        assert.deepEqual(told.slice(heard).filter((m) => m.event === 'detached'), [], 'the other end never hears the tab went');
      } finally {
        Object.assign(chrome.debugger, { attach, sendCommand });
        chrome.tabs.get = get;
      }
    });
  }

  // Catches a look held at a pause spinning forever once the socket went, which froze the worker.
  it('refuses a look held at a pause once the socket goes, and the worker goes on', async () => {
    const { ops, command, dispatch, rearm } = await walked();
    await ops.close();
    rearm();
    dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
    await ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
    page.seen = {};
    assert.equal(await command('pause'), true);
    const shot = ops.screenshot({ format: 'png' }).then(() => 'answered', (err) => err.name);
    await settle(5);
    // The socket's close, as worker.js has it: the walk fails, then its tab is let go.
    dispatch({ type: 'fail', reason: 'connection' });
    await ops.close();
    assert.equal(await shot, 'OutingClosed');
  });

  // Last, as it ends the walk: Stop, or the socket going (it closes the walk), while the walk's tab is still being
  // opened ends the walk and closes it.
  for (const [step, by] of [['create', 'stop'], ['attach', 'stop'], ['create', 'close'], ['attach', 'close']]) {
    it(`ends the walk and closes its tab when ${by === 'stop' ? 'Stop' : 'the socket going'} comes as the tab is ${step === 'create' ? 'made' : 'taken'}`, async () => {
      const { ops, command, current, rearm, dispatch } = await walked();
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
      const removed = [];
      const attached = [];
      const { create, remove } = chrome.tabs;
      const { attach } = chrome.debugger;
      let go;
      const gate = new Promise((resolve) => { go = resolve; });
      chrome.tabs.create = async () => { if (step === 'create') await gate; return { id: 12, windowId: 1 }; };
      chrome.tabs.remove = async (id) => { removed.push(id); };
      chrome.debugger.attach = async ({ tabId }) => { attached.push(tabId); if (step === 'attach') await gate; };
      try {
        const opening = ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
        await settle(5);
        if (by === 'stop') assert.equal(await command('stop'), true);
        else await ops.close();
        go();
        await assert.rejects(opening, { name: 'Stopped' });
        assert.deepEqual(removed, [12]);
        if (by === 'stop') assert.equal(current().state, 'stopped');
        // Ended here, so the walks below can start.
        else dispatch({ type: 'stop' });
        if (step === 'create') assert.deepEqual(attached, [], 'the debugger never reaches it');
      } finally {
        Object.assign(chrome.tabs, { create, remove });
        chrome.debugger.attach = attach;
      }
    });
  }

  // A walk of the person's own tab, handed over by the account worker: after the walks above, as it takes the one walk there is.
  const SHOP = 'https://shop.example.com';
  const started = (over = {}) => JSON.stringify(block({ socket: 'wss://impeccable.reviews/api/outings/o1/socket', url: `${SHOP}/cart`, ...over }));
  const fromMain = async ({ handoff, tabId }) => (await import('../extension/walks/link.js')).adopt(handoff, tabId);
  const tabs = { made: [], removed: [], ungrouped: [], groupId: -1, url: `${SHOP}/cart` };
  // The person's history in the tab: a page of the same site from before the walk, then where it starts.
  const history = { currentIndex: 1, entries: [{ id: 1, url: `${SHOP}/before` }, { id: 2, url: `${SHOP}/cart` }] };
  let own;
  const ownTab = () => (own ??= (async () => {
    const walk = await walked();
    await walk.ops.close();
    answers['Page.getNavigationHistory'] = () => history;
    Object.assign(chrome.tabs, {
      async create(tab) { tabs.made.push(tab); return { id: 30, windowId: 1 }; },
      async remove(id) { tabs.removed.push(id); },
      async get(id) { return { id, windowId: 1, index: 3, url: tabs.url, groupId: tabs.groupId, width: 1280, height: 800, active: true }; },
      async ungroup(id) { tabs.ungrouped.push(id); },
    });
    return walk;
  })());

  for (const [label, handoff, why] of [
    ['a socket on another host', started({ socket: 'wss://example.com/api/outings/o1/socket' }), 'socket'],
    ['our own app as the tab', started({ url: 'https://app.impeccable.style/app/acme' }), 'url'],
    ['a tab that is on another site now', started({ url: 'https://elsewhere.example.com/' }), 'tab'],
    ['sites of its own to allow', started({ allow: ['https://api.shop.example.com'] }), 'allow'],
  ]) {
    it(`refuses a started walk of a tab with ${label}`, async () => {
      await ownTab();
      assert.deepEqual(await fromMain({ walks: 'walk', handoff, tabId: 21 }), { ok: false, why });
    });
  }

  it('walks the person’s own tab where it is: no tab opened or closed, no move, no resize, no film', async () => {
    const { ops, current } = await ownTab();
    const before = sockets.length;
    assert.equal((await fromMain({ walks: 'walk', handoff: started(), tabId: 21 })).ok, true);
    for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
    assert.equal(current().state, 'waiting');
    const at = sent.length;
    const opened = await ops.open({ url: `${SHOP}/`, name: 'Ines' });
    assert.equal(opened.value.tabId, 21);
    assert.equal(current().state, 'walking');
    await ops.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await assert.rejects(ops.cdp({ method: 'Page.startScreencast', params: {} }), { name: 'NotSupported' });
    assert.deepEqual(sent.slice(at).filter((m) => ['Page.navigate', 'Page.reload', 'Emulation.setDeviceMetricsOverride', 'Page.startScreencast'].includes(m)), []);
    assert.deepEqual([tabs.made, tabs.removed], [[], []]);
  });

  // Catches a walk ended for want of an answer being told in the panel as a dropped connection (16 Nov).
  it('asks the person before a deed the server marked: no click before Yes, none on No, and no answer is not a No but its own ending', async (t) => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    // The question's own clock, ticked by hand; the test waits on turns of the event loop instead.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const turns = async (n) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
    const clicks = (from) => sent.slice(from).filter((m) => m === 'Input.dispatchMouseEvent').length;
    for (const [answer, done, failed, ending = 'connection'] of [['yes', 3], ['no', 0, 'Declined'], ['timeout', 0, 'TimeoutError', 'unanswered']]) {
      const at = sent.length;
      const click = ops.mouse({ action: 'click', x: 5, y: 5, ask: { kind: 'delete', what: 'Delete “Buy oat milk”' } });
      await turns(20);
      let looked = false;
      const meanwhile = ops.url().then(() => { looked = true; });
      await turns(20);
      assert.deepEqual([current().ask?.kind, clicks(at), looked], ['delete', 0, false], 'it waits, and so does everything after it');
      if (answer === 'timeout') t.mock.timers.tick(120_000); else assert.equal(await command(answer), true);
      if (!failed) await click; else await assert.rejects(click, { name: failed });
      await meanwhile;
      // The socket closing now ends the walk as a lost connection, unless nobody answered: the server ended it then.
      assert.deepEqual([clicks(at), current().ask, reduce(current(), { type: 'fail', reason: 'connection' }).failure.reason], [done, null, ending]);
      // As the server does once the deed settles.
      await ops.writes({ open: false });
    }
  });

  // The tab asks for a request as a page would: a top-level document unless `extra` says otherwise.
  let moves = 0;
  const move = (url, extra = {}) => fireOn(21, 'Fetch.requestPaused', { requestId: `go-${(moves += 1)}`, resourceType: 'Document', frameId: 'main', request: { method: 'GET', url }, ...extra });
  const fetched = (from) => sent.slice(from).filter((m) => m.startsWith('Fetch.'));
  const goTold = (from) => told.slice(from).filter((m) => m.kind === 'go');
  const click = { action: 'click', x: 5, y: 5 };

  it('asks before another site, once for it and its www and https forms, goes there only on Yes, and keeps a No', async () => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    // What the other end had heard when the move was let through.
    let heardAtContinue = null;
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (method === 'Fetch.continueRequest') heardAtContinue ??= goTold(0).map((m) => `${m.event}:${m.said ?? ''}`).slice(-2);
      return sendCommand(target, method, params);
    };
    try {
      for (const [url, answer, done] of [['http://news.example.org/a', 'yes', 'Fetch.continueRequest'], ['https://ads.example.net/', 'no', 'Fetch.failRequest'], ['http://93.184.216.34/', 'yes', 'Fetch.continueRequest']]) {
        await ops.mouse(click);
        const [at, heard] = [sent.length, told.length];
        move(url);
        await settle(5);
        assert.deepEqual([current().ask, fetched(at)], [{ kind: 'go', what: new URL(url).host }, []]);
        await command(answer);
        await settle(5);
        assert.deepEqual(fetched(at), [done]);
        const origin = new URL(url).origin;
        assert.deepEqual(goTold(heard), [{ event: 'asking', kind: 'go', origin }, { event: 'answered', kind: 'go', origin, said: answer }]);
      }
    } finally {
      chrome.debugger.sendCommand = sendCommand;
    }
    assert.deepEqual(heardAtContinue, ['asking:', 'answered:yes'], 'told the question and its answer before the move went on');
    await ops.mouse(click);
    for (const [url, done] of [
      ['https://news.example.org/b', 'Fetch.continueRequest'],
      ['https://www.news.example.org/c', 'Fetch.continueRequest'],
      ['https://ads.example.net/again', 'Fetch.failRequest'],
      ['https://www.ads.example.net/', 'Fetch.failRequest'],
      ['http://192.168.1.1/', 'Fetch.failRequest'],
    ]) {
      const [at, heard] = [sent.length, told.length];
      move(url);
      await settle(5);
      assert.deepEqual([current().ask, fetched(at), goTold(heard)], [null, [done], []], `${url} is not asked about`);
      if (done === 'Fetch.failRequest') assert.equal(told.slice(heard).find((m) => m.event === 'blocked')?.url, url);
    }
  });

  it('asks again after a pause cut a question short, and tells the other end so while paused', async () => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    await ops.mouse(click);
    const [at, heard] = [sent.length, told.length];
    const origin = 'https://shop.example.net';
    move(`${origin}/`);
    await settle(5);
    assert.equal(current().ask?.kind, 'go');
    assert.equal(await command('pause'), true);
    await settle(5);
    assert.deepEqual([goTold(heard).map((m) => m.said ?? m.event), fetched(at)], [['asking', 'void'], ['Fetch.failRequest']]);
    assert.equal(await command('resume'), true);
    await ops.mouse(click);
    move(`${origin}/`);
    await settle(5);
    assert.equal(current().ask?.what, 'shop.example.net', 'asked again');
    await command('no');
    await settle(5);
  });

  it('asks nothing of a move that is not the walk’s own: a goto, one long after its last click, one while going back', async () => {
    const { ops, current } = await ownTab();
    page.seen = {};
    await assert.rejects(ops.goto({ url: 'https://elsewhere.example.com/', waitUntil: 'load', timeout: 1000 }), { name: 'NotAllowed' });
    assert.equal(current().ask, null);
    await ops.mouse(click);
    const { now } = Date;
    Date.now = () => now() + 11_000;
    try {
      const at = sent.length;
      move('https://late.example.com/');
      await settle(5);
      assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']], 'a page’s own timer is refused unasked');
    } finally {
      Date.now = now;
    }
    // Back: never to the person's page from before the walk, nor to a site the walk may not be on.
    for (const entries of [history.entries, [...history.entries, { id: 3, url: 'https://elsewhere.example.com/' }, { id: 4, url: `${SHOP}/cart` }]]) {
      Object.assign(history, { entries, currentIndex: entries.length - 1 });
      const at = sent.length;
      await assert.rejects(ops.goBack({ waitUntil: 'load', timeout: 1000 }), { name: 'NotAllowed' });
      assert.deepEqual([current().ask, sent.slice(at).filter((m) => m === 'Page.navigateToHistoryEntry')], [null, []]);
    }
    Object.assign(history, { entries: [...history.entries.slice(0, 2), { id: 3, url: `${SHOP}/list` }, { id: 4, url: `${SHOP}/cart` }], currentIndex: 3 });
    await ops.mouse(click);
    const back = ops.goBack({ waitUntil: 'load', timeout: 1000 });
    await settle(10);
    const at = sent.length;
    move('https://redirect.example.com/');
    await settle(5);
    assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']], 'nothing is asked while going back');
    fireOn(21, 'Page.navigatedWithinDocument', { frameId: 'main', url: `${SHOP}/list` });
    await back;
    Object.assign(history, { entries: history.entries.slice(0, 2), currentIndex: 1 });
  });

  it('lets a deed’s writes out from the person’s Yes until the server closes them, and none on No', async () => {
    const { ops, command } = await ownTab();
    page.seen = {};
    const write = async () => { const at = sent.length; move(`${SHOP}/api/cart/1`, { resourceType: 'XHR', request: { method: 'DELETE', url: `${SHOP}/api/cart/1` } }); await settle(5); return fetched(at); };
    // `late`: the server closed writes (it gave up on the deed) before the person answered.
    for (const [answer, late, done] of [['yes', false, 'Fetch.continueRequest'], ['no', false, 'Fetch.fulfillRequest'], ['yes', true, 'Fetch.fulfillRequest']]) {
      const deed = ops.mouse({ ...click, ask: { kind: 'delete', what: 'Remove the oat milk' } });
      await settle(20);
      assert.deepEqual(await write(), ['Fetch.fulfillRequest'], 'not before the answer');
      if (late) await ops.writes({ open: false });
      assert.equal(await command(answer), true);
      if (answer === 'yes') await deed; else await assert.rejects(deed, { name: 'Declined' });
      assert.deepEqual(await write(), [done], `${answer}${late ? ' after a close' : ''}`);
      await ops.writes({ open: false });
      assert.deepEqual(await write(), ['Fetch.fulfillRequest'], 'closed by the server');
    }
  });

  it('only looks on another site: a write there fails, and no typing or asked deed is done there', async () => {
    const { ops, current } = await ownTab();
    page.seen = {};
    // Open, as around a deed the server approved: a write to another site still fails.
    await ops.writes({ open: true });
    fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'n1', url: 'https://news.example.org/a' } });
    for (const [url, method, done, resourceType] of [
      ['https://news.example.org/vote', 'POST', 'Fetch.failRequest'],
      ['https://news.example.org/subscribe', 'POST', 'Fetch.failRequest', 'Document'],
      ['https://forms.example.com/send', 'POST', 'Fetch.failRequest', 'Document'],
      ['https://news.example.org/more', 'GET', 'Fetch.continueRequest'],
      [`${SHOP}/api/cart`, 'POST', 'Fetch.continueRequest'],
    ].map(([url, method, done, resourceType = 'XHR']) => [url, method, done, resourceType])) {
      await ops.mouse(click);
      const at = sent.length;
      move(url, { resourceType, request: { method, url } });
      await settle(5);
      assert.deepEqual([current().ask, fetched(at)], [null, [done]], `${method} ${url}`);
    }
    const at = sent.length;
    await assert.rejects(ops.keyboard({ action: 'type', text: 'hi' }), { name: 'NotAllowed' });
    await assert.rejects(ops.mouse({ ...click, ask: { kind: 'send', what: 'Send the comment' } }), { name: 'NotAllowed' });
    assert.deepEqual([current().ask, sent.slice(at).filter((m) => m.startsWith('Input.'))], [null, []]);
    await ops.keyboard({ action: 'press', key: 'PageDown' });
    assert.equal(sent.slice(at).filter((m) => m === 'Input.dispatchKeyEvent').length, 2, 'a key that only scrolls is pressed');
    await ops.writes({ open: false });
    fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'n2', url: `${SHOP}/cart` } });
  });

  it('lets go of the person’s tab at the end and leaves it open, out of the group it was put in', async () => {
    const { ops, current } = await ownTab();
    await ops.writes({ open: true });
    const at = sent.length;
    await ops.close();
    assert.deepEqual([tabs.made, tabs.removed, tabs.ungrouped, current().state], [[], [], [21], 'done']);
    assert.equal(since(at, 'Fetch.disable'), 1, 'the tab’s requests are held no more');
  });

  // A journey at phone or tablet width lays the person's tab out at that size, and gives the tab its own size
  // back before the debugger leaves, however the journey ends. Chrome would keep a leftover override no longer than the
  // debugger stays, but the clear is what a stop or a failure is checked by here.
  for (const [label, device, end] of [
    ['Stop, at phone width', 'phone', ({ command }) => command('stop')],
    ['a guard ending (the tab left its site), at tablet width', 'tablet', () => fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'x1', url: 'https://elsewhere.example.com/' } })],
    ['an open that failed once the tab was sized', 'phone', null],
    ['Cancel on Chrome’s debugging bar, which takes the touch and the user agent but not the size', 'tablet', () => { for (const listener of listeners.detach) listener({ tabId: 21 }, 'canceled_by_user'); }],
  ]) {
    it(`lays the person’s tab out at the width picked, and clears it before letting go on ${label}`, async () => {
      const walk = await ownTab();
      const { ops, current, dispatch, DEVICES } = walk;
      const log = [];
      const { sendCommand, detach, attach } = chrome.debugger;
      chrome.debugger.sendCommand = async (target, method, params) => {
        if (method.startsWith('Emulation.') || method === 'Page.reload') log.push([method, params]);
        if (!end && method === 'Emulation.setTouchEmulationEnabled' && params.enabled) throw new Error('{"message":"no touch here"}');
        if (method === 'Page.captureScreenshot') return { data: 'eA==' };
        return sendCommand(target, method, params);
      };
      chrome.debugger.detach = async () => { log.push(['detach']); };
      chrome.debugger.attach = async () => { log.push(['attach']); };
      try {
        const before = sockets.length;
        assert.equal((await (await import('../extension/walks/link.js')).adopt(started(), 21, device)).ok, true);
        for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
        // The page loads again under its new size: its `load` comes as Chrome's would.
        const loaded = setInterval(() => fireOn(21, 'Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId: 'again' }), 2);
        const opening = ops.open({ url: `${SHOP}/`, name: 'Ines' }).finally(() => clearInterval(loaded));
        if (!end) {
          await assert.rejects(opening, /no touch here/);
          // The server ends a walk whose tab did not open.
          sockets.at(-1).onclose({ reason: 'cancelled' });
        }
        else {
          await opening;
          // Loaded again once, after the size and before anything else; and kept beyond this worker until given back.
          const methods = log.map(([method]) => method);
          assert.equal(methods.indexOf('Page.reload'), methods.indexOf('Emulation.setUserAgentOverride') + 1, methods.join());
          assert.deepEqual((await chrome.storage.session.get('sizedTab')).sizedTab, { tabId: 21, device });
          // The engine's own size for the walk does not undo the person's pick.
          await ops.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
          // Laid out at the screen's density, a still still comes back at the device's CSS size.
          const kept = { bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
          let drawn;
          globalThis.createImageBitmap = async () => ({ close() {} });
          globalThis.OffscreenCanvas = class { constructor(w, h) { drawn = [w, h]; } getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob(['x']); } };
          try { await ops.screenshot({ format: 'png' }); } finally { Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas }); }
          assert.deepEqual(drawn, [DEVICES[device].width, DEVICES[device].height]);
          await end(walk);
          await settle(5);
        }
        const { width, height } = DEVICES[device];
        assert.deepEqual(log.find(([method]) => method === 'Emulation.setDeviceMetricsOverride')[1], { width, height, deviceScaleFactor: 0, mobile: true });
        if (end) assert.match(log.find(([method]) => method === 'Emulation.setUserAgentOverride')[1].userAgent, /Android/);
        assert.equal((await chrome.storage.session.get('sizedTab')).sizedTab, undefined);
        const tail = log.slice(label.startsWith('Cancel') ? -6 : -4).map(([method, params]) => (method === 'Emulation.setDeviceMetricsOverride' ? 'size' : ['attach', 'detach'].includes(method) ? method : `${method}:${JSON.stringify(params ?? {})}`));
        // Cleared before the debugger leaves; after a debugger that left by itself, a moment's one sets the size and clears it.
        assert.deepEqual(tail, label.startsWith('Cancel')
          ? ['attach', 'size', 'Emulation.clearDeviceMetricsOverride:{}', 'Emulation.setTouchEmulationEnabled:{"enabled":false}', 'Emulation.setUserAgentOverride:{"userAgent":""}', 'detach']
          : ['Emulation.clearDeviceMetricsOverride:{}', 'Emulation.setTouchEmulationEnabled:{"enabled":false}', 'Emulation.setUserAgentOverride:{"userAgent":""}', 'detach']);
      } finally {
        Object.assign(chrome.debugger, { sendCommand, detach, attach });
        // Ended here when it did not end itself, so the walks below can start.
        dispatch({ type: 'stop' });
      }
    });
  }

  it('gives back the size of a tab the last worker sized and never let go of, as the next worker starts', async () => {
    await ownTab();
    const log = [];
    const { sendCommand, detach, attach } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => { log.push(`${target.tabId} ${method}${method === 'Emulation.setDeviceMetricsOverride' ? '' : JSON.stringify(params ?? {})}`); };
    chrome.debugger.detach = async ({ tabId }) => { log.push(`${tabId} detach`); };
    chrome.debugger.attach = async ({ tabId }) => { log.push(`${tabId} attach`); };
    try {
      await chrome.storage.session.set({ sizedTab: { tabId: 33, device: 'phone' } });
      // Another worker's driver, as Chrome starts one: the same module, loaded afresh.
      await import('../extension/walks/driver.js?restarted');
      await settle(10);
      assert.deepEqual(log, ['33 attach', '33 Emulation.setDeviceMetricsOverride', '33 Emulation.clearDeviceMetricsOverride{}', '33 Emulation.setTouchEmulationEnabled{"enabled":false}', '33 Emulation.setUserAgentOverride{"userAgent":""}', '33 detach']);
      assert.equal((await chrome.storage.session.get('sizedTab')).sizedTab, undefined);
    } finally {
      Object.assign(chrome.debugger, { sendCommand, detach, attach });
    }
  });

  // Each on a walk of its own, after the one above has ended: the counts start at nothing.
  for (const [label, answer, asked] of [[`${MAX_OTHER_SITES} other sites`, 'yes', MAX_OTHER_SITES], [`${MAX_SITE_QUESTIONS} questions`, 'no', MAX_SITE_QUESTIONS]]) {
    it(`asks no more after ${label}: the next site is refused unasked`, async () => {
      const { ops, command, current } = await ownTab();
      const before = sockets.length;
      assert.equal((await fromMain({ walks: 'walk', handoff: started(), tabId: 21 })).ok, true);
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
      await ops.open({ url: `${SHOP}/`, name: 'Ines' });
      page.seen = {};
      try {
        for (let n = 0; n <= asked; n++) {
          await ops.mouse(click);
          const at = sent.length;
          move(`https://site${n}.example.com/`);
          await settle(5);
          if (n === asked) assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']]);
          else {
            assert.equal(current().ask?.what, `site${n}.example.com`);
            await command(answer);
            await settle(5);
          }
        }
      } finally {
        await ops.close();
      }
    });
  }

  it('drops a reply that settles after its socket is gone, never sending it on the next one', async () => {
    const { ops } = await ownTab();
    const open = (ws) => { ws.readyState = 1; ws.sent = []; ws.send = (text) => ws.sent.push(JSON.parse(text)); return ws; };
    const next = async (sender, ticket) => {
      const before = sockets.length;
      await new Promise((resolve) => { for (const listener of listeners.message) listener({ handoff: JSON.stringify(block({ ticket })) }, sender, resolve); });
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
      return open(sockets.at(-1));
    };
    const first = await next(fromPage, 'ticket-first-000000');
    let go;
    const { create } = chrome.tabs;
    chrome.tabs.create = async () => { await new Promise((resolve) => { go = resolve; }); return { id: 40, windowId: 1 }; };
    try {
      first.onmessage({ data: JSON.stringify({ op: 'open', id: 7, url: 'http://localhost:3000/', name: 'Mira' }) });
      for (let turn = 0; turn < 50 && !go; turn++) await settle(1);
      const second = await next(fromPage, 'ticket-second-00000');
      go();
      await settle(20);
      assert.deepEqual([first.sent.filter((m) => m.id === 7), second.sent.filter((m) => m.id === 7)], [[], []]);
    } finally {
      chrome.tabs.create = create;
      await ops.close();
    }
  });
});

// The badge's own script, on a stand-in page: the glow on a walk of the person's own tab, and when it goes.
describe('walk glow', () => {
  // After the worker's tests have put a stand-in Chrome in place: the badge's module hangs on the driver's.
  const badge = () => import('../extension/walks/badge.js');
  // `observer`: a Chrome with its visibility check (IntersectionObserver v2). `css`: a node's computed style, as the page
  // left it; `cover`: what is under a press other than the badge.
  const page = async ({ observer = true } = {}) => {
    const { badgeInPage } = await badge();
    const clock = { now: 0 };
    const ticks = [];
    const watchers = [];
    const pressed = [];
    const node = (tag) => ({
      tag, style: {}, dataset: {}, isConnected: false, children: [], listeners: {}, css: {},
      append(...kids) { for (const kid of kids) { kid.isConnected = true; kid.parentNode = this; this.children.push(kid); } },
      remove() { this.isConnected = false; }, setAttribute() {}, addEventListener(type, listener) { this.listeners[type] = listener; },
      attachShadow() { this.shadow = node('#shadow'); return this.shadow; },
      getBoundingClientRect() { return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: 100, height: 30 }; },
    });
    const root = node('html');
    const at = { cover: null };
    const context = {
      document: { createElement: node, documentElement: root, elementFromPoint: () => at.cover ?? host() }, CSSStyleSheet: class { replaceSync() {} },
      Date: { now: () => clock.now }, performance: { now: () => clock.now }, setInterval: (fn) => { ticks.push(fn); return 1; }, clearInterval() {}, innerWidth: 800, innerHeight: 600, addEventListener() {},
      getComputedStyle: (one) => ({ opacity: '1', visibility: 'visible', transform: 'none', filter: 'none', clipPath: 'none', maskImage: 'none', mixBlendMode: 'normal', zoom: '1', pointerEvents: 'auto', ...one.css }),
      bind: (what) => pressed.push(what),
      ...(observer ? {
        IntersectionObserver: class { constructor(report) { this.report = report; watchers.push(this); } observe() {} takeRecords() { return []; } disconnect() {} },
        IntersectionObserverEntry: class { get isVisible() { return true; } },
      } : {}),
    };
    vm.runInNewContext(`(${badgeInPage})('bind', 3000, 1500)`, context);
    const glow = () => root.children.find((child) => child.tag === 'impeccable-walk-glow');
    const host = () => root.children.find((child) => child.tag === 'impeccable-walk');
    const shows = () => Boolean(glow()?.isConnected && glow().style.visibility !== 'hidden');
    // Chrome's word on the badge: wholly on screen, and seen (nothing over it, nothing fading it) or not.
    const see = (visible) => { for (const watcher of watchers) watcher.report([{ isVisible: visible, intersectionRatio: 1 }]); };
    // A person's press on the badge's No, Yes (or Continue) or Stop, at a point on it.
    const press = (button) => {
      const [no, yes, stop] = host().shadow.children[0].children.slice(3);
      ({ no, yes, stop })[button].listeners.click({ isTrusted: true, detail: 1, clientX: 700, clientY: 560 });
    };
    return { api: context.__impeccableWalkBadge, clock, tick: () => ticks.forEach((fn) => fn()), shows, see, press, pressed, host, at };
  };
  const walking = { title: '', sub: '', stop: 'Stop', resume: '', state: 'walking', step: 1, glow: true };

  it('shows while walking, takes no clicks, and is out of every picture', async () => {
    const { api, shows } = await page();
    api.set(walking);
    assert.equal(shows(), true);
    api.veil(true);
    assert.equal(shows(), false, 'hidden for a picture');
    api.veil(false);
    assert.equal(shows(), true);
  });

  for (const [label, end] of [
    ['the person takes over', ({ api }) => api.set({ ...walking, state: 'takeover', glow: false })],
    ['the walk ends', ({ api }) => api.remove()],
    ['the debugger leaves without a word', ({ clock, tick }) => { clock.now += 1600; tick(); }],
  ]) {
    it(`goes when ${label}`, async () => {
      const at = await page();
      at.api.set(walking);
      end(at);
      assert.equal(at.shows(), false);
    });
  }

  const view = (state, extra = {}) => ({ state, who: { name: 'Ines' }, steps: [], ask: null, ...extra });
  for (const [label, shown, adopted, glow] of [
    ['walking the person’s tab', view('walking'), true, true],
    ['asking on it', view('walking', { ask: { kind: 'pay', what: 'Pay $12' } }), true, true],
    ['paused', view('paused'), true, false],
    ['taken over', view('takeover'), true, false],
    ['walking a tab of its own', view('walking'), false, true],
  ]) {
    it(`${glow ? 'glows' : 'does not glow'} ${label}`, async () => { assert.equal((await badge()).badgeState(shown, adopted).glow, glow); });
  }

  // Catches a hostile page fading the badge or sliding it under its own control, so a person's click there says Yes.
  const asking = { title: 'Asking', sub: 'Delete the to-do', stop: 'Stop', resume: 'Yes', go: 'yes', no: 'No', state: 'asking', step: 2, glow: true, fit: { w: 800, h: 600 } };
  for (const [label, spoil, sent, options] of [
    ['seen whole and on top for a moment', () => {}, ['yes']],
    ['pressed before a moment has passed', ({ clock }) => { clock.now = 200; }, []],
    ['a new question, pressed at once', ({ api }) => api.set({ ...asking, sub: 'Pay $12' }), []],
    ['covered or faded, as Chrome sees it', ({ see }) => see(false), []],
    ['faded by the page’s own styles', ({ host }) => { host().css = { opacity: '0.01' }; }, []],
    ['moved from where it was put', ({ host }) => { host().getBoundingClientRect = () => ({ left: 20, top: 20, width: 100, height: 30 }); }, []],
    ['under something else at the press', ({ at }) => { at.cover = {}; }, []],
    ['in a Chrome with no visibility check', () => {}, [], { observer: false }],
  ]) {
    it(`${sent.length ? 'says' : 'says nothing for'} Yes on the badge ${label}`, async () => {
      const at = await page(options);
      at.api.set(asking);
      at.see(true);
      at.clock.now = 1000;
      spoil(at);
      at.press('yes');
      assert.deepEqual(at.pressed, sent);
    });
  }

  it('takes No and Stop on the badge whether or not it can be seen', async () => {
    const at = await page();
    at.api.set(asking);
    at.see(false);
    at.press('no');
    at.press('stop');
    assert.deepEqual(at.pressed, ['no', 'stop']);
  });

  it('names Continue apart at a sign-in pause, pressing the same command', async () => {
    const { badgeState } = await badge();
    const [plain, signIn] = [view('paused'), view('paused', { held: 'sign-in' })].map((one) => badgeState(one));
    assert.notEqual(signIn.resume, plain.resume);
    assert.equal(signIn.go, plain.go);
  });
});

describe('derived extension manifests', () => {
  const files = (folder) => [folder, ...readdirSync(path.join(ROOT, 'extension', folder), { recursive: true }).map((file) => `${folder}/${file}`)];

  it('leaves walks and the account out of Firefox', () => {
    const firefox = firefoxManifest(MANIFEST);
    assert.deepEqual(firefox.permissions.filter((permission) => [...WALK_PERMISSIONS, 'identity'].includes(permission)), []);
    for (const key of ['side_panel', 'content_scripts', 'externally_connectable', 'key']) assert.equal(key in firefox, false, key);
    assert.deepEqual(readdirSync(FIREFOX(), { recursive: true }).filter((file) => /^(walks|account)\b|^background\/chrome-worker\.js$|popup\/(account|words)\.js$/.test(file)), []);
  });

  it('ships walks in the store build, held to production hosts with its switches off, and the account out', () => {
    const store = STORE();
    const manifest = JSON.parse(readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    const shipped = readdirSync(store, { recursive: true });
    assert.deepEqual(files('walks').filter((file) => !shipped.includes(file)), [], 'every walk file');
    assert.deepEqual(shipped.filter((file) => /^account\b|popup\/(account|words)\.js$/.test(file)), []);
    assert.deepEqual(files('account').filter((file) => isStoreFile(file)), []);
    assert.equal(isStoreFile('outing.json'), false, 'a browser test\'s outing.json');
    assert.deepEqual(moduleReferences(store, manifest.background.service_worker).filter((file) => !existsSync(path.join(store, file))), []);
    assert.deepEqual(manifest.content_scripts.flatMap((entry) => entry.js).sort(), ['walks/handoff-content.js', 'walks/present.js']);
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
    assert.deepEqual(matches.filter((match) => /staging|localhost/.test(match)), []);
    assert.equal('key' in manifest, false);
    assert.match(readFileSync(path.join(store, 'shared/build.js'), 'utf8'), /account: false, devHosts: false/);
    assert.doesNotMatch(readFileSync(path.join(store, 'popup/popup.html'), 'utf8'), /account\.js|words\.js/);
    assert.deepEqual(['account/worker.js', 'walks/worker.js'].filter((file) => !moduleReferences(path.join(ROOT, 'extension'), MANIFEST.background.service_worker).includes(file)), []);
  });
});

// Chrome's permission warnings (developer.chrome.com, "Permissions list" and "Permission warning guidelines"): the
// permissions below show none. Any other permission, and any host, counts as one. An update that adds a warning
// switches the extension off until the person accepts it: walks add the four of driving a tab, and nothing else. The
// account (not in the store build) adds one more: the notice when an agent asks for a journey.
describe('extension install warnings', () => {
  const SILENT = ['activeTab', 'alarms', 'declarativeNetRequestWithHostAccess', 'identity', 'offscreen', 'scripting', 'sidePanel', 'storage'];
  /** As published in 1.4.0, the version people have installed. */
  const PUBLISHED = { permissions: ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen'], host_permissions: ['<all_urls>'] };
  const warned = (manifest) => manifest.permissions.filter((permission) => !SILENT.includes(permission)).sort();
  const hosts = (manifest) => [...(manifest.host_permissions ?? []), ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches)];

  const GAINED = ['debugger', 'downloads', 'tabGroups', 'tabs'];
  for (const [label, manifest, account] of [['loaded unpacked', MANIFEST, ['notifications']], ['the store build', storeManifest(MANIFEST), []]]) {
    it(`asks for no warning 1.4.0 did not but walks': ${label}`, () => {
      assert.deepEqual(warned(manifest), [...warned(PUBLISHED), ...GAINED, ...account].sort());
      // 1.4.0 has every site, so any content script's pages are already in its warning.
      assert.ok(hosts(PUBLISHED).includes('<all_urls>') || hosts(manifest).every((host) => hosts(PUBLISHED).includes(host)));
      assert.deepEqual(manifest.host_permissions, PUBLISHED.host_permissions);
      assert.equal('optional_permissions' in manifest, false);
    });
  }
});

