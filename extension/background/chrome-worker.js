// Chrome's background worker: the detector's worker, then walks, then the account. Each registers its listeners as it loads.
// The store build drops the account's line (scripts/lib/extension-manifests.js `stageStore`).
// Firefox loads service-worker.js on its own (scripts/build-extension.js): it cannot drive a tab the way walks do.
import './service-worker.js';
import '../walks/worker.js';
import '../account/worker.js';
