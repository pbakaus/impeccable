// What a walk looks like from outside it: one plain object the worker keeps, the side panel draws and the badge
// sums up. `reduce` is the whole state machine: it answers the same object back for anything that does not apply,
// which is also how the worker knows a control (Pause, Take over, Stop) was not on offer.
//
// Nothing here touches Chrome, so it runs anywhere: the worker, the panel's stub harness, a spec.

// The states: signed-out, idle, waiting, walking, paused, takeover, done, stopped, failed.
/** A walk is under way: something is waiting to be walked, or being walked. */
export const LIVE = ['waiting', 'walking', 'paused', 'takeover'];
/** The debugger is on the tab. */
export const ON_TAB = ['walking', 'paused', 'takeover'];
/** Why a walk failed, as the panel shows it. */
export const FAILURES = ['tab-closed', 'connection', 'left-site', 'switched-off'];

const STEPS_KEPT = 200;
const NOTES_KEPT = 20;

export const isLive = (view) => LIVE.includes(view.state);

/** Before any walk: whether this browser has ever been handed one decides which empty state it is. */
export function emptyView(linked = false) {
  return { v: 1, state: linked ? 'idle' : 'signed-out', linked, who: null, workflow: null, site: null, tab: null, steps: [], notes: [], outcome: null, failure: null, held: null, ask: null };
}

const fresh = (view) => ({ ...emptyView(view.linked), state: view.state });
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function workflowOf(errand) {
  if (!errand) return null;
  return { name: text(errand.name, 120), goal: text(errand.goal, 2000), doneWhen: (errand.doneWhen ?? []).slice(0, 6).map((line) => ({ text: text(line, 300), met: false })) };
}

function whoOf(persona, before) {
  return { name: text(persona?.name, 120) || before?.name || '', role: text(persona?.role, 200) || before?.role || '', visit: persona?.visit ?? before?.visit ?? null, device: persona?.device ?? before?.device ?? 'desktop' };
}

/** Kinds of question a walk asks the person: a deed the server marked (delete, pay, send), or another site (go). */
const ASKS = ['delete', 'pay', 'send', 'go'];
/** The faces a step may wear: the cells of a persona's face sheet. */
export const MOODS = ['neutral', 'curious', 'confident', 'confused', 'frustrated', 'delighted'];

/** A question stands only while the walk is walking: a pause, a take-over or an end takes it away unanswered. */
export function reduce(view, action) {
  const next = step(view, action);
  return next.ask && next.state !== 'walking' ? { ...next, ask: null } : next;
}

