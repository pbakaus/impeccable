import path from 'node:path';

// SARIF 2.1.0 output for findings, suitable for GitHub code scanning upload.

const LEVEL_BY_SEVERITY = { error: 'error', warning: 'warning', advisory: 'note', note: 'note' };

function relUri(file, rootDir) {
  if (!file || file === '<stdin>') return file || '';
  const rel = rootDir ? path.relative(rootDir, file) : file;
  return rel.split(path.sep).join('/');
}

function toSarif(findings, { version = '0.0.0', rootDir = process.cwd() } = {}) {
  const ruleMap = new Map();
  const results = [];
  for (const f of findings) {
    if (!ruleMap.has(f.antipattern)) {
      ruleMap.set(f.antipattern, {
        id: f.antipattern,
        name: f.name || f.antipattern,
        shortDescription: { text: f.name || f.antipattern },
        fullDescription: { text: f.description || '' },
        defaultConfiguration: { level: LEVEL_BY_SEVERITY[f.severity] || 'warning' },
        properties: { category: f.category, engine: f.engine },
      });
    }
    results.push({
      ruleId: f.antipattern,
      level: LEVEL_BY_SEVERITY[f.severity] || 'warning',
      message: { text: f.snippet ? `${f.description} (near: ${f.snippet})` : f.description },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: relUri(f.file, rootDir) },
          region: { startLine: f.line && f.line > 0 ? f.line : 1 },
        },
      }],
    });
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'impeccable',
          informationUri: 'https://impeccable.style',
          version,
          rules: [...ruleMap.values()],
        },
      },
      results,
    }],
  };
}

export { toSarif, LEVEL_BY_SEVERITY };
