// The side panel. Signed in, it is where a walk starts and ends: pick a persona, say what they should try, approve
// their short plan, watch them walk with only Stop to press, then one big button to what they found. A walk under way
// is one object, the walk's view (../view.js), which the worker keeps in chrome.storage.session; the panel decides
// nothing of it. Before a walk (the persona, the task, the plan) is the panel's own. Every word comes from copy.js.
// No framework and no build: this folder loads as it is.
//
//   panel.html                      the live panel
//   panel.html?stub=<name>          a stand-in state (stub.js), for looking at each one
import { COPY } from './copy.js';
import { resultLink } from '../handoff.js';
import { emptyView, isLive, reduce } from '../view.js';
import { BUILD } from '../../shared/build.js';
import { listen, speechCtor } from './voice.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');

let view = emptyView(false);
/** What a control does: asks the worker, or, on a stand-in, walks the same state machine here. */
let act = () => undefined;
/** The account as the popup sees it (account/worker.js `status`): null when there is none to offer. */
let account = null;
/** Whether the worker has said yet: until it has, no account is not yet "no sign-in to be had". */
let asked = false;
/** Whether the panel's last sign-in did not finish: said until one does. */
let signInFailed = false;
/**
 * The tab this panel's window shows, and its address (undefined on a stand-in). A finished walk's result is drawn on
 * its own tab alone; a walk stopped or failed says so wherever the panel is.
 */
let here;
let hereUrl = '';
/** Before a walk: the personas, the one picked, the task, and where the person is (`home`, `planning`, `plan`). */
const pre = { personas: undefined, pick: 0, task: '', screen: 'home', plan: null, note: '' };
/** The persona walking (kept in chrome.storage.session `walker`), for its face; and the walk's results page. */
let walker = null;
let walkUrl = null;
/** Set once the person opened a walk's results: the panel goes home. A new walk clears it. */
let ended = false;
/** Talk to type (voice.js): the browser's speech recognition, none where it has none; and the listening under way. */
const Speech = speechCtor();
let voice = null;
/** A press waiting on the microphone answer, so a second press does nothing. */
let asking = false;

/* ------------------------------ building blocks ------------------------------ */

function el(tag, props = {}, ...children) {
  const made = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') made.className = value;
    else if (key === 'text') made.textContent = value;
    else if (key.startsWith('on')) made.addEventListener(key.slice(2), value);
    else made.setAttribute(key, value === true ? '' : String(value));
  }
  made.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return made;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  mic: ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0M12 18v3'],
  stop: ['M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  out: ['M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  cursor: ['M5 3l14 7-6 2-2 6z'],
  camera: ['M4 8h3l2-2.5h6L17 8h3v11H4z', 'M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0'],
  warn: ['M12 3.5L2.5 20h19z', 'M12 10v4.5M12 17.2v.1'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  tab: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 9h18'],
  cog: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
};
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * A persona's face: one cell of its face sheet (six moods, three across and two down), cropped as the app crops it
 * in its own pages: tight under 60px, head and shoulders above. No picture: the initial in the same circle.
 */
const CELLS = ['neutral', 'curious', 'confident', 'confused', 'frustrated', 'delighted'];
function face(person, size, mood = 'neutral', cls = '') {
  const i = Math.max(0, CELLS.indexOf(mood));
  const loose = size >= 60;
  const cx = ((i % 3) + 0.5) / 3;
  const cy = (Math.floor(i / 3) + (loose ? 0.45 : 0.4)) / 2;
  const picture = person?.face ? `--face:url("${person.face.replace(/["\\]/g, '')}");--face-cx:${cx.toFixed(4)};--face-cy:${cy.toFixed(4)};--face-zoom:${(loose ? 3 : 2 / 0.55).toFixed(3)};` : '';
  return el('span', { class: `face ${cls}`.trim(), 'aria-hidden': true, 'data-mood': mood, style: `width:${size}px;height:${size}px;${picture}` },
    person?.face ? null : el('span', { class: 'face-letter', text: (person?.name?.trim()[0] ?? '').toUpperCase() }));
}

const hostOf = (url) => { try { return /^https?:/.test(url) ? new URL(url).host : ''; } catch { return ''; } };
const name = () => view.who?.name || walker?.name || '';
/** The persona walking, with its face when it is the one picked here. */
const walking = () => (walker && walker.name === view.who?.name ? walker : { name: name() });

/** The site the panel walks; before a walk, Scan and the settings (where the account is signed out) beside it. */
function top(url = hereUrl, { tools = false } = {}) {
  const host = hostOf(url);
  return el('div', { class: 'top' },
    host ? el('span', { class: 'where' }, COPY.top.walking, ' ', el('b', { text: host })) : el('span', { class: 'where', text: COPY.top.noSite }),
    el('span', { class: 'grow' }),
    tools ? button('scan', COPY.top.scan, 'sec sm', () => { pre.back = pre.screen; pre.screen = 'scan'; render(); }) : null,
    tools ? el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'settings', title: COPY.top.settings, 'aria-label': COPY.top.settings, onclick: () => { void chrome.runtime.openOptionsPage?.()?.catch?.(() => undefined); } }, icon('cog')) : null,
  );
}

