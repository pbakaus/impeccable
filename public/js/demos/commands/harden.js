// Harden command demo - shows error handling and edge cases
export default {
  id: 'harden',
  caption: 'Fragile UI → Robust error handling',

  before: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 8px;">
      <div style="padding: 16px; background: #fff0f0; border-radius: 6px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
        <div style="font-size: 14px; color: #cc0000; font-weight: 500;">Error</div>
        <div style="font-size: 12px; color: #888; margin-top: 4px;">Something went wrong</div>
        <button style="margin-top: 12px; padding: 6px 12px; background: #ddd; border: none; border-radius: 4px; font-size: 12px; color: #666;">OK</button>
      </div>
      <div style="padding: 12px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">Form Input</div>
        <input type="text" value="invalid@" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;">
      </div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 8px;">
      <div style="padding: 16px; background: color-mix(in oklch, var(--color-accent) 8%, var(--color-paper)); border: 1px solid color-mix(in oklch, var(--color-accent) 20%, var(--color-paper)); border-radius: 8px;">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="width: 32px; height: 32px; background: var(--color-accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <span style="color: white; font-size: 16px;">!</span>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 0.875rem; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">Connection failed</div>
            <div style="font-size: 0.8125rem; color: var(--color-charcoal); line-height: 1.4;">Unable to reach the server. Check your internet connection and try again.</div>
            <button style="margin-top: 12px; padding: 8px 16px; background: var(--color-accent); color: white; border: none; border-radius: 6px; font-size: 0.8125rem; font-weight: 500; cursor: pointer;">Retry Connection</button>
          </div>
        </div>
      </div>
      <div style="padding: 12px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 11px; color: var(--color-ash); margin-bottom: 4px;">Email Address</div>
        <input type="text" value="invalid@" style="width: 100%; padding: 8px; border: 2px solid #ef4444; border-radius: 4px; font-size: 13px; box-sizing: border-box; background: #fef2f2;">
        <div style="font-size: 11px; color: #ef4444; margin-top: 4px;">Please enter a complete email address</div>
      </div>
    </div>
  `
};
