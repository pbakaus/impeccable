> **Additional context needed**: performance constraints.

Use motion to explain state, relationship, and hierarchy, or to create one authored moment the surface has earned. Decoration without purpose is animation debt.

---

## Visitor mode

- **Persuade + Experience:** motion may carry the voice. Prefer one rehearsed focal sequence to repeated section reveals.
- **Operate + Read:** motion serves feedback, state, and continuity. Keep routine transitions fast and do not make users wait through page-load choreography.
- **Native (`ios` / `android` / `adaptive`):** follow the Motion section of [ios.md](ios.md) or [android.md](android.md), including the platform's Reduce Motion behavior. Do not apply the web tooling below.

## Find the job

Inspect the existing motion language, interaction states, target devices, and performance budget. Find only the places where motion would:

- acknowledge an action;
- make a state change or spatial relationship legible;
- preserve continuity through navigation or layout change;
- direct attention at a meaningful moment;
- embody the selected visual world.

Ask only when a material constraint cannot be inferred. Do not animate a static area merely because it exists.

## Set the motion thesis

Write a short plan before implementation:

- **Focal moment:** the one sequence or interaction that deserves authorship, if any.
- **Continuity:** the state, layout, or navigation changes that need explanation.
- **Feedback:** the controls and outcomes that need acknowledgment.
- **Budget:** which effects may be expensive and how often they run.

The focal moment must come from this product and surface concept. A generic fade-and-rise, hover lift, parallax layer, or scroll reveal is not a thesis.

## Choose material by meaning

Transform and opacity are reliable foundations, not the entire palette. Choose properties for what the transition communicates:

- **Continuity and relationship:** shared-element motion, FLIP-style transforms, view transitions, or deliberate spatial movement.
- **Focus and depth:** bounded blur, filter, backdrop, light, or shadow changes.
- **Reveal and composition:** masks, clip paths, cropping, or controlled occlusion.
- **Material and energy:** color, gradient position, texture, distortion, or shader effects when the world and runtime support them.
- **State and feedback:** the smallest change that makes cause and result unmistakable.

Do not stack techniques for spectacle. One strong material idea, carried through the focal sequence and quiet supporting states, is usually enough.

Sibling stagger is appropriate when a list appears as a list. Cap the total delay, and never reinterpret every scrolled section as a staggered list.

## Timing and easing

Timing should express distance and consequence:

| Duration | Typical use |
|---|---|
| 100–150 ms | immediate feedback |
| 150–300 ms | routine state change |
| 300–500 ms | layout, overlay, or view transition |
| 500–800 ms | a deliberately authored focal entrance |

Exit faster than entrance. Use natural deceleration such as `cubic-bezier(0.16, 1, 0.3, 1)` for confident arrivals; do not use bounce or elastic curves by reflex. Long feedback feels like latency.

## Hover

Hover motion never moves a neighbor or takes its pointer target. Keep the hovered element still and let a child carry the motion (`.card:hover .card-surface { transform: translateY(-2px) }`). An element that moves itself slides out from under a pointer near its edge and flickers. Optional previews wait for the pointer to settle: for a CSS reveal, set `transition-delay` on the hover state only, so leaving is not delayed.

## Implement to the runtime

- Use CSS transitions and keyframes for declarative state and bounded sequences.
- Use Web Animations API or the project's existing motion library for interruption, sequencing, and dynamic values.
- Use View Transitions or shared-element techniques when continuity across states is the point.
- Use scroll-driven motion only when the scroll relationship itself carries meaning, with a robust fallback.
- Do not add a dependency for an effect the existing stack can express cleanly.

Keep content visible in the default state so failed scripts do not hide the page. Avoid casually animating layout-driving properties such as `width`, `height`, `top`, `left`, and margins; use FLIP, transforms, or grid techniques when appropriate. Bound blur, filter, shadow, canvas, and shader work to isolated regions. Apply `will-change` only during known animation. Measure on target viewports and devices rather than assuming transform means fast.

## Accessibility and control

Respect autoplay and sound preferences. Any nonessential loop must stop when offscreen or hidden.

Every web animation needs a `prefers-reduced-motion` path with an intentional alternative. Remove or reduce spatial movement while preserving opacity, color, and state transitions that carry meaning. Reduced motion means fewer and gentler animations, not disabling all motion; feedback that confirms an action should remain legible.

## Verify

On the web, capture implemented motion before calling it smooth. Use the skill-internal measuring verb (not a separate user command), once normally and once with reduced motion, with the same URL, interaction, and region:

```sh
{{scripts_path}}/impeccable motion-capture <url> --click '<selector>' --region '<region-selector>' --out-dir .impeccable/review/motion/normal
{{scripts_path}}/impeccable motion-capture <url> --click '<selector>' --region '<region-selector>' --reduced-motion --out-dir .impeccable/review/motion/reduced
```

For keyboard or multi-step interactions use `--steps <json-file>` instead of `--click`, with a short list such as `[{"click":"#toggle"},{"press":"Enter"}]`; supported steps are click, hover, press (navigation keys), and wait (milliseconds). Capture each entrance and exit separately. The fixed capture points include before, first animated, evenly spaced middle, last animated, and settled frames. Each directory holds one PNG per frame, `filmstrip.png`, `index.html` with a scrubber, and `report.json` with per-element measurements and deterministic findings. Inspect the files before sending them: blank, wrong-region, stale, or missing evidence requires recapture. Read the report's limitations; unsupported or unmeasured behavior is not a clean result. Never judge motion by a single element or a single screenshot.

Spawn the shipped `impeccable-motion-reviewer` fresh (`impeccable_motion_reviewer` in Codex; `/impeccable-motion-reviewer` in Cursor; on GitHub Copilot say "Use the impeccable-motion-reviewer agent"), with no forked conversation history. Pass the original request, the motion thesis above, both capture directories (plus entrance and exit captures where applicable), DESIGN.md's motion rules if any, and the craft-floor reference path. The reviewer has no browser and reviews only the provided evidence. Never read its agent definition before spawning; the harness loads it. Wait with one long timeout and verify a disposition-first return with `continuity`, `craft`, `reduced_motion`, `material_fixes`, and `keep`. Respawn an empty or incomplete return once with the same packet. Only when the harness has no subagent capability, run a separate fresh pass from [degraded/motion-reviewer.md](degraded/motion-reviewer.md), and disclose the substitution at finish.

Act on the disposition. **recapture:** repair the named evidence and request a full review; invalid evidence binds no verdict. **fix:** apply the ordered material fixes in one batch, recapture normal and reduced motion over the same files, and continue the same reviewer for a verdict pass scoring each fix resolved, partial, or unresolved. Without continuation, pass the prior findings and new captures to a fresh reviewer. **ship:** report that word at the scope the reviewer actually checked. Two rounds maximum (initial review, then post-fix verdict); stop if a round resolves nothing. Report remaining fixes or missing evidence honestly at the ceiling; never turn a partial or unresolved verdict into a claim of smoothness. Native platforms keep their platform capture tooling and Reduce Motion verification instead of this web engine.


- The focal motion is specific to the selected world and surface.
- Every supporting animation explains feedback, state, or relationship.
- Interruption and repeated use behave correctly.
- Desktop, mobile, and keyboard paths remain usable.
- The `prefers-reduced-motion` path reduces movement without erasing meaningful feedback or state changes.
- Expensive effects stay smooth on the target device.
- Removing an animation would lose meaning or authored character, not merely decoration.

When motion earns its place, hand off to `{{command_prefix}}impeccable polish` for the final pass.
