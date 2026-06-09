import fs from 'node:fs';
import path from 'node:path';

// Serve the same vendored modern-screenshot UMD build the live server hands to
// the injected overlay (skill/scripts/live-server.mjs -> /modern-screenshot.js).
// Reading it straight off disk keeps the shader lab in lockstep with what live
// mode actually runs, with no committed copy to drift.
const VENDOR_PATH = path.join(process.cwd(), 'skill', 'scripts', 'modern-screenshot.umd.js');

export function GET() {
  return new Response(fs.readFileSync(VENDOR_PATH, 'utf-8'), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
