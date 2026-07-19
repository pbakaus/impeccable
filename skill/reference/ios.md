# iOS platform

For native iOS / iPadOS apps: SwiftUI, UIKit, React Native, Expo, Flutter shipping to Apple hardware.

On native, register narrows. HIG conformance governs structure, navigation, and interaction whatever the register; brand expresses through the expressive layer the platform provides (tint, type, motion, content). Calm, Duolingo, and Spotify carry strong identity entirely inside HIG conventions.

## The iOS slop test

Would a fluent iPhone user trust this app, or pause at off-spec controls? The tell is "ported from a website": reinvented navigation bars, custom back gestures, web-shaped buttons, hover-dependent affordances. Default to the platform's components; depart only for a reason the user would thank you for.

## Layout & structure

- **Safe area.** Lay out inside the safe-area insets. No controls under the notch, Dynamic Island, home indicator, or rounded corners. <!-- rule:ios-layout-safe-area -->
- **System navigation.** Tab bar for 2–5 top-level sections (sections, never actions), navigation stack for hierarchy, sheet for self-contained tasks. No custom global nav, no mixed metaphors. <!-- rule:ios-layout-standard-navigation -->
- **Edge-swipe back stays alive.** The left-edge back gesture is muscle memory; never disable or overlay it. <!-- rule:ios-layout-edge-swipe-back -->
- **Large titles** on top-level screens, collapsing to inline on scroll. Deep detail screens stay inline. <!-- rule:ios-layout-large-titles -->

## Touch targets

- **44×44 pt minimum** for every tappable control, with breathing room between adjacent targets. <!-- rule:ios-touch-target-44pt -->

## Typography

- **Dynamic Type.** Use the system text styles (Large Title through Caption) so text follows the user's reading size. No hard-coded point sizes. <!-- rule:ios-typo-dynamic-type -->
- **San Francisco carries the UI.** Body, labels, and controls stay on SF Pro / SF Compact; a brand face may appear in display moments. <!-- rule:ios-typo-system-font -->
- **11 pt floor**; Body is 17 pt. <!-- rule:ios-typo-minimum-size -->

## Color & materials

- **Semantic system colors** (label, secondaryLabel, systemBackground, separator, tint). They adapt to Dark Mode and increased contrast automatically; raw hex breaks there. <!-- rule:ios-color-semantic-system -->
- **Dark Mode is a first-class appearance.** Design and test both. <!-- rule:ios-color-dark-mode -->
- **One tint color** drives interactive elements; decoration is not its job. <!-- rule:ios-color-single-tint -->
- **System materials** for blur and translucency behind bars and sheets; no hand-rolled glassmorphism. <!-- rule:ios-color-system-materials -->

## Components & controls

- **Platform controls.** Switch, segmented control, stepper, system pickers, action sheets, alerts, context menus, swipe actions. Reinventing these for flavor is the most common native slop. <!-- rule:ios-components-native-controls -->
- **SF Symbols** for iconography: baseline-aligned, Dynamic Type-aware, weight and scale variants. Don't mix in a web icon set. <!-- rule:ios-components-sf-symbols -->
- **Deliberate modality.** Sheet for a focused dismissible sub-task, full-screen cover for immersion. Clear Cancel/Done; honor swipe-to-dismiss unless data loss requires a guard. <!-- rule:ios-components-modality -->
- **Grouped/inset lists** for settings-shaped content; no bespoke card stacks. <!-- rule:ios-components-grouped-lists -->

## Motion

- **System transitions.** Push slides, sheets rise, dismiss reverses the entrance. Custom transitions that fight the navigation model disorient. <!-- rule:ios-motion-system-transitions -->
- **Honor Reduce Motion.** Crossfade instead of parallax and large slides. <!-- rule:ios-motion-reduce-motion -->
