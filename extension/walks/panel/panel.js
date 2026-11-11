// The side panel: a walk as it happens. It draws one object, the walk's view (../view.js), which the worker keeps
// in chrome.storage.session; it decides nothing and holds nothing of its own beyond where the feed is scrolled.
// Every word comes from copy.js. No framework and no build: this folder loads as it is.
//
//   panel.html                      the live walk
//   panel.html?stub=<name>          a stand-in state (stub.js), for looking at each one
//   panel.html?variant=<name>       how a walk under way is arranged: feed (the default), checklist or now
import { COPY } from './copy.js';
import { emptyView, reduce } from '../view.js';

const VARIANTS = ['feed', 'checklist', 'now'];
const params = new URLSearchParams(location.search);
const variant = VARIANTS.includes(params.get('variant')) ? params.get('variant') : 'feed';
const app = document.getElementById('app');

let view = emptyView(false);
/** Whether the feed keeps to its newest step. */
let follow = true;
/** What a control does: asks the worker, or, on a stand-in, walks the same state machine here. */
let act = () => undefined;

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
function tick() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M2.5 6.4 5 8.8 9.6 3.4');
  svg.append(path);
  return svg;
}

const name = () => view.who?.name ?? '';
const met = () => (view.workflow?.doneWhen ?? []).filter((check) => check.met).length;

/** The walker's face: their initial, and a light that says whether they are at it. */
function face() {
  return el('span', { class: 'face', 'aria-hidden': true, 'data-light': view.state }, el('span', { class: 'face-letter', text: (name().trim()[0] ?? '').toUpperCase() }), el('span', { class: 'face-light' }));
}

function who({ compact = false } = {}) {
  if (!view.who?.name) return null;
  const facts = [view.who.visit ? COPY.who.visit[view.who.visit] : null, COPY.who.device[view.who.device] ?? null].filter(Boolean);
  return el('div', { class: compact ? 'who who-compact' : 'who' },
    face(),
    el('div', { class: 'who-text' },
      el('p', { class: 'who-name', text: view.who.name }),
      view.who.role && !compact ? el('p', { class: 'who-role', text: view.who.role }) : null,
      facts.length > 0 ? el('p', { class: 'who-facts' }, facts.map((fact) => el('span', { text: fact }))) : null,
    ),
  );
}

function workflow() {
  if (!view.workflow) return null;
  // A goal given for the occasion has no name: the goal stands alone.
  return el('div', { class: 'workflow' }, view.workflow.name ? el('p', { class: 'workflow-name', text: view.workflow.name }) : null, el('p', { class: 'workflow-goal', text: view.workflow.goal }));
}

function checks() {
  const list = view.workflow?.doneWhen ?? [];
  if (list.length === 0) return null;
  return el('ul', { class: 'checks' }, list.map((check) => el('li', { class: 'check', 'data-met': check.met ? 'yes' : 'no' }, el('span', { class: 'check-box' }, check.met ? tick() : null), el('span', { class: 'check-text', text: check.text }))));
}

const progress = () => el('span', { class: 'progress', text: COPY.walking.progress(met(), view.workflow.doneWhen.length) });

/** The checks as one line that ticks, open to the list. */
function checksLine() {
  if (!view.workflow?.doneWhen.length) return null;
  return el('details', { class: 'checks-line' },
    el('summary', {}, el('span', { class: 'section-name', text: COPY.walking.checks }), el('span', { class: 'pips', 'aria-hidden': true }, view.workflow.doneWhen.map((check) => el('span', { class: 'pip', 'data-met': check.met ? 'yes' : 'no' }))), progress()),
    checks(),
  );
}

function issueTag() {
  return el('span', { class: 'ks-tag', text: COPY.walking.issue });
}

