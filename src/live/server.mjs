/**
 * Live variant mode server.
 *
 * Serves the browser script (/live.js), the detection overlay (/detect.js),
 * manages a WebSocket connection to the browser, and exposes HTTP long-poll
 * endpoints so the agent CLI can receive events and send replies.
 *
 * Start:  npx impeccable live
 * Stop:   npx impeccable live stop
 * Health: curl http://localhost:PORT/health
 */

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { validateEvent } from './protocol.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_PID_FILE = path.join(os.tmpdir(), 'impeccable-live.json');
const DEFAULT_POLL_TIMEOUT = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// Port detection
// ---------------------------------------------------------------------------

async function findOpenPort(start = 8400) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => resolve(findOpenPort(start + 1)));
  });
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const state = {
  token: null,
  port: null,
  wsClients: new Set(),
  // Queue: browser events waiting for the agent to poll
  pendingEvents: [],
  // Queue: agent poll response callbacks waiting for browser events
  pendingPolls: [],
  // Debounce timer for exit event (avoids false exits on transient disconnects)
  exitTimer: null,
};

/** Push an event from the browser into the queue or resolve a waiting poll. */
function enqueueEvent(event) {
  if (state.pendingPolls.length > 0) {
    const resolve = state.pendingPolls.shift();
    resolve(event);
  } else {
    state.pendingEvents.push(event);
  }
}

/** Broadcast a message to all authenticated WS clients. */
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of state.wsClients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(data);
    }
  }
}

// ---------------------------------------------------------------------------
// Load scripts
// ---------------------------------------------------------------------------

function loadBrowserScripts() {
  const detectPath = path.join(__dirname, '..', 'detect-antipatterns-browser.js');
  const livePath = path.join(__dirname, 'browser.js');

  let detectScript = '';
  try {
    detectScript = fs.readFileSync(detectPath, 'utf-8');
  } catch {
    // Detection script is optional for the live variant server
  }

  let liveScript = '';
  try {
    liveScript = fs.readFileSync(livePath, 'utf-8');
  } catch {
    process.stderr.write('Error: Browser live script not found at ' + livePath + '\n');
    process.exit(1);
  }

  return { detectScript, liveScript };
}

// ---------------------------------------------------------------------------
// Check for .impeccable.md
// ---------------------------------------------------------------------------