/** Scan: the popup's own Scan screen (panel.html `#panel-scan`, driven by popup/popup.js), with the way back. */
function scan() {
  const box = document.getElementById('panel-scan');
  box.hidden = false;
  return [
    el('div', { class: 'top' }, button('back', COPY.top.back, 'sec sm', () => { pre.screen = pre.back ?? 'home'; render(); }), el('span', { class: 'grow' }), hostOf(hereUrl) ? el('span', { class: 'where' }, el('b', { text: hostOf(hereUrl) })) : null),
    el('div', { class: 'scan-wrap' }, box),
  ];
}

function button(action, text, kind = 'sec', onclick = () => act(action)) {
  return el('button', { class: `btn btn-${kind}`, type: 'button', 'data-act': action, text, onclick });
}

/* ------------------------------ before a walk ------------------------------ */

const picked = () => pre.personas?.[pre.pick] ?? null;
const refOf = (person) => (person.mine ? { mine: person.slug } : person.slug ? { own: person.slug } : null);

async function loadPersonas() {
  const answer = await chrome.runtime.sendMessage({ account: 'personas' }).catch(() => null);
  pre.personas = answer?.ok ? answer.personas.filter((person) => refOf(person)) : null;
  pre.failed = answer?.why ?? null;
  if (!isLive(view)) render();
}

/** Personas that didn't load: sign in again when the sign-in is gone, else try again. */
function unloaded() {
  if (pre.failed !== 'signed-out') return button('retry', COPY.home.retry, 'gold', () => { pre.personas = undefined; render(); void loadPersonas(); });
  const again = el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'sign-in', text: COPY.home.signIn, onclick: () => { void signIn(again); } });
  return again;
}

