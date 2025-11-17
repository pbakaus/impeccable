// Fetch and display skills and commands from the API
async function loadContent() {
  try {
    const [skillsRes, commandsRes] = await Promise.all([
      fetch('/api/skills'),
      fetch('/api/commands')
    ]);

    const skills = await skillsRes.json();
    const commands = await commandsRes.json();

    displaySkills(skills);
    displayCommands(commands);
  } catch (error) {
    console.error('Failed to load content:', error);
  }
}

function displaySkills(skills) {
  const container = document.getElementById('skills-list');
  if (!container) return;

  container.innerHTML = skills.map(skill => `
    <article class="item-card" data-animate>
      <h3><a href="https://github.com/pbakaus/vibe-design-plugins/blob/main/source/skills/${skill.id}.md" target="_blank" rel="noopener">${skill.name}</a></h3>
      <p>${skill.description}</p>
      <div class="item-downloads">
        <a href="/api/download/skill/cursor/${skill.id}" class="btn btn-small">Cursor</a>
        <a href="/api/download/skill/claude-code/${skill.id}" class="btn btn-small">Claude</a>
        <a href="/api/download/skill/gemini/${skill.id}" class="btn btn-small">Gemini</a>
        <a href="/api/download/skill/codex/${skill.id}" class="btn btn-small">Codex</a>
      </div>
    </article>
  `).join('');

  animateIn();
}

function displayCommands(commands) {
  const container = document.getElementById('commands-list');
  if (!container) return;

  container.innerHTML = commands.map(command => `
    <article class="item-card" data-animate>
      <h3><a href="https://github.com/pbakaus/vibe-design-plugins/blob/main/source/commands/${command.id}.md" target="_blank" rel="noopener">${command.name}</a></h3>
      <p>${command.description}</p>
      <div class="item-downloads">
        <a href="/api/download/command/cursor/${command.id}" class="btn btn-small">Cursor</a>
        <a href="/api/download/command/claude-code/${command.id}" class="btn btn-small">Claude</a>
        <a href="/api/download/command/gemini/${command.id}" class="btn btn-small">Gemini</a>
        <a href="/api/download/command/codex/${command.id}" class="btn btn-small">Codex</a>
      </div>
    </article>
  `).join('');

  animateIn();
}

function animateIn() {
  const elements = document.querySelectorAll('[data-animate]:not(.animated)');
  elements.forEach((el, i) => {
    el.style.animationDelay = `${i * 0.05}s`;
    el.classList.add('animated');
  });
}

// Handle bundle download clicks via event delegation
document.addEventListener('click', (e) => {
  const bundleBtn = e.target.closest('[data-bundle]');
  if (bundleBtn) {
    const { bundle: provider } = bundleBtn.dataset;
    window.location.href = `/api/download/bundle/${provider}`;
  }
});

// Load content when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadContent);
} else {
  loadContent();
}

// Animate hero on load
window.addEventListener('load', () => {
  document.body.classList.add('loaded');
});