function hasProjectContext() {
  try {
    fs.accessSync(path.join(process.cwd(), '.impeccable.md'), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTTP request handler
// ---------------------------------------------------------------------------

function createRequestHandler({ detectScript, liveScriptWithToken }) {
  return (req, res) => {
    const url = new URL(req.url, `http://localhost:${state.port}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const pathname = url.pathname;

    // --- Public endpoints (no auth) ---

    if (pathname === '/live.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(liveScriptWithToken);
      return;
    }

    if (pathname === '/detect.js' || pathname === '/') {
      if (!detectScript) {
        res.writeHead(404);
        res.end('Detection script not available. Run npm run build:browser first.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(detectScript);
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        port: state.port,
        mode: 'variant',
        hasProjectContext: hasProjectContext(),
        connectedClients: state.wsClients.size,
      }));
      return;
    }

    // --- Authenticated endpoints ---

    const token = url.searchParams.get('token');

    if (pathname === '/stop') {
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('stopping');
      shutdown();
      return;
    }

    if (pathname === '/poll') {
      if (req.method === 'GET') {
        handlePollGet(req, res, url);
      } else if (req.method === 'POST') {
        handlePollPost(req, res);
      } else {
        res.writeHead(405);
        res.end('Method not allowed');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };
}

// ---------------------------------------------------------------------------
// Poll endpoints
// ---------------------------------------------------------------------------

/** GET /poll — agent blocks here until a browser event arrives. */
function handlePollGet(req, res, url) {
  const token = url.searchParams.get('token');
  if (token !== state.token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const timeout = parseInt(url.searchParams.get('timeout') || DEFAULT_POLL_TIMEOUT, 10);

  // If there's already an event queued, return it immediately
  if (state.pendingEvents.length > 0) {
    const event = state.pendingEvents.shift();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(event));
    return;
  }

  // Otherwise, wait for one
  const timer = setTimeout(() => {
    // Remove this callback from pendingPolls
    const idx = state.pendingPolls.indexOf(resolve);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'timeout' }));
  }, timeout);

  function resolve(event) {
    clearTimeout(timer);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(event));
  }

  state.pendingPolls.push(resolve);

  // Clean up if the agent disconnects before we respond
  req.on('close', () => {
    clearTimeout(timer);
    const idx = state.pendingPolls.indexOf(resolve);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
  });
}

/** POST /poll — agent replies to a pending browser event. */
function handlePollPost(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (msg.token !== state.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Forward the reply to the browser
    broadcast({
      type: msg.type || 'done',
      id: msg.id,
      message: msg.message,
      data: msg.data,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let authenticated = false;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      // First message must be auth
      if (!authenticated) {
        if (msg.type === 'auth' && msg.token === state.token) {
          authenticated = true;
          state.wsClients.add(ws);
          // Cancel any pending exit timer (client reconnected)
          clearTimeout(state.exitTimer);
          ws.send(JSON.stringify({
            type: 'auth_ok',
            hasProjectContext: hasProjectContext(),
          }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }));
          ws.close();
        }
        return;
      }

      // Validated browser events go to the agent poll queue
      const error = validateEvent(msg);
      if (error) {
        ws.send(JSON.stringify({ type: 'error', message: error }));
        return;
      }

      enqueueEvent(msg);
    });

    ws.on('close', () => {
      state.wsClients.delete(ws);
      // If all browser clients disconnected, debounce before signaling exit.
      // The browser script reconnects within 3s, and HMR page reloads cause
      // brief disconnects. Wait 8s to avoid false exits.
      if (authenticated && state.wsClients.size === 0) {
        clearTimeout(state.exitTimer);
        state.exitTimer = setTimeout(() => {
          if (state.wsClients.size === 0) {
            enqueueEvent({ type: 'exit' });
          }
        }, 8000);
      }
    });

    ws.on('error', () => {
      state.wsClients.delete(ws);
    });
  });

  return wss;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let httpServer = null;
let wss = null;

function shutdown() {
  try { fs.unlinkSync(LIVE_PID_FILE); } catch { /* ignore */ }
  // Close all WebSocket connections
  for (const ws of state.wsClients) {
    try { ws.close(); } catch { /* ignore */ }
  }
  state.wsClients.clear();
  // Resolve any pending polls with exit
  for (const resolve of state.pendingPolls) {
    resolve({ type: 'exit' });
  }
  state.pendingPolls.length = 0;
  if (wss) { try { wss.close(); } catch { /* ignore */ } }
  if (httpServer) { httpServer.close(); }
  process.exit(0);
}

/**
 * Start the live variant server.
 * Called from liveCli() in detect-antipatterns.mjs.
 */
export async function startLiveServer({ port: requestedPort } = {}) {
  const args = process.argv.slice(2);
  const helpMode = args.includes('--help');
  const stopMode = args.includes('stop');
  const portArg = args.find(a => a.startsWith('--port='));
  const parsedPort = portArg ? parseInt(portArg.split('=')[1], 10) : null;

  if (helpMode) {
    console.log(`Usage: impeccable live [options]

Start the live variant mode server. Serves the browser overlay script and
bridges WebSocket connections from the browser to the agent poll CLI.

Commands:
  live          Start the server (default)
  live stop     Stop a running live server

Options:
  --port=PORT   Use a specific port (default: auto-detect starting at 8400)
  --help        Show this help message

Endpoints:
  /live.js      Browser script for element picker + variant cycling
  /detect.js    Detection overlay script (backwards compatible)
  /health       Health check
  /ws           WebSocket endpoint for browser
  /poll         Long-poll endpoint for agent CLI`);
    process.exit(0);
  }

  // Stop mode
  if (stopMode) {
    try {
      const info = JSON.parse(fs.readFileSync(LIVE_PID_FILE, 'utf-8'));
      const res = await fetch(`http://localhost:${info.port}/stop?token=${info.token}`);
      if (res.ok) {
        console.log(`Stopped live server on port ${info.port}.`);
      }
    } catch {
      console.log('No running live server found.');
    }
    process.exit(0);
  }

  // Check for existing session
  try {
    const existing = JSON.parse(fs.readFileSync(LIVE_PID_FILE, 'utf-8'));
    // Check if the process is actually running
    try {
      process.kill(existing.pid, 0);
      console.error(`Live server already running on port ${existing.port} (pid ${existing.pid}).`);
      console.error('Stop it first: npx impeccable live stop');
      process.exit(1);
    } catch {
      // Process is dead, clean up stale PID file
      fs.unlinkSync(LIVE_PID_FILE);
    }
  } catch {
    // No PID file — good
  }

  // Generate session token
  state.token = randomUUID();
  state.port = requestedPort || parsedPort || await findOpenPort();

  // Load scripts
  const { detectScript, liveScript } = loadBrowserScripts();

  // Inject token and port into the live browser script
  const liveScriptWithToken =
    `window.__IMPECCABLE_TOKEN__ = '${state.token}';\n` +
    `window.__IMPECCABLE_PORT__ = ${state.port};\n` +
    liveScript;

  // Create HTTP server
  httpServer = http.createServer(createRequestHandler({ detectScript, liveScriptWithToken }));

  // Attach WebSocket
  wss = setupWebSocket(httpServer);

  // Start listening
  httpServer.listen(state.port, '127.0.0.1', () => {
    // Write PID file with token so poll CLI can authenticate
    fs.writeFileSync(LIVE_PID_FILE, JSON.stringify({
      pid: process.pid,
      port: state.port,
      token: state.token,
    }));

    const url = `http://localhost:${state.port}`;
    console.log(`\nImpeccable live variant server running on ${url}`);
    console.log(`Token: ${state.token}\n`);
    console.log(`Inject into your page source:`);
    console.log(`  <script src="${url}/live.js"><\/script>\n`);
    console.log(`Or inject via browser console:`);
    console.log(`  const s = document.createElement('script');`);
    console.log(`  s.src = '${url}/live.js';`);
    console.log(`  document.head.appendChild(s);\n`);
    console.log(`Agent poll: npx impeccable poll`);
    console.log(`Stop:       npx impeccable live stop`);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
