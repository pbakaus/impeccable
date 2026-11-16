// What this build carries, fixed when it is built. Load unpacked reads this file as it is: signing in to an account,
// and the staging and local hosts a developer walks against. The store build (scripts/lib/extension-manifests.js
// `stageStore`) writes it with both off, leaves the account's files out, and walks only from our app's production pages.
export const BUILD = { account: true, devHosts: true };
