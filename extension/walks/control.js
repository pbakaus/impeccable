// Who is driving the walked tab: the walk, nobody (paused), or the person (taken over). The person says so from the
// side panel; Stop also from the badge. Every op the socket asks passes through here first, so the server's engine
// needs to know nothing of it: a paused op simply takes longer, and one refused says why by name
// (the walk protocol, panel control).
import { unseen, whenStopPressed } from './badge.js';
import { endWalk, fail, hooks, ops, say, walk } from './driver.js';
import { current, dispatch } from './store.js';
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

/** Returns once the walk may act. Throws while the person has the tab. */
async function clear() {
  for (;;) {
    const { state } = current();
    if (state === 'takeover') throw fail('TakenOver', 'the person is using the tab');
    if (state !== 'paused') return;
    await new Promise((go) => { held.push(go); });
  }
}

for (const [name, run] of Object.entries(ops)) {
  if (FREE.has(name)) continue;
  const acting = unseen(name, run);
  ops[name] = async (req) => { await clear(); return acting(req); };
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
  if (!Object.hasOwn(TOLD, name) || !dispatch({ type: name })) return false;
  say({ event: TOLD[name] });
  release();
  return true;
}

whenStopPressed(() => { void command('stop'); });

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
