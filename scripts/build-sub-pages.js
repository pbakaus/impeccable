/**
 * Generate static HTML files for /skills, /anti-patterns, /tutorials.
 *
 * Called from both scripts/build.js (before buildStaticSite) and
 * server/index.js (at module load), so dev and prod share the same
 * code path and output shape.
 *
 * Output lives under public/docs/, public/anti-patterns/,
 * public/tutorials/, all gitignored. Bun's HTML loader picks them up
 * the same way it picks up the hand-authored pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildSubPageData,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  COMMAND_RELATIONSHIPS,
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  GALLERY_ITEMS,
} from './lib/sub-pages-data.js';
import { renderMarkdown, slugify } from './lib/render-markdown.js';
import { renderPage } from './lib/render-page.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the before/after split-compare demo block for a skill.
 * Returns '' when the skill has no demo data (e.g. /shape).
 */
function renderSkillDemo(skill) {
  if (!skill.demo) return '';
  const { before, after, caption } = skill.demo;
  return `
<section class="skill-demo" aria-label="Before and after demo">
  <div class="split-comparison" data-demo="skill-${skill.id}">
    <p class="skill-demo-eyebrow">Drag or hover to compare</p>
    <div class="split-container">
      <div class="split-before">
        <div class="split-content">${before}</div>
      </div>
      <div class="split-after">
        <div class="split-content">${after || before}</div>
      </div>
      <div class="split-divider"></div>
    </div>
    <div class="split-labels">
      <span class="split-label-item" data-point="before">Before</span>
      ${caption ? `<p class="skill-demo-caption">${escapeHtml(caption)}</p>` : '<span></span>'}
      <span class="split-label-item" data-point="after">After</span>
    </div>
  </div>
</section>`;
}

/**
 * Render one skill detail page HTML body (without the site shell).
 */
function renderSkillDetail(skill, knownSkillIds) {
  const bodyHtml = renderMarkdown(skill.body, {
    knownSkillIds,
    currentSkillId: skill.id,
  });

  const editorialHtml = skill.editorial
    ? renderMarkdown(skill.editorial.body, { knownSkillIds, currentSkillId: skill.id })
    : '';

  const demoHtml = renderSkillDemo(skill);

  const tagline = skill.editorial?.frontmatter?.tagline || skill.description;
  const categoryLabel = CATEGORY_LABELS[skill.category] || skill.category;

  // Reference files as collapsible <details> blocks
  let referencesHtml = '';
  if (skill.references && skill.references.length > 0) {
    const refs = skill.references
      .map((ref) => {
        const slug = slugify(ref.name);
        const refBody = renderMarkdown(ref.content, {
          knownSkillIds,
          currentSkillId: skill.id,
        });
        const title = ref.name
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return `
<details class="skill-reference" id="reference-${slug}">
  <summary><span class="skill-reference-label">Reference</span><span class="skill-reference-title">${escapeHtml(title)}</span></summary>
  <div class="prose skill-reference-body">
${refBody}
  </div>
</details>`;
      })
      .join('\n');
    referencesHtml = `
<section class="skill-references" aria-label="Reference material">
  <h2 class="skill-references-heading">Deeper reference</h2>
  ${refs}
</section>`;
  }

  const metaStrip = `
<div class="skill-meta-strip">
  <span class="skill-meta-chip skill-meta-category" data-category="${skill.category}">${escapeHtml(categoryLabel)}</span>
  <span class="skill-meta-chip">User-invocable</span>
  ${skill.argumentHint ? `<span class="skill-meta-chip skill-meta-args">${escapeHtml(skill.argumentHint)}</span>` : ''}
</div>`;

  const hasDemo = demoHtml.trim().length > 0;

  // Sub-commands are accessed via /impeccable <name>. Show "/impeccable" as
  // a smaller namespace label above the command name, matching the magazine
  // spread treatment so the command name stays at full display size.
  const titleHtml = skill.isSubCommand
    ? `<span class="skill-detail-title-namespace"><span class="skill-detail-title-slash">/</span>impeccable</span>${escapeHtml(skill.id)}`
    : `<span class="skill-detail-title-slash">/</span>${escapeHtml(skill.id)}`;

  return `
<article class="skill-detail">
  <div class="skill-detail-hero${hasDemo ? ' skill-detail-hero--has-demo' : ''}">
    <header class="skill-detail-header">
      <p class="skill-detail-eyebrow"><a href="/docs">Docs</a> / ${escapeHtml(categoryLabel)}</p>
      <h1 class="skill-detail-title">${titleHtml}</h1>
      <p class="skill-detail-tagline">${escapeHtml(tagline)}</p>
      ${metaStrip}
    </header>
    ${demoHtml}
  </div>

  ${editorialHtml ? `<section class="skill-detail-editorial prose">\n${editorialHtml}\n</section>` : ''}

  <section class="skill-source-card">
    <header class="skill-source-card-header">
      <span class="skill-source-card-label">${skill.isSubCommand ? 'reference/' + escapeHtml(skill.id) + '.md' : 'SKILL.md'}</span>
      <span class="skill-source-card-subtitle">${skill.isSubCommand ? 'Loaded when the impeccable skill routes to this command.' : 'The canonical skill definition your AI harness loads.'}</span>
    </header>
    <div class="skill-source-card-body prose">
${bodyHtml}
    </div>
  </section>

  ${referencesHtml}
</article>
`;
}

/**
 * Render the unified Docs sidebar used across /skills and /tutorials.
 * Shows every skill grouped by category, then tutorials as a final
 * group. Pass the current page identifier so we can mark it:
 *
 *   { kind: 'skill', id: 'polish' }
 *   { kind: 'tutorial', slug: 'getting-started' }
 *   null (no current page)
 */