function home() {
  const person = picked();
  if (pre.personas === undefined) return [top(hereUrl, { tools: true }), el('div', { class: 'mid' }, el('span', { class: 'dots' }, el('i'), el('i'), el('i')))];
  if (!person) return [top(hereUrl, { tools: true }), el('div', { class: 'mid' }, el('p', { class: 'act', text: pre.personas === null ? COPY.home.failed : COPY.home.none }), pre.personas === null ? unloaded() : null)];
  const box = el('textarea', { class: 'text', rows: 3, maxlength: 2000, placeholder: voice ? COPY.voice.listening : COPY.home.ask(person.name), 'aria-label': COPY.home.ask(person.name), oninput: (event) => { pre.task = event.target.value; } });
  box.value = pre.task;
  const send = () => { hush(); pre.task = (box.value ?? pre.task).trim(); if (pre.task) void plan(); else box.focus(); };
  box.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
  return [
    top(hereUrl, { tools: true }),
    el('div', { class: 'hero' }, face(person, 112), el('span', { class: 'name', text: person.name }), el('p', { class: 'about', text: person.about || person.role })),
    pre.personas.length > 1 ? el('div', { class: 'strip', role: 'group', 'aria-label': COPY.home.who }, pre.personas.map((each, i) => el('button', {
      type: 'button', class: i === pre.pick ? 'sel' : '', 'aria-label': each.name, 'aria-pressed': i === pre.pick ? 'true' : 'false', 'data-act': `pick-${i}`,
      onclick: () => { pre.pick = i; pre.note = ''; render(); },
    }, face(each, 38)))) : null,
    el('div', { class: 'box' },
      pre.note ? el('p', { class: 'err', role: 'alert', text: pre.note }) : null,
      el('div', { class: 'field' }, box, el('div', { class: 'row' },
        Speech ? el('button', { class: 'mic', type: 'button', 'data-act': 'mic', 'aria-pressed': voice ? 'true' : 'false', title: voice ? COPY.voice.stop : COPY.voice.talk, 'aria-label': voice ? COPY.voice.stop : COPY.voice.talk, onclick: () => { void talk(); } }, icon('mic')) : null,
        el('span', { class: 'grow' }),
        button('send', COPY.home.send, 'gold', send))),
    ),
  ];
}

/**
 * The mic: press to talk, press again to stop. Without the microphone yet, its own page asks for it in a tab (a side
 * panel can't show Chrome's prompt), and listening starts once it is given.
 */
async function talk() {
  if (voice) { voice.stop(); return; }
  // One press at a time: a double press (or a held Enter) must not start two listeners, or open two mic tabs.
  if (asking) return;
  asking = true;
  const mic = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
  if (!mic || mic.state === 'granted') { asking = false; hear(); return; }
  const blocked = () => { pre.note = COPY.voice['not-allowed']; render(); };
  if (mic.state === 'denied') blocked();
  // Until it is given: a refusal says so, and an Allow later (on the page, or in Chrome's settings) starts listening.
  mic.onchange = () => {
    if (mic.state === 'denied') blocked();
    if (mic.state !== 'granted') return;
    mic.onchange = null;
    asking = false;
    if (screen() === 'home' && !voice) hear();
  };
  // The mic page opens once per press; it shows the blocked state and Chrome's settings itself.
  void chrome.tabs.create({ url: chrome.runtime.getURL('walks/mic/mic.html'), active: true, ...(here ? { openerTabId: here } : {}) })
    .catch(() => undefined)
    .finally(() => { setTimeout(() => { asking = false; }, 1500); });
}

/** Listens once: the words go into the box as they come, after what is there, and stay there to edit until Send. */
function hear() {
  pre.note = '';
  let ended = false;
  const heard = listen(Speech, {
    base: pre.task,
    lang: navigator.language || 'en-US',
    onText: (text) => { pre.task = text; const box = app.querySelector('textarea.text'); if (box) box.value = text; },
    onEnd: (error) => { ended = true; voice = null; if (error) pre.note = COPY.voice[error] ?? COPY.voice.failed; render(); },
  });
  // A recognizer that failed to start has already ended: keep no dead handle, or the button stays pressed.
  if (!ended) voice = heard;
  render();
}

/** Ends listening at once, keeping the words so far: on Send, and when the panel leaves the box. */
function hush() {
  const was = voice;
  voice = null;
  was?.drop();
}

const WHY = COPY.why;

/** Send: the person's task becomes the persona's short plan. */
async function plan() {
  const person = picked();
  pre.screen = 'planning';
  pre.note = '';
  render();
  const answer = await chrome.runtime.sendMessage({ account: 'plan', persona: refOf(person), task: pre.task, tabId: here }).catch(() => null);
  if (pre.screen !== 'planning') return;
  if (answer?.ok) { pre.plan = answer.plan; pre.screen = 'plan'; } else { pre.note = WHY[answer?.why] ?? COPY.why.failed; pre.screen = 'home'; }
  render();
}

