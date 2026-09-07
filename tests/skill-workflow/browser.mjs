import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { sourceHash as hashSources } from './source-hash.mjs';
import { chromium } from 'playwright';
import { tool } from 'ai';
import { z } from 'zod';

const VIEWPORTS = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function resolveFile(root, name) {
  if (path.isAbsolute(name)) throw new Error('Use a workspace-relative path');
  const file = path.resolve(root, name);
  const rel = path.relative(root, file);
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('Path escapes workspace');
  const real = fs.realpathSync(file);
  const realRel = path.relative(fs.realpathSync(root), real);
  if (realRel === '..' || realRel.startsWith(`..${path.sep}`)) throw new Error('Path escapes workspace through a symlink');
  return real;
}

export function imageOutput({ output }) {
  const { image, ...metadata } = output;
  return { type: 'content', value: [
    { type: 'text', text: JSON.stringify(metadata) },
    { type: 'file', mediaType: 'image/png', data: { type: 'data', data: image } },
  ] };
}

/** Preflight before any billed call; no runtime installs or browser discovery. */
export async function prepareBrowser(root) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
  } catch (error) {
    throw new Error('Workflow browser preflight failed. Run `bunx playwright install chromium` before billed tests.', { cause: error });
  }
  const blockedRequests = [];
  const server = http.createServer((req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      if (name.split('/').some((part) => part.startsWith('.'))) throw new Error('Private workspace path');
      const file = resolveFile(root, name);
      if (!fs.statSync(file).isFile()) throw new Error('Not a file');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 403);
      res.end('Not available');
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) {
    await browser.close();
    throw error;
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (new URL(url).origin === origin || url.startsWith('data:')) return route.continue();
      blockedRequests.push(url);
      return route.abort();
    });
  } catch (error) {
    await browser.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    throw error;
  }
  return {
    origin, blockedRequests,
    environment: `Workspace: ${root}. A local server and Chromium are already running. browser_snapshot renders a workspace-relative HTML path at desktop/mobile size, saves a screenshot, and returns the actual image plus DOM text. view_image opens saved PNGs. No browser installation is needed. External browser requests are blocked; this text-only fixture uses system fonts. No image-generation or subagent tools are available.`,
    tools(trace) {
      return {
        browser_snapshot: tool({
          description: 'Render and inspect an HTML file with the ready Chromium browser. Returns an actual screenshot and visible DOM text; optionally click a CSS selector before capture. Captures save to .impeccable/review/{desktop|mobile}.png.',
          inputSchema: z.object({ path: z.string(), viewport: z.enum(['desktop', 'mobile']), click: z.string().optional() }),
          execute: async ({ path: target, viewport, click }) => {
            const file = resolveFile(root, target);
            if (!/\.html?$/i.test(file)) throw new Error('Expected an HTML artifact');
            const relativeTarget = path.relative(fs.realpathSync(root), file).split(path.sep).join('/');
            const call = { name: 'browser_snapshot', input: { path: target, viewport, click }, mutatedPaths: [] };
            trace.toolCalls.push(call);
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            try {
              const sourceHash = hashSources(root);
              await page.setViewportSize(VIEWPORTS[viewport]);
              await page.goto(`${origin}/${relativeTarget.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load', timeout: 15000 });
              await page.evaluate(() => document.fonts.ready);
              if (click) await page.locator(click).click();
              const screenshot = `.impeccable/review/${viewport}.png`;
              if (fs.existsSync(path.join(root, '.impeccable'))) resolveFile(root, '.impeccable');
              fs.mkdirSync(path.join(root, '.impeccable/review'), { recursive: true });
              resolveFile(root, '.impeccable/review');
              if (fs.existsSync(path.join(root, screenshot))) resolveFile(root, screenshot);
              const image = await page.screenshot({ path: path.join(root, screenshot), fullPage: true, animations: 'disabled' });
              call.mutatedPaths = [screenshot];
              if (sourceHash !== hashSources(root)) throw new Error('Artifact changed during capture; retry');
              call.capture = { target: relativeTarget, viewport, screenshot, sourceHash };
              return { ...call.capture, text: (await page.locator('body').innerText()).slice(0, 12000), image: image.toString('base64') };
            } finally {
              await page.close();
            }
          },
          toModelOutput: imageOutput,
        }),
        view_image: tool({
          description: 'Inspect an existing workspace PNG as an actual image, not raw file bytes.',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path: name }) => {
            const bytes = fs.readFileSync(resolveFile(root, name));
            if (!bytes.subarray(0, 8).equals(PNG)) throw new Error('Expected a PNG image');
            trace.toolCalls.push({ name: 'view_image', input: { path: name }, mutatedPaths: [], loadedImages: [name] });
            return { path: name, image: bytes.toString('base64') };
          },
          toModelOutput: imageOutput,
        }),
      };
    },
    async close() {
      await browser.close();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}
