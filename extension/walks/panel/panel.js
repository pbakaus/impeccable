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
import { BARS, listen, meter, speechCtor } from './voice.js';
import { isLoopback } from '../guard.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');

let view = emptyView(false);
/** What a control does: asks the worker, or, on a stand-in, walks the same state machine here. */
let act = () => undefined;
/** The account as the popup sees it (account/worker.js `status`): null when there is none to offer, undefined until it answers. */
let account = BUILD.account ? undefined : null;
/** Whether the panel's last sign-in did not finish: said until one does. */
let signInFailed = false;
/**
 * The tab this panel's window shows, and its address (undefined on a stand-in). A finished walk's result is drawn on
 * its own tab alone; a walk stopped or failed says so wherever the panel is.
 */
let here;
let hereUrl = '';
/**
 * Before a walk: the personas, the one picked, the task, and where the person is (`home`, `make`, `planning`, `plan`).
 * `sees`: how the persona sees the page on this journey; Make a persona's description, and who it made.
 */
const pre = { personas: undefined, pick: 0, task: '', screen: 'home', plan: null, note: '', width: 'desktop', sees: 'normal', describe: '', making: false, made: null, signingIn: false, menu: false, connected: false };
/**
 * "Use a persona from your app", a modal over Make a persona (`modal`): the apps, the one picked (`workspace/repo/app`),
 * whether its dropdown is open, and that app's personas. The home's own are the app's at the tab's address (or the app
 * the person chose for it, chrome.storage.local `appForSite`), else the six defaults; the person's own in both. A local
 * address (`localSite`) always has the six: an app chosen there is for that pick only, never kept.
 */
Object.assign(pre, { apps: undefined, modal: false, app: null, appsOpen: false, appPersonas: undefined });
/** Make a persona's own device and disability (`none`, or one of COPY.make.disabilities). */
Object.assign(pre, { device: 'desktop', disability: 'none' });
/** Each disability's icon. */
const NEEDS = { none: 'person', 'low-vision': 'glasses', blind: 'blind', 'colour-blind': 'palette' };
/** The widths a journey may run at (driver.js `DEVICES`, desktop the tab as it is); the last one picked is kept (`walkWidth`). */
const WIDTHS = ['desktop', 'tablet', 'phone'];
/** How the persona may see the page (../sight.js), each with its icon; a persona's card names its own (`sees`). */
const SIGHTS = { normal: 'eye', older: 'glasses', 'colour-blind': 'palette' };
const SEES_OF = { 'older-eyes': 'older', 'colour-blind': 'colour-blind' };
/**
 * How common each sight is in the US, as a percentage by the youngest age of each band (the persona's band is the last
 * it reaches), and for all ages (`all`). `below`: only a bound is known.
 */
const COMMON = {
  // Adults who wear glasses or contact lenses, NHIS 2016-17, Table 24 of the CDC Vision & Eye Health Surveillance
  // System's NHIS report (NORC, 2025): https://www.norc.org/content/dam/norc-org/pdfs/NHISDataSummaryReportVEHSS.pdf
  normal: { bands: [[18, 46.2], [40, 70.3], [65, 84.9], [85, 85.8]], all: 64.0 },
  // Cataract, 2010 US prevalence by age, NEI "Cataract Tables" (40 and over only; `all` is everyone over 40):
  // https://web.archive.org/web/20210109114800/https://www.nei.nih.gov/learn-about-eye-health/resources-for-health-educators/eye-health-data-and-statistics/cataract-data-and-statistics/cataract-tables
  // Under 40, NEI gives no figure. Only 0.5% of adults 18-39 have ever been told they had one (NHIS 2016-17, Table 20 of
  // the NORC report above), so it stands as a bound.
  older: { bands: [[18, { below: 1 }], [40, 2.51], [50, 5.22], [55, 9.14], [60, 15.45], [65, 24.73], [70, 36.49], [75, 49.49], [80, 68.3]], all: 17.11 },
};
/**
 * Red-green colour blindness, as 1 in so many: inherited, so the same at every age; among people of Northern European
 * ancestry. MedlinePlus Genetics (NIH): https://medlineplus.gov/genetics/condition/color-vision-deficiency/
 */
const COLOUR_BLIND = { men: 12, women: 200 };
/** The persona's own age, where its card opens with it ("A 24-year-old …"); an adult's only, else null. */
function ageOf(person) {
  for (const text of [person?.role, person?.about]) {
    const age = Number(/^\s*an?\s+(\d{1,3})[- ]year[- ]old\b/i.exec(text ?? '')?.[1]);
    if (age >= 18 && age <= 120) return age;
  }
  return null;
}
/** How common `sees` is, in a line naming the persona where its age is known. */
function common(sees, person) {
  if (sees === 'colour-blind') return COPY.home.common[sees](COLOUR_BLIND.men, COLOUR_BLIND.women);
  const age = ageOf(person);
  const { bands, all } = COMMON[sees];
  const share = age === null ? all : bands.findLast(([from]) => age >= from)[1];
  const words = share.below ? COPY.home.share.fewer(100 / share.below) : share >= 10 ? COPY.home.share.about(Math.round(share / 10), 10) : COPY.home.share.about(1, Math.round(100 / share));
  return COPY.home.common[sees](words, age === null ? null : person.name);
}
/** The screen a persona's card names (`device`), else the width the person last picked (`ownWidth`). */
const SCREEN_OF = { mobile: 'phone', tablet: 'tablet' };
let ownWidth = 'desktop';
/** The persona walking (kept in chrome.storage.session `walker`), for its face; and the walk's results page. */
let walker = null;
let walkUrl = null;
/** A stand-in state (stub.js): nothing is asked of the worker for it. */
let stubbed = false;
/** Set once the person opened a walk's results: the panel goes home. A new walk clears it. */
let ended = false;
/** Talk to type (voice.js): the browser's speech recognition, none where it has none; and the listening under way. */
const Speech = speechCtor();
let voice = null;
/** The screen whose box the listening fills, and each box's words in `pre` and how many it holds. */
let voiceAt = null;
const VOICE_BOXES = { home: ['task', 2000], make: ['describe', 1500] };
/** While listening: the mic's level as bars (voice.js `meter`), newest last, and how to end the stream that reads it. */
let metering = null;
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
  out: ['M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  cursor: ['M5 3l14 7-6 2-2 6z'],
  camera: ['M4 8h3l2-2.5h6L17 8h3v11H4z', 'M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0'],
  warn: ['M12 3.5L2.5 20h19z', 'M12 10v4.5M12 17.2v.1'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  tab: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 9h18'],
  desktop: ['M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M9 21h6M12 17v4'],
  tablet: ['M6 3h12a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3z', 'M11 18h2'],
  phone: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M11 18h2'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  glasses: ['M3 14a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0', 'M14 14a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0', 'M10 14c.6-.8 1.3-1.2 2-1.2s1.4.4 2 1.2', 'M3.2 12.8L5.5 6.5h1.5M20.8 12.8L18.5 6.5H17'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z', 'M7.5 11.5v.1M10 7.5v.1M14.5 7.5v.1M17 11v.1'],
  blind: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5', 'M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.6-.6 5-1.5', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  person: ['M12 5.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z', 'M5 8l7 1.5L19 8', 'M12 9.5V14l-3 7M12 14l3 7'],
  plus: ['M12 5v14M5 12h14'],
  back: ['M19 12H5M11 6l-6 6 6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  down: ['M6 9l6 6 6-6'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5', 'M3.5 4v4.5H8', 'M12 7.5V12l3 2'],
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
  // `data-face`: one of the person's own still waiting for its photo (`waitForFaces`), which swaps it in here.
  return el('span', { class: `face ${cls}`.trim(), 'aria-hidden': true, 'data-mood': mood, 'data-face': person?.mine && !person.face ? person.slug : undefined, style: `width:${size}px;height:${size}px;${picture}` },
    person?.face ? null : el('span', { class: 'face-letter', text: (person?.name?.trim()[0] ?? '').toUpperCase() }));
}

const hostOf = (url) => { try { return /^https?:/.test(url) ? new URL(url).host : ''; } catch { return ''; } };
const siteOf = (url) => { try { return /^https?:/.test(url) ? new URL(url).origin : ''; } catch { return ''; } };
const name = () => view.who?.name || walker?.name || '';
/** The persona walking, with its face: the one picked here, else the one the server sent (a walk started elsewhere). */
const walking = () => (walker && walker.name === view.who?.name ? walker : { name: name(), face: view.who?.face ?? null });

/** The site the panel walks; before a walk, Scan and the cog beside it, which opens the account (`accountMenu`) under it. */
function top(url = hereUrl, { tools = false, back = null } = {}) {
  const host = hostOf(url);
  return el('div', { class: 'top' },
    back ? el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'back', title: COPY.top.back, 'aria-label': COPY.top.back, onclick: back }, icon('back')) : null,
    host ? el('span', { class: 'where' }, COPY.top.walking, ' ', el('b', { text: host })) : el('span', { class: 'where', text: COPY.top.noSite }),
    el('span', { class: 'grow' }),
    tools ? button('scan', COPY.top.scan, 'sec sm', () => { pre.back = pre.screen; pre.screen = 'scan'; render(); }) : null,
    tools ? el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'history', title: COPY.history.open, 'aria-label': COPY.history.open, onclick: () => { pre.screen = 'history'; void loadHistory(); render(); } }, icon('history')) : null,
    tools ? cog() : null,
  );
}

/** The cog, and the account popover under it while open. */
const cog = () => [
  el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'settings', title: COPY.account.title, 'aria-label': COPY.account.title, 'aria-haspopup': 'dialog', 'aria-expanded': pre.menu ? 'true' : 'false', 'aria-controls': pre.menu ? 'account-menu' : undefined, onclick: () => { if (pre.menu) closeMenu(); else openMenu(); } }, icon('cog')),
  ...(pre.menu ? accountMenu() : []),
];

/**
 * Where "Having problems?" sends the person: a new issue on the extension's own repository, which is public: it
 * carries the extension's version and nothing else of the person or their journeys.
 */
const helpUrl = () => `https://github.com/pbakaus/impeccable/issues/new?${new URLSearchParams({ body: `Extension version: ${chrome.runtime.getManifest?.()?.version ?? 'unknown'}\n\n` })}`;
/**
 * The account, in a popover under the cog: who is signed in, the way to report a problem, and Sign out last; signed
 * out, the way to report a problem alone. A click outside it, Esc, or the cog again closes it.
 */
