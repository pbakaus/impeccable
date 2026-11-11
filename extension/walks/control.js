// Who is driving the walked tab: the walk, nobody (paused), or the person (taken over). The person says so from the
// side panel; Stop, and Continue on a pause, also from the badge. Every op the socket asks passes through here first, so the server's engine
// needs to know nothing of it: a paused op simply takes longer, and one refused says why by name
// (the walk protocol, panel control).
import { unseen, whenPressed } from './badge.js';
import { endWalk, fail, fence, fenced, hold, hooks, onSignIn, ops, say, signInNow, unhold, walk } from './driver.js';
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
export function rearm() { stopped = false; }

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
    if (state === 'takeover') throw fail('TakenOver', 'the person is using the tab');
    if (state === 'paused') { waited = true; await new Promise((go) => { held.push(go); }); continue; }
    const signIn = await signInNow();
    if (signIn === null && LOOKING.has(name)) throw fail('NotAllowed', 'the page could not be read');
    if (!signIn || !pauseFor('sign-in')) return waited;
  }
}

/**
 * THE PAUSE'S ONE BARRIER. An op that a pause comes before or during (it arrived while paused, or was still under way
 * when the pause landed) never answers with what it found, nor with an error that might carry the page. A click, a
 * key or a navigation is not done after Continue: it was decided on a page the person has since used, so it is
 * refused as `Paused`, and the walk goes on from a fresh look. Anything else (a look, a script, a setting) is asked
 * again once the walk goes on, and answers with what it finds then: the walk protocol has every op that arrives while
 * paused answered after `resumed`, and the engine reads the page with scripts. Letting go of the film passes through
 * a pause, as `open`, `close` and the panel's ops do.
 */
const ACTS = new Set(['mouse', 'keyboard', 'goto', 'goBack']);
const overtaken = () => fail('Paused', 'the walk was paused before this was done; look again');

for (const [name, run] of Object.entries(ops)) {
  if (FREE.has(name)) continue;
  const acting = unseen(name, run);
  ops[name] = async (req) => {
    if (name === 'cdp' && req?.method === 'Page.stopScreencast') return acting(req);
    for (;;) {
      const at = fenced();
      if (!(await clear(name)) && at === fenced()) {
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
  if (stopped) throw fail('Stopped', 'the person stopped this walk');
  return open(req);
};

/* ------------------------------ what the hub tells the panel ------------------------------ */

/** A link the panel may show: https, on a host of ours. Anything else is not shown. */
function ourLink(url) {
  try {
    const link = new URL(url);
    return link.protocol === 'https:' && /^(staging\.)?impeccable\.reviews$/.test(link.hostname) ? link.href : null;
  } catch {
    return null;
  }
}

ops.brief = async ({ persona, errand }) => { dispatch({ type: 'brief', persona, errand }); return {}; };
ops.step = async ({ step }) => { dispatch({ type: 'step', step }); return {}; };
ops.checks = async ({ met }) => { dispatch({ type: 'checks', met }); return {}; };
ops.finish = async ({ outcome }) => { dispatch({ type: 'finish', outcome, replayUrl: ourLink(outcome?.replayUrl) }); return {}; };

/* ------------------------------ what the person says ------------------------------ */

const TOLD = { pause: 'paused', resume: 'resumed', takeover: 'takeover', handback: 'handback' };
/** What gives the walk the tab back, and from where. */
const GOING_ON = { resume: 'paused', handback: 'takeover' };

/** Does what the person asked, if it is on offer right now. Resolves to whether it was. */
export async function command(name) {
  if (name === 'stop') {
    if (!isLive(current())) return false;
    stopped = true;
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
  void (hushes(view) ? hold() : unhold());
});

hooks.opened.push((tab) => { dispatch({ type: 'opened', name: tab.name, site: tab.origin }); });
hooks.closed.push((why) => {
  dispatch(why === 'stopped' ? { type: 'stop' } : detachAction(why));
  release();
});
hooks.said.push((message) => {
  if (message.event === 'blocked') dispatch({ type: 'blocked', what: message.what, url: message.url });
});

// The side panel is one of this extension's own pages; a content script's word is not taken for a control.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.control !== 'string') return false;
  if (sender.id !== chrome.runtime.id || sender.origin !== self.location.origin) return false;
  void command(message.control).then((ok) => respond({ ok }));
  return true;
});
