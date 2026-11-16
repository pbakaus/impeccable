// Runs on our app's two pages a walk starts from, the walk's own page and the command's sign-in page
// (manifest.json `content_scripts`), before the page's own scripts. It says this extension is here, and which version,
// on the page's root element; the page reads that mark (the web app's start checks). It reads nothing of the page.
// It answers the worker's one question, whether it is here: a page it runs on needs no reload to find the extension.
document.documentElement.dataset.impeccableWalks = chrome.runtime.getManifest().version;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && message?.walks === 'here') respond({ here: true });
});
