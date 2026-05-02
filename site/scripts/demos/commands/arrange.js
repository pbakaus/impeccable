// Arrange command demo - shows monotonous equal spacing becoming rhythmic and intentional
export default {
  id: 'arrange',
  caption: 'Equal spacing everywhere → Intentional rhythm and hierarchy',

  before: `
    <div style="width: 100%; max-width: 240px; padding: 16px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="font-size: 14px; font-weight: bold; color: #333;">Team Members</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="padding: 16px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
          <div style="width: 32px; height: 32px; background: #ddd; border-radius: 50%; margin: 0 auto 8px;"></div>
          <div style="font-size: 13px; color: #333;">Alice Chen</div>
          <div style="font-size: 12px; color: #888;">Designer</div>
        </div>
        <div style="padding: 16px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
          <div style="width: 32px; height: 32px; background: #ddd; border-radius: 50%; margin: 0 auto 8px;"></div>
          <div style="font-size: 13px; color: #333;">Bob Park</div>
          <div style="font-size: 12px; color: #888;">Engineer</div>
        </div>
      </div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 240px; padding: 16px; font-family: 'Instrument Sans', sans-serif;">
      <div style="font-size: 0.8125rem; font-weight: 600; color: var(--color-ink); margin-bottom: 16px;">Team Members</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--color-mist);">
          <div style="width: 28px; height: 28px; background: var(--color-accent); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: 600;">AC</div>
          <div style="flex: 1;">
            <div style="font-size: 0.8125rem; font-weight: 500; color: var(--color-ink);">Alice Chen</div>
            <div style="font-size: 0.6875rem; color: var(--color-ash);">Designer</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0;">
          <div style="width: 28px; height: 28px; background: color-mix(in oklch, var(--color-accent) 60%, var(--color-ink)); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: 600;">BP</div>
          <div style="flex: 1;">
            <div style="font-size: 0.8125rem; font-weight: 500; color: var(--color-ink);">Bob Park</div>
            <div style="font-size: 0.6875rem; color: var(--color-ash);">Engineer</div>
          </div>
        </div>
      </div>
    </div>
  `
};
