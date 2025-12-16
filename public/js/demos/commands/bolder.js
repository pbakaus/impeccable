// Bolder command demo - shows timid design becoming bold and confident
export default {
  id: 'bolder',
  caption: 'Timid design → Bold, confident design',
  
  before: `
    <div style="text-align: center; padding: var(--spacing-md); max-width: 280px;">
      <div style="font-size: 1.125rem; font-weight: 500; margin-bottom: 8px; color: var(--color-charcoal);">Introducing Our Product</div>
      <div style="font-size: 0.875rem; color: var(--color-ash); margin-bottom: 16px;">A solution for modern teams</div>
      <button style="padding: 8px 16px; background: var(--color-mist); color: var(--color-charcoal); border: none; border-radius: 4px; font-size: 0.875rem;">Learn More</button>
    </div>
  `,
  
  after: `
    <div style="text-align: center; padding: var(--spacing-lg); max-width: 320px;">
      <div style="font-family: var(--font-display); font-size: 2.5rem; font-weight: 300; font-style: italic; margin-bottom: 12px; color: var(--color-ink); line-height: 1;">Introducing Our Product</div>
      <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-accent); margin-bottom: 24px;">A solution for modern teams</div>
      <button style="padding: 14px 32px; background: var(--color-ink); color: var(--color-paper); border: none; font-size: 0.9375rem; font-weight: 500; letter-spacing: 0.02em;">Learn More</button>
    </div>
  `
};


