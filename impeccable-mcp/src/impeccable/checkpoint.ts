export type CheckpointPhase = 'before_generation' | 'after_generation' | 'before_final';

export type CheckpointInput = {
  phase: CheckpointPhase;
  command?: string;
  brief?: string;
  hasProductContext?: boolean;
  detectorFindings?: Array<{ severity?: string; ruleId?: string; message?: string }>;
  acknowledgedFindings?: string[];
};

export type CheckpointResult = {
  phase: CheckpointPhase;
  status: 'ready' | 'needs_input' | 'needs_revision' | 'blocked';
  requiredActions: string[];
  nextTools: string[];
};

const blockingSeverities = new Set(['P0', 'P1', 'BLOCKING', 'CRITICAL', 'MAJOR', 'HIGH']);

function blockingFindings(input: CheckpointInput): Array<{ severity?: string; ruleId?: string; message?: string }> {
  const acknowledged = new Set(input.acknowledgedFindings ?? []);
  return (input.detectorFindings ?? []).filter((finding) => {
    const severity = String(finding.severity ?? '')
      .trim()
      .toUpperCase()
      .replace(/[-\s]+/g, '_');
    const key = finding.ruleId ?? finding.message ?? '';
    return blockingSeverities.has(severity) && !acknowledged.has(key);
  });
}

export function runCheckpoint(input: CheckpointInput): CheckpointResult {
  if (input.phase === 'before_generation') {
    const requiredActions: string[] = [];
    if (!input.command) requiredActions.push('Select an Impeccable command such as shape, craft, critique, audit, or polish.');
    if (!input.brief) requiredActions.push('Provide a brief or current-state description.');
    if (input.hasProductContext === false) requiredActions.push('Confirm product/brand context before generation.');
    return {
      phase: input.phase,
      status: requiredActions.length ? 'needs_input' : 'ready',
      requiredActions,
      nextTools: requiredActions.length ? ['impeccable_workflow'] : ['generate_or_revise_ui'],
    };
  }

  if (input.phase === 'after_generation') {
    const findings = blockingFindings(input);
    return {
      phase: input.phase,
      status: findings.length ? 'needs_revision' : 'ready',
      requiredActions: findings.length
        ? findings.map((finding) => `Resolve ${finding.ruleId ?? 'finding'}: ${finding.message ?? 'important detector finding'}`)
        : ['Continue to before_final checkpoint when ready.'],
      nextTools: findings.length ? ['impeccable_detect_markup', 'impeccable_checkpoint'] : ['impeccable_checkpoint'],
    };
  }

  const remaining = blockingFindings(input);
  return {
    phase: input.phase,
    status: remaining.length ? 'blocked' : 'ready',
    requiredActions: remaining.length
      ? remaining.map((finding) => `Fix or explicitly acknowledge ${finding.ruleId ?? 'finding'} before final response.`)
      : ['Final response may proceed with source-backed Impeccable evidence.'],
    nextTools: remaining.length ? ['impeccable_detect_markup', 'impeccable_checkpoint'] : [],
  };
}
