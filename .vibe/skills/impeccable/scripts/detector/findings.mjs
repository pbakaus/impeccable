import { getAntipattern } from './registry/antipatterns.mjs';

function getAP(id) {
  return getAntipattern(id);
}

function deriveAdvisoryFlag(item) {
  if (item.severity === 'advisory') item.advisory = true;
  else delete item.advisory;
  return item;
}

function finding(id, filePath, snippet, line = 0) {
  const ap = getAP(id);
  const base = { antipattern: id, name: ap.name, description: ap.description, severity: ap.severity || 'warning', category: ap.category || null, file: filePath, line, snippet };
  // Advisory findings are detected but reported separately and never counted as
  // failures. Carry the flag on the finding so every consumer (CLI, JSON, hook)
  // can partition without a registry lookup. Only stamped when true to keep the
  // finding shape stable for the vast majority of rules.
  return deriveAdvisoryFlag(base);
}

export { getAP, finding, deriveAdvisoryFlag };
