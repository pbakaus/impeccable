# Android platform

For native Android apps: Jetpack Compose, Android Views, React Native, Expo, Flutter shipping to Android hardware.

On native, the visitor mode narrows what expression may override. Material Design 3 governs structure, navigation, and interaction in every mode; brand expresses through Material's theming (color roles, type scale, shape, motion). A Material-everywhere cross-platform app that also ships to iPhone still owes iOS its OS guarantees on that hardware: safe-area insets, Reduce Motion, edge-swipe back.

## The Android slop test

Would a fluent Android user trust this app, or trip on off-spec components? The most common tell is an iOS app wearing Android's skin: a bottom-only navigation copied from iPhone, a back arrow that ignores the system Back gesture, Cupertino-shaped switches and dialogs. Material 3 is the rulebook; follow its components and theme the brand through it.

## Layout & structure

- **Material navigation, matched to size.** Navigation bar (bottom, 3–5 destinations) on compact width; navigation rail or drawer on expanded width. Never ship a phone bottom-bar untouched on a tablet. <!-- rule:android-layout-adaptive-nav -->
- **System Back always works.** Honor the predictive Back gesture and Back button; never trap the user or hijack the gesture. <!-- rule:android-layout-system-back -->
- **Edge-to-edge with window insets.** Apply the status bar, navigation bar, display cutout, and IME insets so content never hides behind system bars or the keyboard. <!-- rule:android-layout-window-insets -->
- **Top app bar for screen context**; pair with a FAB when the screen has a single primary action. <!-- rule:android-layout-top-app-bar -->

## Touch targets

- **48×48 dp minimum** for every touch target, with at least 8 dp between them. <!-- rule:android-touch-target-48dp -->

## Typography

- **Material type scale.** Display, Headline, Title, Body, Label roles (large/medium/small each). Map text to roles; never hand-pick sizes per screen. <!-- rule:android-typo-type-scale -->
- **Roboto is the system face**; theme a brand face in through the type scale, keeping body, labels, and controls legible and consistent. <!-- rule:android-typo-system-font -->
- **sp units, never fixed px**, so type follows the system font-size setting. <!-- rule:android-typo-scalable-sp -->

## Color & theming

- **Material color roles** (primary, on-primary, surface, surface-variant, secondary-container, outline, error). Role tokens resolve light/dark and contrast variants automatically; raw hex breaks there. <!-- rule:android-color-role-tokens -->
- **Dynamic Color (Material You)** where it fits: derive the scheme from the user's wallpaper on Android 12+, with a static fallback. <!-- rule:android-color-dynamic-color -->
- **Dark theme is a first-class scheme.** Design and test it; never a quick invert. <!-- rule:android-color-dark-theme -->
- **Tonal elevation.** Convey elevation through the standard surface tonal levels (plus shadow where appropriate); no arbitrary drop shadows. <!-- rule:android-color-tonal-elevation -->

## Components & motion

- **Material components.** Buttons (filled / tonal / outlined / text), FAB, switches, chips, snackbars, bottom sheets, Material dialogs, navigation bar/rail/drawer. Never port iOS controls or invent equivalents. <!-- rule:android-components-material -->
- **One FAB, one primary action.** Never stack FABs or spend one on a secondary task. <!-- rule:android-components-single-fab -->
- **Snackbars for transient feedback** (actionable when useful, never a toast for that); dialogs only for decisions that must interrupt. <!-- rule:android-components-snackbar -->
- **Material motion patterns.** Container transform, shared-axis, fade-through, with standard easing and durations; honor the system Remove animations setting with a crossfade or instant cut. <!-- rule:android-motion-material-and-reduce -->

## Verifying the build

- **Screenshots come from the emulator or a connected device, never a browser.** Build and install, then capture with `adb exec-out screencap -p > <path>` (pick a device with `adb -s <serial>` when several are attached). Capture every device class the app ships to, at least one phone and, when tablets are a target, one tablet, and write the files where the review flow expects them. <!-- rule:android-verify-emulator-capture -->
- **Dark theme and font scale belong in the pass.** `adb shell cmd uimode night yes` flips the theme; `adb shell settings put system font_scale 1.3` (restore `1.0` after) catches the clipped labels a fixed layout hides; with several targets attached, the capture's `-s <serial>` goes on these commands too. <!-- rule:android-verify-theme-and-scale -->
- **Emulators give breadth; gestures, refresh rates, and performance need hardware.** Say which one produced the evidence. <!-- rule:android-verify-hardware-honesty -->
