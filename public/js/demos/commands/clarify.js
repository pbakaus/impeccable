// Clarify command demo - shows confusing UX copy becoming clear
export default {
  id: 'clarify',
  caption: 'Confusing copy → Clear, actionable language',

  before: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 12px;">
      <div style="padding: 12px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">Processing Status</div>
        <div style="font-size: 12px; color: #666;">Your request is being processed. Please wait while we complete the operation. This may take some time depending on various factors.</div>
      </div>
      <div style="padding: 12px; background: #fff8e1; border-radius: 6px;">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">⚠️ Warning</div>
        <div style="font-size: 12px; color: #666;">Proceeding with this action may result in irreversible consequences to your data and settings configuration.</div>
      </div>
      <button style="padding: 10px; background: #333; color: white; border: none; border-radius: 4px; font-size: 13px;">Submit Request</button>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 260px; display: flex; flex-direction: column; gap: 12px;">
      <div style="padding: 12px; background: var(--color-paper); border: 1px solid var(--color-mist); border-radius: 6px;">
        <div style="font-size: 0.8125rem; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">Saving changes...</div>
        <div style="font-size: 0.75rem; color: var(--color-ash);">About 10 seconds remaining</div>
        <div style="margin-top: 8px; height: 4px; background: var(--color-mist); border-radius: 2px; overflow: hidden;">
          <div style="width: 60%; height: 100%; background: var(--color-accent);"></div>
        </div>
      </div>
      <div style="padding: 12px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 6px;">
        <div style="font-size: 0.8125rem; font-weight: 600; color: #92400e; margin-bottom: 4px;">Delete this project?</div>
        <div style="font-size: 0.75rem; color: #a16207; line-height: 1.5;">This will permanently delete 23 files. You can't undo this.</div>
      </div>
      <button style="padding: 10px; background: var(--color-ink); color: var(--color-paper); border: none; border-radius: 6px; font-size: 0.8125rem; font-weight: 500;">Save and Continue →</button>
    </div>
  `
};
