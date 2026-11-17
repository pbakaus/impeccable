// Stand-in walks for looking at the panel without one: `panel.html?stub=<name>` draws a state from here (STUBS for a
// walk, PRE for before one). The buttons work, on the stand-in.
// Every state is made by the same steps a real walk takes (view.js), so none can be one a walk cannot reach.
import { emptyView, reduce } from '../view.js';
import { COPY } from './copy.js';

const HANDOFF = {
  site: 'http://localhost:3000',
  persona: { name: 'Robert', role: 'A 72-year-old retiree with low vision, using large text and zoom', visit: 'new', device: 'desktop' },
  errand: {
    name: 'Create, edit and delete a to-do',
    goal: 'Add a to-do, rename it, then delete it.',
    doneWhen: ['A new to-do shows in the list', 'Its new name shows after saving', 'The list is empty again'],
  },
};

const STEPS = [
  { n: 1, did: 'Opened the to-do list', said: 'An empty list and one clear button. Good start.' },
  { n: 2, did: 'Clicked “New to-do”', said: 'Straight to a form. I like that it asks for one thing.' },
  { n: 3, did: 'Typed “Buy oat milk” and pressed Enter', said: 'It went back to the list on its own and told me it was added.' },
  { n: 4, did: 'Clicked “Edit” on Buy oat milk', said: 'Same form as before, with my words already in it.' },
  { n: 5, did: 'Changed the title to “Buy oat milk and bread”', said: 'Nothing says whether this saves as I type or not.', issue: 'No hint that the title is not saved until Save is pressed.' },
  { n: 6, did: 'Clicked “Save”', said: 'There it is, renamed.' },
];

const run = (view, actions) => actions.reduce(reduce, view);
const waiting = run(emptyView(true), [{ type: 'handoff', handoff: HANDOFF }]);
const walking = run(waiting, [
  { type: 'opened', name: 'Robert', site: HANDOFF.site },
  ...STEPS.slice(0, 3).map((step) => ({ type: 'step', step })),
  { type: 'checks', met: [true, false, false] },
  { type: 'blocked', what: 'navigation', url: 'https://oat-milk-deals.example/win' },
  ...STEPS.slice(3).map((step) => ({ type: 'step', step })),
  { type: 'checks', met: [true, true, false] },
]);
/** A longer walk, past step 9, so the step numbers can be seen lining up. */
const MORE = [
  { n: 7, did: 'Clicked “Delete” on Buy oat milk and bread', said: 'It asked me first. Good.' },
  { n: 8, did: 'Clicked “Yes, delete”', said: 'Gone, and the list says it is empty.' },
  { n: 9, did: 'Clicked “New to-do”', said: 'Same form again.' },
  { n: 10, did: 'Typed “Call the vet” and pressed Enter', said: 'Added at the top this time.' },
  { n: 11, did: 'Scrolled to the bottom of the list', said: 'Nothing else down here.' },
  { n: 12, did: 'Opened “Settings”', said: 'Small grey text. Hard to read.' },
];
const walkingLong = run(walking, MORE.map((step) => ({ type: 'step', step })));
/** A walk under way that gains a step every 1.5 s (panel.js), to watch the list grow: two steps, then the rest. */
const walkingLive = run(waiting, [{ type: 'opened', name: 'Robert', site: HANDOFF.site }, ...STEPS.slice(0, 2).map((step) => ({ type: 'step', step }))]);
export const FEED = { 'walking-live': [...STEPS.slice(2), ...MORE] };
const outcome = (issues) => ({
  finished: true, steps: 8, ms: 41_000,
  doneWhen: HANDOFF.errand.doneWhen.map((text) => ({ text, met: true })),
  issues,
  replayUrl: 'https://impeccable.reviews/app/tidy/outings/o-7f3a',
});
const finish = (issues) => ({ type: 'finish', outcome: outcome(issues), replayUrl: outcome(issues).replayUrl });
const ISSUES = [
  { step: 5, page: '/edit.html', what: 'No hint that the title is not saved until Save is pressed.', said: 'Nothing says whether this saves as I type or not.' },
  { step: 8, page: '/', what: 'Delete removes the to-do at once, with no way back.', said: 'Oh. It is just gone.' },
];

