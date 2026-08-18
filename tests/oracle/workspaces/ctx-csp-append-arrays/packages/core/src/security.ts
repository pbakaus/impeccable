export function buildCSPConfig(additionalScriptSrc: string[] = []) {
  return { "script-src": ["'self'", ...additionalScriptSrc] };
}
