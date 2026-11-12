// Runs on our app's two pages a walk starts from (manifest.json `content_scripts`). It tells this extension's worker
// that a walk may be starting, and nothing else: it reads nothing of the page. The worker opens the onboarding the first
// time (contact.js).
void chrome.runtime.sendMessage({ walks: 'start' }).catch(() => undefined);
