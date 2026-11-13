// The worker's copy of the walk's view (view.js), kept where the side panel can read it: chrome.storage.session,
// which lives in memory, never on disk, and which Chrome holds to this extension's own pages: no website and no
// content script can read it.
import { ON_TAB, emptyView, reduce } from './view.js';

let view = emptyView(false);
const listeners = [];

export const current = () => view;
/** Hears every view after it changes. */
export function onView(listener) { listeners.push(listener); }

function keep() {
  void chrome.storage.session.set({ view });
  for (const listener of listeners) { try { listener(view); } catch { /* a listener's failure is its own */ } }
}

/** Applies an action. False when it did not apply: the view is as it was. */
export function dispatch(action) {
  const next = reduce(view, action);
  if (next === view) return false;
  view = next;
  keep();
  return true;
}

/**
 * Resolved once the view is what the last worker left: a worker that starts again mid-walk has lost the tab's
 * debugger, so that walk is over.
 */
export const ready = (async () => {
  const [{ view: kept }, { linked }] = await Promise.all([chrome.storage.session.get('view'), chrome.storage.local.get('linked')]);
  view = kept?.v === 1 ? kept : emptyView(linked === true);
  if (ON_TAB.includes(view.state)) view = reduce(view, { type: 'fail', reason: 'connection' });
  keep();
})();