function accountMenu() {
  const signedIn = account?.signedIn === true;
  return [
    el('div', { class: 'acct-scrim', 'aria-hidden': true, onclick: () => closeMenu() }),
    el('div', { class: 'acct', id: 'account-menu', role: 'dialog', 'aria-label': COPY.account.title },
      signedIn && account.email ? el('p', { class: 'acct-who' }, el('small', { text: COPY.account.signedIn }), el('b', { 'data-email': true, text: account.email })) : null,
      signedIn ? button('your-personas', COPY.yours.title, 'sec full', openYours) : null,
      el('button', { class: 'btn btn-sec full', type: 'button', 'data-act': 'help',
        onclick: () => { void chrome.tabs.create({ url: helpUrl(), active: true }).catch(() => undefined); closeMenu(); } },
      COPY.account.help),
      signedIn ? button('sign-out', COPY.account.signOut, 'sec full', () => { void signOut(); }) : null),
  ];
}
/** Opens the account popover, focus on its first button (Your personas, signed in; else Having problems?). */
function openMenu() {
  pre.menu = true;
  render();
  (app.querySelector('[data-act="your-personas"]') ?? app.querySelector('[data-act="help"]'))?.focus();
}
/** Closes it; focus goes back to the cog. */
function closeMenu() {
  pre.menu = false;
  render();
  app.querySelector('[data-act="settings"]')?.focus();
}

/** The detector's Scan (panel.html `#panel-scan`, driven by popup/popup.js): what the popup was, in Chrome's panel. */
function scanBox() {
  const box = document.getElementById('panel-scan');
  box.hidden = false;
  return el('div', { class: 'scan-wrap' }, box);
}
/** The screens that show Scan: its own, and every one before Pro, where it leads as the popup's did. */
const SCANS = new Set(['scan', 'signed-out', 'not-pro', 'terminal']);

/** Scan, from the home's tools, with the way back. */
function scan() {
  return [
    el('div', { class: 'top' }, button('back', COPY.top.back, 'sec sm', () => { pre.screen = pre.back ?? 'home'; render(); }), el('span', { class: 'grow' }), hostOf(hereUrl) ? el('span', { class: 'where' }, el('b', { text: hostOf(hereUrl) })) : null),
    scanBox(),
  ];
}

function button(action, text, kind = 'sec', onclick = () => act(action)) {
  return el('button', { class: `btn btn-${kind}`, type: 'button', 'data-act': action, text, onclick });
}

/* ------------------------------ before a walk ------------------------------ */

const picked = () => pre.personas?.[pre.pick] ?? null;
/** Picks a persona, and with it how it sees the page and its screen, from its card: the person may change both for this journey. */
function choose(i) {
  pre.pick = i;
  pre.sees = SEES_OF[pre.personas?.[i]?.sees] ?? 'normal';
  pre.width = SCREEN_OF[pre.personas?.[i]?.device] ?? ownWidth;
}
/** How a walk names its persona: the person's own by slug; an app's by slug and its app, as slugs repeat across apps. */
const refOf = (person) => (person.mine ? { mine: person.slug } : person.slug ? { own: person.slug, ...(person.app ? { app: person.app } : {}) } : null);

const appKey = (app) => `${app.workspace}/${app.repo}/${app.app}`;
const appRef = (app) => ({ workspace: app.workspace, repo: app.repo, app: app.app });
/** An app's own personas, without the six everyone has or the person's own. */
const castOf = (answer) => (answer?.ok ? answer.personas.filter((person) => !person.default && !person.mine && refOf(person)) : null);

/** The site whose personas were last asked for, so another tab on it asks nothing again. */
let asked = null;
/** The app chosen for a site (chrome.storage.local `appForSite`), kept or forgotten. */
async function keepApp(site, app) {
  const { appForSite = {} } = await Promise.resolve(chrome.storage.local.get('appForSite')).catch(() => ({}));
  const next = { ...appForSite };
  if (app) next[site] = { ...appRef(app), name: app.name }; else delete next[site];
  await Promise.resolve(chrome.storage.local.set({ appForSite: next })).catch(() => undefined);
}
const forgetApp = (site) => { void keepApp(site, null); };
/** This machine (`isLoopback`) or a `.test` name: the six defaults and the person's own, whatever app was chosen there. */
const localSite = (site) => { try { const host = new URL(site).hostname; return isLoopback(host) || host.endsWith('.test'); } catch { return false; } };

/** The personas for the tab's address, or of the app chosen for it; the one picked stays picked where it is still listed. */
async function loadPersonas() {
  // Asked again after a list that didn't load: the dots while it comes, not the failure.
  if (pre.personas === null) { pre.personas = undefined; if (screen() === 'home') render(); }
  const site = siteOf(hereUrl);
  const chosen = site && !localSite(site) ? (await Promise.resolve(chrome.storage.local.get('appForSite')).catch(() => null))?.appForSite?.[site] : null;
  const [answer, theirs] = await Promise.all([
    chrome.runtime.sendMessage({ account: 'personas', url: site }).catch(() => null),
    chosen ? chrome.runtime.sendMessage({ account: 'personas', app: appRef(chosen) }).catch(() => null) : null,
  ]);
  // An answer for an address the tab has since left: asked again for the new one.
  if (siteOf(hereUrl) !== site) { await loadPersonas(); return; }
  // Once a plan is asked for, its persona is fixed: an answer that comes then changes nothing. Under a walk, only a
  // list still coming is kept, for the home after it.
  if (pre.screen === 'planning' || pre.screen === 'plan' || (isLive(view) && pre.personas !== undefined)) return;
  asked = site;
  const was = picked();
  pre.personas = answer?.ok ? answer.personas.filter((person) => refOf(person)) : null;
  // The app the person chose for this address: its personas, then their own. One that has none any more is forgotten
  // here, and the defaults the server sent stand.
  const cast = castOf(theirs);
  if (pre.personas && cast?.length) pre.personas = [...cast, ...pre.personas.filter((person) => person.mine)];
  else if (chosen && cast) forgetApp(site);
  pre.failed = answer?.why ?? null;
  const at = was ? pre.personas?.findIndex((person) => person.slug === was.slug) ?? -1 : -1;
  if (at >= 0) pre.pick = at; else choose(0);
  if (!isLive(view)) render();
  if (!facesWaited && !faceWait) waitForFaces();
}

/**
 * A persona of the person's own gets its photo drawn on the server after it is made (about 4–25 s): until then it shows
 * its letter. While one has no face and the home or Make a persona shows, the list is asked again after each of these
 * waits, with the faces of those still without one only, and each face that has come is swapped in where its letter
 * is, nothing else redrawn. The waits running out leave the letter, and say nothing.
 */
const FACE_WAITS = [3000, 6000, 12000, 20000];
/** The waits under way (its timer, kept while its ask is out), and which run it is: a fresh start ends the one before. */
let faceWait = null;
let faceRun = 0;
/** Set when the waits ran out, so a list asked for again later does not start them over; a persona made does. */
let facesWaited = false;
const ownFaceless = () => [pre.made, ...(pre.personas ?? []), ...(pre.yours ?? [])].some((each) => each?.mine && !each.face);
const facelessSlugs = () => [...new Set([pre.made, ...(pre.personas ?? []), ...(pre.yours ?? [])].filter((each) => each?.mine && !each.face && each.slug).map((each) => each.slug))];
const facesShow = () => screen() === 'home' || screen() === 'make' || screen() === 'personas';
function waitForFaces(round = 0, run = (faceRun += 1)) {
  if (run !== faceRun) return;
  clearTimeout(faceWait);
  faceWait = null;
  if (stubbed || !ownFaceless() || !facesShow()) return;
  if (round >= FACE_WAITS.length) { facesWaited = true; return; }
  faceWait = setTimeout(async () => {
    if (!ownFaceless() || !facesShow()) { faceWait = null; return; }
    const answer = await chrome.runtime.sendMessage({ account: 'personas', url: siteOf(hereUrl), faceless: facelessSlugs() }).catch(() => null);
    if (run !== faceRun) return;
    // A list that didn't come leaves the letters as they are: the next wait asks again.
    const mine = (answer?.ok ? answer.personas : []).filter((each) => each.mine);
    const faces = new Map(mine.filter((each) => each.face).map((each) => [each.slug, each.face]));
    // The create answers the name and role only: the full profile comes with the list, so each of theirs takes its card from it.
    const cards = new Map(mine.map((each) => [each.slug, { name: each.name, role: each.role, ...(each.about ? { about: each.about } : {}) }]));
    const dressed = (each) => (!each?.mine || !cards.has(each.slug) ? each : { ...each, ...cards.get(each.slug), ...(!each.face && faces.has(each.slug) ? { face: faces.get(each.slug) } : {}) });
    if (pre.made) pre.made = dressed(pre.made);
    if (pre.personas) pre.personas = pre.personas.map(dressed);
    if (pre.yours) pre.yours = pre.yours.map(dressed);
    for (const node of app.querySelectorAll('[data-face]')) {
      const slug = node.getAttribute('data-face');
      if (!faces.has(slug)) continue;
      const size = Number(/width:(\d+)px/.exec(node.getAttribute('style'))?.[1]);
      node.setAttribute('style', face({ face: faces.get(slug) }, size, node.getAttribute('data-mood')).getAttribute('style'));
      node.replaceChildren();
    }
    for (const hero of app.querySelectorAll('.hero[data-slug]')) {
      const card = cards.get(hero.getAttribute('data-slug'));
      if (!card) continue;
      for (const [cls, text] of [['name', card.name], ['about', card.about || card.role]]) { const node = hero.querySelector(`.${cls}`); if (node && node.textContent !== text) node.textContent = text; }
    }
    retip();
    waitForFaces(round + 1, run);
  }, FACE_WAITS[round]);
}

/** Why a persona wasn't made, in one line: anything the person can't fix here is "try again later". */
const UNMADE = { short: COPY.make.short, scope: COPY.make.scope, 'not-pro': COPY.why['not-pro'] };
const unmade = (answer) => (answer?.why === 'limit' ? COPY.make.limit(answer.max) : UNMADE[answer?.why] ?? COPY.make.later);
/** How many personas of their own the server lets a person have: its word on a refusal, else the 3 it allows today. */
let ownMax = 3;

