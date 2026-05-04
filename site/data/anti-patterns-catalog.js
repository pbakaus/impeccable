/**
 * Manual metadata for the /anti-patterns page.
 *
 * The detection rules themselves live in src/detect-antipatterns.mjs and
 * are parsed at build time. This file adds three pieces of content that
 * can't be automated:
 *
 *  1. DETECTION_LAYERS: which layer (cli, browser, or llm) catches the
 *     rule. Manually classified by reading the detector source and the
 *     browser-only test file.
 *
 *  2. VISUAL_EXAMPLES: a tiny inline HTML snippet showing what the
 *     bad pattern actually looks like. Rendered inside each rule card.
 *     Snippets should be self-contained with inline styles, use the
 *     cream/paper/ink palette when possible, and sit naturally at
 *     ~100% width by ~120px height.
 *
 *  3. LLM_ONLY_RULES: DON'T lines from source/skills/impeccable/SKILL.md
 *     that do not map to any detection rule. These can only be caught by
 *     the /critique skill's LLM pass. They appear on the /anti-patterns
 *     page alongside detected rules with an 'llm' layer badge.
 */

// ─── Detection layers ────────────────────────────────────────────────

/**
 * Which layer catches each rule.
 *
 *  'cli':     static analysis or jsdom (works with `npx impeccable detect`
 *             on files, no browser required)
 *  'browser': requires real browser layout (getBoundingClientRect with
 *             actual dimensions). Works via Puppeteer or the browser
 *             extension, NOT via the CLI on raw HTML.
 *  'llm':     no deterministic detector; only caught by /critique's LLM
 *             assessment pass.
 *
 * Per tests/detect-antipatterns-browser.test.mjs: only two rules genuinely
 * need real browser layout. Everything else is 'cli'.
 */
export const DETECTION_LAYERS = {
  'side-tab': 'cli',
  'border-accent-on-rounded': 'cli',
  'overused-font': 'cli',
  'single-font': 'cli',
  'flat-type-hierarchy': 'cli',
  'icon-tile-stack': 'cli',
  'gradient-text': 'cli',
  'ai-color-palette': 'cli',
  'dark-glow': 'cli',
  'nested-cards': 'cli',
  'monotonous-spacing': 'cli',
  'everything-centered': 'cli',
  'bounce-easing': 'cli',
  'all-caps-body': 'cli',
  'pure-black-white': 'cli',
  'gray-on-color': 'cli',
  'low-contrast': 'cli',
  'layout-transition': 'cli',
  'tight-leading': 'cli',
  'skipped-heading': 'cli',
  'justified-text': 'cli',
  'tiny-text': 'cli',
  'wide-tracking': 'cli',
  // Browser-only: need real layout measurements.
  'cramped-padding': 'browser',
  'line-length': 'browser',
};

export const LAYER_LABELS = {
  cli: 'CLI',
  browser: 'Browser',
  llm: 'LLM only',
};

export const LAYER_DESCRIPTIONS = {
  cli: 'Deterministic. Runs from `npx impeccable detect` on files, no browser required.',
  browser: 'Deterministic, but needs real browser layout. Runs via the browser extension or Puppeteer, not the plain CLI.',
  llm: 'Not caught by any deterministic detector. Flagged by /impeccable critique during its LLM design review.',
};

// ─── Visual examples ─────────────────────────────────────────────────

/**
 * One tiny inline HTML snippet per rule showing what the bad pattern
 * looks like. Snippets use inline styles only and are sized to fit the
 * rule card preview area (~100% wide, ~120px tall).
 */
