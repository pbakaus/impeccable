# 4.4.0 review handoff

This candidate combines the component-review work with current main. It is not a published release. The engine and platform packages must exist before the skill version bump is merged.

## Behavior to preserve

The component kit includes raster assets and rendered HTML/CSS/SVG. Users can inspect every repeated instance together and submit one group decision. Group membership is an explicit producer declaration, restricted to matching code-region kinds and a shared document; it is not an automatic claim of visual equivalence.

Approval of the assembled first viewport ends human component and assembly review for that build. Later edits and completion checks do not ask for those approvals again. An explicitly new build (`build-phase start --reset`) has a new review journey; an old build's approval cannot authorize it. Hosts pass their trusted receipt directories for snapshot-based continuations.

## Readiness fixes

- Preserve native visual approvals through unsubmitted intermediate captures, considering the latest submitted revision rather than reviving older feedback.
- Bind local terminal approval to build identity. Reusing a manifest ID in a new build does not reuse its receipt or draft approvals.
- Ignore unreadable or foreign sessions during a shared-store scan. Requested sessions still fail if their own evidence is corrupt.
- Always settle expanded-comparison close state, including cancelled animations or a replaced dialog. Controls are inert while closing.
- Verify network response evidence after fonts and images settle, then check the complete URL set again after capture.
- Check primary fonts in the reviewed component, excluding separately reviewed children and reference-only context. Platform system-font aliases are allowed; missing custom primary faces remain errors.
- Measure generated before/after/marker boxes through native browser layout, including overflowing decorations in component crop bounds.
- Bind fallback responsive verification and finish to local frontend inputs. Later CSS, script, image or font changes invalidate stale fallback evidence. The fallback fingerprint is conservative and bounded; unsupported file trees fail verification rather than claim completion. This does not reopen human review.
- Remove this invocation's new output directory after a map-report write failure; never remove an existing output directory.
- Match the schema's review-group limit in Unicode characters, not UTF-8 bytes.
- Exempt hidden heading descendants from static italic-serif detection.

The generated browser bundle and provider distributions were rebuilt. The five conflicted oracle snapshots retain current main's detector fixes and add exactly the intended inline-italic heading finding (419 to 420 findings in the aggregate fixture corpus).

## Validation

Validated against merged main `edb9c7fbc` on macOS arm64:

- `cargo test --workspace`: 692 passed, 8 ignored.
- Native Chromium component-capture tests: all 7 passed, including pseudo-element overflow and scoped font checks.
- `bun run test`: all default suites passed (599 passed, 2 skipped), including the previously failing SIGKILL cleanup regression.
- New-work browser suite: 20 passed. The missing-image fixture now waits for DOM readiness instead of waiting for intentionally pending image polling to finish; its UI assertions remain unchanged.
- Component review model and shipped-bundle tests: 17 passed.
- Full live-mode browser sweep: 38 passed, 1 skipped across 27 framework suites.
- Browser detector bundle, release provider build, manifest checks, and prose validation passed.

These are implementation checks, not evidence of cross-provider n=3 qualification. The unpublished engine/platform-package gate is still a release blocker.

## Review comments that require interpretation

**Final assembly supersedes the component checkpoint.** Requiring a missing kit approval after the user already accepted the assembled first viewport would violate the chosen terminal-review behavior. Native capture/integrity evidence is still required; a model-written approval flag is insufficient.

**Grouping is an explicit multi-instance decision.** The UI shows the group members together. A shared group name declares the intended repeated role; the validator cannot infer semantic equivalence from pixels. Raster assets stay separate. Adding a second model-authored role string would not independently verify the first declaration.

**Claude startup hooks use the host's trust boundary.** Claude Code holds settings-file hooks until workspace trust is accepted in interactive sessions. In SDK and `-p` sessions it treats the folder as trusted; callers must choose the project settings they load. Plugin hooks resolve the installed plugin root. This PR does not bypass those rules. See [Claude Code workspace trust](https://code.claude.com/docs/en/hooks#workspace-trust).

## Release ordering

1. Complete adversarial review and resolve actionable findings on this candidate.
2. Publish engine 0.1.6 from the reviewed commit; verify all five binaries and checksums.
3. Publish the five 0.1.6 npm platform packages, refresh their lock resolutions, and pass `check:engine-release`.
4. Merge the reviewed PR, verify generated provider output, add the skill changelog entry, and publish skill 4.4.0.
5. Verify a fresh install and the public gallery's links to the released skill.

No release tags or packages were published by this readiness pass. AI assistance: OpenAI Codex.
