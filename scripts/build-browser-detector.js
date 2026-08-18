#!/usr/bin/env node

/**
 * The in-page detector bundle is no longer built here. It is produced by the
 * engine repo (the WASM rule core plus a thin DOM adapter) and vendored under
 * extension/detector/ by `bun run build:extension`.
 *
 * This stub keeps `bun run build:browser` a no-op so package scripts and CI
 * steps that still call it do not break.
 */
console.log('build:browser: the in-page bundle is produced by the engine repo; vendored under extension/detector by build:extension.');
process.exit(0);
