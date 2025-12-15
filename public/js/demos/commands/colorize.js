// Colorize command demo - shows monochrome becoming strategically colored
export default {
  id: 'colorize',
  caption: 'Monochrome UI → Strategic, harmonious color',

  before: `
    <div style="width: 100%; max-width: 240px; padding: 16px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 6px;">
      <div style="font-size: 11px; color: #999; margin-bottom: 12px;">TASK OVERVIEW</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px;">
          <div style="width: 8px; height: 8px; background: #ccc; border-radius: 2px;"></div>
          <span style="font-size: 12px; color: #666;">Design review</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px;">
          <div style="width: 8px; height: 8px; background: #ccc; border-radius: 2px;"></div>
          <span style="font-size: 12px; color: #666;">Update copy</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: white; border: 1px solid #e0e0e0; border-radius: 4px;">
          <div style="width: 8px; height: 8px; background: #ccc; border-radius: 2px;"></div>
          <span style="font-size: 12px; color: #666;">Final QA</span>
        </div>
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
        <div style="font-size: 11px; color: #999;">Progress: 1 of 3</div>
      </div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 240px; padding: 16px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 8px;">
      <div style="font-size: 0.6875rem; letter-spacing: 0.08em; color: var(--color-ash); margin-bottom: 12px;">TASK OVERVIEW</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: color-mix(in oklch, var(--color-accent) 8%, var(--color-paper)); border: 1px solid color-mix(in oklch, var(--color-accent) 20%, var(--color-paper)); border-radius: 6px;">
          <div style="width: 18px; height: 18px; background: var(--color-accent); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">✓</div>
          <span style="font-size: 0.8125rem; color: var(--color-ink); text-decoration: line-through; opacity: 0.6;">Design review</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--color-paper); border: 2px solid var(--color-accent); border-radius: 6px;">
          <div style="width: 18px; height: 18px; border: 2px solid var(--color-accent); border-radius: 4px; background: white;"></div>
          <span style="font-size: 0.8125rem; color: var(--color-ink); font-weight: 500;">Update copy</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
          <div style="width: 18px; height: 18px; border: 1px solid var(--color-mist); border-radius: 4px; background: white;"></div>
          <span style="font-size: 0.8125rem; color: var(--color-ash);">Final QA</span>
        </div>
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-mist);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="flex: 1; height: 4px; background: var(--color-mist); border-radius: 2px; overflow: hidden;">
            <div style="width: 33%; height: 100%; background: var(--color-accent);"></div>
          </div>
          <span style="font-size: 0.6875rem; color: var(--color-accent); font-weight: 500;">1/3</span>
        </div>
      </div>
    </div>
  `
};
