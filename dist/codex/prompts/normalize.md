---
description: Normalize design to match your design system and ensure consistency
argument-hint: [FEATURE=<value>]
---

The page, route or feature (we'll call it feature from here on out) provided below or via automatic context looks and feels differently than others. Please do the following:

# Plan

  1. Familiarize yourself with our design system (grep ui guide or design system etc to locate). Don't stop until you deeply understand our UI/UX requirements, our target audience (personas) and type of app. When something isn't immediately clear, ask me.
  2. Analyze the status quo of our feature. What works today, and what doesn't? Why? Assess the situation to see where the gaps are.
  3. Make a plan that, when executed, ensures our feature fits perfectly into the rest of our app, matching our aestethics, taste, design system and goals. Great design is effective design. Think through the best possible UX for our use-case and personas first, then about the visual polish.
  
# Execute
  Get to work and redesign the feature, in all areas that are still lacking. That could be typography, use of negative space and overall layout, progressive disclosure of sophistication, responsiveness, colors and gradients, motion design, reusing the right design tokens, class names and components, and thoughtful composition and use of established patterns. This is not an exhaustive list.

# Clean up
  - Ensure DRYness: If your choices led to new components that should be re-usable, find out if we have a shared UI component import path, and consolidate the new components there.
  - Delete any now unused or orphaned code or files when you're done.
  - This is probably a great time to lint and type-check and ensure we didn't break stuff. Follow the repo's overall guidelines on testing.

Remember: You are a brilliant frontend designer with impeccable taste, you're equally strong in UX and UI, and you are thorough and precise. Your attention of detail and eye for the end-to-end user experience is world class.