function step(entry, { latest = false, brief = false } = {}) {
  return el('li', { class: 'step', 'data-n': entry.n, 'data-latest': latest ? 'yes' : undefined, 'data-issue': entry.issue ? 'yes' : undefined },
    el('span', { class: 'step-n', text: String(entry.n) }),
    el('div', { class: 'step-body' },
      el('p', { class: 'step-did', text: entry.did }, brief && entry.issue ? [' ', issueTag()] : null),
      !brief && entry.said ? el('p', { class: 'step-said', text: entry.said }) : null,
      !brief && entry.issue ? el('p', { class: 'step-issue' }, issueTag(), el('span', { text: entry.issue })) : null,
    ),
  );
}

function note(entry) {
  return el('li', { class: 'note', 'data-kind': entry.what }, el('span', { class: 'note-mark', 'aria-hidden': true }), el('p', { text: (COPY.kept[entry.what] ?? COPY.kept.navigation)(entry.url) }));
}

/** The steps in order, each thing the guard stopped where it happened. */
function feed({ brief = false, upTo = Infinity } = {}) {
  const steps = view.steps.filter((entry) => entry.n <= upTo);
  const newest = view.steps.at(-1)?.n;
  const rows = [];
  for (const entry of view.notes.filter((kept) => kept.after === 0)) rows.push(note(entry));
  for (const entry of steps) {
    rows.push(step(entry, { latest: entry.n === newest && view.state === 'walking', brief }));
    if (!brief) for (const kept of view.notes.filter((item) => item.after === entry.n)) rows.push(note(kept));
  }
  return el('ol', { class: brief ? 'feed feed-brief' : 'feed' }, rows);
}

function button(action, kind = 'secondary') {
  return el('button', { class: `btn btn-${kind}`, type: 'button', 'data-act': action, text: COPY.controls[action], onclick: () => act(action) });
}

/** Pause, Take over, Stop: or whichever of them the moment offers. */
function controls() {
  if (view.state === 'paused') return el('div', { class: 'controls' }, button('resume'), button('takeover'), button('stop', 'primary'));
  if (view.state === 'takeover') return el('div', { class: 'controls' }, button('handback'), button('stop', 'primary'));
  return el('div', { class: 'controls' }, button('pause'), button('takeover'), button('stop', 'primary'));
}

/** The same choices as one switch: who is driving the tab. */
function driveSwitch() {
  const caps = [
    { key: 'walking', text: COPY.drive.walker(name()), action: view.state === 'paused' ? 'resume' : 'handback' },
    { key: 'paused', text: COPY.drive.paused, action: 'pause', off: view.state === 'takeover' },
    { key: 'takeover', text: COPY.drive.you, action: 'takeover' },
  ];
  return el('div', { class: 'setting-segmented drive', role: 'group' }, caps.map((cap) => el('button', {
    type: 'button', class: cap.key === view.state ? 'active' : '', 'aria-pressed': cap.key === view.state ? 'true' : 'false', 'data-act': cap.key === view.state ? undefined : cap.action,
    disabled: cap.off, text: cap.text, onclick: () => { if (cap.key !== view.state) act(cap.action); },
  })));
}

function status() {
  const line = view.state === 'paused' ? COPY.paused.line(name()) : view.state === 'takeover' ? COPY.takeover.line(name()) : null;
  return line ? el('p', { class: 'status', role: 'status', text: line }) : null;
}

function followSwitch() {
  return el('label', { class: 'follow' },
    el('span', { text: COPY.walking.follow }),
    el('span', { class: 'setting-switch' }, el('input', { type: 'checkbox', checked: follow, 'data-follow': true, onchange: (event) => { follow = event.target.checked; if (follow) toNewest(); } }), el('span', { class: 'setting-switch-track' })),
  );
}

function sectionHead(text, ...rest) {
  return el('div', { class: 'section-head' }, el('h2', { class: 'section-name', text }), ...rest);
}

/** How to start a walk: the command, and one press to copy it. */
function command(how) {
  const copy = el('button', { class: 'btn btn-secondary', type: 'button', 'data-act': 'copy', text: COPY.copy.action });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(COPY.command); } catch { return; }
    copy.textContent = COPY.copy.done;
    setTimeout(() => { copy.textContent = COPY.copy.action; }, 1600);
  });
  return el('div', { class: 'command' }, el('p', { class: 'how', text: how }), el('code', { class: 'command-line', text: COPY.command }), copy);
}

