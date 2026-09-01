/**
 * Postcondition scanner for accepted/carbonized source. The carbonize
 * contract used to exist only as prose in reference/live.md; nothing checked
 * that an accept actually left the file clean, so dead param branches,
 * preview attributes, and marker comments accumulated across sessions. This
 * scanner is the mechanical form of that contract. live-complete refuses to
 * mark a carbonize session complete while the file is dirty, and the
 * mechanical Svelte accept runs it on its own output as a self-check.
 */

// Param patterns are anchored to the exact shapes live mode writes
// (attribute-with-value / selector forms, var() references), not bare
// substrings, so user tokens that merely share the prefix cannot trip the
// completion gate.
const FORBIDDEN = [
  { marker: 'impeccable-variants-start', why: 'variant wrapper comment left in source' },
  { marker: 'impeccable-variants-end', why: 'variant wrapper comment left in source' },
  { marker: 'impeccable-carbonize-start', why: 'carbonize block not rewritten into permanent form' },
  { marker: 'impeccable-carbonize-end', why: 'carbonize block not rewritten into permanent form' },
  { marker: 'impeccable-param-values', why: 'param-values comment not baked and removed' },
  { marker: 'data-impeccable-', why: 'live-mode plumbing attribute left on markup' },
  { marker: /\bdata-p-[A-Za-z0-9_-]+\s*(?:=|\])/, label: 'data-p-*', why: 'preview parameter attribute left on markup' },
  { marker: /var\(\s*--p-[A-Za-z0-9_-]+\s*[,)]/, label: 'var(--p-*)', why: 'preview parameter variable not baked to a literal' },
  { marker: '--impeccable-variant-ready', why: 'preview readiness sentinel left in CSS' },
];

/**
 * Scan file text for live-mode leftovers. Returns { clean, findings } where
 * each finding is { marker, line, excerpt, why }.
 */
export function verifyAcceptedSource(text) {
  const findings = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { marker, label, why } of FORBIDDEN) {
      const hit = marker instanceof RegExp ? marker.test(line) : line.includes(marker);
      if (hit) {
        findings.push({
          marker: label || String(marker),
          line: i + 1,
          excerpt: line.trim().slice(0, 120),
          why,
        });
      }
    }
  }
  return { clean: findings.length === 0, findings };
}

/** Convenience wrapper for CLI callers: read + scan, tolerating a missing file. */
export function verifyAcceptedFile(fs, filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { clean: true, findings: [], missing: true };
  }
  return { ...verifyAcceptedSource(text), missing: false };
}
