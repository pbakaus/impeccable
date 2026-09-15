# Impeccable 4.4.0 release candidate

Comp-led work now asks the user to review the produced component kit before page assembly, then the assembled first viewport before completion. The shared browser interface covers raster assets and rendered HTML/CSS/SVG, individual approval and repair feedback, missing regions, unchanged approvals across rounds, and current/previous comparison.

Engine 0.1.6 owns capture, frozen input provenance, durable review sessions and current-input approval verification. Existing comp fidelity, semantic-control and completion checks remain independent; human approval does not manufacture detector evidence or remove an integrity failure. The broader native capture and completion repairs in this PR retain their regression coverage.

Static component previews are supported in v1. Scripted/canvas components must report an unsupported capture instead of substituting a raster or omitting the component. The local browser service protects against cross-origin submissions; an embedding eval harness separately authenticates its human operator and owns exact provider continuation.

## Release sequence

This branch is a candidate, not a published release. Build and test engine 0.1.6 from source for branch evals. Publish the engine and its five platform packages before publishing skill 4.4.0; refresh the lockfile after those optional packages exist. The engine release gate must remain enabled. Copy the final approved release notes into the private site's changelog at release time. This PR does not publish the engine, skill or website.

## Validation

- Rust workspace, default Bun/Node suites, native component capture/approval verification, and shared UI state/bundle tests.
- New-work and framework live-mode browser E2E suites run separately for the engine bump.
- Provider-billed cleanup and DeepSeek adapter sweeps require their credentials and must be recorded separately from offline checks.
- Private eval harness qualification is distinct: a waiting component review is pending work, not a successful completed sample or a visual approval.
