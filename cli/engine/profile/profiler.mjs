function profileNow() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function createDetectorProfile() {
  return { events: [] };
}

function normalizeProfileEvent(event) {
  return {
    engine: event.engine || 'unknown',
    phase: event.phase || 'unknown',
    ruleId: event.ruleId || 'unknown',
    target: event.target || '',
    ms: Number.isFinite(event.ms) ? event.ms : 0,
    findings: Number.isFinite(event.findings) ? event.findings : 0,
    ...(event.detail ? { detail: event.detail } : {}),
    ...(Array.isArray(event.findingIds) && event.findingIds.length
      ? { findingIds: event.findingIds }
      : {}),
  };
}

function recordProfileEvent(profile, event) {
  if (!profile) return;
  const normalized = normalizeProfileEvent(event);
  if (typeof profile === 'function') {
    profile(normalized);
  } else if (typeof profile.record === 'function') {
    profile.record(normalized);
  } else if (Array.isArray(profile.events)) {
    profile.events.push(normalized);
  } else if (Array.isArray(profile)) {
    profile.push(normalized);
  }
}

function extractFindingIds(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  return [...new Set(findings.map(f => f?.id || f?.type || f?.antipattern).filter(Boolean))];
}

function recordDuration(profile, meta, started, findings) {
  recordProfileEvent(profile, {
    ...meta,
    ms: profileNow() - started,
    findings: Array.isArray(findings) ? findings.length : 0,
    findingIds: extractFindingIds(findings),
  });
  return findings;
}

function profileFindings(profile, meta, callback) {
  if (!profile) return callback();
  const started = profileNow();
  return recordDuration(profile, meta, started, callback());
}

function profileStep(profile, meta, callback) {
  if (!profile) return callback();
  const started = profileNow();
  try {
    return callback();
  } finally {
    recordDuration(profile, meta, started);
  }
}

async function profileFindingsAsync(profile, meta, callback) {
  if (!profile) return callback();
  const started = profileNow();
  return recordDuration(profile, meta, started, await callback());
}

async function profileStepAsync(profile, meta, callback) {
  if (!profile) return callback();
  const started = profileNow();
  try {
    return await callback();
  } finally {
    recordDuration(profile, meta, started);
  }
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

function summarizeDetectorProfile(profile) {
  const events = Array.isArray(profile)
    ? profile
    : (Array.isArray(profile?.events) ? profile.events : []);
  const groups = new Map();
  for (const event of events) {
    const { engine, phase, ruleId, target, ms, findings } = normalizeProfileEvent(event);
    const key = [engine, phase, ruleId, target].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      group = {
        engine,
        phase,
        ruleId,
        target,
        calls: 0,
        totalMs: 0,
        findings: 0,
        samples: [],
      };
      groups.set(key, group);
    }
    group.calls += 1;
    group.totalMs += ms;
    group.findings += findings;
    group.samples.push(ms);
  }
  return [...groups.values()]
    .map(group => {
      const samples = group.samples.sort((a, b) => a - b);
      return {
        engine: group.engine,
        phase: group.phase,
        ruleId: group.ruleId,
        target: group.target,
        calls: group.calls,
        totalMs: Number(group.totalMs.toFixed(3)),
        avgMs: Number((group.totalMs / group.calls).toFixed(3)),
        p50: Number(percentile(samples, 50).toFixed(3)),
        p95: Number(percentile(samples, 95).toFixed(3)),
        findings: group.findings,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
}

export {
  profileNow,
  createDetectorProfile,
  recordProfileEvent,
  extractFindingIds,
  profileFindings,
  profileStep,
  profileFindingsAsync,
  profileStepAsync,
  percentile,
  summarizeDetectorProfile,
};