export const VISUAL_EXAMPLES = {
  'side-tab': `<div style="background: #fff; border: 1px solid #e8e4df; border-left: 4px solid oklch(60% 0.22 265); border-radius: 6px; padding: 14px 16px; width: 220px; font-family: system-ui, sans-serif; font-size: 13px; color: #111;"><div style="font-weight: 600; margin-bottom: 4px;">Alert title</div><div style="color: #666; font-size: 12px;">Thick colored stripe on one side.</div></div>`,

  'border-accent-on-rounded': `<div style="background: #fff; border: 2px solid oklch(60% 0.22 290); border-radius: 16px; padding: 14px 18px; width: 220px; font-family: system-ui, sans-serif; font-size: 13px; color: #111;"><div style="font-weight: 600;">Rounded card</div><div style="color: #666; font-size: 12px;">Thick colored border clashes with the radius.</div></div>`,

  'overused-font': `<div style="font-family: Inter, system-ui, sans-serif; font-size: 15px; color: #111; line-height: 1.4;"><div style="font-weight: 600; margin-bottom: 4px;">Just another Inter headline</div><div style="color: #555; font-size: 13px;">Every SaaS homepage looks like this.</div></div>`,

  'single-font': `<div style="font-family: system-ui, sans-serif; font-size: 14px; color: #111;"><div style="font-size: 19px; font-weight: 600; margin-bottom: 6px;">Heading in the body font</div><div style="color: #555;">Body in the same font. No contrast. Flat.</div></div>`,

  'flat-type-hierarchy': `<div style="font-family: system-ui, sans-serif; color: #111; line-height: 1.3;"><div style="font-size: 17px; font-weight: 600;">Heading</div><div style="font-size: 16px; font-weight: 500; margin: 2px 0;">Subheading</div><div style="font-size: 15px; color: #555;">Body text at almost the same size.</div></div>`,

  'icon-tile-stack': `<div style="font-family: system-ui, sans-serif; color: #111;"><div style="width: 44px; height: 44px; border-radius: 10px; background: linear-gradient(135deg, oklch(62% 0.22 265), oklch(70% 0.20 320)); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; margin-bottom: 10px;">✦</div><div style="font-size: 14px; font-weight: 600; margin-bottom: 2px;">Feature name</div><div style="font-size: 12px; color: #666;">Rounded icon tile above heading.</div></div>`,

  'gradient-text': `<div style="font-family: system-ui, sans-serif;"><div style="font-size: 28px; font-weight: 700; background: linear-gradient(135deg, oklch(65% 0.25 320), oklch(60% 0.25 265)); -webkit-background-clip: text; background-clip: text; color: transparent; line-height: 1.1;">Build the Future</div><div style="font-size: 12px; color: #888; margin-top: 4px;">Gradient text kills scannability.</div></div>`,

  'ai-color-palette': `<div style="display: flex; gap: 6px;"><div style="width: 44px; height: 44px; border-radius: 6px; background: oklch(60% 0.22 265);"></div><div style="width: 44px; height: 44px; border-radius: 6px; background: oklch(62% 0.25 300);"></div><div style="width: 44px; height: 44px; border-radius: 6px; background: oklch(64% 0.25 340);"></div><div style="width: 44px; height: 44px; border-radius: 6px; background: oklch(70% 0.20 200);"></div></div>`,

  'dark-glow': `<div style="background: #0a0b14; padding: 18px 20px; border-radius: 10px; font-family: system-ui, sans-serif;"><div style="color: oklch(78% 0.22 280); text-shadow: 0 0 12px oklch(78% 0.22 280 / 0.7); font-size: 16px; font-weight: 600;">Neon on dark</div><div style="color: oklch(60% 0.12 260); font-size: 12px; margin-top: 4px;">Cyberpunk-by-default slop.</div></div>`,

  'nested-cards': `<div style="background: #f5f3ef; border: 1px solid #e0dcd4; border-radius: 10px; padding: 10px;"><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 8px; padding: 10px;"><div style="background: #f5f3ef; border: 1px solid #e8e4df; border-radius: 6px; padding: 8px; font-size: 12px; font-family: system-ui, sans-serif; color: #555;">Card inside card inside card.</div></div></div>`,

  'monotonous-spacing': `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;"><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; height: 48px;"></div></div>`,

  'everything-centered': `<div style="font-family: system-ui, sans-serif; text-align: center; color: #111;"><div style="font-size: 16px; font-weight: 600; margin-bottom: 6px;">Centered headline</div><div style="font-size: 12px; color: #555; margin-bottom: 10px;">Everything centered by default.</div><div style="display: inline-block; background: #111; color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 12px;">Call to action</div></div>`,

  'bounce-easing': `<div style="font-family: system-ui, sans-serif; color: #111; display: flex; align-items: center; gap: 10px;"><div style="width: 36px; height: 36px; border-radius: 50%; background: oklch(65% 0.22 265); animation: bouncey 0.9s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;"></div><div style="font-size: 12px; color: #555;">Bounce + elastic easing feels dated.</div><style>@keyframes bouncey { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }</style></div>`,

  'all-caps-body': `<div style="font-family: system-ui, sans-serif; color: #111; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.5;">Long passages in uppercase are hard to read. We recognize words by their shape, which all-caps removes.</div>`,

  'pure-black-white': `<div style="background: #ffffff; padding: 16px 18px; color: #000000; font-family: system-ui, sans-serif; font-size: 14px;"><div style="font-weight: 600; margin-bottom: 4px;">Pure black on pure white</div><div style="font-size: 12px; color: #000;">Neither exists in nature. Always tint.</div></div>`,

  'gray-on-color': `<div style="background: oklch(60% 0.20 265); padding: 16px 18px; border-radius: 6px; font-family: system-ui, sans-serif;"><div style="color: #9ca3af; font-size: 13px;">Gray text on a colored background. Washed out and hard to read.</div></div>`,

  'low-contrast': `<div style="background: #fff; padding: 16px 18px; font-family: system-ui, sans-serif;"><div style="color: #d4d4d4; font-size: 13px;">Light gray text on a white background. 1.6:1 contrast, fails WCAG.</div></div>`,

  'layout-transition': `<div style="font-family: system-ui, sans-serif; color: #111; display: flex; align-items: center; gap: 10px;"><div style="background: oklch(65% 0.22 265); border-radius: 6px; animation: janky 1.2s ease-in-out infinite; width: 60px; height: 30px;"></div><div style="font-size: 12px; color: #555;">Animating width/height causes layout jank.</div><style>@keyframes janky { 0%,100% { width: 60px; } 50% { width: 120px; } }</style></div>`,

  'cramped-padding': `<div style="font-family: system-ui, sans-serif;"><button style="background: #111; color: #fff; border: none; border-radius: 4px; padding: 2px 6px; font-size: 13px; font-weight: 500;">Buy now</button> <span style="color: #555; font-size: 12px; margin-left: 8px;">2px vertical padding.</span></div>`,

  'tight-leading': `<div style="font-family: system-ui, sans-serif; font-size: 13px; color: #111; line-height: 1.0; max-width: 220px;">Tight leading makes multi-line body text feel crammed and hard for the eye to track between lines.</div>`,

  'skipped-heading': `<div style="font-family: system-ui, sans-serif; color: #111;"><h1 style="font-size: 20px; font-weight: 700; margin: 0 0 4px;">Page title (h1)</h1><h3 style="font-size: 13px; font-weight: 600; margin: 0; color: #555;">Subsection (h3), skipped h2</h3></div>`,

  'justified-text': `<div style="font-family: system-ui, sans-serif; font-size: 12px; color: #111; text-align: justify; max-width: 230px; line-height: 1.5;">Justified text on screens creates rivers of whitespace because browsers can't hyphenate well. Leave this for print.</div>`,

  'tiny-text': `<div style="font-family: system-ui, sans-serif; color: #111;"><div style="font-size: 15px; margin-bottom: 6px;">Regular body text</div><div style="font-size: 9px; color: #555;">And then fine print at 9 pixels that no one will ever read.</div></div>`,

  'wide-tracking': `<div style="font-family: system-ui, sans-serif; font-size: 13px; color: #111; letter-spacing: 0.22em; max-width: 230px; line-height: 1.6;">Wide tracking on body text slows reading by breaking up natural character groupings.</div>`,

  'line-length': `<div style="font-family: system-ui, sans-serif; font-size: 13px; color: #111; line-height: 1.55; max-width: 100%;">Paragraphs wider than roughly 75 characters per line become fatiguing because the eye has to track an excessive distance back to the start of the next line, losing its place.</div>`,

  // ── LLM-only rule visuals ─────────────────────────────────────────

  'monospace-as-technical': `<div style="font-family: 'Courier New', monospace; color: #111;"><div style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">TECHNICAL_TOOL</div><div style="font-size: 11px; color: #555;">Mono for "developer" vibes. Lazy.</div></div>`,

  'dark-mode-default': `<div style="background: #0f1117; padding: 18px; border-radius: 8px; font-family: system-ui, sans-serif;"><div style="color: #e5e7eb; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Dark by default</div><div style="color: #9ca3af; font-size: 11px;">Defaulting to dark is a retreat from a decision.</div></div>`,

  'everything-in-cards': `<div style="background: #fff; border: 1px solid #e8e4df; border-radius: 8px; padding: 10px;"><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; padding: 8px; font-family: system-ui, sans-serif; font-size: 12px; color: #111;"><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 4px; padding: 6px;">Title</div></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; padding: 8px; margin-top: 6px; font-family: system-ui, sans-serif; font-size: 11px; color: #555;">Card around every single thing.</div></div>`,

  'identical-card-grids': `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-family: system-ui, sans-serif;">${'<div style="background: #fff; border: 1px solid #e8e4df; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px;"><div style="width: 18px; height: 18px; background: oklch(62% 0.20 265); border-radius: 4px;"></div><div style="font-size: 10px; font-weight: 600; color: #111;">Feature</div><div style="font-size: 9px; color: #888;">Short copy.</div></div>'.repeat(6)}</div>`,

  'hero-metric-layout': `<div style="font-family: system-ui, sans-serif; text-align: left;"><div style="font-size: 42px; font-weight: 800; background: linear-gradient(135deg, oklch(65% 0.25 265), oklch(65% 0.25 340)); -webkit-background-clip: text; background-clip: text; color: transparent; line-height: 1;">10M+</div><div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 2px;">Active users</div><div style="display: flex; gap: 14px; margin-top: 10px; font-size: 10px; color: #555;"><span><strong>99.9%</strong> uptime</span><span><strong>200ms</strong> p50</span></div></div>`,

  'glassmorphism': `<div style="position: relative; width: 100%; height: 100%; background: linear-gradient(135deg, oklch(70% 0.22 265), oklch(70% 0.25 340)); border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center;"><div style="background: rgba(255,255,255,0.25); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.4); border-radius: 10px; padding: 14px 18px; color: #fff; font-family: system-ui, sans-serif; font-size: 12px; font-weight: 600; box-shadow: 0 8px 30px rgba(0,0,0,0.12);">Frosted glass card</div></div>`,

  'sparkline-decoration': `<div style="background: #fff; border: 1px solid #e8e4df; border-radius: 8px; padding: 14px 16px; width: 220px; font-family: system-ui, sans-serif;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;"><div><div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.08em;">Revenue</div><div style="font-size: 20px; font-weight: 700; color: #111;">$42.1k</div></div><svg width="60" height="28" viewBox="0 0 60 28" style="flex-shrink: 0;"><polyline points="0,20 10,18 20,22 30,10 40,14 50,6 60,12" stroke="oklch(62% 0.22 265)" stroke-width="2" fill="none"/></svg></div><div style="font-size: 10px; color: #888;">Tiny chart, no real information.</div></div>`,

  'generic-drop-shadows': `<div style="display: flex; gap: 10px;"><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 10px; width: 70px; height: 70px; box-shadow: 0 10px 30px rgba(0,0,0,0.08);"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 10px; width: 70px; height: 70px; box-shadow: 0 10px 30px rgba(0,0,0,0.08);"></div><div style="background: #fff; border: 1px solid #e8e4df; border-radius: 10px; width: 70px; height: 70px; box-shadow: 0 10px 30px rgba(0,0,0,0.08);"></div></div>`,

  'modal-reflex': `<div style="position: relative; width: 100%; height: 100%; background: #f5f3ef; border-radius: 8px; overflow: hidden;"><div style="position: absolute; inset: 0; background: rgba(0,0,0,0.35);"></div><div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 8px; padding: 14px 18px; width: 200px; font-family: system-ui, sans-serif; box-shadow: 0 20px 60px rgba(0,0,0,0.2);"><div style="font-size: 13px; font-weight: 600; color: #111; margin-bottom: 4px;">Are you sure?</div><div style="font-size: 11px; color: #666; margin-bottom: 8px;">Really, truly sure about this?</div><div style="display: flex; gap: 6px; justify-content: flex-end;"><div style="background: #eee; color: #555; padding: 4px 8px; border-radius: 4px; font-size: 10px;">Cancel</div><div style="background: oklch(60% 0.22 265); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 10px;">OK</div></div></div></div>`,

  'every-button-primary': `<div style="display: flex; flex-direction: column; gap: 6px; font-family: system-ui, sans-serif;"><div style="display: flex; gap: 6px;"><button style="background: oklch(60% 0.22 265); color: #fff; border: none; border-radius: 5px; padding: 6px 12px; font-size: 11px; font-weight: 600;">Save</button><button style="background: oklch(60% 0.22 265); color: #fff; border: none; border-radius: 5px; padding: 6px 12px; font-size: 11px; font-weight: 600;">Cancel</button><button style="background: oklch(60% 0.22 265); color: #fff; border: none; border-radius: 5px; padding: 6px 12px; font-size: 11px; font-weight: 600;">Delete</button></div><div style="font-size: 10px; color: #888;">Every action shouts equally.</div></div>`,

  'redundant-headers': `<div style="font-family: system-ui, sans-serif; color: #111; max-width: 230px;"><div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">Overview</div><div style="font-size: 11px; color: #555; line-height: 1.5;">This is the overview section, which provides an overview of the overview.</div></div>`,

  'mobile-amputation': `<div style="font-family: system-ui, sans-serif;"><div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #fff; border: 1px solid #e8e4df; border-radius: 6px; margin-bottom: 4px; font-size: 12px; color: #999; text-decoration: line-through;"><span>Export to CSV</span></div><div style="font-size: 10px; color: #888; margin-top: 4px;">"Not available on mobile."</div></div>`,
};

