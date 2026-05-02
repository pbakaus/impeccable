// Critique command demo - shows design/UX issues being identified
export default {
  id: 'critique',
  caption: 'Confusing design → UX issues identified with fixes',

  before: `
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 260px; padding: 12px; background: #fafafa; border-radius: 6px;">
      <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Dashboard</div>
      <div style="font-size: 11px; color: #666;">Welcome to your dashboard where you can manage things</div>
      <div style="display: flex; gap: 6px;">
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Create</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Import</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Export</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Settings</button>
      </div>
      <div style="padding: 10px; background: white; border: 1px solid #e5e5e5; border-radius: 4px;">
        <div style="font-size: 10px; color: #999;">Recent Activity</div>
        <div style="font-size: 10px; color: #999; margin-top: 4px;">No items to display at this time</div>
      </div>
    </div>
  `,

  after: `
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 280px; padding: 12px; background: #fafafa; border-radius: 6px;">
      <div style="position: relative;">
        <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Dashboard</div>
        <div style="position: absolute; top: -6px; right: -4px; background: #7c3aed; color: white; font-size: 8px; padding: 2px 5px; border-radius: 6px; font-weight: 600;">HIERARCHY</div>
      </div>
      <div style="font-size: 11px; color: #666; background: #fef3c7; padding: 4px 6px; border-radius: 3px; position: relative;">
        Welcome to your dashboard where you can manage things
        <div style="position: absolute; top: -6px; right: -4px; background: #d97706; color: white; font-size: 8px; padding: 2px 5px; border-radius: 6px; font-weight: 600;">REDUNDANT</div>
      </div>
      <div style="display: flex; gap: 6px; background: #fee2e2; padding: 6px; border-radius: 4px; position: relative;">
        <div style="position: absolute; top: -6px; right: -4px; background: #dc2626; color: white; font-size: 8px; padding: 2px 5px; border-radius: 6px; font-weight: 600;">NO PRIMARY</div>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Create</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Import</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Export</button>
        <button style="flex: 1; padding: 8px; font-size: 11px; background: #4F46E5; color: white; border: none; border-radius: 4px; font-weight: 500;">Settings</button>
      </div>
      <div style="padding: 10px; background: white; border: 1px solid #fca5a5; border-radius: 4px; position: relative;">
        <div style="position: absolute; top: -6px; right: -4px; background: #dc2626; color: white; font-size: 8px; padding: 2px 5px; border-radius: 6px; font-weight: 600;">DEAD END</div>
        <div style="font-size: 10px; color: #999;">Recent Activity</div>
        <div style="font-size: 10px; color: #999; margin-top: 4px;">No items to display at this time</div>
      </div>
    </div>
  `
};
