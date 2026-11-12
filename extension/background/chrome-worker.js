// Chrome's background worker: the detector's worker, then walks, then the account and the first-walk onboarding.
// Each registers its listeners as it loads. The store build drops the account's and the onboarding's lines
// (scripts/lib/extension-manifests.js `stageStore`); Firefox loads service-worker.js alone.
import './service-worker.js';
import '../walks/worker.js';
import '../account/worker.js';
import '../onboarding/contact.js';
