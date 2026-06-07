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

export {
  MANY_FILES_THRESHOLD,
  PORT_PROBE_TIMEOUT_MS,
  FRAMEWORK_HTTP_PROBE_TIMEOUT_MS,
  DEFAULT_LINE_LENGTH_MAX,
};