/** Start walk: the approved plan goes with the walk, which then asks nothing mid-way. */
async function go(start) {
  const person = picked();
  start.disabled = true;
  walker = { name: person.name, face: person.face ?? null };
  ended = false;
  const answer = await chrome.runtime.sendMessage({ account: 'walk', persona: refOf(person), task: pre.task, tabId: here, plan: pre.plan.id, walker }).catch(() => null);
  if (answer?.ok) { pre.screen = 'home'; pre.task = ''; pre.plan = null; return; }
  pre.note = WHY[answer?.why] ?? COPY.why.failed;
  // A plan the server no longer takes (expired, or for another task or site): back to the box, to send again.
  if (answer?.why === 'plan') { pre.screen = 'home'; pre.plan = null; }
  render();
}

function planning() {
  const person = picked();
  return [top(), el('div', { class: 'mid' }, face(person, 112, 'curious', 'is-thinking'), el('p', { class: 'act', text: COPY.plan.reading(person.name) }), el('q', { class: 'task', text: pre.task }), el('span', { class: 'dots' }, el('i'), el('i'), el('i')))];
}

function planned() {
  const person = picked();
  const start = el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'start', text: COPY.plan.start, onclick: () => { void go(start); } });
  return [
    top(),
    el('div', { class: 'plan-head' }, face(person, 56, 'confident'), el('h2', { class: 'hd', text: COPY.plan.title(person.name) })),
    el('q', { class: 'task', text: pre.task }),
    el('ul', { class: 'plan' }, pre.plan.steps.map((line) => el('li', { class: line.risky ? 'risky' : '', 'data-risky': line.risky ? 'yes' : undefined }, el('i', { text: line.risky ? '!' : '' }), el('span', { text: line.text })))),
    el('span', { class: 'grow' }),
    pre.note ? el('p', { class: 'err', role: 'alert', text: pre.note }) : null,
    pre.plan.risky ? el('p', { class: 'confirm', 'data-confirm': true }, el('i', { text: '!' }), COPY.plan.risky) : null,
    el('div', { class: 'pair' }, button('edit', COPY.plan.edit, 'sec', () => { pre.screen = 'home'; pre.plan = null; pre.note = ''; render(); app.querySelector('textarea')?.focus(); }), start),
  ];
}

/* ------------------------------ a walk under way ------------------------------ */

const moodOf = (step) => step?.mood ?? (step?.issue ? 'confused' : step ? 'curious' : 'neutral');

/** A question a walk from the terminal still asks: nothing is done until Yes. A planned walk asks none. */
function question() {
  if (!view.ask) return null;
  const line = view.ask.kind === 'go' ? COPY.ask.go(name(), view.ask.what) : view.ask.what;
  return el('div', { class: 'ask', role: 'alertdialog', 'aria-label': COPY.ask.title, 'data-kind': view.ask.kind },
    el('p', { class: 'ask-what', text: line }),
    el('div', { class: 'pair' }, button('no', COPY.ask.no), button('yes', COPY.ask.yes, 'gold')),
  );
}

/** A walk that paused itself (a sign-in) or was held goes on only by the person's word. */
function held() {
  if (view.state === 'paused') return el('div', { class: 'held' }, el('p', { class: 'status', role: 'status', text: view.held === 'sign-in' ? COPY.signIn : COPY.paused.line(name()) }), button('resume', COPY.controls.resume, 'gold'));
  if (view.state === 'takeover') return el('div', { class: 'held' }, el('p', { class: 'status', role: 'status', text: COPY.takeover.line(name()) }), button('handback', COPY.controls.handback, 'gold'));
  return null;
}