export const STUBS = {
  'signed-out': emptyView(false),
  idle: emptyView(true),
  waiting,
  walking,
  'walking-long': walkingLong,
  'walking-live': walkingLive,
  paused: run(walking, [{ type: 'pause' }]),
  'paused-sign-in': run(walking, [{ type: 'pause', why: 'sign-in' }]),
  'paused-sign-in-held': run(walking, [{ type: 'pause', why: 'sign-in' }, { type: 'withheld' }]),
  takeover: run(walking, [{ type: 'takeover' }]),
  asking: run(walking, [{ type: 'ask', ask: { kind: 'delete', what: 'Delete the to-do “Buy oat milk and bread”' } }]),
  'asking-upload': run(walking, [{ type: 'ask', ask: { kind: 'send', what: 'Add a photo to the to-do’s picture field' } }]),
  'asking-go': run(walking, [{ type: 'ask', ask: { kind: 'go', what: 'oat-milk-deals.example' } }]),
  done: run(walking, [finish([])]),
  'done-issues': run(walking, [finish(ISSUES)]),
  stopped: run(walking, [{ type: 'stop' }]),
  'failed-tab-closed': run(walking, [{ type: 'fail', reason: 'tab-closed' }]),
  'failed-connection': run(walking, [{ type: 'fail', reason: 'connection' }]),
  'failed-switched-off': run(walking, [{ type: 'fail', reason: 'switched-off' }]),
  'failed-left-site': run(walking, [{ type: 'fail', reason: 'left-site' }]),
  'failed-unanswered': run(walking, [{ type: 'fail', reason: 'unanswered' }]),
};

