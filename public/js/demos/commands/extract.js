// Extract command demo - shows patterns being identified and documented
export default {
  id: 'extract',
  caption: 'Scattered styles → Documented design tokens',

  before: `
    <div style="width: 100%; max-width: 280px; display: flex; flex-direction: column; gap: 6px; font-family: monospace; font-size: 11px;">
      <div style="padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow: hidden;">
        <span style="color: #9cdcfe;">padding</span><span style="color: #d4d4d4;">: </span><span style="color: #ce9178;">12px 16px</span><span style="color: #d4d4d4;">;</span>
      </div>
      <div style="padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow: hidden;">
        <span style="color: #9cdcfe;">padding</span><span style="color: #d4d4d4;">: </span><span style="color: #ce9178;">18px 24px</span><span style="color: #d4d4d4;">;</span>
      </div>
      <div style="padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow: hidden;">
        <span style="color: #9cdcfe;">color</span><span style="color: #d4d4d4;">: </span><span style="color: #ce9178;">#3b82f6</span><span style="color: #d4d4d4;">;</span>
      </div>
      <div style="padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow: hidden;">
        <span style="color: #9cdcfe;">color</span><span style="color: #d4d4d4;">: </span><span style="color: #ce9178;">#3a80f5</span><span style="color: #d4d4d4;">;</span>
      </div>
      <div style="padding: 8px; background: #1e1e1e; color: #d4d4d4; border-radius: 4px; overflow: hidden;">
        <span style="color: #9cdcfe;">font-size</span><span style="color: #d4d4d4;">: </span><span style="color: #ce9178;">14px</span><span style="color: #d4d4d4;">;</span>
      </div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 280px; display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-ash); margin-bottom: 4px;">Design Tokens</div>
      <div style="padding: 10px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 10px; color: var(--color-ash); margin-bottom: 6px;">SPACING</div>
        <div style="display: flex; gap: 8px;">
          <div style="text-align: center;">
            <div style="width: 24px; height: 8px; background: var(--color-accent); border-radius: 2px; margin-bottom: 4px;"></div>
            <span style="font-family: monospace; font-size: 9px; color: var(--color-charcoal);">sm</span>
          </div>
          <div style="text-align: center;">
            <div style="width: 32px; height: 8px; background: var(--color-accent); border-radius: 2px; margin-bottom: 4px;"></div>
            <span style="font-family: monospace; font-size: 9px; color: var(--color-charcoal);">md</span>
          </div>
          <div style="text-align: center;">
            <div style="width: 48px; height: 8px; background: var(--color-accent); border-radius: 2px; margin-bottom: 4px;"></div>
            <span style="font-family: monospace; font-size: 9px; color: var(--color-charcoal);">lg</span>
          </div>
        </div>
      </div>
      <div style="padding: 10px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 10px; color: var(--color-ash); margin-bottom: 6px;">COLORS</div>
        <div style="display: flex; gap: 6px;">
          <div style="width: 24px; height: 24px; background: var(--color-ink); border-radius: 4px;" title="ink"></div>
          <div style="width: 24px; height: 24px; background: var(--color-charcoal); border-radius: 4px;" title="charcoal"></div>
          <div style="width: 24px; height: 24px; background: var(--color-accent); border-radius: 4px;" title="accent"></div>
          <div style="width: 24px; height: 24px; background: var(--color-mist); border-radius: 4px; border: 1px solid var(--color-ash);" title="mist"></div>
        </div>
      </div>
      <div style="padding: 10px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 10px; color: var(--color-ash); margin-bottom: 6px;">TYPOGRAPHY</div>
        <div style="font-family: var(--font-display); font-size: 16px; font-style: italic; color: var(--color-ink);">Display</div>
        <div style="font-size: 12px; color: var(--color-charcoal);">Body text</div>
      </div>
    </div>
  `
};
