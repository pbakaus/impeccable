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
/** Whether Chrome offers the side panel at all, and whether the person is signed in without Pro (then it doesn't). */
let offered = null;
let noPro = false;

/** Chrome offers the side panel to everyone but a person signed in without Pro, and always while a walk is under way (a hand-off kept is one). */
function offer() {
  const on = walking || !noPro;
  if (on === offered) return;
  offered = on;
  void Promise.resolve(chrome.sidePanel.setOptions?.({ enabled: on })).catch(() => undefined);
}

/** Whether this browser is signed in without Pro, by the server's word: the side panel is not offered then. */
export function withoutPro(on) {
  noPro = on === true;
  offer();
}

/** Right before something opens the side panel (a walk's start, a click on our page): offered, whatever the account. */
export function offerPanel() {
  offered = true;
  void Promise.resolve(chrome.sidePanel.setOptions?.({ enabled: true })).catch(() => undefined);
}

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
  const now = view.state === 'paused' && view.held === 'sign-in' ? (view.pictured ? COPY.signInPictured : COPY.signIn) : off ? COPY.failed['switched-off'] : TITLE;
  if (now !== title) {
    title = now;
    void chrome.action.setTitle({ title: now }).catch(() => undefined);
  }
  walking = isLive(view);
  point();
  offer();
});
