// Typeset command demo - shows flat, hierarchyless text becoming intentional typography
export default {
  id: 'typeset',
  caption: 'No type hierarchy → Clear, intentional typography',

  before: `
    <div style="width: 100%; max-width: 240px; padding: 16px; font-family: Arial, sans-serif;">
      <div style="font-size: 14px; font-weight: bold; color: #444; margin-bottom: 8px;">Project Update</div>
      <div style="font-size: 14px; color: #444; margin-bottom: 8px;">Q1 Design Sprint</div>
      <div style="font-size: 14px; color: #444; line-height: 1.4; margin-bottom: 8px;">The team completed the redesign of the dashboard. All components have been reviewed and approved by stakeholders.</div>
      <div style="font-size: 14px; color: #444;">Updated 2 hours ago</div>
    </div>
  `,

  after: `
    <div style="width: 100%; max-width: 240px; padding: 16px; font-family: 'Instrument Sans', sans-serif;">
      <div style="font-size: 0.625rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ash); margin-bottom: 6px;">Project Update</div>
      <div style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; font-weight: 600; color: var(--color-ink); line-height: 1.1; margin-bottom: 12px;">Q1 Design Sprint</div>
      <p style="font-size: 0.8125rem; color: color-mix(in oklch, var(--color-ink) 65%, transparent); line-height: 1.65; margin: 0 0 14px; max-width: 30ch;">The team completed the redesign of the dashboard. All components reviewed and approved.</p>
      <div style="font-size: 0.6875rem; color: var(--color-ash); font-variant-numeric: tabular-nums;">Updated 2 hours ago</div>
    </div>
  `
};
