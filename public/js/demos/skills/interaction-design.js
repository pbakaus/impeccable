// Interaction Design skill demos
export default {
  id: 'interaction-design',
  tabs: [
    {
      id: 'states',
      label: 'Button States',
      caption: 'Missing states vs complete interaction feedback',
      // This demo shows both states side-by-side, no toggle needed
      hasToggle: false,
      before: `
        <div class="int-demo int-states-demo">
          <div class="int-state-row">
            <span class="int-state-label">Poor</span>
            <button class="int-btn int-btn-poor">Click Me</button>
          </div>
          <div class="int-state-row">
            <span class="int-state-label">Good</span>
            <button class="int-btn int-btn-good">Click Me</button>
          </div>
        </div>
      `
    },
    {
      id: 'affordance',
      label: 'Affordances',
      caption: 'Unclear actions vs obvious clickability',
      beforeClass: 'int-demo int-affordance-before',
      afterClass: 'int-demo int-affordance-after',
      before: `
        <div class="int-demo int-affordance-before">
          <div class="int-aff-item int-aff-poor">
            <span>Learn more</span>
          </div>
          <div class="int-aff-item int-aff-poor">
            <span>Settings</span>
          </div>
        </div>
      `,
      after: null // Uses CSS class toggle
    },
    {
      id: 'feedback',
      label: 'Feedback',
      caption: 'Silent actions vs immediate confirmation',
      before: `
        <div class="int-demo int-feedback-before">
          <button class="int-fb-btn int-fb-silent">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
          <span class="int-fb-label">Click — nothing happens</span>
        </div>
      `,
      after: `
        <div class="int-demo int-feedback-after">
          <button class="int-fb-btn int-fb-active" data-action="like">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
          <span class="int-fb-label">Click to try!</span>
        </div>
      `,
      onAfterRender: () => {
        // Setup interactive like button
        document.querySelectorAll('.int-fb-active[data-action="like"]').forEach(btn => {
          btn.addEventListener('click', () => {
            btn.classList.toggle('liked');
            const label = btn.nextElementSibling;
            if (label) {
              label.textContent = btn.classList.contains('liked') ? 'Liked!' : 'Click to try!';
            }
          });
        });
      }
    }
  ]
};


