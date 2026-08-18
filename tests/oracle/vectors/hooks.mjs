/**
 * Node module hooks that wrap every export of the pure engine modules
 * (shared/color.mjs, rules/checks.mjs, shared/inline-ignores.mjs,
 * shared/fonts.mjs, engines/static-html/css-cascade.mjs) with a recorder.
 * Calls whose arguments and result are plain JSON-serializable data are
 * appended to $IMPECCABLE_VECTORS_DIR/<module>/<fn>.jsonl.
 *
 * Registered by record-calls.mjs; do not import directly.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./hooks-impl.mjs', import.meta.url).href, pathToFileURL('./').href);
