// ============================================
// DEMO TOGGLES - Handle before/after toggle interactions
// ============================================

import { getCommandDemo } from './demos/commands/index.js';
import { getSkillDemo } from './demos/skills/index.js';

/**
 * Setup toggle handlers for skill demos
 */
export function setupDemoToggles() {
  document.querySelectorAll('.demo-toggle-switch').forEach(toggle => {
    // Skip if already has handler
    if (toggle.dataset.initialized) return;
    toggle.dataset.initialized = 'true';
    
    toggle.addEventListener('click', () => {
      const demoId = toggle.dataset.demo;
      const isActive = toggle.classList.toggle('active');

      // Update ARIA state
      toggle.setAttribute('aria-checked', isActive ? 'true' : 'false');

      // Update labels
      const labels = toggle.parentElement.querySelectorAll('.demo-toggle-label');
      labels[0].classList.toggle('active', !isActive);
      labels[1].classList.toggle('active', isActive);

      // Update demo state
      handleDemoToggle(demoId, isActive);
    });
  });
  
  // Setup interactive buttons
  setupInteractiveButtons();
}

/**
 * Setup toggle handlers for command demos
 */
export function setupCommandDemoToggles(allCommands, selectCommand) {
  document.querySelectorAll('.command-demo-area .demo-toggle-switch').forEach(toggle => {
    // Skip if already has handler
    if (toggle.dataset.initialized) return;
    toggle.dataset.initialized = 'true';
    
    toggle.addEventListener('click', () => {
      const demoId = toggle.dataset.demo;
      const isActive = toggle.classList.toggle('active');

      // Update ARIA state
      toggle.setAttribute('aria-checked', isActive ? 'true' : 'false');

      const labels = toggle.parentElement.querySelectorAll('.demo-toggle-label');
      labels[0].classList.toggle('active', !isActive);
      labels[1].classList.toggle('active', isActive);

      handleCommandDemoToggle(demoId, isActive);
    });
  });
  
  document.querySelectorAll('.command-detail-panel .relationship-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const commandId = tag.dataset.command;
      const command = allCommands.find(c => c.id === commandId);
      if (command) selectCommand(command);
    });
  });
}

/**
 * Setup interactive demo buttons (like the "like" button)
 */
function setupInteractiveButtons() {
  document.querySelectorAll('.int-fb-active[data-action="like"]').forEach(btn => {
    if (btn.dataset.initialized) return;
    btn.dataset.initialized = 'true';
    
    btn.addEventListener('click', () => {
      btn.classList.toggle('liked');
      const label = btn.nextElementSibling;
      if (label) {
        label.textContent = btn.classList.contains('liked') ? 'Liked!' : 'Click to try!';
      }
    });
  });
}

/**
 * Handle skill demo toggle
 */
function handleDemoToggle(demoId, isAfter) {
  const viewport = document.getElementById(`${demoId}-viewport`);
  if (!viewport) return;
  
  viewport.dataset.state = isAfter ? 'after' : 'before';
  
  // Parse skill ID and tab ID from demoId (e.g., "ux-writing-errors")
  const parts = demoId.split('-');
  const tabId = parts.pop();
  const skillId = parts.join('-');
  
  const skill = getSkillDemo(skillId);
  if (!skill) return;
  
  const tab = skill.tabs.find(t => t.id === tabId);
  if (!tab) return;
  
  // Check for custom toggle handler
  if (tab.onToggle) {
    tab.onToggle(viewport, isAfter);
    return;
  }
  
  // Check for CSS class toggle
  if (tab.beforeClass && tab.afterClass) {
    const demo = viewport.firstElementChild;
    if (demo) {
      demo.className = isAfter ? tab.afterClass : tab.beforeClass;
    }
    return;
  }
  
  // HTML swap
  if (tab.after && tab.before) {
    viewport.innerHTML = isAfter ? tab.after : tab.before;
    
    // Run after-render callback if exists
    if (isAfter && tab.onAfterRender) {
      tab.onAfterRender();
    }
  }
}

/**
 * Handle command demo toggle
 */
function handleCommandDemoToggle(demoId, isAfter) {
  // Extract command ID from demoId (e.g., "command-normalize" -> "normalize")
  const commandId = demoId.replace('command-', '');
  const demo = getCommandDemo(commandId);
  
  if (!demo) return;
  
  const viewport = document.getElementById(`${demoId}-viewport`);
  if (!viewport) return;
  
  viewport.dataset.state = isAfter ? 'after' : 'before';
  
  // Check for custom toggle handler
  if (demo.onToggle) {
    demo.onToggle(viewport, isAfter);
    return;
  }
  
  // HTML swap
  if (demo.after && demo.before) {
    viewport.innerHTML = isAfter ? demo.after : demo.before;
  }
}
