import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'nonce-runtime'; connect-src 'self'",
  );
  return response;
}