/** Make a persona: the description becomes the person's own persona (the draft takes up to about half a minute), drawn in place. */
async function make(box) {
  if (pre.making) return;
  hush();
  pre.describe = (box.value ?? pre.describe).trim();
  if (!pre.describe) { box.focus(); return; }
  pre.making = true;
  pre.note = '';
  render();
  const answer = await chrome.runtime.sendMessage({ account: 'create', description: pre.describe, device: pre.device, ...(pre.disability !== 'none' ? { disability: pre.disability } : {}) }).catch(() => null);
  pre.making = false;
  if (!answer?.ok) { if (answer?.why === 'limit' && Number.isInteger(answer.max)) ownMax = answer.max; pre.note = unmade(answer); render(); return; }
  pre.describe = '';
  pre.made = answer.persona ?? null;
  render();
  facesWaited = false;
  waitForFaces();
}

/** Home again; with `list` (the persona just made first, or an app's), the grid shows it, its first picked. */
function goHome(list) {
  if (list) { pre.personas = list; choose(0); }
  Object.assign(pre, { screen: 'home', made: null, note: '', modal: false, appsOpen: false });
  render();
}

/** Confirm: the persona made goes first in the grid, picked. */
const confirmMade = () => goHome([pre.made, ...(pre.personas ?? []).filter((each) => !(each.mine && each.slug === pre.made.slug))]);

/**
 * The person's apps, asked each time Make a persona opens: none unless one of them has personas of its own, asked app by
 * app (without faces) until one has. Set once, so "Use a persona from your app" never shows and goes.
 */
async function loadApps() {
  const answer = await chrome.runtime.sendMessage({ account: 'apps' }).catch(() => null);
  const apps = answer?.ok ? answer.apps : null;
  let cast = false;
  for (const one of apps ?? []) {
    cast = Boolean(castOf(await chrome.runtime.sendMessage({ account: 'personas', app: appRef(one), faceless: [] }).catch(() => null))?.length);
    if (cast) break;
  }
  pre.apps = apps && (cast ? apps : []);
  appsAsked = false;
  if (screen() === 'make' || screen() === 'home') render();
}
let appsAsked = false;
/** At the limit of their own, only an app's personas are left: the + stays open once one of their apps has some. */
const ownFull = () => (pre.personas ?? []).filter((each) => each.mine).length >= ownMax;

/** One app's personas, in the modal. */
async function openApp(one) {
  const key = appKey(one);
  Object.assign(pre, { app: key, appsOpen: false, appPersonas: undefined });
  render();
  const answer = await chrome.runtime.sendMessage({ account: 'personas', app: appRef(one) }).catch(() => null);
  if (pre.app !== key) return;
  pre.appPersonas = castOf(answer);
  if (screen() !== 'make') return;
  render();
  app.querySelector('[data-act="apps"]')?.focus();
}

/** Use these personas: home shows the app's, then the person's own, the first picked; kept for this address unless it is local. */
function useApp() {
  const app = pre.apps.find((each) => appKey(each) === pre.app);
  // The site the modal was opened on: the tab may have moved since.
  const site = pre.modalSite;
  goHome([...pre.appPersonas, ...(pre.personas ?? []).filter((each) => each.mine)]);
  if (site && !stubbed && !localSite(site)) void keepApp(site, app);
}

/** Closes the modal; focus goes back to the button that opened it. */
const shut = () => { Object.assign(pre, { modal: false, appsOpen: false }); render(); app.querySelector('[data-act="from-app"]')?.focus(); };
// Escape closes the modal wherever the focus is, and the account popover; on Your personas it answers No.
document.addEventListener?.('keydown', (event) => { if (event.key === 'Escape' && pre.modal && screen() === 'make') shut(); else if (event.key === 'Escape' && pre.menu) closeMenu(); else if (event.key === 'Escape' && pre.sure && screen() === 'personas') keep(pre.sure); });

/** "Use a persona from your app": a dropdown of the apps, the one picked's personas, and Use these personas. */
function appModal() {
  const chosen = pre.apps?.find((app) => appKey(app) === pre.app);
  const list = pre.appPersonas;
  const ready = Boolean(chosen && list?.length);
  return el('div', { class: 'scrim', onclick: (event) => { if (event.target === event.currentTarget) shut(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title',
      onkeydown: (event) => { if (event.key === 'Escape') shut(); } },
      el('div', { class: 'modal-head' }, el('h2', { id: 'modal-title', text: COPY.make.fromApp }),
        el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'close', title: COPY.make.close, 'aria-label': COPY.make.close, onclick: shut }, icon('close'))),
      el('div', { class: 'drop' },
        el('button', { class: 'pick-app', type: 'button', 'data-act': 'apps', 'aria-haspopup': 'true', 'aria-expanded': pre.appsOpen ? 'true' : 'false', onclick: () => { pre.appsOpen = !pre.appsOpen; render(); } },
          el('span', { class: chosen ? '' : 'ph', text: chosen?.name ?? COPY.make.pickApp }), icon('down')),
        pre.appsOpen ? el('ul', { class: 'apps', 'aria-label': COPY.make.fromApp }, (pre.apps ?? []).map((app, i) => el('li', {},
          el('button', { type: 'button', 'data-act': `app-${i}`, 'aria-pressed': appKey(app) === pre.app ? 'true' : 'false', onclick: () => { void openApp(app); } }, app.name)))) : null),
      !chosen ? null : list === undefined ? el('div', { class: 'modal-mid' }, dots()) : !list?.length ? el('p', { class: 'task modal-mid', text: list === null ? COPY.make.appFailed : COPY.make.appNone })
        : grid(list.map((each) => el('span', { class: 'cast-one', role: 'listitem' }, face(each, sized(list.length)), el('span', { class: 'cast-name', text: each.name }))), { role: 'list', 'aria-label': chosen.name }, list.length),
      el('div', { class: 'pair' }, button('cancel', COPY.make.cancel, 'sec', shut),
        el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'use-these', disabled: !ready, text: COPY.make.useThese, onclick: useApp }))));
}

const dots = () => el('span', { class: 'dots' }, el('i'), el('i'), el('i'));

/** A person, soft shapes only: a round head over a rounded shoulder curve, centred in its 24 × 24 box. */
function silhouette() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'who');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const head = document.createElementNS(SVG, 'circle');
  for (const [key, value] of [['cx', '12'], ['cy', '7.6'], ['r', '3.8']]) head.setAttribute(key, value);
  const shoulders = document.createElementNS(SVG, 'path');
  shoulders.setAttribute('d', 'M4.6 18.6c0-3.4 3.3-5.6 7.4-5.6s7.4 2.2 7.4 5.6c0 1-.8 1.8-1.8 1.8H6.4c-1 0-1.8-.8-1.8-1.8z');
  svg.append(head, shoulders);
  return svg;
}
/** The face a persona not made yet has; `cls` adds the shimmer while it's made. */
const blank = (cls = '') => el('span', { class: `face blank ${cls}`.trim(), 'aria-hidden': true, style: 'width:112px;height:112px;' }, silhouette());

/**
 * Make a persona, laid out as the home: the intro plays where the face will be until it's made, a shimmer shows while
 * it's made, then who was made, with Confirm. Top right, a button to use an app's personas instead.
 */
function maker() {
  const made = pre.made;
  const box = el('textarea', { class: 'text', rows: 3, maxlength: 1500, placeholder: voice ? COPY.voice.listening : COPY.make.describe, 'aria-label': COPY.make.describe, disabled: pre.making, oninput: (event) => { pre.describe = event.target.value; voice?.retype(pre.describe); } });
  box.value = pre.describe;
  box.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void make(box); } });
  const create = el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'make', disabled: pre.making, text: COPY.make.action, onclick: () => { void make(box); } });
  const intro = !made && !pre.making && !ownFull() ? introHero() : null;
  const hero = made ? el('div', { class: 'hero', 'data-slug': made.slug }, face(made, 112), el('span', { class: 'name', text: made.name }), el('p', { class: 'about', text: made.about || made.role }), traits())
    : pre.making ? el('div', { class: 'hero is-making', role: 'status', 'aria-label': COPY.make.making }, blank('skel'), el('span', { class: 'skel skel-name' }), el('span', { class: 'skel skel-line' }), el('span', { class: 'skel skel-line short' }))
      : intro?.hero ?? el('div', { class: 'hero' }, blank());
  // While the intro plays, the box is there but unseen and out of reach; it fades in as the last line settles.
  const plays = intro && !still();
  const wait = plays ? intro.left : 0;
  clearTimeout(introWait);
  introWait = wait > 0 ? setTimeout(revealBox, wait) : null;
  const parts = [
    el('div', { class: 'top' }, made || pre.making ? null : el('button', { class: 'btn btn-sec sm icon-only', type: 'button', 'data-act': 'back', title: COPY.top.back, 'aria-label': COPY.top.back, onclick: () => goHome() }, icon('back')),
      el('span', { class: 'grow' }),
      made || pre.making || !pre.apps?.length ? null : button('from-app', COPY.make.fromApp, 'sec sm', () => { Object.assign(pre, { modal: true, appsOpen: false, modalSite: siteOf(hereUrl) }); render(); app.querySelector('[data-act="apps"]')?.focus(); })),
    el('div', { class: 'middle' }, hero),
    made ? el('div', { class: 'box' }, button('confirm', COPY.make.confirm, 'gold full tall', confirmMade)) : el('div', { class: plays ? 'box waits' : 'box', inert: wait > 0, style: plays ? `animation-delay:${wait}ms` : undefined },
            // At the limit, picking an app's personas is all that's left here: the limit stands where the form was.
      ownFull() && !pre.making ? el('p', { class: 'err below', role: 'status', 'data-state': 'full', text: COPY.make.limit(ownMax) }) : [
        el('div', { class: 'traits-pick' }, el('p', { class: 'pick-h', id: 'device-h', text: COPY.make.device }), devices(), el('p', { class: 'pick-h', id: 'needs-h', text: COPY.make.disability }), needs()),
        el('div', { class: 'field' }, box, voice ? listening(create) : el('div', { class: 'row' },
          Speech && !pre.making ? micButton() : null,
          el('span', { class: 'grow' }),
          create)),
        pre.note ? el('p', { class: 'err below', role: 'alert', text: pre.note }) : null]),
  ];
  // Open, the modal is all there is: what's behind it can't be reached.
  if (!pre.modal) return parts;
  for (const part of parts) part.setAttribute('inert', '');
  return [...parts, appModal()];
}