function renderDocsSidebar(skillsByCategory, tutorials, current = null) {
  // Label the toggle button with the current page so mobile users know
  // where they are at a glance, then open the menu to switch.
  let currentLabel = 'Docs menu';
  if (current?.kind === 'skill') {
    currentLabel = `/${current.id}`;
  } else if (current?.kind === 'tutorial') {
    const t = tutorials.find((x) => x.slug === current.slug);
    if (t) currentLabel = t.title;
  }

  let html = `
<aside class="skills-sidebar" aria-label="Documentation">
  <button class="skills-sidebar-toggle" type="button" aria-expanded="false" aria-controls="skills-sidebar-inner">
    <span class="skills-sidebar-toggle-label">${escapeHtml(currentLabel)}</span>
    <svg class="skills-sidebar-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
  </button>
  <div class="skills-sidebar-inner" id="skills-sidebar-inner">
    <p class="skills-sidebar-label">Docs</p>
`;

  // Tutorials first: walk-throughs are the on-ramp, they go at the top.
  if (tutorials && tutorials.length > 0) {
    html += `
    <div class="skills-sidebar-group" data-category="tutorials">
      <p class="skills-sidebar-group-title">Tutorials</p>
      <ul class="skills-sidebar-list">
${tutorials
  .map((t) => {
    const isCurrent = current?.kind === 'tutorial' && current.slug === t.slug;
    const attr = isCurrent ? ' aria-current="page"' : '';
    return `        <li><a href="/tutorials/${t.slug}"${attr}>${escapeHtml(t.title)}</a></li>`;
  })
  .join('\n')}
      </ul>
    </div>
    <hr class="skills-sidebar-divider">
`;
  }

  // Then the skills, grouped by category. The root "/impeccable" entry is
  // shown with its slash; sub-commands are shown as bare names (since the
  // invocation is /impeccable <name>). Within a category the list is
  // alphabetical, except /impeccable always pins to the top of Create.
  for (const category of CATEGORY_ORDER) {
    const raw = skillsByCategory[category] || [];
    if (raw.length === 0) continue;
    const list = [...raw].sort((a, b) => {
      if (a.id === 'impeccable') return -1;
      if (b.id === 'impeccable') return 1;
      return a.id.localeCompare(b.id);
    });
    html += `
    <div class="skills-sidebar-group" data-category="${category}">
      <p class="skills-sidebar-group-title">${escapeHtml(CATEGORY_LABELS[category])}</p>
      <ul class="skills-sidebar-list">
${list
  .map((s) => {
    const isCurrent = current?.kind === 'skill' && current.id === s.id;
    const attr = isCurrent ? ' aria-current="page"' : '';
    const label = s.id === 'impeccable' ? '/impeccable' : escapeHtml(s.id);
    return `        <li><a href="/docs/${s.id}"${attr}>${label}</a></li>`;
  })
  .join('\n')}
      </ul>
    </div>
`;
  }

  html += `
  </div>
</aside>`;
  return html;
}

/**
 * Render the /skills overview main column content (not the sidebar).
 * This is the orientation piece: what skills are, how to pick one,
 * the six categories explained with inline cross-links to detail pages.
 */
