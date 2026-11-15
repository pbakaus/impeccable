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
  paused: run(walking, [{ type: 'pause' }]),
  'paused-sign-in': run(walking, [{ type: 'pause', why: 'sign-in' }]),
  takeover: run(walking, [{ type: 'takeover' }]),
  asking: run(walking, [{ type: 'ask', ask: { kind: 'delete', what: 'Delete the to-do “Buy oat milk and bread”' } }]),
  'asking-upload': run(walking, [{ type: 'ask', ask: { kind: 'send', what: 'Add a sample photo to the to-do’s picture field' } }]),
  'asking-go': run(walking, [{ type: 'ask', ask: { kind: 'go', what: 'oat-milk-deals.example' } }]),
  done: run(walking, [finish([])]),
  'done-issues': run(walking, [finish(ISSUES)]),
  stopped: run(walking, [{ type: 'stop' }]),
  'failed-tab-closed': run(walking, [{ type: 'fail', reason: 'tab-closed' }]),
  'failed-connection': run(walking, [{ type: 'fail', reason: 'connection' }]),
  'failed-switched-off': run(walking, [{ type: 'fail', reason: 'switched-off' }]),
  'failed-left-site': run(walking, [{ type: 'fail', reason: 'left-site' }]),
};

/** The six every app has (REN-2039), as the personas read lists them: no faces yet, so their initials. */
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
const DESCRIBED = 'Rosa, a night-shift nurse who books her shifts on her phone: tired, in a hurry, one hand free.';
const PLAN = { id: 'p-1', risky: true, steps: [{ text: 'Open tidy.example', risky: false }, { text: 'Add a to-do', risky: false }, { text: 'Rename it', risky: false }, { text: 'Delete it', risky: true }] };
const TASK = HANDOFF.errand.goal;
/** Before a walk: the panel's own state, by stub name. */
export const PRE = {
  home: { personas: PERSONAS, task: TASK, pick: 3, here: 'https://shop.example/' },
  'home-sam': { personas: PERSONAS, task: TASK, pick: 4, here: 'https://shop.example/' },
  'home-app': { personas: [...APP_CAST, MADE], task: TASK },
  'signing-in': { signingIn: true },
  // Talk to type: the bars as a voice moves them, newest on the right, the words heard so far; and a mic hearing nothing.
  listening: { personas: PERSONAS, pick: 3, here: 'https://shop.example/', task: 'Add a to-do, then rename it to', levels: [0.08, 0.22, 0.4, 0.62, 0.5, 0.78, 0.92, 0.66, 0.44, 0.7, 0.55, 0.3, 0.16, 0.06] },
  'listening-quiet': { personas: PERSONAS, pick: 3, here: 'https://shop.example/', task: '', levels: [0.01, 0.02, 0, 0.01, 0.02, 0.01, 0, 0.01, 0.02, 0, 0.01, 0.02, 0.01, 0] },
  // Make a persona: empty, typed, being made, made, refused; then home with the new one first. And an app's personas, in a modal.
  make: { personas: PERSONAS, screen: 'make', apps: APPS },
  'make-typed': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED },
  'make-making': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED, making: true },
  'make-made': { personas: PERSONAS, screen: 'make', apps: APPS, made: MADE },
  'make-refused': { personas: PERSONAS, screen: 'make', apps: APPS, describe: DESCRIBED, note: COPY.make.limit(3) },
  // Three of their own already: the + is greyed and says why.
  'home-full': { personas: [MADE, { ...MADE, name: 'Theo', slug: 'theo', role: 'A shift lead, checks the rota between calls' }, { ...MADE, name: 'June', slug: 'june', role: 'A ward clerk, books cover for the night' }, ...PERSONAS], task: TASK, here: 'https://shop.example/' },
  'home-made': { personas: [MADE, ...PERSONAS], task: TASK, here: 'https://shop.example/' },
  'make-modal': { personas: PERSONAS, screen: 'make', apps: APPS, modal: true },
  'make-modal-app': { personas: PERSONAS, screen: 'make', apps: APPS, modal: true, app: 'acme/tidy/web', appPersonas: APP_CAST },
  'home-app-used': { personas: APP_CAST, task: TASK, here: 'https://shop.example/' },
  planning: { personas: PERSONAS, task: TASK, screen: 'planning', pick: 3, here: 'https://shop.example/' },
  plan: { personas: PERSONAS, task: TASK, screen: 'plan', plan: PLAN, pick: 3, here: 'https://shop.example/' },
  before: { personas: PERSONAS, screen: 'before' },
  'tab-group': { personas: PERSONAS, screen: 'tab-group', pick: 3, here: 'https://shop.example/' },
};
STUBS.before = STUBS.idle;
STUBS['tab-group'] = STUBS.idle;
STUBS.home = STUBS.idle;
STUBS.planning = STUBS.idle;
STUBS.plan = STUBS.idle;
for (const name of ['home-sam', 'home-app', 'listening', 'listening-quiet', 'make', 'make-typed', 'make-making', 'make-made', 'make-refused', 'home-made', 'home-full', 'make-modal', 'make-modal-app', 'home-app-used']) STUBS[name] = STUBS.idle;
STUBS['signing-in'] = STUBS['signed-out'];