function step(view, action) {
  const live = isLive(view);
  const onTab = ON_TAB.includes(view.state);
  switch (action.type) {
    // A walk was handed over: it waits for the server to open its tab.
    case 'handoff':
      if (live) return view;
      return { ...fresh(view), linked: true, state: 'waiting', who: whoOf(action.handoff.persona), workflow: workflowOf(action.handoff.errand), site: action.handoff.site ?? null };
    // The tab is open and the debugger is on it. Once the walk is over, the panel shows its end on that tab alone.
    case 'opened':
      if (onTab) return view;
      return { ...(view.state === 'waiting' ? view : fresh(view)), state: 'walking', who: view.state === 'waiting' && view.who?.name ? view.who : whoOf({ name: action.name }), site: action.site ?? view.site, tab: action.tab ?? null };
    // The server says more about who is walking and what for.
    case 'brief':
      if (!live) return view;
      return { ...view, who: whoOf(action.persona, view.who), workflow: action.errand ? workflowOf(action.errand) : view.workflow };
    case 'step': {
      if (!onTab || typeof action.step?.n !== 'number') return view;
      // `refused`: not done, as the server marks it. `no`, the person said No to it or to one before it; `held`, it needed a Yes it could not ask for.
      const refused = ['no', 'held'].includes(action.step.refused) ? { refused: action.step.refused } : {};
      const mood = MOODS.includes(action.step.mood) ? { mood: action.step.mood } : {};
      const step = { n: action.step.n, did: text(action.step.did, 400), said: text(action.step.said, 600), ...(action.step.issue ? { issue: text(action.step.issue, 400) } : {}), ...refused, ...mood };
      return { ...view, steps: [...view.steps.filter((kept) => kept.n !== step.n), step].slice(-STEPS_KEPT) };
    }
    case 'checks':
      if (!onTab || !view.workflow || !Array.isArray(action.met)) return view;
      return { ...view, workflow: { ...view.workflow, doneWhen: view.workflow.doneWhen.map((check, i) => ({ ...check, met: action.met[i] === true })) } };
    // Something the guard stopped: told in the feed where it happened.
    case 'blocked':
      if (!onTab) return view;
      return { ...view, notes: [...view.notes, { after: view.steps.at(-1)?.n ?? 0, what: action.what, url: text(action.url, 300) }].slice(-NOTES_KEPT) };
    // A pause with a reason of the walk's own (`why`, a sign-in) also holds a person's pause or take-over to it.
    case 'pause': {
      const held = action.why ?? null;
      if (view.state === 'walking') return { ...view, state: 'paused', held };
      if (!held || !['paused', 'takeover'].includes(view.state) || (view.state === 'paused' && view.held === held)) return view;
      return { ...view, state: 'paused', held };
    }
    // The walk asks the person before it goes on: one question at a time.
    case 'ask':
      if (view.state !== 'walking' || view.ask || !ASKS.includes(action.ask?.kind)) return view;
      return { ...view, ask: { kind: action.ask.kind, what: text(action.ask.what, 200) } };
    case 'answer': return view.ask ? { ...view, ask: null } : view;
    case 'resume': return view.state === 'paused' ? { ...view, state: 'walking', held: null } : view;
    case 'takeover': return view.state === 'walking' || view.state === 'paused' ? { ...view, state: 'takeover' } : view;
    case 'handback': return view.state === 'takeover' ? { ...view, state: 'walking', held: null } : view;
    case 'stop': return live ? { ...view, state: 'stopped' } : view;
    // The server's word on how it went. It may come before or after the tab is let go.
    case 'finish': {
      if (!live && view.state !== 'done') return view;
      const outcome = action.outcome ?? {};
      const doneWhen = Array.isArray(outcome.doneWhen) ? outcome.doneWhen.slice(0, 6).map((check) => ({ text: text(check.text, 300), met: check.met === true })) : null;
      return {
        ...view,
        state: 'done',
        workflow: view.workflow && doneWhen ? { ...view.workflow, doneWhen } : view.workflow,
        outcome: {
          finished: outcome.finished === true,
          steps: typeof outcome.steps === 'number' ? outcome.steps : view.steps.length,
          issues: (Array.isArray(outcome.issues) ? outcome.issues : []).slice(0, 50).map((issue) => ({ step: Number(issue.step) || 0, page: text(issue.page, 200), what: text(issue.what, 400), said: text(issue.said, 400) })),
          replayUrl: typeof action.replayUrl === 'string' ? action.replayUrl : null,
        },
      };
    }
    // The tab was let go with no word on how it went.
    case 'closed': return onTab ? { ...view, state: 'done' } : view;
    case 'fail': return live && FAILURES.includes(action.reason) ? { ...view, state: 'failed', failure: { reason: action.reason, detail: text(action.detail, 200) } } : view;
    default: return view;
  }
}

/** What the debugger's leaving means for the walk: Chrome's Cancel is the person stopping it; a tab that is gone, a failure. */
export function detachAction(reason) {
  if (reason === 'closed') return { type: 'closed' };
  if (reason === 'left-site') return { type: 'fail', reason: 'left-site' };
  if (reason === 'canceled_by_user') return { type: 'stop' };
  return { type: 'fail', reason: 'tab-closed' };
}