/** How long each of the intro's lines shows, and how much longer the first stays still before the first change. */
const BEAT = 4000;
const LEAD = 2000;
/** When the intro's line and face `i` come in. */
const due = (i) => i && LEAD + i * BEAT;
/**
 * Before one is made, Create a persona's intro plays where its face will be: her faces cross-fade and each line
 * settles in letter by letter as the one before fades, then it stays on the last. The ring around the face fills
 * while each line holds, so it shows how long until the next. Every line is drawn at once, stacked,
 * and CSS plays each at its own delay, timed from when the screen first drew it, so a redraw carries on where it was;
 * with reduced motion only the last face and line show. The box's own label asks the same, so it is hidden from readers.
 */
function introHero() {
  const at = Date.now() - (pre.shown ??= Date.now());
  let last = 0;
  // Letters in words, so a narrow panel wraps a line between words.
  const lines = COPY.intro.map((text, i) => {
    let k = 0;
    const words = text.split(' ').flatMap((word, w) => [w ? ' ' : null, el('span', {}, [...word].map((ch) => {
      last = due(i) + 160 + (w + k++) * 16;
      return el('span', { text: ch, style: i ? `animation-delay:${last - at}ms` : undefined });
    }))]);
    return el('span', { style: `animation-delay:${due(i + 1) - at}ms` }, words);
  });
  // Four faces for COPY.intro's five lines: the fourth stays for the last two. panel.css's ring counts the same lines.
  const hero = el('div', { class: 'hero intro', 'aria-hidden': 'true', style: `--beat:${BEAT}ms;--lead:${LEAD}ms;--since:${at}ms` },
    el('span', { class: 'intro-pics' }, [1, 2, 3, 4].map((n, i) => el('img', { class: 'intro-pic', src: `intro/intro-${n}.webp`, alt: '', style: `animation-delay:${due(i) - at}ms` })), ring()),
    el('span', { class: 'intro-line' }, lines));
  // `left`: how long until the last line's last letter has settled (panel.css's intro-settle, 700ms).
  return { hero, left: last + 700 - at };
}

/** The intro over, the box below it is drawn again within reach, and takes the focus the screen opened with. */
let introWait = null;
function revealBox() {
  introWait = null;
  if (screen() !== 'make') return;
  render();
  if (!document.activeElement || document.activeElement === document.body) app.querySelector('textarea')?.focus();
}

/** Round the intro's face: a faint track, and a gold arc on it that grows round from the top while each line holds. */
function ring() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'intro-ring');
  svg.setAttribute('viewBox', '0 0 170 170');
  for (const part of ['track', 'arc']) {
    const circle = document.createElementNS(SVG, 'circle');
    for (const [key, value] of [['class', part], ['cx', '85'], ['cy', '85'], ['r', '81'], ['pathLength', '100']]) circle.setAttribute(key, value);
    svg.append(circle);
  }
  return svg;
}

/** Above the box, every choice in sight: the persona's device, and one disability (picked again, it goes back to none). */
function devices() {
  return el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'device-h' }, WIDTHS.map((device) => el('button', {
    type: 'button', 'data-act': `device-${device}`, 'aria-pressed': pre.device === device ? 'true' : 'false', disabled: pre.making,
    onclick: () => { pre.device = device; render(); },
  }, icon(device), COPY.home.widths[device])));
}
function needs() {
  const chosen = pre.disability;
  return el('div', { class: 'chips', role: 'group', 'aria-labelledby': 'needs-h' }, Object.entries(COPY.make.disabilities).map(([key, [name, line]]) => el('button', {
    type: 'button', 'data-act': `need-${key}`, 'aria-pressed': key === chosen ? 'true' : 'false', title: line || undefined, 'aria-describedby': line ? `need-${key}-line` : undefined, disabled: pre.making,
    onclick: () => { pre.disability = key === chosen ? 'none' : key; render(); },
    // What it means, read out after the name, and shown under the chips while it has keyboard focus: hidden from the
    // chip's own name, so that stays the word on it.
  }, icon(NEEDS[key]), name, line ? el('span', { id: `need-${key}-line`, class: 'need-line', 'aria-hidden': 'true', text: line }) : null)));
}
/** Under the persona made: its device and disability, small. */
const traits = () => el('p', { class: 'traits', 'data-device': pre.device, 'data-disability': pre.disability },
  el('span', {}, icon(pre.device), COPY.home.widths[pre.device]),
  pre.disability !== 'none' ? el('span', {}, icon(NEEDS[pre.disability]), COPY.make.disabilities[pre.disability][0]) : null);

/**
 * Faces in rows, the second centred under the first, + last where there is one. Six personas or fewer, larger (`roomy`):
 * one row up to four tiles, else two even rows (three and two, three and three, four and three). More: at most two rows of five; past ten tiles, still two rows, as one block that scrolls sideways (`wide`).
 */
const roomy = (people) => people <= 6;
const sized = (people) => (roomy(people) ? 48 : 44);
function grid(tiles, props, people) {
  const row = roomy(people) ? 4 : 5;
  // Six or fewer: one row while the tiles fit in four, else two rows as even as they go, the longer on top (5 tiles: 3 and 2).
  const first = roomy(people) ? (tiles.length <= row ? row : Math.ceil(tiles.length / 2)) : tiles.length <= row * 2 ? row : Math.ceil(tiles.length / 2);
  const rows = [tiles.slice(0, first), tiles.slice(first)].filter((each) => each.length);
  return el('div', { ...props, class: `cast scrolls${roomy(people) ? ' roomy' : tiles.length > row * 2 ? ' wide' : ''}` }, rows.map((each) => el('div', { class: 'cast-row' }, each)));
}

function cast() {
  // Their apps are asked for once at the limit, as only an app's personas would open the + then.
  if (ownFull() && pre.apps === undefined && !appsAsked && BUILD.account && !stubbed) { appsAsked = true; void loadApps(); }
  const full = ownFull() && !pre.apps?.length;
  const people = pre.personas?.length ?? 0;
  return grid([
    ...(pre.personas ?? []).map((each, i) => el('button', {
      type: 'button', class: i === pre.pick ? 'sel' : '', title: each.name, 'aria-label': each.name, 'aria-pressed': i === pre.pick ? 'true' : 'false', 'data-act': `pick-${i}`,
      onclick: () => { choose(i); pre.note = ''; render(); },
    }, face(each, sized(people)), el('span', { class: 'cast-name', text: each.name }))),
    // At the limit of their own with no app's personas to pick, the + stays (focusable, saying why) and does nothing.
    full ? el('button', { type: 'button', class: 'add', 'aria-disabled': 'true', 'aria-label': COPY.make.full(ownMax), 'data-tip': COPY.make.full(ownMax), 'data-act': 'make-persona', onclick: () => undefined }, el('span', { class: 'face' }, icon('plus')))
      : el('button', { type: 'button', class: 'add', 'aria-label': COPY.home.make, 'data-tip': COPY.home.make, 'data-act': 'make-persona', onclick: () => {
        Object.assign(pre, { screen: 'make', shown: undefined, made: null, note: '', modal: false, app: null, appPersonas: undefined, device: 'desktop', disability: 'none' });
        if (BUILD.account && !stubbed) void loadApps();
        render();
        app.querySelector('textarea')?.focus();
      } },
        el('span', { class: 'face' }, icon('plus'))),
  ], { role: 'group', 'aria-label': COPY.home.who }, people);
}

/** Personas (or History) that didn't load: sign in again when the sign-in is gone, else try again. */
function unloaded(why = pre.failed, retry = () => { pre.personas = undefined; render(); void loadPersonas(); }) {
  if (why !== 'signed-out') return button('retry', COPY.home.retry, 'gold', retry);
  const again = el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'sign-in', text: COPY.home.signIn, onclick: () => { void signIn(again); } });
  return again;
}

/** The account or its personas still coming: the top bar and the dots, as the home draws them. */
const loading = () => [top(hereUrl, { tools: true }), el('div', { class: 'mid' }, dots())];

function home() {
  const person = picked();
  if (pre.personas === undefined) return loading();
  // Every account has personas, the six defaults at least: a list that came back empty is one that didn't load.
  if (!person) return [top(hereUrl, { tools: true }), el('div', { class: 'mid' }, el('p', { class: 'act', text: COPY.home.failed }), unloaded())];
  const box = el('textarea', { class: 'text scrolls', rows: 3, maxlength: 2000, placeholder: voice ? COPY.voice.listening : COPY.home.ask(person.name), 'aria-label': COPY.home.ask(person.name), oninput: (event) => { pre.task = event.target.value; voice?.retype(pre.task); askEarly(); } });
  box.value = pre.task;
  const send = () => { hush(); pre.task = (box.value ?? pre.task).trim(); if (pre.task) void plan(); else box.focus(); };
  box.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
  return [
    top(hereUrl, { tools: true }),
    el('div', { class: 'middle' },
      el('div', { class: 'hero', 'data-slug': person.mine ? person.slug : undefined }, face(person, 112), el('span', { class: 'name', text: person.name }), el('p', { class: 'about', text: person.about || person.role })),
      cast()),
    el('div', { class: 'box' },
      pre.note ? el('p', { class: 'err', role: 'alert', text: pre.note }) : null,
      // Screen on the left and Sees on the right, as tabs on the box's top edge.
      el('div', { class: 'tabs' }, widths(), sights()),
      el('div', { class: 'field' }, box,
        voice ? listening(button('send', COPY.home.send, 'gold', send)) : el('div', { class: 'row' },
          Speech ? micButton() : null,
          el('span', { class: 'grow' }),
          button('send', COPY.home.send, 'gold', send))),
    ),
  ];
}

/** Reduced motion: the bars hold a still, gentle arch, and listening still shows. */
const still = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
// Turned on or off while Create a persona's intro plays: the box under it follows at once (see maker).
globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', () => { if (screen() === 'make') render(); });
const STILL = Array.from({ length: BARS }, (_, i) => 0.12 + 0.3 * Math.sin((Math.PI * i) / (BARS - 1)));

/** The mic: press to talk; while listening the same button, selected, stops it. */
const micButton = () => el('button', { class: 'mic', type: 'button', 'data-act': 'mic', 'aria-pressed': voice ? 'true' : 'false', title: voice ? COPY.voice.stop : COPY.voice.talk, 'aria-label': voice ? COPY.voice.stop : COPY.voice.talk, onclick: () => { void talk(); } }, icon('mic'));

