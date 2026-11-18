import fs from 'node:fs';
import { FixturePathError, resolveFixtureFile } from './fixture-path.mjs';

export function createFixtureHandler(root, { csp = false } = {}) {
  return (req, res) => {
    try {
      const [requestPath, query] = req.url.split('?');
      const file = resolveFixtureFile(root, requestPath);
      const body = fs.readFileSync(file);
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      if (csp && query === 'csp') res.setHeader('Content-Security-Policy', "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:");
      res.end(body);
    } catch (error) {
      if (error instanceof URIError) {
        res.statusCode = 400;
      } else if (error instanceof FixturePathError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error?.code)) {
        res.statusCode = 404;
      } else {
        console.error('Fixture server error:', error);
        res.statusCode = 500;
      }
      res.end();
    }
  };
}
