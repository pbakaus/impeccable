// Who is driving the walked tab: the walk, nobody (paused), or the person (taken over). The person says so from the
// side panel; Stop, and Continue on a pause, also from the badge. Every op the socket asks passes through here first, so the server's engine
// needs to know nothing of it: a paused op simply takes longer, and one refused says why by name
// (the walk protocol, panel control).
import { unseen, whenPressed } from './badge.js';
import { resultLink } from './handoff.js';
import { endWalk, fail, fence, fenced, hold, hooks, lookOnly, onAsk, onSignIn, ops, personHas, say, signInNow, stopOpening, unhold, walk } from './driver.js';
import { current, dispatch, onView } from './store.js';
import { detachAction, isLive } from './view.js';

/** Ops the hub may always ask: opening and letting go, a look at the tab, and what it tells the panel. */
const FREE = new Set(['open', 'close', 'tab', 'brief', 'step', 'checks', 'finish']);

/** What the hub tells the panel needs no tab: who is coming may be said before one opens, and how it went after it is let go. */
const TABLESS = new Set(['brief', 'step', 'checks', 'finish']);
export const needsNoTab = (op) => TABLESS.has(op);

/** Ops waiting for a pause to end. */
let held = [];
const release = () => { for (const go of held.splice(0)) go(); };

/** Set by Stop: the server may not open another tab on this hand-off. A new hand-off clears it. */
let stopped = false;
/** Set once a walk starts on a plan the person approved in the side panel: it asks nothing mid-way. A new hand-off clears it. */
let plannedWalk = false;
export function rearm() {
  stopped = false;
  plannedWalk = false;
  // The last walk's results page and walker are not this one's.
  void chrome.storage.session.remove(['walkUrl', 'walker']).catch(() => undefined);
}
export function planned(on) { plannedWalk = on; }

/**
 * Pauses the walk for a reason of its own (a sign-in). From walking, or from a person's pause or take-over: in every
 * case the walk is paused, and the other end told once. Synchronous to the pause: nothing is taken after it.
 */
function pauseFor(why) {
  const was = current().state;
  if (!dispatch({ type: 'pause', why })) return false;
  if (was !== 'paused') say({ event: 'paused' });
  return true;
}
onSignIn(() => { pauseFor('sign-in'); });

/** The ops that take something of the page: none runs on a page the walk could not check. */
const LOOKING = new Set(['screenshot', 'evaluate']);

/** Returns once the walk may act, and not at a sign-in: whether it had to wait for a pause. Throws while the person has the tab. */
async function clear(name) {
  let waited = false;
  for (;;) {
    const { state } = current();
    if (stopped) throw fail('Stopped', 'the person stopped this journey');
    if (state === 'takeover') throw fail('TakenOver', 'the person is using the tab');
    if (state === 'paused' || current().ask) { waited = true; await new Promise((go) => { held.push(go); }); continue; }
    const signIn = await signInNow();
    if (signIn === null && LOOKING.has(name)) throw fail('NotAllowed', 'the page could not be read');
    if (!signIn || !pauseFor('sign-in')) return waited;
  }
}

/**
 * THE PAUSE'S ONE BARRIER. An op that a pause comes before or during (it arrived while paused, or was still under way
 * when the pause landed) never answers with what it found, nor with an error that might carry the page. A click or a
 * key is not done after Continue: it was decided on a page the person has since used, so it is refused as `Paused`,
 * and the walk goes on from a fresh look. Anything else (a look, a script, a navigation the guard holds to the site)
 * is asked again once the walk goes on, and answers with what it finds then: the walk protocol has every op that
 * arrives while paused answered after `resumed`, the engine reads the page with scripts, and it opens its first page
 * with a navigation, which a sign-in on that page pauses. Letting go of the film passes through a pause, as `open`,
 * `close` and the panel's ops do.
 */
const ACTS = new Set(['mouse', 'keyboard']);
const overtaken = () => fail('Paused', 'the journey was paused before this was done; look again');

/* ------------------------------ asking the person first ------------------------------ */

/** How long a question waits for the person: no answer is a No. */
const ASK_MS = 120_000;
/** The question standing, if one is: its answer. */
let answering = null;

/**
 * Asks the person, in the side panel and on the badge, and waits: `yes`, `no`, or `void` when the walk stopped
 * walking first (paused, taken over, ended). Nothing else the walk asks is done meanwhile (`clear`).
 */
function consent(ask) {
  if (!dispatch({ type: 'ask', ask })) return Promise.resolve('void');
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle('no'), ASK_MS);
    answering = (said) => { clearTimeout(timer); resolve(said); };
  });
}
/** The question is over: answered, or gone with the walking. */
function settle(said) {
  const done = answering;
  if (!done) return;
  answering = null;
  dispatch({ type: 'answer' });
  done(said);
  release();
}
onAsk(consent);

/** A click or key the server marked (`ask`: delete, pay or send) is done only once the person says yes to it. */
const askOf = (name, req) => (ACTS.has(name) && req?.ask && typeof req.ask === 'object' && req.action !== 'up' && req.action !== 'move' ? { kind: req.ask.kind, what: req.ask.what } : null);

