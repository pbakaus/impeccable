(()=>{if(window.__dcxSettingsInstalled)return;window.__dcxSettingsInstalled=!0;let e=window.matchMedia(`(prefers-reduced-motion: reduce)`),t=[{label:`Open`,description:`Pick up where you left off.`,command:`/impeccable design-context open`},{label:`Edit`,description:`Make a few changes to this design context.`,command:`/impeccable design-context edit`},{label:`Export`,description:`Save a copy to share or keep elsewhere.`,command:`/impeccable design-context export`},{label:`Import`,description:`Bring a saved design context into this project.`,command:`/impeccable design-context import`}],n=e=>{let t=e?.querySelector?.(`.dcx-topbar`),n=t?.querySelector(`.dcx-close`);if(!t||!n||t.querySelector(`[data-dcx-settings-open]`))return;let r=document.createElement(`div`);r.className=`dcx-topbar-actions`;let i=document.createElement(`button`);i.className=`dcx-settings-trigger`,i.type=`button`,i.dataset.dcxSettingsOpen=``,i.setAttribute(`aria-label`,`Design context settings`),i.setAttribute(`aria-haspopup`,`dialog`),i.setAttribute(`aria-controls`,`dcx-context-settings`),i.setAttribute(`aria-expanded`,`false`),i.innerHTML=`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8v2.1M12 19.1v2.1M4.2 7.3l1.8 1M18 15.7l1.8 1M2.9 15.2l2-.7M19.1 9.5l2-.7M7.2 3.7l1.1 1.8M15.7 18.5l1.1 1.8"></path>
      <circle cx="12" cy="12" r="5.1"></circle>
      <circle cx="12" cy="12" r="1.75"></circle>
    </svg>`;let a=t.querySelector(`.dcx-request`);(a||n).before(r),a&&r.append(a),r.append(i,n)};n(document.querySelector(`#dcx-shell-template`)?.content),document.querySelectorAll(`.dcx-expander`).forEach(n);let r=document.querySelector(`#dcx-context-settings`);r||(r=document.createElement(`dialog`),r.id=`dcx-context-settings`,r.className=`picker-modal dcx-settings-modal`,r.setAttribute(`aria-labelledby`,`dcx-context-settings-title`),r.setAttribute(`aria-describedby`,`dcx-context-settings-lede`),r.innerHTML=`
      <div class="picker-modal-inner dcx-settings-panel" data-dcx-command-context>
        <header class="picker-modal-head dcx-settings-head">
          <div>
            <h2 id="dcx-context-settings-title">Design context commands</h2>
            <p id="dcx-context-settings-lede">Choose what you’d like to do with this design context.</p>
          </div>
          <button class="dcx-settings-close" type="button" data-dcx-settings-close aria-label="Close settings">
            
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11"></path>
    </svg>
          </button>
        </header>
        <div class="dcx-settings-commands">
          ${t.map(({label:e,description:t,command:n})=>`
            <section class="dcx-settings-command">
              <div class="dcx-settings-command-copy">
                <h3>${e}</h3>
                <p>${t}</p>
              </div>
              <div class="dcx-command-copy">
                <span class="dcx-command-copy__prompt" aria-hidden="true">$</span>
                <code>${n}</code>
                <button class="dcx-command-copy__button" type="button" data-dcx-copy-command="${n}" aria-label="Copy ${e.toLowerCase()} command">
                  <svg class="dcx-command-copy__copy-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <svg class="dcx-command-copy__check-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5"></path>
                  </svg>
                  <span class="dcx-command-copy__label">Copy</span>
                </button>
              </div>
            </section>`).join(``)}
        </div>
        <p class="dcx-command-status" role="status" aria-live="polite"></p>
      </div>`,document.body.appendChild(r));let i=null,a=0,o=()=>{r.querySelectorAll(`[data-dcx-copy-command]`).forEach(e=>{window.clearTimeout(e._dcxCopyTimer),e.classList.remove(`copied`),e.removeAttribute(`data-copied`)});let e=r.querySelector(`.dcx-command-status`);e&&(e.textContent=``)},s=e=>{window.clearTimeout(a),o(),i=e,e.setAttribute(`aria-expanded`,`true`),r.open||r.showModal(),requestAnimationFrame(()=>{r.classList.add(`is-visible`),r.querySelector(`[data-dcx-settings-close]`)?.focus({preventScroll:!0})})},c=({restoreFocus:t=!0,instant:n=!1}={})=>{if(!r.open)return;window.clearTimeout(a),r.classList.remove(`is-visible`);let s=()=>{r.open&&(r.close(),o(),i?.setAttribute?.(`aria-expanded`,`false`),t&&i instanceof HTMLElement&&i.isConnected&&i.focus({preventScroll:!0}),i=null)};n||e.matches?s():a=window.setTimeout(s,200)};window.closeDcxSettings=c,document.addEventListener(`click`,async e=>{let t=e.target.closest?.(`[data-dcx-settings-open]`);if(t){e.preventDefault(),s(t);return}if(e.target.closest?.(`[data-dcx-settings-close]`)){c();return}}),r.addEventListener(`click`,e=>{if(e.target!==r)return;let t=r.getBoundingClientRect();(e.clientX<t.left||e.clientX>t.right||e.clientY<t.top||e.clientY>t.bottom)&&c()}),r.addEventListener(`cancel`,e=>{e.preventDefault(),c()}),document.addEventListener(`keydown`,e=>{if(!r.open)return;if(e.key===`Escape`){e.preventDefault(),e.stopImmediatePropagation(),c();return}if(e.key!==`Tab`)return;let t=[...r.querySelectorAll(`button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])`)].filter(e=>e.getClientRects().length>0&&!e.hidden);if(!t.length){e.preventDefault(),r.focus({preventScroll:!0});return}let n=t[0],i=t[t.length-1],a=document.activeElement;e.shiftKey&&(a===n||!r.contains(a))?(e.preventDefault(),i.focus({preventScroll:!0})):!e.shiftKey&&(a===i||!r.contains(a))&&(e.preventDefault(),n.focus({preventScroll:!0}))},!0),document.addEventListener(`dcx:document-mounted`,e=>{n(e.target)})})();var e=e=>{let t=window.dcxDocSession;return!t?.base||!t?.token?e:`${t.base}${e}?token=${encodeURIComponent(t.token)}`};(()=>{(()=>{let e=document.querySelector(`.dcx-tile[data-category="iconography"]`);if(e){e.dataset.category=`components`,e.dataset.name=`Components`,e.setAttribute(`aria-label`,`Open Components`);let t=e.querySelector(`.dcx-tile-title`);t&&(t.textContent=`Components`)}let t=document.querySelector(`#dcx-shell-template`)?.content.querySelector(`li[data-category="iconography"]`),n=t?.querySelector(`.dcx-nav-link`);t&&n&&(t.dataset.category=`components`,n.href=`#components`,n.dataset.dcxNav=`components`,n.textContent=`Components`)})();let t=[`audience`,`product`,`brand`,`color`,`typography`,`components`,`material`,`hooks`],n=window.matchMedia(`(prefers-reduced-motion: reduce)`),r=window.matchMedia(`(max-width: 920px)`),i=new Set(t),a=e=>e===`interface`||e===`dcx-category-interface`||e.startsWith(`dcx-interface-`)?`hooks`:e===`iconography`||e===`dcx-category-iconography`||e.startsWith(`dcx-iconography-`)?`material`:t.find(t=>e===t||e===`dcx-category-${t}`||e.startsWith(`dcx-${t}-`))||``,o=location.hash.slice(1),s=a(o),c=s?o:``,l=null,u=0,d=null,f=e=>e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``),p=e=>document.querySelector(`.dcx-tile[data-category="${e}"]`)?.dataset.name||e,m=e=>e===`components`?`interface`:e,h=()=>t.every(e=>document.querySelector(`#dcx-detail-${m(e)}`)?.content.querySelector(`.dcx-article`))&&!!document.querySelector(`#dcx-detail-iconography`)?.content.querySelector(`.dcx-article`),g=(e,t)=>{if(!t)return 0;let n=e.main.getBoundingClientRect();return Math.max(0,t.getBoundingClientRect().top-n.top+e.main.scrollTop-18)},_=(e,t,n)=>{let r=e.main.querySelector(`:scope > .dcx-article[data-dcx-category="${n}"]`);return t===`iconography`||t===`dcx-category-iconography`||t.startsWith(`dcx-iconography-`)?e.main.querySelector(`#dcx-material-iconography`)||r:!t||t===n?r:e.main.querySelector(`#${CSS.escape(t)}`)||r},v=async e=>{try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}let t=document.activeElement,n=document.createElement(`textarea`);n.value=e,n.setAttribute(`readonly`,``),n.style.position=`fixed`,n.style.opacity=`0`,document.body.appendChild(n),n.select();let r=!1;try{r=document.execCommand(`copy`)}catch{}return n.remove(),t instanceof HTMLElement&&t.isConnected&&t.focus({preventScroll:!0}),r},y=e=>{e.querySelectorAll(`.dcx-fan:not([data-dcx-document-ready])`).forEach(e=>{let t=[...e.querySelectorAll(`.dcx-fan-panel`)];if(!t.length)return;e.dataset.dcxDocumentReady=`true`;let n=n=>{e.classList.add(`is-engaged`),t.forEach((e,t)=>{e.classList.toggle(`is-active`,t===n),e.classList.toggle(`is-neighbor`,Math.abs(t-n)===1)})},r=()=>{e.classList.remove(`is-engaged`),t.forEach(e=>e.classList.remove(`is-active`,`is-neighbor`))};e.addEventListener(`mousemove`,r=>{let i=e.getBoundingClientRect(),a=Math.min(.999,Math.max(0,(r.clientX-i.left)/i.width)),o=0;t.forEach((e,t)=>{let n=Number.parseFloat(e.style.getPropertyValue(`--panel-left`))/100;a>=n&&(o=t)}),n(o)}),e.addEventListener(`mouseleave`,r),t.forEach((t,i)=>{t.addEventListener(`focus`,()=>n(i)),t.addEventListener(`blur`,()=>{e.matches(`:focus-within`)||r()}),t.addEventListener(`click`,()=>{let e=t.dataset.copyColor;if(!e)return;v(e);let n=t.querySelector(`.dcx-fan-name`),r=t.dataset.colorName||`Color`;t.classList.add(`is-copied`),n&&(n.textContent=`Copied!`),window.clearTimeout(t._dcxCopyTimer),t._dcxCopyTimer=window.setTimeout(()=>{t.classList.remove(`is-copied`),n&&(n.textContent=r)},900)})})})},b=(e,t)=>{let n=document.createElement(`section`);n.className=`dcx-block`,n.dataset.label=e;let r=document.createElement(`span`);r.className=`dcx-block-label`,r.textContent=e;let i=document.createElement(`template`);return i.innerHTML=t,n.append(r,i.content),n},ee=[{src:`/assets/brand/placeholders/hanazono-primary-mark.png`,kind:`logo`,title:`Primary mark`,alt:`Abstract botanical primary mark in textured gold leaf and patina`,width:768,height:768},{src:`/assets/brand/placeholders/hanazono-atelier-seal.png`,kind:`logo`,title:`Atelier seal`,alt:`Circular floral atelier seal in textured gold leaf and patina`,width:768,height:768},{src:`/assets/brand/placeholders/hanazono-seasonal-moodboard.webp`,kind:`moodboard`,title:`Seasonal composition`,alt:`Editorial moodboard of flowers, handmade paper, gold leaf, and vermilion thread`,width:960,height:720},{src:`/assets/brand/placeholders/hanazono-material-reference.webp`,kind:`reference`,title:`Material direction`,alt:`Material study of lacquer, washi paper, gold leaf, and verdigris patina`,width:960,height:720}],x=(e,t)=>{let n=String(e||``).split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i,``).replace(/[-_]+/g,` `).trim();return n?n.replace(/\b\w/g,e=>e.toUpperCase()):t},S=e=>{let t=[],n=(n,r,i)=>{e.querySelectorAll(n).forEach((e,n)=>{let a=e.querySelector(`img`);if(!a)return;let o=e.querySelector(`.dcx-asset-caption p`)?.textContent.trim(),s=e.querySelector(`.dcx-asset-caption code`)?.textContent.trim()||a.getAttribute(`src`)||``,c=o||x(s,`${i} ${n+1}`);t.push({src:a.getAttribute(`src`)||a.src,kind:r,title:c,alt:o||`${c} ${r===`logo`?`logo`:`brand image`}`,width:r===`logo`?1200:1600,height:1200})})};return n(`:scope > .dcx-block[data-label="Marks"] .dcx-mark`,`logo`,`Logo`),n(`:scope > .dcx-block[data-label="Boards and references"] .dcx-board`,`image`,`Brand image`),e.querySelectorAll(`:scope > .dcx-block[data-label="Marks"], :scope > .dcx-block[data-label="Boards and references"], :scope > .dcx-block[data-label="Assets provided"]`).forEach(e=>e.remove()),t},te=t=>{let n=S(t),r=n.length?n:ee,i=b(`Brand assets`,``);i.dataset.dcxBrandAssets=n.length?`uploaded`:`placeholder`;let a=document.createElement(`ul`);a.className=`dcx-brand-assets-grid`,a.setAttribute(`aria-label`,`Available brand assets`),r.forEach(t=>{let n=document.createElement(`li`);n.className=`dcx-brand-asset`,n.dataset.assetKind=t.kind;let r=document.createElement(`figure`),i=document.createElement(`div`);i.className=`dcx-brand-asset-frame`;let o=document.createElement(`img`);o.src=t.src.startsWith(`/assets/`)?e(t.src):t.src,o.alt=t.alt,o.width=t.width,o.height=t.height,o.loading=`lazy`,o.decoding=`async`,i.appendChild(o);let s=document.createElement(`figcaption`),c=document.createElement(`strong`);c.textContent=t.title;let l=document.createElement(`span`);l.textContent=t.kind===`logo`?`Logo`:t.kind===`moodboard`?`Moodboard`:t.kind===`reference`?`Reference`:`Image`,s.append(c,l),r.append(i,s),n.appendChild(r),a.appendChild(n)}),i.appendChild(a),t.appendChild(i);let o=t.querySelector(`:scope > header > .dcx-lede`);o&&(o.textContent=`Identity, voice, references, taste boundaries, and available assets.`)},ne=()=>e(`/assets/components/hanazono-ikebana-card.jpg`),re=e=>{e.querySelectorAll(`:scope > .dcx-block[data-label]`).forEach(e=>e.remove());let t=b(`Buttons`,`
      <div class="dcx-component-stack">
        <figure class="dcx-component-example">
          <figcaption><h4>Variants</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--center">
            <div class="dcx-component-row">
              <span class="dcx-demo-button dcx-demo-button--primary">Primary</span>
              <span class="dcx-demo-button dcx-demo-button--secondary">Secondary</span>
              <span class="dcx-demo-button dcx-demo-button--tertiary">Tertiary</span>
              <span class="dcx-demo-button dcx-demo-button--outline">Outline</span>
              <span class="dcx-demo-button dcx-demo-button--ghost">Ghost</span>
              <span class="dcx-demo-button dcx-demo-button--danger">Danger</span>
              <span class="dcx-demo-button dcx-demo-button--danger-soft">Danger soft</span>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Sizes</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--center">
            <div class="dcx-component-row dcx-component-row--baseline">
              <span class="dcx-demo-button dcx-demo-button--primary dcx-demo-button--small">Small</span>
              <span class="dcx-demo-button dcx-demo-button--primary">Medium</span>
              <span class="dcx-demo-button dcx-demo-button--primary dcx-demo-button--large">Large</span>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>With icons</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--center">
            <div class="dcx-component-row">
              <span class="dcx-demo-button dcx-demo-button--primary">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
                Search
              </span>
              <span class="dcx-demo-button dcx-demo-button--secondary">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
                Add member
              </span>
              <span class="dcx-demo-button dcx-demo-button--outline">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>
                Email
              </span>
              <span class="dcx-demo-button dcx-demo-button--danger">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"></path></svg>
                Delete
              </span>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Icon only</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--center">
            <div class="dcx-component-row">
              <span class="dcx-demo-icon-button dcx-demo-icon-button--secondary" aria-label="More options">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>
              </span>
              <span class="dcx-demo-icon-button dcx-demo-icon-button--outline" aria-label="Settings">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path></svg>
              </span>
              <span class="dcx-demo-icon-button dcx-demo-icon-button--danger" aria-label="Delete">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"></path></svg>
              </span>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Loading</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--center">
            <span class="dcx-demo-button dcx-demo-button--primary dcx-demo-button--loading">
              <span class="dcx-demo-spinner" aria-hidden="true"></span>
              Uploading&hellip;
            </span>
          </div>
        </figure>
      </div>
    `),n=b(`Input fields`,`
      <div class="dcx-component-stack">
        <figure class="dcx-component-example">
          <figcaption><h4>States</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--fields">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--three">
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Email address</span>
                <span class="dcx-demo-input is-placeholder">name@example.com</span>
                <small>Default</small>
              </div>
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Project type</span>
                <span class="dcx-demo-input">Ceremony florals</span>
                <small>Filled</small>
              </div>
              <div class="dcx-demo-field is-invalid">
                <span class="dcx-demo-field-label">Start date</span>
                <span class="dcx-demo-input">Soon</span>
                <small>Enter a date in DD/MM/YYYY format.</small>
              </div>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Sizes</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--fields">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--three dcx-component-demo-grid--baseline">
              <div class="dcx-demo-field dcx-demo-field--small">
                <span class="dcx-demo-field-label">Small</span>
                <span class="dcx-demo-input">Hana</span>
              </div>
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Medium</span>
                <span class="dcx-demo-input">Hanazono Atelier</span>
              </div>
              <div class="dcx-demo-field dcx-demo-field--large">
                <span class="dcx-demo-field-label">Large</span>
                <span class="dcx-demo-input">Private celebration</span>
              </div>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>With leading content</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--fields">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--three">
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Search</span>
                <span class="dcx-demo-input dcx-demo-input--affix">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
                  Spring arrangements
                </span>
              </div>
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Budget</span>
                <span class="dcx-demo-input dcx-demo-input--affix"><span>$</span>4,800</span>
              </div>
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Website</span>
                <span class="dcx-demo-input dcx-demo-input--affix dcx-demo-input--suffix">hanazono<span>.jp</span></span>
              </div>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Multiline</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--fields">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--single">
              <div class="dcx-demo-field">
                <span class="dcx-demo-field-label">Tell us about the setting</span>
                <span class="dcx-demo-input dcx-demo-input--textarea">A quiet evening ceremony with seasonal branches, soft candlelight, and room for the architecture to breathe.</span>
                <small>240 characters remaining</small>
              </div>
            </div>
          </div>
        </figure>
      </div>
    `),r=b(`Cards`,`
      <div class="dcx-component-stack">
        <figure class="dcx-component-example">
          <figcaption><h4>Content cards</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--cards">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--three">
              <article class="dcx-showcase-card">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Editorial</span>
                  <h5>Seasonal notes</h5>
                  <p>Materials, timing, and the decisions behind the work.</p>
                  <span class="dcx-showcase-card-link">Read the story <span aria-hidden="true">&#8594;</span></span>
                </div>
              </article>
              <article class="dcx-showcase-card">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Testimonial</span>
                  <blockquote>&ldquo;The room felt entirely transformed, but still like us.&rdquo;</blockquote>
                  <span class="dcx-showcase-card-meta">Mika &amp; Ren</span>
                </div>
              </article>
              <article class="dcx-showcase-card">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Details</span>
                  <h5>Autumn ceremony</h5>
                  <dl><div><dt>Season</dt><dd>Late autumn</dd></div><div><dt>Setting</dt><dd>Kyoto townhouse</dd></div></dl>
                </div>
              </article>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>With media</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--cards">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--two">
              <article class="dcx-showcase-card dcx-showcase-card--media">
                <img src="${ne()}" width="800" height="1200" alt="Purple flowers arranged in a black ceramic vase" loading="lazy" decoding="async">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Garden study</span>
                  <h5>Line, pause, and negative space</h5>
                  <p>A restrained floral study built around one deliberate gesture.</p>
                </div>
              </article>
              <article class="dcx-showcase-card dcx-showcase-card--media dcx-showcase-card--media-close">
                <img src="${ne()}" width="800" height="1200" alt="Close crop of purple ikebana flowers" loading="lazy" decoding="async">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Material note</span>
                  <h5>Dark ceramic, soft bloom</h5>
                  <p>The same image can lead with subject or material detail.</p>
                </div>
              </article>
            </div>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>Horizontal</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--cards dcx-component-canvas--single-card">
            <article class="dcx-showcase-card dcx-showcase-card--horizontal">
              <img src="${ne()}" width="800" height="1200" alt="Purple ikebana in a dark ceramic vase" loading="lazy" decoding="async">
              <div class="dcx-showcase-card-body">
                <span class="dcx-component-kind">Featured story</span>
                <h5>A study in asymmetry</h5>
                <p>How a single stem, a dark vessel, and generous space hold the composition together.</p>
                <span class="dcx-showcase-card-link">Explore the study <span aria-hidden="true">&#8594;</span></span>
              </div>
            </article>
          </div>
        </figure>

        <figure class="dcx-component-example">
          <figcaption><h4>With actions</h4></figcaption>
          <div class="dcx-component-canvas dcx-component-canvas--cards">
            <div class="dcx-component-demo-grid dcx-component-demo-grid--two">
              <article class="dcx-showcase-card dcx-showcase-card--action">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Consultation</span>
                  <h5>Plan the first conversation</h5>
                  <p>Share the date and setting so the studio can prepare.</p>
                  <span class="dcx-demo-button dcx-demo-button--primary">Book now</span>
                </div>
              </article>
              <article class="dcx-showcase-card dcx-showcase-card--action">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Commission guide</span>
                  <h5>Understand the process</h5>
                  <p>Read the stages, timing, and what the studio needs from you.</p>
                  <span class="dcx-demo-button dcx-demo-button--outline">View the guide</span>
                </div>
              </article>
            </div>
          </div>
        </figure>
      </div>
      <aside class="dcx-components-command" data-dcx-command-context aria-labelledby="dcx-components-command-title">
        <div class="dcx-components-command-copy">
          <h4 id="dcx-components-command-title">Add another component</h4>
          <p>Built something new? Re-scan the project to add it to this component library.</p>
        </div>
        <div class="dcx-command-copy">
          <span class="dcx-command-copy__prompt" aria-hidden="true">$</span>
          <code>/impeccable document</code>
          <button class="dcx-command-copy__button" type="button" data-dcx-copy-command="/impeccable document" aria-label="Copy add component command">
            <svg class="dcx-command-copy__copy-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <svg class="dcx-command-copy__check-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6 9 17l-5-5"></path>
            </svg>
            <span class="dcx-command-copy__label">Copy</span>
          </button>
        </div>
        <span class="dcx-command-status" role="status" aria-live="polite"></span>
      </aside>
    `);e.append(t,n,r)},C=e=>{let n=document.createDocumentFragment(),r=document.createElement(`h1`);r.className=`dcx-document-title`,r.textContent=`Design context`,n.appendChild(r),t.forEach(e=>{let t=document.querySelector(`#dcx-detail-${m(e)}`).content.cloneNode(!0).querySelector(`.dcx-article`);if(t){if(e===`components`){re(t);let e=t.querySelector(`:scope > header > .dcx-title`),n=t.querySelector(`:scope > header > .dcx-lede`);e&&(e.textContent=`Components`),n&&(n.textContent=`A compact visual inventory of reusable interface patterns.`)}if(e===`brand`&&te(t),e===`material`){let e=b(`Accessibility`,`
          <dl class="dcx-defs">
            <div class="dcx-def">
              <dt>Contrast on paper</dt>
              <dd>The accent color is reserved for display-scale text. Small links, labels, and inline commands use high-contrast ink on the page ground.</dd>
            </div>
            <div class="dcx-def">
              <dt>Reading comfort</dt>
              <dd>Body copy is set in the committed body face at a 1.65–1.8 line height and a 65–75ch reading measure.</dd>
            </div>
            <div class="dcx-def">
              <dt>Keyboard focus</dt>
              <dd>Interactive elements show a visible focus outline with a clear offset.</dd>
            </div>
            <div class="dcx-def">
              <dt>Texture &amp; text</dt>
              <dd>Text never sits directly on high-contrast texture. Move texture to an edge, or put a solid veil behind the copy.</dd>
            </div>
          </dl>
        `),n=t.querySelector(`:scope > .dcx-block[data-label="Motion per surface"], :scope > .dcx-block[data-label="Motion"]`),r=t.querySelector(`:scope > .dcx-block[data-label="Layout structure"]`);n?n.after(e):r?r.before(e):t.appendChild(e);let i=(document.querySelector(`#dcx-detail-iconography`)?.content.querySelector(`.dcx-article`))?.querySelector(`:scope > .dcx-block[data-label="Library"]`)?.cloneNode(!0);if(i){i.dataset.label=`Iconography`,i.dataset.dcxMovedIconography=`true`;let e=i.querySelector(`:scope > .dcx-block-label`);e&&(e.textContent=`Iconography`),t.appendChild(i)}let a=t.querySelector(`:scope > header > .dcx-lede`);a&&(a.textContent=`Motion, accessibility, layout structure, boundaries, corners, depth, and iconography.`)}t.querySelector(`:scope > header > .dcx-eyebrow`)?.remove(),t.dataset.dcxCategory=e,t.id=`dcx-category-${e}`,t.classList.add(`dcx-document-article`),t.setAttribute(`aria-label`,p(e)),t.querySelectorAll(`.dcx-block[data-label]`).forEach(t=>{t.id=`dcx-${e}-${f(t.dataset.label||`section`)}`}),n.appendChild(t)}}),e.main.replaceChildren(n),e.main.dataset.dcxContinuous=`true`,e.expander.dataset.dcxDocument=`true`,y(e.main),e.expander.dispatchEvent(new CustomEvent(`dcx:document-mounted`,{bubbles:!0}))},w=e=>{let t=[...e.querySelectorAll(`:scope > .dcx-block[data-label]`)],n=new Map(t.map(e=>[e.dataset.label,e]));return[{label:`People`,target:n.get(`Who they are`)},{label:`Decision factors`,target:n.get(`Needs`)||n.get(`Trust triggers`)},{label:`Inclusion`,target:n.get(`Who must not be excluded`)}].filter(e=>e.target)},ie=e=>[...e.querySelectorAll(`:scope > .dcx-block[data-label]`)].map(e=>({label:e.dataset.label,target:e})),ae=(e,t,n)=>{let r=t===`audience`?w(n):ie(n),i=e.nav.querySelector(`.dcx-nav-list > li[data-category="${t}"]`)?.querySelector(`:scope > .dcx-subnav`);if(!i)return;let a=r.map(({label:e,target:t})=>`${e}:${t.id}`).join(`|`),o=()=>{let e=[...i.querySelectorAll(`:scope > .dcx-sub-link`)],n=e.map(e=>e.getBoundingClientRect().height);if(!n.some(e=>e>0))return;let r=t===`audience`,a=r?0:2,o=r?14:10,s=n.reduce((e,t)=>e+t,0)+Math.max(0,e.length-1)*a+o;i.style.setProperty(`--dcx-subnav-height`,`${Math.ceil(s)}px`)};if(i.dataset.dcxDocumentSignature===a){o();return}let s=r.map(({label:e,target:n})=>{let r=document.createElement(`a`);return r.className=`dcx-sub-link`,r.href=`#${n.id}`,r.textContent=e,r.dataset.dcxDocumentTarget=n.id,t===`audience`&&(r.dataset.dcxRailSummary=``),r});i.replaceChildren(...s),i.dataset.dcxDocumentSignature=a,i.classList.toggle(`dcx-subnav--summary`,t===`audience`),o()},oe=e=>{t.forEach(t=>{let n=e.main.querySelector(`:scope > .dcx-article[data-dcx-category="${t}"]`);n&&ae(e,t,n)})},se=(e,t,{updateHash:a=!1}={})=>{if(!i.has(t))return;let o=e.main.querySelector(`:scope > .dcx-article[data-dcx-category="${t}"]`);if(!o)return;let s=e.currentCategory;if(s===t){ae(e,t,o),e.expander.querySelector(`.dcx-current`).textContent=p(t);return}if(s&&e.expander.dispatchEvent(new CustomEvent(`dcx:continuouscategorywillchange`,{bubbles:!0,detail:{from:s,to:t,source:e.pinnedCategory===t?`navigation`:`scroll`}})),e.currentCategory=t,e.expander.dataset.dcxCurrentCategory=t,e.expander.querySelector(`.dcx-current`).textContent=p(t),e.nav.querySelectorAll(`.dcx-nav-list > li[data-category]`).forEach(e=>{let n=e.dataset.category===t;e.classList.toggle(`is-active`,n);let r=e.querySelector(`:scope > .dcx-nav-link`),i=e.querySelector(`:scope > .dcx-subnav`);n?(r?.setAttribute(`aria-current`,`page`),r?.setAttribute(`aria-expanded`,`true`),i?.removeAttribute(`aria-hidden`),i&&(i.inert=!1)):(r?.removeAttribute(`aria-current`),r?.removeAttribute(`aria-expanded`),i?.setAttribute(`aria-hidden`,`true`),i&&(i.inert=!0))}),ae(e,t,o),r.matches){let r=e.nav.querySelector(`.dcx-nav-list > li[data-category="${t}"]`);requestAnimationFrame(()=>{r?.scrollIntoView({behavior:n.matches?`auto`:`smooth`,block:`nearest`,inline:`nearest`})})}e.expander.dispatchEvent(new CustomEvent(`dcx:continuouscategorychange`,{bubbles:!0,detail:{category:t,article:o}})),a&&history.replaceState({category:t},``,`#${t}`)},ce=e=>{let t=[...e.main.querySelectorAll(`:scope > .dcx-article[data-dcx-category]`)];if(!t.length)return`audience`;if(e.pinnedCategory)return e.pinnedCategory;let n=e.main.getBoundingClientRect().top+e.main.clientHeight*.24,r=t[0];return t.forEach(e=>{e.getBoundingClientRect().top<=n&&(r=e)}),e.main.scrollTop+e.main.clientHeight>=e.main.scrollHeight-4&&(r=t.at(-1)),r.dataset.dcxCategory},le=e=>{e.scrollFrame||=requestAnimationFrame(()=>{e.scrollFrame=0;let t=ce(e);t!==e.currentCategory&&se(e,t,{updateHash:!0})})},ue=e=>{e.pinnedCategory=``,window.clearTimeout(e.pinTimer)},de=(e,t,r,{instant:a=!1,historyMode:o=`push`,hash:s=r}={})=>{if(!t||!i.has(r))return;e.pinnedCategory=r,se(e,r);let c=t===e.main.firstElementChild?0:g(e,t);e.main.scrollTo({top:c,behavior:a||n.matches?`auto`:`smooth`}),o===`push`&&history.pushState({category:r},``,`#${s}`),o===`replace`&&history.replaceState({category:r},``,`#${s}`),window.clearTimeout(e.pinTimer),e.pinTimer=window.setTimeout(()=>{e.pinnedCategory=``,le(e)},a?80:760)},fe=(e,t,n={})=>{let r=e.main.querySelector(`:scope > .dcx-article[data-dcx-category="${t}"]`);de(e,r,t,n)},T=(e,t)=>{let n=t.target.closest(`.dcx-nav-link[data-dcx-nav]`);if(n&&e.nav.contains(n)){t.preventDefault();let r=n.dataset.dcxNav;fe(e,r);return}let r=t.target.closest(`.dcx-sub-link[data-dcx-document-target]`);if(!r||!e.nav.contains(r))return;t.preventDefault();let i=e.main.querySelector(`#${CSS.escape(r.dataset.dcxDocumentTarget)}`);de(e,i,e.currentCategory,{historyMode:`replace`,hash:r.dataset.dcxDocumentTarget})},pe=(e,{updateHistory:t=!0}={})=>{if(!e||e.closing)return;window.closeDcxSettings?.({restoreFocus:!1,instant:!0}),e.closing=!0,e.expander.dataset.dcxClosing=`true`,ue(e),e.scrollFrame&&cancelAnimationFrame(e.scrollFrame),e.contentFrame&&cancelAnimationFrame(e.contentFrame),e.layoutFrame&&cancelAnimationFrame(e.layoutFrame),e.contentObserver?.disconnect(),e.layoutObserver?.disconnect(),e.main.removeEventListener(`scroll`,e.onScroll),e.main.removeEventListener(`wheel`,e.onManualScroll),e.main.removeEventListener(`touchstart`,e.onManualScroll),e.main.removeEventListener(`pointerdown`,e.onManualScroll),e.nav.removeEventListener(`click`,e.onNavClick);let r=(document.querySelector(`.dcx-tile[data-category="${e.currentCategory}"]`)||e.opener)?.getBoundingClientRect()||e.originRect;e.expander.classList.remove(`is-ready`,`is-full`),e.expander.style.top=`${r.top}px`,e.expander.style.left=`${r.left}px`,e.expander.style.width=`${r.width}px`,e.expander.style.height=`${r.height}px`,t&&history.pushState(null,``,`${location.pathname}${location.search}`);let i=()=>{e.expander.remove(),document.body.classList.remove(`is-locked`),e.background&&(e.background.inert=!1,e.background.removeAttribute(`aria-hidden`)),e.opener?.focus({preventScroll:!0}),l===e&&(l=null)};n.matches?i():e.closeTimer=window.setTimeout(i,540)},E=(e,{historyMode:t=`push`,opener:r=null,targetHash:a=e}={})=>{if(!i.has(e)||!h())return!1;if(l)return fe(l,e,{historyMode:t}),!0;let o=r||document.querySelector(`.dcx-tile[data-category="${e}"]`),s=document.querySelector(`#dcx-shell-template`);if(!o||!s)return!1;let c=o.getBoundingClientRect(),u=document.createElement(`section`);u.className=`dcx-expander`,u.dataset.dcxDocument=`true`,u.setAttribute(`role`,`dialog`),u.setAttribute(`aria-modal`,`true`),u.setAttribute(`aria-label`,`Design context document`),u.style.top=`${c.top}px`,u.style.left=`${c.left}px`,u.style.width=`${c.width}px`,u.style.height=`${c.height}px`,u.appendChild(s.content.cloneNode(!0));let d=document.querySelector(`[data-dcx-shell]`);d&&(d.inert=!0,d.setAttribute(`aria-hidden`,`true`)),document.body.appendChild(u),document.body.classList.add(`is-locked`);let f={expander:u,main:u.querySelector(`.dcx-main`),nav:u.querySelector(`.dcx-nav`),opener:o,originRect:c,background:d,currentCategory:``,pinnedCategory:e,pinTimer:0,scrollFrame:0,contentFrame:0,layoutFrame:0,initialCategory:e,initialHash:a,settleUntil:performance.now()+3200,userInteracted:!1,closing:!1};return l=f,C(f),oe(f),f.onScroll=()=>le(f),f.onManualScroll=()=>{f.userInteracted=!0,f.layoutObserver?.disconnect(),ue(f)},f.onNavClick=e=>{f.userInteracted=!0,T(f,e)},f.contentObserver=new MutationObserver(()=>{f.contentFrame||=requestAnimationFrame(()=>{if(f.contentFrame=0,y(f.main),se(f,f.currentCategory),!f.userInteracted&&performance.now()<f.settleUntil){let e=_(f,f.initialHash,f.initialCategory);de(f,e,f.initialCategory,{instant:!0,historyMode:`replace`,hash:f.initialHash})}})}),f.contentObserver.observe(f.main,{childList:!0,subtree:!0,attributes:!0,attributeFilter:[`id`,`data-dcx-audience-enhanced`,`data-dcx-detail-enhanced`]}),f.layoutObserver=new ResizeObserver(()=>{f.layoutFrame||f.userInteracted||performance.now()>=f.settleUntil||(f.layoutFrame=requestAnimationFrame(()=>{f.layoutFrame=0;let e=_(f,f.initialHash,f.initialCategory);de(f,e,f.initialCategory,{instant:!0,historyMode:`replace`,hash:f.initialHash})}))}),f.main.querySelectorAll(`:scope > .dcx-article[data-dcx-category]`).forEach(e=>{f.layoutObserver.observe(e)}),f.main.addEventListener(`scroll`,f.onScroll,{passive:!0}),f.main.addEventListener(`wheel`,f.onManualScroll,{passive:!0}),f.main.addEventListener(`touchstart`,f.onManualScroll,{passive:!0}),f.main.addEventListener(`pointerdown`,f.onManualScroll,{passive:!0}),f.nav.addEventListener(`click`,f.onNavClick),u.querySelector(`.dcx-close`)?.addEventListener(`click`,()=>pe(f)),se(f,e),t===`push`&&history.pushState({category:e},``,`#${a}`),t===`replace`&&history.replaceState({category:e},``,`#${a}`),requestAnimationFrame(()=>{u.classList.add(`is-full`);let t=_(f,a,e);de(f,t,e,{instant:!0,historyMode:`none`,hash:a}),window.setTimeout(()=>{u.classList.add(`is-ready`),u.querySelector(`.dcx-close`)?.focus({preventScroll:!0})},n.matches?0:260)}),[180,520,1100,1800,3e3].forEach(t=>{window.setTimeout(()=>{if(l===f&&!f.userInteracted){let t=_(f,f.initialHash,e);de(f,t,e,{instant:!0,historyMode:`replace`,hash:f.initialHash})}},t)}),!0},me=e=>{let t=e.target.closest(`.dcx-tile[data-category]`);!t||!document.querySelector(`[data-dcx-shell]`)?.contains(t)||i.has(t.dataset.category)&&h()&&(e.preventDefault(),e.stopImmediatePropagation(),E(t.dataset.category,{opener:t}))},he=e=>{if(!(e.key===`Escape`&&document.querySelector(`#dcx-context-settings[open]`))){if(e.key===`Escape`&&l){e.preventDefault(),e.stopImmediatePropagation(),pe(l);return}l&&[`ArrowDown`,`ArrowUp`,`PageDown`,`PageUp`,`Home`,`End`,` `].includes(e.key)&&(l.userInteracted=!0,ue(l))}},ge=e=>{let t=location.hash.slice(1),n=a(t);if(l?.closing&&n){e.stopImmediatePropagation(),window.closeDcxSettings?.({restoreFocus:!1,instant:!0});let r=l;window.clearTimeout(r.closeTimer),r.expander.remove(),r.background&&(r.background.inert=!1,r.background.removeAttribute(`aria-hidden`)),document.body.classList.remove(`is-locked`),l=null,E(n,{historyMode:`none`,targetHash:t});return}if(!l){if(!n){s=``,c=``;return}e.stopImmediatePropagation(),h()?E(n,{historyMode:`none`,targetHash:t}):(s=n,c=t,d||(d=new MutationObserver(ve),d.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:[`class`,`hidden`]})),ve());return}if(e.stopImmediatePropagation(),n){let e=_(l,t,n);de(l,e,n,{historyMode:`none`,hash:t})}else pe(l,{updateHistory:!1})},_e=()=>{if(u=0,!s){document.body.classList.contains(`dcx-open`)&&h()&&(d?.disconnect(),d=null);return}if(l)return;let e=document.querySelector(`[data-dcx-shell]`);if(!document.body.classList.contains(`dcx-open`)||e?.hidden||!h())return;let t=s;E(t,{historyMode:`replace`,targetHash:c||t})&&(s=``,c=``,d?.disconnect(),d=null)},ve=()=>{u||=requestAnimationFrame(_e)};window.dcxDocument={isOpen:()=>!!l,currentCategory:()=>l?.currentCategory||``,remount:()=>{if(!l||l.closing)return;let e=l,t=e.currentCategory||e.initialCategory,n=e.main.scrollTop;e.userInteracted=!0,ue(e),C(e),oe(e),e.currentCategory=``,se(e,t),requestAnimationFrame(()=>{requestAnimationFrame(()=>{e.main.scrollTop=n})})}},s&&history.replaceState(history.state,``,`${location.pathname}${location.search}`),document.addEventListener(`click`,me,!0),document.addEventListener(`click`,async e=>{let t=e.target.closest?.(`[data-dcx-copy-command]`);if(!t)return;let n=t.dataset.dcxCopyCommand,r=t.closest(`[data-dcx-command-context]`)?.querySelector(`.dcx-command-status`),i=await v(n);window.clearTimeout(t._dcxCopyTimer),t.classList.remove(`copied`),t.offsetWidth,t.classList.toggle(`copied`,i),t.dataset.copied=String(i),r&&(r.textContent=i?`Command copied.`:`The command could not be copied.`),t._dcxCopyTimer=window.setTimeout(()=>{t.classList.remove(`copied`),t.removeAttribute(`data-copied`),r&&(r.textContent=``)},1200)}),document.addEventListener(`keydown`,he,!0),window.addEventListener(`popstate`,ge,!0),d=new MutationObserver(ve),d.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:[`class`,`hidden`]}),ve()})(),(()=>{let t=[{labels:[`Who they are`],slug:`who-they-are`,variant:`people`,lede:`The core people this experience must speak to.`,icon:`audience-groups-foil.png`},{labels:[`Emotional journey`,`Emotional state`],slug:`emotional-journey`,variant:`journey`,lede:`The change in confidence the experience should create.`,icon:`emotional-journey-foil.png`},{labels:[`Needs`],slug:`needs`,variant:`list`,lede:`What the experience must make clear and easy.`,icon:`needs-foil.png`},{labels:[`Trust triggers`],slug:`trust-triggers`,variant:`list`,lede:`The signals that turn interest into confidence.`,icon:`trust-triggers-foil.png`},{labels:[`Who must not be excluded`],slug:`inclusion`,variant:`list`,lede:`Access requirements that belong in the core experience.`,icon:`inclusion-foil.png`}],n=0,r=e=>t.find(t=>t.labels.includes(e)),i=e=>{e.querySelectorAll(`:scope > .dcx-cols`).forEach(e=>{let t=document.createDocumentFragment();[...e.children].forEach(e=>t.appendChild(e)),e.replaceWith(t)})},a=t=>{t.dataset.dcxAudienceEnhanced!==`true`&&(t.classList.add(`dcx-audience`),t.querySelector(`:scope > header`)?.classList.add(`dcx-audience-hero`),i(t),[...t.querySelectorAll(`:scope > .dcx-block[data-label]`)].forEach((n,i)=>{let a=n.dataset.label||``,o=r(a);if(!o)return;n.querySelector(`:scope > .dcx-block-label`)?.remove();let s=document.createElement(`div`);for(s.className=`dcx-audience-section-body`;n.firstChild;)s.appendChild(n.firstChild);let c=document.createElement(`div`);c.className=`dcx-audience-section-heading`;let l=document.createElement(`h3`);l.className=`dcx-audience-section-title`,l.id=`dcx-audience-${o.slug}-title`,l.textContent=a;let u=document.createElement(`p`);u.className=`dcx-audience-section-lede`,u.textContent=o.lede,c.append(l,u);let d=document.createElement(`figure`);d.className=`dcx-audience-section-icon`,d.setAttribute(`data-dcx-hide-on-error`,``),d.setAttribute(`aria-hidden`,`true`);let f=document.createElement(`img`);f.src=e(`/assets/audience/${o.icon}`),f.alt=``,f.width=256,f.height=256,f.decoding=`async`,i>0&&(f.loading=`lazy`),d.appendChild(f);let p=document.createElement(`header`);if(p.className=`dcx-audience-section-head`,p.append(c,d),n.classList.add(`dcx-audience-section`,`dcx-audience-section--${o.variant}`),n.id=`dcx-audience-${o.slug}`,t.dataset.dcxCategory||(n.setAttribute(`role`,`region`),n.setAttribute(`aria-labelledby`,l.id)),o.variant===`journey`){let e=s.querySelector(`.dcx-callout-pair`);if(e&&(e.classList.add(`dcx-audience-journey`),e.children.length>1)){let t=document.createElement(`div`);t.className=`dcx-audience-journey-arrow`,t.setAttribute(`aria-hidden`,`true`),t.textContent=`→`,e.children[0].after(t)}}o.variant===`list`&&s.querySelector(`.dcx-list`)?.classList.add(`dcx-audience-list`),n.append(p,s)}),t.dataset.dcxAudienceEnhanced=`true`)},o=()=>{n=0;let e=document.querySelector(`.dcx-expander`);if(!e)return;let t=e.querySelector(`.dcx-main > .dcx-article[data-dcx-category="audience"]`);if(t){a(t);return}let r=e.querySelector(`.dcx-nav-list li[data-category="audience"].is-active`),i=e.querySelector(`.dcx-main > .dcx-article`);r&&i&&a(i)},s=()=>{n||=requestAnimationFrame(o)};new MutationObserver(s).observe(document.body,{childList:!0,subtree:!0}),window.addEventListener(`pageshow`,s),s()})();var t=JSON.parse(`[{"id":"side-tab","name":"Side-tab accent border","description":"Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.","group":"slop","discipline":"Visual Details"},{"id":"border-accent-on-rounded","name":"Border accent on rounded element","description":"Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.","group":"slop","discipline":"Visual Details"},{"id":"overused-font","name":"Overused font","description":"Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.","group":"slop","discipline":"Typography"},{"id":"flat-type-hierarchy","name":"Flat type hierarchy","description":"Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).","group":"slop","discipline":"Typography"},{"id":"gradient-text","name":"Gradient text","description":"Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.","group":"slop","discipline":"Color & Contrast"},{"id":"ai-color-palette","name":"AI color palette","description":"Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.","group":"slop","discipline":"Color & Contrast"},{"id":"cream-palette","name":"Cream / beige palette","description":"A warm cream or beige page background has become the default \\"tasteful\\" AI surface, reached for by reflex. Choose a background that comes from a deliberate palette, not the safe warm off-white.","group":"slop","discipline":"Color & Contrast"},{"id":"nested-cards","name":"Nested cards","description":"Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.","group":"slop","discipline":"Layout & Space"},{"id":"monotonous-spacing","name":"Monotonous spacing","description":"The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.","group":"slop","discipline":"Layout & Space"},{"id":"bounce-easing","name":"Bounce or elastic easing","description":"Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.","group":"slop","discipline":"Motion"},{"id":"pulsing-dot","name":"Pulsing status dot","description":"Small pulsing status dots simulate liveness decoratively. Reserve pulse animation for indicators tied to genuinely live, changing data; a static indicator with clear labeling is honest and calmer.","group":"slop","discipline":"Motion"},{"id":"blinking-cursor","name":"Decorative blinking cursor","description":"A blinking text cursor animated into a hero or landing section simulates typing where no input exists. It borrows the dev-tool aesthetic as decoration. Real editable fields draw their own caret; anywhere else, let the composition hold attention without a fake prompt.","group":"slop","discipline":"Motion"},{"id":"shape-assembled-illustration","name":"Shape-assembled illustration","description":"A large inline SVG that builds a pictorial scene from a pile of primitive shapes reads as placeholder clip art, not illustration. Icons, logos, and data graphics are fine at their scale; a hero-sized visual deserves real artwork, a photograph, or a deliberately drawn graphic.","group":"slop","discipline":"Imagery"},{"id":"dark-glow","name":"Glowing shadow accents","description":"Colored glow shadows — a zero-offset chromatic halo (box- or text-shadow) on any background, or any colored blurred shadow on a dark background — are the default \\"cool\\" look of AI-generated UIs. Use neutral elevation shadows and subtle, purposeful lighting instead.","group":"slop","discipline":"Color & Contrast"},{"id":"radial-halo","name":"Radial-gradient background halo","description":"A chromatic radial-gradient wash — saturated at the center, fading to transparent — used as a decorative background glow on a dark page. Same tell as glowing shadows, drawn with a gradient instead of a shadow. Ground the surface with a solid or subtly shifted background instead.","group":"slop","discipline":"Color & Contrast"},{"id":"radial-spotlight-glow","name":"Decorative radial spotlight glow","description":"A soft, low-opacity accent-colored radial gradient fading to transparent, dropped behind a hero or section as a \\"spotlight.\\" It is a reflex AI decoration — the translucent cousin of the saturated radial halo. Let the surface stand on its own, or light the composition with a deliberate material accent rather than a floating colored haze.","group":"slop","discipline":"Color & Contrast"},{"id":"marquee","name":"Auto-scrolling marquee","description":"Continuously auto-scrolling content demands attention it has not earned and hides half its content at any moment. Reserve motion for content that changes; let readers move at their own pace.","group":"slop","discipline":"Motion"},{"id":"icon-tile-stack","name":"Icon tile stacked above heading","description":"A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.","group":"slop","discipline":"Typography"},{"id":"italic-serif-display","name":"Italic serif display headline","description":"Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set roman, or move to a non-serif display face. Editorial / magazine register may legitimately want this — judge by context.","group":"slop","discipline":"Typography"},{"id":"hero-eyebrow-chip","name":"Hero eyebrow / pill chip","description":"A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero. Drop the eyebrow, integrate the kicker into the headline, or run it as a navigation breadcrumb instead.","group":"slop","discipline":"Typography"},{"id":"kicker-above-heading","name":"Kicker / eyebrow label above heading","description":"A tiny tracked uppercase or small-caps label sitting as its own block directly above a heading is banned outright, repeated or not. Generated kickers never earn their place: the heading carries its own weight. Delete the label and let the heading speak; if the words matter, work them into the heading or the body.","group":"slop","discipline":"Typography"},{"id":"numbered-section-labels","name":"Tiny numbered section labels","description":"Small numeric index labels riding next to section headings, repeated section after section, are AI editorial scaffolding — a page numbering its own chapters instead of earning structure. Let hierarchy, content, and rhythm carry the sequence.","group":"slop","discipline":"Layout & Space"},{"id":"em-dash-overuse","name":"Em-dash overuse","description":"Em-dash saturation in body copy is an AI cadence tell. Advisory only: humans use em-dashes legitimately, so this fires only on saturation — at least 8 em-dashes (— or --) at a density near one per 500 characters of body text — never on a long article that uses a few. Prefer commas, colons, periods, or parentheses.","group":"slop","discipline":"Copy"},{"id":"marketing-buzzword","name":"Marketing buzzword","description":"Generic SaaS phrases (streamline / empower / supercharge / world-class / enterprise-grade / next-generation / cutting-edge / etc) are instant AI tells. Pick a specific verb and noun that says what the product literally does.","group":"slop","discipline":"Copy"},{"id":"aphoristic-cadence","name":"Aphoristic-cadence copy","description":"Three or more sections landing on a short rebuttal sentence (\\"X. No Y.\\" / \\"X. Just Y.\\") or a manufactured-contrast aphorism (\\"Not a feature. A platform.\\") reads as AI cadence, not voice. Once is fine; the pattern is the tell.","group":"slop","discipline":"Copy"},{"id":"oversized-h1","name":"Oversized hero headline","description":"A full-sentence headline set at display size ends up dominating the viewport, leaving no room for anything else above the fold. A punchy one- or two-word headline at that size is fine — the problem is a long headline blown up too large. Set long headlines smaller, or tighten the copy.","group":"slop","discipline":"Typography"},{"id":"extreme-negative-tracking","name":"Crushed letter spacing","description":"Letter-spacing pulled tighter than the point where characters keep their own shapes costs legibility. Tighten display type optically, not destructively.","group":"slop","discipline":"Typography"},{"id":"broken-image","name":"Broken or placeholder image","description":"<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.","group":"quality","discipline":"Imagery"},{"id":"script-error","name":"Uncaught script error on load","description":"A script threw an uncaught exception or failed to parse while the page loaded. Broken JavaScript silently kills reveals, interactions, and dynamic content, and can leave most of a page invisible. Fix the error before judging anything else.","group":"quality","discipline":"Quality"},{"id":"content-hidden-at-rest","name":"Content invisible at rest","description":"A large share of the page text sits at opacity 0 or visibility hidden even after every reveal handler had a chance to run. This is the failed-reveal signature: the content shipped but never becomes visible. Make content visible by default and let JavaScript enhance its entrance instead of gating its existence.","group":"quality","discipline":"Layout & Space"},{"id":"edge-flush-cards","name":"Cards flush against the scroller edge","description":"Cards inside a horizontal scroller or tab panel sit flush against the container edge at rest while keeping a gutter on the other side, so their edges and rounded corners get cut off. Usually the panel is sized wider than its clip box. Keep a consistent inset on both sides.","group":"quality","discipline":"Layout & Space"},{"id":"text-occlusion","name":"Text occluded by an overlapping element","description":"Text is painted under an opaque element or a second text run, so part of it cannot be read. A decorative box, a stacked layer, or an inline element with leaked padding lands on the words instead of beside them. Give overlapping layers room, or move the text out from under the layer above it.","group":"quality","discipline":"Layout & Space"},{"id":"first-viewport-column-overflow","name":"One column stretches the first viewport","description":"A multi-column opening section lets one column run far past the fold while its sibling fits in a single viewport, so the short column floats in dead space and the fold falls deep inside one section. Balance the columns, cap the tall one, or let the long content flow below the opening row.","group":"quality","discipline":"Layout & Space"},{"id":"gray-on-color","name":"Gray text on colored background","description":"Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.","group":"quality","discipline":"Color & Contrast"},{"id":"low-contrast","name":"Low contrast text","description":"Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.","group":"quality","discipline":"Quality"},{"id":"layout-transition","name":"Layout property animation","description":"Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.","group":"quality","discipline":"Motion"},{"id":"line-length","name":"Line length too long","description":"Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.","group":"quality","discipline":"Layout & Space"},{"id":"cramped-padding","name":"Cramped padding","description":"Text is too close to the edge of its container. Two shapes: (1) an element with its own text where the padding is too low for the font size, and (2) a wrapper with text-bearing children and near-zero padding against a visible boundary (border, outline, or non-transparent background) — children land flush against the boundary line. Add at least 8px (ideally 12–16px) of padding inside bordered, outlined, or colored containers.","group":"quality","discipline":"Layout & Space"},{"id":"body-text-viewport-edge","name":"Body text touching viewport edge","description":"Body paragraphs render flush against the left or right viewport edge with no container providing horizontal padding. Wrap content in a container with at least 16px (ideally 24-32px) of horizontal padding, or apply max-width with mx-auto.","group":"quality","discipline":"Layout & Space"},{"id":"tight-leading","name":"Tight line height","description":"Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.","group":"quality","discipline":"Typography"},{"id":"skipped-heading","name":"Skipped heading level","description":"Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.","group":"quality","discipline":"Typography"},{"id":"heading-rhythm","name":"Heading crowded against the previous block","description":"A heading binds to the content it introduces, so the rendered space above it should exceed the space below it. When headings across a page sit as close or closer to the block above than to their own content, every section reads as if it captions the previous one. Open up the space above each heading.","group":"quality","discipline":"Layout & Space"},{"id":"justified-text","name":"Justified text","description":"Justified text without hyphenation creates uneven word spacing (\\"rivers of white\\"). Use text-align: left for body text, or enable hyphens: auto if you must justify.","group":"quality","discipline":"Typography"},{"id":"tiny-text","name":"Tiny body text","description":"Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.","group":"quality","discipline":"Typography"},{"id":"undersized-ui-text","name":"Undersized functional text","description":"Interactive and content-bearing UI text (links, buttons, nav items, labels, table cells, meta rows, timecodes) below 11px is a legibility failure, not a style choice. WCAG sets no absolute pixel floor, but functional text under 11px is a defensible quality bar: it fails on high-DPI and small viewports and it degrades tap and read targets. The 11px floor holds even inside a footer; only non-interactive legal smallprint gets the softer 10px floor. Being ON the DESIGN.md size ramp does not exempt a value here: adding 8px to the ramp launders the token but not the legibility problem, and that is exactly the escape hatch this rule closes. Exempts sup/sub, visually-hidden (sr-only) text, and code/terminal contexts. Decorative letterspaced micro-labels are still functional and stay in scope.","group":"quality","discipline":"Typography"},{"id":"all-caps-body","name":"All-caps body text","description":"Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.","group":"quality","discipline":"Typography"},{"id":"wide-tracking","name":"Wide letter spacing on body text","description":"Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.","group":"quality","discipline":"Typography"},{"id":"text-overflow","name":"Content overflowing its container","description":"Content renders wider than its container, spilling out or forcing a horizontal scrollbar. Let text wrap, constrain widths, or give the region a deliberate scroll affordance.","group":"quality","discipline":"Layout & Space"},{"id":"repeated-container-text","name":"Same text repeated inside one container","description":"The same literal text rendered three or more times in structurally different spots inside a single card or panel is redundant messaging — usually a status or label wired into every slot of a template. Say it once, in the slot where it matters most.","group":"quality","discipline":"Quality"},{"id":"clipped-overflow-container","name":"Positioned child clipped by overflow container","description":"A clipping container (overflow hidden or clip) wrapping an absolutely-positioned child cuts off tooltips, menus, and popovers that need to escape. Let the overflow be visible, or move the positioned layer out of the clip.","group":"quality","discipline":"Layout & Space"},{"id":"design-system-font","name":"Font outside DESIGN.md","description":"A font is used that is not declared in DESIGN.md typography. Use the documented type system or update DESIGN.md if this is an intentional brand addition.","group":"quality","discipline":"Typography"},{"id":"design-system-color","name":"Color outside DESIGN.md","description":"A literal color is outside the DESIGN.md palette and sidecar tonal ramps. This may be legitimate, but it should be an intentional design-system addition rather than drift.","group":"quality","discipline":"Color & Contrast"},{"id":"design-system-radius","name":"Radius outside DESIGN.md","description":"A border-radius value is outside the DESIGN.md rounded scale. Use a documented radius token or update the design system if the new shape is intentional.","group":"quality","discipline":"Visual Details"},{"id":"design-system-font-size","name":"Font size outside DESIGN.md","description":"A literal font-size is off the type ramp documented in DESIGN.md typography. Use a documented size step or update the design system if the new step is intentional.","group":"quality","discipline":"Typography"},{"id":"gpt-thin-border-wide-shadow","name":"Hairline border with wide shadow","description":"A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.","group":"fingerprints","discipline":"Visual Details"},{"id":"repeating-stripes-gradient","name":"Repeating-gradient stripes","description":"Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.","group":"fingerprints","discipline":"Visual Details"},{"id":"codex-grid-background","name":"Decorative grid-line background","description":"A decorative grid or line-field background drawn with hairline linear-gradient layers tiled by a fixed pixel cell is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.","group":"fingerprints","discipline":"Visual Details"},{"id":"theater-slop-phrase","name":"Theater framing copy","description":"Dismissing something as \\"theater\\" is a recurring generated-copy tic. Say plainly what the thing does or does not do.","group":"fingerprints","discipline":"Copy"},{"id":"image-hover-transform","name":"Image hover transform","description":"Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.","group":"slop","discipline":"Motion"}]`);(()=>{let e=`dcx-hooks-preview-v1`,n=window.matchMedia(`(max-width: 560px)`),r=window.matchMedia(`(prefers-reduced-motion: reduce)`),i={fingerprints:{label:`Fingerprints`,description:`Recurring signatures found across generated interfaces.`},slop:{label:`UI tells`,description:`Common generated-UI habits that make a design feel interchangeable.`},quality:{label:`Quality floor`,description:`Measurable defects in legibility, hierarchy, overflow, and system consistency.`}},a=[`Visual Details`,`Typography`,`Color & Contrast`,`Layout & Space`,`Motion`,`Imagery`,`Copy`,`Quality`],o=()=>({enabled:!0,activeFamily:`fingerprints`,disabled:[`em-dash-overuse`],custom:[]}),s=(()=>{let t=o();try{let n=JSON.parse(localStorage.getItem(e)||`null`);return!n||typeof n!=`object`?t:{enabled:n.enabled!==!1,activeFamily:i[n.activeFamily]?n.activeFamily:t.activeFamily,disabled:Array.isArray(n.disabled)?n.disabled.filter(e=>typeof e==`string`):t.disabled,custom:Array.isArray(n.custom)?n.custom.filter(e=>e&&typeof e.id==`string`&&typeof e.name==`string`):[]}}catch{return t}})(),c=new Set(s.disabled),l=new WeakMap,u=new WeakMap,d=0,f=()=>{s.disabled=[...c];try{localStorage.setItem(e,JSON.stringify(s))}catch{}},p=e=>String(e).replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`),m=e=>String(e).toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`custom-rule`,h=e=>{let t=String(e).trim();return t.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim()||t},g=()=>`
    <article class="dcx-article">
      <header>
        <h2 class="dcx-title">Hooks</h2>
        <p class="dcx-lede">Checks that catch design regressions while you work.</p>
      </header>
      <section class="dcx-block" data-label="How it runs">
        <span class="dcx-block-label">How it runs</span>
        <div class="dcx-hooks-intro">
          <p class="dcx-hooks-definition">Hooks watch interface changes and surface problems before they spread.</p>
          <div class="dcx-hooks-status" data-hooks-status>
            <div class="dcx-hooks-status-copy">
              <strong data-hooks-master-copy>Enable hooks</strong>
              <p data-hooks-master-detail>Preview only — project settings are unchanged.</p>
            </div>
            <div class="dcx-hooks-status-control">
              <span class="dcx-hooks-status-state" data-hooks-master-state>On</span>
              <label class="dcx-hooks-switch dcx-hooks-switch--master">
                <input type="checkbox" role="switch" data-hooks-master aria-label="Enable design hooks">
                <span aria-hidden="true"></span>
              </label>
            </div>
          </div>
          <dl class="dcx-hooks-flow">
            <div>
              <dt>On each edit</dt>
              <dd>Checks the changed UI.</dd>
            </div>
            <div>
              <dt>At session end</dt>
              <dd>Runs a full pass on touched UI files.</dd>
            </div>
          </dl>
        </div>
      </section>
      <section class="dcx-block" data-label="Built-in rules">
        <span class="dcx-block-label">Built-in rules</span>
        <div class="dcx-hooks-browser" data-hooks-browser>
          <div class="dcx-hooks-families" role="tablist" aria-label="Rule families" data-hooks-families></div>
          <div class="dcx-hooks-rule-panel" id="dcx-hooks-rule-panel" role="tabpanel">
            <div class="dcx-hooks-toolbar">
              <label class="dcx-hooks-search">
                <input type="search" autocomplete="off" aria-label="Search rules" placeholder="Search rules" data-hooks-search>
              </label>
              <p class="dcx-hooks-summary" data-hooks-summary aria-live="polite"></p>
            </div>
            <div class="dcx-hooks-rule-groups" data-hooks-rule-groups></div>
          </div>
        </div>
      </section>
      <section class="dcx-block" data-label="Custom rules">
        <span class="dcx-block-label">Custom rules</span>
        <div class="dcx-hooks-custom" data-hooks-custom>
          <div class="dcx-hooks-custom-toolbar">
            <p data-hooks-custom-count>No custom rules.</p>
            <button class="dcx-hooks-button" type="button" data-hooks-add aria-expanded="false" aria-controls="dcx-hooks-custom-form">Add rule</button>
          </div>
          <form class="dcx-hooks-custom-form" id="dcx-hooks-custom-form" data-hooks-form hidden>
            <label>
              <span>Rule name</span>
              <input name="name" required maxlength="80" placeholder="e.g. Approved corner radius">
            </label>
            <label>
              <span>Category</span>
              <select name="discipline">
                <option>Visual Details</option>
                <option>Typography</option>
                <option>Color & Contrast</option>
                <option>Layout & Space</option>
                <option>Motion</option>
                <option>Imagery</option>
                <option>Copy</option>
              </select>
            </label>
            <label class="dcx-hooks-custom-form-description">
              <span>What should it catch?</span>
              <textarea name="description" required rows="3" maxlength="240" placeholder="Describe the condition and the correction."></textarea>
            </label>
            <div class="dcx-hooks-form-actions">
              <button class="dcx-hooks-button dcx-hooks-button--quiet" type="button" data-hooks-cancel>Cancel</button>
              <button class="dcx-hooks-button" type="submit">Save rule</button>
            </div>
          </form>
          <div class="dcx-hooks-custom-list" data-hooks-custom-list></div>
          <p class="dcx-hooks-storage-note">Preview only — saved in this browser; custom rules do not run.</p>
        </div>
      </section>
    </article>
  `,_=()=>{let e=document.querySelector(`.dcx-tile[data-category="interface"]`);if(e){e.dataset.category=`hooks`,e.dataset.name=`Hooks`,e.setAttribute(`aria-label`,`Open Hooks`);let t=e.querySelector(`.dcx-tile-title`);t&&(t.textContent=`Hooks`)}let t=document.querySelector(`#dcx-shell-template`)?.content.querySelector(`li[data-category="interface"]`),n=t?.querySelector(`.dcx-nav-link`);t&&n&&(t.dataset.category=`hooks`,n.href=`#hooks`,n.dataset.dcxNav=`hooks`,n.textContent=`Hooks`)},v=()=>{if(document.querySelector(`#dcx-detail-hooks`))return;let e=document.createElement(`template`);e.id=`dcx-detail-hooks`,e.innerHTML=g(),document.querySelector(`#dcx-detail-interface`)?.after(e)},y=e=>t.filter(t=>t.group===e),b=e=>!c.has(e),ee=e=>{if(!n.matches)return;let t=e.querySelector(`[data-hooks-family][aria-selected="true"]`);if(!t)return;let i=e.getBoundingClientRect(),a=t.getBoundingClientRect(),o=0;a.left<i.left+3?o=a.left-i.left-3:a.right>i.right-3&&(o=a.right-i.right+3),!(Math.abs(o)<1)&&e.scrollTo({left:Math.max(0,e.scrollLeft+o),behavior:r.matches?`auto`:`smooth`})},x=(e,t)=>{let n=e.querySelector(`:scope > .dcx-hooks-disclosure`),i=n?.querySelector(`:scope > .dcx-hooks-disclosure-inner`);if(!n||!i){e.open=t;return}let a=l.get(e),o=n.getBoundingClientRect().height,s=Number.parseFloat(getComputedStyle(n).opacity)||0;if(a?.cancel(),r.matches){l.delete(e),e.classList.remove(`is-closing`),e.open=t,n.style.removeProperty(`height`),n.style.removeProperty(`opacity`);return}e.open=!0,e.classList.toggle(`is-closing`,!t);let c=a?o:t?0:o,u=a?s:+!t,d=t?i.scrollHeight:0,f=+!!t,p=n.animate([{height:`${c}px`,opacity:u},{height:`${d}px`,opacity:f}],{duration:360,easing:`cubic-bezier(0.22, 1, 0.36, 1)`,fill:`both`});l.set(e,p),p.finished.then(()=>{l.get(e)===p&&(l.delete(e),e.classList.remove(`is-closing`),e.open=t,p.cancel(),n.style.removeProperty(`height`),n.style.removeProperty(`opacity`))}).catch(()=>{})},S=(e,t)=>{let n=u.get(e),i=e.hidden?0:e.getBoundingClientRect().height,a=e.hidden?0:Number.parseFloat(getComputedStyle(e).opacity)||1;if(n?.cancel(),r.matches){u.delete(e),e.hidden=!t;return}t&&(e.hidden=!1);let o=t?e.scrollHeight:0;e.style.overflow=`clip`;let s=e.animate([{height:`${i}px`,opacity:a},{height:`${o}px`,opacity:+!!t}],{duration:320,easing:`cubic-bezier(0.22, 1, 0.36, 1)`,fill:`both`});u.set(e,s),s.finished.then(()=>{u.get(e)===s&&(u.delete(e),e.hidden=!t,s.cancel(),e.style.removeProperty(`height`),e.style.removeProperty(`opacity`),e.style.removeProperty(`overflow`))}).catch(()=>{})},te=(e,t)=>{let n=t.parentElement,r=!n.open||n.classList.contains(`is-closing`),i=e.querySelector(`[data-hooks-search]`)?.value.trim();r&&!i&&n.parentElement?.querySelectorAll(`:scope > .dcx-hooks-discipline[open]`).forEach(e=>{e!==n&&x(e,!1)}),x(n,r)},ne=e=>{let t=e.querySelector(`[data-hooks-families]`);t&&(t.innerHTML=Object.entries(i).map(([e,t])=>{let n=y(e),r=n.filter(e=>b(e.id)).length,i=s.activeFamily===e;return`
        <button
          id="dcx-hooks-family-${e}"
          class="dcx-hooks-family${i?` is-active`:``}"
          type="button"
          role="tab"
          tabindex="${i?`0`:`-1`}"
          aria-selected="${i}"
          aria-label="${p(t.label)}, ${r} of ${n.length} selected"
          aria-controls="dcx-hooks-rule-panel"
          data-hooks-family="${e}"
        >
          <span class="dcx-hooks-family-name">${p(t.label)}</span>
          <span class="dcx-hooks-family-count">${r}/${n.length}</span>
        </button>
      `}).join(``),e.querySelector(`#dcx-hooks-rule-panel`)?.setAttribute(`aria-labelledby`,`dcx-hooks-family-${s.activeFamily}`),requestAnimationFrame(()=>ee(t)))},re=e=>{let t=e.querySelector(`[data-hooks-rule-groups]`),n=e.querySelector(`[data-hooks-summary]`),r=e.querySelector(`[data-hooks-search]`);if(!t||!n)return;let i=(r?.value||``).trim().toLowerCase(),o=y(s.activeFamily),c=o.filter(e=>!i||`${e.id} ${e.name} ${e.description} ${e.discipline}`.toLowerCase().includes(i)),l=o.filter(e=>b(e.id)).length;n.textContent=i?`${c.length} matching ${c.length===1?`rule`:`rules`}`:`${l} of ${o.length} selected`;let u=new Map;c.forEach(e=>{u.has(e.discipline)||u.set(e.discipline,[]),u.get(e.discipline).push(e)});let d=[...u.entries()].sort(([e],[t])=>{let n=a.indexOf(e),r=a.indexOf(t);return(n===-1?99:n)-(r===-1?99:r)||e.localeCompare(t)});if(!d.length){t.innerHTML=`<p class="dcx-hooks-empty">No rules match this search.</p>`;return}t.innerHTML=d.map(([e,t],n)=>{let r=`dcx-hooks-${s.activeFamily}-${m(e)}`,a=`${r}-summary`;return`
      <details class="dcx-hooks-discipline" ${i||n===0?`open`:``}>
        <summary id="${a}">
          <span>${p(e)}</span>
          <span>${t.length}</span>
        </summary>
        <div class="dcx-hooks-disclosure" id="${r}" role="region" aria-labelledby="${a}">
          <div class="dcx-hooks-disclosure-inner">
            <ul class="dcx-hooks-rules">
              ${t.map(e=>`
                <li class="dcx-hooks-rule" data-rule-id="${p(e.id)}">
                  <div class="dcx-hooks-rule-copy">
                    <strong>${p(e.name)}</strong>
                    <p>${p(h(e.description))}</p>
                  </div>
                  <label class="dcx-hooks-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-hooks-rule="${p(e.id)}"
                      aria-label="Enable ${p(e.name)}"
                      ${b(e.id)?`checked`:``}
                    >
                    <span aria-hidden="true"></span>
                  </label>
                </li>
              `).join(``)}
            </ul>
          </div>
        </div>
      </details>
    `}).join(``)},C=e=>{let t=e.querySelector(`[data-hooks-custom-list]`),n=e.querySelector(`[data-hooks-custom-count]`);if(t){if(n&&(n.textContent=s.custom.length?`${s.custom.length} custom ${s.custom.length===1?`rule`:`rules`}`:`No custom rules.`),!s.custom.length){t.innerHTML=``;return}t.innerHTML=``,s.custom.forEach(e=>{let n=document.createElement(`article`);n.className=`dcx-hooks-custom-rule`;let r=document.createElement(`div`);r.className=`dcx-hooks-rule-copy`;let i=document.createElement(`code`);i.textContent=e.id;let a=document.createElement(`strong`);a.textContent=e.name;let o=document.createElement(`p`);o.textContent=e.description;let s=document.createElement(`span`);s.className=`dcx-hooks-custom-discipline`,s.textContent=e.discipline,r.append(i,a,o,s);let c=document.createElement(`div`);c.className=`dcx-hooks-custom-controls`;let l=document.createElement(`label`);l.className=`dcx-hooks-switch`;let u=document.createElement(`input`);u.type=`checkbox`,u.setAttribute(`role`,`switch`),u.setAttribute(`aria-label`,`Enable ${e.name}`),u.dataset.hooksCustomRule=e.id,u.checked=e.enabled!==!1;let d=document.createElement(`span`);d.setAttribute(`aria-hidden`,`true`),l.append(u,d);let f=document.createElement(`button`);f.className=`dcx-hooks-remove`,f.type=`button`,f.dataset.hooksRemove=e.id,f.setAttribute(`aria-label`,`Remove ${e.name}`),f.textContent=`Remove`,c.append(l,f),n.append(r,c),t.appendChild(n)})}},w=e=>{let t=e.querySelector(`[data-hooks-master]`),n=e.querySelector(`[data-hooks-status]`),r=e.querySelector(`[data-hooks-master-copy]`),i=e.querySelector(`[data-hooks-master-detail]`),a=e.querySelector(`[data-hooks-master-state]`);!t||!n||!r||!i||!a||(t.checked=s.enabled,n.classList.toggle(`is-paused`,!s.enabled),r.textContent=`Enable hooks`,i.textContent=`Preview only — project settings are unchanged.`,a.textContent=s.enabled?`On`:`Off`)},ie=e=>{w(e),ne(e),re(e),C(e)},ae=()=>{d=0,document.querySelectorAll(`.dcx-article[data-dcx-category="hooks"]`).forEach(e=>{e.dataset.dcxHooksReady!==`true`&&(e.dataset.dcxHooksReady=`true`,ie(e))})},oe=()=>{d||=requestAnimationFrame(ae)};document.addEventListener(`click`,e=>{let t=e.target.closest(`.dcx-article[data-dcx-category="hooks"]`);if(!t)return;let n=e.target.closest(`.dcx-hooks-discipline > summary`);if(n){e.preventDefault(),te(t,n);return}let r=e.target.closest(`[data-hooks-family]`);if(r){let e=r===document.activeElement;s.activeFamily=r.dataset.hooksFamily,f(),ne(t),re(t),e&&t.querySelector(`[data-hooks-family="${s.activeFamily}"]`)?.focus({preventScroll:!0});return}let i=e.target.closest(`[data-hooks-add]`);if(i){let e=t.querySelector(`[data-hooks-form]`);if(!e)return;S(e,!0),i.setAttribute(`aria-expanded`,`true`),e.querySelector(`input[name='name']`)?.focus();return}if(e.target.closest(`[data-hooks-cancel]`)){let e=t.querySelector(`[data-hooks-form]`);e?.reset(),e&&S(e,!1);let n=t.querySelector(`[data-hooks-add]`);n?.setAttribute(`aria-expanded`,`false`),n?.focus({preventScroll:!0});return}let a=e.target.closest(`[data-hooks-remove]`);a&&(s.custom=s.custom.filter(e=>e.id!==a.dataset.hooksRemove),f(),C(t),(t.querySelector(`[data-hooks-remove]`)||t.querySelector(`[data-hooks-add]`))?.focus({preventScroll:!0}))}),document.addEventListener(`input`,e=>{if(!e.target.matches(`[data-hooks-search]`))return;let t=e.target.closest(`.dcx-article[data-dcx-category="hooks"]`);t&&re(t)}),document.addEventListener(`keydown`,e=>{let t=e.target.closest(`.dcx-hooks-discipline > summary`);if(t&&[`Enter`,` `].includes(e.key)){if(e.preventDefault(),!e.repeat){let e=t.closest(`.dcx-article[data-dcx-category="hooks"]`);e&&te(e,t)}return}let n=e.target.closest(`[data-hooks-family]`);if(!n||![`ArrowLeft`,`ArrowRight`,`ArrowUp`,`ArrowDown`,`Home`,`End`].includes(e.key))return;let r=n.closest(`.dcx-article[data-dcx-category="hooks"]`),i=[...r.querySelectorAll(`[data-hooks-family]`)],a=i.indexOf(n);if(a<0)return;e.preventDefault();let o=[`ArrowRight`,`ArrowDown`].includes(e.key)?1:-1;i[e.key===`Home`?0:e.key===`End`?i.length-1:(a+o+i.length)%i.length].click(),r.querySelector(`[data-hooks-family="${s.activeFamily}"]`)?.focus()}),document.addEventListener(`change`,e=>{let t=e.target.closest(`.dcx-article[data-dcx-category="hooks"]`);if(t){if(e.target.matches(`[data-hooks-master]`)){s.enabled=e.target.checked,f(),w(t);return}if(e.target.matches(`[data-hooks-rule]`)){e.target.checked?c.delete(e.target.dataset.hooksRule):c.add(e.target.dataset.hooksRule),f(),ne(t);let n=t.querySelector(`[data-hooks-search]`)?.value.trim(),r=t.querySelector(`[data-hooks-summary]`);if(!n&&r){let e=y(s.activeFamily);r.textContent=`${e.filter(e=>b(e.id)).length} of ${e.length} selected`}return}if(e.target.matches(`[data-hooks-custom-rule]`)){let t=s.custom.find(t=>t.id===e.target.dataset.hooksCustomRule);t&&(t.enabled=e.target.checked,f())}}}),document.addEventListener(`submit`,e=>{let n=e.target.closest(`[data-hooks-form]`);if(!n)return;e.preventDefault();let r=n.closest(`.dcx-article[data-dcx-category="hooks"]`);if(!r)return;let i=new FormData(n),a=String(i.get(`name`)||``).trim(),o=String(i.get(`description`)||``).trim(),c=String(i.get(`discipline`)||`Visual Details`);if(!a||!o)return;let l=m(a),u=l,d=2,p=new Set([...t.map(e=>e.id),...s.custom.map(e=>e.id)]);for(;p.has(u);)u=`${l}-${d}`,d+=1;s.custom.push({id:u,name:a,description:o,discipline:c,enabled:!0}),f(),n.reset(),S(n,!1);let h=r.querySelector(`[data-hooks-add]`);h?.setAttribute(`aria-expanded`,`false`),C(r),h?.focus({preventScroll:!0})}),_(),v(),new MutationObserver(oe).observe(document.body,{childList:!0,subtree:!0}),window.addEventListener(`pageshow`,oe),oe()})(),(()=>{let t={product:{Purpose:[`Why the product exists and what success looks like.`,`/assets/product/product-purpose-foil.png`],Positioning:[`The strategic space this product should occupy.`,`/assets/product/product-positioning-foil.png`],"Primary conversion":[`The single action the experience should make inevitable.`,`/assets/product/product-primary-conversion-foil.png`],"What must be clear first":[`The facts people need before anything else.`,`/assets/product/product-clear-first-foil.png`],"Product principles":[`The rules that keep every product decision aligned.`,`/assets/product/product-principles-foil.png`],"Operating context":[`Where and how the product must work.`,`/assets/product/product-operating-context-foil.png`],Surfaces:[`The chosen experiences and the job each one performs.`,`/assets/product/product-surfaces-foil.png`]},brand:{Personality:[`The character every expression should carry.`,`/assets/brand/brand-personality-foil.png`],Voice:[`How the brand sounds—and what it deliberately avoids.`,`/assets/brand/brand-voice-foil.png`],Principles:[`The rules that turn character into consistent choices.`,`/assets/brand/brand-principles-foil.png`],Commitments:[`The promises the brand must keep.`,`/assets/brand/brand-commitments-foil.png`],"Named references":[`Useful signals to borrow without becoming an imitation.`],"Anti-reference":[`The direction the brand must deliberately avoid.`],Marks:[`The identity assets already available to the system.`],"Boards and references":[`Visual evidence that should inform the work.`],"Assets provided":[`The source material available for production.`],"Brand assets":[`Logos, moodboards, and visual references available to the system.`]},color:{"The cue":[``,`/assets/color/color-palette-foil.png`],"Also generated":[`Adjacent directions retained as useful context.`],Palette:[`The core color relationships for the experience.`,`/assets/color/color-palette-foil.png`],"Strategy per surface":[`How the palette changes emphasis across contexts.`,`/assets/color/color-strategy-per-surface-foil.png`]},typography:{"The pair":[`Two typefaces with distinct, complementary jobs.`,`/assets/typography/typography-pair-foil.png`],"Type scale":[`The hierarchy that gives content pace and proportion.`,`/assets/typography/typography-type-scale-foil.png`],"In running text":[`How the pair behaves when the content gets real.`]},components:{Buttons:[`Variants, sizes, icons, and loading states.`],"Input fields":[`States, sizes, affixes, and multiline input.`],Cards:[`Content, media, horizontal, and action compositions.`]},material:{"The page, as chosen":[`What each selected surface represents in this design context.`],"Motion per surface":[`How movement supports each context without becoming spectacle.`],Motion:[`How movement should support the experience.`],Accessibility:[`The rules that keep the material system readable and operable.`],"Layout structure":[`The spatial system that organizes the page.`,`/assets/material/material-layout-structure-foil.png`],"Boundaries per surface":[`Where separation is visible—and where space does the work.`,`/assets/material/material-boundaries-per-surface-foil.png`],"Corners per surface":[`How edge character changes with context.`,`/assets/material/material-corners-per-surface-foil.png`],"Depth per surface":[`How hierarchy is expressed without decorative elevation.`,`/assets/material/material-depth-per-surface-foil.png`],Iconography:[`The chosen icon library, its character, grid, stroke, and license.`]},hooks:{"How it runs":[``],"Built-in rules":[`Choose what the detector watches.`],"Custom rules":[``]}},n=0,r=e=>e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``),i=(e,t)=>{e.querySelectorAll(`:scope .dcx-principles > li`).forEach(n=>{let r=n.querySelector(`:scope > .dcx-detail-principle-copy`);if(!r){for(r=document.createElement(`div`),r.className=`dcx-detail-principle-copy`;n.firstChild;)r.appendChild(n.firstChild);n.appendChild(r)}if(t===`product`&&e.dataset.label===`Product principles`){let e=r.querySelector(`:scope > strong:first-child`)?.nextSibling;e?.nodeType===Node.TEXT_NODE&&(e.textContent=e.textContent.replace(/^\s*[—–-]+\s*/,` `))}})},a=e=>{e.querySelectorAll(`h3`).forEach(e=>{let t=document.createElement(`h4`);for([...e.attributes].forEach(e=>{t.setAttribute(e.name,e.value)});e.firstChild;)t.appendChild(e.firstChild);e.replaceWith(t)})},o=(e,t)=>{if(t!==`product`||e.dataset.label!==`Purpose`)return;let n=e.querySelector(`:scope .dcx-purpose .dcx-callout`),r=n?.querySelector(`:scope > .dcx-callout-name`),i=e.querySelector(`:scope .dcx-purpose > .dcx-platform-pill`);!n||!r||!i||(i.classList.remove(`dcx-chip`),r.after(i))},s=e=>{e.querySelectorAll(`:scope .dcx-fan-note`).forEach(e=>e.remove())},c=e=>{if(e.dataset.dcxColorCompacted===`true`)return;let t=new Map([...e.querySelectorAll(`:scope > .dcx-block[data-label]`)].map(e=>[e.dataset.label,e])),n=t.get(`The cue`),r=t.get(`Palette`),i=t.get(`Strategy per surface`),a=n?.querySelector(`:scope > .dcx-cue`),o=r?.querySelector(`:scope > .dcx-fan`);if(n?.querySelector(`:scope > .dcx-fan-note`)?.remove(),i?.querySelector(`:scope > .dcx-fan-note`)?.remove(),t.get(`Roles and values`)?.remove(),t.get(`Interview direction`)?.remove(),a&&o){let e=a.querySelector(`:scope > .dcx-cue-card`),t=[...o.querySelectorAll(`:scope > .dcx-fan-panel`)];if(e&&t.length){e.querySelector(`:scope > .dcx-cue-tag`)?.remove(),e.querySelector(`:scope > .dcx-cue-name`)?.remove();let n=document.createElement(`ul`);n.className=`dcx-cue-bands`,n.setAttribute(`aria-label`,`Committed palette`),t.forEach(e=>{let t=e.querySelector(`:scope .dcx-fan-name`)?.textContent.trim()||`Color`,r=e.querySelector(`:scope .dcx-fan-value`)?.textContent.trim()||``,i=e.style.getPropertyValue(`--panel-swatch`),a=e.style.getPropertyValue(`--panel-ink`),o=document.createElement(`li`);o.className=`dcx-cue-band-item`;let s=document.createElement(`div`);s.className=`dcx-cue-band`,s.style.setProperty(`--band-color`,i),s.style.setProperty(`--band-ink`,a);let c=document.createElement(`code`);c.className=`dcx-cue-band-value`,c.textContent=r,s.appendChild(c);let l=document.createElement(`span`);l.className=`dcx-cue-band-label`,l.textContent=t,o.append(s,l),n.appendChild(o)}),e.querySelectorAll(`:scope > .dcx-cue-role`).forEach(e=>e.remove()),e.appendChild(n),r.remove()}}let s=e.querySelector(`:scope > header > .dcx-lede`);s&&(s.textContent=`Committed palette and per-surface strategy.`),e.dataset.dcxColorCompacted=`true`},l=e=>{let t=e.querySelector(`:scope > .dcx-block[data-label="The page, as chosen"]`)?.querySelector(`:scope > .dcx-surfaces`);if(!t)return;let n=Array.isArray(window.dcxSurfaceDefs)?window.dcxSurfaceDefs:[];if(!n.length)return;let r=document.createElement(`dl`);r.className=`dcx-defs`,n.forEach(({label:e,description:t})=>{let n=document.createElement(`div`);n.className=`dcx-def`;let i=document.createElement(`dt`);i.textContent=e;let a=document.createElement(`dd`);a.textContent=t,n.append(i,a),r.appendChild(n)}),t.replaceWith(r)},u=(n,c,l)=>{let u=n.dataset.label||`Section`,[d,f]=t[c]?.[u]||[`The decisions that define this part of the system.`],p=`${c}-${r(u)}`;n.querySelector(`:scope > .dcx-block-label`)?.remove();let m=document.createElement(`div`);for(m.className=`dcx-detail-section-body`;n.firstChild;)m.appendChild(n.firstChild);let h=document.createElement(`div`);h.className=`dcx-detail-section-heading`;let g=document.createElement(`h3`);if(g.className=`dcx-detail-section-title`,g.id=`dcx-${p}-title`,g.textContent=u,h.appendChild(g),d){let e=document.createElement(`p`);e.className=`dcx-detail-section-lede`,e.textContent=d,h.appendChild(e)}let _=document.createElement(`header`);if(_.className=`dcx-detail-section-head`,_.appendChild(h),f){_.classList.add(`dcx-detail-section-head--with-icon`);let t=document.createElement(`figure`);t.className=`dcx-detail-section-icon`,t.setAttribute(`aria-hidden`,`true`),t.setAttribute(`data-dcx-hide-on-error`,``);let r=document.createElement(`img`);r.src=e(f),r.alt=``,r.width=256,r.height=256,r.decoding=`async`,(n.closest(`.dcx-article`)?.dataset.dcxCategory||l>0)&&(r.loading=`lazy`),t.appendChild(r),_.appendChild(t)}n.classList.add(`dcx-detail-section`,`dcx-detail-section--${r(u)}`),n.id=`dcx-${p}`,n.closest(`.dcx-article`)?.dataset.dcxCategory||(n.setAttribute(`role`,`region`),n.setAttribute(`aria-labelledby`,g.id)),n.append(_,m),a(m),m.querySelector(`:scope > .dcx-list`)?.classList.add(`dcx-detail-list`),m.querySelector(`:scope > .dcx-defs`)?.classList.add(`dcx-detail-defs`),i(n,c),o(n,c),s(n)},d=(e,n)=>{if(e.dataset.dcxDetailEnhanced===n)return;n===`color`&&c(e),n===`typography`&&(e.querySelectorAll(`:scope .dcx-pair-why`).forEach(e=>e.remove()),e.querySelector(`:scope > .dcx-block[data-label="Interview direction"]`)?.remove()),n===`iconography`&&e.querySelector(`:scope > .dcx-block[data-label="The hand"]`)?.remove(),n===`material`&&(l(e),e.querySelectorAll(`:scope > .dcx-block[data-label] > .dcx-fan-note`).forEach(e=>e.remove())),e.classList.add(`dcx-detail-article`,`dcx-detail-article--${n}`),e.querySelector(`:scope > header`)?.classList.add(`dcx-detail-hero`);let r=0;e.querySelectorAll(`:scope > .dcx-block[data-label]`).forEach(e=>{let i=!!t[n]?.[e.dataset.label]?.[1];u(e,n,r),i&&(r+=1)}),e.dataset.dcxDetailEnhanced=n},f=()=>{n=0;let e=document.querySelector(`.dcx-expander`),r=e?.querySelectorAll(`.dcx-main > .dcx-article[data-dcx-category]`);if(r?.length){r.forEach(e=>{let n=e.dataset.dcxCategory;n!==`audience`&&t[n]&&d(e,n)});return}let i=e?.querySelector(`.dcx-nav-list > li.is-active[data-category]`),a=e?.querySelector(`.dcx-main > .dcx-article`),o=i?.dataset.category;!a||!o||o===`audience`||!t[o]||d(a,o)},p=()=>{n||=requestAnimationFrame(f)};new MutationObserver(p).observe(document.body,{childList:!0,subtree:!0}),window.addEventListener(`pageshow`,p),p()})(),(()=>{let t=(e,t,n)=>{let r=1-3*n+3*t,i=3*n-6*t,a=3*t;return((r*e+i)*e+a)*e},n=(e,t,n)=>{let r=1-3*n+3*t,i=3*n-6*t,a=3*t;return 3*r*e*e+2*i*e+a},r=e=>{let r=Math.max(0,Math.min(1,e)),i=r;for(let e=0;e<8;e+=1){let e=n(i,.4,.2);if(Math.abs(e)<1e-6)break;i-=(t(i,.4,.2)-r)/e,i=Math.max(0,Math.min(1,i))}return t(i,0,1)},i=0,a=null,o=0,s=(e,t={})=>{let n=document.createElementNS(`http://www.w3.org/2000/svg`,e);return Object.entries(t).forEach(([e,t])=>n.setAttribute(e,t)),n};class c{constructor(e){this.expander=e,this.nav=e.querySelector(`.dcx-nav`),this.main=e.querySelector(`.dcx-main`),this.desktop=window.matchMedia(`(min-width: 921px)`),this.reducedMotion=window.matchMedia(`(prefers-reduced-motion: reduce)`),this.instanceId=++i,this.currentArticle=null,this.currentCategory=``,this.currentSubnav=null,this.contentSignature=``,this.entries=[],this.segments=new Map,this.railLength=0,this.railReady=!1,this.pinnedNode=null,this.scrollFrame=0,this.rebuildFrame=0,this.rebuildTimers=[],this.categoryTransitionBeginFrame=0,this.categoryTransitionFrame=0,this.categoryTransitionHandoffFrame=0,this.categoryTransitionCleanupTimer=0,this.categoryTransitionGeneration=0,this.categoryTransitionActive=!1,this.categoryTransitionStart=0,this.categoryTransitionTarget=null,this.categoryTransitionFinalTarget=null,this.categoryTransitionNode=null,this.categoryTransitionBranchPoints=null,this.categoryTransitionBranchProgress=0,this.categoryTransitionRetractPoints=null,this.categoryTransitionRetractProgress=0,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=null,this.categoryTransitionRenderedProgress=0,this.currentPaintNode=null,!(!this.nav||!this.main)&&(this.handleScroll=this.handleScroll.bind(this),this.handleResize=this.handleResize.bind(this),this.handleMediaChange=this.handleMediaChange.bind(this),this.handleReducedMotionChange=this.handleReducedMotionChange.bind(this),this.handleRailClick=this.handleRailClick.bind(this),this.handleContinuousCategoryWillChange=this.handleContinuousCategoryWillChange.bind(this),this.handleContinuousCategoryChange=this.handleContinuousCategoryChange.bind(this),this.clearPinnedNode=this.clearPinnedNode.bind(this),this.handleKeydown=this.handleKeydown.bind(this),this.createRail(),this.nav.classList.add(`dcx-material-rail-host`),this.remeasureSubnavs(),this.main.addEventListener(`scroll`,this.handleScroll,{passive:!0}),this.main.addEventListener(`wheel`,this.clearPinnedNode,{passive:!0}),this.main.addEventListener(`touchstart`,this.clearPinnedNode,{passive:!0}),this.main.addEventListener(`pointerdown`,this.clearPinnedNode,{passive:!0}),this.nav.addEventListener(`click`,this.handleRailClick),this.expander.addEventListener(`dcx:continuouscategorywillchange`,this.handleContinuousCategoryWillChange),this.expander.addEventListener(`dcx:continuouscategorychange`,this.handleContinuousCategoryChange),window.addEventListener(`resize`,this.handleResize,{passive:!0}),window.addEventListener(`keydown`,this.handleKeydown),this.desktop.addEventListener(`change`,this.handleMediaChange),this.reducedMotion.addEventListener(`change`,this.handleReducedMotionChange),this.resizeObserver=new ResizeObserver(this.handleResize),this.resizeObserver.observe(this.nav),document.fonts?.ready.then(()=>{a===this&&(this.remeasureSubnavs(),this.scheduleRebuild(!0))}))}createRail(){let t=`dcx-material-rail-patina-${this.instanceId}`,n=`dcx-material-rail-gold-${this.instanceId}`,r=s(`svg`,{class:`dcx-material-rail`,"aria-hidden":`true`,focusable:`false`}),i=s(`defs`),a=s(`pattern`,{id:t,width:`72`,height:`48`,patternUnits:`userSpaceOnUse`}),o=s(`pattern`,{id:n,width:`72`,height:`48`,patternUnits:`userSpaceOnUse`});a.append(s(`rect`,{class:`dcx-material-rail__patina-base`,width:`72`,height:`48`}),s(`image`,{class:`dcx-material-rail__patina-image`,href:e(`/assets/audience/verdigris-patina.png`),width:`72`,height:`48`,preserveAspectRatio:`xMidYMid slice`})),o.append(s(`rect`,{class:`dcx-material-rail__gold-base`,width:`72`,height:`48`}),s(`image`,{class:`dcx-material-rail__gold-image`,href:e(`/assets/audience/kinpaku-gold-leaf.png`),width:`72`,height:`48`,preserveAspectRatio:`xMidYMid slice`})),this.track=s(`path`,{class:`dcx-material-rail__track`,"data-dcx-rail-track":``}),this.active=s(`path`,{class:`dcx-material-rail__active`,"data-dcx-rail-active":``}),this.transitionTrack=s(`path`,{class:`dcx-material-rail__transition-track`}),this.transitionActive=s(`line`,{class:`dcx-material-rail__transition-active`}),this.track.style.stroke=`url("#${t}")`,this.active.style.stroke=`url("#${n}")`,this.transitionTrack.style.stroke=`url("#${t}")`,this.transitionActive.style.stroke=`url("#${n}")`,i.append(a,o),r.append(i,this.transitionTrack,this.track,this.active,this.transitionActive),this.svg=r,this.nav.prepend(r)}prepareAudienceSubnav(e,t){let n=[{label:`Overview`,targetLabels:[],overview:!0},{label:`People`,targetLabels:[`Who they are`,`Emotional journey`,`Emotional state`]},{label:`Decision factors`,targetLabels:[`Needs`,`Trust triggers`]},{label:`Inclusion`,targetLabels:[`Who must not be excluded`]}],r=new Map(t.map((e,t)=>[e.dataset.label,{block:e,index:t}])),i=n.map(e=>{if(e.overview)return e;let t=e.targetLabels.find(e=>r.has(e));return t?{...e,firstTarget:t}:null}).filter(Boolean),a=i.map(e=>e.label).join(`|`),o=[...e.querySelectorAll(`:scope > .dcx-sub-link[data-dcx-rail-summary]`)].map(e=>e.textContent.trim()).join(`|`);if(e.classList.add(`dcx-subnav--summary`),e.dataset.dcxRailSummary=`true`,o===a&&e.childElementCount===i.length)return;let s=i.map(e=>{let t=document.createElement(`button`);return t.className=`dcx-sub-link`,t.type=`button`,t.textContent=e.label,t.dataset.dcxRailSummary=``,t.dataset.dcxRailTarget=e.overview?`__overview__`:e.firstTarget,e.overview||(t.dataset.dcxSubsection=String(r.get(e.firstTarget).index)),t});e.replaceChildren(...s)}refresh(){let e=this.nav.querySelector(`.dcx-nav-list > li.is-active[data-category]`),t=e?.dataset.category||``,n=this.main.dataset.dcxContinuous===`true`,r=n?this.main.querySelector(`:scope > .dcx-article[data-dcx-category="${t}"]`):this.main.querySelector(`:scope > .dcx-article`);if(!e||!r){this.nav.removeAttribute(`data-rail-ready`);return}let i=e.querySelector(`:scope > .dcx-subnav`),o=[...r.querySelectorAll(`:scope > .dcx-block[data-label]`)];if(!i)return;n||this.nav.querySelectorAll(`.dcx-subnav`).forEach(e=>{(e!==i||t!==`audience`)&&(e.classList.remove(`dcx-subnav--summary`),delete e.dataset.dcxRailSummary)}),t===`audience`&&!n&&this.prepareAudienceSubnav(i,o);let s=`${t}::${[...i.querySelectorAll(`:scope > .dcx-sub-link`)].map(e=>e.textContent.trim()).join(`|`)}::${o.map(e=>e.dataset.label).join(`|`)}`,c=[...this.nav.querySelectorAll(`.dcx-nav-list > li > .dcx-nav-link`),...i.querySelectorAll(`:scope > .dcx-sub-link`)],l=c.length>0&&c.every(e=>e.hasAttribute(`data-dcx-rail-node`));if(this.currentArticle===r&&this.currentCategory===t&&this.currentSubnav===i&&this.contentSignature===s&&l)return;this.currentArticle=r,this.currentCategory=t,this.currentSubnav=i,this.contentSignature=s,this.pinnedNode=null,this.rebuildTimers.forEach(e=>window.clearTimeout(e)),this.rebuildTimers=[],this.nav.querySelectorAll(`[data-dcx-rail-node]`).forEach(e=>{e.removeAttribute(`data-dcx-rail-node`)}),this.nav.querySelectorAll(`.dcx-sub-link[aria-current="location"]`).forEach(e=>{e.removeAttribute(`aria-current`)});let u=[...this.nav.querySelectorAll(`.dcx-nav-list > li > .dcx-nav-link`)],d=[...i.querySelectorAll(`:scope > .dcx-sub-link`)];u.forEach(e=>e.setAttribute(`data-dcx-rail-node`,``)),d.forEach(e=>e.setAttribute(`data-dcx-rail-node`,``));let f=e.querySelector(`:scope > .dcx-nav-link`),p=e=>o[Number(e.dataset.dcxSubsection)],m=[];(n||t!==`audience`)&&f&&m.push({node:f,target:r.querySelector(`:scope > header`)||r}),d.forEach(e=>{let t=e.dataset.dcxRailTarget,n=e.dataset.dcxDocumentTarget,i=n?this.main.querySelector(`#${CSS.escape(n)}`):t===`__overview__`?r.querySelector(`:scope > header`)||r:t?o.find(e=>e.dataset.label===t):p(e);i&&m.push({node:e,target:i})}),this.entries=m,this.railReady=!1,this.rebuild(!0),this.categoryTransitionActive||[0,320,650].forEach(e=>{this.rebuildTimers.push(window.setTimeout(()=>{a===this&&this.currentArticle===r&&this.rebuild(!0)},e))})}measureRailPoints(){if(!this.desktop.matches||!this.nav.offsetHeight||!this.track||!this.active)return[];let e=this.nav.getBoundingClientRect(),t=[...this.nav.querySelectorAll(`[data-dcx-rail-node]`)].filter(e=>e.getClientRects().length>0);return t.length?t.map(t=>{let n=t.getBoundingClientRect();return{node:t,x:n.left-e.left+1,yTop:n.top-e.top,yBottom:n.bottom-e.top}}):[]}pathDataForProgress(e,t=1){if(!e.length)return``;let n=e[0].x,r=e=>n+(e-n)*t,i=``,a=null;return e.forEach((e,t)=>{let n=r(e.x);if(t===0)i=`M ${n} ${e.yTop} `;else if(Math.abs(e.x-a.x)<.5)i+=`L ${n} ${e.yTop} `;else{let t=r(a.x),o=(a.yBottom+e.yTop)/2;i+=`C ${t} ${o}, ${n} ${o}, ${n} ${e.yTop} `}i+=`L ${n} ${e.yBottom} `,a=e}),i}buildPath(){let e=this.measureRailPoints();if(!e.length)return!1;let t=``,n=null,r=new Map;return e.forEach((e,i)=>{if(i===0)t=`M ${e.x} ${e.yTop} `;else if(Math.abs(e.x-n.x)<.5)t+=`L ${e.x} ${e.yTop} `;else{let r=(n.yBottom+e.yTop)/2;t+=`C ${n.x} ${r}, ${e.x} ${r}, ${e.x} ${e.yTop} `}this.active.setAttribute(`d`,t);let a=this.active.getTotalLength();t+=`L ${e.x} ${e.yBottom} `,this.active.setAttribute(`d`,t);let o=this.active.getTotalLength();r.set(e.node,{start:a,length:Math.max(1,o-a)}),n=e}),this.track.setAttribute(`d`,t),this.active.setAttribute(`d`,t),this.segments=r,this.railLength=this.active.getTotalLength(),Number.isFinite(this.railLength)&&this.railLength>0}moveRail(e,t=!1){let n=this.segments.get(e);!n||!this.railLength||(this.currentPaintNode=e,(t||this.reducedMotion.matches)&&(this.active.setAttribute(`data-initial`,`true`),this.active.getBoundingClientRect()),this.active.style.strokeDasharray=`${n.length} ${this.railLength+1}`,this.active.style.strokeDashoffset=`${-n.start}`,requestAnimationFrame(()=>{a===this&&(this.active.setAttribute(`data-ready`,`true`),this.nav.setAttribute(`data-rail-ready`,`true`),requestAnimationFrame(()=>this.active.removeAttribute(`data-initial`)))}),this.railReady=!0)}updateCurrent(e=!1){if(!this.entries.length||!this.desktop.matches)return;let t=this.main.getBoundingClientRect().top+this.main.clientHeight*.25,n=this.entries.find(e=>e.node===this.pinnedNode)||this.entries.find(e=>e.node===this.categoryTransitionNode)||this.entries[0];!this.pinnedNode&&!this.categoryTransitionNode&&this.main.scrollTop>4&&(this.entries.forEach(e=>{e.target.getBoundingClientRect().top<=t&&(n=e)}),this.main.scrollTop+this.main.clientHeight>=this.main.scrollHeight-4&&(n=this.entries.at(-1))),this.nav.querySelectorAll(`.dcx-sub-link[aria-current="location"]`).forEach(e=>{e!==n.node&&e.removeAttribute(`aria-current`)}),n.node.matches(`.dcx-sub-link`)&&n.node.setAttribute(`aria-current`,`location`),this.moveRail(n.node,e||!this.railReady)}rebuild(e=!1){if(!this.desktop.matches){this.nav.removeAttribute(`data-rail-ready`),this.active.removeAttribute(`data-ready`);return}this.buildPath()&&this.updateCurrent(e)}scheduleRebuild(e=!1){this.rebuildFrame&&cancelAnimationFrame(this.rebuildFrame),this.rebuildFrame=requestAnimationFrame(()=>{this.rebuildFrame=0,this.rebuild(e)})}handleScroll(){this.scrollFrame||!this.desktop.matches||(this.scrollFrame=requestAnimationFrame(()=>{this.scrollFrame=0,this.main.dataset.dcxContinuous===`true`&&this.refresh(),this.updateCurrent()}))}nodeLine(e){if(!e?.getClientRects().length)return null;let t=this.nav.getBoundingClientRect(),n=e.getBoundingClientRect();return{x:n.left-t.left+1,yTop:n.top-t.top,yBottom:n.bottom-t.top}}scrollTargetNode(e,t){let n=this.main.querySelector(`:scope > .dcx-article[data-dcx-category="${CSS.escape(e)}"]`),r=this.nav.querySelector(`.dcx-nav-list > li[data-category="${CSS.escape(e)}"] > .dcx-subnav`);if(!n||!r)return t;let i=this.main.getBoundingClientRect().top+this.main.clientHeight*.25,a=null;if(n.querySelectorAll(`:scope > .dcx-block[data-label]`).forEach(e=>{e.getBoundingClientRect().top<=i&&(a=e)}),!a)return t;let o=[...r.querySelectorAll(`:scope > .dcx-sub-link[data-dcx-document-target]`)].find(e=>e.dataset.dcxDocumentTarget===a.id);if(o)return o;if(e!==`audience`)return t;let s=a.dataset.label,c=s===`Who they are`||s===`Emotional journey`||s===`Emotional state`?`People`:s===`Needs`||s===`Trust triggers`?`Decision factors`:s===`Who must not be excluded`?`Inclusion`:null;return c&&[...r.querySelectorAll(`:scope > .dcx-sub-link`)].find(e=>e.textContent.trim()===c)||t}remeasureSubnavs(){this.desktop.matches&&this.nav.querySelectorAll(`.dcx-nav-list > li[data-category] > .dcx-subnav`).forEach(e=>{let t=[...e.querySelectorAll(`:scope > .dcx-sub-link`)],n=t.map(e=>e.getBoundingClientRect().height);if(!n.some(e=>e>0))return;let r=e.classList.contains(`dcx-subnav--summary`),i=r?0:2,a=r?14:10,o=n.reduce((e,t)=>e+t,0)+Math.max(0,t.length-1)*i+a;e.style.setProperty(`--dcx-subnav-height`,`${Math.ceil(o)}px`)})}finalNodeLine(e,t){let n=[...this.nav.querySelectorAll(`.dcx-nav-list > li[data-category] > .dcx-nav-link`)],r=n.findIndex(t=>t.dataset.dcxNav===e),i=n[r];if(!t||!i||r<0||!n.length)return null;let a=this.nav.getBoundingClientRect(),o=n[0].getBoundingClientRect(),s=t.getBoundingClientRect(),c=o.top-a.top;for(let e=0;e<r;e+=1)c+=n[e].getBoundingClientRect().height;if(t===i)return{x:s.left-a.left+1,yTop:c,yBottom:c+s.height};let l=i.closest(`li[data-category]`)?.querySelector(`:scope > .dcx-subnav`),u=[...l?.querySelectorAll(`:scope > .dcx-sub-link`)||[]],d=u.indexOf(t);if(!l||d<0)return null;let f=l.classList.contains(`dcx-subnav--summary`),p=f?0:2,m=f?4:2;c+=i.getBoundingClientRect().height+m;for(let e=0;e<d;e+=1)c+=u[e].getBoundingClientRect().height+p;return{x:s.left-a.left+1,yTop:c,yBottom:c+s.height}}transitionLineGeometry(){if(!this.transitionActive.hasAttribute(`data-visible`))return null;let e=this.nav.getBoundingClientRect(),t=this.transitionActive.getBoundingClientRect();return t.height?{x:t.left-e.left+t.width/2,yTop:t.top-e.top,yBottom:t.bottom-e.top}:null}measureStraightTrack(){if(!this.desktop.matches)return!1;let e=[...this.nav.querySelectorAll(`.dcx-nav-list > li[data-category] > .dcx-nav-link`)].filter(e=>e.getClientRects().length>0);if(!e.length)return!1;let t=this.nav.getBoundingClientRect(),n=e[0].getBoundingClientRect(),r=e.at(-1).getBoundingClientRect();return{x:n.left-t.left+1,yTop:n.top-t.top,yBottom:r.bottom-t.top}}buildStraightTrack(){let e=this.measureStraightTrack();return e?(this.transitionTrack.setAttribute(`d`,`M ${e.x} ${e.yTop} L ${e.x} ${e.yBottom}`),!0):!1}fitPointsToStraightTrack(e,t){if(!e?.length||!t)return[];let n=e[0].yTop,r=e.at(-1).yBottom,i=Math.max(1,r-n),a=(t.yBottom-t.yTop)/i,o=e[0].x;return e.map(e=>({...e,x:t.x+e.x-o,yTop:t.yTop+(e.yTop-n)*a,yBottom:t.yTop+(e.yBottom-n)*a}))}moveTransitionActive(e){if(!e)return;let t=Math.max(1,Number(this.transitionActive.getAttribute(`y2`))-Number(this.transitionActive.getAttribute(`y1`))),n=Number(this.transitionActive.getAttribute(`x1`)),r=Number(this.transitionActive.getAttribute(`y1`)),i=Math.max(1,e.yBottom-e.yTop),a=e.x-n,o=e.yTop-r+(i-t)/2,s=i/t;this.transitionActive.style.transform=`translate(${a}px, ${o}px) scaleY(${s})`}clearCategoryTransitionVisuals(){window.clearTimeout(this.categoryTransitionCleanupTimer),this.categoryTransitionCleanupTimer=0,this.transitionTrack.removeAttribute(`data-visible`),this.transitionTrack.removeAttribute(`data-initial`),this.transitionTrack.removeAttribute(`data-settling`),this.transitionActive.removeAttribute(`data-visible`),this.transitionActive.removeAttribute(`data-initial`),this.transitionActive.removeAttribute(`data-settling`),this.transitionActive.removeAttribute(`data-handoff`),this.track.removeAttribute(`data-entering`),this.track.removeAttribute(`data-settling`),this.track.removeAttribute(`data-morphing`),this.active.removeAttribute(`data-entering`),this.active.removeAttribute(`data-handoff`),this.transitionActive.style.removeProperty(`transform`),this.nav.removeAttribute(`data-category-transition`)}cancelCategoryTransitionFrames(){this.categoryTransitionBeginFrame&&cancelAnimationFrame(this.categoryTransitionBeginFrame),this.categoryTransitionFrame&&cancelAnimationFrame(this.categoryTransitionFrame),this.categoryTransitionHandoffFrame&&cancelAnimationFrame(this.categoryTransitionHandoffFrame),this.categoryTransitionBeginFrame=0,this.categoryTransitionFrame=0,this.categoryTransitionHandoffFrame=0}cancelCategoryTransition(){this.categoryTransitionGeneration+=1,this.cancelCategoryTransitionFrames(),this.categoryTransitionActive=!1,this.categoryTransitionTarget=null,this.categoryTransitionFinalTarget=null,this.categoryTransitionNode=null,this.categoryTransitionBranchPoints=null,this.categoryTransitionBranchProgress=0,this.categoryTransitionRetractPoints=null,this.categoryTransitionRetractProgress=0,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=null,this.categoryTransitionRenderedProgress=0,this.clearCategoryTransitionVisuals(),this.transitionTrack.removeAttribute(`d`),this.transitionActive.removeAttribute(`x1`),this.transitionActive.removeAttribute(`x2`),this.transitionActive.removeAttribute(`y1`),this.transitionActive.removeAttribute(`y2`)}snapshotCategoryTransition(e){if(!this.desktop.matches||this.reducedMotion.matches||!this.railReady)return!1;let t=this.transitionLineGeometry()||this.nodeLine(this.currentPaintNode),n=this.nav.querySelector(`.dcx-nav-list > li[data-category="${CSS.escape(e.detail?.to||``)}"] > .dcx-nav-link`),r=e.detail?.source===`scroll`?this.scrollTargetNode(e.detail?.to,n):n,i=this.finalNodeLine(e.detail?.to,n),a=this.finalNodeLine(e.detail?.to,r);if(!t||!i||!a)return!1;let o=this.categoryTransitionBranchPoints?.length&&this.categoryTransitionBranchProgress>0?this.categoryTransitionBranchPoints:null,s=this.categoryTransitionRenderedPoints?.length&&this.categoryTransitionRenderedProgress>0?this.categoryTransitionRenderedPoints:null,c=(o||s)?.map(e=>({...e}))||null,l=o?this.categoryTransitionBranchProgress:s?this.categoryTransitionRenderedProgress:0;return this.categoryTransitionGeneration+=1,this.cancelCategoryTransitionFrames(),this.clearCategoryTransitionVisuals(),c?this.transitionTrack.setAttribute(`d`,this.pathDataForProgress(c,l)):this.buildStraightTrack(),this.transitionActive.setAttribute(`x1`,t.x),this.transitionActive.setAttribute(`x2`,t.x),this.transitionActive.setAttribute(`y1`,t.yTop),this.transitionActive.setAttribute(`y2`,t.yBottom),this.transitionActive.style.transform=`translate(0px, 0px) scaleY(1)`,this.transitionTrack.setAttribute(`data-visible`,`true`),this.transitionActive.setAttribute(`data-visible`,`true`),this.transitionTrack.setAttribute(`data-initial`,`true`),this.transitionActive.setAttribute(`data-initial`,`true`),this.track.setAttribute(`data-entering`,`true`),this.active.setAttribute(`data-entering`,`true`),this.nav.setAttribute(`data-category-transition`,`layout`),this.svg.getBoundingClientRect(),this.categoryTransitionTarget=i,this.categoryTransitionFinalTarget=a,this.categoryTransitionNode=r,this.categoryTransitionBranchPoints=null,this.categoryTransitionBranchProgress=0,this.categoryTransitionRetractPoints=c,this.categoryTransitionRetractProgress=l,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=c?.map(e=>({...e}))||null,this.categoryTransitionRenderedProgress=l,this.categoryTransitionActive=!0,!0}beginCategoryTransition(e){if(e!==this.categoryTransitionGeneration||!this.categoryTransitionActive||!this.categoryTransitionTarget||!this.categoryTransitionFinalTarget)return;this.transitionTrack.removeAttribute(`data-initial`),this.transitionActive.removeAttribute(`data-initial`),this.moveTransitionActive(this.categoryTransitionTarget);let t=performance.now();this.categoryTransitionStart=t,this.categoryTransitionRetractPoints&&(this.categoryTransitionRetractStart=t),this.categoryTransitionFrame=requestAnimationFrame(t=>{this.animateCategoryTransition(t,e)})}animateCategoryTransition(e,t){if(this.categoryTransitionFrame=0,!(t!==this.categoryTransitionGeneration||!this.categoryTransitionActive||a!==this)){if(this.categoryTransitionRetractPoints){let t=this.measureStraightTrack(),n=this.fitPointsToStraightTrack(this.categoryTransitionRetractPoints,t),i=Math.min(1,(e-this.categoryTransitionRetractStart)/140),a=this.categoryTransitionRetractProgress*(1-r(i));n.length&&(this.transitionTrack.setAttribute(`d`,this.pathDataForProgress(n,a)),this.categoryTransitionRenderedPoints=n.map(e=>({...e})),this.categoryTransitionRenderedProgress=a),(i>=1||!n.length)&&(this.categoryTransitionRetractPoints=null,this.categoryTransitionRetractProgress=0,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=null,this.categoryTransitionRenderedProgress=0,this.buildStraightTrack())}else this.buildStraightTrack();if(e-this.categoryTransitionStart<520){this.categoryTransitionFrame=requestAnimationFrame(e=>{this.animateCategoryTransition(e,t)});return}this.beginBranchTransition(t)}}beginBranchTransition(e){if(e!==this.categoryTransitionGeneration||!this.categoryTransitionActive||!this.categoryTransitionFinalTarget)return;this.categoryTransitionFrame&&cancelAnimationFrame(this.categoryTransitionFrame),this.categoryTransitionFrame=0,this.buildStraightTrack();let t=this.measureRailPoints();if(!t.length||!this.buildPath()){this.cancelCategoryTransition(),this.remeasureSubnavs(),this.scheduleRebuild(!0);return}this.updateCurrent(!1),this.categoryTransitionBranchPoints=t,this.categoryTransitionBranchProgress=0,this.categoryTransitionRetractPoints=null,this.categoryTransitionRetractProgress=0,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=t.map(e=>({...e})),this.categoryTransitionRenderedProgress=0,this.track.setAttribute(`d`,this.pathDataForProgress(t,0)),this.track.setAttribute(`data-morphing`,`true`),this.transitionTrack.setAttribute(`data-initial`,`true`),this.transitionActive.setAttribute(`data-settling`,`true`),this.nav.setAttribute(`data-category-transition`,`branch`),this.track.removeAttribute(`data-entering`),this.transitionTrack.removeAttribute(`data-visible`),this.svg.getBoundingClientRect(),this.moveTransitionActive(this.categoryTransitionFinalTarget),this.categoryTransitionStart=performance.now(),this.categoryTransitionFrame=requestAnimationFrame(t=>{this.animateBranchTransition(t,e)})}animateBranchTransition(e,t){if(this.categoryTransitionFrame=0,t!==this.categoryTransitionGeneration||!this.categoryTransitionActive||!this.categoryTransitionBranchPoints||a!==this)return;let n=Math.min(1,(e-this.categoryTransitionStart)/320),i=r(n);if(this.categoryTransitionBranchProgress=i,this.categoryTransitionRenderedPoints=this.categoryTransitionBranchPoints.map(e=>({...e})),this.categoryTransitionRenderedProgress=i,this.track.setAttribute(`d`,this.pathDataForProgress(this.categoryTransitionBranchPoints,i)),n<1){this.categoryTransitionFrame=requestAnimationFrame(e=>{this.animateBranchTransition(e,t)});return}this.completeBranchTransition(t)}completeBranchTransition(e){e!==this.categoryTransitionGeneration||!this.categoryTransitionActive||(this.categoryTransitionActive=!1,this.categoryTransitionTarget=null,this.categoryTransitionFinalTarget=null,this.categoryTransitionBranchPoints=null,this.categoryTransitionBranchProgress=0,this.categoryTransitionRetractPoints=null,this.categoryTransitionRetractProgress=0,this.categoryTransitionRetractStart=0,this.categoryTransitionRenderedPoints=null,this.categoryTransitionRenderedProgress=0,this.buildPath(),this.track.removeAttribute(`data-morphing`),this.updateCurrent(!1),this.active.setAttribute(`data-handoff`,`true`),this.transitionActive.setAttribute(`data-handoff`,`true`),this.svg.getBoundingClientRect(),this.active.removeAttribute(`data-entering`),this.transitionActive.removeAttribute(`data-visible`),this.categoryTransitionHandoffFrame=requestAnimationFrame(()=>{this.categoryTransitionHandoffFrame=0,e===this.categoryTransitionGeneration&&(this.active.removeAttribute(`data-handoff`),this.transitionActive.removeAttribute(`data-handoff`))}),this.nav.removeAttribute(`data-category-transition`),this.categoryTransitionCleanupTimer=window.setTimeout(()=>{e===this.categoryTransitionGeneration&&(this.categoryTransitionCleanupTimer=0,this.transitionTrack.removeAttribute(`d`),this.transitionTrack.removeAttribute(`data-initial`),this.transitionTrack.removeAttribute(`data-settling`),this.transitionActive.removeAttribute(`data-settling`),this.track.removeAttribute(`data-settling`),this.transitionActive.style.removeProperty(`transform`),this.transitionActive.removeAttribute(`x1`),this.transitionActive.removeAttribute(`x2`),this.transitionActive.removeAttribute(`y1`),this.transitionActive.removeAttribute(`y2`),this.categoryTransitionNode=null,this.updateCurrent(!1))},220))}handleContinuousCategoryWillChange(e){this.snapshotCategoryTransition(e)}handleContinuousCategoryChange(){if(this.refresh(),this.categoryTransitionActive){let e=this.categoryTransitionGeneration;this.categoryTransitionBeginFrame&&cancelAnimationFrame(this.categoryTransitionBeginFrame),this.categoryTransitionBeginFrame=requestAnimationFrame(()=>{this.categoryTransitionBeginFrame=0,this.beginCategoryTransition(e)})}else this.scheduleRebuild(!0)}handleResize(){this.categoryTransitionActive||(this.remeasureSubnavs(),this.scheduleRebuild(!0))}handleMediaChange(){this.cancelCategoryTransition(),this.remeasureSubnavs(),this.scheduleRebuild(!0)}handleReducedMotionChange(){this.cancelCategoryTransition(),this.remeasureSubnavs(),this.scheduleRebuild(!0)}handleRailClick(e){let t=e.target.closest(`.dcx-sub-link[data-dcx-rail-node]`);t&&this.nav.contains(t)&&(this.pinnedNode=t,this.updateCurrent());let n=e.target.closest(`.dcx-sub-link[data-dcx-rail-summary]`);if(!n||!this.nav.contains(n)||this.main.dataset.dcxContinuous===`true`)return;let r=n.dataset.dcxRailTarget,i=r===`__overview__`?this.currentArticle?.querySelector(`:scope > header`)||this.currentArticle:[...this.main.querySelectorAll(`.dcx-block[data-label]`)].find(e=>e.dataset.label===r);if(!i)return;e.preventDefault(),e.stopPropagation();let a=this.main.getBoundingClientRect(),o=r===`__overview__`?0:i.getBoundingClientRect().top-a.top+this.main.scrollTop-18;this.main.scrollTo({top:Math.max(0,o),behavior:this.reducedMotion.matches?`auto`:`smooth`})}clearPinnedNode(){this.pinnedNode&&=null}handleKeydown(e){[`ArrowDown`,`ArrowUp`,`PageDown`,`PageUp`,`Home`,`End`,` `].includes(e.key)&&this.clearPinnedNode()}destroy(){this.cancelCategoryTransition(),this.main?.removeEventListener(`scroll`,this.handleScroll),this.main?.removeEventListener(`wheel`,this.clearPinnedNode),this.main?.removeEventListener(`touchstart`,this.clearPinnedNode),this.main?.removeEventListener(`pointerdown`,this.clearPinnedNode),this.nav?.removeEventListener(`click`,this.handleRailClick),this.expander?.removeEventListener(`dcx:continuouscategorywillchange`,this.handleContinuousCategoryWillChange),this.expander?.removeEventListener(`dcx:continuouscategorychange`,this.handleContinuousCategoryChange),window.removeEventListener(`resize`,this.handleResize),window.removeEventListener(`keydown`,this.handleKeydown),this.desktop?.removeEventListener(`change`,this.handleMediaChange),this.reducedMotion?.removeEventListener(`change`,this.handleReducedMotionChange),this.resizeObserver?.disconnect(),this.rebuildTimers.forEach(e=>window.clearTimeout(e)),this.scrollFrame&&cancelAnimationFrame(this.scrollFrame),this.rebuildFrame&&cancelAnimationFrame(this.rebuildFrame),this.svg?.remove(),this.nav?.classList.remove(`dcx-material-rail-host`),this.nav?.removeAttribute(`data-rail-ready`)}}let l=()=>{o=0;let e=document.querySelector(`.dcx-expander`);if(!e){a?.destroy(),a=null;return}(!a||a.expander!==e)&&(a?.destroy(),a=new c(e)),a.refresh()},u=()=>{o||=requestAnimationFrame(l)};new MutationObserver(u).observe(document.body,{childList:!0,subtree:!0}),window.addEventListener(`pageshow`,u),u()})();var n=e=>Math.min(1,Math.max(0,e)),r=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,i=e=>e<=.0031308?12.92*e:1.055*e**(1/2.4)-.055,a=e=>e.match(/[\da-f]{2}/gi).map(e=>Number.parseInt(e,16)/255);function o([e,t,n]){let r=n*Math.PI/180,i=t*Math.cos(r),a=t*Math.sin(r),o=(e+.3963377774*i+.2158037573*a)**3,s=(e-.1055613458*i-.0638541728*a)**3,c=(e-.0894841775*i-1.291485548*a)**3;return[4.0767416621*o-3.3077115913*s+.2309699292*c,-1.2684380046*o+2.6097574011*s-.3413193965*c,-.0041960863*o-.7034186147*s+1.707614701*c]}function s([e,t,r]){let a=n(e),s=Math.max(0,t),c=o([a,s,r]);for(;s>0&&c.some(e=>e<0||e>1);)s=Math.max(0,s-.005),c=o([a,s,r]);return`#${c.map(e=>Math.round(n(i(e))*255).toString(16).padStart(2,`0`)).join(``).toUpperCase()}`}function c(e){let[t,n,i]=a(e).map(r),o=Math.cbrt(.4122214708*t+.5363325363*n+.0514459929*i),s=Math.cbrt(.2119034982*t+.6806995451*n+.1073969566*i),c=Math.cbrt(.0883024619*t+.2817188376*n+.6299787005*i),l=.2104542553*o+.793617785*s-.0040720468*c,u=1.9779984951*o-2.428592205*s+.4505937099*c,d=.0259040371*o+.7827717662*s-.808675766*c,f=Math.hypot(u,d);return[l,f,f<1e-5?0:(Math.atan2(d,u)*180/Math.PI+360)%360]}function l(e){let[t,n,r]=c(e);return`oklch(${(t*100).toFixed(1)}% ${n.toFixed(3)} ${r.toFixed(1)})`}function u(e){let[t,n,r]=e.oklch;return{primary:s([t,n,r]),secondary:s([t<.5?t+.18:t-.18,n*.6,r]),tertiary:s([.62,Math.min(.23,Math.max(n,.15)),(r+60)%360]),neutral:s([t<.55?.96:.2,.01,r])}}var d=.0027,f=.9716;function p(e){let t=h(e),n=e=>g(e,t);return n(d)>=n(f)?`var(--pk-ink-dark)`:`var(--pk-ink-light)`}function m(e){return p(e).includes(`light`)?s([.99,.008,95]):s([.14,.018,95])}function h(e){let[t,n,i]=a(e).map(r);return .2126*t+.7152*n+.0722*i}function g(e,t){let[n,r]=e>t?[e,t]:[t,e];return(n+.05)/(r+.05)}function _(e,t,n=4.5){let r=h(t);if(g(h(e),r)>=n)return e;let[i,a,o]=c(e),l=g(d,r)>=g(f,r),u=l?-.015:.015;for(let e=i+u;e>.03&&e<1;e+=u){let t=s([e,a,o]);if(g(h(t),r)>=n)return t}return l?`#000000`:`#FFFFFF`}var v=7,y=3;function b({neutral:e,primary:t}){let n=h(e),r=Math.max(g(d,n),g(f,n)),i=[];return r<v&&i.push(`This background is too close to a middle gray, so text on it will be hard to read. Try a much lighter or much darker color.`),g(h(t),n)<y&&i.push(`Your main color and this background are too similar, so buttons and cards will blend in. Try more difference between them.`),i}var ee=null;function x(){return ee??=fetch(`/boot.json`).then(e=>e.ok?e.json():null).catch(()=>null).then(e=>({mode:e?.mode===`doc`?`doc`:`questionnaire`,prior:e?.prior&&typeof e.prior==`object`&&!Array.isArray(e.prior)?e.prior:null,priorSource:e?.priorSource||null,doc:e?.doc||null})),ee}var S,te=new Promise(e=>{S=e});function ne(e){document.body.dataset.hydrated=e||`none`,S(e||null)}var re=[`primary`,`secondary`,`tertiary`,`neutral`],C=[`color-strategy`,`motion-energy`,`layout-structure`,`boundary-style`,`corner-style`,`depth-style`,`type-scale`,`icon-pack`],w=e=>typeof e==`string`?e:``;function ie(e,t){if(!t)return!1;let n=document.querySelector(`input[name="${e}"][value="${CSS.escape(t)}"]`);return!n||n.disabled?!1:(n.click(),!0)}function ae(){return[...document.querySelectorAll(`input[type="hidden"][data-surface-field]`)]}function oe(e,t){if(e){se(e,t);for(let t of C)t in e&&ie(t,w(e[t]));ce(e),le(e,t),ue(e,t),de(e),fe(e,t)}}function se(e,t){let n=e[`surface-modes`],r=new Set(Array.isArray(n)?n:w(n)?[n]:[]);if(r.size&&t.modeInputs.some(e=>r.has(e.value))){for(let e of t.modeInputs)e.checked=r.has(e.value);t.syncModes()}}function ce(e){for(let t of ae()){let n=t.dataset.surfaceField;if(t.disabled||!(n in e))continue;let r=w(e[n]);r&&(t.value=r)}}function le(e,t){let n=w(e[`palette-source`]),r={};for(let t of re){let n=w(e[`palette-${t}`]);n&&(r[t]=n)}if(!n&&!Object.keys(r).length)return;let i=document.querySelector(`[name="palette-source"]`);i&&n&&(i.value=n);for(let e of re){let t=document.querySelector(`[name="palette-${e}"]`);t&&r[e]&&(t.value=r[e])}if(!t.cards.length)return;let a=t.cards.findIndex(e=>e.id===n),o=a===-1?0:a,s=t.states.get(t.cards[o]?.id);s?.colors&&Object.assign(s.colors,r),t.setCurrent(o),t.render(),t.syncDeckScroll()}function ue(e,t){let n=w(e[`font-pair`]),r=w(e[`font-heading`]),i=w(e[`font-body`]),a=t.fontManifest();if(n&&n!==`custom`&&a.pairs.some(({id:e})=>e===n)&&ie(`font-pair`,n)||!r||!i)return;let o={id:`custom`,name:`Custom`,heading:{family:r,weight:600,source:w(e[`font-heading-source`])},body:{family:i,weight:400,source:w(e[`font-body-source`])},why:`From your last run`};a.pairs=[o,...a.pairs.filter(({id:e})=>e!==`custom`)];for(let e of t.pairNodes())e.querySelector(`input`)?.value===`custom`&&t.removePairCard(e);t.addPairCard(o,{checked:!0,first:!0}),t.loadCustomFace(o),t.syncFontPair(o),t.applyHoist({force:!0})}function de(e){for(let t of[`icon-pack-name`,`icon-pack-license`,`icon-pack-url`]){let n=document.querySelector(`[name="${t}"]`),r=w(e[t]);n&&!n.value&&r&&(n.value=r)}}function fe(e,t){let n=null;try{let t=JSON.parse(w(e._chosen)||`null`);Array.isArray(t)&&(n=new Set(t))}catch{}for(let t of ae()){let r=t.dataset.surfaceField;t.disabled||((n?n.has(r):r in e)?t.dataset.chosen=`yes`:delete t.dataset.chosen)}t.syncChosenField()}var T=[`primary`,`secondary`,`tertiary`,`neutral`],pe=document.querySelector(`[data-screen="02"]`),E=(e,t=pe)=>t.querySelector(e),me=(e,t=pe)=>t.querySelectorAll(e),he=E(`[data-deck-scroll]`),ge=E(`[data-deck-points]`),_e=E(`[data-deck-cards]`),ve=E(`[data-deck-count]`),D=E(`.picker-palette-panel`),ye=E(`[data-palette-hint]`),be=E(`[data-ring-guide]`),xe=E(`[data-loupe]`),Se=E(`.picker-preview`),Ce=document.querySelector(`[data-type-stage]`),we=[...document.querySelectorAll(`[data-type-preview]`)],O=document.querySelector(`[data-font-options]`),Te=document.querySelector(`[data-pair-card]`),Ee=document.querySelector(`[data-scale-options]`),De=document.querySelector(`[data-scale-sheet]`),Oe=document.querySelector(`[data-scale-specimen]`),k=new Map,ke=new WeakMap,A=[],j=0,Ae,je,Me={sentence:`Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.`,paragraph:`Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.`,passages:[`Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur sint occaecat cupidatat.`,`Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione.`],note:`Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque.`,items:[`Excepteur sint occaecat`,`Non proident, sunt in culpa`],caption:`Lorem ipsum dolor sit amet, consectetur adipiscing.`},Ne={brand:`Lo`,nav:[`Lorem`,`Ipsum`,`Dolor`,`Amet`],navAction:`Consectetur`,menuAction:`Ipsum`,ctaPrimary:`Lorem ipsum`,ctaSecondary:`Dolor sit`,proof:[`Lorem ipsum dolor`,`Sit amet elit dolor`,`Sed do eiusmod`,`Tempor incididunt`],sectionTitle:`Lorem ipsum dolor`,sectionLink:`Consectetur adipiscing`,gallery:[{title:`Lorem ipsum dolor`,meta:`sit amet consectetur`},{title:`Dolor sit amet`,meta:`consectetur elit`},{title:`Eiusmod tempor`,meta:`sed do eiusmod`}],footerLinks:[`Lorem`,`Ipsum`,`Dolor`,`Amet`],footerMark:`© Lorem ipsum`},Pe={headline:`Lorem ipsum dolor sit amet`},M={rail:[`Lorem`,`Ipsum`,`Dolor`],columns:[`Lorem`,`Ipsum`,`Dolor`],figures:[`1,284`,`98.2%`,`41`],amounts:[`$12,400`,`$3,860`,`$9,215`],panel:[`Lorem ipsum`,`Dolor sit amet`],switches:[`Lorem ipsum`,`Dolor sit`],chartTitle:`Lorem ipsum dolor`,lanes:[`Lorem`,`Ipsum`,`Dolor`,`Amet`,`Elit`]},Fe={rail:[`Lorem ipsum`,`Dolor`,`Consectetur`,`Adipiscing elit`],crumb:`Lorem / Ipsum dolor`,note:`Nota`},Ie={stops:[`Lorem`,`Ipsum`,`Dolor`,`Amet`],caption:`Lorem ipsum dolor sit amet,
consectetur adipiscing elit sed do eiusmod tempor.`},Le=3,Re={version:1,specimen:{headline:`Built for the work at hand`},preview:{brand:`Ab`,nav:[`Product`,`Pricing`,`Docs`,`About`],navAction:`Sign in`,menuAction:`Menu`,ctaPrimary:`Get started`,ctaSecondary:`Learn more`,proof:[`Fast to set up`,`Works anywhere`,`No lock-in`,`Free to try`],sectionTitle:`Everything in one place`,sectionLink:`Read the guide`,gallery:[{title:`Overview`,meta:`Start here`},{title:`Library`,meta:`Browse all`},{title:`Reports`,meta:`See results`}],footerLinks:[`Product`,`Company`,`Support`,`Legal`],footerMark:`© Your product`},pairs:[{id:`source-editorial`,name:`Source editorial`,heading:{family:`Source Serif 4`,weight:600},body:{family:`Source Sans 3`,weight:400},why:`Considered and editorial`},{id:`literary-clarity`,name:`Literary clarity`,heading:{family:`Libre Baskerville`,weight:700},body:{family:`Libre Franklin`,weight:400},why:`Bookish and plain-spoken`},{id:`warm-structure`,name:`Warm structure`,heading:{family:`Bitter`,weight:600},body:{family:`Cabin`,weight:400},why:`Sturdy slab warmth`},{id:`bold-utility`,name:`Bold utility`,heading:{family:`Archivo Black`,weight:400},body:{family:`Archivo`,weight:400},why:`Headlines that shout`},{id:`technical-signal`,name:`Technical signal`,heading:{family:`Azeret Mono`,weight:600},body:{family:`Noto Sans`,weight:400},why:`Machined and precise`},{id:`classical-poise`,name:`Classical poise`,heading:{family:`Marcellus`,weight:400},body:{family:`Karla`,weight:400},why:`Inscriptional and formal`}]},ze=e=>Object.fromEntries(T.map(t=>[t,e(t)])),N=()=>A[j],P=()=>k.get(N().id),Be=()=>be.setAttribute(`aria-hidden`,`true`),Ve=/serif|mincho|baskerville|bitter|marcellus|slab|antiqua|garamond|didot|bodoni/i,He=e=>`"${e.replaceAll(`"`,`\\"`)}", ${Ve.test(e)?`serif`:`sans-serif`}`;function Ue(e){return{colors:e.type===`cue`?ze(t=>(e.palette[t].snapped||e.palette[t].hex).toUpperCase()):u(e),detached:ze(()=>!1),rings:ze(()=>[50,50])}}function We(e){let t=ke.get(e);return t||(t=document.createElement(`canvas`),t.width=e.naturalWidth,t.height=e.naturalHeight,t.getContext(`2d`,{willReadFrequently:!0}).drawImage(e,0,0),ke.set(e,t),t)}function Ge(e){if(e.type!==`cue`)return;let t=k.get(e.id);me(`.picker-ring`,e.node).forEach(e=>{let n=e.dataset.role,[r,i]=t.rings[n];e.style.setProperty(`--x`,`${r}%`),e.style.setProperty(`--y`,`${i}%`),e.style.setProperty(`--marker-color`,t.colors[n]),e.setAttribute(`aria-valuetext`,t.colors[n]),e.toggleAttribute(`data-detached`,t.detached[n])})}function Ke(e,t,n){let[r,i]=k.get(t.id).rings[e.dataset.role],a=We(n),o=E(`canvas`,xe).getContext(`2d`),s=r/100*(a.width-1),c=i/100*(a.height-1),l=Math.max(8,Math.min(a.width,a.height)/128);o.clearRect(0,0,80,80),o.imageSmoothingEnabled=!1,o.drawImage(a,s-l/2,c-l/2,l,l,0,0,80,80);let u=xe.parentElement.getBoundingClientRect(),d=e.getBoundingClientRect();xe.style.left=`${d.left-u.left+d.width/2}px`,xe.style.top=`${d.top-u.top}px`,xe.dataset.visible=``}function qe(e){let t=P().colors[e],n=E(`[data-band="${e}"]`,D);n.style.setProperty(`--band-color`,t),n.style.setProperty(`--band-ink`,p(t)),E(`output`,n).textContent=t,E(`input`,n).value=t,Je()}function Je(){if(A.length){for(let e of T)Se.style.setProperty(`--pv-${e}`,P().colors[e]);Se.style.setProperty(`--pv-n-ink`,p(P().colors.neutral)),Fn()}}function Ye(e,t=`pv`){let n=ze(e=>E(`[name="palette-${e}"]`).value);if(!e||Object.values(n).some(e=>!e))return;let r=(n,r)=>e.style.setProperty(`--${t}-${n}`,r);for(let e of T)r(e,n[e]);r(`n-ink`,p(n.neutral)),r(`p-ink`,p(n.primary)),r(`t-ink`,p(n.tertiary)),r(`p-on-n`,_(n.primary,n.neutral)),r(`t-on-n`,_(n.tertiary,n.neutral)),r(`t-on-p`,_(n.tertiary,n.primary)),r(`p-on-p`,_(n.primary,n.primary)),r(`t-on-t`,_(n.tertiary,n.tertiary)),r(`p-on-i`,_(n.primary,m(n.primary)))}function Xe(e){return!e||typeof e!=`object`?!1:[`brand`,`navAction`,`menuAction`,`ctaPrimary`,`ctaSecondary`,`sectionTitle`,`sectionLink`,`footerMark`].every(t=>e[t]===void 0||typeof e[t]==`string`)&&Object.entries({nav:4,proof:4,footerLinks:4}).every(([t,n])=>e[t]===void 0||Array.isArray(e[t])&&e[t].length===n&&e[t].every(e=>typeof e==`string`))&&(e.gallery===void 0||Array.isArray(e.gallery)&&e.gallery.length===Le&&e.gallery.every(e=>typeof e?.title==`string`&&typeof e?.meta==`string`))}function Ze(e){return{...e,preview:{...Re.preview,...e.preview}}}function Qe(e){return e?.version===1&&typeof e.specimen?.headline==`string`&&(!e.preview||Xe(e.preview))&&e.pairs?.length===6&&e.pairs.every(e=>typeof e.id==`string`&&typeof e.name==`string`&&typeof e.heading?.family==`string`&&Number.isFinite(e.heading?.weight)&&typeof e.body?.family==`string`&&Number.isFinite(e.body?.weight)&&typeof e.why==`string`&&(!e.preview||Xe(e.preview)))}function $e(e){let t=new Map,n=(e,n)=>{t.has(e)||t.set(e,new Set),t.get(e).add(n)};for(let t of e)n(t.heading.family,t.heading.weight),n(t.body.family,t.body.weight),n(t.body.family,700);let r=[...t].map(([e,t])=>`family=${encodeURIComponent(e).replaceAll(`%20`,`+`)}:wght@${[...t].sort((e,t)=>e-t).join(`;`)}`).join(`&`),i=document.createElement(`link`);i.rel=`stylesheet`,i.href=`https://fonts.googleapis.com/css2?${r}&display=swap`,i.dataset.pickerFonts=``,document.head.append(i)}function F(e,t,n){e&&e.querySelectorAll(t).forEach((e,t)=>{e.textContent=n[t]??``})}function et(e){let t=Ne,n=Pe,r=e.querySelector(`.ps-desktop`),i=e.querySelector(`.ps-phone-body`),a=e.dataset.surface===`read`?Fe.rail:M.rail,o=(t,n)=>{for(let r of e.querySelectorAll(t))r.textContent=n};o(`[data-type-brand]`,t.brand),o(`[data-type-nav-action]`,t.navAction),o(`[data-type-menu-action]`,t.menuAction),o(`[data-type-headline]`,n.headline),o(`[data-type-body]`,Me.sentence),o(`[data-type-cta-primary]`,t.ctaPrimary),o(`[data-type-cta-secondary]`,t.ctaSecondary),o(`[data-type-section-title]`,t.sectionTitle),o(`[data-type-section-body]`,`${Me.paragraph} Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`),o(`[data-type-section-link]`,t.sectionLink),o(`[data-type-footer-mark]`,t.footerMark),o(`[data-type-note-label]`,Fe.note),o(`[data-type-note-body]`,Me.note),o(`[data-type-crumb]`,Fe.crumb),o(`[data-type-caption]`,Ie.caption),o(`[data-type-chart-title]`,M.chartTitle);let s=(e,t)=>{e&&e.querySelectorAll(`.ps-gallery-item [data-type-gallery-caption]`).forEach((e,n)=>{let r=t[n];r&&(e.textContent=`${r.title} ${r.meta}`)})};for(let e of[r,i])F(e,`[data-type-nav]`,t.nav),F(e,`[data-type-proof]`,t.proof),F(e,`[data-type-gallery-title]`,t.gallery.map(({title:e})=>e)),F(e,`[data-type-gallery-meta]`,t.gallery.map(({meta:e})=>e)),F(e,`[data-type-passage]`,Me.passages),F(e,`[data-type-item]`,Me.items),F(e,`[data-type-stop]`,Ie.stops),F(e,`[data-type-rail]`,a),F(e,`[data-type-lane]`,M.lanes),F(e,`[data-type-column]`,M.columns),F(e,`[data-type-figure]`,M.figures),F(e,`[data-type-amount]`,M.amounts),F(e,`[data-type-panel]`,M.panel),F(e,`[data-type-switch]`,M.switches),s(e,t.gallery);F(r?.querySelector(`.ps-footer`),`[data-type-footer-link]`,t.footerLinks),tt(e)}function tt(e){let t=e.dataset.surface;if(t===`persuade`){e.querySelectorAll(`.ps-editorial-copy > em[data-type-section-link]`).forEach(e=>e.remove());let t=`Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`;e.querySelectorAll(`[data-type-section-body]`).forEach(e=>{if(e.hasAttribute(`data-type-section-body-2`)){e.remove();return}let n=e.nextElementSibling;if(n?.hasAttribute(`data-type-section-body-2`)){e.textContent=t,n.remove();return}e.textContent=t});let n=[`Lorem ipsum dolor sit amet consectetur`,`Dolor sit amet consectetur elit`,`Eiusmod tempor sed do eiusmod`];e.querySelectorAll(`.ps-gallery-item`).forEach((e,t)=>{let r=n[t];if(!r)return;let i=e.querySelector(`[data-type-gallery-caption]`);if(i){i.textContent=r;return}let a=e.querySelector(`[data-type-gallery-title]`),o=e.querySelector(`[data-type-gallery-meta]`);a&&(a.removeAttribute(`data-type-gallery-title`),a.setAttribute(`data-type-gallery-caption`,``),a.textContent=r,o?.remove())})}t===`read`&&e.querySelectorAll(`[data-type-section-title]`).forEach(e=>{e.textContent.trim()===`Lorem ipsum dolor sit`&&(e.textContent=`Lorem ipsum dolor`)}),t===`experience`&&(e.querySelectorAll(`[data-type-caption]`).forEach(e=>{e.textContent=`Lorem ipsum dolor sit amet,
consectetur adipiscing elit sed do eiusmod tempor.`}),e.querySelectorAll(`.ps-desktop .ps-index-cap`).forEach(e=>{if(e.querySelector(`.ps-index-avatar`))return;let t=document.createElement(`i`);t.className=`ps-index-avatar`,t.setAttribute(`aria-hidden`,`true`),e.insertBefore(t,e.firstChild)}))}function nt(e){for(let t of[Ce,De,Oe])t.style.setProperty(`--pt-heading`,He(e.heading.family)),t.style.setProperty(`--pt-body`,He(e.body.family)),t.style.setProperty(`--pt-heading-weight`,e.heading.weight);for(let e of we)et(e);document.querySelector(`[name="font-heading"]`).value=e.heading.family,document.querySelector(`[name="font-body"]`).value=e.body.family,document.querySelector(`[name="font-heading-source"]`).value=e.heading.source||``,document.querySelector(`[name="font-body-source"]`).value=e.body.source||``}var rt=[];function it(e,{checked:t=!1,first:n=!1}={}){let r=Te.content.firstElementChild.cloneNode(!0),i=r.querySelector(`input`);return i.value=e.id,i.checked=t,i.setAttribute(`aria-label`,`${e.heading.family} for headings with ${e.body.family} for body text. ${e.why}`),r.style.setProperty(`--pair-heading`,He(e.heading.family)),r.style.setProperty(`--pair-body`,He(e.body.family)),r.style.setProperty(`--pair-heading-weight`,e.heading.weight),r.style.setProperty(`--pair-body-weight`,e.body.weight),r.querySelector(`[data-pair-heading]`).textContent=e.heading.family,r.querySelector(`[data-pair-body]`).textContent=e.body.family,r.querySelector(`[data-pair-why]`).textContent=e.why,n?rt.unshift(r):rt.push(r),O.append(r),r}function at(e){let t=rt.indexOf(e);t!==-1&&rt.splice(t,1),e.remove()}function ot(e,t){je=Ze(e),O.toggleAttribute(`data-fallback`,t),e.pairs.forEach((e,t)=>it(e,{checked:t===0})),$e(e.pairs),nt(e.pairs[0]),zr(),vt()}O.onchange=({target:e})=>{if(!e.matches(`input[name="font-pair"]`))return;let t=je.pairs.find(({id:t})=>t===e.value);t&&nt(t),yt()};function st(e){let t=[...e.closest(`.picker-type-rail, .picker-scale-column`).querySelectorAll(`[data-list-scroll]`)],n=()=>{let n=e.scrollHeight-e.clientHeight;for(let r of t){let t=r.dataset.listScroll===`1`?e.scrollTop>=n-1:e.scrollTop<=1;r.disabled=n<2||t}};for(let n of t)n.onclick=()=>{let t=e.querySelector(`.picker-strategy-option`)?.offsetHeight||Math.round(e.clientHeight*.82);e.scrollBy({top:t*Number(n.dataset.listScroll),behavior:`smooth`})};return e.addEventListener(`scroll`,n,{passive:!0}),new ResizeObserver(n).observe(e),n}var ct=st(O);st(Ee);function lt(e,t){let n;return()=>{cancelAnimationFrame(n),n=requestAnimationFrame(()=>{e.matches(`:hover`)||t(e.contains(document.activeElement)?document.activeElement:null)})}}var ut=O.closest(`.picker-type-rail`),dt=new Set([`ArrowUp`,`ArrowDown`,`ArrowLeft`,`ArrowRight`,`Home`,`End`,` `]),ft=!1,pt=!1,mt=!1,ht,gt=()=>pt||ut.matches(`:hover`)||mt&&ut.contains(document.activeElement);function _t(e){clearTimeout(ht);for(let e of rt)e.removeAttribute(`data-hoisted`);e.offsetWidth,e.dataset.hoisted=``,ht=setTimeout(()=>e.removeAttribute(`data-hoisted`),700)}function vt({force:e=!1}={}){ft=!1;let t=O.querySelector(`input[name="font-pair"]:checked`)?.closest(`.picker-type-option`);if(!t)return;let n=[t,...rt.filter(e=>e!==t)],r=[...O.querySelectorAll(`.picker-type-option`)],i=n.some((e,t)=>e!==r[t]);if(i){let e=document.activeElement;for(let e of n)O.append(e);O.contains(e)&&document.activeElement!==e&&e.focus({preventScroll:!0})}!i&&!e||(O.scrollTo({top:0}),ct(),i&&_t(t))}function yt(){ft=!1}function bt(){ft&&!gt()&&vt()}ut.addEventListener(`pointerenter`,()=>{pt=!0}),ut.addEventListener(`pointerleave`,()=>{pt=!1,requestAnimationFrame(bt)}),ut.addEventListener(`pointerdown`,()=>{mt=!1}),ut.addEventListener(`keydown`,({key:e})=>{dt.has(e)&&(mt=!0)}),ut.addEventListener(`focusout`,({relatedTarget:e})=>{ut.contains(e)||(mt=!1,bt())});var xt=16,St=13,Ct=.5,wt=[...De.querySelectorAll(`[data-scale-row]`)],Tt=document.querySelector(`[name="type-scale-ratio"]`),Et=()=>Ee.querySelector(`input[name="type-scale"]:checked`),Dt=e=>e?.closest(`.picker-strategy-option`)?.querySelector(`input`),Ot=e=>e.replace(/\.0+$/,``).replace(/(\.\d*[1-9])0+$/,`$1`);function kt(){if(De.style.setProperty(`--ts-fit`,`1`),!De.clientHeight)return;let e=1;for(let t of wt){let n=t.querySelector(`[data-scale-sample]`);e=Math.max(e,n.scrollWidth/Math.max(n.clientWidth,1),n.scrollHeight/Math.max(t.clientHeight,1))}e>1.001&&De.style.setProperty(`--ts-fit`,(1/e).toFixed(4))}function At(e){let t=Number(e.dataset.ratio),n=e.dataset.scaleName;for(let e of wt){let r=Number(e.dataset.scaleRow),i=xt*t**r,a=(St*t**(r*Ct)).toFixed(3);e.style.setProperty(`--ts-size`,a),Oe.style.setProperty(`--ts-step-${r}`,a),e.querySelector(`[data-scale-sample]`).textContent=n,e.querySelector(`[data-scale-px]`).textContent=`${Math.round(i)}px`,e.querySelector(`[data-scale-rem]`).textContent=`${Ot((i/xt).toFixed(2))}rem`}kt()}function jt(e){At(e),Tt.value=Number(e.dataset.ratio).toFixed(3)}Ee.addEventListener(`pointerover`,e=>{let t=Dt(e.target);t&&At(t)}),Ee.addEventListener(`focusin`,e=>{let t=Dt(e.target);t&&At(t)});var Mt=lt(Ee,e=>{At(Dt(e)??Et())});Ee.addEventListener(`pointerleave`,Mt),Ee.addEventListener(`focusout`,Mt),Ee.onchange=({target:e})=>{e.matches(`input[name="type-scale"]`)&&jt(e)};var Nt=st(Oe);new ResizeObserver(kt).observe(De),document.fonts?.addEventListener(`loadingdone`,kt),jt(Et());var Pt=document.querySelector(`[data-icon-options]`),Ft=document.querySelector(`[data-icon-sheet]`),It=Ft.querySelector(`[data-icon-field]`),Lt=Ft.querySelector(`[data-icon-strip]`),Rt=[`name`,`license`,`url`].map(e=>[e,document.querySelector(`[name="icon-pack-${e}"]`)]),zt,Bt,Vt;st(Pt);var Ht=()=>Pt.querySelector(`input[name="icon-pack"]:checked`),Ut=e=>e?.closest(`.picker-icon-row`)?.querySelector(`input`);function Wt(e,t){let n=Object.entries(e.attrs).map(([e,t])=>`${e}="${t}"`).join(` `);return`<svg viewBox="${e.viewBox}" ${n} aria-hidden="true">${t.body}</svg>`}function Gt(e){let t=zt?.get(e);!t||Vt===e||(Vt=e,delete It.dataset.empty,It.innerHTML=t.glyphs.map(e=>`<span class="picker-icon-cell">${Wt(t,e)}</span>`).join(``),Lt.innerHTML=t.glyphs.map(e=>Wt(t,e)).join(``))}function Kt(e){for(let[t,n]of Rt)n.value=e.dataset[`pack${t[0].toUpperCase()}${t.slice(1)}`];Gt(e.value)}function qt(){return Bt??=fetch(`/icon-packs.json`).then(e=>e.ok?e.json():Promise.reject()).then(e=>{zt=new Map(e.packs.map(e=>[e.id,e])),Gt(Ht().value)}).catch(()=>{It.dataset.empty=``,It.textContent=`Icon sets could not be loaded.`}),Bt}Pt.addEventListener(`pointerover`,e=>{let t=Ut(e.target);t&&Gt(t.value)}),Pt.addEventListener(`focusin`,e=>{let t=Ut(e.target);t&&Gt(t.value)});var Jt=lt(Pt,e=>{Gt(Ut(e)?.value??Ht().value)});Pt.addEventListener(`pointerleave`,Jt),Pt.addEventListener(`focusout`,Jt),Pt.onchange=({target:e})=>{e.matches(`input[name="icon-pack"]`)&&Kt(e)},Kt(Ht());var Yt=document.querySelector(`[data-question="motion"] .picker-strategy-choices`),Xt=`<div class="ps-phone"><div class="ps-phone-top"><div class="ps-nav-lede"><div class="ps-brand-block"></div><i class="ps-brand-word"></i></div><div class="ps-nav-tail"><div class="ps-nav-action"></div><i class="ps-menu"></i></div></div><div class="ps-phone-body"><div class="ps-layout-grid" aria-hidden="true"></div><div class="ps-image"></div><div class="ps-headline"><i></i><i></i></div><div class="ps-copy"><i></i><i></i></div><div class="ps-actions"><i></i><i></i></div><div class="ps-proof"><div class="ps-proof-item"><i></i><span class="ps-proof-lines"><b></b><b></b></span></div><i class="ps-proof-divider" aria-hidden="true"></i><div class="ps-proof-item"><i></i><span class="ps-proof-lines"><b></b><b></b></span></div></div><div class="ps-editorial-copy"><strong></strong><span><i></i><i></i></span></div><div class="ps-gallery"><div class="ps-gallery-item"><i></i><span><b></b><b></b></span></div><div class="ps-gallery-item"><i></i><span><b></b><b></b></span></div></div></div><div class="ps-phone-footer"><i></i><i></i><i></i></div></div>`,Zt=`<span class="picker-preview picker-preview--gallery picker-preview-motion picker-preview-motion--index" aria-hidden="true" data-surface="experience" hidden><span class="pv-desktop"><span class="pv-nav"><span class="pv-logo"></span><span class="pv-nav-bars"><i></i><i></i><i></i></span><span class="pv-pill"></span></span><span class="pg-body"><span class="pg-row"><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:33.61%"></i><i></i><i style="--w:65.3%"></i></span></span><span class="pg-row pg-row--flip"><span class="pg-cap"><i class="pg-cap-title" style="--w:36.64%"></i><i></i><i style="--w:66.07%"></i></span><span class="pv-image"></span></span><span class="pg-rail"><i class="pg-arrow"></i><span class="pg-track"><i class="pg-track-on" style="--w: 20.31"></i><i style="--w: 9.14"></i><i style="--w: 8.98"></i><i style="--w: 12.44"></i></span><i class="pg-arrow pg-arrow--next"></i></span></span><i class="ps-cursor" data-cursor aria-hidden="true"></i></span><span class="pv-phone"><span class="pv-phone-top"><span class="pv-logo"></span><span class="pv-avatar"></span></span><span class="pg-phone-body"><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:30.18%"></i><i style="--w:79.68%"></i><i style="--w:55.6%"></i></span><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:30.18%"></i><i style="--w:79.68%"></i><i style="--w:55.6%"></i></span></span><span class="pv-tabbar"><i></i><i></i><i></i></span></span></span>`;function Qt(){for(let e of document.querySelectorAll(`.picker-preview-motion[data-motion-cell]`)){if(e.dataset.surface===`persuade`){let t=e.querySelector(`.ps-desktop`);if(!t)continue;e.classList.remove(`picker-artboard--solo`),e.classList.add(`picker-strategy-preview`,`picker-preview-layout`),e.setAttribute(`data-carry`,``),t.querySelector(`:scope > .ps-layout-grid`)||t.insertAdjacentHTML(`afterbegin`,`<div class="ps-layout-grid" aria-hidden="true"></div>`),e.querySelector(`:scope > .ps-phone`)||e.insertAdjacentHTML(`beforeend`,Xt),t.querySelector(`:scope > [data-layout-editorial-spacer]`)?.remove();continue}if(e.dataset.surface!==`experience`)continue;let t=document.createElement(`template`);t.innerHTML=Zt;let n=t.content.firstElementChild;if(n){for(let t of e.attributes)t.name!==`class`&&n.setAttribute(t.name,t.value);e.replaceWith(n)}}}Qt();var $t=[...document.querySelectorAll(`.picker-preview-motion`)],en=()=>Yt.querySelector(`input:checked`).value,tn;function nn(e){if(e!==tn){tn=e;for(let e of $t){for(let t of e.getAnimations({subtree:!0}))t.cancel(),t.play();e.__replayMotion?.()}}}var rn={"--mtr-nav1":`.ps-nav-bars i:nth-child(1), .pv-nav-bars i:nth-child(1)`,"--mtr-nav2":`.ps-nav-bars i:nth-child(2), .pv-nav-bars i:nth-child(2)`,"--mtr-cta1":`.ps-actions i:first-child`,"--mtr-cta2":`.ps-actions i:last-child`,"--mtr-card1":`.ps-gallery-item:nth-child(1) > i`,"--mxi-work1":`.ps-index-row:nth-of-type(1) > .ps-image, .pg-row:nth-of-type(1) > .pv-image`,"--mxi-work2":`.ps-index-row:nth-of-type(2) > .ps-image, .pg-row:nth-of-type(2) > .pv-image`,"--mxi-rail":`.ps-index-arrow--next, .pg-arrow--next`};function an(e=null){for(let t of e?[e]:$t){let e=t.querySelector(`.ps-desktop, .pv-desktop`);if(!e?.clientWidth)continue;let n=t=>{let n=t.offsetWidth/2,r=t.offsetHeight/2;for(let i=t;i&&i!==e;i=i.offsetParent)n+=i.offsetLeft,r+=i.offsetTop;return{x:n/e.clientWidth*100,y:r/e.clientHeight*100}};for(let[r,i]of Object.entries(rn)){let a=e.querySelector(i);if(!a)continue;let o=n(a);t.style.setProperty(r,`${o.x.toFixed(2)}cqw ${o.y.toFixed(2)}cqh`)}let r=e.querySelector(`.ps-nav-bars i:nth-child(1), .pv-nav-bars i:nth-child(1)`);r&&t.style.setProperty(`--mtr-entry`,`${n(r).x.toFixed(2)}cqw -8cqh`)}}for(let e of $t)new ResizeObserver(()=>an(e)).observe(e.querySelector(`.ps-desktop, .pv-desktop`));var on=e=>e?.closest(`.picker-strategy-option`)?.querySelector(`input`).value;Yt.addEventListener(`pointerover`,e=>{let t=on(e.target);t&&nn(t)}),Yt.addEventListener(`focusin`,e=>{let t=on(e.target);t&&nn(t)});var sn=lt(Yt,e=>{nn(on(e)??en())});Yt.addEventListener(`pointerleave`,sn),Yt.addEventListener(`focusout`,sn),Yt.addEventListener(`change`,({target:e})=>{e.matches(`input[name="motion-energy"]`)&&nn(e.value)});function cn(e){return{head:document.head,documentElement:document.documentElement,createElement:e=>document.createElement(e),getElementById:e=>document.getElementById(e),querySelector:t=>e.matches(t)?e:e.querySelector(t),querySelectorAll:t=>e.matches(t)?[e]:e.querySelectorAll(t)}}function ln(){let e=[];for(let t of document.querySelectorAll(`.picker-preview-motion[data-motion-cell]`)){let n=cn(t),r=window,i=t.dataset.motionCell;e.push({cell:i,board:t,installPerfectCursorLoop:()=>{if(!n?.head||t.hasAttribute(`data-premium-restrained-landing-perfect-loop`))return;t.setAttribute(`data-premium-restrained-landing-perfect-loop`,``);let e=n.createElement(`style`);e.id=`restrained-landing-perfect-loop`,e.textContent=`
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-cursor {
            animation: 3.8s ease-in-out infinite mtr-path-perfect-loop !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2),
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2)::before,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2)::after,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-actions i:last-child {
            animation: none !important;
          }

          /* Cursor movement matched to the Responsive cell: ease-in-out glide
             with ~0.4s hops between stops (the old timing was linear with a
             1.25s nav-to-CTA crawl inherited from the original 5-stop path). */
          @keyframes mtr-path-perfect-loop {
            0%, 22% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
            32.5%, 47.5% {
              translate: var(--mtr-cta1, 10.3cqw 48.4cqh);
            }
            58%, 85% {
              translate: var(--mtr-email, 17.8cqw 84.2cqh);
            }
            100% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
          }

          /* The captured hover states are synced to the old path percentages;
             re-declare them against the retimed dwells (last definition wins). */
          @keyframes mtr-nav-1 {
            0%, 21.99% { background-color: var(--pvs-cta); }
            22%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-1 {
            0%, 3.99% { opacity: 0; }
            4%, 18.99% { opacity: 1; }
            19%, 100% { opacity: 0; }
          }
          @keyframes mtr-cta-primary {
            0%, 32.49% { background-color: var(--pvs-cta); box-shadow: inset 0 0 0 0 var(--pvs-cta); }
            32.5%, 47.49% { background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1.5px var(--pvs-cta); }
            47.5%, 100% { background-color: var(--pvs-cta); box-shadow: inset 0 0 0 0 var(--pvs-cta); }
          }

          /* Hover color change on the email capture button while the cursor
             dwells on it, mirroring the captured instant-flip hover pattern. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em {
            animation:
              mt-in-4 var(--mt) var(--mt-ease) infinite,
              mtr-email-hover 3.8s linear infinite !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em::after {
            animation: mtr-email-hover-icon 3.8s linear infinite;
          }
          @keyframes mtr-email-hover {
            0%, 57.99% { background-color: var(--pvs-ghost); }
            58%, 84.99% { background-color: var(--pvs-cta); }
            85%, 100% { background-color: var(--pvs-ghost); }
          }
          @keyframes mtr-email-hover-icon {
            0%, 57.99% { background-color: var(--pvs-cta); }
            58%, 84.99% { background-color: var(--pvs-cta-text); }
            85%, 100% { background-color: var(--pvs-cta); }
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh) !important;
            }
            #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em::after {
              animation: none !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e)},installResponsiveLandingCorrections:()=>{if(!n?.head||t.hasAttribute(`data-premium-responsive-landing-corrections`))return;t.setAttribute(`data-premium-responsive-landing-corrections`,``);let e=n.createElement(`style`);e.id=`responsive-landing-corrections`,e.textContent=`
          /* Keep the Preview 33 layout continuously present. The shared motion
             entrance loops were restarting underneath the responsive interaction
             and briefly collapsing most of the desktop and phone content. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] :is(
            .ps-nav,
            .ps-hero-copy > *,
            .ps-hero > .ps-image,
            .ps-proof-item,
            .ps-editorial-copy > strong,
            .ps-editorial-copy > span,
            .ps-gallery,
            .ps-footer
          ) {
            animation: none !important;
            opacity: 1 !important;
            clip-path: none !important;
            translate: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor {
            animation: 4.2s ease-in-out infinite mtv-path-perfect-loop !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            top: 50% !important;
            bottom: auto !important;
            transform: translateY(-50%);
          }

          @keyframes mtv-path-perfect-loop {
            0%, 25% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
            34.52%, 50% {
              translate: var(--mtr-cta1, 10.3cqw 48.4cqh);
            }
            60.71%, 83.33% {
              translate: var(--mtr-email, 17.8cqw 84.2cqh);
            }
            100% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh) !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e)},installChoreographedPremium:()=>{if(!n?.head||t.hasAttribute(`data-premium-choreographed-landing-premium`))return;t.setAttribute(`data-premium-choreographed-landing-premium`,``);let e=n.createElement(`style`);e.id=`choreographed-landing-premium`,e.textContent=`
          /* Premium pass: the page is fully present for the whole loop; motion is
             carried by light, focus, and filters instead of staged reveals. All
             reveal keyframes are re-declared empty (last definition wins), which
             leaves their elements at their natural resting styles. */
          @keyframes mtc-curtain {}
          @keyframes mtc-nav {}
          @keyframes mtc-eyebrow {}
          @keyframes mtc-headline-1 {}
          @keyframes mtc-headline-2 {}
          @keyframes mtc-copy-1 {}
          @keyframes mtc-copy-2 {}
          @keyframes mtc-copy-3 {}
          @keyframes mtc-actions {}
          @keyframes mtc-dot {}
          @keyframes mtc-pdot {}
          @keyframes mtc-pline {}
          @keyframes mtc-pdiv {}
          @keyframes mtc-ed-title {}
          @keyframes mtc-ed-line-1 {}
          @keyframes mtc-ed-line-2 {}
          @keyframes mtc-ed-dash {}
          @keyframes mtc-g-img-1 {}
          @keyframes mtc-g-lab-1 {}
          @keyframes mtc-g-lab-2 {}
          @keyframes mtc-g-lab-3 {}
          @keyframes mtc-g-lab-4 {}
          @keyframes mtc-footer {}

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-desktop::after {
            animation: none !important;
            opacity: 0 !important;
          }

          /* The reveals ended on the visible state; with the reveal keyframes
             emptied, the elements' hidden base styles (clip-path insets,
             opacity 0, small translates) must be overridden to their resting
             visible state. Pseudo-elements are excluded so the hover/tint
             choreography keeps animating. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
            .ps-nav, .ps-nav-bars i,
            .ps-headline i, .ps-copy i,
            .ps-proof *, .ps-footer, .ps-footer *,
            .ps-gallery, .ps-gallery-item, .ps-gallery-item > i,
            .ps-gallery-item span, .ps-gallery-item span b,
            .ps-brand, .ps-brand i
          ) {
            opacity: 1 !important;
            clip-path: none !important;
            translate: none !important;
            scale: none !important;
          }

          /* The proof dots' reveal ended on the CTA color; without the reveal
             they must rest there. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-proof-item i {
            background-color: var(--pvs-cta);
          }

          /* Cursor route: a closed circuit that ends exactly where it starts.
             CTA (glow) -> gallery card (tint) -> email capture (submit story) ->
             hero (light pass) -> back to the CTA. */
          @keyframes mtc-path {
            0%, 14% { translate: var(--mtr-cta1, 12.9cqw 49.2cqh); }
            22%, 36% { translate: var(--mtr-card1, 43.5cqw 75.8cqh); }
            44%, 62% { translate: var(--mtr-email, 17.8cqw 84.2cqh); }
            70%, 84% { translate: 72.8cqw 34.9cqh; }
            100% { translate: var(--mtr-cta1, 12.9cqw 49.2cqh); }
          }

          /* Specular sweep over the hero image: an ambient opening pass, then a
             second pass while the cursor rests on the hero. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
            background-image: linear-gradient(115deg,
              transparent 42%,
              color-mix(in oklab, var(--pvs-ground) 30%, transparent) 50%,
              transparent 58%);
            background-size: 320% 100%;
            background-repeat: no-repeat;
            background-position: 115% 0;
            animation: 5.6s linear infinite mtc-hero-sheen;
          }
          @keyframes mtc-hero-sheen {
            0% { background-position: 115% 0; animation-timing-function: cubic-bezier(.45, 0, .25, 1); }
            14%, 67.99% { background-position: -15% 0; }
            68% { background-position: 115% 0; animation-timing-function: cubic-bezier(.45, 0, .25, 1); }
            84%, 100% { background-position: -15% 0; }
          }

          /* CTA glow bloom while the cursor dwells on the filled button. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-actions i:first-child {
            animation: 5.6s linear infinite mtc-cta-glow !important;
          }
          @keyframes mtc-cta-glow {
            0%, 0.8% { filter: drop-shadow(0 0 0 transparent) brightness(1); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            2.5%, 12.5% { filter: drop-shadow(0 4px 11px color-mix(in oklab, var(--pvs-cta) 72%, transparent)) brightness(1.14); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            17%, 100% { filter: drop-shadow(0 0 0 transparent) brightness(1); }
          }

          /* Card hover: the tint fades in cleanly (no wipe, no blur), slightly
             translucent so the artwork shades it. */
          @keyframes mtc-tint {
            0%, 21.5% { opacity: 0; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            24.5%, 34.5% { opacity: .92; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.5%, 100% { opacity: 0; clip-path: inset(0); }
          }
          @keyframes mtc-label {
            0%, 23% { background-color: var(--pvs-bars); width: 76%; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            26%, 34.5% { background-color: var(--pvs-cta); width: 84%; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.5%, 100% { background-color: var(--pvs-bars); width: 76%; }
          }
          @keyframes mtc-chev {
            0%, 24% { opacity: 0; translate: -6px; }
            26.5% { opacity: 1; translate: -6px; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            30%, 34.5% { opacity: 1; translate: 0; }
            38%, 100% { opacity: 0; translate: 0; }
          }

          /* Hero lift while the cursor and the light pass rest on it (no blur). */
          @keyframes mtc-image {
            0%, 70% { filter: saturate(1) brightness(1); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            74%, 84% { filter: saturate(1.1) brightness(1.03); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            90%, 100% { filter: saturate(1) brightness(1); }
          }
          @keyframes mtc-g-img-2 {}
          @keyframes mtc-g-img-3 {}
          @keyframes mtc-g-img-4 {}

          /* Email capture submit story, timed to the cursor's 44-62% dwell:
             press, click ring, the paper plane pulls back and launches on an
             arc with a sharp two-ghost trail, the button fills while a sonar
             ring radiates, the field line clears, the check pops with an
             overshoot, then everything settles back before the loop wraps. */
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em {
            transform-origin: 50% 50% !important;
            animation: mtc-email-btn 5.6s linear infinite !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::after {
            animation: mtc-email-flight 5.6s linear infinite !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before {
            animation: mtc-email-check 5.6s linear infinite !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > span i:last-child {
            transform-origin: 0 50%;
            animation: mtc-email-line 5.6s linear infinite !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor::after {
            animation: mtc-email-click 5.6s linear infinite !important;
          }
          @keyframes mtc-email-btn {
            0%, 44.6% { scale: 1; background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 0 transparent; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            45.6% { scale: .93; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            47.4% { scale: 1; background-color: var(--pvs-ghost); }
            48.2% { box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 0 color-mix(in oklab, var(--pvs-cta) 50%, transparent); }
            50.5% { background-color: var(--pvs-cta); }
            56% { box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 12px transparent; }
            76% { background-color: var(--pvs-cta); }
            82%, 100% { scale: 1; background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 12px transparent; }
          }
          @keyframes mtc-email-flight {
            0%, 46% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); background-color: var(--pvs-cta); filter: drop-shadow(0 0 0 transparent) drop-shadow(0 0 0 transparent); }
            47.2% { transform: translate(-64%, -34%) rotate(9deg); background-color: var(--pvs-cta); animation-timing-function: cubic-bezier(.5, 0, .8, .4); }
            49.4% { opacity: 1; transform: translate(calc(-50% + 30px), calc(-50% - 12px)) rotate(-16deg); background-color: var(--pvs-cta-text); filter: drop-shadow(-6px 3px 0 color-mix(in oklab, var(--pvs-cta-text) 45%, transparent)) drop-shadow(-12px 6px 0 color-mix(in oklab, var(--pvs-cta-text) 18%, transparent)); animation-timing-function: cubic-bezier(.2, .6, .4, 1); }
            52.5% { opacity: 0; transform: translate(calc(-50% + 78px), calc(-50% - 16px)) rotate(-4deg); background-color: var(--pvs-cta-text); filter: drop-shadow(-6px 3px 0 transparent) drop-shadow(-12px 6px 0 transparent); }
            52.6%, 80% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg); background-color: var(--pvs-cta); filter: drop-shadow(0 0 0 transparent) drop-shadow(0 0 0 transparent); }
            85%, 100% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); }
          }
          @keyframes mtc-email-check {
            0%, 50.5% { opacity: 0; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(.5); animation-timing-function: cubic-bezier(.34, 1.56, .64, 1); }
            55% { opacity: 1; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(1.12); }
            57.5%, 74% { opacity: 1; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(1); }
            80%, 100% { opacity: 0; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(.5); }
          }
          @keyframes mtc-email-line {
            0%, 48.5% { scale: 1 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            53%, 78% { scale: 0 1; }
            84%, 100% { scale: 1 1; }
          }
          @keyframes mtc-email-click {
            0%, 44.4% { opacity: 0; scale: .35; }
            44.9% { opacity: .55; scale: .35; }
            47.6%, 100% { opacity: 0; scale: 1.5; }
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-cta1, 12.9cqw 49.2cqh) !important;
            }
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
              .ps-hero > .ps-image,
              .ps-actions i:first-child,
              .ps-gallery-item > i,
              .ps-gallery-item:first-child span b:first-child,
              .ps-editorial-copy > em,
              .ps-editorial-copy > span i:last-child
            ),
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-gallery-item:first-child > i::before,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-gallery-item:first-child > i::after,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::after,
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor::after {
              animation: none !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e);let i=n.createElement(`style`);i.id=`choreographed-hero-stagger-only`,i.textContent=`
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"],
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] *,
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] *::before,
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] *::after {
            animation: none !important;
            transition: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-desktop::after {
            opacity: 0 !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor {
            opacity: 0 !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before {
            content: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before {
            opacity: 0 !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
            .ps-eyebrow,
            .ps-headline,
            .ps-copy,
            .ps-actions,
            .ps-proof
          ) {
            opacity: 1;
            filter: none;
            transform: none;
            clip-path: none !important;
            translate: none !important;
            scale: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-viewport {
            z-index: 1;
            min-width: 0;
            min-height: 0;
            height: 90.6%;
            overflow: hidden;
            position: absolute;
            inset: 9.4% 0 auto;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-nav {
            z-index: 3;
            position: relative;
            background-color: var(--pvs-ground);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-track {
            display: grid;
            grid-template-rows: repeat(2, minmax(0, 1fr));
            width: 100%;
            height: 200%;
            min-height: 0;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-page {
            display: grid;
            grid-template-rows: 50.6fr 9fr 22.7fr 8.3fr;
            min-width: 0;
            min-height: 0;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-page > .ps-proof {
            margin-inline: var(--pvs-proof-inset, 0px);
            border: var(--pvs-panel-edge-w) solid var(--pvs-panel-edge);
            border-radius: var(--pvs-radius-surface);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-page {
            --ps-pricing-accent-muted: #607272;
            --ps-pricing-accent-dark: #0b3f3f;
            box-sizing: border-box;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            align-items: center;
            gap: 4%;
            min-width: 0;
            min-height: 0;
            padding: 0 7.9%;
            background-color: var(--pvs-ground);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card {
            --ps-pricing-accent: var(--ps-pricing-accent-dark);
            box-sizing: border-box;
            display: grid;
            grid-template-rows: auto auto 1px minmax(0, 1fr) auto;
            gap: 4cqh;
            align-self: center;
            width: 100%;
            height: 50.8cqh;
            min-width: 0;
            min-height: 0;
            padding: 5cqh 1.3cqw 2.4cqh;
            overflow: hidden;
            background-color: var(--pvs-ground);
            border: 1px solid var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-surface);
            translate: 0 -3cqh;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card:nth-child(1) {
            --ps-pricing-accent: var(--ps-pricing-accent-muted);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card:nth-child(n + 2) {
            border-width: 2px;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-tier,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > *,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-action {
            display: block;
            border-radius: var(--pvs-radius-bar);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-tier {
            justify-self: center;
            width: 32%;
            height: 2cqh;
            background-color: var(--ps-pricing-accent);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price {
            display: grid;
            justify-items: center;
            gap: 2.6cqh;
            min-width: 0;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > b {
            width: 54%;
            height: 4.9cqh;
            background-color: var(--ps-pricing-accent);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > i {
            width: 33%;
            height: .9cqh;
            background-color: var(--pvs-bars);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-divider {
            display: block;
            justify-self: center;
            width: 90%;
            height: 1px;
            background-color: var(--pvs-bars);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features {
            display: grid;
            align-content: center;
            gap: 2.5cqh;
            min-height: 0;
            padding-inline: 1.5cqw;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i {
            display: flex;
            align-items: center;
            gap: 1.2cqw;
            width: 100%;
            height: auto;
            background-color: transparent;
            border-radius: 0;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i::before {
            content: "";
            flex: none;
            width: 2cqh;
            height: 2cqh;
            background-color: var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-dot);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i::after {
            content: "";
            width: var(--pricing-feature-width, 70%);
            height: .9cqh;
            background-color: var(--pvs-bars);
            border-radius: var(--pvs-radius-bar);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i:nth-child(2) {
            --pricing-feature-width: 70%;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i:nth-child(3) {
            --pricing-feature-width: 70%;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-action {
            width: 100%;
            height: 5.1cqh;
            background-color: var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-control);
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
              .ps-eyebrow,
              .ps-headline,
              .ps-copy,
              .ps-actions,
              .ps-proof
            ) {
              opacity: 1 !important;
              filter: none !important;
              transform: none !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-track {
              transform: translateY(-50%) !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-nav {
              opacity: 0 !important;
              filter: none !important;
              transform: none !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card {
              opacity: 1 !important;
              filter: none !important;
              clip-path: none !important;
              transform: none !important;
            }
          }
        `,n.getElementById(i.id)||n.head.appendChild(i);let a=n.querySelector(`.picker-preview-motion[data-surface="persuade"]`),o=a?.querySelector(`.ps-desktop`);if(o&&!o.querySelector(`:scope > .ps-choreo-viewport`)){let e=n.createElement(`div`),t=n.createElement(`div`),r=n.createElement(`div`),i=n.createElement(`div`);e.className=`ps-choreo-viewport`,t.className=`ps-choreo-track`,r.className=`ps-choreo-page`,i.className=`ps-pricing-page`,i.setAttribute(`aria-hidden`,`true`),i.innerHTML=Array.from({length:3},()=>`<div class="ps-pricing-card"><i class="ps-pricing-tier"></i><span class="ps-pricing-price"><b></b><i></i></span><i class="ps-pricing-divider"></i><span class="ps-pricing-features"><i></i><i></i><i></i></span><em class="ps-pricing-action"></em></div>`).join(``),[o.querySelector(`:scope > .ps-hero`),o.querySelector(`:scope > .ps-proof`),o.querySelector(`:scope > .ps-editorial`),o.querySelector(`:scope > .ps-footer`)].filter(Boolean).forEach(e=>r.appendChild(e)),t.append(r,i),e.appendChild(t),o.querySelector(`:scope > .ps-nav`)?.insertAdjacentElement(`afterend`,e)}let s=[[`.ps-desktop .ps-eyebrow`,`.ps-desktop .ps-headline`,`.ps-desktop .ps-copy`,`.ps-desktop .ps-actions`,`.ps-desktop .ps-proof`],[`.ps-phone-body > .ps-headline`,`.ps-phone-body > .ps-copy`,`.ps-phone-body > .ps-actions`,`.ps-phone-body > .ps-proof`]],c=()=>{let e=Math.sqrt(120),t=20/(2*Math.sqrt(120)),n=e*Math.sqrt(1-t**2);return Array.from({length:73},(r,i)=>{let a=i/72,o=1050*a/1e3,s=i===72?0:Math.exp(-t*e*o)*(Math.cos(n*o)+t*e/n*Math.sin(n*o)),c=Math.max(0,Math.min(1,1-s));return{offset:a,opacity:Number(c.toFixed(4)),filter:`blur(${(4*(1-c)).toFixed(3)}px)`,transform:`translateY(${(40*s).toFixed(3)}px)`}})},l=r.matchMedia(`(prefers-reduced-motion: reduce)`);if(a&&r.Element?.prototype.animate&&!l.matches){let e=[],n=c();for(let t of s)t.map(e=>a.querySelector(e)).filter(Boolean).forEach((t,r)=>{e.push(t.animate(n,{duration:1050,delay:r*100,easing:`linear`,fill:`both`}))});let i=7200,o=1750,u=5400,d=e=>e/i,f=a.querySelector(`.ps-choreo-track`);f&&e.push(f.animate([{offset:0,transform:`translateY(0)`},{offset:d(o),transform:`translateY(0)`,easing:`cubic-bezier(.65, 0, .35, 1)`},{offset:d(2850),transform:`translateY(-50%)`},{offset:d(u),transform:`translateY(-50%)`,easing:`cubic-bezier(.65, 0, .35, 1)`},{offset:d(6500),transform:`translateY(0)`},{offset:1,transform:`translateY(0)`}],{duration:i,easing:`linear`,fill:`both`}));let p=a.querySelector(`.ps-desktop > .ps-nav`);p&&e.push(p.animate([{offset:0,opacity:1,filter:`blur(0px)`,transform:`translateY(0px)`},{offset:d(o),opacity:1,filter:`blur(0px)`,transform:`translateY(0px)`,easing:`cubic-bezier(.4, 0, 1, 1)`},{offset:d(2200),opacity:0,filter:`blur(4px)`,transform:`translateY(-10px)`},{offset:d(u),opacity:0,filter:`blur(4px)`,transform:`translateY(-10px)`,easing:`cubic-bezier(.16, 1, .3, 1)`},{offset:d(5850),opacity:1,filter:`blur(0px)`,transform:`translateY(0px)`},{offset:1,opacity:1,filter:`blur(0px)`,transform:`translateY(0px)`}],{duration:i,easing:`linear`,fill:`both`}));let m={left:[{opacity:.12,filter:`blur(8px)`,clipPath:`inset(0 100% 0 0)`,transform:`translateX(-64px) scale(.985)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px) scale(1)`}],center:[{opacity:.12,filter:`blur(7px)`,clipPath:`inset(0 49%)`,transform:`scale(.96)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`scale(1)`}],right:[{opacity:.12,filter:`blur(8px)`,clipPath:`inset(0 0 0 100%)`,transform:`translateX(64px) scale(.985)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px) scale(1)`}]};for(let[t,n,r]of[[`.ps-pricing-card:nth-child(1)`,`left`,2140],[`.ps-pricing-card:nth-child(2)`,`center`,2280],[`.ps-pricing-card:nth-child(3)`,`right`,2420]]){let i=a.querySelector(t);i&&e.push(i.animate(m[n],{duration:720,delay:r,easing:`cubic-bezier(.16, 1, .3, 1)`,fill:`both`}))}let h=()=>{if(l.matches){e.forEach(e=>e.cancel());return}e.forEach(e=>{e.pause(),e.currentTime=0,e.play()})};t.__replayMotion=h,l.addEventListener(`change`,({matches:t})=>{t?e.forEach(e=>e.cancel()):h()}),r.addEventListener(`pagehide`,()=>{e.forEach(e=>e.cancel())})}let u=0,d=()=>{!e.isConnected||u>=3||(u+=1,e.textContent+=`
.imp-paint-nudge-`+u+` { --imp-nudge: `+u+`; }`,u<3&&r.setTimeout(d,700*u))};r.requestAnimationFrame(()=>r.requestAnimationFrame(d))},installEmailCapture:()=>{if(!n?.head||t.hasAttribute(`data-premium-landing-email-capture`))return;t.setAttribute(`data-premium-landing-email-capture`,``);let e=n.createElement(`style`);e.id=`landing-email-capture`,e.textContent=`
          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy {
            grid-template-columns: minmax(0, 1fr) !important;
            grid-template-rows: auto 20px 20px !important;
            align-items: center !important;
            column-gap: 0 !important;
            row-gap: 5px !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > strong {
            grid-column: 1 / -1;
            width: 58% !important;
            height: 7px !important;
            background-color: var(--pvs-bars) !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span {
            box-sizing: border-box;
            grid-column: 1;
            grid-row: 2;
            display: flex !important;
            align-items: center;
            gap: 5px !important;
            min-width: 0;
            height: 20px;
            padding: 0 7px;
            border-radius: var(--pvs-radius-control);
            box-shadow: inset 0 0 0 1px var(--pvs-bars);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span i:first-child {
            box-sizing: border-box;
            flex: 0 0 auto;
            width: 6px !important;
            height: 6px !important;
            border: 1px solid var(--pvs-bars);
            border-radius: 50%;
            background: transparent !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span i:last-child {
            flex: 0 1 56%;
            width: 56% !important;
            height: 3px !important;
            border-radius: var(--pvs-radius-bar);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em {
            box-sizing: border-box;
            grid-column: 1;
            grid-row: 3;
            position: relative;
            width: 100% !important;
            height: 20px !important;
            margin: 0 !important;
            border-radius: var(--pvs-radius-control);
            background-color: var(--pvs-ghost);
            box-shadow: inset 0 0 0 1px var(--pvs-cta);
            transform-origin: 50% 50%;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::after,
          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::before {
            content: "";
            box-sizing: border-box;
            position: absolute;
            top: 50%;
            left: 50%;
            pointer-events: none;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::after {
            width: 10px;
            height: 8px;
            background-color: var(--pvs-cta);
            clip-path: polygon(0 0, 100% 50%, 0 100%, 22% 59%, 68% 50%, 22% 41%);
            transform: translate(-50%, -50%);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::before {
            width: 5px;
            height: 8px;
            border-right: 1.5px solid var(--pvs-cta-text);
            border-bottom: 1.5px solid var(--pvs-cta-text);
            opacity: 0;
            transform: translate(-50%, -62%) rotate(45deg) scale(.7);
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child span b:first-child,
          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            animation: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            opacity: 0 !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em {
            animation:
              mt-in-4 var(--mt) var(--mt-ease) infinite,
              mtv-email-submit 4.2s linear infinite !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em::after {
            animation: mtv-email-send 4.2s linear infinite;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em::before {
            animation: mtv-email-check 4.2s linear infinite;
          }

          #picker-form .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor::after {
            animation: mtv-email-click 4.2s linear infinite !important;
          }

          /* The cursor path keyframes (mtr-/mtv-path-perfect-loop) are owned by
             the per-cell correction styles; do not redefine them here. */

          @keyframes mtv-email-submit {
            0%, 63% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: 1;
            }
            65% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: .9;
            }
            69%, 83.33% {
              background-color: var(--pvs-cta);
              box-shadow: var(--pvs-shadow-control);
              scale: 1;
            }
            88%, 100% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: 1;
            }
          }

          @keyframes mtv-email-send {
            0%, 63% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
            66%, 84% {
              opacity: 0;
              transform: translate(-18%, -50%) scale(.72);
            }
            88%, 100% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }

          @keyframes mtv-email-check {
            0%, 66% {
              opacity: 0;
              transform: translate(-50%, -62%) rotate(45deg) scale(.7);
            }
            69%, 83.33% {
              opacity: 1;
              transform: translate(-50%, -62%) rotate(45deg) scale(1);
            }
            88%, 100% {
              opacity: 0;
              transform: translate(-50%, -62%) rotate(45deg) scale(.7);
            }
          }

          @keyframes mtv-email-click {
            0%, 63.5% {
              opacity: 0;
              scale: .35;
            }
            64% {
              opacity: .55;
              scale: .35;
            }
            67%, 100% {
              opacity: 0;
              scale: 1.5;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em,
            #picker-form .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em::before,
            #picker-form .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em::after {
              animation: none !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e);let i=()=>n.querySelector(`.picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em`),a=()=>{let e=i(),t=e?.closest(`.picker-preview-motion`),n=e?.closest(`.ps-desktop`),a=t?.querySelector(`.ps-cursor`);if(!t||!n||!e||!a)return;let o=n.getBoundingClientRect(),s=e.getBoundingClientRect();if(!n.clientWidth||!n.clientHeight)return;let c=r.getComputedStyle(n),l=r.getComputedStyle(e,`::after`),u=r.getComputedStyle(a),d=parseFloat(c.borderLeftWidth)||0,f=parseFloat(c.borderTopWidth)||0,p=(e,t)=>{let n=parseFloat(e);return Number.isFinite(n)?e.trim().endsWith(`%`)?n/100*t:n:t/2},m=p(l.left,s.width),h=p(l.top,s.height),g=parseFloat(u.width)||a.offsetWidth,_=parseFloat(u.height)||a.offsetHeight,v=Math.min(g/14,_/20),y=v*2.2,b=v*3.9,ee=(s.left-o.left-d+m-y)/n.clientWidth*100,x=(s.top-o.top-f+h-b)/n.clientHeight*100;t.style.setProperty(`--mtr-email`,`${ee.toFixed(2)}cqw ${x.toFixed(2)}cqh`)};r.requestAnimationFrame(()=>{a(),r.requestAnimationFrame(a)});let o=i()?.closest(`.ps-desktop`);if(o&&r.ResizeObserver){let e=new r.ResizeObserver(a);e.observe(o),t.__emailCaptureObserver=e}},installPortfolioFixes:()=>{if(!n?.head||t.hasAttribute(`data-premium-portfolio-motion-fixes`))return;t.setAttribute(`data-premium-portfolio-motion-fixes`,``);let e=n.createElement(`style`);if(e.id=`portfolio-motion-fixes`,e.textContent=`
          /* ============================================================
             A. Preview 48's rendered gallery topology. Its desktop artifact
             leads; the phone is a static supporting adaptation. The current
             palette remains mapped through the existing --pv-* properties.
             ============================================================ */
          #picker-form .picker-preview-motion[data-surface="experience"] {
            --pvs-title: var(--pg-ink);
            --pvs-cta: var(--pv-primary);
            --pvs-bars: var(--pg-ink);
            --pvs-accent-d: var(--pv-primary);
            --pvs-ink: var(--pv-n-ink);
            grid-row: 2;
            width: 100%;
            height: 100%;
            aspect-ratio: auto;
          }
          #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop {
            --pv-text: 1.35;
            position: relative;
            container-type: size;
          }
          #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop .pv-pill {
            color: var(--pv-neutral);
            display: grid;
            place-items: center;
          }
          #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop .pv-pill::after {
            content: "";
            width: calc(8.5 * var(--pv-x));
            height: calc(1.3 * var(--pv-x));
            background: currentColor;
            border-radius: 2px;
          }
          #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop .pg-cap {
            padding-top: 5.2cqh !important;
            gap: 2.6cqh !important;
          }
          #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop .pg-cap::before {
            content: "";
            display: block;
            width: calc(11.5 * var(--pv-x));
            aspect-ratio: 1;
            border: 1px solid color-mix(in oklab, var(--pv-secondary) 55%, var(--pv-neutral));
            border-radius: 50%;
            background: linear-gradient(
              135deg,
              color-mix(in oklab, var(--pv-secondary) 24%, var(--pv-neutral)),
              color-mix(in oklab, var(--pv-secondary) 46%, var(--pv-neutral))
            );
          }
          #picker-form .picker-preview-motion[data-surface="experience"] :is(.pg-row--flip, .pg-rail) {
            border-color: transparent !important;
            box-shadow: none !important;
          }

          /* Existing motion is remapped onto Preview 48's desktop-only hooks. */
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 3.8s linear infinite mtr-nav-1--portfolio;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 3.8s linear infinite mxr-name-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 3.8s linear infinite mxr-mark-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:nth-child(2) .pg-cap-title {
            animation: 3.8s linear infinite mxr-name-2;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:nth-child(2) > .pv-image::after {
            animation: 3.8s linear infinite mxr-mark-2;
          }

          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 4.2s linear infinite mxv-nav-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 4.2s linear infinite mxv-name;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 4.2s linear infinite mxv-mark;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-arrow--next {
            animation: 4.2s linear infinite mxv-arrow;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track {
            animation: 4.2s linear infinite mxv-track;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:first-child {
            animation: 4.2s linear infinite mxv-stop-off;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:nth-child(2) {
            animation: 4.2s linear infinite mxv-stop-on;
          }

          /* Choreographed keeps every project visible. Focus travels through the
             existing image, caption, marker, and pagination controls with bounded
             blur and transform motion; no component is revealed from opacity 0. */
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor {
            animation: 5.6s linear infinite pgc-path !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor::after {
            animation: none !important;
            opacity: 0 !important;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 5.6s linear infinite pgc-nav;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child > .pv-image {
            transform-origin: 50% 50%;
            animation: 5.6s linear infinite pgc-image-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child .pg-cap {
            animation: 5.6s linear infinite pgc-cap-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 5.6s linear infinite pgc-name-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 5.6s linear infinite pgc-mark-1;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-arrow--next {
            animation: 5.6s linear infinite pgc-arrow;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-track i:first-child {
            animation: 5.6s linear infinite pgc-stop-off;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-track i:nth-child(2) {
            animation: 5.6s linear infinite pgc-stop-on;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) > .pv-image {
            transform-origin: 50% 50%;
            animation: 5.6s linear infinite pgc-image-2;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) .pg-cap {
            animation: 5.6s linear infinite pgc-cap-2;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) .pg-cap-title {
            animation: 5.6s linear infinite pgc-name-2;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) > .pv-image::after {
            animation: 5.6s linear infinite pgc-mark-2;
          }

          /* ============================================================
             B. Restrained cell (3.8s linear cycle).
             New route: entry -> nav1 (one nav hover only) -> work1 -> work2 -> exit.
             The -tip variables are set by plotIndexTips() below; fallbacks
             are the precomputed tip-compensated stops.
             ============================================================ */
          @keyframes mxr-path {
            0% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
            9.21%, 30% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            45%, 62% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            72%, 88% { translate: var(--mxi-work2-tip, 77.3cqw 66.8cqh); }
            96.5%, 100% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
          }
          /* Nav 1 highlight + dropdown follow the longer nav dwell. */
          @keyframes mtr-nav-1--portfolio {
            0%, 9.2% { background-color: var(--pvs-bars); }
            9.21%, 29.99% { background-color: var(--pvs-cta); }
            30%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-1--portfolio {
            0%, 9.2% { opacity: 0; }
            9.21%, 29.99% { opacity: 1; }
            30%, 100% { opacity: 0; }
          }
          /* Nav 2 never hovers: pin its highlight and dropdown to rest. */
          @keyframes mtr-nav-2 {
            0%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-2 {
            0%, 100% { opacity: 0; }
          }
          /* Work-row hovers retimed to the new dwells (45-62 and 72-88).
             Name bars keep Preview 48's ink at rest and use the existing primary
             only while the cursor is actually over that project. */
          @keyframes mxr-name-1 {
            0%, 44.99% { background-color: var(--pg-ink); }
            45%, 61.99% { background-color: var(--pv-primary); }
            62%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes mxr-mark-1 {
            0%, 44.99% { background-color: var(--pvs-accent-d); scale: 1; }
            45%, 61.99% { background-color: var(--pvs-cta); scale: 1.4; }
            62%, 100% { background-color: var(--pvs-accent-d); scale: 1; }
          }
          @keyframes mxr-name-2 {
            0%, 71.99% { background-color: var(--pg-ink); }
            72%, 87.99% { background-color: var(--pv-primary); }
            88%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes mxr-mark-2 {
            0%, 71.99% { background-color: var(--pvs-accent-d); scale: 1; }
            72%, 87.99% { background-color: var(--pvs-cta); scale: 1.4; }
            88%, 100% { background-color: var(--pvs-accent-d); scale: 1; }
          }

          /* ============================================================
             C. Responsive cell (4.2s cycle). Ground nav/work windows are
             kept (their companion animations already align); the rail
             dwell is extended to 86% so the click -> slide -> swap story
             completes while the cursor is still on the arrow.
             ============================================================ */
          @keyframes mxv-path {
            0% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
            5.95%, 25% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            34.52%, 50% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            60.71%, 86% { translate: var(--mxi-rail-tip, 96.0cqw 85.4cqh); }
            92%, 99.99% { translate: 32cqw 115cqh; }
            100% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
          }
          @keyframes mxv-nav-1 {
            0%, 5.94% { background-color: var(--pvs-bars); }
            5.95%, 24.99% { background-color: var(--pvs-cta); }
            25%, 100% { background-color: var(--pvs-bars); }
          }
          /* Name bar: same window as ground mxv-name, new rest color. */
          @keyframes mxv-name {
            0%, 34.51% { background-color: var(--pg-ink); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.33%, 50% { background-color: var(--pv-primary); }
            52.86%, 100% { background-color: var(--pg-ink); }
          }
          /* Pagination advances AFTER the click ring (click at ~63%,
             slide + swap 66.5 -> 70). */
          @keyframes mxv-track {
            0%, 66.49% { translate: 0; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { translate: -6px; }
            100% { translate: 0; }
          }
          @keyframes mxv-stop-off {
            0%, 66.49% { background-color: var(--pvs-cta); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { background-color: var(--pvs-bars); }
            100% { background-color: var(--pvs-cta); }
          }
          @keyframes mxv-stop-on {
            0%, 66.49% { background-color: var(--pvs-bars); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { background-color: var(--pvs-cta); }
            100% { background-color: var(--pvs-bars); }
          }

          /* ============================================================
             D. Choreographed cell (5.6s cycle). A closed cursor circuit and
             non-destructive focus choreography. Every element remains visible.
             ============================================================ */
          @keyframes pgc-path {
            0%, 14% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            22%, 38% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            48%, 64% { translate: var(--mxi-rail-tip, 96cqw 85.4cqh); }
            74%, 88% { translate: var(--mxi-work2-tip, 77.3cqw 66.8cqh); }
            100% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
          }
          @keyframes pgc-nav {
            0%, 14% { background-color: var(--pv-primary); }
            18%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-image-1 {
            0%, 18% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
            22% { filter: blur(.8px) saturate(.98); scale: 1.006; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            28%, 36% { filter: blur(0) saturate(1.04); scale: 1.012; clip-path: inset(0); }
            42%, 100% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
          }
          @keyframes pgc-cap-1 {
            0%, 18% { filter: blur(0); translate: 0 0; opacity: 1; }
            22% { filter: blur(.7px); translate: 0 1.5px; opacity: 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            28%, 36% { filter: blur(0); translate: 0 0; opacity: 1; }
            42%, 100% { filter: blur(0); translate: 0 0; opacity: 1; }
          }
          @keyframes pgc-name-1 {
            0%, 21.99% { background-color: var(--pg-ink); }
            28%, 36% { background-color: var(--pv-primary); }
            42%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-mark-1 {
            0%, 21.99% { scale: 1; }
            28%, 36% { scale: 1.35; }
            42%, 100% { scale: 1; }
          }
          @keyframes pgc-arrow {
            0%, 47.99% { translate: 0; filter: blur(0); }
            53%, 60% { translate: 1.5px 0; filter: blur(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            66%, 100% { translate: 0; filter: blur(0); }
          }
          @keyframes pgc-stop-off {
            0%, 52% { background-color: var(--pv-primary); scale: 1; }
            58%, 64% { background-color: var(--pg-ink); scale: .82; }
            70%, 100% { background-color: var(--pv-primary); scale: 1; }
          }
          @keyframes pgc-stop-on {
            0%, 52% { background-color: var(--pg-ink); scale: 1; }
            58%, 64% { background-color: var(--pv-primary); scale: 1.18; }
            70%, 100% { background-color: var(--pg-ink); scale: 1; }
          }
          @keyframes pgc-image-2 {
            0%, 70% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
            74% { filter: blur(.8px) saturate(.98); scale: 1.006; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            80%, 88% { filter: blur(0) saturate(1.04); scale: 1.012; clip-path: inset(0); }
            94%, 100% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
          }
          @keyframes pgc-cap-2 {
            0%, 70% { filter: blur(0); translate: 0 0; opacity: 1; }
            74% { filter: blur(.7px); translate: 0 1.5px; opacity: 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            80%, 88% { filter: blur(0); translate: 0 0; opacity: 1; }
            94%, 100% { filter: blur(0); translate: 0 0; opacity: 1; }
          }
          @keyframes pgc-name-2 {
            0%, 73.99% { background-color: var(--pg-ink); }
            80%, 88% { background-color: var(--pv-primary); }
            94%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-mark-2 {
            0%, 73.99% { scale: 1; }
            80%, 88% { scale: 1.35; }
            94%, 100% { scale: 1; }
          }

          /* ============================================================
             E. Click ring. Restrained starts from a quiet default here; its
             modal sequence below owns the two intentional clicks. Responsive
             clicks once on the next-arrow before pagination advances.
             (Keyframes are document-global, so the per-cell split lives in
             these scoped assignment rules.)
             ============================================================ */
          #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .ps-cursor::after {
            animation: none;
            opacity: 0;
          }
          #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .ps-cursor::after {
            animation: 4.2s linear infinite mxi-rail-click !important;
          }
          @keyframes mxi-rail-click {
            0%, 62.49% { opacity: 0; scale: .35; }
            62.9% { opacity: .55; scale: .35; }
            65.3% { opacity: 0; scale: 1.5; }
            100% { opacity: 0; scale: 1.5; }
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-surface="experience"] .ps-cursor::after {
              animation: none !important;
              opacity: 0 !important;
            }
            #picker-form .picker-preview-motion[data-surface="experience"] .pv-desktop :is(
              .pv-nav-bars i,
              .pv-image,
              .pv-image::before,
              .pv-image::after,
              .pg-cap,
              .pg-cap-title,
              .pg-arrow,
              .pg-track,
              .pg-track i
            ) {
              animation: none !important;
              opacity: 1 !important;
              clip-path: none !important;
              filter: none !important;
              translate: none !important;
              scale: 1 !important;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor {
              animation: none !important;
              translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh) !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e),i.slice(i.indexOf(`-`)+1)===`restrained`){let e=n.createElement(`style`);e.id=`restrained-portfolio-perfect-loop`,e.textContent=`
            /* Preview 29's whole story is one closed interaction loop:
               nav dropdown -> first gallery image -> modal -> close -> nav. */
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav {
              position: relative;
              z-index: 3;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
              position: relative;
              animation: 4s linear infinite mxr-modal-nav !important;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::after {
              content: "";
              box-sizing: border-box;
              width: 64px;
              height: 54px;
              position: absolute;
              z-index: 4;
              top: calc(100% + 8px);
              left: -10px;
              transform-origin: top;
              pointer-events: none;
              border: 1.5px solid var(--pv-primary);
              border-radius: 2px;
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4s linear infinite mxr-modal-dropdown;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::before {
              content: "";
              width: 41px;
              height: 31px;
              position: absolute;
              z-index: 5;
              top: calc(100% + 18.5px);
              left: 1.5px;
              pointer-events: none;
              background-image:
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink));
              background-position: 0 0, 0 13px, 0 26px;
              background-repeat: no-repeat;
              background-size: 78% 5px, 92% 5px, 64% 5px;
              opacity: 0;
              animation: 4s linear infinite mxr-modal-dropdown;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
              z-index: 15;
              animation: 4s cubic-bezier(.16, 1, .3, 1) infinite mxr-modal-path !important;
            }

            #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor::after {
              left: -7.95px !important;
              top: -7.95px !important;
              animation: 4s linear infinite mxr-modal-click !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row .pg-cap-title,
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row > .pv-image::after {
              animation: none !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row .pg-cap-title {
              background-color: var(--pg-ink) !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-scene {
              display: block;
              position: absolute;
              z-index: 8;
              inset: 0;
              overflow: hidden;
              pointer-events: none;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-backdrop {
              display: block;
              position: absolute;
              inset: 0;
              background: color-mix(in oklab, var(--pv-neutral) 52%, transparent);
              opacity: 0;
              -webkit-backdrop-filter: blur(0);
              backdrop-filter: blur(0);
              animation: 4s linear infinite mxr-modal-backdrop;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-surface {
              display: block;
              box-sizing: border-box;
              position: absolute;
              inset: 13cqh 12cqw 12cqh;
              overflow: hidden;
              padding: 7cqh 4cqw 4.2cqh;
              border: 1px solid color-mix(in oklab, var(--pv-secondary) 58%, var(--pv-neutral));
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4s linear infinite mxr-modal-surface;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close {
              display: grid;
              place-items: center;
              box-sizing: border-box;
              width: 4cqw;
              aspect-ratio: 1;
              position: absolute;
              z-index: 2;
              top: 2.3cqh;
              right: 1.8cqw;
              border: 0;
              background: transparent;
              box-shadow: none;
              color: var(--pv-primary);
              animation: 4s linear infinite mxr-modal-close-press;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::before,
            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::after {
              content: "";
              width: 48%;
              height: 1px;
              position: absolute;
              left: 50%;
              top: 50%;
              translate: -50% -50%;
              background: currentColor;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::before {
              rotate: 45deg;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::after {
              rotate: -45deg;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-bento {
              display: grid;
              width: 100%;
              height: 100%;
              grid-template-columns: 1.2fr .8fr .8fr;
              grid-template-rows: 1fr 1fr;
              gap: 2.1cqw;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image {
              display: block !important;
              width: 100% !important;
              height: 100% !important;
              min-width: 0;
              min-height: 0;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image--hero {
              grid-row: 1 / 3;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image--wide {
              grid-column: 2 / 4;
            }

            @keyframes mxr-modal-path {
              0%, 6% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
              18%, 25.5% {
                translate: var(--mxi-work1-tip, 33cqw 29.74cqh);
              }
              38%, 76% {
                translate: var(--mxr-modal-close-tip, 83.88cqw 17.95cqh);
              }
              88.5%, 100% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
            }

            @keyframes mxr-modal-nav {
              0%, 6% { background-color: var(--pvs-cta); }
              9%, 85.5% { background-color: var(--pvs-bars); }
              88.5%, 100% { background-color: var(--pvs-cta); }
            }

            @keyframes mxr-modal-dropdown {
              0%, 6% { opacity: 1; }
              9%, 85.5% { opacity: 0; }
              88.5%, 100% { opacity: 1; }
            }

            @keyframes mxr-modal-click {
              0%, 20.99% { opacity: 0; scale: .35; }
              21% { opacity: .55; scale: .35; }
              25.5% { opacity: 0; scale: 1.5; }
              25.51%, 71.49% { opacity: 0; scale: .35; }
              71.5% { opacity: .55; scale: .35; }
              76% { opacity: 0; scale: 1.5; }
              76.01%, 100% { opacity: 0; scale: .35; }
            }

            @keyframes mxr-modal-backdrop {
              0%, 25.49% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
              25.5% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              38%, 75.99% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
              }
              76% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              86%, 100% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
            }

            @keyframes mxr-modal-surface {
              0%, 25.49% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
              }
              25.5% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              38%, 75.99% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
              }
              76% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              86% {
                opacity: 0;
                clip-path: inset(3%);
                filter: blur(4px);
                scale: 1;
              }
              86.01%, 100% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
              }
            }

            @keyframes mxr-modal-close-press {
              0%, 71.49% { scale: 1; }
              73.25% { scale: .82; }
              76%, 100% { scale: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::before,
              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::after {
                animation: none !important;
                opacity: 1 !important;
                scale: 1 !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child,
              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
                animation: none !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
                background-color: var(--pvs-cta) !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
                translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh) !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-scene {
                display: none !important;
              }
            }
          `;let t=n.querySelector(`.picker-preview-motion--index`)?.querySelector(`.pv-desktop`);t&&!t.querySelector(`.mxr-modal-scene`)&&t.insertAdjacentHTML(`beforeend`,`<span class="mxr-modal-scene" aria-hidden="true"><span class="mxr-modal-backdrop"></span><span class="mxr-modal-surface"><i class="mxr-modal-close"></i><span class="mxr-modal-bento"><i class="pv-image mxr-modal-image mxr-modal-image--hero"></i><i class="pv-image mxr-modal-image mxr-modal-image--wide"></i><i class="pv-image mxr-modal-image"></i><i class="pv-image mxr-modal-image"></i></span></span></span>`),n.getElementById(e.id)||n.head.appendChild(e)}if(i.slice(i.indexOf(`-`)+1)===`responsive`){let e=n.createElement(`style`);e.id=`responsive-portfolio-perfect-loop`,e.textContent=`
            /* Preview 30 keeps preview 27's responsive dropdown, then follows
               one focused interaction: first gallery image -> modal -> close. */
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav {
              position: relative;
              z-index: 3;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
              position: relative;
              animation: 4.2s linear infinite mxv-modal-nav !important;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::after {
              content: "";
              box-sizing: border-box;
              width: 64px;
              height: 54px;
              position: absolute;
              z-index: 4;
              top: calc(100% + 8px);
              left: -10px;
              transform-origin: top;
              pointer-events: none;
              border: 1.5px solid var(--pv-primary);
              border-radius: 2px;
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4.2s linear infinite mxv-drop-panel;
            }
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::before {
              content: "";
              width: 41px;
              height: 31px;
              position: absolute;
              z-index: 5;
              top: calc(100% + 18.5px);
              left: 1.5px;
              pointer-events: none;
              background-image:
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink));
              background-position: 0 -6px, 0 7px, 0 20px;
              background-repeat: no-repeat;
              background-size: 78% 5px, 92% 5px, 64% 5px;
              opacity: 0;
              animation: 4.2s linear infinite mxv-drop-rows;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
              z-index: 15;
              animation: 4.2s linear infinite mxv-modal-path !important;
            }

            #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor::after {
              left: -7.95px !important;
              top: -7.95px !important;
              animation: 4.2s linear infinite mxv-modal-click !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row .pg-cap-title,
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row > .pv-image::after,
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-arrow--next,
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track,
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i {
              animation: none !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row .pg-cap-title {
              background-color: var(--pg-ink) !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track {
              translate: 0 !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:first-child {
              background-color: var(--pvs-cta) !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:not(:first-child) {
              background-color: var(--pvs-bars) !important;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-scene {
              display: block;
              position: absolute;
              z-index: 8;
              inset: 0;
              overflow: hidden;
              pointer-events: none;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-backdrop {
              display: block;
              position: absolute;
              inset: 0;
              background: color-mix(in oklab, var(--pv-neutral) 52%, transparent);
              opacity: 0;
              -webkit-backdrop-filter: blur(0);
              backdrop-filter: blur(0);
              animation: 4.2s linear infinite mxv-modal-backdrop;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-surface {
              display: block;
              box-sizing: border-box;
              position: absolute;
              inset: 13cqh 12cqw 12cqh;
              overflow: hidden;
              padding: 7cqh 4cqw 4.2cqh;
              border: 1px solid color-mix(in oklab, var(--pv-secondary) 58%, var(--pv-neutral));
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4.2s linear infinite mxv-modal-surface;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close {
              display: grid;
              place-items: center;
              box-sizing: border-box;
              width: 4cqw;
              aspect-ratio: 1;
              position: absolute;
              z-index: 2;
              top: 2.3cqh;
              right: 1.8cqw;
              border: 0;
              background: transparent;
              box-shadow: none;
              color: var(--pv-primary);
              animation: 4.2s linear infinite mxv-modal-close-press;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::before,
            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::after {
              content: "";
              width: 48%;
              height: 1px;
              position: absolute;
              left: 50%;
              top: 50%;
              translate: -50% -50%;
              background: currentColor;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::before {
              rotate: 45deg;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::after {
              rotate: -45deg;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-bento {
              display: grid;
              width: 100%;
              height: 100%;
              grid-template-columns: 1.2fr .8fr .8fr;
              grid-template-rows: 1fr 1fr;
              gap: 2.1cqw;
              opacity: 0;
              filter: blur(10px);
              translate: 0 4cqh;
              animation: 4.2s linear infinite mxv-modal-content;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image {
              display: block !important;
              width: 100% !important;
              height: 100% !important;
              min-width: 0;
              min-height: 0;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image--hero {
              grid-row: 1 / 3;
            }

            #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image--wide {
              grid-column: 2 / 4;
            }

            @keyframes mxv-modal-path {
              0%, 25% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              34.52%, 43% {
                translate: var(--mxi-work1-tip, 33cqw 29.74cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              60%, 84% {
                translate: var(--mxv-modal-close-tip, 83.88cqw 17.95cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              94%, 100% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
            }

            @keyframes mxv-modal-nav {
              0%, 5.95% {
                background-color: var(--pvs-bars);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              8.81%, 25% { background-color: var(--pvs-cta); }
              27.86%, 100% { background-color: var(--pvs-bars); }
            }

            @keyframes mxv-drop-panel {
              0%, 5.94% { opacity: 0; scale: 1 0; }
              5.95% {
                opacity: 1;
                scale: 1 0;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              10.24%, 25% { opacity: 1; scale: 1; }
              27.85% { opacity: 1; scale: 1 0; }
              27.86%, 100% { opacity: 0; scale: 1 0; }
            }
            @keyframes mxv-drop-rows {
              0%, 5.95% {
                opacity: 0;
                background-position: 0 -6px, 0 7px, 0 20px;
              }
              7.14% {
                opacity: .25;
                background-position: 0 -4.5px, 0 7px, 0 20px;
              }
              8.33% {
                opacity: .5;
                background-position: 0 -3px, 0 8.5px, 0 20px;
              }
              10.71% {
                opacity: 1;
                background-position: 0 0, 0 11.5px, 0 23px;
              }
              11.9% {
                opacity: 1;
                background-position: 0 0, 0 13px, 0 24.5px;
              }
              13.1%, 25% {
                opacity: 1;
                background-position: 0 0, 0 13px, 0 26px;
              }
              27.86%, 100% {
                opacity: 0;
                background-position: 0 -6px, 0 7px, 0 20px;
              }
            }

            @keyframes mxv-modal-click {
              0%, 39.99% { opacity: 0; scale: .35; }
              40% { opacity: .55; scale: .35; }
              43% { opacity: 0; scale: 1.5; }
              43.01%, 71.99% { opacity: 0; scale: .35; }
              72% { opacity: .55; scale: .35; }
              75% { opacity: 0; scale: 1.5; }
              75.01%, 100% { opacity: 0; scale: .35; }
            }

            @keyframes mxv-modal-backdrop {
              0%, 42.99% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
              43% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
                animation-timing-function: cubic-bezier(.22, .72, .2, 1);
              }
              55%, 74.99% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
              }
              75% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82%, 100% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
            }

            @keyframes mxv-modal-surface {
              0%, 42.99% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(7px);
                scale: 1;
              }
              43% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(10px);
                scale: 1;
                animation-timing-function: cubic-bezier(.22, .72, .2, 1);
              }
              60%, 74.99% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
              }
              75% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82% {
                opacity: 0;
                clip-path: inset(0 0 14% 0);
                filter: blur(4px);
                scale: 1;
              }
              82.01%, 100% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(10px);
                scale: 1;
              }
            }

            @keyframes mxv-modal-content {
              0%, 46.99% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
              }
              47% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              61%, 74.99% {
                opacity: 1;
                filter: blur(0);
                translate: 0 0;
              }
              75% {
                opacity: 1;
                filter: blur(0);
                translate: 0 0;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              81.5% {
                opacity: 0;
                filter: blur(4px);
                translate: 0 -1cqh;
              }
              81.51%, 100% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
              }
            }

            @keyframes mxv-modal-close-press {
              0%, 52.99% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
              }
              53% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              60%, 71.99% {
                opacity: 1;
                filter: blur(0);
                scale: 1;
              }
              73.5% {
                opacity: 1;
                filter: blur(0);
                scale: .82;
              }
              75% {
                opacity: 1;
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82% {
                opacity: 0;
                filter: blur(3px);
                scale: 1;
              }
              82.01%, 100% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::before,
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child,
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
                animation: none !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
                background-color: var(--pvs-bars) !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh) !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-scene {
                display: none !important;
              }

              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-backdrop,
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-surface,
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-bento,
              #picker-form .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close {
                animation: none !important;
              }
            }
          `;let t=n.querySelector(`.picker-preview-motion--index`)?.querySelector(`.pv-desktop`);t&&!t.querySelector(`.mxv-modal-scene`)&&t.insertAdjacentHTML(`beforeend`,`<span class="mxv-modal-scene" aria-hidden="true"><span class="mxv-modal-backdrop"></span><span class="mxv-modal-surface"><i class="mxv-modal-close"></i><span class="mxv-modal-bento"><i class="pv-image mxv-modal-image mxv-modal-image--hero"></i><i class="pv-image mxv-modal-image mxv-modal-image--wide"></i><i class="pv-image mxv-modal-image"></i><i class="pv-image mxv-modal-image"></i></span></span></span>`),n.getElementById(e.id)||n.head.appendChild(e)}if(i.slice(i.indexOf(`-`)+1)===`choreographed`){let e=n.createElement(`style`);e.id=`choreographed-portfolio-stagger-only`,e.textContent=`
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"],
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] *,
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] *::before,
          #picker-form#picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] *::after {
            animation: none !important;
            transition: none !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor,
          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor::after {
            opacity: 0 !important;
          }

          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row--scroll-one {
            margin-top: 12cqh;
          }

          #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] :is(
            .pv-desktop .pg-row:first-child > .pv-image,
            .pv-desktop .pg-row:first-child > .pg-cap,
            .pv-desktop .pg-row:nth-child(2) > .pv-image,
            .pv-desktop .pg-row:nth-child(2) > .pg-cap,
            .pg-phone-body > .pv-image:nth-child(1),
            .pg-phone-body > .pg-cap:nth-child(2),
            .pg-phone-body > .pv-image:nth-child(3),
            .pg-phone-body > .pg-cap:nth-child(4),
            .pv-tabbar
          ) {
            opacity: 1;
            filter: none;
            transform: none;
            clip-path: none !important;
            translate: none !important;
            scale: 1 !important;
          }

          @media (prefers-reduced-motion: reduce) {
            #picker-form .picker-preview-motion[data-motion-cell="experience-choreographed"] :is(
              .pv-desktop .pg-row:first-child > .pv-image,
              .pv-desktop .pg-row:first-child > .pg-cap,
              .pv-desktop .pg-row:nth-child(2) > .pv-image,
              .pv-desktop .pg-row:nth-child(2) > .pg-cap,
              .pg-phone-body > .pv-image:nth-child(1),
              .pg-phone-body > .pg-cap:nth-child(2),
              .pg-phone-body > .pv-image:nth-child(3),
              .pg-phone-body > .pg-cap:nth-child(4),
              .pv-tabbar
            ) {
              opacity: 1 !important;
              filter: none !important;
              transform: none !important;
            }
          }
        `,n.getElementById(e.id)||n.head.appendChild(e);let i=n.querySelector(`.picker-preview-motion--index`),a=i?.querySelector(`.pv-desktop .pg-body`),o=i?.querySelector(`.pv-phone .pg-phone-body`);a?.querySelectorAll(`:scope > .pg-rail`).forEach(e=>e.remove()),a&&!a.querySelector(`.pg-row--scroll-one`)&&a.insertAdjacentHTML(`beforeend`,`<span class="pg-row pg-row--more pg-row--scroll-one"><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:31.4%"></i><i></i><i style="--w:61.8%"></i></span></span><span class="pg-row pg-row--flip pg-row--more pg-row--scroll-two"><span class="pg-cap"><i class="pg-cap-title" style="--w:38.2%"></i><i></i><i style="--w:59.4%"></i></span><span class="pv-image"></span></span>`),o&&!o.querySelector(`.pg-phone-more-start`)&&o.insertAdjacentHTML(`beforeend`,`<span class="pv-image pg-phone-more pg-phone-more-start"></span><span class="pg-cap pg-phone-more pg-phone-more-copy-one"><i class="pg-cap-title" style="--w:34.2%"></i><i style="--w:74.6%"></i><i style="--w:51.8%"></i></span><span class="pv-image pg-phone-more pg-phone-more-image-two"></span><span class="pg-cap pg-phone-more pg-phone-more-copy-two"><i class="pg-cap-title" style="--w:28.8%"></i><i style="--w:82.4%"></i><i style="--w:58.2%"></i></span>`);let s=[[`.pv-desktop .pg-row:first-child > .pv-image`,`.pv-desktop .pg-row:first-child > .pg-cap`,`.pv-desktop .pg-row:nth-child(2) > .pv-image`,`.pv-desktop .pg-row:nth-child(2) > .pg-cap`],[`.pg-phone-body > .pv-image:nth-child(1)`,`.pg-phone-body > .pg-cap:nth-child(2)`,`.pg-phone-body > .pv-image:nth-child(3)`,`.pg-phone-body > .pg-cap:nth-child(4)`,`.pv-tabbar`]],c=()=>{let e=Math.sqrt(120),t=20/(2*Math.sqrt(120)),n=e*Math.sqrt(1-t**2);return Array.from({length:73},(r,i)=>{let a=i/72,o=1050*a/1e3,s=i===72?0:Math.exp(-t*e*o)*(Math.cos(n*o)+t*e/n*Math.sin(n*o)),c=Math.max(0,Math.min(1,1-s));return{offset:a,opacity:Number(c.toFixed(4)),filter:`blur(${(4*(1-c)).toFixed(3)}px)`,transform:`translateY(${(40*s).toFixed(3)}px)`}})},l={imageFromLeft:[{opacity:.12,filter:`blur(9px)`,clipPath:`inset(0 100% 0 0)`,transform:`translateX(-72px) scale(1.025)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px) scale(1)`}],copyFromRight:[{opacity:0,filter:`blur(5px)`,clipPath:`inset(0 0 0 100%)`,transform:`translateX(44px)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px)`}],imageFromRight:[{opacity:.12,filter:`blur(9px)`,clipPath:`inset(0 0 0 100%)`,transform:`translateX(72px) scale(1.025)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px) scale(1)`}],copyFromLeft:[{opacity:0,filter:`blur(5px)`,clipPath:`inset(0 100% 0 0)`,transform:`translateX(-44px)`},{opacity:1,filter:`blur(0px)`,clipPath:`inset(0)`,transform:`translateX(0px)`}]},u=r.matchMedia(`(prefers-reduced-motion: reduce)`);if(i&&r.Element?.prototype.animate&&!u.matches){let e=[],n=c();for(let t of s)t.map(e=>i.querySelector(e)).filter(Boolean).forEach((t,r)=>{e.push(t.animate(n,{duration:1050,delay:r*100,easing:`linear`,fill:`both`}))});let d=7200,f=e=>e/d,p=(t,n,r)=>{if(!t||!n||!r)return;let i=r.offsetTop-n.offsetTop;i>0&&e.push(t.animate([{offset:0,transform:`translateY(0px)`},{offset:f(1750),transform:`translateY(0px)`,easing:`cubic-bezier(.65, 0, .35, 1)`},{offset:f(2850),transform:`translateY(${-i}px)`},{offset:f(5400),transform:`translateY(${-i}px)`,easing:`cubic-bezier(.65, 0, .35, 1)`},{offset:f(6500),transform:`translateY(0px)`},{offset:1,transform:`translateY(0px)`}],{duration:d,easing:`linear`,fill:`both`}))};p(a,a?.querySelector(`:scope > .pg-row:first-child`),a?.querySelector(`:scope > .pg-row--scroll-one`)),p(o,o?.querySelector(`:scope > .pv-image:first-child`),o?.querySelector(`:scope > .pg-phone-more-start`));for(let[t,n,r]of[[`.pv-desktop .pg-row--scroll-one > .pv-image`,`imageFromLeft`,2020],[`.pv-desktop .pg-row--scroll-one > .pg-cap`,`copyFromRight`,2160],[`.pv-desktop .pg-row--scroll-two > .pv-image`,`imageFromRight`,2400],[`.pv-desktop .pg-row--scroll-two > .pg-cap`,`copyFromLeft`,2540],[`.pv-phone .pg-phone-more-start`,`imageFromLeft`,2020],[`.pv-phone .pg-phone-more-copy-one`,`copyFromRight`,2160],[`.pv-phone .pg-phone-more-image-two`,`imageFromRight`,2400],[`.pv-phone .pg-phone-more-copy-two`,`copyFromLeft`,2540]]){let a=i.querySelector(t);a&&e.push(a.animate(l[n],{duration:n.startsWith(`image`)?720:620,delay:r,easing:`cubic-bezier(.16, 1, .3, 1)`,fill:`both`}))}let m=()=>{if(u.matches){e.forEach(e=>e.cancel());return}e.forEach(e=>{e.pause(),e.currentTime=0,e.play()})};t.__replayMotion=m,u.addEventListener(`change`,({matches:t})=>{t?e.forEach(e=>e.cancel()):m()}),r.addEventListener(`pagehide`,()=>{e.forEach(e=>e.cancel())})}}let a=()=>{for(let e of n.querySelectorAll(`.picker-preview-motion--index`)){let t=e.querySelector(`.pv-desktop`),n=e.querySelector(`.ps-cursor`);if(!t?.clientWidth||!t.clientHeight||!n)continue;let a=t.getBoundingClientRect(),o=r.getComputedStyle(t),s=parseFloat(o.borderLeftWidth)||0,c=parseFloat(o.borderRightWidth)||0,l=parseFloat(o.borderTopWidth)||0,u=parseFloat(o.borderBottomWidth)||0,d=a.width-s-c,f=a.height-l-u,p=r.getComputedStyle(n),m=parseFloat(p.width)||n.offsetWidth,h=parseFloat(p.height)||n.offsetHeight,g=Math.min(m/14,h/20),_=[`restrained`,`responsive`].includes(i.slice(i.indexOf(`-`)+1)),v=g*(_?1:2.2),y=g*(_?1:3.9),b=(n,r)=>{let i=t.querySelector(r);if(!i)return;let o=i.getBoundingClientRect(),c=(o.left+o.width/2-a.left-s-v)/d*100,u=(o.top+o.height/2-a.top-l-y)/f*100;e.style.setProperty(n,c.toFixed(2)+`cqw `+u.toFixed(2)+`cqh`)};b(`--mxi-nav1-tip`,`.pv-nav-bars i:nth-child(1)`),b(`--mxi-work1-tip`,`.pg-row:nth-of-type(1) > .pv-image`),b(`--mxi-work2-tip`,`.pg-row:nth-of-type(2) > .pv-image`),b(`--mxi-rail-tip`,`.pg-arrow--next`),b(`--mxr-modal-close-tip`,`.mxr-modal-close`),b(`--mxv-modal-close-tip`,`.mxv-modal-close`)}};r.requestAnimationFrame(()=>{a(),r.requestAnimationFrame(a)});let o=n.querySelector(`.pv-desktop`);if(o&&r.ResizeObserver){let e=new r.ResizeObserver(a);e.observe(o),t.__portfolioTipObserver=e}}})}let t=t=>{let n=e.map(({board:e})=>[e,e.getAttribute(`style`)]);for(let{board:n}of e)n.style.setProperty(`display`,n===t?`grid`:`none`,`important`);return()=>{for(let[e,t]of n)t===null?e.removeAttribute(`style`):e.setAttribute(`style`,t)}},n=(e,n)=>{let r=t(e.board);try{n()}finally{r()}};for(let t of e)t.cell===`persuade-restrained`&&n(t,t.installPerfectCursorLoop);for(let t of e)t.cell===`persuade-responsive`&&n(t,t.installResponsiveLandingCorrections);for(let t of e)t.cell===`persuade-choreographed`&&n(t,t.installChoreographedPremium);for(let t of e)t.cell.startsWith(`persuade-`)&&n(t,t.installEmailCapture);for(let t of e)t.cell.startsWith(`experience-`)&&n(t,t.installPortfolioFixes)}var un=!1;function dn(){if(un)return;let e=document.querySelector(`.picker-screen[data-screen="06"] .picker-board-stage`),t=e?[...e.querySelectorAll(`.picker-preview-motion[data-motion-cell]`)]:[];!t.length||!t.some(e=>e.getBoundingClientRect().width>0)||(un=!0,ln())}var I=document.querySelector(`[data-font-modal]`),fn=I.querySelector(`[data-custom-status]`),pn=e=>I.querySelector(`[data-custom-file="${e}"]`),mn=e=>I.querySelector(`[data-custom-url="${e}"]`),hn=I.querySelector(`[data-font-custom-save]`),gn=I.querySelector(`[data-custom-hint]`),_n=`
`,vn=new Set([`.woff2`,`.woff`,`.ttf`,`.otf`]),L={heading:[],body:[]};function yn(e){let t=e.lastIndexOf(`.`);return t===-1?``:e.slice(t).toLowerCase()}function bn(e){return vn.has(yn(e.name))}function xn(e,t){let n=new DataTransfer;for(let e of t)n.items.add(e);e.files=n.files}function Sn(e,t){return e.name===t.name&&e.size===t.size&&e.lastModified===t.lastModified}function Cn(e,t){let n=[...e];for(let e of t)n.some(t=>Sn(t,e))||n.push(e);return n}function wn(e){let t=I.querySelector(`[data-custom-file-list="${e}"]`),n=L[e];t.replaceChildren(),t.hidden=n.length===0;for(let r of n){let n=document.createElement(`li`);n.className=`picker-modal-file-item`;let i=document.createElement(`span`);i.textContent=r.name;let a=document.createElement(`button`);a.type=`button`,a.className=`picker-modal-file-remove`,a.setAttribute(`aria-label`,`Remove ${r.name}`),a.textContent=`×`,a.onclick=()=>{L[e]=L[e].filter(e=>!Sn(e,r)),xn(pn(e),L[e]),wn(e),En(),fn.textContent=``},n.append(i,a),t.append(n)}}var Tn=e=>L[e].length>0||mn(e).value.trim()!==``;function En(){let e=[`heading`,`body`].filter(e=>!Tn(e));hn.disabled=e.length>0,gn.textContent=e.length===2?`Heading and body each need a URL or a file.`:e.length===1?`${e[0]===`heading`?`Heading`:`Body`} still needs a URL or a file.`:``}function Dn(e){return e?e.includes(_n)?e.split(_n).filter(Boolean):[e]:[]}document.querySelector(`[data-font-custom-open]`).onclick=()=>{fn.textContent=``;for(let e of[`heading`,`body`])L[e]=[],pn(e).value=``,xn(pn(e),[]),mn(e).value=``,wn(e);En(),I.showModal()},document.querySelector(`[data-font-custom-close]`).onclick=()=>I.close();for(let e of[`heading`,`body`])pn(e).onchange=({target:t})=>{let n=[...t.files].filter(bn);fn.textContent=n.length===t.files.length?``:`Only .woff2, .woff, .ttf, and .otf files are accepted.`,L[e]=Cn(L[e],n),xn(t,L[e]),t.value=``,wn(e),En()},mn(e).oninput=En;async function On(e){let t=await fetch(`/font-upload`,{method:`POST`,headers:{"X-Font-Filename":e.name,"Content-Type":`application/octet-stream`},body:e}),n=await t.json();if(!t.ok)throw Error(n.error||`Upload failed`);return n.path}async function kn(e){let t=L[e].filter(bn);if(t.length){let e=await Promise.all(t.map(e=>On(e)));return{family:t[0].name.replace(/\.[^.]+$/,``),source:e.join(_n)}}let n=mn(e).value.trim();return n?{family:n.split(`/`).pop().replace(/\.[^.]+$/,``)||`Custom`,source:n}:null}hn.onclick=async()=>{fn.textContent=`Saving…`;let e,t;try{[e,t]=await Promise.all([kn(`heading`),kn(`body`)])}catch(e){fn.textContent=e.message;return}if(!e||!t){fn.textContent=`Add a URL or a file for both the heading and the body.`;return}let n={id:`custom`,name:`Custom`,heading:e,body:t,why:`Your own faces`};je.pairs=[n,...je.pairs.filter(({id:e})=>e!==`custom`)];for(let e of[...rt])e.querySelector(`input`).value===`custom`&&at(e);it(n,{checked:!0,first:!0}),An(n),nt(n),vt({force:!0}),I.close()};function An({heading:e,body:t}){for(let n of[e,t])if(n?.source){if(/\.(css)(\?|$)/i.test(n.source)||!n.source.includes(_n)&&!/\.(woff2?|ttf|otf)(\?|$)/i.test(n.source)){let e=document.createElement(`link`);e.rel=`stylesheet`,e.href=n.source,document.head.append(e);continue}for(let e of Dn(n.source)){let t=e.startsWith(`http`)?e:`/fonts/${e.split(`/`).pop()}`;document.fonts.add(new FontFace(n.family,`url(${t})`))}document.fonts.load(`16px "${n.family}"`)}}function jn(e){ye.textContent!==ye.dataset[e]&&(ye.classList.add(`is-changing`),setTimeout(()=>{ye.textContent=ye.dataset[e],ye.classList.remove(`is-changing`)},90))}var Mn=E(`[data-contrast-alert]`,D),Nn=E(`[data-contrast-tip]`,D);function Pn(e,t,n){e.hidden=n.length===0,t.replaceChildren(...n.map(e=>{let t=document.createElement(`span`);return t.textContent=e,t}))}function Fn(){Pn(Mn,Nn,A.length?b(P().colors):[])}function In(e,t,n=!0){let r=P();r.colors[e]=t.toUpperCase(),r.detached[e]=n,qe(e),Ge(N()),jn(e)}function Ln(e,t,n,r,i){let a=k.get(t.id),o=We(n),s=e.dataset.role;r=Math.min(100,Math.max(0,r)),i=Math.min(100,Math.max(0,i));let c=o.getContext(`2d`).getImageData(Math.round(r/100*(o.width-1)),Math.round(i/100*(o.height-1)),1,1).data,l=`#${[c[0],c[1],c[2]].map(e=>e.toString(16).padStart(2,`0`)).join(``).toUpperCase()}`;a.rings[s]=[r,i],a.colors[s]=l,a.detached[s]=!1,Ge(t),t===N()&&qe(s),jn(s),Ke(e,t,n)}function Rn(e,t,n){let r=r=>{let i=n.getBoundingClientRect();Ln(e,t,n,(r.clientX-i.left)/i.width*100,(r.clientY-i.top)/i.height*100)};e.onpointerdown=t=>{t.button===0&&(e.focus(),e.setPointerCapture(t.pointerId),e.dataset.dragging=``,r(t))},e.onpointermove=t=>{e.hasPointerCapture(t.pointerId)&&(Be(),r(t))},e.onpointerup=t=>{r(t),e.releasePointerCapture(t.pointerId),delete e.dataset.dragging,document.activeElement!==e&&delete xe.dataset.visible},e.onfocus=()=>n.complete&&Ke(e,t,n),e.onblur=()=>{`dragging`in e.dataset||delete xe.dataset.visible},e.onkeydown=r=>{let i={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!i[r.key])return;r.preventDefault(),Be();let a=r.shiftKey?5:1,[o,s]=k.get(t.id).rings[e.dataset.role];Ln(e,t,n,o+i[r.key][0]*a,s+i[r.key][1]*a)}}function zn(e){let t=E(`[data-${e.type}-card]`).content.firstElementChild.cloneNode(!0);t.dataset.id=e.id;let n=E(`.picker-card-face`,t);if(e.type===`seed`)me(`span`,n).forEach((t,n)=>{t.style.setProperty(`--seed-color`,k.get(e.id).colors[T[n]])});else{let t=E(`img`,n);t.alt=`Visual cue ${e.id}`,t.src=`/cues/${encodeURIComponent(e.id)}.png`,me(`.picker-ring`,n).forEach(n=>{let r=n.dataset.role;n.setAttribute(`aria-valuetext`,k.get(e.id).colors[r]),Rn(n,e,t)}),t.addEventListener(`load`,()=>{e.defaultRings=ze(n=>{let[r,i]=e.palette[n].at;return[r/t.naturalWidth*100,i/t.naturalHeight*100]}),k.get(e.id).rings=structuredClone(e.defaultRings),Ge(e),e===N()&&We(t)})}return e.node=t,t}function Bn(){if(!Ae)return;let e=Ae,t=E(`[data-band-item="${e}"]`,D),n=E(`[data-tints]`,t),r=n.contains(document.activeElement);delete t.dataset.tintOpen,n.hidden=!0,Ae=null;let i=E(`[data-edit-tints="${e}"]`,D);i.setAttribute(`aria-expanded`,`false`),i.dataset.tip=`Edit tints`,r&&i.focus()}function Vn(){let e=N();A.forEach(({node:e},t)=>{let n=t-j;e.dataset.pos=Math.max(-2,Math.min(2,n)),e.classList.toggle(`is-far`,Math.abs(n)>2),e.setAttribute(`aria-hidden`,n!==0)}),E(`[data-deck-prev]`).disabled=j===0,E(`[data-deck-next]`).disabled=j===A.length-1,ve.textContent=`${j+1} / ${A.length}`;for(let e of T)qe(e);if(Ge(e),e.type===`cue`){let t=E(`img`,e.node);t.complete&&t.naturalWidth&&We(t)}Bn()}function Hn(e){let t=Math.min(A.length-1,Math.max(0,e)),n=matchMedia(`(prefers-reduced-motion: reduce)`).matches?`auto`:`smooth`;ge.children[t].scrollIntoView({behavior:n,block:`start`})}function Un(e){if(e.key===`Escape`&&Ae){e.preventDefault(),Bn();return}let t={ArrowLeft:-1,ArrowRight:1}[e.key];t&&(e.target instanceof Element&&e.target.closest(`[role="slider"], input`)||R?.keyboard||(e.preventDefault(),Hn(j+t)))}var Wn=e=>document[e?`addEventListener`:`removeEventListener`](`keydown`,Un,!0);function Gn(e){Bn(),Ae=e,jn(e);let t=E(`[data-band-item="${e}"]`,D),n=E(`[data-tints]`,t),r=P().colors[e],[i,a,o]=c(r);me(`[data-tint]`,n).forEach((e,t)=>{let n=t-3,c=n<0?i+(.96-i)*(-n/3):i-(i-.16)*(n/3),l=n===0?r:s([c,a*(1-Math.abs(n)/3*.3),o]);e.dataset.tint=l,e.style.setProperty(`--tint-color`,l),e.setAttribute(`aria-label`,l),e.toggleAttribute(`data-current`,n===0)}),n.hidden=!1,t.dataset.tintOpen=``;let l=E(`[data-edit-tints="${e}"]`,D);l.setAttribute(`aria-expanded`,`true`),l.dataset.tip=`Close tints`,E(`button`,n)?.focus()}var Kn=220,qn=1.02,Jn=getComputedStyle(document.documentElement).getPropertyValue(`--ks-ease`).trim()||`ease`,Yn=new Set([` `,`Enter`,`ArrowLeft`,`ArrowRight`,`Home`,`End`,`Escape`]),Xn=new WeakMap,Zn=E(`.picker-bands`,D),Qn=document.querySelector(`[data-band-scope="strategy"]`),$n=document.querySelector(`.picker-screen[data-screen="03"] .picker-strategy-grid`),er=()=>matchMedia(`(prefers-reduced-motion: reduce)`).matches,tr=e=>T.map(t=>E(`[data-band="${t}"]`,e)),nr=e=>T.map(t=>E(`[data-grip="${t}"]`,e)),rr=(e,t)=>E(`[data-band-item="${T[e]}"] .picker-band-foot h2`,t).textContent,ir=(e,t)=>{let n=E(`[data-reorder-status]`,e.closest(`.picker-screen`)??e);n&&(n.textContent=t)},R=null,ar=null;function or(e,t){let n=T.map((e,t)=>t);return n.splice(t,0,...n.splice(e,1)),n}function sr(e,t,n,r){e.style.transform=n?`translateX(${n}px)`:``,Xn.get(e)?.cancel(),r&&Xn.set(e,e.animate([{transform:`translateX(${t}px)`},{transform:`translateX(${n}px)`}],{duration:Kn,easing:Jn}))}function cr(e,t){let n=R.nodes[R.from],r=R.offsets[R.from],i=e=>`translateX(${e}px) scale(${qn})`;R.offsets[R.from]=e,n.style.transform=i(e),Xn.get(n)?.cancel(),t&&Xn.set(n,n.animate([{transform:i(r)},{transform:i(e)}],{duration:Kn,easing:Jn}))}function lr(e,t){or(R.from,e).forEach((e,n)=>{if(e===R.from)return;let r=R.homes[n].left-R.homes[e].left;r!==R.offsets[e]&&(sr(R.nodes[e],R.offsets[e],r,t),R.offsets[e]=r)}),R.to=e}function ur(e){let{homes:t,from:n}=R,r=t[n].left+t[n].width/2+e,i=e=>Math.abs(t[e].left+t[e].width/2-r);return t.reduce((e,t,n)=>i(n)<i(e)?n:e,0)}function dr(e,t,n){let r=P(),i={},a={},o={};or(e,t).forEach((e,t)=>{let n=T[t],s=T[e];i[n]=r.colors[s],a[n]=r.detached[s],o[n]=r.rings[s]}),Object.assign(r,{colors:i,detached:a,rings:o}),Vn(),n!==Zn&&fr()}function fr(){if(E(`[name="palette-source"]`).value){for(let e of T)E(`[name="palette-${e}"]`).value=P().colors[e];hr(),Br();for(let e of document.querySelectorAll(`.picker-screen[data-active] [data-artboard]`))Ye(e)}}var pr=E(`[data-contrast-alert]`,Qn),mr=E(`[data-contrast-tip]`,Qn);function hr(){let e=ze(e=>E(`[name="palette-${e}"]`).value);if(!Object.values(e).some(e=>!e)){for(let t of T){let n=E(`[data-band="${t}"]`,Qn);n.style.setProperty(`--band-color`,e[t]),n.style.setProperty(`--band-ink`,p(e[t])),E(`output`,n).textContent=e[t]}Pn(pr,mr,b(e))}}function gr(){let e=$n?.parentElement;if(!e||!e.offsetParent)return;let t=`${Math.ceil(e.getBoundingClientRect().height-$n.getBoundingClientRect().height)}px`;e.style.getPropertyValue(`--pk-chrome`)!==t&&e.style.setProperty(`--pk-chrome`,t)}$n&&new ResizeObserver(gr).observe($n.parentElement);function _r(e,t){let{colors:n}=P();return or(e,t).map((e,t)=>`${T[t]} ${n[T[e]]}`).join(`, `)}function vr(e,t,n){R&&yr(!0),ar?.(),Bn();let r=tr(n);for(let e of r)Xn.get(e)?.cancel(),e.style.transform=``;R={from:e,to:e,keyboard:t,scope:n,nodes:r,grips:nr(n),homes:r.map(e=>e.getBoundingClientRect()),offsets:T.map(()=>0),id:N().id,pointerId:null,startX:0},r[e].dataset.dragging=``,R.grips[e].dataset.dragging=``,cr(0,!1)}function yr(e,t){let{nodes:n,grips:r,from:i,to:a,homes:o,id:s,scope:c}=R,l=e?0:o[a].left-o[i].left;if(e&&lr(i,!er()),R=null,delete n[i].dataset.dragging,delete r[i].dataset.dragging,ar=()=>{ar=null,!e&&a!==i&&N().id===s&&dr(i,a,c);for(let e of n)Xn.get(e)?.cancel(),e.style.transform=``;t?.()},er()){ar();return}let u=n[i],d=u.style.transform,f=`translateX(${l}px) scale(1)`;u.style.transform=f;let p=u.animate([{transform:d},{transform:f}],{duration:Kn,easing:Jn});Xn.set(u,p),p.finished.then(()=>ar?.(),()=>{})}function br(e){let{from:t,to:n,scope:r}=R;if(n===t){yr(!0);return}let i=`Palette reordered. ${_r(t,n)}`;yr(!1,e?()=>nr(r)[n].focus():null),ir(r,i)}var xr=e=>e instanceof Element?e.closest(`[data-grip]`):null,Sr=e=>e.closest(`.picker-bands`);function Cr(e){e.addEventListener(`pointerdown`,e=>{let t=xr(e.target);!t||e.button!==0||!A.length||(e.preventDefault(),vr(T.indexOf(t.dataset.grip),!1,Sr(t)),R.pointerId=e.pointerId,R.startX=e.clientX,t.setPointerCapture(e.pointerId))}),e.addEventListener(`pointermove`,e=>{if(!R||R.keyboard||e.pointerId!==R.pointerId)return;let{homes:t,from:n}=R,r=Math.min(t.at(-1).left-t[n].left,Math.max(t[0].left-t[n].left,e.clientX-R.startX));cr(r,!1);let i=ur(r);i!==R.to&&lr(i,!er())}),e.addEventListener(`pointerup`,e=>{!R||R.keyboard||e.pointerId!==R.pointerId||br(!1)}),e.addEventListener(`pointercancel`,e=>{!R||R.keyboard||e.pointerId!==R.pointerId||yr(!0)}),e.addEventListener(`keydown`,e=>{let t=xr(e.target);if(!t||!Yn.has(e.key)||!A.length)return;let n=Sr(t),r=!!R?.keyboard,i=e.key===` `||e.key===`Enter`;if(!r&&(R||!i))return;if(e.preventDefault(),!r){vr(T.indexOf(t.dataset.grip),!0,n),ir(n,`${rr(R.from,n)} color lifted, position ${R.from+1} of ${T.length}. Arrow keys move it, space drops it, escape puts it back.`);return}if(i){br(!0);return}if(e.key===`Escape`){yr(!0),ir(n,`Reorder cancelled.`);return}let a={ArrowLeft:-1,ArrowRight:1,Home:-T.length,End:T.length}[e.key],o=Math.min(T.length-1,Math.max(0,R.to+a));o!==R.to&&(lr(o,!er()),cr(R.homes[o].left-R.homes[R.from].left,!er()),ir(n,`Position ${o+1} of ${T.length}.`))}),e.addEventListener(`focusout`,e=>{if(!R?.keyboard||e.target!==R.grips[R.from])return;let t=R.scope;yr(!0),ir(t,`Reorder cancelled.`)})}Cr(D),Cr(Qn),D.onpointerover=D.onfocusin=({target:e})=>{let t=e.closest(`[data-band]`);t&&jn(t.dataset.band)},D.oninput=({target:e})=>{e.matches(`[data-color-input]`)&&In(e.dataset.colorInput,e.value)},D.onclick=async e=>{let t=e.target.closest(`button`)?.dataset;if(t){if(t.copyColor){let e=P().colors[t.copyColor];await navigator.clipboard.writeText(`${e}\n${l(e)}`);let n=t.tip;t.tip=`Copied`,setTimeout(()=>t.tip=n,1200)}else if(t.editTints)Ae===t.editTints?Bn():Gn(t.editTints);else if(t.customColor)E(`[data-color-input="${t.customColor}"]`,D).click();else if(t.tint)In(Ae,t.tint);else if(`closeTints`in t)Bn();else if(`reset`in t){let e=N(),t=Ue(e);e.type===`cue`&&e.defaultRings&&(t.rings=structuredClone(e.defaultRings)),k.set(e.id,t),Vn()}else if(`selectPalette`in t){let e=N();E(`[name="palette-source"]`).value=e.id;for(let e of T)E(`[name="palette-${e}"]`).value=P().colors[e];hr(),Br()}}},E(`[data-select-palette]`).addEventListener(`click`,D.onclick),E(`[data-deck-prev]`).onclick=()=>Hn(j-1),E(`[data-deck-next]`).onclick=()=>Hn(j+1);function wr(){let e=ge.firstElementChild?.offsetHeight||0;if(!e)return!1;let t=j*e;return Math.abs(he.scrollTop-t)>1&&(he.scrollTop=t),!0}he.addEventListener(`scroll`,()=>{let e=ge.firstElementChild?.offsetHeight||1,t=Math.min(A.length-1,Math.round(he.scrollTop/e));if(t!==j){let e=N().node;e.dataset.exit=t>j?`left`:`right`,setTimeout(()=>delete e.dataset.exit,280),j=t,delete N().node.dataset.exit,Vn()}},{passive:!0}),document.addEventListener(`picker:screenchange`,e=>{Wn(e.detail.screen===`02`),e.detail.screen===`02`&&wr(),e.detail.screen===`04b`&&ti();let t=document.querySelector(`.picker-screen[data-screen="${e.detail.screen}"]`);for(let e of t?.querySelectorAll(`[data-artboard]`)??[])Ye(e);e.detail.screen===`03`&&(hr(),gr());let n=Lr.find(t=>t.screen===e.detail.screen);if(n?.paint(),Rr(n),e.detail.screen===`04`&&(mt=!1,vt({force:!0})),e.detail.screen===`06`&&requestAnimationFrame(()=>{dn(),an(),tn=null,nn(en())}),e.detail.screen===`05`){kt();let e=Et();requestAnimationFrame(()=>{e?.parentElement.scrollIntoView({block:`center`}),e?.focus({preventScroll:!0}),e&&At(e),Nt()})}e.detail.screen===`11`&&(qt(),requestAnimationFrame(()=>{Ht()?.parentElement.scrollIntoView({block:`center`})}))});var z=[...document.querySelectorAll(`input[name="surface-modes"]`)],Tr=document.querySelector(`[data-modes-next]`),Er=()=>{Tr&&(Tr.disabled=!z.some(e=>e.checked))},Dr=z.map(e=>e.closest(`.picker-mode-tile`)),Or=Dr.map(e=>e?.querySelector(`.picker-preview`)),kr=Se.cloneNode(!0),Ar;function jr(){zr();let e=z.findIndex(e=>e.checked);Dr.forEach((t,n)=>{t?.toggleAttribute(`data-lead`,n===e&&!!Or[n])});let t=(e===-1?null:Or[e])??kr;if(t===Ar)return;Ar=t;let n=t.cloneNode(!0);n.setAttribute(`aria-hidden`,`true`);for(let e of[n,...n.querySelectorAll(`[id]`)])e.removeAttribute(`id`);Se.replaceWith(n),Se=n,Je()}var Mr=()=>z.filter(e=>e.checked),Nr=e=>z.find(t=>t.value===e),Pr=document.querySelector(`input[name="_chosen"]`);function Fr(){if(!Pr)return;let e=[...document.querySelectorAll(`input[type="hidden"][data-surface-field][data-chosen="yes"]`)].filter(e=>!e.disabled).map(e=>e.dataset.surfaceField);Pr.value=JSON.stringify(e)}function Ir(e){let t=e.dataset.surfaceTabs,n=e.parentElement,r=e.closest(`.picker-screen`)?.dataset.screen,i=`surfaceStage`in n.dataset,a=`surfaceFlat`in e.dataset,o=`surfaceProperName`in e.dataset,s=()=>[...document.querySelectorAll(`input[name="${t}"]`)],c=e=>s().find(t=>t.value===e)?.closest(`.picker-strategy-option`),l=e=>{let n=Nr(e)?.getAttribute(`data-allow-${t}`);return n==null?null:new Set(n.split(` `).filter(Boolean))},u=e=>Nr(e)?.getAttribute(`data-default-${t}`)||s()[0]?.value,d=e=>document.querySelector(`input[type="hidden"][data-surface-field="${t}-${e}"]`),f=e=>c(e)?.querySelector(`.picker-strategy-title`)?.textContent??e,p=e=>!!d(e),m=()=>Mr().filter(e=>p(e.value)),h=z.some(e=>!p(e.value)),g=e.closest(`.picker-screen`),_=null;function v(e){for(let e of n.querySelectorAll(`[data-surface]:not([data-artboard])`))e.remove();for(let t of e){if(n.querySelector(`[data-artboard][data-surface="${t.value}"]`))continue;let e=Or[z.indexOf(t)];if(!e)continue;let r=e.cloneNode(!0);r.setAttribute(`aria-hidden`,`true`);for(let e of[r,...r.querySelectorAll(`[id]`)])e.removeAttribute(`id`);r.dataset.surface=t.value,n.append(r)}y()}function y(){i&&Ye(n,`pkc`)}function b(){let e=m();if(h){g?.toggleAttribute(`data-skip`,e.length===0);for(let t of s())t.disabled=e.length===0}i&&v(e);for(let e of z){let t=d(e.value);t&&(t.disabled=!e.checked,e.checked?t.value||=u(e.value)??``:(t.value=``,delete t.dataset.chosen))}ee(e),S(e.some(e=>e.value===_)?_:e[0]?.value)}function ee(t){e.hidden=t.length<2,e.replaceChildren(...t.map(e=>{let t=document.createElement(`button`);return t.type=`button`,t.className=`picker-surface-tab`,t.dataset.surfaceTab=e.value,t.innerHTML=`<span class="picker-surface-dot"></span>`,t.append(e.dataset.surfaceLabel??e.value),t.onclick=()=>te(e.value),t})),x()}function x(){for(let t of e.children){let n=t.dataset.surfaceTab,r=d(n),i=!!r?.dataset.chosen,a=n===_,s=r.value?f(r.value):``,c=t.textContent;t.dataset.set=i?`yes`:`no`,t.setAttribute(`aria-pressed`,a?`true`:`false`),t.tabIndex=a?0:-1;let l=s&&e.dataset.surfaceAnswered.replace(`{}`,o?s:s.toLowerCase());t.setAttribute(`aria-label`,s?`${c}, ${l}${i?``:` by default`}`:`${c}, ${e.dataset.surfaceUnanswered}`)}}function S(e){if(!e)return;_=e;for(let t of n.querySelectorAll(`[data-surface]`))t.hidden=t.dataset.surface!==e;ne();let t=d(e)?.value||u(e),r=s().find(e=>e.value===t);r&&(r.checked=!0),x()}function te(e){S(e),Rr(C)}function ne(){let e=l(_);for(let t of s()){let n=t.closest(`.picker-strategy-option`);if(!n)continue;let r=!e||e.has(t.value),i=n.querySelector(`.picker-strategy-desc`);i.dataset.copy??=i.textContent,i.textContent=r?i.dataset.copy:n.dataset.blockedReason??i.dataset.copy,n.classList.toggle(`is-blocked`,!r),t.disabled=!r}}document.addEventListener(`change`,({target:e})=>{e?.name!==t||!e.checked||re(e.value)});function re(e){let t=a?m().map(e=>e.value):[_];for(let n of t){let t=d(n),r=l(n);!t||r&&!r.has(e)||(t.value=e,t.dataset.chosen=`yes`)}x(),Fr()}e.addEventListener(`keydown`,t=>{let n={ArrowLeft:-1,ArrowRight:1}[t.key];if(!n)return;let r=[...e.children],i=r[(r.findIndex(e=>e.dataset.surfaceTab===_)+n+r.length)%r.length];t.preventDefault(),te(i.dataset.surfaceTab),i.focus()});let C={screen:r,sync:b,paint:y,park:e=>S(p(e)?e:m()[0]?.value),active:()=>_};return C}var Lr=[...document.querySelectorAll(`[data-surface-tabs]`)].map(Ir);function Rr(e){for(let t of Lr)t!==e&&t.park(e?.active())}var zr=()=>{for(let e of Lr)e.sync();Fr()},Br=()=>{for(let e of Lr)e.paint()},Vr=document.querySelector(`.picker-screen[data-screen="04b"]`),Hr={"06":`motion-energy`,"08":`boundary-style`,"09":`corner-style`,10:`depth-style`,11:`icon-pack`},Ur=e=>z.find(t=>t.value===e)?.dataset.surfaceLabel??e;function Wr(e,t){let n=document.querySelector(`input[name="${e}"][value="${t}"]`);return n?n.dataset.scaleName?`${n.dataset.scaleName} · ${n.dataset.ratio}`:n.dataset.packName?n.dataset.packName:n.closest(`.picker-strategy-option`)?.querySelector(`.picker-strategy-title`)?.textContent.trim()??t:t}function Gr(e){return[...document.querySelectorAll(`input[type="hidden"][data-surface-field^="${e}-"]`)].filter(e=>!e.disabled&&e.value).map(t=>({mode:t.dataset.surfaceField.slice(e.length+1),value:t.value,chosen:t.dataset.chosen===`yes`}))}function Kr(e){let t=document.createElement(`span`);return t.className=`picker-hub-line`,t.append(e),t}function qr(e,t){let n=document.querySelector(`input[name="${e}"][value="${t}"]`)?.closest(`.picker-strategy-option`)?.querySelector(`.picker-strategy-desc`);return n?(n.dataset.copy??n.textContent).trim():``}var Jr={strategy:`color-strategy`,boundary:`boundary-style`,corner:`corner-style`,depth:`depth-style`,layout:`layout-structure`};function Yr(e){let t={surface:e};for(let[n,r]of Object.entries(Jr))t[n]=document.querySelector(`input[type="hidden"][data-surface-field="${r}-${e}"]`)?.value||document.querySelector(`input[name="${r}"]:checked`)?.value||``;return t}function Xr(e,t=null){let n=document.createElement(`span`);if(n.className=`picker-hub-proof`,t){n.classList.add(`dcx-proof--board`);for(let[e,r]of Object.entries(t))r&&n.setAttribute(`data-dcx-${e}`,r);Ye(n,`pkc`)}let r=e.cloneNode(!0);r.hidden=!1,r.removeAttribute(`data-surface`);for(let e of[r,...r.querySelectorAll(`[id]`)])e.removeAttribute(`id`);for(let e of[r,...r.querySelectorAll(`[data-icon-field], [data-icon-strip]`)])e.removeAttribute(`data-icon-sheet`),e.removeAttribute(`data-icon-field`),e.removeAttribute(`data-icon-strip`);return n.append(r),n}var Zr=(e,t)=>{let n=[...document.querySelectorAll(`.picker-screen[data-screen="${e}"] .picker-board-stage > :is(.picker-artboard, .picker-preview)[data-surface="${t}"]`)];if(n.length<2)return n[0]??null;let r=document.querySelector(`.picker-screen[data-screen="${e}"] [data-surface-tabs]`)?.dataset.surfaceTabs,i=r&&document.querySelector(`input[type="hidden"][data-surface-field="${r}-${t}"]`)?.value;return n.find(e=>e.dataset.motionCell===`${t}-${i}`)??n[0]};function Qr(e){let t=e.querySelector(`[data-hub-preview]`);if(!t||t.classList.contains(`picker-hub-preview--icons`))return;let n=t.firstElementChild,r=n?.querySelector(`.ps-desktop, .pv-desktop`)??n?.firstElementChild,i=t.clientWidth,a=t.clientHeight;if(!i||!a||!r?.offsetWidth||!r.offsetHeight)return;let o=Math.min(i/r.offsetWidth,a/r.offsetHeight);e.style.setProperty(`--pk-hub-scale`,o),e.style.setProperty(`--pk-hub-x`,`${(i-r.offsetWidth*o)/2}px`),e.style.setProperty(`--pk-hub-y`,`${(a-r.offsetHeight*o)/2}px`)}function $r(e,t,n,r){let i=e.querySelector(`[data-hub-preview]`);if(i.classList.toggle(`picker-hub-preview--icons`,n===`icon-pack`),n===`icon-pack`){i.replaceChildren(Xr(Lt)),!It.querySelector(`.picker-icon-cell`)&&!(`empty`in It.dataset)&&qt().then(ti);return}let a=r?Zr(t,r):null;if(!a){i.replaceChildren();return}if(n===`motion-energy`){Lr.find(e=>e.screen===t)?.park(r);let n=Xr(a);Ye(n.firstChild),i.replaceChildren(n),requestAnimationFrame(()=>{an(n.firstChild),Qr(e)})}else i.replaceChildren(Xr(a,Yr(r)));Qr(e)}function ei(e){let t=e.querySelector(`[data-hub-target]`),n=t?.dataset.hubTarget,r=Hr[n];if(!r)return;let i=e.querySelector(`[data-hub-preview]`),a=e.querySelector(`[data-hub-note]`),o=e.querySelector(`[data-hub-slider]`),s=e.querySelector(`[data-hub-slider-label]`),c=!!document.querySelector(`.picker-screen[data-screen="${n}"]`)?.hasAttribute(`data-skip`);if(e.classList.toggle(`is-skipped`,c),t.disabled=c,t.setAttribute(`aria-disabled`,c?`true`:`false`),c){i.replaceChildren(),a.replaceChildren(Kr(`Not asked of these surfaces`)),a.hidden=!1,o.hidden=!0;return}let l=Gr(r),u=l.map(e=>e.mode),d=u.includes(e.dataset.hubSurface)?e.dataset.hubSurface:u[0];e.dataset.hubSurface=d??``;let f=d?l.find(e=>e.mode===d)?.value:document.querySelector(`input[name="${r}"]:checked`)?.value,p=f?qr(r,f):``;a.textContent=p,a.hidden=!p;let m=document.createElement(`span`);m.className=`picker-hub-slider-value`,m.textContent=f?Wr(r,f):``,s.replaceChildren(...d?[`${Ur(d)} · `,m]:[m]),o.hidden=!1;for(let e of o.querySelectorAll(`[data-hub-step]`))e.hidden=u.length<2;$r(e,n,r,d)}function ti(){if(Vr)for(let e of Vr.querySelectorAll(`.picker-hub-card`))ei(e)}function ni(e,t){let n=Hr[(e?.querySelector(`[data-hub-target]`))?.dataset.hubTarget];if(!n)return;let r=Gr(n).map(e=>e.mode);if(r.length<2)return;let i=r.indexOf(e.dataset.hubSurface);e.dataset.hubSurface=r[(i+t+r.length)%r.length],ei(e)}Vr?.addEventListener(`click`,e=>{let t=e.target.closest(`[data-hub-step]`);if(t){ni(t.closest(`.picker-hub-card`),Number(t.dataset.hubStep));return}let n=e.target.closest(`[data-hub-target]`);!n||n.disabled||document.dispatchEvent(new CustomEvent(`picker:goto`,{detail:{screen:n.dataset.hubTarget}}))}),Vr?.addEventListener(`keydown`,e=>{let t={ArrowLeft:-1,ArrowRight:1}[e.key];!t||!e.target.closest(`[data-hub-slider]`)||(e.preventDefault(),ni(e.target.closest(`.picker-hub-card`),t))}),Vr&&window.ResizeObserver&&new ResizeObserver(()=>{for(let e of Vr.querySelectorAll(`.picker-hub-card`))Qr(e)}).observe(Vr);for(let e of z)e.addEventListener(`change`,()=>{Er(),jr()});Er(),jr();try{let e=e=>fetch(e).then(e=>e.ok?e.json():Promise.reject()),[t,n,r]=await Promise.all([e(`/cues.json`),e(`/palettes.json`),fetch(`/context.json`).then(e=>e.ok?e.json():null).catch(()=>null)]),i=Array.isArray(r?.modes)?r.modes:t.modes;if(Array.isArray(i)){let e=new Set(i);if(z.some(t=>e.has(t.value))){for(let t of z)t.checked=e.has(t.value);Er(),jr()}}A=[...t.cues.map(e=>({id:e,type:`cue`,palette:t.palette[e]})),...n.seeds.map(e=>({...e,type:`seed`}))];for(let e of A)k.set(e.id,Ue(e));_e.append(...A.map(zn)),ge.innerHTML=`<div class="picker-snap-point"></div>`.repeat(A.length),E(`[data-select-palette]`).disabled=!1,Vn(),Wn(pe.hasAttribute(`data-active`))}catch{ve.textContent=`Palette sources could not be loaded.`}var ri=Re,ii=!0;try{let e=await fetch(`/fonts.json`),t=e.ok?await e.json():null;Qe(t)&&(ri=Ze(t),ii=!1)}catch{}ot(ri,ii);var ai=await x();try{oe(ai.prior,{modeInputs:z,syncModes:()=>{Er(),jr()},states:k,cards:A,setCurrent:e=>{j=e},render:Vn,syncDeckScroll:wr,fontManifest:()=>je,pairNodes:()=>[...rt],addPairCard:it,removePairCard:at,loadCustomFace:An,syncFontPair:nt,applyHoist:vt,syncChosenField:Fr})}catch{}ne(ai.prior?ai.priorSource:null);var B=(e,t=document)=>t.querySelector(e),oi=(e,t=document)=>[...t.querySelectorAll(e)],V=B(`#picker-form`),si=B(`[data-dcx-shell]`),ci=null,li=null,ui=null,di=null,fi=e=>fetch(e).then(e=>e.ok?e.json():null).catch(()=>null),pi=fi(`/cues.json`).then(e=>(ui=e?.palette||null,di=Array.isArray(e?.cues)?e.cues:null,e)),mi=Promise.all([fi(`/context.json`),pi]).then(([e,t])=>{ci=e?.context??t?.context??null;let n=Array.isArray(e?.modes)?e.modes:t?.modes;li=Array.isArray(n)?n:null}),hi=!1,gi=e=>hi?`/cue.png`:`/cues/${encodeURIComponent(e)}.png`,_i=(e,t)=>{let n=ui?.[e]?.[t];return n?String(n.snapped||n.hex||``).toUpperCase():``},vi=[`primary`,`secondary`,`tertiary`,`neutral`],yi=[`persuade`,`operate`,`read`,`experience`],bi={persuade:`Landing page`,operate:`Tool`,read:`Docs`,experience:`Portfolio`},H=e=>{let t=V.elements[e];return t&&typeof t.value==`string`?t.value:``};function xi(e,t){let n=V.querySelector(`input[name="${e}"][value="${t}"]`)?.closest(`label`);if(!n)return{title:t,desc:``};let r=n.querySelector(`.picker-strategy-title, .picker-icon-title`),i=n.querySelector(`.picker-strategy-desc, .picker-icon-meta`);return{title:(r?.textContent||t).replace(/^[\d.]+\s*/,``).trim(),desc:(i?.textContent||``).trim()}}function Si(){return oi(`input[name="surface-modes"]:checked`,V).sort((e,t)=>yi.indexOf(e.value)-yi.indexOf(t.value)).map(e=>{let t=e.closest(`.picker-mode-tile`);return{mode:e.value,label:e.dataset.surfaceLabel||e.value,goal:t?.querySelector(`.picker-mode-goal`)?.textContent.trim()||``,examples:oi(`.picker-mode-pills i`,t||V).map(e=>e.textContent.trim())}})}function Ci(e,t){return t.flatMap(t=>{let n=V.querySelector(`input[data-surface-field="${e}-${t.mode}"]`);if(!n)return[];let r=n.value||H(e);return[{...t,value:r,chosen:n.dataset.chosen===`yes`,...xi(e,r)}]})}function wi(e,t){let[n]=Ci(e,t);return n??{value:``,title:``,desc:``}}function Ti(){let e=Si(),t=vi.map(e=>({role:e[0].toUpperCase()+e.slice(1),hex:H(`palette-${e}`).toUpperCase()})).filter(e=>e.hex),n=V.querySelector(`input[name="type-scale"]:checked`),r=V.querySelector(`input[name="font-pair"]:checked`)?.closest(`.picker-type-option`);return{context:ci,suggestedModes:li,cueSlugs:di,surfaces:e,palette:t,paletteSource:H(`palette-source`),strategy:Ci(`color-strategy`,e),boundaries:Ci(`boundary-style`,e),corners:Ci(`corner-style`,e),depth:Ci(`depth-style`,e),motion:Ci(`motion-energy`,e),layout:wi(`layout-structure`,e),fonts:{heading:H(`font-heading`),body:H(`font-body`),headingSource:H(`font-heading-source`),bodySource:H(`font-body-source`),why:r?.querySelector(`[data-pair-why]`)?.textContent.trim()||``},scale:{name:n?.dataset.scaleName||``,ratio:Number(H(`type-scale-ratio`)||n?.dataset.ratio||0),desc:n?xi(`type-scale`,n.value).desc:``},icons:{pack:H(`icon-pack-name`),license:H(`icon-pack-license`),url:H(`icon-pack-url`)}}}var U=e=>String(e).replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`),W=(e,t,n,r)=>`
  <header>
    <span class="dcx-eyebrow">Design context &middot; 0${e} / 08${r?` &middot; ${U(r)}`:``}</span>
    <h2 class="dcx-title">${U(t)}</h2>
    <p class="dcx-lede">${U(n)}</p>
  </header>`,G=(e,t)=>`
  <div class="dcx-block" data-label="${U(e)}">
    <span class="dcx-block-label">${U(e)}</span>
    ${t}
  </div>`,Ei=e=>`
  <dl class="dcx-defs">${e.map(({dt:e,dd:t})=>`
    <div class="dcx-def"><dt>${e}</dt><dd>${t}</dd></div>`).join(``)}
  </dl>`,K=(e,t,n=!1,r=``)=>`
  <div class="dcx-callout${n?` dcx-callout--accent`:``}">
    <p class="dcx-callout-name">${U(e)}</p>
    <p>${t}</p>${r}
  </div>`,Di=e=>`
  <ul class="dcx-list">${e.map(e=>`<li>${e}</li>`).join(``)}</ul>`,Oi=e=>`
  <ol class="dcx-principles">${e.map(e=>e&&typeof e==`object`&&e.title?`<li><strong>${U(e.title)}</strong>${e.detail?` &mdash; ${U(e.detail)}`:``}</li>`:`<li>${U(e)}</li>`).join(``)}</ol>`,ki=e=>`
  <div class="dcx-chips">${e.map(e=>`<span class="dcx-chip dcx-chip--muted">${U(e)}</span>`).join(``)}</div>`,Ai=(e,t)=>`
  <div class="dcx-empty">
    <p class="dcx-empty-title">${U(e)}</p>
    <p>${t}</p>
  </div>`,q=e=>`<p class="dcx-fan-note">${e}</p>`,ji=(e,t)=>Ai(`Captured in chat`,`${e} in chat, before the browser questionnaire. ${t} is the durable copy.`),Mi=e=>Y?`${Y.base}/brand-assets/${encodeURIComponent(e)}?token=${encodeURIComponent(Y.token)}`:`/brand-assets/${encodeURIComponent(e)}`;document.addEventListener(`load`,e=>{let t=e.target;if(!(t instanceof HTMLImageElement)||!(`dcxCueImg`in t.dataset))return;let n=t.closest(`.dcx-cue-frame`);n&&(n.style.setProperty(`--cue-w`,String(t.naturalWidth||1)),n.style.setProperty(`--cue-h`,String(t.naturalHeight||1)),n.dataset.loaded=`yes`)},!0),document.addEventListener(`error`,e=>{let t=e.target;if(!(t instanceof HTMLImageElement))return;let n=t.closest(`[data-dcx-hide-on-error]`);n&&(n.hidden=!0)},!0);function Ni(e){let[t,n,r]=[1,3,5].map(t=>parseInt(e.slice(t,t+2),16)/255);return .2126*t+.7152*n+.0722*r>.55?`oklch(20% 0.01 95)`:`oklch(95% 0.005 95)`}function Pi(e){let t={};for(let e of vi)t[e]=H(`palette-${e}`);if(Object.values(t).some(e=>!e))return;let n=(t,n)=>e.style.setProperty(`--pkc-${t}`,n);for(let e of vi)n(e,t[e]);n(`n-ink`,p(t.neutral)),n(`p-ink`,p(t.primary)),n(`t-ink`,p(t.tertiary)),n(`p-on-n`,_(t.primary,t.neutral)),n(`t-on-n`,_(t.tertiary,t.neutral)),n(`t-on-p`,_(t.tertiary,t.primary)),n(`p-on-p`,_(t.primary,t.primary)),n(`t-on-t`,_(t.tertiary,t.tertiary)),n(`p-on-i`,_(t.primary,m(t.primary)))}function J(e,{strategy:t=``,kind:n=`board`,marks:r=null}={}){if(!e)return``;let i=e.cloneNode(!0);i.hidden=!1,i.removeAttribute(`data-surface`);for(let e of[i,...i.querySelectorAll(`[id]`)])e.removeAttribute(`id`);for(let e of oi(`button, input`,i))e.setAttribute(`tabindex`,`-1`),e.setAttribute(`disabled`,``);let a=document.createElement(`div`);if(a.className=`dcx-proof dcx-proof--${n}`,a.setAttribute(`aria-hidden`,`true`),t&&(a.dataset.dcxStrategy=t),r)for(let[e,t]of Object.entries(r))t&&a.setAttribute(`data-dcx-${e}`,t);return Pi(a),a.appendChild(i),a.outerHTML}var Fi=e=>B(`[data-surface-stage] [data-surface="${e}"]`),Ii=e=>B(`input[name="surface-modes"][value="${e}"]`)?.closest(`.picker-mode-tile`)?.querySelector(`.picker-preview`),Li=e=>B(`[data-question="boundaries"] .picker-board-stage > :is(.picker-artboard, .picker-preview)[data-surface="${e}"]`),Ri=(e,t)=>({surface:t,boundary:e.boundaries.find(e=>e.mode===t)?.value||``,corner:e.corners.find(e=>e.mode===t)?.value||``,depth:e.depth.find(e=>e.mode===t)?.value||``,layout:e.layout.value||``}),zi=e=>Ei(e.map(e=>({dt:U(e.label),dd:`<strong>${U(e.title)}</strong> &middot; ${U(e.desc)}${e.chosen?``:` <em>(default for this surface)</em>`}`})));function Bi(e,t){let n=e.context?.audience||{},r=[W(1,`Audience`,`Who it is for, emotional state, needs, trust triggers.`,t)],i=[n.primary&&{dt:`Primary`,dd:U(n.primary)},n.secondary&&{dt:`Secondary`,dd:U(n.secondary)}].filter(Boolean);if(r.push(G(`Who they are`,i.length?Ei(i):ji(`The primary and secondary user read was confirmed`,`<code>PRODUCT.md &middot; Users</code>`))),n.emotion||n.leaving){let e=n.emotion?K(`On arrival`,U(n.emotion),!0):``,t=n.leaving?K(`Leaving with`,U(n.leaving),!0):``;e&&t?r.push(G(`Emotional journey`,`<div class="dcx-callout-pair">${e}${t}</div>`)):r.push(G(e?`Emotional state`:`Emotional journey`,e||t))}let a=Array.isArray(n.needs)&&n.needs.length?G(`Needs`,Di(n.needs.map(U))):``,o=Array.isArray(n.trust)&&n.trust.length?G(`Trust triggers`,Di(n.trust.map(U))):``;return a&&o?r.push(`<div class="dcx-cols">${a}${o}</div>`):(a||o)&&r.push(a||o),Array.isArray(n.inclusion)&&n.inclusion.length&&r.push(G(`Who must not be excluded`,Di(n.inclusion.map(U)))),r.join(``)}function Vi(e,t){return`<div class="dcx-surfaces" data-count="${e.surfaces.length}">${e.surfaces.map((e,n)=>`
    <article class="dcx-surface-card">
      ${J(Fi(e.mode)||Ii(e.mode),{kind:`board`})}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${U(e.label)}${n===0?` <span class="dcx-default-mark">leading</span>`:``}</h3>
        ${t(e)}
      </div>
    </article>`).join(``)}</div>`}function Hi(e){if(!Array.isArray(e.suggestedModes)||!e.suggestedModes.length)return``;let t=e.surfaces.map(e=>e.mode),n=new Set(e.suggestedModes),r=new Set(t),i=t=>e.surfaces.find(e=>e.mode===t)?.label||bi[t]||t,a=t.filter(e=>!n.has(e)),o=e.suggestedModes.filter(e=>!r.has(e)),s=`you kept the suggested set`;return a.length&&o.length?s=`you added ${a.map(i).join(`, `)} and dropped ${o.map(i).join(`, `)}`:a.length?s=`you added ${a.map(i).join(`, `)}`:o.length&&(s=`you dropped ${o.map(i).join(`, `)}`),q(`Suggested from <code>PRODUCT.md</code>: ${e.suggestedModes.map(i).join(`, `)}; ${s}.`)}var Ui={web:`Web`,ios:`iOS`,android:`Android`,adaptive:`Adaptive`};function Wi(e,t){let n=e.context?.product||{},r=[W(2,`Product`,`Purpose, surfaces, use cases, what must be clear first.`,t)],i=n.purpose?K(n.name||t||`This product`,U(n.purpose),!1,n.success?`\n    <p class="dcx-callout-success">${U(n.success)}</p>`:``):ji(`The purpose and success definition were confirmed`,`<code>PRODUCT.md &middot; Product Purpose</code>`),a=typeof n.platform==`string`&&n.platform.trim()?`<span class="dcx-chip dcx-platform-pill">${U(Ui[n.platform.trim()]||n.platform.trim())}</span>`:``;if(r.push(G(`Purpose`,a?`<div class="dcx-purpose"><div class="dcx-purpose-main">${i}</div>${a}</div>`:i)),n.positioning&&(n.positioning.not||n.positioning.this)){let e=[n.positioning.not&&K(`Not this`,U(n.positioning.not)),n.positioning.this&&K(`This`,U(n.positioning.this),!0)].filter(Boolean).join(``);r.push(G(`Positioning`,`<div class="dcx-callout-pair">${e}</div>`))}n.conversion&&r.push(G(`Primary conversion`,K(`The one action`,U(n.conversion),!0))),Array.isArray(n.clarities)&&n.clarities.length&&r.push(G(`What must be clear first`,Di(n.clarities.map(U)))),Array.isArray(n.principles)&&n.principles.length&&r.push(G(`Product principles`,Oi(n.principles))),n.operatingContext&&r.push(G(`Operating context`,`<p class="dcx-prose">${U(n.operatingContext)}</p>`));let o=n.surfaces&&typeof n.surfaces==`object`?n.surfaces:{};return r.push(G(`Surfaces`,Vi(e,e=>`
      <p class="dcx-surface-goal">${U((typeof o[e.mode]==`string`?o[e.mode].trim():``)||e.goal||``)}</p>
      ${e.examples.length?ki(e.examples):``}`)+Hi(e)+q(`Chosen on the questionnaire&rsquo;s first screen, drawn in the committed palette; the leading surface owns every bare answer key in the sections that follow.`))),r.join(``)}function Gi(e,t){let n=e.context?.brand||{},r=e.context?.interview||{},i=[W(3,`Brand`,`Identity, voice, references, taste boundaries.`,t)];i.push(G(`Personality`,n.personality?K(n.words?.join(` · `)||`Voice`,U(n.personality),!0):Array.isArray(n.words)&&n.words.length?K(n.words.join(` · `),`Three words, voice, and tone were confirmed in chat, before the browser questionnaire. <code>PRODUCT.md &middot; Brand Personality</code> is the durable copy.`,!0):ji(`Three words, voice, and tone were confirmed`,`<code>PRODUCT.md &middot; Brand Personality</code>`)));let a=(Array.isArray(n.voice)?n.voice:[]).filter(e=>e&&typeof e==`object`&&e.say&&e.not);if(a.length&&i.push(G(`Voice`,`<div class="dcx-voice">${a.map(e=>`
      <div class="dcx-voice-pair">
        <div class="dcx-voice-cell dcx-voice-cell--say"><span class="dcx-voice-tag">Say</span><p>${U(e.say)}</p></div>
        <div class="dcx-voice-cell dcx-voice-cell--not"><span class="dcx-voice-tag">Not</span><p>${U(e.not)}</p></div>
      </div>`).join(``)}</div>`+q(`Derived from Brand Personality and Brand Commitments in <code>PRODUCT.md</code>: wording to write with beside wording to refuse.`))),Array.isArray(n.principles)&&n.principles.length&&i.push(G(`Principles`,`<ol class="dcx-principles dcx-principles--cols">${n.principles.map(e=>`<li>${U(e)}</li>`).join(``)}</ol>`+q(`From <code>PRODUCT.md</code>&rsquo;s principles section; the durable copy lives there.`))),Array.isArray(n.commitments)&&n.commitments.length&&i.push(G(`Commitments`,Di(n.commitments.map(U)))),Array.isArray(r.references)&&r.references.length){let e=r.references.filter(e=>e&&typeof e==`object`&&e.name),t=r.references.filter(e=>typeof e==`string`),n=(e.length?`<div class="dcx-ref-cards">${e.map(e=>`
      <article class="dcx-ref-card">
        <h3 class="dcx-ref-name">${U(e.name)}</h3>${e.takeaway?`
        <p class="dcx-ref-takeaway">${U(e.takeaway)}</p>`:``}
      </article>`).join(``)}</div>`:``)+(t.length?ki(t):``);i.push(G(`Named references`,n+q(`Q4 of the seed interview: brands, products, printed objects &mdash; not adjectives.`)))}if(r.antiReference){let e=typeof r.antiReference==`object`?K(`Not this`,`<strong>${U(r.antiReference.name||``)}</strong>${r.antiReference.why?` &middot; ${U(r.antiReference.why)}`:``}`):K(`Not this`,U(r.antiReference));i.push(G(`Anti-reference`,e+q(`Q5 of the seed interview. A hard constraint on every palette and pair that followed.`)))}let o=Array.isArray(e.context?.assets)?e.context.assets:[],s=e=>!!e&&typeof e==`object`&&typeof e.file==`string`&&e.file,c=o.filter(s),l=o.filter(e=>!s(e)),u=c.filter(e=>e.kind===`logo`),d=c.filter(e=>e.kind!==`logo`),f=e=>`
      <figcaption class="dcx-asset-caption">
        <code>${U(e.file)}</code>${e.note?`
        <p>${U(e.note)}</p>`:``}
      </figcaption>`,p=t=>e.palette.find(e=>e.role===t)?.hex||``;return u.length&&i.push(G(`Marks`,`<div class="dcx-marks">${u.map(e=>`
      <figure class="dcx-mark" data-dcx-hide-on-error>
        <div class="dcx-mark-pair">
          <span class="dcx-mark-chip"${p(`Primary`)?` style="--chip-ground:${p(`Primary`)};"`:``}><img src="${Mi(e.file)}" alt="${U(e.file)} on the primary color" /></span>
          <span class="dcx-mark-chip"${p(`Neutral`)?` style="--chip-ground:${p(`Neutral`)};"`:``}><img src="${Mi(e.file)}" alt="${U(e.file)} on the neutral color" /></span>
        </div>
        ${f(e)}
      </figure>`).join(``)}</div>`+q(`Provided marks proofed on the committed primary and neutral grounds. The files are staged in <code>.impeccable/design-context/assets/</code>.`))),d.length&&i.push(G(`Boards and references`,`<div class="dcx-boards">${d.map(e=>`
      <figure class="dcx-board" data-dcx-hide-on-error>
        <span class="dcx-board-frame"><img src="${Mi(e.file)}" alt="${U(e.file)}" loading="lazy" /></span>
        ${f(e)}
      </figure>`).join(``)}</div>`+q(`Boards and reference images provided in chat, staged in <code>.impeccable/design-context/assets/</code>.`))),l.length&&i.push(G(`Assets provided`,Di(l.map(e=>U(typeof e==`string`?e:e.note||e.file||``)))+q(`Gathered before the interview; the questions were grounded in what they showed.`))),i.join(``)}var Ki={Primary:`Your main brand color: buttons, links, the color people remember.`,Secondary:`Supports the primary: section accents, hovers, secondary buttons.`,Tertiary:`The rare accent: badges, highlights, one detail per screen.`,Neutral:`Backgrounds and large surfaces: most of every page.`};function qi(e,t){let n=e.context?.interview||{},r=[W(4,`Color`,`Palette, roles, per-surface strategy, copyable values.`,t)],i=Array.isArray(e.cueSlugs)?e.cueSlugs:[],a=e.paletteSource&&(hi||i.includes(e.paletteSource))?e.paletteSource:``;if(a&&e.palette.length){let t=ui?.[a]||{},n=vi.map(e=>{let n=t[e];if(!n||!Array.isArray(n.at)||n.at.length!==2)return``;let r=String(n.snapped||n.hex||``);return`<span class="dcx-cue-dot" data-role="${e}" style="--at-x:${Number(n.at[0])||0}; --at-y:${Number(n.at[1])||0};${r?` --dot-fill:${U(r)};`:``}"></span>`}).join(``),o=e.palette.map(e=>`
      <div class="dcx-cue-role">
        <span class="dcx-cue-role-dot" style="--dot-fill:${e.hex};"></span>
        <span class="dcx-cue-role-name">${U(e.role)}</span>
        <code>${e.hex}</code>
        <code>${U(l(e.hex))}</code>
      </div>`).join(``);r.push(G(`The cue`,`<div class="dcx-cue" data-dcx-hide-on-error>
        <figure class="dcx-cue-frame">
          <img data-dcx-cue-img src="${gi(a)}" alt="The chosen visual cue, ${U(a)}" />
          ${n}
        </figure>
        <div class="dcx-cue-card">
          <span class="dcx-cue-tag">Chosen cue</span>
          <h3 class="dcx-cue-name">${U(a)}</h3>
          ${o}
        </div>
      </div>`+q(`The image the palette was sampled from, each role&rsquo;s sample point marked in its dealt color. The values beside it are the committed ones, which move when a role is edited after sampling.`)));let s=i.filter(e=>e!==a);s.length&&r.push(G(`Also generated`,`<div class="dcx-cue-strip">${s.map(e=>`
        <figure class="dcx-cue-thumb" data-dcx-hide-on-error>
          <img src="/cues/${encodeURIComponent(e)}.png" alt="" loading="lazy" />
          <figcaption>${U(e)}</figcaption>
        </figure>`).join(``)}</div>`+q(`The directions not taken, kept on disk in <code>.impeccable/visual-cues/</code>.`)))}if(e.palette.length){let t=100/(e.palette.length+1),n=e.palette.map((e,n)=>`
      <button class="dcx-fan-panel" type="button" data-copy-color="${e.hex}" data-color-name="${U(e.role)}"
        style="--panel-left:${n*t}%; --panel-z:${n+1}; --panel-swatch:${e.hex}; --panel-ink:${Ni(e.hex)};"
        aria-label="Copy ${U(e.role)} ${e.hex}">
        <span class="dcx-fan-info"><span class="dcx-fan-name">${U(e.role)}</span><span class="dcx-fan-value">${e.hex}</span></span>
      </button>`).join(``);r.push(G(`Palette`,`<div class="dcx-fan" role="group" aria-label="Chosen palette, click a panel to copy its value">${n}</div>`+q(`Committed on the palette screen${e.paletteSource?` from the <code>${U(e.paletteSource)}</code> cue`:``}, roles in the order you arranged them. Hover to fan; click to copy the hex.`)));let i=e.context?.color||{};r.push(G(`Roles and values`,`<div class="dcx-swatches">${e.palette.map(t=>{let n=m(t.hex),r=_i(e.paletteSource,t.role.toLowerCase()),i=r?r===t.hex?`as dealt`:`edited`:``;return`
      <div class="dcx-swatch" data-role="${t.role.toLowerCase()}">
        <button class="dcx-swatch-chip" type="button" data-copy-color="${t.hex}" data-color-name="${U(t.role)}"
          style="--swatch:${t.hex}; --swatch-ink:${Ni(t.hex)};" aria-label="Copy ${U(t.role)} ${t.hex}">
          <span class="dcx-swatch-hex">${t.hex}</span>${i?`
          <span class="dcx-swatch-provenance" data-provenance="${i===`edited`?`edited`:`as-dealt`}">${i}</span>`:``}
          <span class="dcx-swatch-copy-hint">Copy</span>
        </button>
        <div class="dcx-swatch-meta">
          <h3>${U(t.role)}</h3>
          <p>${U(Ki[t.role]||``)}</p>
          <code>${U(l(t.hex))}</code>
          <span class="dcx-ink-pair"><span class="dcx-ink-tag">Ink</span><span class="dcx-ink-sample" style="--ink-ground:${t.hex}; --ink-text:${n};">${n}</span></span>
        </div>
      </div>`}).join(``)}</div>`+(Array.isArray(i.assetLocks)&&i.assetLocks.length?q(`From the assets: ${i.assetLocks.map(U).join(` &middot; `)}.`):``))),r.push(G(`Strategy per surface`,`<div class="dcx-surfaces" data-count="${e.strategy.length}">${e.strategy.map(e=>`
      <article class="dcx-surface-card">
        ${J(Fi(e.mode)||Ii(e.mode),{strategy:e.value,kind:`board`})}
        <div class="dcx-surface-copy">
          <h3 class="dcx-surface-name">${U(e.label)} &middot; <em>${U(e.title)}</em>${e.chosen?``:` <span class="dcx-default-mark">default</span>`}</h3>
          <p class="dcx-surface-goal">${U(e.desc)}</p>
        </div>
      </article>`).join(``)}</div>`+q(`How much of each surface the palette is allowed to carry, drawn the way the strategy screen previewed it. Options a surface cannot take were withheld there.`)))}else r.push(G(`Palette`,Ai(`No palette committed`,`The palette screen was not completed on this run.`))),r.push(G(`Strategy per surface`,zi(e.strategy)));return(n.colorStrategy||n.hueAnchor)&&r.push(G(`Interview direction`,Ei([n.colorStrategy&&{dt:`Strategy asked for`,dd:U(n.colorStrategy)},n.hueAnchor&&{dt:`Hue anchor`,dd:U(n.hueAnchor)}].filter(Boolean))+q(`Q1 of the seed interview. The cues were generated from this; the picks above are the decision.`))),r.join(``)}function Ji(e,t){let n=e.context?.interview||{},r=[W(5,`Typography`,`Font families, type scale, hierarchy.`,t)];return e.fonts.heading?r.push(G(`The pair`,`<div class="dcx-pair">
        <article class="dcx-pair-card">
          <span class="dcx-pair-role">Headings</span>
          <p class="dcx-pair-name" style="font-family:'${U(e.fonts.heading)}', serif;">${U(e.fonts.heading)}</p>
          ${e.fonts.headingSource?`<code class="dcx-pair-source">${U(e.fonts.headingSource)}</code>`:``}
        </article>
        <article class="dcx-pair-card">
          <span class="dcx-pair-role">Body</span>
          <p class="dcx-pair-name" style="font-family:'${U(e.fonts.body)}', sans-serif;">${U(e.fonts.body)}</p>
          ${e.fonts.bodySource?`<code class="dcx-pair-source">${U(e.fonts.bodySource)}</code>`:``}
        </article>
      </div>
      <p class="dcx-pair-why" style="font-family:'${U(e.fonts.body)}', sans-serif;">${U(e.fonts.why||`Chosen on the font pair screen against every surface this product ships.`)}</p>
      <button class="dcx-edit" type="button" data-dcx-request-kind="font">Change the fonts&hellip;</button>`)):r.push(G(`The pair`,Ai(`No pair selected`,`The font pair screen was not completed on this run.`))),e.scale.ratio&&(r.push(G(`Type scale`,`<p class="dcx-scale-head"><strong>${U(e.scale.name)}</strong> &middot; ratio <code>${e.scale.ratio.toFixed(3)}</code> on a 16px base. ${U(e.scale.desc)}</p>`+J(B(`[data-scale-sheet]`),{kind:`scale`})+q(`The scale screen&rsquo;s sheet, kept at rendered size in the chosen faces. Values at a 16px base.`))),r.push(G(`In running text`,J(B(`[data-scale-specimen]`),{kind:`specimen`})+q(`The same scale on the components a page is built from &mdash; headings, ledes, lists, quotes, code.`)))),n.typeDirection&&r.push(G(`Interview direction`,K(`Direction asked for`,U(n.typeDirection))+q(`Q2 of the seed interview. All six candidate pairs were composed inside this direction.`))),r.join(``)}function Yi(e,t){let n=[W(6,`Iconography`,`Icon library, license, where it lives.`,t)];if(e.icons.pack){let t=B(`[data-icon-sheet]`),r=t?.querySelector(`.picker-icon-cell`)?J(t,{kind:`icons`}):``;r&&n.push(G(`The hand`,r+q(`${U(e.icons.pack)}&rsquo;s canonical set, as the icons screen previewed it. One pack, one hand: no mixed sets.`)));let i=V.querySelector(`input[name="icon-pack"]:checked`)?.closest(`label`),a=i?.querySelector(`.picker-strategy-desc`)?.textContent.trim()||``,o=i?.querySelector(`.picker-icon-meta`)?.textContent.trim()||``;n.push(G(`Library`,Ei([{dt:`Pack`,dd:`<strong>${U(e.icons.pack)}</strong>${o?` &middot; ${U(o)}`:``}`},a?{dt:`Why this hand`,dd:U(a)}:null,e.icons.license?{dt:`License`,dd:U(e.icons.license)}:null,e.icons.url?{dt:`Home`,dd:`<a href="${U(e.icons.url)}" target="_blank" rel="noopener">${U(e.icons.url)}</a>`}:null].filter(Boolean))+q(`Chosen on the icons screen. The pack names the hand; stroke weight and metaphor rules resolve during implementation.`)))}else n.push(G(`Library`,Ai(`No pack selected`,`The icons screen was not completed on this run.`)));return n.join(``)}var Xi=e=>`<div class="dcx-picks" data-count="${e.length}">${e.map(e=>`
  <article class="dcx-pick">
    <span class="dcx-pick-surface">${U(e.label)}${e.chosen?``:` <span class="dcx-default-mark">default</span>`}</span>
    <h3 class="dcx-pick-title">${U(e.title)}</h3>
    <p class="dcx-pick-desc">${U(e.desc)}</p>
  </article>`).join(``)}</div>`;function Zi(e,t){let n=e.context?.interview||{},r=[W(7,`Material`,`Motion, layout structure, boundaries, corners, depth.`,t)],i=e.surfaces.map(t=>{let n=Li(t.mode);return n?`
    <article class="dcx-surface-card">
      ${J(n,{strategy:e.strategy.find(e=>e.mode===t.mode)?.value||``,kind:`board`,marks:Ri(e,t.mode)})}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${U(t.label)}</h3>
      </div>
    </article>`:``}).filter(Boolean);return i.length&&r.push(G(`The page, as chosen`,`<div class="dcx-surfaces" data-count="${i.length}">${i.join(``)}</div>`+q(`Each surface&rsquo;s page anatomy carrying every structural answer below at once, the way the question screens accumulated them: color strategy, layout, boundaries, corners, depth.`))),e.motion.length?r.push(G(`Motion per surface`,Xi(e.motion)+q(n.motionEnergy?`The seed interview asked for <strong>${U(n.motionEnergy)}</strong>; the motion screen answered it per surface above.`:`Asked of the landing page and the portfolio only. A tool and a document are moved through rather than watched, so their movement follows the interface rather than a house style.`))):r.push(G(`Motion`,Ai(`Not asked on this run`,`The motion screen is shown for a landing page and a portfolio. This run has neither, so no motion energy was chosen and none is recorded.`))),e.layout.value&&r.push(G(`Layout structure`,K(e.layout.title,U(e.layout.desc))+q(`Asked of the landing page and the portfolio, where the composition of the page is itself the decision. One answer is kept for the run, and every surface is drawn on it.`))),r.push(G(`Boundaries per surface`,Xi(e.boundaries)+q(`How sections separate on each surface.`))),r.push(G(`Corners per surface`,Xi(e.corners)+q(`How round shapes are on each surface.`))),r.push(G(`Depth per surface`,Xi(e.depth)+q(`How far off the page things sit on each surface.`))),r.join(``)}function Qi(e,t){let n=[W(8,`Interface`,`Per-surface decisions at a glance, component status.`,t)];n.push(G(`Decisions per surface`,`<div class="dcx-surfaces" data-count="${e.surfaces.length}">${e.surfaces.map(t=>{let n=e.strategy.find(e=>e.mode===t.mode)?.value||``,r=Li(t.mode),i=[[`Color strategy`,e.strategy.find(e=>e.mode===t.mode)],[`Boundaries`,e.boundaries.find(e=>e.mode===t.mode)],[`Corners`,e.corners.find(e=>e.mode===t.mode)],[`Depth`,e.depth.find(e=>e.mode===t.mode)],[`Motion`,e.motion.find(e=>e.mode===t.mode)],[`Layout`,e.layout.value?e.layout:void 0]];return`
    <article class="dcx-surface-card">
      ${r?J(r,{strategy:n,kind:`board`,marks:Ri(e,t.mode)}):J(Fi(t.mode)||Ii(t.mode),{strategy:n,kind:`board`})}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${U(t.label)}</h3>
        <dl class="dcx-matrix">${i.map(([e,t])=>`
          <div class="dcx-matrix-row"><dt>${U(e)}</dt><dd>${t?U(t.title):`Not asked`}${t&&!t.chosen?` <span class="dcx-default-mark">default</span>`:``}</dd></div>`).join(``)}</dl>
      </div>
    </article>`}).join(``)}</div>`+q(`Each surface&rsquo;s anatomy carrying its committed answers, with every per-surface decision beneath it.`)));let r=[e.fonts.heading?{dt:`Faces`,dd:`<strong>${U(e.fonts.heading)}</strong> for headings, <strong>${U(e.fonts.body)}</strong> for body`}:null,e.scale.ratio?{dt:`Type scale`,dd:`<strong>${U(e.scale.name)}</strong> &middot; ratio <code>${e.scale.ratio.toFixed(3)}</code> on a 16px base`}:null,e.icons.pack?{dt:`Icons`,dd:`<strong>${U(e.icons.pack)}</strong>${e.icons.license?` &middot; ${U(e.icons.license)}`:``}`}:null,e.palette.length?{dt:`Palette`,dd:e.palette.map(e=>`<code>${e.hex}</code>`).join(` &middot; `)}:null,e.layout.value?{dt:`Layout`,dd:`<strong>${U(e.layout.title)}</strong>, one answer for the run`}:null].filter(Boolean);return r.length&&n.push(G(`The kit`,Ei(r)+q(`The tokens the seed DESIGN.md will carry in its frontmatter, gathered from their own pages in this document.`))),n.push(G(`Components`,Ai(`No component library seeded yet`,`Components are documented on the first scan pass, once there is code to capture actual tokens and states from. Re-run <code>/impeccable document</code> then.`))),n.join(``)}var $i={audience:Bi,product:Wi,brand:Gi,color:qi,typography:Ji,iconography:Yi,material:Zi,interface:Qi},ea={persuade:`A public-facing page that introduces the experience and guides visitors toward its primary action.`,operate:`A working surface for completing tasks, where familiar patterns and a predictable layout come first.`,read:`A reading surface for understanding, where type, structure, and pacing carry the page.`,experience:`A project-led page for presenting selected work, its context, and its outcomes.`};function ta(){let e=Ti();window.dcxSurfaceDefs=e.surfaces.map(e=>({label:e.label,description:ea[e.mode]||e.goal||``}));let t=e.context?.product?.name||``;for(let[n,r]of Object.entries($i)){let i=document.getElementById(`dcx-detail-${n}`);i.innerHTML=`<article class="dcx-article">${r(e,t)}</article>`}t&&(document.title=`Design context — ${t}`)}var na=e=>new Promise(t=>setTimeout(t,e));function ra(){let e={};for(let[t,n]of new FormData(V))e[t]=t in e?Array.isArray(e[t])?[...e[t],n]:[e[t],n]:n;return e}async function ia(){let e=await fetch(`/submit`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(ra())});if(!e.ok&&e.status!==409)throw Error(`Submit failed: ${e.status}`);if(e.ok){let t=await e.json().catch(()=>null);t?.doc?.base&&t?.doc?.token&&ya(t.doc)}}async function aa(){let e=B(`[data-doc-error]`),t=B(`[data-doc-loader]`);e.hidden=!0,t.removeAttribute(`data-stalled`),ta();try{await Promise.all([ia(),na(2400)]),da()}catch{t.setAttribute(`data-stalled`,``),e.hidden=!1}}var oa=!1;document.addEventListener(`picker:screenchange`,({detail:e})=>{e.screen!==`12`||oa||(oa=!0,aa())}),x().then(async e=>{e.mode===`doc`&&(hi=!0,oa=!0,await Promise.all([pi,mi,te,qt().catch(()=>{})]),e.doc?.base&&e.doc?.token&&ya(e.doc),ta(),da())});var sa;document.addEventListener(`picker:screenchange`,()=>{oa||(clearTimeout(sa),sa=setTimeout(()=>{oa||fetch(`/autosave`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(ra())}).catch(()=>{})},500))}),B(`[data-doc-retry]`)?.addEventListener(`click`,aa);var ca=!1,la=()=>document.querySelector(`.dcx-expander[data-dcx-document]`)?.dataset.dcxCurrentCategory||window.dcxDocument?.currentCategory()||``,ua=e=>B(`.dcx-tile[data-category="${e}"]`)?.dataset.name||`Design context`;function da(){ca=!0,document.body.classList.add(`dcx-open`),si.hidden=!1,window.scrollTo(0,0),requestAnimationFrame(()=>{requestAnimationFrame(()=>{oi(`[data-reveal]`,si).forEach(e=>e.classList.add(`revealed`)),fa()})})}function fa(){oi(`.dcx-viz-svg`).forEach(e=>{let t=oi(`.anim-draw, .anim-draw-delay`,e);if(!t.length)return;let n=e.getBoundingClientRect();if(!n.width||!n.height)return;let r=Math.min(n.width,n.height)/40;t.forEach(e=>{let t=Math.max(100,e.getTotalLength()/.6);e.style.setProperty(`--pl`,`${(t*r).toFixed(1)}px`)})})}var pa;window.addEventListener(`resize`,()=>{window.clearTimeout(pa),pa=window.setTimeout(()=>{ca&&fa()},150)});var Y=null,ma=1,ha=!1,ga=[],_a=B(`[data-dcx-tray]`),X=B(`[data-dcx-request-modal]`),va=()=>!!Y;function ya(e){Y=e,window.dcxDocSession=e,document.body.classList.add(`dcx-live`),ka(),Sa(1500)}async function ba(e,t){let n=await fetch(`${Y.base}${e}`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({token:Y.token,...t})});if(!n.ok)throw Error(`${e} failed: ${n.status}`);return n.json()}var xa;function Sa(e){window.clearTimeout(xa),xa=window.setTimeout(Ca,e)}async function Ca(){if(Y)try{let e=await fetch(`${Y.base}/doc/state?token=${encodeURIComponent(Y.token)}`);if(!e.ok)throw Error(`state`);let t=await e.json();wa(!0),ga=t.requests||[],Ma(),t.version!==ma&&(ma=t.version,await Oa(),ka()),Sa(2e3)}catch{wa(!1),Ma(),Sa(8e3)}}function wa(e){ha=e,document.body.classList.toggle(`dcx-live`,!!Y&&e)}async function Ta(){let e=await fetch(`${Y.base}/doc/answers?token=${encodeURIComponent(Y.token)}`);if(!e.ok)return;let{answers:t}=await e.json();for(let[e,n]of Object.entries(t||{})){if(Array.isArray(n)||typeof n!=`string`)continue;let t=V.elements[e];t&&(typeof RadioNodeList<`u`&&t instanceof RadioNodeList||`value`in t&&t.type!==`checkbox`)&&(t.value=n)}Ea(H(`font-heading`)),Ea(H(`font-body`))}function Ea(e){if(!e||document.fonts?.check?.(`16px '${e}'`))return;let t=`dcx-face-${e.replace(/\W+/g,`-`).toLowerCase()}`;if(document.getElementById(t))return;let n=document.createElement(`link`);n.id=t,n.rel=`stylesheet`,n.href=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(e).replace(/%20/g,`+`)}:wght@300..800&display=swap`,document.head.appendChild(n)}async function Da(){let e=await fetch(`${Y.base}/doc/context?token=${encodeURIComponent(Y.token)}`);if(!e.ok)return;let t=await e.json();t.context&&typeof t.context==`object`&&(ci=t.context),Array.isArray(t.modes)&&(li=t.modes)}var Oa=()=>Promise.all([Ta(),Da()]);function ka(){ta(),window.dcxDocument?.remount()}var Aa=`freeform`;document.addEventListener(`click`,e=>{let t=e.target.closest(`[data-dcx-request], [data-dcx-request-kind]`);if(!t||!X)return;Aa=t.dataset.dcxRequestKind||`freeform`;let n=la(),r=n?ua(n):`Design context`;B(`[data-dcx-request-scope]`,X).textContent=Aa===`font`?`Typography change`:`${r} change`,B(`[data-dcx-request-fonts]`,X).hidden=Aa!==`font`;let i=B(`.dcx-request-prompt`,X);i.value=``,B(`[data-dcx-request-upload-note]`,X).textContent=``,X.showModal(),i.focus()}),B(`[data-dcx-request-cancel]`,X)?.addEventListener(`click`,()=>X.close()),B(`[data-dcx-request-send]`,X)?.addEventListener(`click`,async()=>{let e=B(`.dcx-request-prompt`,X).value.trim();if(!e||!va())return;let t=B(`[data-dcx-request-send]`,X);t.disabled=!0;try{let t=B(`[data-dcx-request-files]`,X)?.files||[],n=[];for(let e of t){let t=await fetch(`${Y.base}/font-upload?token=${encodeURIComponent(Y.token)}`,{method:`POST`,headers:{"X-Font-Filename":e.name},body:e});t.ok&&n.push((await t.json()).path)}ma=(await ba(`/doc/request`,{kind:Aa,prompt:e,category:la(),payload:n.length?{fonts:n}:{}})).version,X.close(),Sa(400)}catch{B(`[data-dcx-request-upload-note]`,X).textContent=`The edit session is unreachable; the request was not sent.`}finally{t.disabled=!1}});var ja={pending:`Queued for the agent`,working:`The agent is on it`,done:`Applied`,error:`Could not apply`};function Ma(){if(!_a)return;let e=ga.slice(-4),t=Y&&!ha;_a.hidden=!t&&e.length===0,_a.innerHTML=[t?`<div class="dcx-tray-item" data-status="offline"><span class="dcx-tray-dot"></span><div><p class="dcx-tray-prompt">Edit session offline</p><p class="dcx-tray-note">Changes stay in this tab; reconnecting&hellip;</p></div></div>`:``,...e.map(e=>`
      <div class="dcx-tray-item" data-status="${U(e.status)}">
        <span class="dcx-tray-dot"></span>
        <div>
          <p class="dcx-tray-prompt">${U(e.prompt)}</p>
          <p class="dcx-tray-note">${U(e.message||ja[e.status]||e.status)}</p>
        </div>
      </div>`)].join(``)}var Z=(e,t=document)=>t.querySelector(e),Na=Z(`#picker-form`),Pa=Z(`[data-copy-url]`),Fa=Z(`[data-copy-status]`),Q=[...Na.querySelectorAll(`.picker-screen`)],$=Q.findIndex(e=>e.hasAttribute(`data-active`)),Ia=new URL(location.href);Ia.hostname=`localhost`;var La=Ia.href.replace(/\/$/,``);Z(`[data-copy-url-value]`).textContent=La;var Ra=()=>[...Q[$].querySelectorAll(`button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href]`)],za=Z(`.picker-progress`),Ba=Z(`.picker-progress-track`),Va=()=>Q.filter((e,t)=>t>0&&t<Q.length-1&&!e.hasAttribute(`data-skip`)),Ha=e=>{let t=Va(),n=t.length,r=t.indexOf(e),i=r>=0?r+1:e===Q[0]?1:n;za.dataset.step=String(i),za.style.setProperty(`--pk-steps`,String(n)),[...Ba.children].forEach((e,t)=>e.toggleAttribute(`data-off`,t>=n)),Z(`[data-progress-index]`).textContent=String(i),Z(`[data-progress-total]`).textContent=String(n),Z(`[data-progress-name]`).textContent=e.dataset.step||``},Ua=new Set([`01b`,`02`,`03`]),Wa=(e,t)=>typeof document.startViewTransition==`function`&&!matchMedia(`(prefers-reduced-motion: reduce)`).matches&&Ua.has(e?.dataset.screen)&&Ua.has(t?.dataset.screen),Ga=(e,t=1)=>{let n=e;for(;Q[n]?.hasAttribute(`data-skip`);)n+=t;let r=Q[n];if(r){if(Wa(Q[$],r)){document.startViewTransition(()=>Ka(n));return}Ka(n)}},Ka=e=>{let t=Q[e];Q.forEach((t,n)=>{let r=n===e;t.toggleAttribute(`data-active`,r),r?t.removeAttribute(`aria-hidden`):t.setAttribute(`aria-hidden`,`true`)}),$=e;let n=t.dataset.screen;Na.dataset.current=n,Ha(t),document.dispatchEvent(new CustomEvent(`picker:screenchange`,{detail:{screen:n}})),Ra()[0]?.focus()},qa=`04b`,Ja=new Set([`06`,`08`,`09`,`10`,`11`]),Ya=e=>Q.findIndex(t=>t.dataset.screen===e);Na.onclick=e=>{let t=e.target.closest(`[data-advance]`);if(!t)return;if(Ja.has(Q[$].dataset.screen)){Ga(Ya(qa));return}let n=t.dataset.advance===`prev`?-1:1;Ga($+n,n)},document.addEventListener(`picker:goto`,e=>{let t=Ya(e.detail.screen);t!==-1&&Ga(t)}),document.addEventListener(`keydown`,e=>{if(e.defaultPrevented||e.target instanceof Element&&e.target.closest(`input, textarea, select, [role="slider"]`))return;if(e.key===`Enter`){if($===0&&matchMedia(`(max-width: 1199px)`).matches)return;let t=$===0?Z(`[data-advance="next"]`,Q[0]):document.activeElement;Ra().includes(t)&&(e.preventDefault(),t.click());return}let t={ArrowUp:-1,ArrowLeft:-1,ArrowDown:1,ArrowRight:1};if(!(e.key in t))return;e.preventDefault();let n=Ra(),r=n.indexOf(document.activeElement);n[r<0?0:(r+t[e.key]+n.length)%n.length]?.focus()}),Na.onsubmit=e=>e.preventDefault(),Pa.onclick=async()=>{try{await navigator.clipboard.writeText(La),Pa.classList.add(`is-copied`),Pa.setAttribute(`aria-label`,`Link copied`),Fa.textContent=`Copied. Paste it into your browser to continue.`,setTimeout(()=>{Pa.classList.remove(`is-copied`),Pa.setAttribute(`aria-label`,`Copy link`)},1200)}catch{Fa.textContent=`Copy failed. Select the link above and copy it instead.`}},Na.dataset.current=Q[$].dataset.screen,Ha(Q[$]);