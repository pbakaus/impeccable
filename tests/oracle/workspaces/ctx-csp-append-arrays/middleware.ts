export function middleware(req, res) {
  res.headers.set("Content-Security-Policy", "default-src 'self'");
}
