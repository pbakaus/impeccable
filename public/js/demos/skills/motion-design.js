// Motion Design skill demos
export default {
  id: 'motion-design',
  tabs: [
    {
      id: 'stagger',
      label: 'Staggered Reveal',
      caption: 'Instant appearance vs orchestrated reveal',
      before: `
        <div class="motion-demo motion-stagger-demo">
          <div class="motion-list-item"><span class="motion-dot"></span>Dashboard</div>
          <div class="motion-list-item"><span class="motion-dot"></span>Analytics</div>
          <div class="motion-list-item"><span class="motion-dot"></span>Settings</div>
          <div class="motion-list-item"><span class="motion-dot"></span>Profile</div>
        </div>
      `,
      after: null, // CSS animation triggered by data-state
      onToggle: (viewport, isAfter) => {
        if (isAfter) {
          // Re-trigger animation by cloning elements
          const items = viewport.querySelectorAll('.motion-list-item');
          items.forEach(item => {
            const clone = item.cloneNode(true);
            item.parentNode.replaceChild(clone, item);
          });
        }
      }
    },
    {
      id: 'micro',
      label: 'Micro-interactions',
      caption: 'Static button vs responsive feedback',
      before: `
        <div class="motion-demo motion-micro-demo">
          <button class="motion-btn motion-btn-before">Add to Cart</button>
        </div>
      `,
      after: `
        <div class="motion-demo motion-micro-demo">
          <button class="motion-btn motion-btn-after">Add to Cart</button>
        </div>
      `
    },
    {
      id: 'transition',
      label: 'State Changes',
      caption: 'Jarring change vs smooth transition',
      before: `
        <div class="motion-demo motion-transition-demo">
          <div class="motion-card motion-card-before">
            <div class="motion-card-icon">📦</div>
            <div class="motion-card-text">Order Placed</div>
          </div>
        </div>
      `,
      after: `
        <div class="motion-demo motion-transition-demo">
          <div class="motion-card motion-card-after">
            <div class="motion-card-icon">✓</div>
            <div class="motion-card-text">Order Confirmed</div>
          </div>
        </div>
      `
    }
  ]
};