/** The six every app has, as the personas read lists them: no faces yet, so their initials. */
const PERSONAS = [
  ['Maya', 'A 19-year-old student on her phone, always in a hurry'],
  ['Daniel', 'A 34-year-old busy professional, good with tech'],
  ['Priya', 'A 45-year-old small-business owner, careful with money'],
  ['Robert', 'A 72-year-old retiree with low vision, using large text and zoom', 'older-eyes'],
  ['Sam', 'A 28-year-old daily user who is red-green colour-blind', 'colour-blind'],
  ['Grace', 'A 58-year-old office manager with a hand tremor'],
].map(([name, role, sees]) => ({ name, role, slug: `default:${name.toLowerCase()}`, default: true, ...(sees ? { sees } : {}) }));
/** An app of the person's at the tab's address: its own cast, and one the person made. */
const APP_CAST = [
  ['Mira', 'Studio manager, opens this first every morning'],
  ['Alex', 'Freelance designer, juggles three clients'],
  ['Nadia', 'Ops lead, lives in the weekly report'],
  ['Owen', 'New hire, on his first day'],
  ['Robin', 'Part-timer, on a shared laptop'],
].map(([name, role]) => ({ name, role, slug: name.toLowerCase() }));
const APPS = [{ workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' }, { workspace: 'acme', repo: 'tidy', app: 'admin', name: 'Tidy admin' }, { workspace: 'acme', repo: 'ledgerly', app: 'web', name: 'Ledgerly' }];
const MADE = { name: 'Rosa', role: 'A night-shift nurse who books her shifts on her phone', slug: 'rosa', mine: true };
/** Three of the person's own, then the six. */
const FULL = [MADE, { ...MADE, name: 'Theo', slug: 'theo', role: 'A shift lead, checks the rota between calls' }, { ...MADE, name: 'June', slug: 'june', role: 'A ward clerk, books cover for the night' }, ...PERSONAS];
const DESCRIBED = 'Rosa, a night-shift nurse who books her shifts on her phone: tired, in a hurry, one hand free.';
const PLAN = { id: 'p-1', risky: true, steps: [{ text: 'Open tidy.example', risky: false }, { text: 'Add a to-do', risky: false }, { text: 'Rename it', risky: false }, { text: 'Delete it', risky: true }] };
const TASK = HANDOFF.errand.goal;
/** Journeys started from the extension, newest first, aged from when the stand-in loads. `outcome`: issues, done, stopped or failed. */
const HOUR = 3_600_000;
const JOURNEYS = [
  ['Maya', 'Sign up with a new email and confirm it from the inbox.', 'https://shop.example', 0.2, 'issues', 3],
  ['Robert', 'Add a to-do, rename it, then delete it.', 'https://tidy.example', 2, 'issues', 2],
  ['Daniel', 'Find the pricing page and start a free trial on the yearly plan.', 'https://ledgerly.example', 5, 'done'],
  ['Sam', 'Check out with two items in the basket and a discount code. Make sure the total changes when the code goes in, and that the red sale prices still read clearly.', 'https://shop.example', 26, 'issues', 1],
  ['Priya', 'Send an invoice to a new client and mark it paid.', 'https://ledgerly.example', 31, 'stopped'],
  ['Grace', 'Book a table for four on Friday evening.', 'https://bistro.example', 74, 'failed'],
  ['Maya', 'Change the password from Settings.', 'https://tidy.example', 98, 'done'],
  ['Robert', 'Read the latest post and leave a comment under it.', 'https://blog.example', 220, 'issues', 4],
];
const journey = ([who, task, site, hours, outcome, issues = 0], i) => ({
  persona: PERSONAS.find((person) => person.name === who), task, site, at: Date.now() - hours * HOUR, outcome, issues,
  url: `https://impeccable.reviews/app/${new URL(site).host.split('.')[0]}/outings/o-${(0x7f3a + i * 97).toString(16)}`,
});
export const HISTORY = JOURNEYS.map(journey);
/** A long history: 25 journeys over about a month. */
const LONG = Array.from({ length: 25 }, (_, i) => journey([...JOURNEYS[i % JOURNEYS.length].slice(0, 3), 0.2 + i * 29, ...JOURNEYS[i % JOURNEYS.length].slice(4)], i));
/** Before a walk: the panel's own state, by stub name. */
export const PRE = {
  home: { personas: PERSONAS, task: TASK, pick: 3, here: 'https://shop.example/' },
  // The account and its personas still coming: the top bar and the dots.
  loading: { here: 'https://shop.example/' },
  // Rosa's card says phone: picking her sets Screen to Phone.
  'home-card-phone': { personas: [{ ...MADE, device: 'mobile' }, ...PERSONAS], task: TASK, pick: 4, here: 'https://shop.example/' },
  // The cog pressed: who is signed in, and Sign out.
  account: { personas: PERSONAS, task: TASK, pick: 3, here: 'https://shop.example/', menu: true },
  'home-sam': { personas: PERSONAS, task: TASK, pick: 4, here: 'https://shop.example/' },
  'home-app': { personas: [...APP_CAST, MADE], task: TASK },
  'signing-in': { signingIn: true },
  // Just signed in: the moment before the panel goes on.
  connected: { personas: PERSONAS, task: TASK, pick: 3, here: 'https://shop.example/', connected: true },
  // Talk to type: the bars as a voice moves them, newest on the right, the words heard so far; and a mic hearing nothing.
  listening: { personas: PERSONAS, pick: 3, here: 'https://shop.example/', task: 'Add a to-do, then rename it to', levels: [0.08, 0.22, 0.4, 0.62, 0.5, 0.78, 0.92, 0.66, 0.44, 0.7, 0.55, 0.3, 0.16, 0.06] },
  'listening-quiet': { personas: PERSONAS, pick: 3, here: 'https://shop.example/', task: '', levels: [0.01, 0.02, 0, 0.01, 0.02, 0.01, 0, 0.01, 0.02, 0, 0.01, 0.02, 0.01, 0] },
  // Make a persona: empty, typed, being made, made, refused; then home with the new one first. And an app's personas, in a modal.
  make: { personas: PERSONAS, screen: 'make', apps: APPS },
  'make-typed': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED },
  'make-making': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED, making: true },
  'make-made': { personas: PERSONAS, screen: 'make', apps: APPS, made: MADE },
  // The first time Create a persona opens: its intro. Then the box with the Disability list open, Low vision picked; and one made on a phone with it.
  intro: { personas: PERSONAS, screen: 'intro' },
  'make-needs': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED, device: 'phone', disability: 'low-vision', needs: true },
  'make-made-chosen': { personas: PERSONAS, screen: 'make', apps: APPS, made: { ...MADE, device: 'mobile', sees: 'older-eyes' }, device: 'phone', disability: 'low-vision' },
  'make-refused': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED, note: COPY.make.limit(3) },
  // No app with personas of its own (none, or none with any), and the apps still coming: no "Use a persona from your app".
  'make-no-apps': { personas: PERSONAS, screen: 'make', apps: [] },
  'make-apps-loading': { personas: PERSONAS, screen: 'make', apps: undefined },
  // Talking to make one: the words heard so far in the make box, the bars beside Create.
  'make-listening': { personas: PERSONAS, screen: 'make', apps: APPS, describe: 'Rosa, a night-shift nurse who books her shifts', levels: [0.08, 0.22, 0.4, 0.62, 0.5, 0.78, 0.92, 0.66, 0.44, 0.7, 0.55, 0.3, 0.16, 0.06] },
  // Three of their own already: the + is greyed and says why.
  'home-full': { personas: FULL, task: TASK, here: 'https://shop.example/' },
  // A task longer than the box: it grows to six lines, then scrolls inside.
  'home-long': { personas: PERSONAS, pick: 3, here: 'https://shop.example/', task: 'Sign up with a new email, confirm it from the inbox, then fill in the profile: a name, a photo and a short bio. Then go to Settings and turn on two-step sign-in with an authenticator app. Then sign out, sign back in with the code, and check that the bio still shows on the profile page. If anything asks for a phone number, skip it and say where it asked.' },
  // An app with more personas than two rows of five: one two-row block that scrolls sideways, the + still last.
  'home-wide': { personas: [...APP_CAST, ...['Ines', 'Kofi', 'Hana', 'Noor', 'Tomasz', 'Lena', 'Yusuf'].map((name) => ({ name, role: 'A visitor', slug: name.toLowerCase() }))], task: TASK },
  'home-made': { personas: [MADE, ...PERSONAS], task: TASK, here: 'https://shop.example/' },
  'make-modal': { personas: PERSONAS, screen: 'make', apps: APPS, modal: true },
  'make-modal-app': { personas: PERSONAS, screen: 'make', apps: APPS, modal: true, app: 'acme/tidy/web', appPersonas: APP_CAST },
  'home-app-used': { personas: APP_CAST, task: TASK, here: 'https://shop.example/' },
  planning: { personas: PERSONAS, task: TASK, screen: 'planning', pick: 3, here: 'https://shop.example/' },
  plan: { personas: PERSONAS, task: TASK, screen: 'plan', plan: PLAN, pick: 3, here: 'https://shop.example/' },
  before: { personas: PERSONAS, screen: 'before' },
  'tab-group': { personas: PERSONAS, screen: 'tab-group', pick: 3, here: 'https://shop.example/' },
  // History (the button beside the cog): eight journeys, none yet, still coming, not read, and a long list that scrolls inside.
  history: { personas: PERSONAS, pick: 3, screen: 'history', here: 'https://shop.example/' },
  'history-empty': { personas: PERSONAS, pick: 3, screen: 'history', here: 'https://shop.example/', history: [] },
  'history-loading': { personas: PERSONAS, pick: 3, screen: 'history', here: 'https://shop.example/', history: undefined },
  'history-failed': { personas: PERSONAS, pick: 3, screen: 'history', here: 'https://shop.example/', history: null },
  'history-long': { personas: PERSONAS, pick: 3, screen: 'history', here: 'https://shop.example/', history: LONG },
  // Your personas (from the cog): their own with Remove, the six marked Default; and one row asking "Are you sure?".
  personas: { personas: FULL, yours: FULL, screen: 'personas', here: 'https://shop.example/' },
  'personas-sure': { personas: FULL, yours: FULL, screen: 'personas', sure: 'theo', here: 'https://shop.example/' },
};
STUBS.before = STUBS.idle;
STUBS['tab-group'] = STUBS.idle;
STUBS.home = STUBS.idle;
STUBS.planning = STUBS.idle;
STUBS.plan = STUBS.idle;
for (const name of ['loading', 'home-card-phone', 'account', 'connected', 'home-sam', 'home-app', 'listening', 'listening-quiet', 'make', 'make-typed', 'make-making', 'make-made', 'intro', 'make-needs', 'make-made-chosen', 'make-refused', 'make-no-apps', 'make-apps-loading', 'make-listening', 'home-made', 'home-full', 'home-long', 'home-wide', 'make-modal', 'make-modal-app', 'home-app-used', 'history', 'history-empty', 'history-loading', 'history-failed', 'history-long', 'personas', 'personas-sure']) STUBS[name] = STUBS.idle;
STUBS['signing-in'] = STUBS['signed-out'];
