// The toolbar icon opens the side panel, always: the panel is the whole extension in Chrome (the decider, 18 Nov), the
// detector's Scan, the account, journeys and an agent's questions alike. Firefox has no side panel and keeps the
// popup (scripts/lib/extension-manifests.js). While a walk is paused at a sign-in, or was ended because walks were
// switched off, its hover text says so: Chrome draws it, so no page can fake it.
import { COPY } from './panel/copy.js';
import { onView } from './store.js';

const MANIFEST = chrome.runtime.getManifest();
const TITLE = MANIFEST.action?.default_title ?? MANIFEST.name;
let title = null;

void Promise.resolve(chrome.sidePanel?.setOptions?.({ enabled: true })).catch(() => undefined);
void Promise.resolve(chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })).catch(() => undefined);

onView((view) => {
  const off = view.state === 'failed' && view.failure?.reason === 'switched-off';
  const now = view.state === 'paused' && view.held === 'sign-in' ? (view.pictured ? COPY.signInPictured : COPY.signIn) : off ? COPY.failed['switched-off'] : TITLE;
  if (now !== title) {
    title = now;
    void chrome.action.setTitle({ title: now }).catch(() => undefined);
  }
});
