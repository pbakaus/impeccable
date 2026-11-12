// The toolbar icon. It opens the walk's side panel, walk or not: with no walk, the panel says how to start one. While
// a walk is paused at a sign-in, or was ended because walks were switched off, its hover text says so: Chrome draws
// it, so no page can fake it.
import { COPY } from './panel/copy.js';
import { onView } from './store.js';

const MANIFEST = chrome.runtime.getManifest();
const TITLE = MANIFEST.action?.default_title ?? MANIFEST.name;
let title = null;

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

onView((view) => {
  const off = view.state === 'failed' && view.failure?.reason === 'switched-off';
  const now = view.state === 'paused' && view.held === 'sign-in' ? COPY.signIn : off ? COPY.failed['switched-off'] : TITLE;
  if (now === title) return;
  title = now;
  void chrome.action.setTitle({ title: now }).catch(() => undefined);
});
