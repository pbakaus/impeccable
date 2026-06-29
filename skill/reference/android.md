# Android platform

When the deliverable is a native Android app (Jetpack Compose, Android Views, React Native, Expo,
Flutter on Android), not a website. This is read **on top of** the register reference, not instead of it.

On native, the register's role is narrow. Platform conformance is the bar for structure, interaction,
and accessibility regardless of register; brand lives in the expressive layer Material already gives
you: theming, type scale, color, motion. Brand earns its place within the rails, never by breaking
them.

The reference distilled here adapts the Android rules from the MIT-licensed
[ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) project (Material Design
3), rewritten in Impeccable's voice. See [NOTICE.md](../../NOTICE.md) for attribution.

## The Android slop test

As with iOS, earned familiarity is the bar. The test is whether a fluent Android user trusts
the app or trips on off-spec components. The most common tell is an **iOS app wearing Android's skin**:
a bottom-only navigation copied from iPhone, a back arrow that ignores the system Back gesture, switches
and dialogs shaped like Cupertino. Material Design 3 is the rulebook; follow its components and let the
brand express through Material's theming, not by discarding it.

## Layout & structure

- **Material navigation, matched to size.** Navigation bar (bottom, 3–5 destinations) on compact width; navigation rail or drawer on larger/expanded width. Don't ship a phone bottom-bar untouched on a tablet. <!-- rule:android-layout-adaptive-nav -->
- **The system Back must always work.** Honor the predictive Back gesture / Back button; never trap the user or hijack the gesture. Back is a platform guarantee. <!-- rule:android-layout-system-back -->
- **Edge-to-edge with window insets.** Draw edge-to-edge and apply window insets (status bar, navigation bar, display cutout, IME) so content isn't hidden behind system bars or the keyboard. <!-- rule:android-layout-window-insets -->
- **Top app bar for screen context**; pair with a FAB for the screen's single primary action when there is one. <!-- rule:android-layout-top-app-bar -->

## Touch targets

- **48×48 dp minimum** for every touch target, with at least 8 dp between them. This is dp, not pixels; it holds across densities. <!-- rule:android-touch-target-48dp -->

## Typography

- **Use the Material type scale.** Display, Headline, Title, Body, Label roles, each with large/medium/small. Map text to roles rather than hand-picking sizes per screen. <!-- rule:android-typo-type-scale -->
- **Roboto is the system face**; a brand face can be themed in through the type scale, but keep body, labels, and controls legible and consistent. <!-- rule:android-typo-system-font -->
- **Type scales with the system font-size setting** (sp units, not fixed px). Don't defeat the user's accessibility text size. <!-- rule:android-typo-scalable-sp -->

## Color & theming

- **Theme through Material color roles**, not raw hex. Use the role tokens (primary, on-primary, surface, surface-variant, secondary-container, outline, error, etc.) so light/dark and contrast variants resolve automatically. <!-- rule:android-color-role-tokens -->
- **Support Dynamic Color (Material You)** where it fits: let the scheme derive from the user's wallpaper/system source on Android 12+, with a static fallback scheme. <!-- rule:android-color-dynamic-color -->
- **Support dark theme as a first-class scheme**, tested, not a quick invert. <!-- rule:android-color-dark-theme -->
- **Elevation is tonal in M3.** Convey elevation primarily through surface tonal overlays (and shadow where appropriate), using the standard elevation levels, not arbitrary drop shadows. <!-- rule:android-color-tonal-elevation -->

## Components & motion

- **Use Material components.** Material buttons (filled / tonal / outlined / text), FAB, switches, chips, snackbars (not toasts for actionable feedback), bottom sheets, Material dialogs, navigation bar/rail/drawer. Don't port iOS controls or invent equivalents. <!-- rule:android-components-material -->
- **One FAB, one primary action.** The FAB is the screen's most important action; don't stack multiple FABs or use it for a secondary task. <!-- rule:android-components-single-fab -->
- **Snackbars for transient, optionally-actionable feedback**; dialogs only for decisions that must interrupt. <!-- rule:android-components-snackbar -->
- **Material motion patterns** (container transform, shared-axis, fade-through) for transitions, with the standard easing and durations; honor the system Reduce/Remove animations setting with a crossfade or instant alternative. <!-- rule:android-motion-material-and-reduce -->

## Android bans (on top of the shared absolute bans)

- iOS components or navigation patterns ported onto Android (Cupertino switches, iOS-style back, iOS tab bar metaphors). <!-- rule:android-ban-ios-port -->
- Hard-coded hex that ignores Material color roles and dark theme. <!-- rule:android-ban-hardcoded-color -->
- Fixed px type that defeats the system font-size setting. <!-- rule:android-ban-fixed-type -->
- Touch targets below 48 dp or crammed without spacing. <!-- rule:android-ban-small-targets -->
- Multiple FABs, or a FAB used for a non-primary action. <!-- rule:android-ban-multiple-fabs -->
- Arbitrary drop shadows instead of the Material tonal elevation system. <!-- rule:android-ban-arbitrary-elevation -->
- Toasts where an actionable snackbar is the right feedback. <!-- rule:android-ban-toast-misuse -->
