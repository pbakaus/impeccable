# Comp gate evidence and integrity

Comp fidelity still has two independent requirements: the numeric score and the
absence of blocking findings. A high overall score, a repeated attempt, or an
existing plate file does not satisfy a missing-region check.

## Measurements and decisions

`comp-diff` measures the declared region bounds. It does not enlarge a narrow
region to include neighbouring elements. Subpixel regions sample at least one
real source pixel, including at image edges. Coverage and region-kind checks remain
the responsibility of `comp-spec`; this change does not authorize omitting
regions or shrinking their bounds to exclude required work.

A standalone `comp-diff` report contains raw verdicts. The hero gate can interpret
those measurements using current plate validation and rendered presence. For
hero evidence:

- `raw-report.json` retains uninterpreted metrics and verdicts.
- `report.json` retains the same scores, adds `rawVerdict` to each region, and
  publishes the effective `verdict` used by the gate and paired image label.
- `gate.ok` and `gate.reasons` describe whether advancement is allowed and all
  unresolved blockers. `drift` alone does not mean a region is nonblocking.
- Paired images label their gate status as `BLOCKING`, `NONBLOCKING`, or
  `CHECK GATE`, using the same report fields.
- Region-specific blockers are recorded as `blockingReasons`. `blocking: null`
  means an unscoped blocking finding prevents attributing a clean bill of health
  to that region. Unscoped findings remain in `gate.unscopedReasons`; they are
  not hidden or waived.

When capture, spec, or plate validation fails before measurement, the current
report has `measurementsAvailable: false`, no region results, and the failed
gate reasons. It does not present the preceding capture as current evidence.

Repair crops include only regions with current blockers; shared readings retain
all affected region IDs. Frame-wide blockers keep their whole-frame evidence.
The current report is marked incomplete before image writes and committed
atomically only after the evidence files succeed. Write failures block the gate
and, when the report location is writable, publish an unavailable-evidence report.

Stall feedback follows repeated blocking reasons. It never chooses an asset to
regenerate solely because that asset has the lowest raw score. The feedback is
additional context; it does not clear a finding or advance the phase.

## Plate validation

Successful plate receipts include SHA-256 fingerprints of the asset bytes,
measured region, and comp. Hero and responsive gates revalidate receipts. A changed or deleted file, a changed region, or a
changed comp invalidates the receipt. Legacy score-only receipts are revalidated.
An invalid plate cannot receive an `ok` receipt merely because its PNG decoded.
Rendered presence is still checked after asset validation, so a file hidden in
the page does not count as placed.

## Overrides

A `--force --reason` must contain a direct quoted downgrade of comp authority
immediately attributed to the user. An unrelated mention of the user does not
authorize a quote from another speaker. Generic delegation, the builder's surrounding claim that
it may proceed, or a gate exception does not establish that authorization.
The quote parser is deliberately conservative. It cannot authenticate a quote:
the calling harness must retain the actual user answer and assess provenance.
Neither local receipts nor caller-written state are a security boundary against
an agent with arbitrary write access to all files and engine code.

## Validation

The comp-verbs regressions cover narrow-region isolation, changed/deleted plate
receipts, comp-crop reuse, hidden rendered assets, repeated failed attempts,
ambiguous overrides, spec coverage and kind refusals, and raw/effective report
agreement. They do not certify semantic equivalence of arbitrary artwork or
justify relaxing a fidelity threshold.
