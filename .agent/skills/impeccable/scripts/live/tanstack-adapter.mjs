/**
 * TanStack Start live-mode adapter.
 *
 * TanStack Start is SSR: there is no static index.html to patch. The document
 * shell is a React component (`shellComponent`/`component`) defined in the root
 * route file, `src/routes/__root.tsx`, which renders `<html>…<body>{children}
 * <Scripts /></body></html>`.
 *
 * A raw `<script src>` placed in that JSX is server-rendered into the streamed
 * HTML, but React's script handling and hydration make it an unreliable place
 * to load a cross-origin dev bundle. So, like the Nuxt and SvelteKit adapters,
 * this keeps the injected code in a dev-only managed component that appends the
 * live script on mount (client-only, after hydration). The adapter mounts that
 * component from the root document and removes it cleanly on stop.
 *
 * The managed component lives OUTSIDE `src/routes/` (in `src/impeccable/`) so
 * the TanStack Router file-based route generator never treats it as a route.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildLiveScriptSrc } from './frameworks/script-src.mjs';

export const TANSTACK_MARKER_OPEN = '{/* impeccable-live-tanstack-start */}';
export const TANSTACK_MARKER_CLOSE = '{/* impeccable-live-tanstack-end */}';
export const TANSTACK_COMPONENT_DIR = 'src/impeccable';
export const TANSTACK_COMPONENT_BASENAME = 'ImpeccableLiveRoot';

const ROOT_ROUTE_CANDIDATES = [
  'src/routes/__root.tsx',
  'src/routes/__root.jsx',
  'src/routes/__root.ts',
  'src/routes/__root.js',
  'app/routes/__root.tsx',
  'app/routes/__root.jsx',
];

const START_PACKAGES = [
  '@tanstack/react-start',
  '@tanstack/solid-start',
  '@tanstack/start',
];

export function detectTanStackStartProject(cwd = process.cwd()) {
  if (!packageHasTanStackStart(cwd)) return null;
  const rootRoute = findRootRouteFile(cwd);
  if (!rootRoute) return null;

  const ext = path.extname(rootRoute);
  const componentExt = ext === '.jsx' || ext === '.js' ? '.jsx' : '.tsx';
  const componentFile = `${TANSTACK_COMPONENT_DIR}/${TANSTACK_COMPONENT_BASENAME}${componentExt}`;
  const componentImport = relativeImportSpecifier(rootRoute, componentFile);

  return { rootRoute, componentFile, componentImport, ext };
}

export function applyTanStackLiveAdapter({ cwd = process.cwd(), port, token, project = detectTanStackStartProject(cwd) } = {}) {
  if (!project) return { error: 'tanstack_not_detected' };
  if (!Number.isFinite(Number(port))) {
    throw new Error('TanStack Start live adapter requires a numeric port');
  }

  // Write the managed mount component.
  const componentAbs = path.join(cwd, project.componentFile);
  const componentBody = buildTanStackLiveRootComponent(Number(port), token);
  const componentExisted = fs.existsSync(componentAbs);
  if (componentExisted && !isManagedComponent(fs.readFileSync(componentAbs, 'utf-8'))) {
    // A non-Impeccable file already sits at our managed path — refuse to clobber.
    return {
      file: project.componentFile,
      error: 'tanstack_component_conflict',
      hint: `${project.componentFile} already exists and is not managed by Impeccable Live`,
    };
  }
  fs.mkdirSync(path.dirname(componentAbs), { recursive: true });
  fs.writeFileSync(componentAbs, componentBody, 'utf-8');

  // Patch the root document to import + render the mount component.
  const rootAbs = path.join(cwd, project.rootRoute);
  const before = fs.readFileSync(rootAbs, 'utf-8');
  const after = patchTanStackRoot(before, project.componentImport);
  const changed = after !== before;
  if (changed) fs.writeFileSync(rootAbs, after, 'utf-8');

  return {
    file: project.rootRoute,
    adapter: 'tanstack-start',
    inserted: changed || !componentExisted,
    componentFile: project.componentFile,
    devOnly: true,
  };
}

export function removeTanStackLiveAdapter({ cwd = process.cwd(), project = detectTanStackStartProject(cwd) } = {}) {
  if (!project) return { error: 'tanstack_not_detected' };
  let removed = false;

  const rootAbs = path.join(cwd, project.rootRoute);
  if (fs.existsSync(rootAbs)) {
    const before = fs.readFileSync(rootAbs, 'utf-8');
    const after = unpatchTanStackRoot(before);
    if (after !== before) {
      fs.writeFileSync(rootAbs, after, 'utf-8');
      removed = true;
    }
  }

  const componentAbs = path.join(cwd, project.componentFile);
  if (fs.existsSync(componentAbs)) {
    fs.rmSync(componentAbs, { force: true });
    removed = true;
  }
  pruneEmptyDir(path.dirname(componentAbs), path.join(cwd, 'src'));

  return {
    file: project.rootRoute,
    adapter: 'tanstack-start',
    removed,
    componentFile: project.componentFile,
  };
}

