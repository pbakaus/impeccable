/**
 * Inline, in-file ignore directives — eslint-disable-style waivers that live at
 * the point they apply and travel with the artifact instead of (or alongside)
 * an ignore in `.impeccable/config.json`.
 *
 * A config ignore is the right default for repo-wide policy. This complements it
 * for the one case config can't cover: a waiver that belongs to a single file and
 * needs to follow that file when it leaves the repo — a generated/exported
 * standalone document, an emailed HTML file, a snippet scanned out of context.
 *
 * Comment-syntax-agnostic: the directive is a raw token matched anywhere on a
 * line, so the same marker works across every comment style impeccable scans —
 * `//`, `/* *\/`, `<!-- -->`, `#`, `{/* *\/}`, `{# #}`. Trailing comment closers
 * are stripped before the rule list is parsed.
 *
 * Syntax (reason optional; eslint `--` or biome `:` separator):
 *
 *   impeccable-disable <rule>[, <rule>...] [-- reason]   whole file
 *   impeccable-disable-line <rule>...      [-- reason]   the same line
 *   impeccable-disable-next-line <rule>... [-- reason]   the following line
 *   impeccable-disable                                   bare / `*` = every rule
 *
 * Examples:
 *
 *   <!-- impeccable-disable overused-font -- exported brand doc, font is first-party -->
 *   .brand { font-family: Inter; } /* impeccable-disable-line overused-font *\/
 *   // impeccable-disable-next-line bounce-easing: intentional playful affordance
 *
 * Behavior is suppression, for parity with config ignores: a matched directive
 * drops the finding. The inline reason is self-documenting in the diff; it is not
 * required and is discarded at scan time (only used here to keep reason words out
 * of the parsed rule list).
 */

const DIRECTIVE_RE = /impeccable-(disable-next-line|disable-line|disable)\b[ \t]*([^\n\r]*)/gi;

// Trailing comment closers, so `*/`, `*/}`, `-->`, `*}`, `#}`, `%>`, `}}` don't
// leak into the rule list. Anchored to end-of-line; the leading `\s*` mops up the
// space before the closer. `--+>` covers `-->` and any longer dash run.
const TRAILING_CLOSER_RE = /\s*(?:\*\/\}?|--+>|\*\}|#\}|%>|\}\})\s*$/;

function normalizeRule(token) {
  return String(token || '').trim().toLowerCase();
}

// Split the directive remainder into rule tokens, dropping any human reason that
// follows an eslint-style `--` or biome-style `:` separator. Rule ids only ever
// contain single hyphens (`overused-font`, `bounce-easing`), so `--` and `:`
// are unambiguous separators.
function parseRuleList(remainder) {
  let text = String(remainder || '').replace(TRAILING_CLOSER_RE, '').trim();
  // Cut off a human reason at the first `--` (eslint) or `:` (biome) separator.
  const reasonSep = text.match(/\s*(?:--+|:)\s*/);
  if (reasonSep) text = text.slice(0, reasonSep.index);
  const tokens = text.split(/[\s,]+/).map(normalizeRule).filter(Boolean);
  if (tokens.length === 0 || tokens.includes('*')) return ['*'];
  return tokens;
}

function addRules(set, rules) {
  for (const rule of rules) set.add(rule);
}

function getSet(map, key) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

/**
 * Parse every inline ignore directive in a file's raw text.
 *
 * Returns sets keyed by the 1-based line the directive *targets* so matching is a
 * direct lookup:
 *   - file:     rules disabled for the whole file
 *   - line:     line -> rules disabled on that exact line (disable-line)
 *   - nextLine: line -> rules disabled on that line (disable-next-line on line-1)
 *
 * `*` in any set means "every rule".
 */
function parseInlineIgnores(content) {
  const result = { file: new Set(), line: new Map(), nextLine: new Map() };
  const text = typeof content === 'string' ? content : '';
  // Cheap bail-out: the substring must be present for any directive to exist.
  // Case-insensitive to match DIRECTIVE_RE's `i` flag (e.g. `Impeccable-Disable`).
  if (!/impeccable-disable/i.test(text)) return result;

  // Split on `\n` only, exactly as detectText numbers lines, so directive line
  // keys line up with finding `line` values (incl. on `\r`-only line endings).
  // The directive regex excludes `\r`, so a trailing `\r` on `\r\n` files is
  // never captured into the rule list.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    DIRECTIVE_RE.lastIndex = 0;
    let m;
    while ((m = DIRECTIVE_RE.exec(lines[i])) !== null) {
      const variant = m[1].toLowerCase();
      const rules = parseRuleList(m[2]);
      if (variant === 'disable') {
        addRules(result.file, rules);
      } else if (variant === 'disable-line') {
        addRules(getSet(result.line, i + 1), rules);
      } else {
        // disable-next-line on line i+1 targets line i+2.
        addRules(getSet(result.nextLine, i + 2), rules);
      }
    }
  }
  return result;
}

function setMatches(set, rule) {
  return Boolean(set) && (set.has('*') || set.has(rule));
}

function isInlineIgnored(finding, directives) {
  const rule = normalizeRule(finding && finding.antipattern);
  if (!rule) return false;
  if (setMatches(directives.file, rule)) return true;
  const line = Number(finding && finding.line) || 0;
  if (line > 0) {
    if (setMatches(directives.line.get(line), rule)) return true;
    if (setMatches(directives.nextLine.get(line), rule)) return true;
  }
  return false;
}

function hasDirectives(directives) {
  return directives.file.size > 0 || directives.line.size > 0 || directives.nextLine.size > 0;
}

/**
 * Drop findings waived by an inline directive in the same file's source text.
 * Findings without a usable line number (e.g. static-HTML page-level findings)
 * are only matched by whole-file directives — which is the standalone-document
 * case this primitive exists for.
 */
function applyInlineIgnores(findings, content) {
  if (!Array.isArray(findings) || findings.length === 0) return findings;
  const directives = parseInlineIgnores(content);
  if (!hasDirectives(directives)) return findings;
  return findings.filter((finding) => !isInlineIgnored(finding, directives));
}

export { parseInlineIgnores, applyInlineIgnores, isInlineIgnored };
