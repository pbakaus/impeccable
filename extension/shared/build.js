// What this build carries, fixed when it is built. Load unpacked reads this file as it is: a development build, which
// also signs in to and runs journeys from this machine's stand-ins, and shows the side panel's stand-in screens.
// scripts/lib/extension-manifests.js rewrites it: `stageDev` adds the servers a developer names in
// extension/dev-hosts.local.json (each `{ api, app, site }`, as production's three), `stageStore` writes it off:
// production alone.
export const BUILD = { devHosts: true, servers: [] };
