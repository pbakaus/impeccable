// Typography skill demos
export default {
  id: 'typography',
  tabs: [
    {
      id: 'pairing',
      label: 'Font Pairing',
      caption: 'Generic system fonts vs distinctive pairing',
      beforeClass: 'typo-demo typo-pairing-before',
      afterClass: 'typo-demo typo-pairing-after',
      before: `
        <div class="typo-demo typo-pairing-before">
          <div class="typo-heading">Welcome to the Future</div>
          <div class="typo-body">Experience innovation like never before with our cutting-edge platform designed for modern teams.</div>
        </div>
      `,
      after: null // Uses CSS class toggle
    },
    {
      id: 'hierarchy',
      label: 'Scale & Hierarchy',
      caption: 'Flat sizing vs dramatic scale contrast',
      beforeClass: 'typo-demo typo-hierarchy-before',
      afterClass: 'typo-demo typo-hierarchy-after',
      before: `
        <div class="typo-demo typo-hierarchy-before">
          <div class="typo-h1">Article Title</div>
          <div class="typo-meta">Published January 2025</div>
          <div class="typo-p">This is the body text of the article containing the main content and ideas.</div>
        </div>
      `,
      after: null // Uses CSS class toggle
    }
  ]
};


