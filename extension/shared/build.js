// What this build carries, fixed when it is built. Load unpacked reads this file as it is: signing in to an account,
// and the staging and local hosts a developer walks against. The store build (scripts/lib/extension-manifests.js
// `stageStore`) writes it with both off, leaves the account's files out and talks to no server of its own.
export const BUILD = { account: true, devHosts: true };
