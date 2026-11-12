// The first-walk onboarding's half of the background worker. The first time a walk starts in this browser (this
// extension's content script on our outing page or the command's sign-in page), the onboarding page opens beside it,
// once, behind the walk so it takes nothing from it. Never beside a walk of the person's own tab: a tab that tab
// opens is one the walk closes as a popup. It answers only this extension's own content script (start.js).
const PAGE = chrome.runtime.getURL('onboarding/onboarding.html');

const ownScript = (sender) => sender.id === chrome.runtime.id && sender.frameId === 0 && typeof sender.tab?.id === 'number';

/** A walk may be starting in `tab`: the onboarding opens beside it, the first time ever. */
async function firstWalk(tab) {
  if ((await chrome.storage.local.get('onboarded')).onboarded) return;
  await chrome.storage.local.set({ onboarded: true });
  await chrome.tabs.create({ url: PAGE, windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id, active: false });
}

let starts = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender) => {
  // One at a time: two pages starting together open one onboarding.
  if (message?.walks === 'start' && ownScript(sender)) starts = starts.then(() => firstWalk(sender.tab)).catch(() => undefined);
  return false;
});
