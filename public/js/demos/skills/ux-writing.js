// UX Writing skill demos
export default {
  id: 'ux-writing',
  tabs: [
    {
      id: 'errors',
      label: 'Error Messages',
      caption: 'Technical jargon vs human, actionable guidance',
      before: `
        <div class="uxw-demo uxw-error-before">
          <div class="uxw-error-icon">⚠</div>
          <div class="uxw-error-title">Error 403</div>
          <div class="uxw-error-text">Access denied. Authentication failure occurred.</div>
        </div>
      `,
      after: `
        <div class="uxw-demo uxw-error-after">
          <div class="uxw-error-icon">🔐</div>
          <div class="uxw-error-title">You don't have access</div>
          <div class="uxw-error-text">Your session may have expired. Sign in again to continue.</div>
          <div class="uxw-error-action">Sign in →</div>
        </div>
      `
    },
    {
      id: 'buttons',
      label: 'Button Labels',
      caption: 'Vague labels vs clear, specific actions',
      before: `
        <div class="uxw-demo uxw-buttons-before">
          <div class="uxw-button-context">Delete account permanently?</div>
          <div class="uxw-button-row">
            <button class="uxw-btn uxw-btn-primary">Submit</button>
            <button class="uxw-btn uxw-btn-secondary">Cancel</button>
          </div>
        </div>
      `,
      after: `
        <div class="uxw-demo uxw-buttons-after">
          <div class="uxw-button-context">Delete account permanently?</div>
          <div class="uxw-button-row">
            <button class="uxw-btn uxw-btn-danger">Delete My Account</button>
            <button class="uxw-btn uxw-btn-secondary">Keep Account</button>
          </div>
        </div>
      `
    },
    {
      id: 'empty',
      label: 'Empty States',
      caption: 'Blank nothing vs helpful, encouraging guidance',
      before: `
        <div class="uxw-demo uxw-empty-before">
          <div class="uxw-empty-icon">📁</div>
          <div class="uxw-empty-title">No items</div>
        </div>
      `,
      after: `
        <div class="uxw-demo uxw-empty-after">
          <div class="uxw-empty-icon">📝</div>
          <div class="uxw-empty-title">No projects yet</div>
          <div class="uxw-empty-text">Create your first project to get started.</div>
          <div class="uxw-empty-action"><button class="uxw-btn uxw-btn-primary">Create Project</button></div>
        </div>
      `
    }
  ]
};