function walkingScreen() {
  const steps = [...view.steps].reverse();
  return [
    top(view.site ?? hereUrl),
    el('div', { class: 'walk-head' }, face(walking(), 112, moodOf(view.steps.at(-1))), el('h2', { class: 'hd', role: 'status', text: COPY.walking.line(name()) })),
    question(),
    held(),
    steps.length > 0 ? el('ol', { class: 'sofar' }, steps.map((step, i) => el('li', { class: i === 0 ? 'now' : '', 'data-n': step.n, 'data-issue': step.issue ? 'yes' : undefined },
      el('span', { class: 'n', text: String(step.n).padStart(2, '0') }),
      el('span', { class: 't' }, i === 0 ? el('b', { text: step.did }) : step.did, i === 0 && step.said ? el('q', { text: step.said }) : null)))) : el('p', { class: 'task', text: COPY.walking.first(name()) }),
    el('span', { class: 'grow' }),
    el('div', { class: 'bar' }, el('button', { type: 'button', 'data-act': 'stop', onclick: () => act('stop') }, icon('stop'), COPY.controls.stop)),
  ];
}

/* ------------------------------ the end ------------------------------ */

/** What the walk found: the server's count once it finished, else the issues its steps showed. */
const found = () => (view.outcome ? view.outcome.issues.length : view.steps.filter((step) => step.issue).length);
const resultsUrl = () => view.outcome?.replayUrl ?? walkUrl;

function end() {
  const state = view.state;
  const n = found();
  const link = resultsUrl();
  const reason = state === 'failed' ? view.failure?.reason ?? 'connection' : null;
  const why = reason ? (typeof COPY.failed[reason] === 'function' ? COPY.failed[reason](view.site) : COPY.failed[reason]) : null;
  // The first deed the person said No to (a walk with no plan): the walk's page says it in these words. `held` is not a No.
  const saidNo = view.outcome && !view.outcome.finished ? view.steps.find((step) => step.refused === 'no')?.n : undefined;
  const head = state === 'done' ? COPY.end.done(name()) : state === 'stopped' ? COPY.end.stopped(name()) : COPY.end.failed;
  const label = n > 0 ? COPY.end.found(name(), n) : COPY.end.see(name());
  // No results page to open (a walk from the terminal that ended early): the way home instead.
  const results = link ? el('button', { class: 'btn btn-gold btn-big', type: 'button', 'data-act': 'results', 'data-issues': String(n),
    onclick: () => { void chrome.tabs.create({ url: link, active: true }).catch(() => undefined); ended = true; render(); } },
  el('span', { class: 'big-t' }, el('b', { text: label }), n > 0 && state === 'stopped' ? el('small', { text: COPY.end.beforeStop }) : null), icon('out'))
    : button('home', COPY.end.home, 'sec full', () => { ended = true; render(); });
  return [
    top(view.site ?? hereUrl),
    el('div', { class: `end${state === 'done' ? '' : ' is-still'}` },
      face(walking(), 132, state === 'done' ? 'delighted' : state === 'failed' ? 'confused' : 'neutral'),
      el('h2', { class: 'hd', role: 'status', text: head }),
      why ? el('p', { class: 'err', role: 'alert', text: why }) : saidNo ? el('p', { class: 'line task', text: COPY.end.saidNo(name(), saidNo) }) : view.workflow?.goal ? el('q', { class: 'task', text: view.workflow.goal }) : null),
    el('span', { class: 'grow' }),
    results,
  ];
}

/* ------------------------------ signed out, and no account ------------------------------ */

const MARK = ['M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z', 'M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z'];
function mark(cls) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of MARK) { const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}

/** The extension's own sign-in, as the popup's Sign in does it. */
async function signIn(control) {
  control.disabled = true;
  const answer = await chrome.runtime.sendMessage({ account: 'sign-in' }).catch(() => null);
  signInFailed = answer?.ok !== true;
  if (!signInFailed) account = answer.available === true ? answer : null;
  if (account?.signedIn === true) void loadPersonas();
  render();
}