function renderSkillsOverviewMain(skillsByCategory, allSkills) {
  // Build a lookup by id so we can pull taglines/descriptions for the cards.
  const skillsById = Object.fromEntries(allSkills.map((s) => [s.id, s]));
  const commandCount = allSkills.filter((s) => s.id !== 'impeccable').length;

  // Short, clean tagline for the home command card. Fall back to the editorial
  // tagline if set, otherwise use a default.
  const impeccable = skillsById['impeccable'];
  const homeTagline = impeccable?.editorial?.frontmatter?.tagline
    || 'The design intelligence behind every command.';

  // Render a single command as a compact row: name on the left, description
  // and relationship on the right. Matches the original cheatsheet density.
  const renderCommandRow = (skill) => {
    const tagline = skill.editorial?.frontmatter?.tagline || skill.description;
    const shortTagline = tagline.length > 140 ? tagline.slice(0, 137) + '...' : tagline;
    const rel = COMMAND_RELATIONSHIPS[skill.id] || {};
    const isBeta = skill.id === 'live';

    let metaHtml = '';
    if (rel.pairs) {
      metaHtml = `<div class="command-row-rel">Pairs with <a href="/docs/${rel.pairs}">${rel.pairs}</a></div>`;
    } else if (rel.leadsTo?.length) {
      const links = rel.leadsTo.map((c) => `<a href="/docs/${c}">${c}</a>`).join(', ');
      metaHtml = `<div class="command-row-rel">Leads to ${links}</div>`;
    } else if (rel.combinesWith?.length) {
      const links = rel.combinesWith.map((c) => `<a href="/docs/${c}">${c}</a>`).join(', ');
      metaHtml = `<div class="command-row-rel">Combines with ${links}</div>`;
    }

    // Row is a <div> (not an <a>) so the inner relationship links are valid.
    // The name on the left is the primary link target.
    return `
      <div class="command-row">
        <div class="command-row-name">
          <a href="/docs/${skill.id}"><span class="command-row-namespace">/impeccable</span> ${escapeHtml(skill.id)}</a>${isBeta ? ' <span class="command-row-beta">BETA</span>' : ''}
        </div>
        <div class="command-row-info">
          <p class="command-row-desc">${escapeHtml(shortTagline)}</p>
          ${metaHtml}
        </div>
      </div>`;
  };

  // Render category sections, skipping the Create category's /impeccable root
  // (shown as a hero card above) but keeping everything else in place.
  let categoriesHtml = '';
  for (const category of CATEGORY_ORDER) {
    const list = (skillsByCategory[category] || []).filter((s) => s.id !== 'impeccable');
    if (list.length === 0) continue;

    const rowsHtml = list.map(renderCommandRow).join('');

    categoriesHtml += `
    <section class="docs-category" data-category="${category}" id="category-${category}">
      <header class="docs-category-header">
        <div>
          <h2 class="docs-category-title">${escapeHtml(CATEGORY_LABELS[category])}</h2>
          <p class="docs-category-desc">${escapeHtml(CATEGORY_DESCRIPTIONS[category])}</p>
        </div>
        <span class="docs-category-count">${list.length} ${list.length === 1 ? 'command' : 'commands'}</span>
      </header>
      <div class="docs-category-rows">
${rowsHtml}
      </div>
    </section>
`;
  }

  return `
<div class="docs-overview">
  <header class="docs-overview-header">
    <p class="sub-page-eyebrow">1 skill · ${commandCount} commands</p>
    <h1 class="sub-page-title">Commands</h1>
    <p class="sub-page-lede">Impeccable gives you a shared design vocabulary with your AI. ${commandCount} commands that each encode a specific design discipline, so you can steer with precision. Pick one for the job or let the skill route you automatically.</p>
  </header>

  <section class="docs-home-card">
    <div class="docs-home-card-identity">
      <span class="docs-home-card-eyebrow">The home command</span>
      <h2 class="docs-home-card-title">/impeccable</h2>
      <p class="docs-home-card-tagline">${escapeHtml(homeTagline)}</p>
      <p class="docs-home-card-desc">Call <code>/impeccable</code> directly for freeform design work with the full guidebook loaded. Or reach for one of its specialized modes:</p>
    </div>
    <ul class="docs-home-card-modes">
      <li>
        <a href="/docs/teach">
          <span class="docs-home-mode-label"><span class="docs-home-mode-slash">/</span>impeccable teach</span>
          <span class="docs-home-mode-hint">One-time project setup. Writes PRODUCT.md, offers DESIGN.md next.</span>
        </a>
      </li>
      <li>
        <a href="/docs/document">
          <span class="docs-home-mode-label"><span class="docs-home-mode-slash">/</span>impeccable document</span>
          <span class="docs-home-mode-hint">Generate a spec-compliant DESIGN.md that captures your visual system.</span>
        </a>
      </li>
      <li>
        <a href="/docs/craft">
          <span class="docs-home-mode-label"><span class="docs-home-mode-slash">/</span>impeccable craft</span>
          <span class="docs-home-mode-hint">Full shape-then-build flow with visual iteration.</span>
        </a>
      </li>
      <li>
        <a href="/docs/live">
          <span class="docs-home-mode-label"><span class="docs-home-mode-slash">/</span>impeccable live</span>
          <span class="docs-home-mode-hint">Pick an element, get three variants, accept one. Writes back to source.</span>
        </a>
      </li>
    </ul>
  </section>

  <div class="docs-categories">
${categoriesHtml}
  </div>
</div>`;
}

/**
 * Wrap sidebar + main content in the docs-browser layout shell.
 */
function wrapInDocsLayout(sidebarHtml, mainHtml) {
  return `
<div class="skills-layout">
  ${sidebarHtml}
  <div class="skills-main">
${mainHtml}
  </div>
</div>`;
}

/**
 * Group anti-pattern rules by skill section.
 * Rules without a skillSection fall into a 'General quality' bucket.
 */
