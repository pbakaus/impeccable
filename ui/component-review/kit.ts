/** The Impeccable design-system kit, vendored verbatim from impeccable-site (see vendor/ and
 * scripts/sync-kinpaku-kit.mjs; the site is the source of truth). Shadow roots have no :root,
 * so the token blocks also apply to :host. Class names are the kit's own. */
import { tokens, kit, rail } from './vendor/kit-css.ts';
const hosted = (css: string) => css.replace(/^:root\s*\{/gm, ':root, :host {');
export const ksKit = hosted(tokens) + '\n' + hosted(kit) + '\n' + rail;
/** The kit's primary-button arrow (the site's .ks-button-arrow markup). */
export const ksArrow = '<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';
