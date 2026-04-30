// Delight command demo - shows functional UI gaining moments of joy
export default {
  id: 'delight',
  caption: 'Functional feedback → Moment of joy',

  before: `
    <div style="width: 100%; max-width: 200px; display: flex; flex-direction: column; align-items: center; gap: 16px;">
      <div style="text-align: center;">
        <div style="font-size: 13px; color: #666; margin-bottom: 8px;">Milestone reached</div>
        <div style="font-size: 24px; font-weight: bold; color: #333;">100</div>
        <div style="font-size: 12px; color: #999;">tasks completed</div>
      </div>
      <button style="padding: 8px 16px; background: #e0e0e0; border: none; border-radius: 4px; font-size: 12px; color: #666;">Dismiss</button>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 240px; display: flex; flex-direction: column; align-items: center; gap: 16px; position: relative;">
      <div style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px;">
        <span style="animation: confettiFall 1s ease-out 0.0s both; font-size: 16px;">🎊</span>
        <span style="animation: confettiFall 1s ease-out 0.1s both; font-size: 14px;">✨</span>
        <span style="animation: confettiFall 1s ease-out 0.2s both; font-size: 16px;">🎉</span>
        <span style="animation: confettiFall 1s ease-out 0.15s both; font-size: 14px;">✨</span>
        <span style="animation: confettiFall 1s ease-out 0.25s both; font-size: 16px;">🎊</span>
      </div>
      <div style="text-align: center; animation: celebratePop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;">
        <div style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-accent); margin-bottom: 8px; font-weight: 600;">Milestone unlocked!</div>
        <div style="font-family: var(--font-display); font-size: 3.5rem; font-weight: 300; font-style: italic; color: var(--color-ink); line-height: 1;">100</div>
        <div style="font-size: 0.875rem; color: var(--color-ash); margin-top: 4px;">tasks completed</div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: color-mix(in oklch, var(--color-accent) 10%, var(--color-paper)); border-radius: 20px; animation: badgeSlide 0.5s ease-out 0.3s both;">
        <span style="font-size: 14px;">🏆</span>
        <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-accent);">Centurion Badge Earned</span>
      </div>
    </div>
    <style>
      @keyframes confettiFall {
        0% { opacity: 0; transform: translateY(-20px) rotate(0deg); }
        50% { opacity: 1; }
        100% { opacity: 0; transform: translateY(40px) rotate(180deg); }
      }
      @keyframes celebratePop {
        0% { opacity: 0; transform: scale(0.5); }
        70% { transform: scale(1.05); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes badgeSlide {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  `
};
