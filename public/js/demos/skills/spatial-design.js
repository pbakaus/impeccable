// Spatial Design skill demos
export default {
  id: 'spatial-design',
  tabs: [
    {
      id: 'grid',
      label: 'Grid Systems',
      caption: 'Chaotic placement vs intentional grid alignment',
      before: `
        <div class="spatial-demo spatial-grid-before">
          <div class="spatial-card-item" style="width: 45%;">Card One</div>
          <div class="spatial-card-item" style="width: 30%;">Card Two</div>
          <div class="spatial-card-item" style="width: 55%;">Card Three</div>
          <div class="spatial-card-item" style="width: 25%;">Card Four</div>
        </div>
      `,
      after: `
        <div class="spatial-demo spatial-grid-after">
          <div class="spatial-card-item">Card One</div>
          <div class="spatial-card-item">Card Two</div>
          <div class="spatial-card-item">Card Three</div>
          <div class="spatial-card-item">Card Four</div>
        </div>
      `
    },
    {
      id: 'hierarchy',
      label: 'Visual Weight',
      caption: 'Equal weight vs clear visual priority',
      beforeClass: 'spatial-demo spatial-hierarchy-before',
      afterClass: 'spatial-demo spatial-hierarchy-after',
      before: `
        <div class="spatial-demo spatial-hierarchy-before">
          <div class="spatial-h-title">Welcome Back</div>
          <div class="spatial-h-subtitle">Dashboard</div>
          <div class="spatial-h-cta">View Reports</div>
          <div class="spatial-h-link">Settings</div>
        </div>
      `,
      after: null // Uses CSS class toggle
    },
    {
      id: 'whitespace',
      label: 'Breathing Room',
      caption: 'Cramped elements vs comfortable spacing',
      beforeClass: 'spatial-demo spatial-whitespace-before',
      afterClass: 'spatial-demo spatial-whitespace-after',
      before: `
        <div class="spatial-demo spatial-whitespace-before">
          <div class="spatial-ws-title">Premium Plan</div>
          <div class="spatial-ws-price">$29/mo</div>
          <div class="spatial-ws-features">Unlimited projects • Priority support • Advanced analytics</div>
          <button class="spatial-ws-btn">Upgrade Now</button>
        </div>
      `,
      after: null // Uses CSS class toggle
    }
  ]
};


