// Color and Contrast skill demos
export default {
  id: 'color-and-contrast',
  tabs: [
    {
      id: 'palette',
      label: 'Color Harmony',
      caption: 'Clashing colors vs harmonious palette',
      beforeClass: 'color-demo color-palette-before',
      afterClass: 'color-demo color-palette-after',
      before: `
        <div class="color-demo color-palette-before">
          <div class="color-swatch swatch-1"></div>
          <div class="color-swatch swatch-2"></div>
          <div class="color-swatch swatch-3"></div>
          <div class="color-swatch swatch-4"></div>
          <div class="color-swatch swatch-5"></div>
          <div class="color-card">
            <span class="card-title">Title</span>
            <span class="card-subtitle">Subtitle</span>
            <button class="card-btn">Action</button>
          </div>
        </div>
      `,
      after: null // Uses CSS class toggle
    },
    {
      id: 'accent',
      label: 'Strategic Accent',
      caption: 'Monochrome monotony vs strategic accent',
      beforeClass: 'color-demo color-accent-before',
      afterClass: 'color-demo color-accent-after',
      before: `
        <div class="color-demo color-accent-before">
          <div class="color-accent-card">
            <div class="color-accent-title">Premium Plan</div>
            <div class="color-accent-text">Unlock all features and get priority support.</div>
            <button class="color-accent-btn">Upgrade Now</button>
          </div>
        </div>
      `,
      after: null // Uses CSS class toggle
    },
    {
      id: 'contrast',
      label: 'Contrast Ratios',
      caption: 'Accessibility failures vs WCAG compliance',
      hasToggle: false, // Static comparison
      before: `
        <div class="color-demo color-contrast-static">
          <div class="contrast-example contrast-fail">
            <span class="contrast-badge">Fails WCAG</span>
            <div class="contrast-text">Hard to Read</div>
            <div class="contrast-ratio">2.5:1</div>
          </div>
          <div class="contrast-example contrast-pass">
            <span class="contrast-badge">Passes AAA</span>
            <div class="contrast-text">Easy to Read</div>
            <div class="contrast-ratio">12.6:1</div>
          </div>
        </div>
      `
    }
  ]
};


