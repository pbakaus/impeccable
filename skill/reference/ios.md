# iOS platform

When the deliverable is a native iOS / iPadOS app (SwiftUI, UIKit, React Native, Expo, Flutter on
Apple platforms), not a website. This is read **on top of** the register reference, not instead of it.

On native, the register's role is narrow. Platform conformance is the bar for structure, interaction,
and accessibility regardless of register; brand lives in the expressive layer the platform already
gives you: theming, type scale, color, motion. Brand earns its place within the rails, never by
breaking them. Calm, Duolingo, and Spotify all carry a strong identity inside the platform's
conventions, not by discarding them.

The reference distilled here adapts the iOS rules from the MIT-licensed
[ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) project (Apple Human
Interface Guidelines), rewritten in Impeccable's voice. See [NOTICE.md](../../NOTICE.md) for attribution.

## The iOS slop test

Earned familiarity is the bar: a fluent iPhone user should trust the app, not pause at every off-spec
control. An app that reinvents the navigation bar, ships a custom back gesture, or uses web-shaped
buttons reads as "ported from a website", which on iOS is a tell. The platform's own components are the
default; depart from them only with a reason a user would thank you for. Identity comes from the
expressive layer (type, color, motion, content), not from breaking the conventions.

## Layout & structure

- **Respect the safe area.** Lay out inside the safe-area insets; never put controls under the notch, the Dynamic Island, the home indicator, or rounded corners. In SwiftUI this is the default; opt out only deliberately, and never for interactive elements. <!-- rule:ios-layout-safe-area -->
- **Standard navigation, not invented.** Tab bars for top-level peer sections (2–5 tabs); navigation stacks (push/pop) for hierarchy with the system back affordance; modal sheets for self-contained tasks. Don't mix metaphors or build a custom global nav. <!-- rule:ios-layout-standard-navigation -->
- **Edge-swipe back stays alive.** The left-edge swipe-to-go-back gesture is muscle memory. Don't disable it or overlay a gesture that swallows it. <!-- rule:ios-layout-edge-swipe-back -->
- **Large titles where they fit.** Use the large-title navigation style for top-level screens that benefit; collapse to inline on scroll. Don't force large titles onto deep detail screens. <!-- rule:ios-layout-large-titles -->

## Touch targets

- **44×44 pt minimum** for every tappable control, with adequate spacing so adjacent targets don't collide. This is points, not pixels; it holds across screen densities. <!-- rule:ios-touch-target-44pt -->

## Typography

- **Dynamic Type, not fixed sizes.** Use the system text styles (Large Title, Title, Headline, Body, Caption, etc.) so text scales with the user's accessibility setting. Hard-coded point sizes that ignore Dynamic Type are an accessibility failure. <!-- rule:ios-typo-dynamic-type -->
- **San Francisco is the system face.** SF Pro / SF Compact carry UI text by default; they're tuned for legibility at every size and ship optical sizes automatically. A custom brand face can appear, but body, labels, and controls should stay on the system font unless the brand register truly requires otherwise. <!-- rule:ios-typo-system-font -->
- **Don't ship below 11 pt** for any legible text; Body is 17 pt by default for a reason. <!-- rule:ios-typo-minimum-size -->

## Color & materials

- **Semantic system colors, not hard-coded hex.** Use the system colors (label, secondaryLabel, systemBackground, separator, tint, etc.) so the app adapts to Light/Dark Mode and increased-contrast settings automatically. A palette of raw hex values breaks in Dark Mode. <!-- rule:ios-color-semantic-system -->
- **Support Dark Mode as a first-class appearance**, not an afterthought tint. Test both. <!-- rule:ios-color-dark-mode -->
- **One accent / tint color** drives interactive elements (links, selected states, switches). Decoration is not its job. <!-- rule:ios-color-single-tint -->
- **Use system materials for blur/translucency** (the standard vibrancy materials behind bars and sheets), not hand-rolled glassmorphism. <!-- rule:ios-color-system-materials -->

## Components & controls

- **Use the platform controls.** Switch (not a custom toggle), segmented control, stepper, the system date/picker, action sheets, alerts, context menus, swipe actions on rows. Reinventing these for "flavor" is the most common native slop. <!-- rule:ios-components-native-controls -->
- **SF Symbols for iconography.** They align to the text baseline, scale with Dynamic Type, and carry weight/scale variants. Don't mix a random web icon set in among them. <!-- rule:ios-components-sf-symbols -->
- **Modality is deliberate.** A sheet is for a focused, dismissible sub-task; full-screen cover for an immersive flow. Don't trap the user; provide a clear Cancel/Done and honor swipe-to-dismiss unless data loss requires a guard. <!-- rule:ios-components-modality -->
- **Lists and forms use the grouped/inset styles** users expect for settings-shaped content, rather than bespoke card stacks. <!-- rule:ios-components-grouped-lists -->

## Motion

- **Motion mirrors the system.** Match the platform's navigation transitions (push slides, sheets rise, dismiss reverses the entrance) so spatial continuity reads correctly. Custom transitions that fight the navigation model disorient. <!-- rule:ios-motion-system-transitions -->
- **Honor Reduce Motion.** When the accessibility setting is on, swap parallax and large slides for a crossfade. Non-negotiable. <!-- rule:ios-motion-reduce-motion -->

## iOS bans (on top of the shared absolute bans)

- Custom navigation/back affordances that replace or block the system ones. <!-- rule:ios-ban-custom-nav -->
- Hard-coded colors that ignore Dark Mode and the semantic system palette. <!-- rule:ios-ban-hardcoded-color -->
- Fixed font sizes that defeat Dynamic Type. <!-- rule:ios-ban-fixed-type -->
- Web-shaped controls (HTML-style buttons, custom toggles, hover-dependent affordances) ported into a native screen. <!-- rule:ios-ban-web-controls -->
- Tap targets below 44 pt or crammed without spacing. <!-- rule:ios-ban-small-targets -->
- A bottom tab bar with more than five items, or tabs used for actions instead of top-level sections. <!-- rule:ios-ban-overloaded-tab-bar -->
