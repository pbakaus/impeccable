// Audit command demo - shows scattered issues being identified and flagged
export default {
  id: 'audit',
  caption: 'Hidden issues → Identified problems with recommendations',

  before: `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 260px;">
      <div style="padding: 12px; background: #f8f8f8; border-radius: 4px;">
        <div style="font-size: 12px; color: #aaa;">Welcome message</div>
        <button style="margin-top: 8px; padding: 4px 8px; font-size: 11px; background: #ddd; border: none; border-radius: 2px; color: #888;">click here</button>
      </div>
      <div style="padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px;">
        <div style="font-size: 15px; color: rgba(255,255,255,0.7);">Featured Item</div>
      </div>
      <div style="display: flex; gap: 4px;">
        <button style="width: 20px; height: 20px; font-size: 10px; background: #eee; border: none;">←</button>
        <button style="width: 20px; height: 20px; font-size: 10px; background: #eee; border: none;">→</button>
      </div>
    </div>
  `,

  after: `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 280px;">
      <div style="padding: 12px; background: #fff8f8; border: 1px solid #ffcccc; border-radius: 4px; position: relative;">
        <div style="position: absolute; top: -8px; right: 8px; background: #ff4444; color: white; font-size: 9px; padding: 2px 6px; border-radius: 8px; font-weight: 600;">CONTRAST</div>
        <div style="font-size: 12px; color: #aaa;">Welcome message</div>
        <button style="margin-top: 8px; padding: 4px 8px; font-size: 11px; background: #ddd; border: none; border-radius: 2px; color: #888;">click here</button>
      </div>
      <div style="padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; border: 2px solid #ff9800; position: relative;">
        <div style="position: absolute; top: -8px; right: 8px; background: #ff9800; color: white; font-size: 9px; padding: 2px 6px; border-radius: 8px; font-weight: 600;">READABILITY</div>
        <div style="font-size: 15px; color: rgba(255,255,255,0.7);">Featured Item</div>
      </div>
      <div style="display: flex; gap: 4px; padding: 4px; background: #fff3e0; border: 1px solid #ffcc80; border-radius: 4px; position: relative;">
        <div style="position: absolute; top: -8px; right: 8px; background: #ff9800; color: white; font-size: 9px; padding: 2px 6px; border-radius: 8px; font-weight: 600;">TOUCH TARGET</div>
        <button style="width: 20px; height: 20px; font-size: 10px; background: #eee; border: none;">←</button>
        <button style="width: 20px; height: 20px; font-size: 10px; background: #eee; border: none;">→</button>
      </div>
    </div>
  `
};