/**
 * Anti-patterns that live in the /impeccable skill's DON'T list but
 * don't have a deterministic detector. These can only be caught by
 * /critique running an LLM assessment pass.
 *
 * Each entry looks like a detection rule: id, category, name,
 * description, skillSection. The generator merges these into the
 * grouped sections alongside detected rules with an 'llm' layer badge.
 */
// ─── Gallery: real examples in the wild ──────────────────────────────

/**
 * Curated real-world examples of anti-patterns caught in the wild.
 * Each entry maps to:
 *   - public/antipattern-images/{id}.png  (preview thumbnail)
 *   - public/antipattern-examples/{id}.html  (standalone live example)
 * Rendered as a dedicated section on the /anti-patterns page, replacing
 * the old /gallery route which was confusingly labeled in the top nav.
 */
export const GALLERY_ITEMS = [
  {
    id: 'purple-gradients',
    title: 'Purple Gradients Everywhere',
    desc:
      'The AI color palette: purple-to-blue gradients on everything. Buttons, text, backgrounds, orbs. The new "make it pop."',
  },
  {
    id: 'lazy-cool',
    title: 'Lazy "Cool"',
    desc:
      'Glassmorphism, neon glows, blurred orbs, monospace everything. Looks like a hackathon project, not a product.',
  },
  {
    id: 'lazy-impact',
    title: 'Lazy "Impact"',
    desc:
      'When in doubt, animate everything. Bouncing buttons, wiggling icons, gradient text, floating badges. Motion without meaning.',
  },
  {
    id: 'thick-border-cards',
    title: 'Side-Tab Cards',
    desc:
      'A thick colored border on one side of a rounded card. The single most recognizable tell of AI-generated UI.',
  },
  {
    id: 'cardocalypse',
    title: 'Cardocalypse',
    desc:
      'Cards inside cards inside cards. Five levels of nesting, each with its own padding and shadow.',
  },
  {
    id: 'layout-templates',
    title: 'Copy-Paste Layouts',
    desc:
      'The same hero-metric-features template repeated with different colors. When every section looks the same, nothing stands out.',
  },
  {
    id: 'inter-everywhere',
    title: 'Inter Everywhere',
    desc:
      'One font for everything. Headings, body, labels, buttons. No typographic hierarchy, no personality, no design.',
  },
  {
    id: 'massive-icons',
    title: 'Massive Icons',
    desc:
      'Icon containers larger than the content they introduce. When the decoration is bigger than the message, priorities are backwards.',
  },
  {
    id: 'bad-contrast',
    title: 'Bad Contrast Choices',
    desc:
      'Gray text on colored backgrounds, low-contrast labels, unreadable combinations. Looking good and being readable should not conflict.',
  },
  {
    id: 'redundant-ux-writing',
    title: 'Redundant UX Writing',
    desc:
      'Label, sublabel, helper text, and hint text all saying the same thing in slightly different words. Say it once, say it well.',
  },
  {
    id: 'modal-abuse',
    title: 'Modal Abuse',
    desc:
      'Complex settings crammed into a modal. If it needs a scroll bar and three columns, it deserves its own page.',
  },
];

