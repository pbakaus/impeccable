// Who is driving the walked tab: the walk, nobody (paused), or the person (taken over). The person says so from the
// side panel; Stop, and Continue on a pause, also from the badge. Every op the socket asks passes through here first, so the server's engine
// needs to know nothing of it: a paused op simply takes longer, and one refused says why by name
// (the walk protocol, panel control).
import { unseen, whenPressed, withoutBadge } from './badge.js';
import { resultLink } from './handoff.js';
import { asWebp, drivenBy, endWalk, fail, fence, fenced, fresh, hold, hooks, letPast, letWrite, lookOnly, note, onAsk, onSignIn, ops, passwordIn, personHas, regain, samePage, say, seal, sealed, signInNow, signInStill, stopOpening, submitIn, unhold, unnote, walk, writesNow } from './driver.js';
import { current, dispatch, onView } from './store.js';
import { ON_TAB, detachAction, isLive } from './view.js';

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
  unnote();
  plannedWalk = false;
  // The last walk's results page and walker are not this one's.
  void chrome.storage.session.remove(['walkUrl', 'walker']).catch(() => undefined);
}
export function planned(on) { plannedWalk = on; }

/**
 * Pauses the walk for a reason of its own (a sign-in). From walking, or from a person's pause or take-over: in every
 * case the walk is paused, and the other end told why each time that changes. Synchronous to the pause: nothing the
 * server asks is done after it. The walk's own one still of a sign-in page it reached is the only picture after it,
 * taken as it pauses, before the person has the tab (`stillAtSignIn`).
 */
function pauseFor(why) {
  const was = current();
  if (!dispatch({ type: 'pause', why })) return false;
  if (was.state !== 'paused' || was.held !== current().held) say({ event: 'paused', why: current().held });
  // The walk itself reached a sign-in: its page pictured once, before the person has it, for a server that takes it.
  if (why === 'sign-in' && was.state === 'walking' && walk?.signInPage) void stillAtSignIn();
  return true;
}
onSignIn(() => { pauseFor('sign-in'); });

/** The longest message the server rejoins from its pieces: one past it ends the walk. */
const MESSAGE_CHARS = 16 * 1024 * 1024 - 64 * 1024;
/** A still taken as any is (the `screenshot` op, without the badge), for the sign-in page alone: kept before the ops below wrap it. */
const shot = unseen('screenshot', ops.screenshot);
/** The sign-in page the walk paused at, as it was before the person had it: its still, or none where it could not be taken safely. */
async function stillAtSignIn() {
  const on = samePage();
  const taken = await signInStill(() => shot({ format: 'png', plain: true }), () => current().state === 'paused' && current().held === 'sign-in');
  if (taken === undefined) return;
  // Its title with its picture only: a sign-in host still loading, or a 401, leaves the tab on the page before.
  const tab = taken && on() ? await chrome.tabs.get(walk.tabId).catch(() => null) : null;
  // The still as taken, where the persona's sight drew the other: as WebP, as a step's is, for the journey map.
  const plain = taken?.plain && on() ? await asWebp(taken.plain).catch(() => null) : null;
  // After the last read, still the page it paused on as it is told: else the picture and its title may be of the next
  // one, and neither goes.
  const still = taken && on() ? taken : null;
  const title = typeof tab?.title === 'string' && tab.title ? { title: tab.title.slice(0, 200) } : {};
  const message = { event: 'sign-in-page' };
  // Each picture only while the message still fits what the server rejoins: past that the walk would end, without
  // them the page is a step all the same.
  if (still && JSON.stringify({ ...message, ...title }).length + still.data.length + 16 < MESSAGE_CHARS) Object.assign(message, title, { still: still.data });
  if (message.still && plain && JSON.stringify(message).length + plain.length + 16 < MESSAGE_CHARS) message.plain = plain;
  if (message.still) dispatch({ type: 'pictured' });
  say(message);
}

/** The ops that take something of the page: none runs on a page the walk could not check. */
const LOOKING = new Set(['screenshot', 'evaluate', 'hear']);

