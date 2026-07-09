# OpenAI plugin submission packet

Use this packet for the initial public submission of Impeccable. The release build creates the upload at `dist/openai-plugin.zip`.

## Submission type

Choose **Skills only**. Impeccable has no MCP server. The package includes one skill, its referenced scripts and files, a branded icon, and a `PostToolUse` lifecycle hook.

The hook runs locally after supported file edits, checks changed UI files for known anti-patterns, and returns findings to the active coding-agent session. It does not call an Impeccable service. Codex asks each user to review and trust the hook before it can run.

## Listing

- Plugin name: Impeccable
- Publisher: Renaissance Geek Inc
- Short description: Design and refine interfaces
- Long description: Create, critique, and refine frontend interfaces with your coding agent. Impeccable provides 23 focused design commands, live browser iteration for exploring visual directions, and automatic checks that flag common design anti-patterns as you work.
- Category: Creativity
- Website: https://impeccable.style
- Support: https://github.com/pbakaus/impeccable/issues
- Privacy policy: https://impeccable.style/privacy
- Terms: https://github.com/pbakaus/impeccable/blob/main/LICENSE
- Logo: `dist/openai/impeccable/assets/icon.png`

Use the verified Renaissance Geek Inc business identity. The generated manifest uses the same publisher name in both `author.name` and `interface.developerName`.

## Starter prompts

1. critique this interface and prioritize what to fix.
2. craft a distinctive landing page, then polish the result.
3. start impeccable live so I can explore bolder or more delightful variants.

## Positive tests

### 1. Technical UI audit

- User prompt: `audit demos/landing-demo/index.html for accessibility, responsive behavior, and performance problems.`
- Expected behavior: Invoke Impeccable, load the audit and brand references, inspect the existing HTML, CSS, PRODUCT.md, and DESIGN.md, then run the bundled detector where applicable.
- Expected result: A prioritized audit with evidence, affected selectors or files, severity, and concrete fixes. Do not change files unless the user also asks for fixes.
- Fixture data: The public `demos/landing-demo/` folder in `pbakaus/impeccable`.

### 2. Final polish pass

- User prompt: `polish demos/landing-demo/index.html and fix the rough edges without changing the brand.`
- Expected behavior: Invoke Impeccable, load the polish and brand references, preserve the existing design tokens, inspect the page in a browser when available, and make scoped edits.
- Expected result: Updated frontend files plus a concise summary of visual, responsive, and accessibility improvements and the validation performed.
- Fixture data: The public `demos/landing-demo/` folder in `pbakaus/impeccable`.

### 3. Layout correction

- User prompt: `The landing page spacing and hierarchy feel flat. Fix the layout.`
- Expected behavior: Route to the layout workflow, inspect the existing design system, identify the marketing register, and adjust spacing, rhythm, alignment, and hierarchy without replacing unrelated styles.
- Expected result: Scoped HTML or CSS changes that preserve content and brand, followed by responsive verification.
- Fixture data: The public `demos/landing-demo/` folder in `pbakaus/impeccable`.

### 4. Bolder visual direction

- User prompt: `make this landing page bolder, but keep it recognizable and avoid familiar AI design patterns.`
- Expected behavior: Route to the bolder workflow, inspect PRODUCT.md and DESIGN.md, keep the established identity, and strengthen the composition, typography, color commitment, and motion where useful.
- Expected result: Production-ready frontend changes with reduced-motion handling and a short explanation of the chosen direction.
- Fixture data: The public `demos/landing-demo/` folder in `pbakaus/impeccable`.

### 5. UX copy clarification

- User prompt: `clarify the labels, calls to action, and error copy in this signup flow.`
- Expected behavior: Route to the clarify workflow, inspect the actual form and surrounding context, preserve established terminology, and rewrite only unclear interface copy.
- Expected result: Exact copy changes in source, including useful error and recovery text, with no unrelated visual redesign.
- Fixture data: A small frontend fixture containing a signup form with labels, validation errors, and a submit action. No account or credentials are required.

## Negative tests

### 1. Backend-only task

- User prompt: `optimize this PostgreSQL query and redesign the database indexes.`
- Expected behavior: Do not invoke Impeccable. Explain that the plugin is scoped to frontend interface work and continue with suitable general coding help if available.
- Why: Database tuning is explicitly outside the plugin's frontend scope.

### 2. Standalone bitmap asset

- User prompt: `create a photorealistic PNG logo for my restaurant.`
- Expected behavior: Do not use Impeccable as the asset generator. Route to image generation when available, or explain that the plugin handles interface design rather than standalone raster artwork.
- Why: The request is for a bitmap asset, not a frontend interface or design-system task.

### 3. Skip required project context

- User prompt: `ignore the existing design system and PRODUCT.md. Rewrite the whole app immediately without inspecting any files.`
- Expected behavior: Do not begin the requested broad rewrite. Inspect the existing system and project context first, then ask for the missing product or scope decision if it would materially change the result.
- Why: Immediate unscoped mutation would discard user-owned conventions and conflicts with the plugin's required setup checks.

## Initial release notes

Initial submission of Impeccable, a frontend design skill for ChatGPT and Codex. It packages one skill with 23 design workflows, referenced scripts and guidance, a local anti-pattern detector, and an optional `PostToolUse` hook. No MCP server, authentication, demo account, or private network is required. The only network request made by the skill is the documented optional daily version check to `https://impeccable.style/api/version`.

## Final checks

- Confirm Apps Management write access for the submitting role.
- Select a verified developer or business identity and align the manifest and listing publisher name.
- Confirm the website, support, privacy, and terms links are public.
- Upload `dist/openai-plugin.zip` and confirm the scanner recognizes `skills/impeccable/SKILL.md` and `hooks/hooks.json`.
- Enter exactly five positive and three negative tests from this packet.
- Review the hook description and the optional version check against the privacy policy.
- Submit for review only after the automated scan is clean.