// ─── LLM-only rules ──────────────────────────────────────────────────

export const LLM_ONLY_RULES = [
  {
    id: 'monospace-as-technical',
    category: 'slop',
    name: 'Monospace as "technical" shorthand',
    description:
      'Using a monospace typeface to signal "developer / technical" vibes. Reach for real type choices instead of a lazy stereotype.',
    skillSection: 'Typography',
  },
  {
    id: 'dark-mode-default',
    category: 'slop',
    name: 'Defaulting to dark mode for "safety"',
    description:
      'Defaulting to light mode to be safe is the inverse of defaulting to dark mode to look cool. Either way you are retreating from a decision.',
    skillSection: 'Color & Contrast',
  },
  {
    id: 'everything-in-cards',
    category: 'slop',
    name: 'Wrapping everything in cards',
    description:
      'Not every piece of content needs a bordered container. Spacing and alignment create visual grouping without the overhead of a card.',
    skillSection: 'Layout & Space',
  },
  {
    id: 'identical-card-grids',
    category: 'slop',
    name: 'Identical card grids',
    description:
      'Same-sized cards with icon + heading + text repeated endlessly. The default AI homepage layout.',
    skillSection: 'Layout & Space',
  },
  {
    id: 'hero-metric-layout',
    category: 'slop',
    name: 'Hero metric layout',
    description:
      'Big number, small label, three supporting stats, gradient accent. Used everywhere, trusted nowhere.',
    skillSection: 'Layout & Space',
  },
  {
    id: 'glassmorphism',
    category: 'slop',
    name: 'Glassmorphism everywhere',
    description:
      'Blur effects, glass cards, and glow borders used as decoration rather than to solve a real layering problem.',
    skillSection: 'Visual Details',
  },
  {
    id: 'sparkline-decoration',
    category: 'slop',
    name: 'Sparklines as decoration',
    description:
      'Tiny charts that look sophisticated but convey no meaningful information. If the data matters, give it room.',
    skillSection: 'Visual Details',
  },
  {
    id: 'generic-drop-shadows',
    category: 'slop',
    name: 'Rounded rectangles with generic drop shadows',
    description:
      'The safest, most forgettable shape on the web. Could be the output of any AI. Commit to a stronger visual treatment.',
    skillSection: 'Visual Details',
  },
  {
    id: 'modal-reflex',
    category: 'slop',
    name: 'Reaching for modals by reflex',
    description:
      'Modals interrupt the user and are lazy as a design default. Use them only when there is truly no better place for the interaction.',
    skillSection: 'Visual Details',
  },
  {
    id: 'every-button-primary',
    category: 'quality',
    name: 'Every button is a primary button',
    description:
      'When every button looks equally important, nothing reads as the primary action. Use ghost buttons, text links, and secondary styles to build hierarchy.',
    skillSection: 'Interaction',
  },
  {
    id: 'redundant-headers',
    category: 'quality',
    name: 'Redundant information',
    description:
      'Intros that restate the heading. Section labels that repeat the page title. Cards that echo their own caption. Make every word earn its place.',
    skillSection: 'Interaction',
  },
  {
    id: 'mobile-amputation',
    category: 'quality',
    name: 'Amputating features on mobile',
    description:
      'Hiding critical functionality on mobile because it is inconvenient. Adapt the interface to the context, do not strip it.',
    skillSection: 'Responsive',
  },
];
