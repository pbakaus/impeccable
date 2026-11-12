// Main's half of the walk helper's door (walks/contact.js on the other side). Main drives no tab: it asks whether
// the helper is here, and the first time a walk starts in this browser session without it, opens the onboarding
// page. It answers only this extension's own pages and its own content script (start.js).
import { HELPER_ID } from '../shared/ids.js';

const PAGE = chrome.runtime.getURL('onboarding/onboarding.html');
const OWN_PAGES = ['popup/', 'onboarding/'].map((folder) => chrome.runtime.getURL(folder));
/** The helper's door this side speaks. A helper that answers another one is old. */
const CONTRACT = 2;
/** How long a helper that is here takes at most to answer; a missing or switched-off one never does. */
const WAIT_MS = 1500;

/** Whether the walk helper is here: `ready`, `old`, or `missing` (not added, or switched off). */
async function helper() {
  if (!HELPER_ID) return 'missing';
  const answer = await Promise.race([
    chrome.runtime.sendMessage(HELPER_ID, { walks: 'hello' }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
  ]);
  if (answer?.ok !== true) return 'missing';
  return answer.contract === CONTRACT ? 'ready' : 'old';
}

const ownPage = (sender) => sender.id === chrome.runtime.id && OWN_PAGES.some((page) => sender.url?.startsWith(page));
const ownScript = (sender) => sender.id === chrome.runtime.id && sender.frameId === 0 && typeof sender.tab?.id === 'number';

/** A walk may be starting in `tab`: without the helper, the onboarding opens beside it, once a browser session. */
async function started(tab) {
  if ((await helper()) === 'ready') return;
  if ((await chrome.storage.session.get('onboarded')).onboarded) return;
  await chrome.storage.session.set({ onboarded: true });
  await chrome.tabs.create({ url: PAGE, windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
}

let starts = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.walks === 'helper' && ownPage(sender)) {
    void helper().then((state) => respond({ state }), () => respond({ state: 'missing' }));
    return true;
  }
  // One at a time: two pages starting together open one onboarding.
  if (message?.walks === 'start' && ownScript(sender)) starts = starts.then(() => started(sender.tab)).catch(() => undefined);
  return false;
});
