// The two extensions' ids: the detector with the account ("main", extension/manifest.json) and the walk helper
// (scripts/lib/extension-manifests.js `helperManifest`). Each lets the other alone talk to it. A build loaded
// unpacked carries a fixed `key` in its manifest, which gives it the unpacked id below on every machine; a store
// build has the store's id. The helper has none in the store until it is listed.
import { BUILD } from './build.js';

export const IDS = {
  store: { main: 'bdkgmiklpdmaojlpflclinlofgjfpabf', helper: null },
  unpacked: { main: 'apffhogljdpdafpcjokfkgbcmhldjmpi', helper: 'ohahfjdkphinllkplmjhinlojjflpkkl' },
};

export const { main: MAIN_ID, helper: HELPER_ID } = IDS[BUILD.devHosts ? 'unpacked' : 'store'];
