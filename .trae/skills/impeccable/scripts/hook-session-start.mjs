#!/usr/bin/env node
/**
 * Impeccable design hook — SessionStart greeting.
 *
 * Emits a single-line system reminder explaining the design hook the first
 * time a session starts in a scannable project, then throttles itself to
 * once every 30 days per project.
 *
 * Gates (both must pass):
 *  1. Project probe — there must be a UI dep in package.json (`react`, `vue`,
 *     `svelte`, `next`, `@astrojs/*`, `solid-js`, etc.) OR `*.html` files
 *     somewhere obvious. If the project has nothing to scan, do not greet.
 *  2. Per-project throttle — at most once per 30 days, tracked via
 *     `.impeccable/hook.cache.json` `lastEducationAt`.
 *
 * Contract identical to hook.mjs: never break a turn. Always exit 0.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ENVELOPE_PREFIX,
  readCache,
  persistCache,
  payload,
  truthy,
  writeAuditLog,
} from './hook-lib.mjs';

const UI_DEPS = new Set([
  'react', 'react-dom', 'preact',
  'vue', 'svelte', 'solid-js',
  'next', 'nuxt', '@astrojs/core', 'astro',
  '@remix-run/react', '@sveltejs/kit',
  '@nuxt/core', '@nuxtjs/core',
]);

const UI_DEP_PREFIXES = ['@astrojs/', '@nuxt/', '@nuxtjs/', '@sveltejs/', '@remix-run/'];

const GREETING_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function hasUiDependency(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const dep of Object.keys(deps)) {
      if (UI_DEPS.has(dep)) return true;
      if (UI_DEP_PREFIXES.some((prefix) => dep.startsWith(prefix))) return true;
    }
  }
  return false;
}

function hasHtmlSurface(cwd) {
  const candidates = ['index.html', 'public/index.html', 'src/index.html', 'app/index.html'];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(cwd, rel))) return true;
  }
  return false;
}

function projectIsScannable(cwd) {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (hasUiDependency(pkg)) return true;
    }
  } catch { /* keep checking */ }
  return hasHtmlSurface(cwd);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

const GREETING = `${ENVELOPE_PREFIX} Design hook is active. Runs the design detector on .tsx/.jsx/.html/.css/etc. after every Write or Edit and reminds you (via system context) when known design anti-patterns appear. Disable per project: /impeccable hooks off. Disable globally: IMPECCABLE_HOOK_DISABLED=1.`;

async function main() {
  const inheritedEnv = { ...process.env };
  process.env.IMPECCABLE_HOOK_DEPTH = process.env.IMPECCABLE_HOOK_DEPTH || '1';

  if (truthy(inheritedEnv.IMPECCABLE_HOOK_DISABLED)) {
    return done(0, '');
  }

  let event = null;
  try {
    const raw = await readStdin();
    if (raw) event = JSON.parse(raw);
  } catch {
    /* parse errors swallowed, treat as missing event */
  }
  const cwd = event?.cwd || process.cwd();

  if (!projectIsScannable(cwd)) {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'SessionStart',
      skipped: 'not-scannable',
    });
    return done(0, '');
  }

  const cache = readCache(cwd);
  const last = cache.lastEducationAt ? Date.parse(cache.lastEducationAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < GREETING_INTERVAL_MS) {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'SessionStart',
      skipped: 'throttled',
    });
    return done(0, '');
  }

  cache.lastEducationAt = new Date().toISOString();
  persistCache(cwd, cache);
  writeAuditLog(process.env, {
    ts: new Date().toISOString(),
    event: 'SessionStart',
    emitted: true,
  });

  return done(0, payload(GREETING, 'SessionStart'));
}

function done(code, out) {
  if (out) process.stdout.write(out);
  process.exit(code);
}

main().catch((err) => {
  if (process.env.IMPECCABLE_HOOK_DEBUG) {
    process.stderr.write(`[impeccable-hook-session-start] ${err}\n`);
  }
  process.exit(0);
});
