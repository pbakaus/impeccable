import { getAntipattern } from './registry/antipatterns.mjs';

function getAP(id) {
  return getAntipattern(id);
}

function finding(id, filePath, snippet, line = 0, engine = undefined) {
  const ap = getAP(id);
  return {
    antipattern: id,
    name: ap.name,
    description: ap.description,
    severity: ap.severity || 'warning',
    category: ap.category,
    ...(engine ? { engine } : {}),
    file: filePath,
    line,
    snippet,
  };
}

export { getAP, finding };
