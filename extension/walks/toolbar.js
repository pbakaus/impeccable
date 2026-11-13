// The toolbar icon. While a walk is under way, or while this browser is signed in to Impeccable Pro (the account worker
// says so through `signedIn`), it opens the side panel, so a person who closed the panel can get back to it; otherwise
// it opens the popup, as it always has. A worker that starts again with no walk puts the
// popup back (store.js tells its first view to every listener). While a walk is paused at a sign-in, or was ended
// because walks were switched off, its hover text says so: Chrome draws it, so no page can fake it.
import { COPY } from './panel/copy.js';
import { onView } from './store.js';
import { isLive } from './view.js';

const MANIFEST = chrome.runtime.getManifest();
const POPUP = MANIFEST.action?.default_popup ?? '';
const TITLE = MANIFEST.action?.default_title ?? MANIFEST.name;
let panel = null;
let title = null;
let walking = false;
let pro = false;

function point() {
  const on = walking || pro;
  if (on === panel) return;
  panel = on;
  void chrome.action.setPopup({ popup: on ? '' : POPUP }).catch(() => undefined);
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }).catch(() => undefined);
}

/** Whether this browser is signed in to Impeccable Pro: at the worker's start, at sign-in and at sign-out. */
export function signedIn(on) {
  pro = on === true;
  point();
}

onView((view) => {
  const off = view.state === 'failed' && view.failure?.reason === 'switched-off';
  const now = view.state === 'paused' && view.held === 'sign-in' ? COPY.signIn : off ? COPY.failed['switched-off'] : TITLE;
  if (now !== title) {
    title = now;
    void chrome.action.setTitle({ title: now }).catch(() => undefined);
  }
  walking = isLive(view);
  point();
});