function signedOut() {
  const pro = el('button', { class: 'pro', type: 'button', 'data-act': 'sign-in', onclick: () => { void signIn(pro); } }, mark('mark'), el('span', { text: COPY.signedOut.pro }), el('span', { class: 'arrow', text: '→' }));
  return [el('div', { class: 'mid' }, mark('mark big'), el('h2', { class: 'hd', text: COPY.signedOut.line }), signInFailed ? el('p', { class: 'err', role: 'alert', text: COPY.signedOut.failed }) : null, pro)];
}

/** Signed in without Impeccable Pro, by the server's word: one line, and the settings, where the account is signed out. */
const notPro = () => [el('div', { class: 'mid' }, mark('mark big'), el('h2', { class: 'hd', text: COPY.notPro.line }),
  button('settings', COPY.top.settings, 'sec', () => { void chrome.runtime.openOptionsPage?.()?.catch?.(() => undefined); }))];

/** No sign-in to be had (the server takes none, or is out of reach): where a journey still starts, and one more try. */
const noAccount = () => [el('div', { class: 'mid' }, el('p', { class: 'act', text: COPY.idle.line }), el('p', { class: 'task', text: COPY.idle.how }),
  button('again', COPY.idle.retry, 'sec', () => { void knowAccount(); }))];

/* ------------------------------ first run ------------------------------ */

/** The first time the panel is signed in, before the home: two screens, then never again (chrome.storage.local `firstRunSeen`). */
const foot = (on, action, text, onclick) => el('div', { class: 'fr-foot' },
  el('div', { class: 'fr-dots', 'aria-hidden': true }, [0, 1].map((i) => el('i', { class: i === on ? 'on' : '' }))),
  button(action, text, 'gold full tall', onclick));

function beforeYouStart() {
  const words = COPY.firstRun.before;
  return [
    el('div', { class: 'fr-mid' }, el('h2', { class: 'hd', text: words.title }),
      el('ul', { class: 'fr-list' }, words.points.map(([name, fact, more]) => el('li', { class: name === 'warn' ? 'warn' : '' }, icon(name), el('span', {}, el('b', { text: fact }), ' ', more))))),
    foot(0, 'got-it', words.next, () => { pre.screen = 'tab-group'; render(); }),
  ];
}

function tabGroup() {
  const words = COPY.firstRun.tabGroup;
  const person = picked() ?? { name: words.example };
  return [
    el('div', { class: 'fr-mid' },
      el('div', { class: 'fr-art', 'aria-hidden': true },
        el('div', { class: 'tg-strip' }, el('span', { class: 'tg-chip', text: COPY.tabGroup(person.name) }), el('span', { class: 'tg-tab in' }, icon('tab'), words.site), el('span', { class: 'tg-tab out' }, icon('tab'), words.other)),
        el('div', { class: 'tg-page' }, el('span', { class: 'tg-line' }), el('span', { class: 'tg-line s' }), el('span', { class: 'tg-pill' }, face(person, 18), `${COPY.badge.here(person.name)} · ${COPY.badge.step(2)}`))),
      el('h2', { class: 'hd', text: words.title }), el('p', { class: 'fr-p', text: words.line })),
    foot(1, 'start-walking', words.next, () => { pre.screen = 'home'; void chrome.storage.local.set({ firstRunSeen: true }).catch(() => undefined); render(); }),
  ];
}

/* ------------------------------ drawing ------------------------------ */

/** Which screen the panel shows now. */
function screen() {
  if (isLive(view)) return 'walking';
  const over = (view.state === 'done' && (here === undefined || view.tab === here)) || view.state === 'stopped' || view.state === 'failed';
  if (over && !ended) return 'end';
  if (!account) return asked ? 'no-account' : 'waiting';
  if (account.signedIn !== true) return 'signed-out';
  if (account.pro === false) return 'not-pro';
  return pre.screen;
}

const SCREENS = { walking: walkingScreen, end, waiting: () => [], 'no-account': noAccount, 'signed-out': signedOut, 'not-pro': notPro, home, planning, plan: planned, scan };