/** Returns once the walk may act, and not at a sign-in: whether it had to wait for a pause. Throws while the person has the tab. */
async function clear(name) {
  let waited = false;
  for (;;) {
    const { state } = current();
    if (stopped) throw fail('Stopped', 'the person stopped this journey');
    if (state === 'takeover') throw fail('TakenOver', 'the person is using the tab');
    // Over (the socket went, the tab closed, it failed): nothing is coming back to wait for.
    if (!ON_TAB.includes(state)) throw fail('OutingClosed', 'no tab is open');
    if (state === 'paused' || current().ask) { waited = true; await new Promise((go) => { held.push(go); }); continue; }
    // Not before the server's scripts are back on after a sign-in pause or a take-over (driver.js `seal`). Paused again
    // meanwhile, or its scripts still off at a sign-in: the op waits, as for any pause.
    await fresh();
    if (current().state !== 'walking' || current().ask) continue;
    const signIn = await signInNow();
    if (signIn === null && LOOKING.has(name)) throw fail('NotAllowed', 'the page could not be read');
    // A password in a field: a script waits for the pause, and runs after Continue once no field is filled.
    if (signIn && (name === 'evaluate' || name === 'hear') && (await passwordIn())) {
      if (!pauseFor('sign-in')) throw fail('Paused', 'a journey runs no script while a password is in a field');
      continue;
    }
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
const ACTS = new Set(['mouse', 'keyboard', 'upload']);
const overtaken = () => fail('Paused', 'the journey was paused before this was done; look again');

/* ------------------------------ asking the person first ------------------------------ */

/** How long a question waits for the person (the server's `OUTING_ASK_MS`). */
const ASK_MS = 120_000;
/** The question standing, if one is: its answer. */
let answering = null;

/**
 * Asks the person, in the side panel and on the badge, and waits: `yes`, `no`, `timeout` when nobody answered in time
 * (not a No: the deed is said as `TimeoutError`, the server's `unanswered`), or `void` when the walk stopped walking
 * first (paused, taken over, ended). Nothing else the walk asks is done meanwhile (`clear`).
 */
function consent(ask) {
  if (!dispatch({ type: 'ask', ask })) return Promise.resolve('void');
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle('timeout'), ASK_MS);
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
// Another site nobody answered for in time stays shut, as a No to it does (driver.js `mayGo`).
onAsk((ask) => consent(ask).then((said) => (said === 'timeout' ? 'no' : said)));

/** A click or key the server marked (`ask`: delete, pay or send) is done only once the person says yes to it. */
const askOf = (name, req) => (ACTS.has(name) && req?.ask && typeof req.ask === 'object' && req.action !== 'up' && req.action !== 'move' ? { kind: req.ask.kind, what: req.ask.what } : null);

for (const [name, run] of Object.entries(ops)) {
  if (FREE.has(name)) continue;
  const acting = unseen(name, run);
  ops[name] = async (req) => {
    if (name === 'cdp' && req?.method === 'Page.stopScreencast') return acting(req);
    // The tab's writes never wait: a close is done whoever drives; an open only while walking, else refused.
    if (name === 'writes') {
      if (req?.open === true && stopped) throw fail('Stopped', 'the person stopped this journey');
      if (req?.open === true && current().state === 'takeover') throw fail('TakenOver', 'the person is using the tab');
      if (req?.open === true && current().state !== 'walking') throw fail('Paused', 'the journey is paused');
      return acting(req);
    }
    let ask = askOf(name, req);
    let agreed = ask === null;
    // A free walk holds no write: a submit the server did not mark is asked here first, once the walk may act.
    let checked = ask !== null || !ACTS.has(name);
    for (;;) {
      const at = fenced();
      if (!(await clear(name)) && at === fenced()) {
        if (!checked) {
          checked = true;
          // Looked at as the press will be made, with the badge out of the way: else a submit under it goes unasked.
          const control = await submitIn(name, req, withoutBadge);
          if (control) [ask, agreed] = [{ kind: 'send', what: `Submit "${control}"` }, false];
          continue;
        }
        if (!agreed) {
          // Another site the person let the walk go to is only looked at: no deed is asked for there.
          if (lookOnly()) throw fail('NotAllowed', 'on another site a journey only looks');
          // The server stops the deed's clock while the person decides: it did not arm this ask, so it is told.
          if (!askOf(name, req)) say({ event: 'asking', kind: 'send' });
          const asked = writesNow();
          const said = await consent(ask);
          if (said === 'no') throw fail('Declined', 'the person said no');
          if (said === 'timeout') { dispatch({ type: 'unanswered' }); throw fail('TimeoutError', 'nobody answered in time'); }
          if (said !== 'yes' || at !== fenced()) throw overtaken();
          // The Yes opens the deed's writes until the server closes them or the walk stops walking. Looked at
          // afresh before it is done: a sign-in that showed meanwhile still pauses it, and closes them.
          await letWrite(asked);
          agreed = true;
          continue;
        }
        let out;
        let failed = null;
        try { out = await acting(req); } catch (err) { failed = err; }
        // A look is checked again once done: a script can wait for a password to be filled, so what it found (or its
        // error) never goes out if a sign-in or a filled field shows now, or the page can't be read.
        if (at === fenced() && LOOKING.has(name)) {
          const signIn = await signInNow();
          if (signIn) pauseFor('sign-in');
          if (signIn !== false) throw overtaken();
        }
        if (at === fenced()) { if (failed) throw failed; return out; }
      }
      // Focus a screen reader moved is a key's: not done on a page the person has used since.
      if (ACTS.has(name) || (name === 'hear' && req?.what === 'focus')) throw overtaken();
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
export async function command(name) { return (await attempt(name)) === true; }

/**
 * As `command`, resolving to true, or why Continue or Hand back was refused (for the side panel): `sign-in` still
 * shows, a `script` of the server's may still be on, the `tab` can't be got back, or it `closed`. Anything else: false.
 * A refusal is told the other end too, once a walk.
 */
async function attempt(name) {
  const said = await tryTo(name);
  if (typeof said === 'string') note('continue-refused', said);
  return said;
}
async function tryTo(name) {
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
  // Going on is checked again: while the debugger cannot get back on the tab (another extension's frame is in it), or
  // a sign-in host or a 401 still shows, the walk stays paused.
  if (GOING_ON[name] === current().state && walk && !(await regain())) return walk ? 'tab' : 'closed';
  // Nor while a script of the server's may still be on the tab (driver.js `seal`): asked off once more on each press.
  if (GOING_ON[name] === current().state && walk && !(await sealed())) return 'script';
  // Continue at a sign-in is the person's word that it is done: a password field still on this page pauses no more.
  if (GOING_ON[name] === current().state && current().held === 'sign-in') letPast();
  if (GOING_ON[name] === current().state && walk && (await signInNow())) { letPast(false); pauseFor('sign-in'); return 'sign-in'; }
  if (GOING_ON[name] === current().state && walk?.lost) return 'tab';
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
  // Where the person may sign in, nothing the server put in the page is: off before the tab is told anything more.
  if (view.state === 'takeover' || (view.state === 'paused' && view.held === 'sign-in')) seal(view.held === 'sign-in' ? 'sign-in' : 'takeover');
  // Taken over, or a question standing: the film takes nothing of it (the badge shows the question, badge.js `hidden`).
  personHas(view.state === 'takeover' || Boolean(view.ask));
  // Taken over, what the person sends is theirs, not held; paused at a sign-in, what follows their own press or key (driver.js `holding`).
  drivenBy(view.state === 'takeover' ? 'takeover' : view.state === 'paused' && view.held === 'sign-in' ? 'sign-in' : null);
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
// A sign-in the person did without a press or key in the tab (a passkey, a phone, another site's frame): the panel says to stop and start again.
hooks.withheld.push(() => { dispatch({ type: 'withheld' }); note('withheld'); });

// Only the side panel controls a walk: not a content script, nor any other page of this extension.
const PANEL = chrome.runtime.getURL('walks/panel/');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.control !== 'string') return false;
  if (sender.id !== chrome.runtime.id || sender.origin !== self.location.origin || !sender.url?.startsWith(PANEL)) return false;
  void attempt(message.control).then((said) => respond(typeof said === 'string' ? { ok: false, why: said } : { ok: said }));
  return true;
});
