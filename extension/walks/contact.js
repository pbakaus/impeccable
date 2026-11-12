// The walk helper's one door to the main Impeccable extension. Main asks whether the helper is here; nothing else
// crosses, and no token ever does. Chrome lets only main's id in (the helper's `externally_connectable`); its id is
// checked again here, and anything else is left unanswered.
import { MAIN_ID } from '../shared/ids.js';

/** The version of this door. Main tells a helper that answers another one to update. */
const CONTRACT = 1;

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!MAIN_ID || sender.id !== MAIN_ID || message?.walks !== 'hello' || Object.keys(message).length !== 1) return false;
  respond({ ok: true, contract: CONTRACT, version: chrome.runtime.getManifest().version });
  return false;
});