function groupRulesBySection(rules) {
  // Canonical ordering. Additional sections referenced by rules (e.g.
  // 'Interaction', 'Responsive' from LLM-only entries) are appended to
  // the end, before 'General quality', so every rule renders.
  const primaryOrder = [
    'Visual Details',
    'Typography',
    'Color & Contrast',
    'Layout & Space',
    'Motion',
    'Interaction',
    'Responsive',
  ];
  const bySection = {};
  for (const name of primaryOrder) bySection[name] = [];
  bySection['General quality'] = [];

  for (const rule of rules) {
    const section = rule.skillSection || 'General quality';
    if (!bySection[section]) bySection[section] = [];
    bySection[section].push(rule);
  }

  // Sort each bucket: slop first (they're the named tells), then quality.
  for (const name of Object.keys(bySection)) {
    bySection[name].sort((a, b) => {
      if (a.category !== b.category) return a.category === 'slop' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Final render order: primary sections first, then any extras that
  // rules introduced, then General quality last.
  const order = [...primaryOrder];
  for (const name of Object.keys(bySection)) {
    if (!order.includes(name) && name !== 'General quality') {
      order.push(name);
    }
  }
  order.push('General quality');

  return { order, bySection };
}

/**
 * Render the anti-patterns sidebar: a table of contents of rule sections
 * with per-section rule counts. Every entry anchor-jumps to the section
 * in the main column.
 */
function renderAntiPatternsSidebar(grouped) {
  const entries = grouped.order
    .filter((section) => grouped.bySection[section]?.length > 0)
    .map((section) => {
      const slug = slugify(section);
      const count = grouped.bySection[section].length;
      return `        <li><a href="#section-${slug}"><span>${escapeHtml(section)}</span><span class="anti-patterns-sidebar-count">${count}</span></a></li>`;
    })
    .join('\n');

  return `
<aside class="skills-sidebar anti-patterns-sidebar" aria-label="Anti-pattern sections">
  <button class="skills-sidebar-toggle" type="button" aria-expanded="false" aria-controls="anti-patterns-sidebar-inner">
    <span class="skills-sidebar-toggle-label">Sections</span>
    <svg class="skills-sidebar-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
  </button>
  <div class="skills-sidebar-inner" id="anti-patterns-sidebar-inner">
    <p class="skills-sidebar-label">Sections</p>
    <div class="skills-sidebar-group">
      <ul class="skills-sidebar-list anti-patterns-sidebar-list">
${entries}
      </ul>
    </div>
  </div>
</aside>`;
}

/**
 * Render one rule card inside the anti-patterns main column.
 */
function renderRuleCard(rule) {
  const categoryLabel = rule.category === 'slop' ? 'AI slop' : 'Quality';
  const layer = rule.layer || 'cli';
  const layerLabel = LAYER_LABELS[layer] || layer;
  const layerTitle = LAYER_DESCRIPTIONS[layer] || '';
  const skillLink = rule.skillSection
    ? `<a class="rule-card-skill-link" href="/docs/impeccable#${slugify(rule.skillSection)}">See in /impeccable</a>`
    : '';
  const visual = rule.visual
    ? `<div class="rule-card-visual" aria-hidden="true"><div class="rule-card-visual-inner">${rule.visual}</div></div>`
    : '';
  return `
    <article class="rule-card" id="rule-${rule.id}" data-layer="${layer}">
      ${visual}
      <div class="rule-card-body">
        <div class="rule-card-head">
          <span class="rule-card-category" data-category="${rule.category}">${categoryLabel}</span>
          <span class="rule-card-layer" data-layer="${layer}" title="${escapeAttr(layerTitle)}">${escapeHtml(layerLabel)}</span>
        </div>
        <h3 class="rule-card-name">${escapeHtml(rule.name)}</h3>
        <p class="rule-card-desc">${escapeHtml(rule.description)}</p>
        ${skillLink}
      </div>
    </article>`;
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

/**
 * Render the /tutorials index main content.
 */
function renderTutorialsIndexMain(tutorials) {
  const cards = tutorials
    .map(
      (t) => `
    <a class="tutorial-card" href="/tutorials/${t.slug}">
      <span class="tutorial-card-number">${String(t.order).padStart(2, '0')}</span>
      <div class="tutorial-card-body">
        <h2 class="tutorial-card-title">${escapeHtml(t.title)}</h2>
        <p class="tutorial-card-tagline">${escapeHtml(t.tagline || t.description)}</p>
      </div>
      <span class="tutorial-card-arrow">→</span>
    </a>`,
    )
    .join('\n');

  return `
<div class="tutorials-content">
  <header class="sub-page-header">
    <p class="sub-page-eyebrow">${tutorials.length} walk-throughs</p>
    <h1 class="sub-page-title">Tutorials</h1>
    <p class="sub-page-lede">Short, opinionated walk-throughs of the highest-leverage workflows. Each one takes around ten minutes and ends with something working in your project.</p>
  </header>

  <div class="tutorial-cards">
${cards}
  </div>
</div>`;
}

/**
 * Render the /visual-mode page main content.
 *
 * Single-column layout, no sidebar. Editorial header, live iframe embed
 * of the detector running on a synthetic slop page, three-card section
 * explaining the invocation methods, then a grid of real specimens the
 * user can click into to see the overlay on a different page.
 */
function renderVisualModeMain() {
  const specimenCards = GALLERY_ITEMS.map(
    (item) => `
      <a class="gallery-card" href="/antipattern-examples/${item.id}.html">
        <div class="gallery-card-thumb">
          <img src="../antipattern-images/${item.id}.png" alt="${escapeAttr(item.title)} specimen" loading="lazy" width="540" height="540">
        </div>
        <div class="gallery-card-body">
          <h3 class="gallery-card-title">${escapeHtml(item.title)}</h3>
          <p class="gallery-card-desc">${escapeHtml(item.desc)}</p>
        </div>
      </a>`,
  ).join('\n');

  return `
<div class="visual-mode-page">
  <header class="visual-mode-page-header">
    <p class="sub-page-eyebrow">Live detection overlay</p>
    <h1 class="sub-page-title">Visual Mode</h1>
    <p class="sub-page-lede">See every anti-pattern flagged directly on the page. No screenshots, no JSON to map back to line numbers. The overlay draws an outline and a label on every element the detector catches, so you fix them in place.</p>
  </header>

  <section class="visual-mode-demo-wrap" aria-label="Visual Mode demo">
    <div class="visual-mode-preview">
      <div class="visual-mode-preview-header">
        <span class="visual-mode-preview-dot red"></span>
        <span class="visual-mode-preview-dot yellow"></span>
        <span class="visual-mode-preview-dot green"></span>
        <span class="visual-mode-preview-title">Live on a synthetic slop page</span>
      </div>
      <iframe src="/antipattern-examples/visual-mode-demo.html" class="visual-mode-frame" loading="lazy" title="Impeccable overlay running on a demo page"></iframe>
    </div>
    <p class="visual-mode-demo-caption">Hover or tap any outlined element to see which rule fired.</p>
  </section>

  <section class="visual-mode-methods" aria-label="Where to run Visual Mode">
    <h2 class="visual-mode-methods-title">Three ways to run it</h2>
    <div class="visual-mode-methods-grid">
      <article class="visual-mode-method">
        <p class="visual-mode-method-label">Inside /impeccable critique</p>
        <h3 class="visual-mode-method-name"><a href="/docs/critique">/impeccable critique</a></h3>
        <p class="visual-mode-method-desc">The design review command opens the overlay automatically during its browser assessment pass. You get the deterministic findings highlighted in place while the LLM runs its separate heuristic review.</p>
      </article>
      <article class="visual-mode-method">
        <p class="visual-mode-method-label">Standalone CLI</p>
        <h3 class="visual-mode-method-name"><code>npx impeccable live</code></h3>
        <p class="visual-mode-method-desc">Starts a local server that serves the detector script. Inject it into any page via a <code>&lt;script&gt;</code> tag to see the overlay. Works on your own dev server, a staging URL, or anyone's live page.</p>
      </article>
      <article class="visual-mode-method">
        <p class="visual-mode-method-label">Easiest</p>
        <h3 class="visual-mode-method-name">Chrome extension</h3>
        <p class="visual-mode-method-desc">One-click activation on any tab. <a href="https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf" target="_blank" rel="noopener">Install from Chrome Web Store &rarr;</a></p>
      </article>
    </div>
  </section>

  <section class="visual-mode-gallery" id="try-it-live" aria-label="Try it on synthetic specimens">
    <header class="visual-mode-gallery-header">
      <h2 class="visual-mode-gallery-title">Try it live</h2>
      <p class="visual-mode-gallery-lede">These ${GALLERY_ITEMS.length} synthetic slop pages ship with the detector script baked in. Click any to see the overlay running on a real page, then scroll around and hover the outlined elements.</p>
    </header>
    <div class="gallery-grid">
${specimenCards}
    </div>
  </section>
</div>`;
}

/**
 * Render the animated Live Mode demo block. HTML structure matches the
 * homepage #live-demo exactly so public/js/components/live-demo.js can
 * drive it without modification. The CSS (.live-demo-*) lives in
 * public/css/live-mode.css, imported by main.css and also loaded on this
 * page via extraHead.
 */
function renderLiveModeDemo() {
  return `
<div class="live-demo" id="live-demo" aria-label="Live Mode interactive demo loop">
  <div class="live-demo-frame-col"><div class="live-demo-frame">
    <div class="live-demo-chrome">
      <span class="live-demo-dot"></span>
      <span class="live-demo-dot"></span>
      <span class="live-demo-dot"></span>
      <span class="live-demo-url">localhost:3000</span>
    </div>

    <div class="live-demo-stage">
      <div class="live-demo-skeleton" aria-hidden="true">
        <div class="live-demo-skel-nav">
          <span class="live-demo-skel-logo"></span>
          <span class="live-demo-skel-link"></span>
          <span class="live-demo-skel-link"></span>
          <span class="live-demo-skel-link"></span>
          <span class="live-demo-skel-cta"></span>
        </div>
        <div class="live-demo-skel-heading"></div>
        <div class="live-demo-skel-line"></div>
        <div class="live-demo-skel-line live-demo-skel-line--short"></div>
      </div>

      <div class="live-demo-target" data-demo-target>
        <div class="live-demo-variant is-active" data-variant="original">
          <div class="live-demo-card live-demo-card--plain">
            <span class="live-demo-card-kicker">Newsletter</span>
            <h3>Subscribe for updates</h3>
            <p>Monthly-ish design notes.</p>
            <button type="button">Subscribe</button>
          </div>
        </div>
        <div class="live-demo-variant" data-variant="1">
          <div class="live-demo-card live-demo-card--v1">
            <span class="live-demo-card-kicker">No. 04</span>
            <h3>Letters, <em>occasionally</em>.</h3>
            <p>A postcard from the editor, about once a month. No tracking pixels, no "just checking in."</p>
            <button type="button">Send me one</button>
          </div>
        </div>
        <div class="live-demo-variant" data-variant="2">
          <div class="live-demo-card live-demo-card--v2">
            <div class="live-demo-card-stamp">☞</div>
            <span class="live-demo-card-kicker">Dispatch</span>
            <h3>Design&nbsp;notes, <br>every&nbsp;other<br>Thursday.</h3>
            <button type="button">Join the list →</button>
          </div>
        </div>
        <div class="live-demo-variant" data-variant="3">
          <div class="live-demo-card live-demo-card--v3">
            <div class="live-demo-card-sticker"><span>&star;</span><span>&star;</span><span>&star;</span></div>
            <span class="live-demo-card-kicker">Field Notes</span>
            <h3>A monthly letter, for people who still read email for pleasure.</h3>
            <button type="button">Receive the letter <span aria-hidden="true">✺</span></button>
          </div>
        </div>
      </div>

      <div class="live-demo-outline" data-demo-outline aria-hidden="true"></div>

      <div class="live-demo-annotations" data-demo-annotations aria-hidden="true">
        <svg class="live-demo-stroke" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 10,40 Q 60,10 110,38 T 210,32 T 290,20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1"/>
        </svg>
        <div class="live-demo-comment">more playful</div>
      </div>

      <div class="live-demo-ctx" data-demo-ctx data-phase="hidden">
        <div class="live-demo-ctx-row live-demo-ctx-row--configure">
          <button type="button" class="live-demo-ctx-pill" data-demo-ctx-pill>
            <span data-demo-cmd-name>delight</span>
            <span class="live-demo-ctx-pill-caret" aria-hidden="true">▾</span>
          </button>
          <span class="live-demo-ctx-input" data-demo-input>
            <span data-demo-input-text></span><span class="live-demo-ctx-caret"></span>
          </span>
          <button type="button" class="live-demo-ctx-count">×3</button>
          <button type="button" class="live-demo-ctx-go" data-demo-go>Go <span aria-hidden="true">→</span></button>
        </div>
        <div class="live-demo-ctx-row live-demo-ctx-row--generating">
          <span class="live-demo-ctx-spinner" aria-hidden="true"></span>
          <span>Generating variants…</span>
        </div>
        <div class="live-demo-ctx-row live-demo-ctx-row--cycling">
          <button type="button" class="live-demo-ctx-nav" aria-label="Previous variant">‹</button>
          <span class="live-demo-ctx-counter" data-demo-counter>1 / 3</span>
          <button type="button" class="live-demo-ctx-nav" aria-label="Next variant">›</button>
          <span class="live-demo-ctx-divider"></span>
          <button type="button" class="live-demo-ctx-discard" aria-label="Discard">✕</button>
          <button type="button" class="live-demo-ctx-accept" data-demo-accept>Accept</button>
        </div>
        <div class="live-demo-ctx-row live-demo-ctx-row--accepted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Variant 3 written to source</span>
        </div>
      </div>

      <div class="live-demo-cursor" data-demo-cursor aria-hidden="true">
        <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
          <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L7.5 12 L13 12 Z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <div class="live-demo-gbar" data-demo-gbar>
      <span class="live-demo-gbar-brand">/</span>
      <button type="button" class="live-demo-gbar-btn is-active" data-demo-gbar-pick>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>
        <span>Pick</span>
      </button>
      <button type="button" class="live-demo-gbar-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button type="button" class="live-demo-gbar-btn">
        <span class="live-demo-gbar-dmd" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
      </button>
      <span class="live-demo-gbar-divider"></span>
      <button type="button" class="live-demo-gbar-x" aria-label="Exit live mode">✕</button>
    </div>
  </div>
  </div>
</div>`;
}

/**
 * Render the /live-mode page main content.
 *
 * Marketing-style single-column layout mirroring /visual-mode's structure.
 * Surfaces the animated homepage live-demo, a three-stage narrative,
 * pathway cards (tutorial / reference / install), and the supported
 * framework strip.
 */
function renderLiveModeMain() {
  return `
<div class="live-mode-page">
  <header class="live-mode-page-header">
    <p class="live-mode-page-eyebrow">New in v3.0 <span class="live-mode-page-eyebrow-badge">Beta</span></p>
    <h1 class="live-mode-page-title">Live Mode</h1>
    <p class="live-mode-page-lede">Pick any element in the browser. Drop a comment or a stroke. Three production-quality variants swap in via your framework's HMR. Accept the one you want and it writes back to source.</p>
    <div class="live-mode-start" aria-label="Start live mode command">
      <span class="live-mode-start-prompt">$</span>
      <code class="live-mode-start-cmd">/impeccable live</code>
      <button class="live-mode-start-copy" type="button" aria-label="Copy command" data-copy="/impeccable live">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>
      </button>
    </div>
  </header>

  <section class="live-mode-demo-wrap" aria-label="Live Mode interactive demo">
    ${renderLiveModeDemo()}
    <p class="live-mode-demo-caption">Click the frame or scroll it into view to start the loop. Respects <code>prefers-reduced-motion</code>.</p>
  </section>

  <section class="live-mode-stages" aria-label="What happens in a live mode session">
    <h2 class="live-mode-stages-title">What happens, in three moves</h2>
    <div class="live-mode-stages-grid">
      <article class="live-mode-stage">
        <span class="live-mode-stage-num">01 &middot; Pick</span>
        <h3 class="live-mode-stage-name">Point at what bugs you</h3>
        <p class="live-mode-stage-desc">Click any element on your running dev server. Add a comment pin where the issue lives. Draw a stroke through the bit you want to change. Or just type "more playful".</p>
        <div class="live-mode-stage-viz">
          <div class="docs-viz-picker-row" style="min-height:72px;padding:10px">
            <div class="docs-viz-picker-target" style="font-size:12px;padding:6px 12px">
              Newsletter card
              <span class="docs-viz-picker-pin" style="width:18px;height:18px;font-size:9px">1</span>
            </div>
          </div>
        </div>
      </article>
      <article class="live-mode-stage">
        <span class="live-mode-stage-num">02 &middot; Generate</span>
        <h3 class="live-mode-stage-name">Three genuinely different takes</h3>
        <p class="live-mode-stage-desc">Variants anchor to different archetypes, not three riffs on color. Each one explores a different primary axis: hierarchy, typography, density, layout, or palette strategy.</p>
        <div class="live-mode-stage-viz">
          <div class="docs-viz-variants" style="width:100%;gap:4px">
            <div class="docs-viz-variant docs-viz-variant--v1" style="min-height:44px;padding:6px"><span class="docs-viz-variant-kicker" style="font-size:8px">No.04</span></div>
            <div class="docs-viz-variant docs-viz-variant--v2 is-active" style="min-height:44px;padding:6px"><span class="docs-viz-variant-kicker" style="font-size:8px">Dispatch</span></div>
            <div class="docs-viz-variant docs-viz-variant--v3" style="min-height:44px;padding:6px"><span class="docs-viz-variant-kicker" style="font-size:8px">Field</span></div>
          </div>
        </div>
      </article>
      <article class="live-mode-stage">
        <span class="live-mode-stage-num">03 &middot; Accept</span>
        <h3 class="live-mode-stage-name">Lands in real source</h3>
        <p class="live-mode-stage-desc">The accepted variant replaces the picked element in your source file. CSS consolidates into your real stylesheet, not inline. Discard all three and the original stays.</p>
        <div class="live-mode-stage-viz">
          <span class="docs-viz-accept-pill">Variant 2 written to source</span>
        </div>
      </article>
    </div>
  </section>

  <section class="live-mode-pathways" aria-label="Where to go next">
    <h2 class="live-mode-pathways-title">Where next</h2>
    <div class="live-mode-pathways-grid">
      <a class="live-mode-pathway" href="/tutorials/iterate-live">
        <span class="live-mode-pathway-kind">Tutorial</span>
        <h3 class="live-mode-pathway-title">Walk it step by step</h3>
        <p class="live-mode-pathway-desc">A ten-minute walkthrough from first run to accepted variant. Covers CSP patching, the picker actions, and the fallback flow for generated files.</p>
        <span class="live-mode-pathway-cta">Open the tutorial &rarr;</span>
      </a>
      <a class="live-mode-pathway" href="/docs/live">
        <span class="live-mode-pathway-kind">Reference</span>
        <h3 class="live-mode-pathway-title">Full command reference</h3>
        <p class="live-mode-pathway-desc">Everything your AI harness reads when <code>/impeccable live</code> runs: the poll loop, the wrap/accept helpers, the CSP templates, and every event shape.</p>
        <span class="live-mode-pathway-cta">Read the reference &rarr;</span>
      </a>
      <a class="live-mode-pathway" href="/#downloads">
        <span class="live-mode-pathway-kind">Install</span>
        <h3 class="live-mode-pathway-title">Get Impeccable set up</h3>
        <p class="live-mode-pathway-desc">Install the skill and CLI once, then run <code>/impeccable live</code> from your AI harness. Works with Claude Code, Cursor, Codex, Gemini, and more.</p>
        <span class="live-mode-pathway-cta">See the install steps &rarr;</span>
      </a>
    </div>
  </section>

  <section class="live-mode-frameworks" aria-label="Supported frameworks">
    <span class="live-mode-frameworks-label">Supported dev servers</span>
    <ul class="live-mode-frameworks-list">
      <li>Vite</li>
      <li>Next.js (incl. monorepos)</li>
      <li>SvelteKit</li>
      <li>Astro</li>
      <li>Nuxt</li>
      <li>Bun</li>
      <li>Plain static HTML</li>
    </ul>
  </section>
</div>`;
}

/**
 * Render a tutorial detail page main content.
 */
function renderTutorialDetail(tutorial, knownSkillIds) {
  const bodyHtml = renderMarkdown(tutorial.body, { knownSkillIds });
  return `
<article class="tutorial-detail">
  <header class="tutorial-detail-header">
    <p class="skill-detail-eyebrow"><a href="/tutorials">Tutorials</a> / ${String(tutorial.order).padStart(2, '0')}</p>
    <h1 class="tutorial-detail-title">${escapeHtml(tutorial.title)}</h1>
    ${tutorial.tagline ? `<p class="tutorial-detail-tagline">${escapeHtml(tutorial.tagline)}</p>` : ''}
  </header>

  <section class="tutorial-detail-body prose">
${bodyHtml}
  </section>
</article>`;
}

/**
 * Render the /anti-patterns main column content.
 */
function renderAntiPatternsMain(grouped, totalRules) {
  let sectionsHtml = '';
  for (const section of grouped.order) {
    const rules = grouped.bySection[section] || [];
    if (rules.length === 0) continue;
    const slug = slugify(section);
    sectionsHtml += `
    <section class="anti-patterns-section" id="section-${slug}">
      <header class="anti-patterns-section-header">
        <h2 class="anti-patterns-section-title">${escapeHtml(section)}</h2>
        <p class="anti-patterns-section-count">${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}</p>
      </header>
      <div class="rule-card-grid">
${rules.map(renderRuleCard).join('\n')}
      </div>
    </section>`;
  }

  const detectedCount = grouped.order
    .flatMap((s) => grouped.bySection[s] || [])
    .filter((r) => r.layer !== 'llm').length;
  const llmCount = totalRules - detectedCount;

  return `
<div class="anti-patterns-content">
  <header class="anti-patterns-header">
    <p class="sub-page-eyebrow">${totalRules} rules</p>
    <h1 class="sub-page-title">Anti-patterns</h1>
    <p class="sub-page-lede">The full catalog of patterns <a href="/docs/impeccable">/impeccable</a> teaches against. ${detectedCount} are caught by a deterministic detector (<code>npx impeccable detect</code> or the browser extension). ${llmCount} can only be flagged by <a href="/docs/critique">/impeccable critique</a>'s LLM review pass. Want to see them live on real pages? Try <a href="/visual-mode">Visual Mode</a>, or iterate past them on your own dev server with <a href="/live-mode">Live Mode</a>.</p>
  </header>

  <details class="anti-patterns-legend">
    <summary class="anti-patterns-legend-summary">
      <span class="anti-patterns-legend-title">How to read this</span>
      <svg class="anti-patterns-legend-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </summary>
    <div class="anti-patterns-legend-body">
      <p><strong>AI slop</strong> rules flag the visible tells of AI-generated UIs. <strong>Quality</strong> rules flag general design mistakes that are not AI-specific but still hurt the work. Each rule also shows how it is detected:</p>
      <dl class="anti-patterns-legend-layers">
        <div><dt><span class="rule-card-layer" data-layer="cli">CLI</span></dt><dd>Deterministic. Runs from <code>npx impeccable detect</code> on files, no browser required.</dd></div>
        <div><dt><span class="rule-card-layer" data-layer="browser">Browser</span></dt><dd>Deterministic, but needs real browser layout. Runs via the browser extension or Puppeteer, not the plain CLI.</dd></div>
        <div><dt><span class="rule-card-layer" data-layer="llm">LLM only</span></dt><dd>No deterministic detector. Caught by <a href="/docs/critique">/impeccable critique</a> during its LLM design review.</dd></div>
      </dl>
    </div>
  </details>

  <div class="anti-patterns-sections">
${sectionsHtml}
  </div>
</div>`;
}

/**
 * Entry point. Generates all sub-page HTML files.
 *
 * @param {string} rootDir
 * @returns {Promise<{ files: string[] }>} list of generated file paths (absolute)
 */
export async function generateSubPages(rootDir) {
  const data = await buildSubPageData(rootDir);
  const outDirs = {
    docs: path.join(rootDir, 'public/docs'),
    antiPatterns: path.join(rootDir, 'public/anti-patterns'),
    tutorials: path.join(rootDir, 'public/tutorials'),
    visualMode: path.join(rootDir, 'public/visual-mode'),
    liveMode: path.join(rootDir, 'public/live-mode'),
  };

  // Fresh output dirs each time so stale files don't linger.
  for (const dir of Object.values(outDirs)) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  const generated = [];

  // Docs index: the full command reference with rich cards.
  {
    const sidebar = renderDocsSidebar(data.skillsByCategory, data.tutorials, null);
    const main = renderSkillsOverviewMain(data.skillsByCategory, data.skills);
    const html = renderPage({
      title: 'Docs | Impeccable',
      description:
        '22 commands that teach your AI harness how to design. Browse by category: create, evaluate, refine, simplify, harden.',
      bodyHtml: wrapInDocsLayout(sidebar, main),
      activeNav: 'docs',
      canonicalPath: '/docs',
      bodyClass: 'sub-page skills-layout-page',
    });
    const out = path.join(outDirs.docs, 'index.html');
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Per-command detail pages: same docs-browser shell as the overview.
  for (const skill of data.skills) {
    const sidebar = renderDocsSidebar(data.skillsByCategory, data.tutorials, { kind: 'skill', id: skill.id });
    const main = renderSkillDetail(skill, data.knownSkillIds);
    const title = skill.isSubCommand
      ? `/impeccable ${skill.id} | Impeccable`
      : `/${skill.id} | Impeccable`;
    const description = skill.editorial?.frontmatter?.tagline || skill.description;
    const html = renderPage({
      title,
      description,
      bodyHtml: wrapInDocsLayout(sidebar, main),
      activeNav: 'docs',
      canonicalPath: `/docs/${skill.id}`,
      bodyClass: 'sub-page skills-layout-page',
    });
    const out = path.join(outDirs.docs, `${skill.id}.html`);
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Anti-patterns index: single page, docs-browser shell with TOC sidebar.
  {
    const grouped = groupRulesBySection(data.rules);
    const sidebar = renderAntiPatternsSidebar(grouped);
    const main = renderAntiPatternsMain(grouped, data.rules.length);
    const html = renderPage({
      title: 'Anti-patterns | Impeccable',
      description: `${data.rules.length} deterministic detection rules that flag the visible tells of AI-generated interfaces and common quality issues. Used by npx impeccable detect and the browser extension.`,
      bodyHtml: wrapInDocsLayout(sidebar, main),
      activeNav: 'anti-patterns',
      canonicalPath: '/anti-patterns',
      bodyClass: 'sub-page skills-layout-page anti-patterns-page',
    });
    const out = path.join(outDirs.antiPatterns, 'index.html');
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Tutorials index (under the unified Docs umbrella).
  if (data.tutorials.length > 0) {
    const sidebar = renderDocsSidebar(data.skillsByCategory, data.tutorials, null);
    const main = renderTutorialsIndexMain(data.tutorials);
    const html = renderPage({
      title: 'Tutorials | Impeccable',
      description: `${data.tutorials.length} short, opinionated walk-throughs of the highest-leverage Impeccable workflows.`,
      bodyHtml: wrapInDocsLayout(sidebar, main),
      activeNav: 'docs',
      canonicalPath: '/tutorials',
      bodyClass: 'sub-page skills-layout-page tutorials-page',
    });
    const out = path.join(outDirs.tutorials, 'index.html');
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Visual Mode: single standalone page, no sidebar, single-column layout.
  {
    const html = renderPage({
      title: 'Visual Mode | Impeccable',
      description:
        'See every anti-pattern flagged directly on the page. Live detection overlay from Impeccable, available via /impeccable critique, npx impeccable live, or the upcoming Chrome extension.',
      bodyHtml: renderVisualModeMain(),
      activeNav: 'visual-mode',
      canonicalPath: '/visual-mode',
      bodyClass: 'sub-page visual-mode-page-body',
    });
    const out = path.join(outDirs.visualMode, 'index.html');
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Live Mode: marketing landing mirroring /visual-mode. Needs live-mode.css
  // (not imported by sub-pages.css to keep the base bundle small) and the
  // live-demo JS module to animate the demo.
  {
    const extraHead = `
    <link rel="stylesheet" href="../css/live-mode.css">
    <script type="module">
      import { initLiveDemo } from "../js/components/live-demo.js";
      document.addEventListener("DOMContentLoaded", initLiveDemo);
    </script>`;
    const html = renderPage({
      title: 'Live Mode | Impeccable',
      description:
        'Iterate on UI in the browser. Pick an element, drop a comment, get three production-quality variants, accept one, and it writes back to source. /impeccable live.',
      bodyHtml: renderLiveModeMain(),
      activeNav: 'live',
      canonicalPath: '/live-mode',
      bodyClass: 'sub-page live-mode-page-body',
      extraHead,
    });
    const out = path.join(outDirs.liveMode, 'index.html');
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  // Tutorial detail pages.
  for (const tutorial of data.tutorials) {
    const sidebar = renderDocsSidebar(data.skillsByCategory, data.tutorials, { kind: 'tutorial', slug: tutorial.slug });
    const main = renderTutorialDetail(tutorial, data.knownSkillIds);
    const html = renderPage({
      title: `${tutorial.title} | Tutorials | Impeccable`,
      description: tutorial.description || tutorial.tagline || '',
      bodyHtml: wrapInDocsLayout(sidebar, main),
      activeNav: 'docs',
      canonicalPath: `/tutorials/${tutorial.slug}`,
      bodyClass: 'sub-page skills-layout-page tutorials-page',
    });
    const out = path.join(outDirs.tutorials, `${tutorial.slug}.html`);
    fs.writeFileSync(out, html, 'utf-8');
    generated.push(out);
  }

  return { files: generated };
}