function render() {
  const shown = screen();
  if (shown !== 'home') hush();
  const focused = document.activeElement?.getAttribute?.('data-act');
  const body = document.body;
  body.dataset.state = view.state;
  body.dataset.screen = shown;
  body.dataset.account = account ? (account.signedIn === true ? 'signed-in' : 'signed-out') : 'off';
  body.dataset.steps = String(view.steps.length);
  body.dataset.ask = view.ask?.kind ?? '';
  body.dataset.reason = view.state === 'failed' ? view.failure?.reason ?? '' : '';
  app.className = `screen screen-${shown}`;
  if (shown !== 'scan') { const box = document.getElementById('panel-scan'); if (box && box !== app) box.hidden = true; }
  app.replaceChildren(...SCREENS[shown]().filter(Boolean));
  if (focused) app.querySelector(`[data-act="${focused}"]`)?.focus();
}
// The first run's two screens, beside the literal above so that it merges with changes to it.
Object.assign(SCREENS, { before: beforeYouStart, 'tab-group': tabGroup });

/** Which tab this panel's window shows: asked when the panel opens, each time another tab comes to the front, and as it loads. */
async function look() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  here = tab?.id ?? null;
  hereUrl = tab?.url ?? '';
}

async function knowAccount() {
  const answer = await chrome.runtime.sendMessage({ account: 'status' }).catch(() => null);
  const was = account?.signedIn === true;
  const before = screen();
  asked = true;
  account = answer?.ok === true && answer.available === true ? answer : null;
  if (account?.signedIn === true && account.pro !== false && (!was || pre.personas === null)) void loadPersonas();
  // Drawn again only when the screen changes: a redraw would take the task box from under the person's typing.
  if (screen() !== before) render();
}

/** The walk's results page, as the worker kept it: only on the walk's own server (handoff.js `resultLink`). */
async function knowWalk() {
  const { walker: kept, walkUrl: url, handoff } = await chrome.storage.session.get(['walker', 'walkUrl', 'handoff']).catch(() => ({}));
  walker = kept ?? null;
  walkUrl = typeof url === 'string' && handoff?.socket ? resultLink(url, handoff.socket) : null;
}

async function start() {
  // The stand-in states are a development build's alone: the store build draws no walk screen without a walk.
  const stub = BUILD.devHosts ? params.get('stub') : null;
  if (stub !== null) {
    const { STUBS, PRE } = await import('./stub.js');
    view = STUBS[stub] ?? STUBS.idle;
    Object.assign(pre, PRE[stub] ?? PRE.home);
    account = { signedIn: stub !== 'signed-out', pro: stub !== 'not-pro' };
    walker = pre.personas?.[0] ?? null;
    walkUrl = 'https://impeccable.reviews/app/tidy/outings/o-7f3a';
    hereUrl = 'https://tidy.example/';
    act = (action) => { view = reduce(view, { type: action }); render(); };
  } else {
    act = (action) => { void chrome.runtime.sendMessage({ control: action }).catch(() => undefined); };
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes.walker || changes.walkUrl) void knowWalk().then(render);
      if (!changes.view) return;
      view = changes.view.newValue ?? emptyView(false);
      if (isLive(view)) ended = false;
      render();
    });
    chrome.tabs.onActivated.addListener(() => { void look().then(render); });
    chrome.tabs.onUpdated?.addListener((tabId, change) => { if (tabId === here && change.url) { hereUrl = change.url; if (pre.screen === 'home' && !isLive(view)) render(); } });
    const [{ view: kept }] = await Promise.all([chrome.storage.session.get('view'), look(), knowWalk()]);
    if (kept?.v === 1) view = kept;
    if (!(await chrome.storage.local.get('firstRunSeen').catch(() => ({}))).firstRunSeen) pre.screen = 'before';
    // Asked again whenever the panel is looked at: a sign-in in the popup shows here.
    void knowAccount(); addEventListener('focus', () => { void knowAccount(); });
    // Wakes a worker Chrome put to sleep, so a walk it lost is not shown as still going.
    act('hello');
  }
  render();
}

void start();
