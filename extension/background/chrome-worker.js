// Chrome's background worker: the detector's worker, then walks. Both register their listeners as they load.
// Firefox loads service-worker.js on its own (scripts/build-extension.js): it cannot drive a tab the way walks do.
import './service-worker.js';
import '../walks/worker.js';