/* ------------------------------ a walk under way, three ways ------------------------------ */

const emptyFeed = () => el('p', { class: 'feed-empty', text: COPY.walking.first(name()) });

const ARRANGED = {
  // The feed has the room; the checks are one line that ticks; the controls sit under the newest step.
  feed: () => [
    el('div', { class: 'head' }, who(), workflow()),
    status(),
    checksLine(),
    sectionHead(COPY.walking.steps, el('span', { class: 'count', text: String(view.steps.length) }), followSwitch()),
    el('div', { class: 'feed-scroll' }, view.steps.length > 0 || view.notes.length > 0 ? feed() : emptyFeed()),
    el('footer', { class: 'bar' }, controls()),
  ],
  // The checks are the page; who drives is one switch at the top; the steps are a look away.
  checklist: () => [
    el('div', { class: 'instrument' }, driveSwitch(), button('stop', 'primary')),
    el('div', { class: 'feed-scroll' },
      who({ compact: true }),
      status(),
      workflow(),
      view.workflow?.doneWhen.length ? sectionHead(COPY.walking.checks, progress()) : null,
      checks(),
      sectionHead(COPY.walking.now),
      view.steps.length > 0 ? el('ol', { class: 'feed' }, step(view.steps.at(-1), { latest: view.state === 'walking' })) : emptyFeed(),
      view.steps.length > 1 ? el('details', { class: 'all-steps' }, el('summary', { text: COPY.walking.all(view.steps.length) }), feed()) : null,
    ),
  ],
  // What is happening now, large; everything before it as a short trail; the checks and controls at the foot.
  now: () => {
    const latest = view.steps.at(-1);
    return [
      el('div', { class: 'head' }, who()),
      status(),
      el('div', { class: 'now', 'data-issue': latest?.issue ? 'yes' : undefined },
        latest ? [el('p', { class: 'now-did', 'data-n': latest.n }, el('span', { class: 'step-n', text: String(latest.n) }), el('span', { text: latest.did })), latest.said ? el('blockquote', { class: 'now-said', text: latest.said }) : null, latest.issue ? el('p', { class: 'step-issue' }, issueTag(), el('span', { text: latest.issue })) : null] : emptyFeed(),
      ),
      view.steps.length > 1 ? sectionHead(COPY.walking.earlier(view.steps.length - 1)) : null,
      el('div', { class: 'feed-scroll' }, view.steps.length > 1 ? feed({ brief: true, upTo: latest.n - 1 }) : null),
      el('footer', { class: 'bar' }, view.workflow?.doneWhen.length ? el('div', { class: 'foot-checks' }, checks()) : null, controls()),
    ];
  },
};

/* ------------------------------ every other state ------------------------------ */

function doneLine() {
  const outcome = view.outcome;
  if (!outcome) return COPY.done.plain;
  if (!outcome.finished) return COPY.done.unfinished(name(), outcome.issues.length);
  return outcome.issues.length > 0 ? COPY.done.issues(name(), outcome.issues.length) : COPY.done.clean(name());
}

/** The issues of a finished walk: where, what, and what the walker said of it. */
function issues() {
  const list = view.outcome?.issues ?? [];
  if (list.length === 0) return null;
  return el('ul', { class: 'issues' }, list.map((issue) => el('li', { class: 'finding-item' },
    el('div', { class: 'finding-row' }, el('span', { class: 'ks-tag', text: COPY.done.step(issue.step) }), el('span', { class: 'finding-selector', text: issue.page })),
    el('span', { class: 'finding-detail', text: issue.what }),
    issue.said ? el('span', { class: 'finding-description', text: issue.said }) : null,
  )));
}