/** While listening: the mic (selected), the waveform moving with the mic's level (flat dots when quiet), and the box's own button (`go`). */
function listening(go) {
  const levels = still() ? STILL : pre.levels ?? Array(BARS).fill(0);
  return el('div', { class: 'row voice-row' },
    micButton(),
    el('div', { class: 'wave', 'aria-hidden': true, 'data-still': still() ? 'yes' : undefined }, levels.map((level) => el('i', { style: `--l:${level.toFixed(3)}` }))),
    go);
}

/** New levels from the mic: the bars change in place, so the box keeps its words and the caret. */
function drawLevels(levels) {
  pre.levels = levels;
  const wave = app.querySelector('.wave');
  if (!wave) return;
  wave.querySelectorAll('i').forEach((bar, i) => bar.style?.setProperty('--l', levels[i].toFixed(3)));
}

/** The mic's level for the waveform, beside the recognition `heard`: nothing to read where motion is reduced. */
function startMeter(heard) {
  pre.levels = null;
  if (still() || !navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) return;
  void meter({ media: navigator.mediaDevices, Audio: globalThis.AudioContext, frame: (tick) => requestAnimationFrame(tick), cancel: (id) => cancelAnimationFrame(id), onLevels: drawLevels }).then((stop) => {
    if (!stop) return;
    // Listening ended while the stream was being opened.
    if (voice !== heard) { stop(); return; }
    metering = stop;
  });
}

function stopMeter() {
  const stop = metering;
  metering = null;
  pre.levels = null;
  stop?.();
}

/** Desktop, Tablet or Phone: the width the journey runs at, kept for next time. */
function widths() {
  return el('div', { class: 'widths', role: 'group', 'aria-label': COPY.home.width }, WIDTHS.map((width) => el('button', {
    type: 'button', 'data-act': `size-${width}`, 'aria-pressed': pre.width === width ? 'true' : 'false', 'data-tip': COPY.home.widths[width], 'aria-label': COPY.home.widths[width],
    onclick: () => { pre.width = width; ownWidth = width; void chrome.storage.local.set({ walkWidth: width }).catch(() => undefined); render(); },
  }, icon(width))));
}

/** Normal, blurry and low contrast, or colour-blind: how the persona sees the page on this journey alone; on hover, how common it is. */
function sights() {
  const facts = Object.fromEntries(Object.keys(SIGHTS).map((sees) => [sees, common(sees, picked())]));
  return el('div', { class: 'widths sights', role: 'group', 'aria-label': COPY.home.sight }, Object.entries(SIGHTS).map(([sees, look]) => el('button', {
    type: 'button', 'data-act': `sees-${sees}`, 'aria-pressed': pre.sees === sees ? 'true' : 'false', 'aria-label': COPY.home.sights[sees], 'aria-description': facts[sees],
    onclick: () => { pre.sees = sees; render(); },
  }, icon(look), el('span', { class: 'tip', 'aria-hidden': 'true' }, el('span', { class: 'tip-h', text: COPY.home.sights[sees] }), el('span', { class: 'tip-fact', text: facts[sees] })))));
}
/** The Sees figures again, in place, for a card whose profile came after it was drawn (`waitForFaces`). */
function retip() {
  for (const sees of Object.keys(SIGHTS)) {
    const button = app.querySelector(`[data-act="sees-${sees}"]`);
    const fact = button?.querySelector('.tip-fact');
    if (!fact) continue;
    fact.textContent = common(sees, picked());
    button.setAttribute('aria-description', fact.textContent);
  }
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
  const at = screen();
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
    if (screen() === at && !voice) hear();
  };
  // The mic page opens once per press; it shows the blocked state and Chrome's settings itself.
  void chrome.tabs.create({ url: chrome.runtime.getURL('walks/mic/mic.html'), active: true, ...(here ? { openerTabId: here } : {}) })
    .catch(() => undefined)
    .finally(() => { setTimeout(() => { asking = false; }, 1500); });
}

/** Listens once: the words go into this screen's box as they come, after what is there, and stay there to edit until Send or Create. */
function hear() {
  pre.note = '';
  let ended = false;
  const at = screen();
  const [words, most] = VOICE_BOXES[at];
  const heard = listen(Speech, {
    base: pre[words],
    lang: navigator.language || 'en-US',
    // The box holds what typing can: a longer talk stops there and says so, rather than going on unseen.
    onText: (text, settled) => {
      pre[words] = text.slice(0, most);
      if (words === 'task') askEarly();
      const box = app.querySelector('textarea.text');
      // The newest words in view: a long talk outgrows the box.
      if (box) { box.value = pre[words]; box.scrollTop = box.scrollHeight; fade(box); }
      // Only on final words: an interim guess can run long and then shrink.
      if (text.length > most && settled && voice) { pre.note = COPY.voice.full; voice.stop(); }
    },
    onEnd: (error) => { ended = true; voice = null; stopMeter(); if (error) pre.note = COPY.voice[error] ?? COPY.voice.failed; render(); },
  });
  // A recognizer that failed to start has already ended: keep no dead handle, or the button stays pressed.
  if (!ended) { voice = heard; voiceAt = at; startMeter(heard); }
  render();
}

/** A task box whose words run past an edge fades there (`data-fade`: `top`, `bottom`, both or none), rather than looking cut off. */
function fade(box) {
  const top = box.scrollTop > 1;
  const bottom = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  box.setAttribute('data-fade', [top && 'top', bottom && 'bottom'].filter(Boolean).join(' '));
}

/** Ends listening at once, keeping the words so far: on Send, and when the panel leaves the box. */
function hush() {
  const was = voice;
  voice = null;
  stopMeter();
  was?.drop();
}

const WHY = COPY.why;

/**
 * The plan asked for while the person pauses writing, before they send it, so the walk usually has its plan ready
 * (REN-2190: the plan is one model call of about 4 s). Keyed by who walks, the words, the tab, its address and the width;
 * Send takes it only when all are still the same (a tab gone to another page asks again), else asks again. One the person never sends is dropped here, unsaid. At most
 * one is asked at a time and {@link EARLY_MAX} between sends: each spends one of the person's plans an hour.
 */
const EARLY_PAUSE_MS = 1200;
const EARLY_MIN = 12;
const EARLY_MAX = 3;
let early = null;
let earlyTimer = null;
let earlyAsked = 0;
const planKey = (person, task) => JSON.stringify([refOf(person), task.trim(), here, hereUrl, pre.width]);
const askPlan = (person, task, isEarly) => chrome.runtime.sendMessage({ account: 'plan', persona: refOf(person), task, tabId: here, device: pre.width, ...(isEarly ? { early: true } : {}) }).catch(() => null);
function askEarly() {
  clearTimeout(earlyTimer);
  earlyTimer = setTimeout(() => {
    const person = picked();
    const task = pre.task.trim();
    // The screen shown, not the home's own state: a walk started elsewhere shows over a home still at 'home'.
    if (!person || screen() !== 'home' || task.length < EARLY_MIN || earlyAsked >= EARLY_MAX || early?.pending) return;
    const key = planKey(person, task);
    if (early?.key === key) return;
    earlyAsked += 1;
    const asked = { key, pending: true, answer: askPlan(person, task, true) };
    // Words changed while this one was asked: the newest are asked once it answers, within the same limits.
    asked.answer.finally(() => { asked.pending = false; const now = picked(); if (early === asked && now && planKey(now, pre.task) !== asked.key) askEarly(); });
    early = asked;
  }, EARLY_PAUSE_MS);
}

/** Send: the person's task becomes the persona's short plan, the one already asked for when it is still the one wanted. */
async function plan() {
  const person = picked();
  pre.screen = 'planning';
  pre.note = '';
  render();
  clearTimeout(earlyTimer);
  const ready = early?.key === planKey(person, pre.task) ? early.answer : null;
  early = null;
  earlyAsked = 0;
  const first = ready ? await ready : null;
  const answer = first?.ok ? first : await askPlan(person, pre.task, false);
  if (pre.screen !== 'planning') return;
  // `runAt`: the width this walk will run at, which is Desktop where the server's word on widths was never heard.
  if (answer?.ok) { pre.plan = answer.plan; pre.runAt = WIDTHS.includes(answer.width) ? answer.width : pre.width; pre.screen = 'plan'; } else { pre.note = WHY[answer?.why] ?? COPY.why.failed; pre.screen = 'home'; }
  render();
}

/** Start walk: the approved plan goes with the walk, which then asks nothing mid-way. */
async function go(start) {
  const person = picked();
  start.disabled = true;
  walker = { name: person.name, face: person.face ?? null };
  ended = false;
  const answer = await chrome.runtime.sendMessage({ account: 'walk', persona: refOf(person), task: pre.task, tabId: here, plan: pre.plan.id, walker, device: pre.runAt ?? pre.width, sees: pre.sees }).catch(() => null);
  // How the persona sees was for this journey alone: the next starts from the card again.
  if (answer?.ok) { pre.screen = 'home'; pre.task = ''; pre.plan = null; choose(pre.pick); return; }
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
    COPY.plan.at[pre.width] ? el('p', { class: 'task at', 'data-width': pre.runAt ?? pre.width }, icon(pre.runAt ?? pre.width), pre.runAt === 'desktop' ? COPY.plan.atDesktop : COPY.plan.at[pre.width]) : null,
    pre.sees !== 'normal' ? el('p', { class: 'task at', 'data-sees': pre.sees }, icon(SIGHTS[pre.sees]), COPY.home.sees[pre.sees]) : null,
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
  if (view.ask.kind === 'site') {
    return el('div', { class: 'ask', role: 'alertdialog', 'aria-label': COPY.ask.site(name(), view.ask.what), 'data-kind': 'site' },
      el('p', { class: 'ask-what', text: COPY.ask.site(name(), view.ask.what) }),
      el('div', { class: 'pair' }, button('once', COPY.ask.once), button('always', COPY.ask.always, 'gold')),
      button('no', COPY.ask.notNow, 'ghost'));
  }
  const line = view.ask.kind === 'go' ? COPY.ask.go(name(), view.ask.what) : view.ask.what;
  return el('div', { class: 'ask', role: 'alertdialog', 'aria-label': COPY.ask.title, 'data-kind': view.ask.kind },
    el('p', { class: 'ask-what', text: line }),
    el('div', { class: 'pair' }, button('no', COPY.ask.no), button('yes', COPY.ask.yes, 'gold')),
  );
}

