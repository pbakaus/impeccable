// ============================================
// DEMO RENDERER - Generic rendering for command and skill demos
// ============================================

import { getCommandDemo } from './demos/commands/index.js';
import { getSkillDemo } from './demos/skills/index.js';

/**
 * Render a command demo with split-screen comparison
 */
export function renderCommandDemo(commandId) {
  const demo = getCommandDemo(commandId);

  if (!demo) {
    return `
      <div class="demo-container">
        <div class="demo-viewport">
          <div style="text-align: center; color: var(--color-ash); font-style: italic; padding: var(--spacing-lg);">
            Visual demo for /${commandId} coming soon
          </div>
        </div>
      </div>
    `;
  }

  // Use split-screen comparison
  return `
    <div class="demo-split-comparison" data-demo="command-${demo.id}">
      <div class="split-container">
        <div class="split-before">
          <div class="split-content">${demo.before}</div>
        </div>
        <div class="split-after">
          <div class="split-content">${demo.after || demo.before}</div>
        </div>
        <div class="split-divider"></div>
      </div>
      <div class="demo-caption">${demo.caption}</div>
    </div>
  `;
}

/**
 * Render a skill demo (with tabs if multiple demos)
 */
export function renderSkillDemo(skillId) {
  const skill = getSkillDemo(skillId);

  if (!skill || !skill.tabs || skill.tabs.length === 0) {
    return `
      <div class="demo-container">
        <div class="demo-viewport">
          <div style="text-align: center; color: var(--color-ash); padding: var(--spacing-xl);">
            <p>Demo for ${skillId.replace(/-/g, ' ')} coming soon</p>
          </div>
        </div>
      </div>
    `;
  }

  const showTabs = skill.tabs.length > 1;

  const tabs = showTabs ? skill.tabs.map((tab, i) => `
    <button class="demo-tab ${i === 0 ? 'active' : ''}" data-demo-tab="${tab.id}" data-skill="${skillId}">
      ${tab.label}
    </button>
  `).join('') : '';

  const panels = skill.tabs.map((tab, i) => `
    <div class="demo-panel ${i === 0 ? 'active' : ''}" data-demo-panel="${tab.id}">
      ${renderSkillTabDemo(skillId, tab)}
    </div>
  `).join('');

  return `
    <div class="demo-tabbed-container">
      ${showTabs ? `<div class="demo-tabs">${tabs}</div>` : ''}
      <div class="demo-panels">
        ${panels}
      </div>
    </div>
  `;
}

/**
 * Render a single skill tab demo
 */
function renderSkillTabDemo(skillId, tab) {
  const hasToggle = tab.hasToggle !== false;
  const demoId = `${skillId}-${tab.id}`;

  return `
    <div class="demo-container">
      <div class="demo-header">
        ${hasToggle ? `
          <div class="demo-toggle">
            <span class="demo-toggle-label active">Before</span>
            <div class="demo-toggle-switch" data-demo="${demoId}"></div>
            <span class="demo-toggle-label">After</span>
          </div>
        ` : ''}
      </div>
      <div class="demo-viewport" data-state="before" id="${demoId}-viewport">
        ${tab.before}
      </div>
      <div class="demo-caption">${tab.caption}</div>
    </div>
  `;
}

/**
 * Setup demo tab switching
 */
export function setupDemoTabs() {
  document.querySelectorAll('.demo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.demoTab;
      const container = tab.closest('.demo-tabbed-container');

      container.querySelectorAll('.demo-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      container.querySelectorAll('.demo-panel').forEach(p => p.classList.remove('active'));
      container.querySelector(`[data-demo-panel="${tabId}"]`)?.classList.add('active');
    });
  });
}


