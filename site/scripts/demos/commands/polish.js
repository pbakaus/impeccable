// Polish command demo - shows rough UI becoming refined
export default {
  id: 'polish',
  caption: 'Rough edges → Refined, pixel-perfect details',

  before: `
    <div style="width: 100%; max-width: 240px; padding: 16px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px;">
      <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">User Profile</div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="width: 40px; height: 40px; background: #ccc; border-radius: 50%;"></div>
        <div>
          <div style="font-size: 14px;">John Doe</div>
          <div style="font-size: 12px; color: #888;">Developer</div>
        </div>
      </div>
      <button style="width: 100%; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; font-size: 13px;">Edit Profile</button>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 240px; padding: 20px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
      <div style="font-family: var(--font-display); font-size: 1.125rem; font-weight: 400; margin-bottom: 16px; color: var(--color-ink);">User Profile</div>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="width: 48px; height: 48px; background: var(--color-ink); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--color-paper); font-weight: 600; font-size: 1.125rem;">JD</div>
        <div>
          <div style="font-size: 0.9375rem; font-weight: 500; color: var(--color-ink);">John Doe</div>
          <div style="font-size: 0.75rem; color: var(--color-ash); letter-spacing: 0.02em;">Developer</div>
        </div>
      </div>
      <button style="width: 100%; padding: 10px; background: var(--color-ink); color: var(--color-paper); border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; letter-spacing: 0.01em; cursor: pointer;">Edit Profile</button>
    </div>
  `
};
