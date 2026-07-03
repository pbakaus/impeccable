import express from 'express';
import helmet from 'helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { healthPayload } from '../health.js';
import { createMcpServer } from '../mcp/server.js';
import { requireMcpKey } from '../security/auth.js';

const MCP_REQUEST_TIMEOUT_MS = 30_000;

async function handleMcpRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  let closed = false;
  const closeRuntime = (reason: string) => {
    if (closed) return;
    closed = true;
    transport.close().catch((error: unknown) => console.error(`transport close failed after ${reason}`, error));
    server.close().catch((error: unknown) => console.error(`server close failed after ${reason}`, error));
  };
  const timeout = setTimeout(() => {
    closeRuntime('timeout');
    if (!res.headersSent) {
      res.status(504).json({ error: 'mcp_request_timeout' });
    } else {
      res.end();
    }
  }, MCP_REQUEST_TIMEOUT_MS);
  timeout.unref();
  res.on('close', () => {
    clearTimeout(timeout);
    closeRuntime('response close');
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error(error);
    }
  } finally {
    clearTimeout(timeout);
    closeRuntime('request complete');
  }
}

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (_req, res, next) => {
    try {
      res.json(await healthPayload());
    } catch (error) {
      next(error);
    }
  });

  app.get(['/', '/mcp'], requireMcpKey, handleMcpRequest);
  app.post(['/', '/mcp'], requireMcpKey, handleMcpRequest);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
