// Stand-in walks for looking at the panel without one: `panel.html?stub=<name>` draws a state from here, and
// `&variant=feed|checklist|now` picks the arrangement of a walk under way. The buttons work, on the stand-in.
// Every state is made by the same steps a real walk takes (view.js), so none can be one a walk cannot reach.
import { emptyView, reduce } from '../view.js';

const HANDOFF = {
  site: 'http://localhost:3000',
  persona: { name: 'Mira', role: 'Office manager, keeps the team’s chores in one list', visit: 'new', device: 'desktop' },
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
  { type: 'opened', name: 'Mira', site: HANDOFF.site },
  ...STEPS.slice(0, 3).map((step) => ({ type: 'step', step })),
  { type: 'checks', met: [true, false, false] },
  { type: 'blocked', what: 'navigation', url: 'https://oat-milk-deals.example/win' },
  ...STEPS.slice(3).map((step) => ({ type: 'step', step })),
  { type: 'checks', met: [true, true, false] },
]);
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
  paused: run(walking, [{ type: 'pause' }]),
  'paused-sign-in': run(walking, [{ type: 'pause', why: 'sign-in' }]),
  takeover: run(walking, [{ type: 'takeover' }]),
  done: run(walking, [finish([])]),
  'done-issues': run(walking, [finish(ISSUES)]),
  stopped: run(walking, [{ type: 'stop' }]),
  'failed-tab-closed': run(walking, [{ type: 'fail', reason: 'tab-closed' }]),
  'failed-connection': run(walking, [{ type: 'fail', reason: 'connection' }]),
  'failed-switched-off': run(walking, [{ type: 'fail', reason: 'switched-off' }]),
  'failed-left-site': run(walking, [{ type: 'fail', reason: 'left-site' }]),
};
