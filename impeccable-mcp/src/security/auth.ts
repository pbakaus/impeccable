import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function configuredKeys(): string[] {
  return (process.env.IMPECCABLE_MCP_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function headerValue(headers: { [key: string]: string | string[] | undefined }, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function secretEquals(left: string, right: string | undefined): boolean {
  if (!right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorized(headers: { [key: string]: string | string[] | undefined }): boolean {
  const keys = configuredKeys();
  if (keys.length === 0) return true;
  const candidates = [
    headerValue(headers, 'x-impeccable-mcp-key'),
    bearerToken(headerValue(headers, 'authorization')),
  ];
  return candidates.some((candidate) => keys.some((key) => secretEquals(key, candidate)));
}

export function requireMcpKey(req: Request, res: Response, next: NextFunction): void {
  if (isAuthorized(req.headers)) {
    next();
    return;
  }
  res.status(401).json({ error: 'missing_or_invalid_impeccable_mcp_key' });
}
