# iOS platform

For native iOS / iPadOS apps: SwiftUI, UIKit, React Native, Expo, Flutter shipping to Apple hardware.

On native, the visitor mode narrows what expression may override. HIG conformance governs structure, navigation, and interaction in every mode; brand expresses through the layer the platform leaves open (tint, type, motion, content).

## The iOS slop test

Would a fluent iPhone user trust this app, or pause at off-spec controls? The tell is "ported from a website": reinvented navigation bars, custom back gestures, web-shaped buttons, hover-dependent affordances. Default to the platform's components; depart only for a reason the user would thank you for.

## Layout & structure

- **Safe area.** Lay out inside the safe-area insets. No controls under the notch, Dynamic Island, home indicator, or rounded corners.
- **System navigation.** Tab bar for 2–5 top-level sections (sections, never actions), navigation stack for hierarchy, sheet for self-contained tasks. No custom global nav, no mixed metaphors.
- **Edge-swipe back stays alive.** The left-edge back gesture is muscle memory; never disable or overlay it.
- **Large titles** on top-level screens, collapsing to inline on scroll. Deep detail screens stay inline.

## Touch targets

- **44×44 pt minimum** for every tappable control, with breathing room between adjacent targets.

## Typography

- **Dynamic Type.** Use the system text styles (Large Title through Caption) so text follows the user's reading size. No hard-coded point sizes.
- **San Francisco carries the UI.** Body, labels, and controls stay on SF Pro / SF Compact; a brand face may appear in display moments.
- **11 pt floor**; Body is 17 pt.

## Color & materials

- **Semantic system colors** (label, secondaryLabel, systemBackground, separator, tint). They adapt to Dark Mode and increased contrast automatically; raw hex breaks there.
- **Dark Mode is a first-class appearance.** Design and test both.
- **One tint color** drives interactive elements; decoration is not its job.
- **System materials** for blur and translucency behind bars and sheets; no hand-rolled glassmorphism.

## Components & controls

- **Platform controls.** Switch, segmented control, stepper, system pickers, action sheets, alerts, context menus, swipe actions. Reinventing these for flavor is the most common native slop.
- **SF Symbols** for iconography: baseline-aligned, Dynamic Type-aware, weight and scale variants. Don't mix in a web icon set.
- **Deliberate modality.** Sheet for a focused dismissible sub-task, full-screen cover for immersion. Clear Cancel/Done; honor swipe-to-dismiss unless data loss requires a guard.
- **Grouped/inset lists** for settings-shaped content; no bespoke card stacks.

## Motion

- **System transitions.** Push slides, sheets rise, dismiss reverses the entrance. Custom transitions that fight the navigation model disorient.
- **Honor Reduce Motion.** Crossfade instead of parallax and large slides.

## Verifying the build

- **Screenshots come from the Simulator, never a browser.** Build and run, then capture with `xcrun simctl io booted screenshot <path>` (with several running, replace `booted` with the target's UDID from `xcrun simctl list devices booted`; display names can collide, the UDID never does). Capture every device class the app ships to, at least one iPhone and, when iPad is a target, one iPad, and write the files where the review flow expects them.
- **Dark Mode and Dynamic Type belong in the pass.** `xcrun simctl ui booted appearance dark` flips appearance, reusing the capture's UDID when several are booted; a check at a large Dynamic Type size catches the truncation a fixed layout hides.
- **Simulators give breadth; posture, gestures, and performance need hardware.** Say which one produced the evidence.
