// The toolbar icon. While a walk is under way it opens the walk's side panel, so a person who closed the panel can
// get back to it; otherwise it opens the detector's popup, as it always has. A worker that starts again with no walk
// puts the popup back (store.js tells its first view to every listener).
import { onView } from './store.js';
import { isLive } from './view.js';

const POPUP = chrome.runtime.getManifest().action?.default_popup ?? '';
let panel = null;

onView((view) => {
  const live = isLive(view);
  if (live === panel) return;
  panel = live;
  void chrome.action.setPopup({ popup: live ? '' : POPUP }).catch(() => undefined);
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: live }).catch(() => undefined);
});
