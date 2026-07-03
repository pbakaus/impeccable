import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';

describe('HTTP MCP routes', () => {
  let server: Server | undefined;
  let baseUrl = '';
  const originalKeys = process.env.IMPECCABLE_MCP_KEYS;

  beforeEach(async () => {
    process.env.IMPECCABLE_MCP_KEYS = 'test-key';
    server = createServer(createApp());
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('expected tcp server address');
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    process.env.IMPECCABLE_MCP_KEYS = originalKeys;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    server = undefined;
  });

  it('routes unauthenticated GET requests through MCP auth instead of 404', async () => {
    const root = await fetch(`${baseUrl}/`);
    expect(root.status).toBe(401);
    const mcp = await fetch(`${baseUrl}/mcp`);
    expect(mcp.status).toBe(401);
  });
});
