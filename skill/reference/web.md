# Web platform

The default platform. When PRODUCT.md's `## Platform` is `web` (or absent), this is the target.

There is no extra ruleset to load. Everything the skill already teaches assumes web: the General rules
in SKILL.md, the register reference ([brand.md](brand.md) or [product.md](product.md)), and the
responsive / cross-device reference in [adapt.md](adapt.md), which covers viewport breakpoints, touch
vs pointer input, safe-area insets, and responsive images.

Use this file as the pointer that confirms web is handled by the existing references. The native
platform references ([ios.md](ios.md), [android.md](android.md)) exist because native apps follow
platform conventions (Apple HIG, Material Design) that web does not. Web has no such external rulebook;
its conventions live in the General rules and the register.

One distinction worth keeping straight: "mobile web" is still **web**. A responsive site viewed on a
phone is web, and [adapt.md](adapt.md) owns it. The native references apply only when the deliverable
is an actual iOS or Android app (React Native, Expo, Flutter, SwiftUI, Jetpack Compose, native
toolkits), not a website that happens to render small.
