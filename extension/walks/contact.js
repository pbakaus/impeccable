// The walk helper's one door to the main Impeccable extension. Main asks whether the helper is here, and hands over a
// walk of the person's own tab: the block the server gave it and the tab's id. Nothing else crosses, and no token
// ever does. Chrome lets only main's id in (the helper's `externally_connectable`); its id is
// checked again here, and anything else is left unanswered.
import { MAIN_ID } from '../shared/ids.js';
import { adopt } from './link.js';

/** The version of this door. Main tells a helper that answers another one to update. 2: a walk of the person's tab. */
const CONTRACT = 2;

const exactly = (message, keys) => Object.keys(message).length === keys.length && keys.every((key) => Object.hasOwn(message, key));

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!MAIN_ID || sender.id !== MAIN_ID || message === null || typeof message !== 'object') return false;
  if (message.walks === 'hello' && exactly(message, ['walks'])) {
    respond({ ok: true, contract: CONTRACT, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message.walks === 'walk' && exactly(message, ['walks', 'handoff', 'tabId']) && Number.isInteger(message.tabId)) {
    // At once, while Chrome may still count main's click: whether the side panel opened is said in the answer.
    const panel = chrome.sidePanel.open({ tabId: message.tabId }).then(() => true, () => false);
    void adopt(message.handoff, message.tabId).then(async (answer) => respond(answer.ok ? { ...answer, panel: await panel } : answer), () => respond({ ok: false, why: 'malformed' }));
    return true;
  }
  return false;
});