for (const [name, run] of Object.entries(ops)) {
  if (FREE.has(name)) continue;
  const acting = unseen(name, run);
  ops[name] = async (req) => {
    if (name === 'cdp' && req?.method === 'Page.stopScreencast') return acting(req);
    const ask = askOf(name, req);
    let agreed = ask === null;
    for (;;) {
      const at = fenced();
      if (!(await clear(name)) && at === fenced()) {
        if (!agreed) {
          // Another site the person let the walk go to is only looked at: no deed is asked for there.
          if (lookOnly()) throw fail('NotAllowed', 'on another site a journey only looks');
          const said = await consent(ask);
          if (said === 'no') throw fail('Declined', 'the person said no');
          if (said !== 'yes' || at !== fenced()) throw overtaken();
          // Looked at afresh before it is done: a sign-in that showed meanwhile still pauses it.
          agreed = true;
          continue;
        }
        let out;
        try { out = await acting(req); } catch (err) { if (at === fenced()) throw err; }
        if (at === fenced()) return out;
      }
      if (ACTS.has(name)) throw overtaken();
    }
  };
}
const open = ops.open;
ops.open = (req) => {
  if (stopped) throw fail('Stopped', 'the person stopped this journey');
  return open(req);
};

/* ------------------------------ what the hub tells the panel ------------------------------ */

ops.brief = async ({ persona, errand }) => { dispatch({ type: 'brief', persona, errand }); return {}; };
ops.step = async ({ step }) => { dispatch({ type: 'step', step }); return {}; };
ops.checks = async ({ met }) => { dispatch({ type: 'checks', met }); return {}; };
/** The person's own tab, while a walk of it has not yet shown its result: the result opens beside it, once. */
let resultBeside = null;
ops.finish = async ({ outcome }) => {
  // On the walk's own server only: its public host or its app host (handoff.js).
  const replayUrl = resultLink(outcome?.replayUrl, (await chrome.storage.session.get('handoff')).handoff?.socket);
  dispatch({ type: 'finish', outcome, replayUrl });
  const beside = resultBeside;
  if (replayUrl && beside !== null) {
    resultBeside = null;
    const tab = await chrome.tabs.get(beside).catch(() => null);
    await chrome.tabs.create({ url: replayUrl, active: true, ...(tab ? { windowId: tab.windowId, index: tab.index + 1, openerTabId: beside } : {}) }).catch(() => undefined);
  }
  return {};
};

/* ------------------------------ what the person says ------------------------------ */

const TOLD = { pause: 'paused', resume: 'resumed', takeover: 'takeover', handback: 'handback' };
/** What gives the walk the tab back, and from where. */
const GOING_ON = { resume: 'paused', handback: 'takeover' };

/** Does what the person asked, if it is on offer right now. Resolves to whether it was. */
export async function command(name) {
  if (name === 'yes' || name === 'no') {
    if (!answering) return false;
    settle(name);
    return true;
  }
  if (name === 'stop') {
    if (!isLive(current())) return false;
    stopped = true;
    stopOpening();
    dispatch({ type: 'stop' });
    release();
    // The debugger leaves the tab at once, and the server is told who ended it.
    if (walk) await endWalk({ event: 'stopped', by: 'person' }, 'stopped', { tidy: true });
    else say({ event: 'stopped', by: 'person' });
    return true;
  }
  // Going on is checked again: while a sign-in still shows, the walk stays paused.
  if (GOING_ON[name] === current().state && walk && (await signInNow())) { pauseFor('sign-in'); return false; }
  if (!Object.hasOwn(TOLD, name) || !dispatch({ type: name })) return false;
  say({ event: TOLD[name] });
  release();
  return true;
}

whenPressed((what) => { void command(what); });

// Paused is paused whoever paused it: the walk takes and tells nothing of the page until it goes on (driver.js `hold`).
// A sign-in pause the person then takes over stays that way: they are signing in.
const hushes = (view) => view.state === 'paused' || (view.state === 'takeover' && view.held === 'sign-in');
let walking = false;
onView((view) => {
  // Before anything else hears of it: every op under way is overtaken from this moment.
  if (walking && view.state !== 'walking') fence();
  walking = view.state === 'walking';
  // Taken over, or a question standing: the film takes nothing of it (the badge shows the question, badge.js `hidden`).
  personHas(view.state === 'takeover' || Boolean(view.ask));
  // A question the walk no longer stands behind is over, unanswered.
  if (answering && !view.ask) settle('void');
  // Only the person's own take-over at a sign-in opens the sign-in pages to the tab: a page can fake a sign-in
  // and so a pause, never a take-over.
  void (hushes(view) ? hold(view.state === 'takeover' && view.held === 'sign-in') : unhold());
});

hooks.opened.push((tab) => {
  // A planned walk's results open from the panel's own button instead.
  resultBeside = tab.adopted && !plannedWalk ? tab.tabId : null;
  dispatch({ type: 'opened', name: tab.name, site: tab.origin, tab: tab.tabId });
});
hooks.closed.push((why) => {
  dispatch(why === 'stopped' ? { type: 'stop' } : detachAction(why));
  release();
});
hooks.said.push((message) => {
  if (message.event === 'blocked') dispatch({ type: 'blocked', what: message.what, url: message.url });
});

// Only the side panel controls a walk: not a content script, nor any other page of this extension.
const PANEL = chrome.runtime.getURL('walks/panel/');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.control !== 'string') return false;
  if (sender.id !== chrome.runtime.id || sender.origin !== self.location.origin || !sender.url?.startsWith(PANEL)) return false;
  void command(message.control).then((ok) => respond({ ok }));
  return true;
});
