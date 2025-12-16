// Responsive Design skill demos
export default {
  id: 'responsive-design',
  tabs: [
    {
      id: 'touch',
      label: 'Touch Targets',
      caption: 'Tiny targets vs accessible touch areas',
      hasToggle: false, // Static comparison
      before: `
        <div class="resp-demo resp-touch-demo">
          <div class="resp-touch-row">
            <span class="resp-label">Too Small</span>
            <div class="resp-touch-targets resp-touch-bad">
              <button>×</button>
              <button>−</button>
              <button>+</button>
            </div>
          </div>
          <div class="resp-touch-row">
            <span class="resp-label">Accessible</span>
            <div class="resp-touch-targets resp-touch-good">
              <button>×</button>
              <button>−</button>
              <button>+</button>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'fluid',
      label: 'Fluid Layout',
      caption: 'Fixed breakage vs fluid adaptation',
      hasToggle: false, // Static comparison
      before: `
        <div class="resp-demo resp-fluid-demo">
          <div class="resp-fluid-container">
            <div class="resp-fluid-fixed">
              <span>Fixed 400px</span>
              <div class="resp-fluid-bar" style="width: 400px; max-width: 100%;"></div>
            </div>
            <div class="resp-fluid-adaptive">
              <span>Fluid 80%</span>
              <div class="resp-fluid-bar" style="width: 80%;"></div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'adapt',
      label: 'Adaptive Content',
      caption: 'Same layout vs optimized for context',
      hasToggle: false, // Static comparison
      before: `
        <div class="resp-demo resp-adapt-demo">
          <div class="resp-device resp-device-mobile">
            <div class="resp-device-screen">
              <div class="resp-block resp-header"></div>
              <div class="resp-block resp-content"></div>
            </div>
            <span>Mobile</span>
          </div>
          <div class="resp-device resp-device-tablet">
            <div class="resp-device-screen">
              <div class="resp-block resp-header"></div>
              <div class="resp-block-row">
                <div class="resp-block resp-content"></div>
                <div class="resp-block resp-content"></div>
              </div>
            </div>
            <span>Tablet</span>
          </div>
          <div class="resp-device resp-device-desktop">
            <div class="resp-device-screen">
              <div class="resp-block-row">
                <div class="resp-block resp-sidebar"></div>
                <div class="resp-block resp-content"></div>
              </div>
            </div>
            <span>Desktop</span>
          </div>
        </div>
      `
    }
  ]
};


