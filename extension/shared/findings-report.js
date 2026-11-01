// Shared by the popup and DevTools. Page URLs come from the caller.
globalThis.ImpeccableReport = (() => {
  const CATEGORY_LABELS = { slop: 'AI tells', quality: 'Quality issues', advisory: 'Advisories' };

  function isAdvisory(finding) {
    return finding.severity === 'advisory' || finding.advisory === true;
  }

  function presentationCategory(finding) {
    if (isAdvisory(finding)) return 'advisory';
    return finding.category === 'slop' ? 'slop' : 'quality';
  }

  // Maps each anti-pattern to the most relevant Impeccable skill(s) for fixing it.
  // These are suggestions; the user decides whether and how to apply them.
  const FIX_SKILLS = {
    // AI slop
    'side-tab':                'distill, polish',
    'border-accent-on-rounded':'distill, polish',
    'overused-font':           'typeset',
    'flat-type-hierarchy':     'typeset',
    'gradient-text':           'typeset, distill',
    'ai-color-palette':        'colorize, distill',
    'nested-cards':            'distill, arrange',
    'monotonous-spacing':      'arrange',
    'everything-centered':     'arrange',
    'bounce-easing':           'animate',
    'dark-glow':               'quieter, distill',
    'icon-tile-stacked-above-heading': 'distill, arrange',
    // Quality
    'pure-black-white':        'colorize',
    'gray-on-color':           'colorize',
    'low-contrast':            'colorize, audit',
    'line-length':             'arrange, typeset',
    'cramped-padding':         'arrange, polish',
    'tight-leading':           'typeset',
    'skipped-heading':         'audit, harden',
    'justified-text':          'typeset',
    'straggler':               'typeset',
    'unbalanced-heading':      'typeset',
    'tiny-text':               'typeset',
    'all-caps-body':           'typeset',
    'wide-tracking':           'typeset',
  };

  function fixSkillFor(finding) {
    const skills = FIX_SKILLS[finding.type] || (isAdvisory(finding) ? '' : 'polish');
    if (!skills) return '';
    // Prefix each comma-separated skill with a slash for clarity
    return skills.split(',').map(s => '/' + s.trim()).join(', ');
  }

  // Returns a sorted array of unique skills referenced by the given findings,
  // most-frequent first. Each entry already has the leading slash.
  function uniqueSkillsForFindings(findings) {
    const counts = new Map();
    for (const item of findings) {
      for (const f of item.findings) {
        const skills = fixSkillFor(f);
        if (!skills) continue;
        const list = skills.split(', ');
        for (const s of list) {
          counts.set(s, (counts.get(s) || 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }

  function formatFindingsForCopy(findings, pageUrl = '') {
    const url = pageUrl.split('#')[0];
    const lines = ['# Impeccable findings'];
    const count = findings.reduce((sum, item) => sum + item.findings.length, 0);
    if (url) lines.push(`URL: ${url}`);
    lines.push(`Total findings: ${count}`);
    lines.push('');
    if (!count) {
      lines.push('Impeccable found no anti-patterns on this page.');
      return lines.join('\n');
    }

    const groups = { slop: [], quality: [], advisory: [] };
    for (const item of findings) {
      for (const f of item.findings) {
        const cat = presentationCategory(f);
        groups[cat].push({ ...f, selector: item.selector, isPageLevel: item.isPageLevel });
      }
    }

    for (const [category, findings] of Object.entries(groups)) {
      if (!findings.length) continue;
      lines.push(`## ${CATEGORY_LABELS[category]} (${findings.length})`);
      for (const f of findings) {
        const where = f.isPageLevel ? '_(page-level)_' : `\`${f.selector}\``;
        lines.push(`- **${f.name}** at ${where}: ${f.detail}`);
      }
      lines.push('');
    }

    // Roll up suggested skills across all findings (most-relevant first)
    const skills = uniqueSkillsForFindings(findings);
    if (skills.length) {
      lines.push(`Suggested Impeccable skills to fix: ${skills.join(', ')}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('Detected by [Impeccable](https://impeccable.style). Skills are suggestions, not required.');
    return lines.join('\n');
  }

  function formatSingleFindingForCopy(item, finding, pageUrl = '') {
    const url = pageUrl.split('#')[0];
    const where = item.isPageLevel ? '_(page-level)_' : `\`${item.selector}\``;
    const lines = [`# Impeccable: ${finding.name}`];
    if (url) lines.push(`URL: ${url}`);
    lines.push(`Element: ${where}`);
    lines.push(`Detail: ${finding.detail}`);
    lines.push('');
    lines.push(finding.description);
    lines.push('');
    const skills = fixSkillFor(finding);
    if (skills) lines.push(`Suggested Impeccable skill(s) to fix: ${skills}`);
    return lines.join('\n');
  }

  return { CATEGORY_LABELS, presentationCategory, fixSkillFor, formatFindingsForCopy, formatSingleFindingForCopy };
})();