export function patchTanStackRoot(content, componentImport) {
  let out = String(content || '');
  const importStatement = `import ImpeccableLiveRoot from '${componentImport}';`;

  if (!out.includes(importStatement)) {
    out = insertAfterLastImport(out, importStatement);
  }

  if (!out.includes(TANSTACK_MARKER_OPEN)) {
    const block =
      `${TANSTACK_MARKER_OPEN}\n`
      + `        <ImpeccableLiveRoot />\n`
      + `        ${TANSTACK_MARKER_CLOSE}\n        `;
    // Anchor before <Scripts …/> (the stable TanStack Start document marker);
    // fall back to before </body>.
    const scriptsMatch = out.match(/<Scripts\b/);
    if (scriptsMatch) {
      out = out.slice(0, scriptsMatch.index) + block + out.slice(scriptsMatch.index);
    } else {
      const bodyClose = out.lastIndexOf('</body>');
      if (bodyClose !== -1) {
        out = out.slice(0, bodyClose) + block + out.slice(bodyClose);
      }
    }
  }

  return out;
}

export function unpatchTanStackRoot(content) {
  let out = String(content || '');
  // Remove exactly the inserted block (open marker → component → close marker →
  // trailing newline + the indent that leads back to the anchor). Leaving the
  // leading indent before the open marker intact hands it back to the anchor
  // (e.g. `<Scripts />`) so the file round-trips byte-for-byte.
  const blockRe = new RegExp(
    escapeRegExp(TANSTACK_MARKER_OPEN)
    + '\\s*<ImpeccableLiveRoot\\s*/>\\s*'
    + escapeRegExp(TANSTACK_MARKER_CLOSE)
    + '\\r?\\n?[ \\t]*',
    'g',
  );
  out = out.replace(blockRe, '');
  // Remove only the managed import line — not any following blank line.
  out = out.replace(
    new RegExp("^import ImpeccableLiveRoot from '[^']*';[ \\t]*\\r?\\n", 'gm'),
    '',
  );
  return out;
}

export function buildTanStackLiveRootComponent(port, token) {
  const liveSrc = buildLiveScriptSrc(Number(port), token);
  return `/* impeccable-live-tanstack-start */
import { useEffect } from 'react';

const LIVE_SRC = '${liveSrc}';
const LIVE_SELECTOR = 'script[data-impeccable-live-tanstack]';

// Dev-only mount for Impeccable Live. TanStack Start server-renders the root
// document, so this appends the live-mode bundle from the client after
// hydration (mirrors the Nuxt/SvelteKit adapters). Renders nothing on the
// server, so there is no hydration mismatch.
export default function ImpeccableLiveRoot() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const expected = new URL(LIVE_SRC, window.location.href).href;
    let script = document.querySelector(LIVE_SELECTOR);
    if (script && script.src === expected) return;
    if (script) script.remove();

    script = document.createElement('script');
    script.src = LIVE_SRC;
    script.async = true;
    script.setAttribute('data-impeccable-live-tanstack', '');
    script.setAttribute('data-impeccable-live-script', 'true');
    document.head.appendChild(script);

    return () => {
      if (script && script.isConnected) script.remove();
    };
  }, []);

  return null;
}
`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// The managed mount component carries the `impeccable-live-tanstack` marker in
// its leading comment and its script data-attribute; user files never do.
function isManagedComponent(content) {
  return String(content || '').includes('impeccable-live-tanstack');
}

function findRootRouteFile(cwd) {
  for (const rel of ROOT_ROUTE_CANDIDATES) {
    if (fs.existsSync(path.join(cwd, rel))) return rel;
  }
  return null;
}

function packageHasTanStackStart(cwd) {
  const file = path.join(cwd, 'package.json');
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    return START_PACKAGES.some((name) => Boolean(deps[name]));
  } catch {
    return false;
  }
}

function relativeImportSpecifier(fromFile, toFile) {
  const rel = path.posix.relative(
    path.posix.dirname(fromFile.split(path.sep).join('/')),
    toFile.split(path.sep).join('/'),
  ).replace(/\.(tsx|ts|jsx|js)$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function insertAfterLastImport(content, importStatement) {
  const importRe = /^import\b[^\n]*\n/gm;
  let lastEnd = -1;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) {
    return `${importStatement}\n${content}`;
  }
  return content.slice(0, lastEnd) + importStatement + '\n' + content.slice(lastEnd);
}

function pruneEmptyDir(dir, stopDir) {
  let current = dir;
  while (current.startsWith(stopDir) && current !== stopDir) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      return;
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