/** A walk that paused itself (a sign-in) or was held goes on only by the person's word. */
function held() {
  // Why the last Continue or Hand back was refused, said once under the pause's own line (`pre.refused`).
  const why = (go) => (Object.hasOwn(COPY.refused, pre.refused ?? '') ? el('p', { class: 'status', role: 'status', 'data-refused': pre.refused, text: COPY.refused[pre.refused](go) }) : null);
  if (view.state === 'paused') {
    const go = view.held === 'sign-in' ? COPY.controls.signedIn : COPY.controls.resume;
    return el('div', { class: 'held' }, el('p', { class: 'status', role: 'status', text: view.held === 'sign-in' ? (view.pictured ? COPY.signInPictured : COPY.signIn) : COPY.paused.line(name()) }),
      view.withheld ? el('p', { class: 'status', role: 'status', 'data-hint': 'stop-and-restart', text: COPY.signInHeld }) : null,
      why(go), button('resume', go, 'gold'));
  }
  if (view.state === 'takeover') return el('div', { class: 'held' }, el('p', { class: 'status', role: 'status', text: COPY.takeover.line(name()) }), why(COPY.controls.handback), button('handback', COPY.controls.handback, 'gold'));
  return null;
}

function walkingScreen() {
  const steps = [...view.steps].reverse();
  return [
    top(view.site ?? hereUrl),
    el('div', { class: 'walk-head' }, view.agent ? null : face(walking(), 112, moodOf(view.steps.at(-1))), el('h2', { class: 'hd', role: 'status', text: !view.agent ? COPY.walking.line(name()) : view.state === 'waiting' ? COPY.yourAgent.wants(name()) : COPY.yourAgent.line(name()) })),
    question(),
    held(),
    steps.length > 0 ? el('ol', { class: 'sofar scrolls' }, steps.map((step, i) => el('li', { class: i === 0 ? 'now' : '', 'data-n': step.n, 'data-issue': step.issue ? 'yes' : undefined },
      el('span', { class: 'n', text: String(step.n) }),
      el('span', { class: 't' }, i === 0 ? el('b', { text: step.did }) : step.did, i === 0 && step.said ? el('q', { text: step.said }) : null)))) : view.agent && view.state === 'waiting' ? null : el('p', { class: 'task', text: view.agent ? COPY.yourAgent.first(name()) : COPY.walking.first(name()) }),
    el('span', { class: 'grow' }),
    el('div', { class: 'bar' }, el('button', { type: 'button', 'data-act': 'stop', onclick: () => act('stop') }, COPY.controls.stop)),
  ];
}

/* The steps list stays one list from drawing to drawing (`keepSteps`), so a new step eases in at the top, the rows
   below slide down to make room, and the gold card fades from the old step (FLIP: where each row was, where it is
   now, then the difference undone). Transform and opacity only; none with reduced motion. */
const STEP_MS = 240;
/** The steps list's animations under way: cancelled by the next drawing, whichever screen it is. */
let stepMoves = [];
const isSteps = (node) => typeof node?.className === 'string' && node.className.split(' ').includes('sofar');

/** The rows drawn into the list shown: a step already there keeps its row (its class and words brought up to date). */
function keepSteps(list, drawn) {
  const had = new Map([...list.children].map((row) => [row.getAttribute('data-n'), row]));
  list.replaceChildren(...[...drawn.children].map((row) => {
    const kept = had.get(row.getAttribute('data-n'));
    if (!kept) return row;
    kept.className = row.className;
    if (row.getAttribute('data-issue')) kept.setAttribute('data-issue', 'yes');
    kept.replaceChildren(...row.children);
    return kept;
  }));
  return list;
}

/** Where each row of the list is, and which one is the current step, before it changes. */
const placed = (list) => typeof list.getBoundingClientRect === 'function'
  ? { tops: new Map([...list.children].map((row) => [row, row.getBoundingClientRect().top])), now: [...list.children].find((row) => row.className === 'now') }
  : null;

/** Once a step was added: the new row comes in, the others move from where they were, the old current step's card fades. */
function ease(list, was) {
  if (!was || still() || typeof list.animate !== 'function' || list.children.length <= was.tops.size) return;
  const timing = { duration: STEP_MS, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease-out' };
  for (const row of list.children) {
    const top = was.tops.get(row);
    if (top === undefined) stepMoves.push(row.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], timing));
    else {
      const by = top - row.getBoundingClientRect().top;
      if (Math.abs(by) > 0.5) stepMoves.push(row.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], timing));
    }
  }
  if (was.now && was.now.className !== 'now') {
    stepMoves.push(was.now.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, pseudoElement: '::before' }));
    const words = was.now.querySelector('.t');
    if (words) stepMoves.push(words.animate([{ opacity: 0.3 }, { opacity: 1 }], timing));
  }
}

/* ------------------------------ the end ------------------------------ */

/** What the walk found: the server's count once it finished, else the issues its steps showed. */
const found = () => (view.outcome ? view.outcome.issues.length : view.steps.filter((step) => step.issue).length);
const resultsUrl = () => view.outcome?.replayUrl ?? walkUrl;

/**
 * The end screen's face, as the web's outcomes have it (REN-2331, src/app-rpc/walk-outcome.ts): got through is
 * delighted, with friction or got partway is confused. No verdict (no boolean `finished`) is no mood.
 */
function mood(state) {
  if (state === 'failed') return 'confused';
  const ending = state === 'done' ? verdict() : null;
  return ending === 'through' ? 'delighted' : ending ? 'confused' : 'neutral';
}

/** A finished walk's outcome, as the web names it: through, friction or partway; null with no verdict. */
function verdict() {
  const finished = view.outcome?.finished;
  if (typeof finished !== 'boolean') return null;
  return !finished ? 'partway' : view.outcome.issues.length ? 'friction' : 'through';
}

function end() {
  const state = view.state;
  const n = found();
  const link = resultsUrl();
  const reason = state === 'failed' ? view.failure?.reason ?? 'connection' : null;
  const why = reason ? (typeof COPY.failed[reason] === 'function' ? COPY.failed[reason](view.site, name()) : COPY.failed[reason]) : null;
  // The first deed the person said No to (a walk with no plan): the walk's page says it in these words. `held` is not a No.
  const saidNo = view.outcome && !view.outcome.finished ? view.steps.find((step) => step.refused === 'no')?.n : undefined;
  const head = state === 'done' ? COPY.end[verdict() ?? 'done'](name()) : state === 'stopped' ? COPY.end.stopped(name()) : COPY.end.failed;
  const label = n > 0 ? COPY.end.found(name(), n) : COPY.end.see(name());
  // No results page to open (a walk from the terminal that ended early): the way home instead.
  const results = link ? el('button', { class: 'btn btn-gold btn-big', type: 'button', 'data-act': 'results', 'data-issues': String(n),
    onclick: () => { void chrome.tabs.create({ url: link, active: true }).catch(() => undefined); ended = true; render(); } },
  el('span', { class: 'big-t' }, el('b', { text: label }), n > 0 && state === 'stopped' ? el('small', { text: COPY.end.beforeStop }) : null), icon('out'))
    : button('home', COPY.end.home, 'sec full', () => { ended = true; render(); });
  return [
    // The way back to the home, in the top row as on every other screen; the results stay one press away below.
    top(view.site ?? hereUrl, { back: () => { ended = true; render(); } }),
    el('div', { class: `end${state === 'done' ? '' : ' is-still'}` },
      face(walking(), 132, mood(state)),
      el('h2', { class: 'hd', role: 'status', text: head }),
      why ? el('p', { class: 'err', role: 'alert', text: why }) : saidNo ? el('p', { class: 'line task', text: COPY.end.saidNo(name(), saidNo) }) : view.workflow?.goal ? el('q', { class: 'task', text: view.workflow.goal }) : null),
    el('span', { class: 'grow' }),
    results,
  ];
}

/* ------------------------------ history ------------------------------ */

/**
 * Every journey this person started (from here, the terminal or an agent), newest first, as the account worker reads
 * them; undefined while they come, null when they couldn't be read. A stand-in keeps its own list (stub.js `HISTORY`).
 */
const historyItems = () => pre.history;
let historyLoad = null;
function loadHistory() {
  if (stubbed) return null;
  // Asked once at a time: a second press while it comes waits on the same answer.
  historyLoad ??= (async () => {
    pre.history = undefined;
    const answer = await chrome.runtime.sendMessage({ account: 'journeys' }).catch(() => null);
    pre.history = answer?.ok ? answer.journeys : null;
    pre.historyWhy = answer?.ok ? null : answer?.why ?? null;
    if (pre.screen === 'history') render();
  })().finally(() => { historyLoad = null; });
  return historyLoad;
}

/** History: every journey as a row (who, the task, how it ended, and when); a row opens its page in a new tab. */
function history() {
  const items = historyItems();
  const head = [top(hereUrl, { back: () => goHome() }), el('h2', { class: 'hd hist-hd', text: COPY.history.title })];
  if (items === undefined) return [...head, el('div', { class: 'mid' }, dots())];
  // Not read is not none: said as the home says personas that didn't load, and asked again.
  if (items === null) return [...head, el('div', { class: 'mid' }, el('p', { class: 'act', text: COPY.history.failed }), unloaded(pre.historyWhy, () => { void loadHistory(); render(); }))];
  if (!items.length) return [...head, el('div', { class: 'mid' }, el('p', { class: 'task', text: COPY.history.none }))];
  return [...head, el('ul', { class: 'hist scrolls', 'aria-label': COPY.history.title }, items.map((one, i) => el('li', {},
    el('button', { type: 'button', class: 'hist-row', 'data-act': `journey-${i}`, 'data-outcome': one.outcome,
      onclick: () => { void chrome.tabs.create({ url: one.url, active: true }).catch(() => undefined); } },
    face(one.persona, 40),
    el('span', { class: 'hist-t' },
      el('span', { class: 'hist-task', text: one.task }),
      el('span', { class: 'hist-foot' },
        el('span', { class: 'hist-end', text: COPY.history.ended[one.outcome](one.persona.name, one.issues) }),
        el('span', { class: 'hist-when', text: COPY.history.when(one.at) }))),
    icon('out')))))];
}

