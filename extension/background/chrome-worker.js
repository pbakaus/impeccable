// Chrome's background worker in a build loaded unpacked: the detector's worker, then the account, then what tells a
// person about the walk helper. Each registers its listeners as it loads. The walks themselves are the helper's
// (scripts/lib/extension-manifests.js `helperManifest`). The store build and Firefox load service-worker.js alone.
import './service-worker.js';
import '../account/worker.js';
import '../onboarding/contact.js';
