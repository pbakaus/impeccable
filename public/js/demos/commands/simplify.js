// Simplify command demo - shows cluttered UI becoming minimal
export default {
  id: 'simplify',
  caption: 'Cluttered interface → Essential elements only',

  before: `
    <div style="width: 100%; max-width: 280px; padding: 12px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #ddd;">
        <span style="font-size: 12px; color: #666;">Dashboard</span>
        <div style="display: flex; gap: 4px;">
          <button style="padding: 2px 6px; font-size: 10px; background: #e0e0e0; border: none; border-radius: 2px;">⚙️</button>
          <button style="padding: 2px 6px; font-size: 10px; background: #e0e0e0; border: none; border-radius: 2px;">🔔</button>
          <button style="padding: 2px 6px; font-size: 10px; background: #e0e0e0; border: none; border-radius: 2px;">❓</button>
          <button style="padding: 2px 6px; font-size: 10px; background: #e0e0e0; border: none; border-radius: 2px;">⋮</button>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <div style="padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 10px; color: #666;">Revenue<br><b>$12,345</b></div>
        <div style="padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 10px; color: #666;">Users<br><b>1,234</b></div>
        <div style="padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 10px; color: #666;">Growth<br><b>+12%</b></div>
        <div style="padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 10px; color: #666;">Bounce<br><b>32%</b></div>
      </div>
      <div style="margin-top: 8px; padding: 8px; background: #e3f2fd; border-radius: 4px; font-size: 10px; color: #1976d2;">📊 View detailed analytics →</div>
      <div style="margin-top: 4px; padding: 8px; background: #fff3e0; border-radius: 4px; font-size: 10px; color: #e65100;">🎯 Set up goals →</div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 260px; padding: 20px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 8px;">
      <div style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-ash); margin-bottom: 16px;">This Month</div>
      <div style="margin-bottom: 20px;">
        <div style="font-family: var(--font-display); font-size: 2.5rem; font-weight: 300; color: var(--color-ink); line-height: 1;">$12,345</div>
        <div style="font-size: 0.8125rem; color: #22c55e; margin-top: 4px;">↑ 12% from last month</div>
      </div>
      <div style="display: flex; gap: 24px;">
        <div>
          <div style="font-size: 1.25rem; font-weight: 500; color: var(--color-ink);">1,234</div>
          <div style="font-size: 0.6875rem; color: var(--color-ash);">Active users</div>
        </div>
        <div>
          <div style="font-size: 1.25rem; font-weight: 500; color: var(--color-ink);">68%</div>
          <div style="font-size: 0.6875rem; color: var(--color-ash);">Retention</div>
        </div>
      </div>
    </div>
  `
};
