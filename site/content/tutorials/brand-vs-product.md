---
title: Brand vs product
tagline: "The setup choice that keeps Impeccable from applying the wrong design defaults."
order: 3
description: "Understand the brand/product choice in /impeccable init: marketing surfaces where the impression is the product, and app surfaces where design helps users finish a task."
---

## The short version

During `/impeccable init`, the first important choice is this:

- **Brand surface:** marketing site, landing page, campaign, portfolio, editorial page. The visitor's impression is the product.
- **Product surface:** app UI, dashboard, admin screen, workflow tool, settings page. The user is trying to finish a task.

The docs call this choice **register**. You do not need to use that word. You only need to answer which kind of surface you are working on.

## Why it matters

The same visual move can be right in one surface and wrong in another.

A campaign page can afford a huge image, a strange type choice, one dominant idea per screen, and more expressive motion. It needs to create an impression.

A dashboard usually needs density, predictable components, readable states, stable navigation, and quieter motion. It needs to help someone act quickly.

When `PRODUCT.md` stores the right choice, every command adjusts. `/impeccable typeset` will not push editorial display type into a dense admin screen. `/impeccable colorize` will not make a campaign page timid because product UIs usually need restraint.

## How to choose

Ask what the person came to do.

If they came to evaluate, trust, remember, compare, or feel a brand: choose **brand**.

Examples:

- SaaS landing page
- Product launch page
- Agency portfolio
- Restaurant homepage
- Conference site
- Case study page

If they came to configure, monitor, submit, search, compare data, or complete a workflow: choose **product**.

Examples:

- Analytics dashboard
- Checkout flow
- Settings screen
- Admin table
- Onboarding flow inside an app
- Internal operations tool

## Mixed projects

Many codebases have both. A SaaS project can have a brand landing page and a product dashboard.

Set the project default to the surface you work on most, then be specific in the command:

```
/impeccable polish the marketing homepage as a brand surface
```

```
/impeccable audit the billing settings as a product surface
```

You can also edit `PRODUCT.md` directly if the default is wrong.

## Common mistakes

- **Calling everything product because it is a software company.** A landing page is still a brand surface.
- **Calling everything brand because the visual identity matters.** A dashboard can be on-brand and still be a product surface.
- **Skipping the choice.** Impeccable can still work, but it will ask more questions and lean on safer defaults.
