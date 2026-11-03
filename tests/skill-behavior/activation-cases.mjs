/**
 * Fixtures for the skill-activation eval (activation.eval.mjs).
 *
 * COMPETITORS is the rest of the simulated skill listing: realistic neighbours,
 * several deliberately close to the boundary (frontend-dev, docs-writer,
 * dataviz, brand-identity). impeccable is inserted in the middle of the list.
 *
 * CASES: expect true means impeccable should load, false means it should not.
 * Ids ending in _744 come from the pinned case set in issue #744 (verbatim).
 * cat groups cases for the per-category report; positives cover every command
 * family, document-shaped requests and native UI; negatives cover clear non-UI
 * work plus near neighbours (frontend code with no visual decision, or a visual
 * decision that is not an interface).
 */

export const COMPETITORS = [
  ['frontend-dev', 'Implement and debug frontend features in React, Vue, Svelte, or Next.js: components, state management, routing, data fetching, forms and validation, build tooling, and browser bugs. Use for writing or fixing frontend code.'],
  ['docs-writer', 'Write and improve technical documentation: READMEs, API references, guides, tutorials, changelogs, and docstrings. Use when the user asks to write, restructure, or edit documentation for a codebase or library.'],
  ['code-review', 'Review a diff, branch, or pull request for correctness bugs, security issues, and maintainability problems, and report findings by severity. Use when the user asks for a code review.'],
  ['test-writer', 'Write and fix unit, integration, and end-to-end tests (Jest, Vitest, pytest, Playwright). Use when the user asks to add tests, improve coverage, or fix failing tests.'],
  ['pdf', 'Read, create, merge, split, and fill PDF files, including form fields, OCR, watermarks, and text or table extraction. Use whenever a .pdf file is involved.'],
  ['xlsx', 'Create, read, and edit spreadsheets (.xlsx, .csv): formulas, formatting, cleaning messy tabular data, and charts inside workbooks. Use when a spreadsheet is the input or output.'],
  ['dataviz', 'Use before creating any chart, graph, plot, or data visualization in any medium: chart type choice, color palettes, axes, legends, and tooltips.'],
  ['sql-helper', 'Write, explain, and optimize SQL queries and schemas for Postgres, MySQL, and SQLite, including indexes, query plans, and migrations.'],
  ['ci-config', 'Create and debug CI/CD pipelines: GitHub Actions, GitLab CI, CircleCI, caching, matrices, secrets, and deployment workflows.'],
  ['brand-identity', 'Develop brand identity: naming, logos and wordmarks, brand voice, and brand guidelines for print and marketing collateral.'],
  ['security-review', 'Audit code for security vulnerabilities such as injection, auth flaws, secrets in source, and unsafe dependencies.'],
];

