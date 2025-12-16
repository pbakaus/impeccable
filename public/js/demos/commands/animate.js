// Animate command demo - shows static elements becoming choreographed
export default {
  id: 'animate',
  caption: 'Static layout → Choreographed entrance',

  before: `
    <div style="width: 100%; max-width: 220px; display: flex; flex-direction: column; gap: 8px;">
      <div style="height: 32px; background: #e0e0e0; border-radius: 4px;"></div>
      <div style="height: 12px; background: #e0e0e0; border-radius: 2px; width: 60%;"></div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <div style="flex: 1; height: 64px; background: #e0e0e0; border-radius: 4px;"></div>
        <div style="flex: 1; height: 64px; background: #e0e0e0; border-radius: 4px;"></div>
      </div>
      <div style="height: 10px; background: #e0e0e0; border-radius: 2px; width: 80%; margin-top: 8px;"></div>
      <div style="height: 10px; background: #e0e0e0; border-radius: 2px; width: 65%;"></div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 220px; display: flex; flex-direction: column; gap: 8px;">
      <div style="height: 32px; background: var(--color-ink); border-radius: 4px; animation: animDemoFade 0.5s ease-out both;"></div>
      <div style="height: 12px; background: var(--color-ash); border-radius: 2px; width: 60%; animation: animDemoFade 0.5s ease-out 0.1s both;"></div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <div style="flex: 1; height: 64px; background: var(--color-mist); border-radius: 4px; animation: animDemoSlide 0.4s ease-out 0.2s both;"></div>
        <div style="flex: 1; height: 64px; background: var(--color-mist); border-radius: 4px; animation: animDemoSlide 0.4s ease-out 0.3s both;"></div>
      </div>
      <div style="height: 10px; background: var(--color-mist); border-radius: 2px; width: 80%; margin-top: 8px; animation: animDemoFade 0.4s ease-out 0.4s both;"></div>
      <div style="height: 10px; background: var(--color-mist); border-radius: 2px; width: 65%; animation: animDemoFade 0.4s ease-out 0.5s both;"></div>
    </div>
    <style>
      @keyframes animDemoFade {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes animDemoSlide {
        from { opacity: 0; transform: translateY(16px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    </style>
  `
};


