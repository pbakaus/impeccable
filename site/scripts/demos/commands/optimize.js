// Optimize command demo - shows performance improvements
export default {
  id: 'optimize',
  caption: 'Heavy, slow UI → Lightweight, performant',

  before: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 8px;">
      <div style="padding: 12px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">BUNDLE SIZE</div>
        <div style="height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
          <div style="width: 95%; height: 100%; background: linear-gradient(90deg, #ff6b6b, #ee5a5a);"></div>
        </div>
        <div style="font-size: 12px; color: #ff6b6b; margin-top: 4px; font-weight: 600;">847 KB</div>
      </div>
      <div style="padding: 12px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">RENDER TIME</div>
        <div style="height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
          <div style="width: 80%; height: 100%; background: linear-gradient(90deg, #ffa726, #ff9800);"></div>
        </div>
        <div style="font-size: 12px; color: #ff9800; margin-top: 4px; font-weight: 600;">2.4s</div>
      </div>
      <div style="padding: 12px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">LAYOUT SHIFTS</div>
        <div style="height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
          <div style="width: 60%; height: 100%; background: linear-gradient(90deg, #ffa726, #ff9800);"></div>
        </div>
        <div style="font-size: 12px; color: #ff9800; margin-top: 4px; font-weight: 600;">CLS: 0.18</div>
      </div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 8px;">
      <div style="padding: 12px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 11px; color: var(--color-ash); margin-bottom: 4px;">BUNDLE SIZE</div>
        <div style="height: 8px; background: var(--color-mist); border-radius: 4px; overflow: hidden;">
          <div style="width: 25%; height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a);"></div>
        </div>
        <div style="font-size: 12px; color: #22c55e; margin-top: 4px; font-weight: 600;">124 KB <span style="color: var(--color-ash); font-weight: 400;">(-85%)</span></div>
      </div>
      <div style="padding: 12px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 11px; color: var(--color-ash); margin-bottom: 4px;">RENDER TIME</div>
        <div style="height: 8px; background: var(--color-mist); border-radius: 4px; overflow: hidden;">
          <div style="width: 15%; height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a);"></div>
        </div>
        <div style="font-size: 12px; color: #22c55e; margin-top: 4px; font-weight: 600;">0.3s <span style="color: var(--color-ash); font-weight: 400;">(-88%)</span></div>
      </div>
      <div style="padding: 12px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 11px; color: var(--color-ash); margin-bottom: 4px;">LAYOUT SHIFTS</div>
        <div style="height: 8px; background: var(--color-mist); border-radius: 4px; overflow: hidden;">
          <div style="width: 5%; height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a);"></div>
        </div>
        <div style="font-size: 12px; color: #22c55e; margin-top: 4px; font-weight: 600;">CLS: 0.02 <span style="color: var(--color-ash); font-weight: 400;">(excellent)</span></div>
      </div>
    </div>
  `
};
