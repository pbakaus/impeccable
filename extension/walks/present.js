// Runs on our app's two pages a walk starts from, the walk's own page and the command's sign-in page
// (the helper's `content_scripts`, scripts/lib/extension-manifests.js), before the page's own scripts. It says this extension is here, and which version,
// on the page's root element; the page reads that mark (the web app's start checks). It reads nothing of the page.
document.documentElement.dataset.impeccableWalks = chrome.runtime.getManifest().version;
