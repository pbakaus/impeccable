import type { Request, Response, NextFunction } from 'express';

export function configuredKeys(): string[] {
  return (process.env.IMPECCABLE_MCP_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function isAuthorized(headers: { [key: string]: string | string[] | undefined }): boolean {
  const keys = configuredKeys();
  if (keys.length === 0) return true;
  const header = headers['x-impeccable-mcp-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return Boolean(value && keys.includes(value));
}

export function requireMcpKey(req: Request, res: Response, next: NextFunction): void {
  if (isAuthorized(req.headers)) {
    next();
    return;
  }
  res.status(401).json({ error: 'missing_or_invalid_impeccable_mcp_key' });
}