/* ------------------------------ your personas ------------------------------ */

/**
 * Your personas, from the cog: the person's own (each with Remove) then the six everyone has, as the server lists them
 * with no page (undefined while they come, null when they couldn't be read). `sure`: the slug whose row asks "Are you
 * sure?"; `removing` while its Yes is out. A stand-in lists its own personas.
 */
const ownAndDefaults = (list) => [...list.filter((each) => each.mine && each.slug), ...list.filter((each) => each.default)];
function openYours() {
  Object.assign(pre, { menu: false, screen: 'personas', sure: null, removing: false, yoursNote: '' });
  void loadYours();
  render();
  app.querySelector('[data-act="back"]')?.focus();
}
async function loadYours() {
  if (stubbed) { pre.yours = ownAndDefaults(pre.personas ?? []); return; }
  pre.yours = undefined;
  const answer = await chrome.runtime.sendMessage({ account: 'personas' }).catch(() => null);
  pre.yours = answer?.ok ? ownAndDefaults(answer.personas) : null;
  pre.yoursWhy = answer?.ok ? null : answer?.why ?? null;
  if (screen() !== 'personas') return;
  render();
  if (!faceWait) { facesWaited = false; waitForFaces(); }
}

/** Remove: that row asks "Are you sure?", focus on No. */
function ask(slug) {
  Object.assign(pre, { sure: slug, yoursNote: '' });
  render();
  app.querySelector('[data-act="sure-no"]')?.focus();
}
/** No (or Escape): the row as it was, focus back on its Remove. */
function keep(slug) {
  if (pre.sure !== slug || pre.removing) return;
  pre.sure = null;
  render();
  app.querySelector(`[data-act="remove-${slug}"]`)?.focus();
}
/** Yes: the persona goes, from here and from the home's grid; focus on the next Remove, else Back. Journeys stay. */
async function removeMine(person) {
  if (pre.removing) return;
  pre.removing = true;
  render();
  const answer = stubbed ? { ok: true } : await chrome.runtime.sendMessage({ account: 'remove', slug: person.slug }).catch(() => null);
  Object.assign(pre, { removing: false, sure: null });
  if (!answer?.ok) {
    pre.yoursNote = COPY.yours.unremoved(person.name);
    render();
    app.querySelector(`[data-act="remove-${person.slug}"]`)?.focus();
    return;
  }
  const gone = (each) => each?.mine && each.slug === person.slug;
  const at = pre.yours?.findIndex(gone) ?? -1;
  pre.yours = pre.yours?.filter((each) => !gone(each)) ?? pre.yours;
  if (gone(pre.made)) pre.made = null;
  if (pre.personas) {
    const was = picked();
    pre.personas = pre.personas.filter((each) => !gone(each));
    const still = was && !gone(was) ? pre.personas.indexOf(was) : -1;
    if (still >= 0) pre.pick = still; else choose(0);
  }
  render();
  const mine = (pre.yours ?? []).filter((each) => each.mine);
  const next = mine[Math.min(Math.max(at, 0), mine.length - 1)];
  app.querySelector(next ? `[data-act="remove-${next.slug}"]` : '[data-act="back"]')?.focus();
}

/** A row: the face, name and role, then Remove (their own) or Default; asking, only the question with No and Yes. */
function yourRow(person) {
  const sure = pre.sure === person.slug;
  const end = sure
    ? [el('button', { class: 'btn btn-sec sm', type: 'button', 'data-act': 'sure-no', disabled: pre.removing, text: COPY.ask.no, onclick: () => keep(person.slug) }),
      el('button', { class: 'btn btn-gold sm', type: 'button', 'data-act': 'sure-yes', disabled: pre.removing, text: COPY.ask.yes, onclick: () => { void removeMine(person); } })]
    : person.mine ? [el('button', { class: 'btn sm', type: 'button', 'data-act': `remove-${person.slug}`, 'aria-label': COPY.yours.removeOne(person.name), text: COPY.yours.remove, onclick: () => ask(person.slug) })]
      : [el('span', { class: 'hist-when', text: COPY.yours.default })];
  return el('li', { class: 'yours-row', 'data-slug': person.slug, 'data-state': sure ? 'sure' : person.mine ? 'mine' : 'default',
    onkeydown: sure ? (event) => { if (event.key === 'Escape') { event.stopPropagation?.(); keep(person.slug); } } : undefined },
  sure ? null : face(person, 40),
  sure ? el('span', { class: 'hist-t' }, el('span', { class: 'hist-task', role: 'alert', text: COPY.ask.title }))
    : el('span', { class: 'hist-t' }, el('span', { class: 'hist-task', text: person.name }), person.role ? el('span', { class: 'where', title: person.role, text: person.role }) : null),
  // One fixed column on the right: Remove and Default line up row to row, whatever the role's length.
  sure ? end : el('span', { class: 'yours-end' }, end));
}

function yours() {
  const list = pre.yours;
  const head = [top(hereUrl, { back: () => goHome() }), el('h2', { class: 'hd hist-hd', text: COPY.yours.title })];
  if (list === undefined) return [...head, el('div', { class: 'mid' }, dots())];
  // Every account has the six at least: none is a list that didn't load.
  if (!list?.length) return [...head, el('div', { class: 'mid' }, el('p', { class: 'act', text: COPY.home.failed }), unloaded(pre.yoursWhy, () => { void loadYours(); render(); }))];
  return [...head, pre.yoursNote ? el('p', { class: 'err below', role: 'alert', text: pre.yoursNote }) : null,
    el('ul', { class: 'hist scrolls', 'aria-label': COPY.yours.title }, list.map(yourRow))];
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
  if (pre.signingIn) return;
  control.disabled = true;
  pre.signingIn = true;
  if (screen() === 'signed-out') render();
  const answer = await chrome.runtime.sendMessage({ account: 'sign-in' }).catch(() => null);
  pre.signingIn = false;
  signInFailed = answer?.ok !== true;
  if (!signInFailed) account = answer.available === true ? answer : null;
  if (account?.signedIn === true) void loadPersonas();
  // History that couldn't be read for want of a sign-in is asked again too.
  if (account?.signedIn === true && pre.history === null) void loadHistory();
  // Only a sign-in that worked, to an account with Pro, says so ("Sign in again" runs while `account` still says signed in).
  if (!signInFailed && account?.signedIn === true && account.pro !== false) connect();
  render();
}

/**
 * Just signed in (here, or in the popup, which the sign-in window closes: the worker's `connected` in
 * chrome.storage.session): "You're connected" holds for a moment once drawn, then the panel goes on (first run or home).
 */
const CONNECTED_MS = 2000;
let connectedFor = null;
function connect() {
  pre.connected = true;
  void Promise.resolve(chrome.storage.session.remove('connected')).catch(() => undefined);
}

const connected = () => [el('div', { class: 'mid connected', role: 'status' },
  el('span', { class: 'done-mark' }, icon('check')),
  el('h2', { class: 'hd', text: COPY.connected.line }),
  account?.email ? el('p', { class: 'task' }, `${COPY.connected.who} `, el('b', { 'data-email': true, text: account.email })) : null)];

function signedOut() {
  const pro = el('button', { class: 'pro', type: 'button', 'data-act': 'sign-in', disabled: pre.signingIn, onclick: () => { void signIn(pro); } }, mark('mark'), el('span', { text: COPY.signedOut.pro }), pre.signingIn ? dots() : el('span', { class: 'arrow', text: '→' }));
  // The cog where the home has it: the way to report a problem, for someone who can't sign in.
  return [el('div', { class: 'top' }, el('span', { class: 'grow' }), cog()), scanBox(), el('div', { class: 'foot' }, signInFailed && !pre.signingIn ? el('p', { class: 'err', role: 'alert', text: COPY.signedOut.failed }) : null, pro,
    pre.signingIn ? el('p', { class: 'task', role: 'status', text: COPY.signedOut.signingIn }) : null)];
}

/** Signed out from the panel: the account as the worker then says it, else simply signed out. */
async function signOut() {
  const answer = await chrome.runtime.sendMessage({ account: 'sign-out' }).catch(() => null);
  account = answer?.ok === true && answer.available === true ? answer : { ...account, signedIn: false };
  pre.personas = undefined;
  pre.apps = undefined;
  pre.menu = false;
  pre.connected = false;
  render();
}

/**
 * After Get Pro, the account is asked again every few seconds for ten minutes, until it has Pro or this screen goes:
 * the checkout runs in a tab beside the panel, which need not lose or regain focus, and Pro lands a moment after paying.
 * Only a clear answer is taken (Pro, or signed out): one with no word on Pro (the server out of reach) changes nothing.
 */
const PRO_EVERY = 5000;
const settled = (answer) => answer?.pro === true || answer?.signedIn === false;
let proUntil = 0;
let proTimer = null;
const proAgain = () => { proTimer = setTimeout(() => { if (screen() === 'not-pro' && Date.now() < proUntil) void knowAccount(settled).finally(proAgain); else proTimer = null; }, PRO_EVERY); };
function awaitPro() {
  proUntil = Date.now() + 10 * 60 * 1000;
  if (!proTimer) proAgain();
}
/** Asked again on a look (the panel focused, another tab, the tab gone elsewhere): once in 2 s at most, and without Pro, a clear answer only. */
let lookedAt = -Infinity;
function relook() {
  if (Date.now() - lookedAt < 2000) return;
  lookedAt = Date.now();
  void knowAccount(screen() === 'not-pro' ? settled : undefined);
}

/** Signed in without Impeccable Pro, by the server's word: Scan, then Get Pro and another account. */
const notPro = () => [scanBox(), el('div', { class: 'foot' }, el('p', { class: 'task', text: COPY.notPro.line }),
  button('get-pro', COPY.notPro.getPro, 'gold full', () => { awaitPro(); void chrome.runtime.sendMessage({ account: 'get-pro' }).catch(() => undefined); }),
  button('another-account', COPY.notPro.other, 'sec full', () => { void signOut(); }))];

/** How to start a walk with no account: the command, and one press to copy it. */
function terminal() {
  const copy = el('button', { class: 'btn btn-sec', type: 'button', 'data-act': 'copy', text: COPY.copy.action });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(COPY.command); } catch { return; }
    copy.textContent = COPY.copy.done;
    setTimeout(() => { copy.textContent = COPY.copy.action; }, 1600);
  });
  return [scanBox(), el('div', { class: 'foot' }, el('p', { class: 'task', text: COPY.idle.how }), el('code', { class: 'command-line', text: COPY.command }), copy)];
}

