// The toolbar icon. While a walk is under way it opens the walk's side panel, so a person who closed the panel can
// get back to it; otherwise it opens the detector's popup, as it always has. A worker that starts again with no walk
// puts the popup back (store.js tells its first view to every listener). While a walk is paused at a sign-in, its
// hover text says so: Chrome draws it, so no page can fake it.
import { COPY } from './panel/copy.js';
import { onView } from './store.js';
import { isLive } from './view.js';

const MANIFEST = chrome.runtime.getManifest();
const POPUP = MANIFEST.action?.default_popup ?? '';
const TITLE = MANIFEST.action?.default_title ?? MANIFEST.name;
let panel = null;
let title = null;

onView((view) => {
  const now = view.state === 'paused' && view.held === 'sign-in' ? COPY.signIn : TITLE;
  if (now !== title) {
    title = now;
    void chrome.action.setTitle({ title: now }).catch(() => undefined);
  }
  const live = isLive(view);
  if (live === panel) return;
  panel = live;
  void chrome.action.setPopup({ popup: live ? '' : POPUP }).catch(() => undefined);
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: live }).catch(() => undefined);
});
