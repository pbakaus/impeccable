/**
 * Schema versions for the artifacts Impeccable writes, plus the readers and
 * writers for the PRODUCT.md provenance stamp.
 *
 * Why schema versions rather than the skill version: a PRODUCT.md written by
 * v4.0.0 is not stale under v4.0.1, so stamping the release version would make
 * every artifact "old" on every patch. A schema version changes only when the
 * shape changes, which is exactly when a migration is owed. It also gives the
 * writing flows a literal constant to copy instead of a value they would have
 * to look up.
 *
 * DESIGN.md deliberately carries no stamp. It follows the external
 * design.md spec that Stitch's linter validates, and an extra frontmatter key
 * risks failing that lint for no gain: every DESIGN.md staleness signal
 * (sidecar schema version, sidecar mtime, section coverage, git drift) is
 * measurable without one.
 */

/** PRODUCT.md as init.md writes it today: the ten-section v4 record. */
export const PRODUCT_SCHEMA_VERSION = 1;

/** `.impeccable/design.json`, as documented in reference/document.md Step 4b. */
export const DESIGN_SIDECAR_SCHEMA_VERSION = 2;

/**
 * Sections init.md added in v4. A PRODUCT.md carrying none of them, and no
 * stamp, predates the current record. Used only as a fallback: an explicit
 * stamp always wins.
 */
export const PRODUCT_V4_SECTIONS = Object.freeze([
  'Positioning',
  'Operating Context',
  'Evidence on Hand',
  'Product Principles',
]);

/**
 * Headings Impeccable used to read and no longer does, with the reason. The
 * agent needs the reason: told only that a field is deprecated it tends to
 * preserve it "just in case", which is how a v3 register value keeps steering
 * v4 output.
 */
export const PRODUCT_DEPRECATED_SECTIONS = Object.freeze({
  Register: 'v4 replaced the brand/product register axis with the four visitor modes '
    + '(Persuade, Operate, Read, Experience), which are chosen per surface and persisted in that '
    + "surface's brief. Nothing reads `## Register` any more.",
});

const PRODUCT_STAMP_RE = /^[ \t]*<!--[ \t]*impeccable:product-schema[ \t]+(\d+)[ \t]*-->[ \t]*$/im;

/** The literal stamp line, for the init template and for migrations. */
export function productStampLine(version = PRODUCT_SCHEMA_VERSION) {
  return `<!-- impeccable:product-schema ${version} -->`;
}

/**
 * Schema version stamped in a PRODUCT.md body, or null when unstamped. Null
 * means "written before stamping existed", not "invalid".
 */
export function readProductSchemaVersion(markdown) {
  const match = String(markdown || '').match(PRODUCT_STAMP_RE);
  if (!match) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isInteger(version) ? version : null;
}

/**
 * Add or update the stamp, returning the new body. Idempotent. A stamped file
 * keeps the stamp where it already sits so a migration never reorders the
 * user's prose; an unstamped file gets it directly under the leading `#`
 * heading, or at the top when there is none.
 */
export function stampProductSchema(markdown, version = PRODUCT_SCHEMA_VERSION) {
  const body = String(markdown || '');
  const line = productStampLine(version);
  if (PRODUCT_STAMP_RE.test(body)) return body.replace(PRODUCT_STAMP_RE, line);

  const lines = body.split('\n');
  const headingIndex = lines.findIndex((entry) => /^#\s+\S/.test(entry));
  if (headingIndex === -1) return `${line}\n\n${body.replace(/^\n+/, '')}`;
  lines.splice(headingIndex + 1, 0, '', line);
  return lines.join('\n');
}

/**
 * Schema version of a parsed design.json. Returns null for a missing or
 * non-numeric field, which is how schemaVersion-1-era sidecars present
 * (the field predates the v2 rewrite in some files).
 */
export function readSidecarSchemaVersion(sidecar) {
  const version = sidecar && typeof sidecar === 'object' ? sidecar.schemaVersion : null;
  return Number.isInteger(version) ? version : null;
}