/* ------------------------------ first run ------------------------------ */

/** The first time the panel is signed in, before the home: two screens, then never again (chrome.storage.local `firstRunSeen`). */
const foot = (on, action, text, onclick) => el('div', { class: 'fr-foot' },
  el('div', { class: 'fr-dots', 'aria-hidden': true }, Array.from({ length: 2 }, (_, i) => el('i', { class: i === on ? 'on' : '' }))),
  button(action, text, 'gold full tall', onclick));

function beforeYouStart() {
  const words = COPY.firstRun.before;
  return [
    el('div', { class: 'fr-mid' }, el('h2', { class: 'hd', text: words.title }),
      el('ul', { class: 'fr-list' }, words.points.map(([name, fact, more, link]) => el('li', { class: name === 'warn' ? 'warn' : '' }, icon(name),
        el('span', {}, el('b', { text: fact }), ' ', more, link ? [' ', el('a', { href: link[1], target: '_blank', rel: 'noreferrer', text: link[0] })] : null))))),
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
  if (account === undefined) return 'loading';
  if (!account) return 'terminal';
  if (account.signedIn !== true) return 'signed-out';
  if (account.pro === false) return 'not-pro';
  if (pre.connected) return 'connected';
  return pre.screen;
}

const SCREENS = { loading, walking: walkingScreen, end, terminal, 'signed-out': signedOut, 'not-pro': notPro, connected, home, make: maker, planning, plan: planned, scan };

function render() {
  const shown = screen();
  if (shown !== voiceAt) hush();
  // The account popover belongs to the home, and signed out to that screen: another screen closes it.
  if (shown !== 'home' && shown !== 'loading' && shown !== 'signed-out') pre.menu = false;
  // The moment's time runs from when it is first drawn; a stand-in holds it.
  // Back to no Pro (a Scan walk over) within Get Pro's ten minutes: asked again, as before.
  if (shown === 'not-pro' && !proTimer && Date.now() < proUntil) proAgain();
  if (shown === 'connected' && !connectedFor && !stubbed) connectedFor = setTimeout(() => { pre.connected = false; connectedFor = null; render(); }, CONNECTED_MS);
  const focused = document.activeElement?.getAttribute?.('data-act');
  const body = document.body;
  body.dataset.state = view.state;
  body.dataset.screen = shown;
  body.dataset.account = account ? (account.signedIn === true ? 'signed-in' : 'signed-out') : 'off';
  body.dataset.steps = String(view.steps.length);
  body.dataset.ask = view.ask?.kind ?? '';
  body.dataset.reason = view.state === 'failed' ? view.failure?.reason ?? '' : '';
  app.className = `screen screen-${shown}`;
  // Scan's box lives in the page, not in a screen: put it back in the body before the screens are swapped, or it goes with them.
  if (!SCANS.has(shown)) { const box = document.getElementById('panel-scan'); if (box && box !== app) { box.hidden = true; if (box.parentElement !== document.body) document.body.append(box); } }
  // A step list the person scrolled away from its top (the current step) stays where they put it as new steps come.
  const list = app.querySelector('.sofar');
  const kept = list && list.scrollTop > 4 ? { top: list.scrollTop, height: list.scrollHeight } : null;
  const drawn = SCREENS[shown]().filter(Boolean);
  // On the walking screen the steps list is the one already shown, its rows kept, so they can move (`ease`).
  const steps = shown === 'walking' && list ? drawn.findIndex(isSteps) : -1;
  const was = steps >= 0 ? placed(list) : null;
  for (const move of stepMoves) move.cancel();
  stepMoves = [];
  if (steps >= 0) drawn[steps] = keepSteps(list, drawn[steps]);
  app.replaceChildren(...drawn);
  const now = kept && app.querySelector('.sofar');
  if (now) now.scrollTop = kept.top + (now.scrollHeight - kept.height);
  if (steps >= 0) ease(drawn[steps], was);
  for (const box of [...app.querySelectorAll('textarea.text'), ...app.querySelectorAll('ul.hist')]) { fade(box); box.addEventListener('scroll', () => fade(box)); box.addEventListener('input', () => fade(box)); }
  if (focused) app.querySelector(`[data-act="${focused}"]`)?.focus();
}
// The first run's two screens, beside the literal above so that it merges with changes to it.
Object.assign(SCREENS, { before: beforeYouStart, 'tab-group': tabGroup, history, personas: yours });

/** Which tab this panel's window shows: asked when the panel opens, each time another tab comes to the front, and as it loads. */
async function look() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  here = tab?.id ?? null;
  hereUrl = tab?.url ?? '';
}

/** `taken`: whether to take this answer; every answer, but for Get Pro's rechecks. */
async function knowAccount(taken = () => true) {
  const answer = await chrome.runtime.sendMessage({ account: 'status' }).catch(() => null);
  if (!taken(answer)) return;
  // Pro come just now (Get Pro paid for) counts as just signed in: no personas were asked for without it.
  const was = account?.signedIn === true && account.pro !== false;
  const before = screen();
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
  const { walkWidth } = await Promise.resolve(chrome.storage?.local?.get('walkWidth')).catch(() => null) ?? {};
  if (WIDTHS.includes(walkWidth)) pre.width = ownWidth = walkWidth;
  if (stub !== null) {
    const { STUBS, PRE, HISTORY, FEED } = await import('./stub.js');
    stubbed = true;
    // Listening, drawn still: the bars as the stand-in's levels, and Stop goes back to the box.
    if (PRE[stub]?.levels) { voice = { stop() { voice = null; pre.levels = null; render(); }, drop() {}, retype() {} }; voiceAt = PRE[stub].screen ?? 'home'; }
    view = STUBS[stub] ?? STUBS.idle;
    Object.assign(pre, { history: HISTORY }, PRE[stub] ?? PRE.home);
    account = { signedIn: stub !== 'signed-out' && stub !== 'signing-in', pro: stub !== 'not-pro', email: 'dana@example.com' };
    if (pre.personas?.length) choose(pre.pick);
    walker = picked();
    walkUrl = 'https://impeccable.reviews/app/tidy/outings/o-7f3a';
    // A stand-in with the defaults is on an address none of the person's apps is at (`here`).
    hereUrl = pre.here ?? 'https://tidy.example/';
    act = (action) => { view = reduce(view, { type: action }); render(); };
    // A stand-in that goes on: its next step every 1.5 s while the walk is live.
    const feed = [...(FEED[stub] ?? [])];
    const next = () => { if (feed.length === 0 || !isLive(view)) return; view = reduce(view, { type: 'step', step: feed.shift() }); render(); setTimeout(next, 1500); };
    if (feed.length > 0) setTimeout(next, 1500);
  } else {
    // An agent's run that opened this panel is over (agent.js `leavePanel`): it closes, as it was before. Only the
    // extension's own worker says so.
    chrome.runtime.onMessage?.addListener((message, sender) => {
      if (message?.agentPanel !== 'close' || sender.id !== chrome.runtime.id || sender.tab) return;
      void chrome.windows?.getCurrent?.().then((mine) => { if (mine?.id === message.windowId) globalThis.close?.(); }).catch(() => undefined);
    });
    act = async (action) => {
      pre.refused = null;
      const answer = await chrome.runtime.sendMessage({ control: action }).catch(() => null);
      // Continue or hand-back refused (the sign-in still shows): the pause as it stands, drawn again with why, focus kept.
      if (answer?.ok === true || (action !== 'resume' && action !== 'handback')) return;
      pre.refused = typeof answer?.why === 'string' ? answer.why : null;
      const { view: now } = await chrome.storage.session.get('view').catch(() => ({}));
      if (now?.v === 1) view = now;
      render();
      app.querySelector(`[data-act="${action}"]`)?.focus();
    };
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes.walker || changes.walkUrl) void knowWalk().then(render);
      // Signed in from the popup while the panel is open.
      if (changes.connected?.newValue === true) { connect(); void knowAccount().then(render); }
      if (!changes.view) return;
      view = changes.view.newValue ?? emptyView(false);
      // A refusal is said only for the pause it was refused at: gone once the walk goes on or ends.
      if (view.state !== 'paused' && view.state !== 'takeover') pre.refused = null;
      if (isLive(view)) ended = false;
      render();
    });
    // Another address may be another app's: its personas, or the defaults.
    // Not under a plan or a walk: their persona stays the one they were started with.
    // Asked only while the home shows, once the tab has settled on another site for half a second: the origin alone.
    let settling = null;
    const moved = () => {
      clearTimeout(settling);
      settling = setTimeout(() => { if (siteOf(hereUrl) !== asked && screen() === 'home' && pre.personas !== undefined && account?.signedIn === true && account.pro !== false) void loadPersonas(); }, 500);
    };
    // Without Pro, back from another tab or the tab gone elsewhere (paid there, maybe): asked again.
    chrome.tabs.onActivated.addListener(() => { if (screen() === 'not-pro') relook(); void look().then(() => { moved(); render(); }); });
    // Scan names the tab's site: drawn again only when the site changes, as a redraw moves its box.
    chrome.tabs.onUpdated?.addListener((tabId, change) => { if (tabId === here && change.url) { if (screen() === 'not-pro') relook(); const site = hostOf(hereUrl) !== hostOf(change.url); hereUrl = change.url; moved(); if ((pre.screen === 'home' || (pre.screen === 'scan' && site)) && !isLive(view)) render(); } });
    const [{ view: kept }, { connected: just } = {}] = await Promise.all([chrome.storage.session.get('view'), Promise.resolve(chrome.storage.session.get('connected')).catch(() => ({})), look(), knowWalk()]);
    if (kept?.v === 1) view = kept;
    if (just === true) connect();
    if (!(await chrome.storage.local.get('firstRunSeen').catch(() => ({}))).firstRunSeen) pre.screen = 'before';
    // Asked again whenever the panel is looked at: a sign-in in the popup shows here.
    if (BUILD.account) { void knowAccount(); addEventListener('focus', relook); }
    // Wakes a worker Chrome put to sleep, so a walk it lost is not shown as still going.
    act('hello');
  }
  render();
}

// The panel closing ends the mic: the recognition and the stream the bars read.
addEventListener('pagehide', () => hush());

void start();
