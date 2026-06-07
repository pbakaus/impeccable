// Inline suppression directives in source comments.
//   impeccable-disable-line [rules]        suppress findings on the same line
//   impeccable-disable-next-line [rules]   suppress findings on the next line
//   impeccable-disable [rules]             file-level, from this line onward
// "rules" is an optional comma/space separated list of rule ids; when omitted
// the directive suppresses all rules within its scope.

const DIRECTIVE_RE = /impeccable-disable(-next-line|-line)?\b\s*(.*)$/;

function parseRuleList(raw) {
  const cleaned = (raw || '')
    .replace(/\*\/\s*$/, '') // trailing block-comment close
    .replace(/--+>\s*$/, '') // trailing html-comment close
    .trim();
  const ids = cleaned.replace(/,+/g, ' ').split(/\s+/).filter(Boolean);
  return ids.length ? new Set(ids) : null; // null => all rules
}

// Returns { lineMap: Map<lineNo, Set|null>, fileFrom: Array<{from, rules}> }
function parseSuppressions(source) {
  const lines = source.split('\n');
  const lineMap = new Map();
  const fileFrom = [];
  lines.forEach((text, idx) => {
    const m = DIRECTIVE_RE.exec(text);
    if (!m) return;
    const kind = m[1] || ''; // '', '-line', '-next-line'
    const rules = parseRuleList(m[2]);
    const lineNo = idx + 1;
    if (kind === '-line') lineMap.set(lineNo, rules);
    else if (kind === '-next-line') lineMap.set(lineNo + 1, rules);
    else fileFrom.push({ from: lineNo, rules });
  });
  return { lineMap, fileFrom };
}

function isSuppressed(antipattern, line, supp) {
  const onLine = supp.lineMap.get(line);
  if (onLine !== undefined && (onLine === null || onLine.has(antipattern))) return true;
  for (const scope of supp.fileFrom) {
    if (line >= scope.from && (scope.rules === null || scope.rules.has(antipattern))) return true;
  }
  return false;
}

function applySuppressions(findings, source) {
  if (!source) return findings;
  const supp = parseSuppressions(source);
  if (supp.lineMap.size === 0 && supp.fileFrom.length === 0) return findings;
  return findings.filter(f => !isSuppressed(f.antipattern, f.line || 0, supp));
}

export { parseSuppressions, applySuppressions, isSuppressed };
