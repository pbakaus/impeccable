// Normalize command demo - shows inconsistent styles becoming systematic
export default {
  id: 'normalize',
  caption: 'Inconsistent styles → Systematic design tokens',
  
  before: `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 260px;">
      <div style="padding: 12px 16px; background: #f0f0f0; border-radius: 6px;">
        <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">Card One</div>
        <div style="font-size: 13px; color: #888;">Some description text here</div>
      </div>
      <div style="padding: 18px 12px; background: #e8e8e8; border-radius: 12px;">
        <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">Card Two</div>
        <div style="font-size: 14px; color: #666;">Different spacing and styles</div>
      </div>
      <div style="padding: 10px 20px; background: #f5f5f5; border-radius: 4px;">
        <div style="font-size: 15px; font-weight: 700; margin-bottom: 2px;">Card Three</div>
        <div style="font-size: 12px; color: #999;">Yet another variation</div>
      </div>
    </div>
  `,
  
  after: `
    <div style="display: flex; flex-direction: column; gap: var(--spacing-sm); width: 100%; max-width: 260px;">
      <div style="padding: var(--spacing-md); background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 0.9375rem; font-weight: 600; margin-bottom: 4px; color: var(--color-ink);">Card One</div>
        <div style="font-size: 0.8125rem; color: var(--color-ash);">Consistent description text</div>
      </div>
      <div style="padding: var(--spacing-md); background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 0.9375rem; font-weight: 600; margin-bottom: 4px; color: var(--color-ink);">Card Two</div>
        <div style="font-size: 0.8125rem; color: var(--color-ash);">Same spacing and styles</div>
      </div>
      <div style="padding: var(--spacing-md); background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 0.9375rem; font-weight: 600; margin-bottom: 4px; color: var(--color-ink);">Card Three</div>
        <div style="font-size: 0.8125rem; color: var(--color-ash);">Unified design system</div>
      </div>
    </div>
  `
};


