// Chrome's background worker: the detector's worker, then walks, then the account.
// Each registers its listeners as it loads. Firefox loads service-worker.js alone.
import './service-worker.js';
import '../walks/worker.js';
import '../account/worker.js';