export const CASES = [
  // build / redesign
  { id: 'hero_direction_744', cat: 'build', expect: true, prompt: 'src/routes/landing.tsx is our hero and it reads like a wireframe - system font, one blue button, no hierarchy. Give it a real visual direction and build it: type, colour, spacing, the lot. Decide the direction yourself.' },
  { id: 'landing_new', cat: 'build', expect: true, prompt: 'Build a landing page for our new invoicing product in src/routes/index.tsx. Make it look great.' },
  { id: 'pricing_page', cat: 'build', expect: true, prompt: 'We need a pricing page with three tiers and a comparison table. Add it at src/routes/pricing.tsx.' },
  { id: 'redesign_site', cat: 'build', expect: true, prompt: 'Our marketing site looks like every other SaaS template. Redesign the homepage so it actually stands out.' },
  { id: 'forgettable_usage_744', cat: 'bolder', expect: true, prompt: 'src/routes/usage.tsx is the screen our customers stare at every day and it is competent and completely forgettable - three grey boxes and a bare table. Make it something they would remember, and build it.' },
  { id: 'quieter', cat: 'quieter', expect: true, prompt: 'The dashboard is way too loud: gradients everywhere, five accent colors, everything bold. Tone it down so it feels calm and professional.' },
  // review family
  { id: 'polish', cat: 'polish', expect: true, prompt: 'The checkout flow works but feels rough around the edges. Do a final pass on it before we ship tomorrow.' },
  { id: 'audit', cat: 'audit', expect: true, prompt: 'Audit the frontend in src/ for quality issues: accessibility, performance, theming, responsive problems. Give me a prioritized list.' },
  { id: 'critique', cat: 'critique', expect: true, prompt: 'Be honest: what is wrong with our signup page from a UX perspective? Screenshot is in docs/signup.png.' },
  { id: 'settings_rework_744', cat: 'layout', expect: true, prompt: 'Go through src/routes/settings.tsx and tell me where it falls down on hierarchy, grouping and the destructive action sitting next to Save, then rework it.' },
  { id: 'a11y_review', cat: 'a11y', expect: true, prompt: 'Check our modal and form components for accessibility problems: focus handling, contrast, labels, keyboard use.' },
  // craft topics
  { id: 'typography', cat: 'typography', expect: true, prompt: 'The fonts on our blog feel off. Pick a better type pairing and fix the scale and line lengths.' },
  { id: 'color', cat: 'color', expect: true, prompt: 'Our app is all grey. Add some color to it without making it garish, and give it a proper dark mode.' },
  { id: 'layout_spacing', cat: 'layout', expect: true, prompt: 'Everything on the account page feels cramped and misaligned. Fix the spacing and alignment.' },
  { id: 'motion', cat: 'motion', expect: true, prompt: 'Add some tasteful micro-interactions and transitions to the sidebar and cards so the app feels more alive.' },
  { id: 'ux_copy', cat: 'copy', expect: true, prompt: 'Rewrite the button labels, error messages and empty-form hints in the signup flow; right now they are confusing and robotic.' },
  { id: 'onboarding', cat: 'onboarding', expect: true, prompt: 'New users drop off after signup. Create a first-run onboarding experience for the web app that gets them to their first project.' },
  { id: 'empty_state_744', cat: 'onboarding', expect: true, prompt: 'A brand new workspace lands on src/routes/usage.tsx with no rows at all, so it just shows three zeroes and an empty table. Work out what someone arriving for the first time should see there instead, and build it.' },
  { id: 'dashboard', cat: 'build', expect: true, prompt: 'Build an admin dashboard showing signups, revenue and churn, with a recent-activity table.' },
  { id: 'responsive', cat: 'responsive', expect: true, prompt: 'The nav and the pricing cards break on phones: they overflow and the text is tiny. Fix it for mobile.' },
  { id: 'harden_errors', cat: 'harden', expect: true, prompt: 'Make the file upload component handle the ugly cases well: long filenames, errors, slow networks, 0 files, 500 files.' },
  { id: 'ui_performance', cat: 'optimize', expect: true, prompt: 'The product list stutters when you scroll and the filters feel sluggish on mid-range laptops. Make the interface feel fast.' },
  { id: 'clarify_distill', cat: 'distill', expect: true, prompt: 'The project creation form has 14 fields and people abandon it. Simplify it.' },
  { id: 'component', cat: 'build', expect: true, prompt: 'Make a nice-looking date range picker component for our design system.' },
  { id: 'overdrive', cat: 'overdrive', expect: true, prompt: 'I want the hero of our portfolio to have a jaw-dropping WebGL effect that reacts to the cursor.' },
  { id: 'live_iterate', cat: 'live', expect: true, prompt: 'Open the app in the browser and let me iterate on a few variants of the hero card visually.' },
  // document-shaped design requests (#744 weakness)
  { id: 'completion_744', cat: 'document', expect: true, prompt: 'Work out the visual system this codebase is already using - type scale, colour, spacing, component patterns - and write it down at the project root, in the file a later session would look for, so a new contributor can pick it up without asking.' },
  { id: 'design_md', cat: 'document', expect: true, prompt: 'Write a DESIGN.md for this app.' },
  { id: 'document_ds', cat: 'document', expect: true, prompt: 'Document our design system: colors, type, spacing, and the core components.' },
  { id: 'extract_tokens', cat: 'document', expect: true, prompt: 'Pull the hard-coded colors and spacing values out of our components into reusable design tokens.' },
  { id: 'style_guide', cat: 'document', expect: true, prompt: 'Create a style guide for the frontend so new screens stay consistent with the existing ones.' },
  // native
  { id: 'ios_screen', cat: 'native', expect: true, prompt: 'Our SwiftUI settings screen looks dated. Redesign it so it feels like a modern iOS app.' },
  { id: 'android_compose', cat: 'native', expect: true, prompt: 'Polish the Jetpack Compose home screen: spacing, typography and the bottom bar feel off.' },
  { id: 'rn_onboarding', cat: 'native', expect: true, prompt: 'Design the onboarding screens for our React Native app.' },

  // negatives: clear non-UI
  { id: 'backend_bug', cat: 'neg-backend', expect: false, prompt: 'POST /api/orders returns 500 when the cart has a discount code. Find and fix the bug in api/orders.ts.' },
  { id: 'sql', cat: 'neg-backend', expect: false, prompt: 'Write a SQL query that returns the top 10 customers by revenue for each month of 2025.' },
  { id: 'slow_query_744', cat: 'neg-backend', expect: false, prompt: 'This Postgres query for monthly revenue takes 12 seconds on 4M rows. Work out which index it is missing.' },
  { id: 'api_readme', cat: 'neg-docs', expect: false, prompt: 'Write a README for our REST API in api/: setup, auth, and example requests for each endpoint.' },
  { id: 'jsdoc', cat: 'neg-docs', expect: false, prompt: 'Add docstrings to every exported function in src/lib/.' },
  { id: 'unit_tests', cat: 'neg-tests', expect: false, prompt: 'Add unit tests for src/lib/pricing.ts; it has no coverage at all.' },
  { id: 'ci_config', cat: 'neg-ci', expect: false, prompt: 'Set up a GitHub Actions workflow that runs lint and tests on every pull request and caches node_modules.' },
  { id: 'refactor', cat: 'neg-refactor', expect: false, prompt: 'Refactor src/lib/api-client.ts to use async/await instead of promise chains and remove the duplicated retry logic.' },
  { id: 'pdf_form', cat: 'neg-pdf', expect: false, prompt: 'Fill out the W-9 PDF form in docs/w9.pdf with our company details from company.json.' },
  { id: 'data_analysis', cat: 'neg-data', expect: false, prompt: 'Analyze data/sales.csv and tell me which regions grew fastest last quarter.' },
  { id: 'code_review', cat: 'neg-review', expect: false, prompt: 'Review my current diff for bugs before I merge.' },
  { id: 'dep_upgrade', cat: 'neg-refactor', expect: false, prompt: 'Upgrade the project from React 18 to React 19 and fix whatever breaks in the build.' },
  { id: 'cli_script', cat: 'neg-backend', expect: false, prompt: 'Write a Python script that renames every photo in a folder by its EXIF date.' },
  // negatives: near neighbours from #744 (frontend code, no visual decision; or visual but not an interface)
  { id: 'undefined_email_744', cat: 'neg-near', expect: false, prompt: 'src/components/InviteForm.tsx throws "Cannot read properties of undefined (reading \'toLowerCase\')" when a member row arrives with no email. Fix the crash. Nothing on screen changes.' },
  { id: 'cta_instrumentation_744', cat: 'neg-near', expect: false, prompt: 'When the "Start free" button in src/routes/landing.tsx first scrolls into view, send a cta_seen event to our analytics with the visitor\'s plan tier. Use an IntersectionObserver and fire it once per session. Nothing on screen changes.' },
  { id: 'token_substitution_744', cat: 'neg-near', expect: false, prompt: 'Every literal in src/components/Badge.tsx already exists as a custom property in src/tokens.css. Swap the literals for the variables. This is a find-and-replace - do not add, remove or change a single value, and the rendered pixels must be identical afterwards.' },
  { id: 'double_submit_744', cat: 'neg-near', expect: false, prompt: 'The button in src/components/PlanPicker.tsx fires onChoose twice if you click it quickly, and the workspace ends up on whichever PATCH resolves last. Guard the handler so a second click while one is in flight does nothing. Nothing on screen changes.' },
  { id: 'wordmark_744', cat: 'neg-near', expect: false, prompt: 'Read brand/brief.md and give me three directions for the wordmark itself - the letterforms and the mark. Not where it sits on a page, the mark.' },
  { id: 'print_booklet_744', cat: 'neg-near', expect: false, prompt: 'Read print/investor-brief.md. For the printed pages, decide which chart types carry those four figures and what colour palette survives CMYK on uncoated stock at that dot gain. Print only - there is no screen version and there never will be.' },
  { id: 'redux_state', cat: 'neg-near', expect: false, prompt: 'Move the cart state in our React app from prop drilling to a Zustand store. No visual changes.' },
];