const SCREENS = {
  'signed-out': () => [el('div', { class: 'quiet' }, el('p', { class: 'line', text: COPY.signedOut.line }), el('a', { class: 'btn btn-primary', 'data-act': 'sign-in', href: COPY.signedOut.href, target: '_blank', rel: 'noreferrer', text: COPY.signedOut.action }))],
  idle: () => [el('div', { class: 'quiet' }, el('p', { class: 'line', text: COPY.idle.line }), command(COPY.idle.how))],
  waiting: () => [el('div', { class: 'head' }, who(), workflow()), el('p', { class: 'status', role: 'status', 'data-busy': 'yes', text: COPY.waiting.line(name()) }), el('footer', { class: 'bar' }, el('div', { class: 'controls' }, button('stop', 'primary')))],
  done: () => [
    el('div', { class: 'head' }, who({ compact: true }), view.workflow?.name ? el('p', { class: 'workflow-name', text: view.workflow.name }) : null),
    el('div', { class: 'feed-scroll' },
      el('p', { class: 'line', role: 'status', text: doneLine() }),
      checks(),
      issues(),
      view.outcome?.replayUrl ? el('p', {}, el('a', { class: 'link', 'data-act': 'replay', href: view.outcome.replayUrl, target: '_blank', rel: 'noreferrer', text: COPY.done.again })) : null,
    ),
  ],
  stopped: () => [el('div', { class: 'head' }, who({ compact: true })), el('div', { class: 'quiet' }, el('p', { class: 'line', role: 'status', text: COPY.stopped.line }), command(COPY.stopped.how))],
  failed: () => {
    const reason = view.failure?.reason ?? 'connection';
    const line = typeof COPY.failed[reason] === 'function' ? COPY.failed[reason](view.site) : COPY.failed[reason];
    return [el('div', { class: 'head' }, who({ compact: true })), el('div', { class: 'quiet' }, el('p', { class: 'line failure', role: 'alert', text: line }), command(COPY.failed.how))];
  },
};

/* ------------------------------ drawing ------------------------------ */

const scroller = () => app.querySelector('.feed-scroll');
function toNewest() {
  const box = scroller();
  if (box) box.scrollTop = box.scrollHeight;
}

function render() {
  const live = ['walking', 'paused', 'takeover'].includes(view.state);
  // A control that was pressed is often gone once it worked (Pause becomes Resume): focus stays in its place.
  const acts = () => [...app.querySelectorAll('[data-act]')];
  const focused = document.activeElement?.getAttribute?.('data-act');
  const place = acts().indexOf(document.activeElement);
  const open = [...app.querySelectorAll('details[open]')].map((details) => details.className);
  const at = scroller()?.scrollTop ?? 0;
  const body = document.body;
  body.dataset.state = view.state;
  body.dataset.variant = live ? variant : '';
  body.dataset.steps = String(view.steps.length);
  body.dataset.device = view.who?.device ?? '';
  body.dataset.reason = view.state === 'failed' ? view.failure?.reason ?? '' : '';
  body.dataset.issues = view.state === 'done' ? String(view.outcome?.issues.length ?? 0) : '';
  app.className = live ? `walk walk-${variant}` : 'screen';
  app.replaceChildren(...(live ? ARRANGED[variant]() : (SCREENS[view.state] ?? SCREENS.idle)()).filter(Boolean));
  for (const details of app.querySelectorAll('details')) if (open.includes(details.className)) details.open = true;
  if (focused) (app.querySelector(`[data-act="${focused}"]`) ?? acts()[place])?.focus();
  if (live && follow) toNewest(); else if (scroller()) scroller().scrollTop = at;
}

async function start() {
  const stub = params.get('stub');
  if (stub !== null) {
    const { STUBS } = await import('./stub.js');
    view = STUBS[stub] ?? STUBS.idle;
    act = (action) => { view = reduce(view, { type: action }); render(); };
  } else {
    act = (action) => { void chrome.runtime.sendMessage({ control: action }).catch(() => undefined); };
    chrome.storage.session.onChanged.addListener((changes) => {
      if (!changes.view) return;
      view = changes.view.newValue ?? emptyView(false);
      render();
    });
    const { view: kept } = await chrome.storage.session.get('view');
    if (kept?.v === 1) view = kept;
    // Wakes a worker Chrome put to sleep, so a walk it lost is not shown as still going.
    act('hello');
  }
  render();
}

void start();
