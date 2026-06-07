// Centralized numeric thresholds. These were previously inline magic numbers
// scattered across the CLI and node helpers. Keeping them here makes the
// scan's behavior tunable and self-documenting.

// Interactive scans warn + confirm above this many files in a directory.
const MANY_FILES_THRESHOLD = 50;

// Plain TCP "is anything listening" probe timeout (framework dev-server hint).
const PORT_PROBE_TIMEOUT_MS = 500;

// HTTP fingerprint probe timeout when confirming a framework dev server.
const FRAMEWORK_HTTP_PROBE_TIMEOUT_MS = 2000;

// Default max line length for the long-line readability check when no
// __IMPECCABLE_CONFIG__.lineLengthMax override is present.
const DEFAULT_LINE_LENGTH_MAX = 80;

// Side-tab / border-accent rule: a colored side border counts as an accent
// stripe at >= 2px (with a border-radius present), and is "strong" enough to
// flag on its own (no radius required) at >= 3px. These two values are the
// canonical side-tab thresholds documented in shared/constants.mjs and are the
// numbers the static-HTML and regex engines share. (The regex engine also uses
// coarser radius-aware variants it owns locally.)
const BORDER_ACCENT_MIN_WIDTH_PX = 2;
const BORDER_ACCENT_STRONG_WIDTH_PX = 3;

export {
  MANY_FILES_THRESHOLD,
  PORT_PROBE_TIMEOUT_MS,
  FRAMEWORK_HTTP_PROBE_TIMEOUT_MS,
  DEFAULT_LINE_LENGTH_MAX,
  BORDER_ACCENT_MIN_WIDTH_PX,
  BORDER_ACCENT_STRONG_WIDTH_PX,
};
