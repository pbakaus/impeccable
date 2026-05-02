// Onboard command demo - shows empty state becoming helpful onboarding
export default {
  id: 'onboard',
  caption: 'Empty state → Guided onboarding experience',

  before: `
    <div style="width: 100%; max-width: 260px; padding: 24px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; text-align: center;">
      <div style="font-size: 32px; opacity: 0.3; margin-bottom: 8px;">📁</div>
      <div style="font-size: 14px; color: #999;">No items found</div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 280px; padding: 24px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 12px; text-align: center;">
      <div style="width: 64px; height: 64px; margin: 0 auto 16px; background: color-mix(in oklch, var(--color-accent) 15%, var(--color-paper)); border-radius: 16px; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 28px;">✨</span>
      </div>
      <div style="font-family: var(--font-display); font-size: 1.25rem; font-weight: 400; color: var(--color-ink); margin-bottom: 8px;">Create your first project</div>
      <div style="font-size: 0.8125rem; color: var(--color-ash); line-height: 1.5; margin-bottom: 20px;">Projects help you organize your work. Start with a template or blank canvas.</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button style="padding: 12px; background: var(--color-ink); color: var(--color-paper); border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>＋</span> New Project
        </button>
        <button style="padding: 10px; background: transparent; color: var(--color-charcoal); border: 1px solid var(--color-mist); border-radius: 8px; font-size: 0.8125rem; cursor: pointer;">Browse Templates</button>
      </div>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-mist);">
        <div style="font-size: 0.6875rem; color: var(--color-ash);">Need help? <span style="color: var(--color-accent); cursor: pointer;">Watch a quick tutorial →</span></div>
      </div>
    </div>
  `
};
