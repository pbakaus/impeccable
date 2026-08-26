import './dcx-settings.js';
import { dcxAsset } from './assets.js';

(() => {
  "use strict";

  const renameIconographyToComponents = () => {
    const tile = document.querySelector('.dcx-tile[data-category="iconography"]');
    if (tile) {
      tile.dataset.category = "components";
      tile.dataset.name = "Components";
      tile.setAttribute("aria-label", "Open Components");
      const title = tile.querySelector(".dcx-tile-title");
      if (title) title.textContent = "Components";
    }

    const shellTemplate = document.querySelector("#dcx-shell-template");
    const navItem = shellTemplate?.content.querySelector('li[data-category="iconography"]');
    const navLink = navItem?.querySelector(".dcx-nav-link");
    if (navItem && navLink) {
      navItem.dataset.category = "components";
      navLink.href = "#components";
      navLink.dataset.dcxNav = "components";
      navLink.textContent = "Components";
    }
  };

  renameIconographyToComponents();

  const CATEGORIES = [
    "audience",
    "product",
    "brand",
    "color",
    "typography",
    "components",
    "material",
    "hooks",
  ];
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const MOBILE_NAV = window.matchMedia("(max-width: 920px)");
  const CATEGORY_SET = new Set(CATEGORIES);
  const categoryFromHash = (hash) => {
    if (hash === "interface"
      || hash === "dcx-category-interface"
      || hash.startsWith("dcx-interface-")) return "hooks";
    if (hash === "iconography"
      || hash === "dcx-category-iconography"
      || hash.startsWith("dcx-iconography-")) return "material";
    return CATEGORIES.find((category) => hash === category
      || hash === `dcx-category-${category}`
      || hash.startsWith(`dcx-${category}-`)) || "";
  };
  const INITIAL_HASH = location.hash.slice(1);
  let pendingInitialCategory = categoryFromHash(INITIAL_HASH);
  let pendingInitialHash = pendingInitialCategory ? INITIAL_HASH : "";

  let documentState = null;
  let revealFrame = 0;
  let pendingObserver = null;

  const slugify = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const categoryName = (category) => document
    .querySelector(`.dcx-tile[data-category="${category}"]`)
    ?.dataset.name || category;

  const sourceCategory = (category) => category === "components" ? "interface" : category;

  const templatesReady = () => CATEGORIES.every((category) => document
    .querySelector(`#dcx-detail-${sourceCategory(category)}`)
    ?.content.querySelector(".dcx-article"))
    && Boolean(document.querySelector("#dcx-detail-iconography")
      ?.content.querySelector(".dcx-article"));

  const getScrollTargetTop = (state, target) => {
    if (!target) return 0;
    const mainRect = state.main.getBoundingClientRect();
    return Math.max(0, target.getBoundingClientRect().top - mainRect.top + state.main.scrollTop - 18);
  };

  const targetFromHash = (state, hash, category) => {
    const article = state.main.querySelector(`:scope > .dcx-article[data-dcx-category="${category}"]`);
    if (hash === "iconography"
      || hash === "dcx-category-iconography"
      || hash.startsWith("dcx-iconography-")) {
      return state.main.querySelector("#dcx-material-iconography") || article;
    }
    if (!hash || hash === category) return article;
    return state.main.querySelector(`#${CSS.escape(hash)}`) || article;
  };

  const copyText = async (value) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}

    const previousFocus = document.activeElement;
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {}
    textarea.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    return copied;
  };

  const initializeColorFans = (root) => {
    root.querySelectorAll(".dcx-fan:not([data-dcx-document-ready])").forEach((fan) => {
      const panels = [...fan.querySelectorAll(".dcx-fan-panel")];
      if (!panels.length) return;
      fan.dataset.dcxDocumentReady = "true";

      const engage = (activeIndex) => {
        fan.classList.add("is-engaged");
        panels.forEach((panel, index) => {
          panel.classList.toggle("is-active", index === activeIndex);
          panel.classList.toggle("is-neighbor", Math.abs(index - activeIndex) === 1);
        });
      };
      const reset = () => {
        fan.classList.remove("is-engaged");
        panels.forEach((panel) => panel.classList.remove("is-active", "is-neighbor"));
      };

      fan.addEventListener("mousemove", (event) => {
        const rect = fan.getBoundingClientRect();
        const relativeX = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
        let activeIndex = 0;
        panels.forEach((panel, index) => {
          const left = Number.parseFloat(panel.style.getPropertyValue("--panel-left")) / 100;
          if (relativeX >= left) activeIndex = index;
        });
        engage(activeIndex);
      });
      fan.addEventListener("mouseleave", reset);

      panels.forEach((panel, index) => {
        panel.addEventListener("focus", () => engage(index));
        panel.addEventListener("blur", () => {
          if (!fan.matches(":focus-within")) reset();
        });
        panel.addEventListener("click", () => {
          const color = panel.dataset.copyColor;
          if (!color) return;
          copyText(color);
          const name = panel.querySelector(".dcx-fan-name");
          const original = panel.dataset.colorName || "Color";
          panel.classList.add("is-copied");
          if (name) name.textContent = "Copied!";
          window.clearTimeout(panel._dcxCopyTimer);
          panel._dcxCopyTimer = window.setTimeout(() => {
            panel.classList.remove("is-copied");
            if (name) name.textContent = original;
          }, 900);
        });
      });
    });
  };

  const createDocumentSection = (label, markup) => {
    const section = document.createElement("section");
    section.className = "dcx-block";
    section.dataset.label = label;

    const blockLabel = document.createElement("span");
    blockLabel.className = "dcx-block-label";
    blockLabel.textContent = label;

    const content = document.createElement("template");
    content.innerHTML = markup;
    section.append(blockLabel, content.content);
    return section;
  };

  const BRAND_PLACEHOLDER_ASSETS = [
    {
      src: "/assets/brand/placeholders/hanazono-primary-mark.png",
      kind: "logo",
      title: "Primary mark",
      alt: "Abstract botanical primary mark in textured gold leaf and patina",
      width: 768,
      height: 768,
    },
    {
      src: "/assets/brand/placeholders/hanazono-atelier-seal.png",
      kind: "logo",
      title: "Atelier seal",
      alt: "Circular floral atelier seal in textured gold leaf and patina",
      width: 768,
      height: 768,
    },
    {
      src: "/assets/brand/placeholders/hanazono-seasonal-moodboard.webp",
      kind: "moodboard",
      title: "Seasonal composition",
      alt: "Editorial moodboard of flowers, handmade paper, gold leaf, and vermilion thread",
      width: 960,
      height: 720,
    },
    {
      src: "/assets/brand/placeholders/hanazono-material-reference.webp",
      kind: "reference",
      title: "Material direction",
      alt: "Material study of lacquer, washi paper, gold leaf, and verdigris patina",
      width: 960,
      height: 720,
    },
  ];

  const humanizeAssetName = (value, fallback) => {
    const name = String(value || "")
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!name) return fallback;
    return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const renderedBrandAssets = (article) => {
    const assets = [];
    const collect = (selector, kind, fallback) => {
      article.querySelectorAll(selector).forEach((figure, index) => {
        const image = figure.querySelector("img");
        if (!image) return;
        const note = figure.querySelector(".dcx-asset-caption p")?.textContent.trim();
        const file = figure.querySelector(".dcx-asset-caption code")?.textContent.trim()
          || image.getAttribute("src")
          || "";
        const title = note || humanizeAssetName(file, `${fallback} ${index + 1}`);
        assets.push({
          src: image.getAttribute("src") || image.src,
          kind,
          title,
          alt: note || `${title} ${kind === "logo" ? "logo" : "brand image"}`,
          width: kind === "logo" ? 1200 : 1600,
          height: kind === "logo" ? 1200 : 1200,
        });
      });
    };

    collect(':scope > .dcx-block[data-label="Marks"] .dcx-mark', "logo", "Logo");
    collect(':scope > .dcx-block[data-label="Boards and references"] .dcx-board', "image", "Brand image");
    article.querySelectorAll(':scope > .dcx-block[data-label="Marks"], :scope > .dcx-block[data-label="Boards and references"], :scope > .dcx-block[data-label="Assets provided"]')
      .forEach((block) => block.remove());
    return assets;
  };

  const composeBrandAssetsArticle = (article) => {
    const uploaded = renderedBrandAssets(article);
    const assets = uploaded.length ? uploaded : BRAND_PLACEHOLDER_ASSETS;
    const section = createDocumentSection("Brand assets", "");
    section.dataset.dcxBrandAssets = uploaded.length ? "uploaded" : "placeholder";

    const grid = document.createElement("ul");
    grid.className = "dcx-brand-assets-grid";
    grid.setAttribute("aria-label", "Available brand assets");

    assets.forEach((asset) => {
      const item = document.createElement("li");
      item.className = "dcx-brand-asset";
      item.dataset.assetKind = asset.kind;

      const figure = document.createElement("figure");
      const frame = document.createElement("div");
      frame.className = "dcx-brand-asset-frame";

      const image = document.createElement("img");
      image.src = asset.src.startsWith('/assets/') ? dcxAsset(asset.src) : asset.src;
      image.alt = asset.alt;
      image.width = asset.width;
      image.height = asset.height;
      image.loading = "lazy";
      image.decoding = "async";
      frame.appendChild(image);

      const caption = document.createElement("figcaption");
      const title = document.createElement("strong");
      title.textContent = asset.title;
      const kind = document.createElement("span");
      kind.textContent = asset.kind === "logo"
        ? "Logo"
        : asset.kind === "moodboard"
          ? "Moodboard"
          : asset.kind === "reference"
            ? "Reference"
            : "Image";
      caption.append(title, kind);

      figure.append(frame, caption);
      item.appendChild(figure);
      grid.appendChild(item);
    });

    section.appendChild(grid);
    article.appendChild(section);
    const lede = article.querySelector(":scope > header > .dcx-lede");
    if (lede) lede.textContent = "Identity, voice, references, taste boundaries, and available assets.";
  };

  const componentCardMedia = () => dcxAsset("/assets/components/hanazono-ikebana-card.jpg");

  const composeComponentsArticle = (article) => {
    article.querySelectorAll(":scope > .dcx-block[data-label]").forEach((block) => block.remove());

    const buttons = createDocumentSection("Buttons", `
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
    `);

    const fields = createDocumentSection("Input fields", `
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
    `);

    const cards = createDocumentSection("Cards", `
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
                <img src="${componentCardMedia()}" width="800" height="1200" alt="Purple flowers arranged in a black ceramic vase" loading="lazy" decoding="async">
                <div class="dcx-showcase-card-body">
                  <span class="dcx-component-kind">Garden study</span>
                  <h5>Line, pause, and negative space</h5>
                  <p>A restrained floral study built around one deliberate gesture.</p>
                </div>
              </article>
              <article class="dcx-showcase-card dcx-showcase-card--media dcx-showcase-card--media-close">
                <img src="${componentCardMedia()}" width="800" height="1200" alt="Close crop of purple ikebana flowers" loading="lazy" decoding="async">
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
              <img src="${componentCardMedia()}" width="800" height="1200" alt="Purple ikebana in a dark ceramic vase" loading="lazy" decoding="async">
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
    `);

    article.append(buttons, fields, cards);
  };

  const mountArticles = (state) => {
    const fragment = document.createDocumentFragment();
    const documentTitle = document.createElement("h1");
    documentTitle.className = "dcx-document-title";
    documentTitle.textContent = "Design context";
    fragment.appendChild(documentTitle);

    CATEGORIES.forEach((category) => {
      const template = document.querySelector(`#dcx-detail-${sourceCategory(category)}`);
      const clone = template.content.cloneNode(true);
      const article = clone.querySelector(".dcx-article");
      if (!article) return;

      if (category === "components") {
        composeComponentsArticle(article);
        const title = article.querySelector(":scope > header > .dcx-title");
        const lede = article.querySelector(":scope > header > .dcx-lede");
        if (title) title.textContent = "Components";
        if (lede) lede.textContent = "A compact visual inventory of reusable interface patterns.";
      }

      if (category === "brand") composeBrandAssetsArticle(article);

      if (category === "material") {
        const accessibility = createDocumentSection("Accessibility", `
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
        `);
        const motion = article.querySelector(':scope > .dcx-block[data-label="Motion per surface"], :scope > .dcx-block[data-label="Motion"]');
        const layout = article.querySelector(':scope > .dcx-block[data-label="Layout structure"]');
        if (motion) motion.after(accessibility);
        else if (layout) layout.before(accessibility);
        else article.appendChild(accessibility);

        const iconographyArticle = document.querySelector("#dcx-detail-iconography")
          ?.content.querySelector(".dcx-article");
        const library = iconographyArticle
          ?.querySelector(':scope > .dcx-block[data-label="Library"]')
          ?.cloneNode(true);
        if (library) {
          library.dataset.label = "Iconography";
          library.dataset.dcxMovedIconography = "true";
          const label = library.querySelector(":scope > .dcx-block-label");
          if (label) label.textContent = "Iconography";
          article.appendChild(library);
        }
        const lede = article.querySelector(":scope > header > .dcx-lede");
        if (lede) lede.textContent = "Motion, accessibility, layout structure, boundaries, corners, depth, and iconography.";
      }

      article.querySelector(":scope > header > .dcx-eyebrow")?.remove();
      article.dataset.dcxCategory = category;
      article.id = `dcx-category-${category}`;
      article.classList.add("dcx-document-article");
      article.setAttribute("aria-label", categoryName(category));
      article.querySelectorAll(".dcx-block[data-label]").forEach((block) => {
        block.id = `dcx-${category}-${slugify(block.dataset.label || "section")}`;
      });
      fragment.appendChild(article);
    });

    state.main.replaceChildren(fragment);
    state.main.dataset.dcxContinuous = "true";
    state.expander.dataset.dcxDocument = "true";
    initializeColorFans(state.main);
    state.expander.dispatchEvent(new CustomEvent("dcx:document-mounted", { bubbles: true }));
  };

  const audienceSubnav = (article) => {
    const blocks = [...article.querySelectorAll(":scope > .dcx-block[data-label]")];
    const byLabel = new Map(blocks.map((block) => [block.dataset.label, block]));
    return [
      { label: "People", target: byLabel.get("Who they are") },
      { label: "Decision factors", target: byLabel.get("Needs") || byLabel.get("Trust triggers") },
      { label: "Inclusion", target: byLabel.get("Who must not be excluded") },
    ].filter((item) => item.target);
  };

  const genericSubnav = (article) => [...article.querySelectorAll(":scope > .dcx-block[data-label]")]
    .map((block) => ({ label: block.dataset.label, target: block }));

  const renderSubnav = (state, category, article) => {
    const descriptors = category === "audience" ? audienceSubnav(article) : genericSubnav(article);
    const activeItem = state.nav.querySelector(`.dcx-nav-list > li[data-category="${category}"]`);
    const subnav = activeItem?.querySelector(":scope > .dcx-subnav");
    if (!subnav) return;

    const signature = descriptors.map(({ label, target }) => `${label}:${target.id}`).join("|");
    const measure = () => {
      const links = [...subnav.querySelectorAll(":scope > .dcx-sub-link")];
      const heights = links.map((link) => link.getBoundingClientRect().height);
      if (!heights.some((height) => height > 0)) return;
      const summary = category === "audience";
      const gap = summary ? 0 : 2;
      const padding = summary ? 14 : 10;
      const height = heights.reduce((total, value) => total + value, 0)
        + Math.max(0, links.length - 1) * gap
        + padding;
      subnav.style.setProperty("--dcx-subnav-height", `${Math.ceil(height)}px`);
    };
    if (subnav.dataset.dcxDocumentSignature === signature) {
      measure();
      return;
    }

    const links = descriptors.map(({ label, target }) => {
      const link = document.createElement("a");
      link.className = "dcx-sub-link";
      link.href = `#${target.id}`;
      link.textContent = label;
      link.dataset.dcxDocumentTarget = target.id;
      if (category === "audience") link.dataset.dcxRailSummary = "";
      return link;
    });
    subnav.replaceChildren(...links);
    subnav.dataset.dcxDocumentSignature = signature;
    subnav.classList.toggle("dcx-subnav--summary", category === "audience");
    measure();
  };

  const prepareSubnavs = (state) => {
    CATEGORIES.forEach((category) => {
      const article = state.main.querySelector(`:scope > .dcx-article[data-dcx-category="${category}"]`);
      if (article) renderSubnav(state, category, article);
    });
  };

  const setActiveCategory = (state, category, { updateHash = false } = {}) => {
    if (!CATEGORY_SET.has(category)) return;
    const article = state.main.querySelector(`:scope > .dcx-article[data-dcx-category="${category}"]`);
    if (!article) return;

    const previousCategory = state.currentCategory;
    if (previousCategory === category) {
      renderSubnav(state, category, article);
      state.expander.querySelector(".dcx-current").textContent = categoryName(category);
      return;
    }

    if (previousCategory) {
      state.expander.dispatchEvent(new CustomEvent("dcx:continuouscategorywillchange", {
        bubbles: true,
        detail: {
          from: previousCategory,
          to: category,
          source: state.pinnedCategory === category ? "navigation" : "scroll",
        },
      }));
    }

    state.currentCategory = category;
    state.expander.dataset.dcxCurrentCategory = category;
    state.expander.querySelector(".dcx-current").textContent = categoryName(category);

    state.nav.querySelectorAll(".dcx-nav-list > li[data-category]").forEach((item) => {
      const active = item.dataset.category === category;
      item.classList.toggle("is-active", active);
      const link = item.querySelector(":scope > .dcx-nav-link");
      const subnav = item.querySelector(":scope > .dcx-subnav");
      if (active) {
        link?.setAttribute("aria-current", "page");
        link?.setAttribute("aria-expanded", "true");
        subnav?.removeAttribute("aria-hidden");
        if (subnav) subnav.inert = false;
      } else {
        link?.removeAttribute("aria-current");
        link?.removeAttribute("aria-expanded");
        subnav?.setAttribute("aria-hidden", "true");
        if (subnav) subnav.inert = true;
      }
    });

    renderSubnav(state, category, article);
    if (MOBILE_NAV.matches) {
      const activeItem = state.nav.querySelector(`.dcx-nav-list > li[data-category="${category}"]`);
      requestAnimationFrame(() => {
        activeItem?.scrollIntoView({
          behavior: REDUCED_MOTION.matches ? "auto" : "smooth",
          block: "nearest",
          inline: "nearest",
        });
      });
    }
    state.expander.dispatchEvent(new CustomEvent("dcx:continuouscategorychange", {
      bubbles: true,
      detail: { category, article },
    }));

    if (updateHash) {
      history.replaceState({ category }, "", `#${category}`);
    }
  };

  const findVisibleCategory = (state) => {
    const articles = [...state.main.querySelectorAll(":scope > .dcx-article[data-dcx-category]")];
    if (!articles.length) return "audience";
    if (state.pinnedCategory) return state.pinnedCategory;

    const mainRect = state.main.getBoundingClientRect();
    const marker = mainRect.top + state.main.clientHeight * 0.24;
    let visible = articles[0];
    articles.forEach((article) => {
      if (article.getBoundingClientRect().top <= marker) visible = article;
    });
    if (state.main.scrollTop + state.main.clientHeight >= state.main.scrollHeight - 4) {
      visible = articles.at(-1);
    }
    return visible.dataset.dcxCategory;
  };

  const handleMainScroll = (state) => {
    if (state.scrollFrame) return;
    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = 0;
      const category = findVisibleCategory(state);
      if (category !== state.currentCategory) setActiveCategory(state, category, { updateHash: true });
    });
  };

  const releasePinnedCategory = (state) => {
    state.pinnedCategory = "";
    window.clearTimeout(state.pinTimer);
  };

  const scrollToTarget = (state, target, category, {
    instant = false,
    historyMode = "push",
    hash = category,
  } = {}) => {
    if (!target || !CATEGORY_SET.has(category)) return;
    state.pinnedCategory = category;
    setActiveCategory(state, category);
    const top = target === state.main.firstElementChild ? 0 : getScrollTargetTop(state, target);
    state.main.scrollTo({
      top,
      behavior: instant || REDUCED_MOTION.matches ? "auto" : "smooth",
    });

    if (historyMode === "push") history.pushState({ category }, "", `#${hash}`);
    if (historyMode === "replace") history.replaceState({ category }, "", `#${hash}`);

    window.clearTimeout(state.pinTimer);
    state.pinTimer = window.setTimeout(() => {
      state.pinnedCategory = "";
      handleMainScroll(state);
    }, instant ? 80 : 760);
  };

  const scrollToCategory = (state, category, options = {}) => {
    const article = state.main.querySelector(`:scope > .dcx-article[data-dcx-category="${category}"]`);
    scrollToTarget(state, article, category, options);
  };

  const handleNavigation = (state, event) => {
    const categoryLink = event.target.closest(".dcx-nav-link[data-dcx-nav]");
    if (categoryLink && state.nav.contains(categoryLink)) {
      event.preventDefault();
      const category = categoryLink.dataset.dcxNav;
      scrollToCategory(state, category);
      return;
    }

    const subsection = event.target.closest(".dcx-sub-link[data-dcx-document-target]");
    if (!subsection || !state.nav.contains(subsection)) return;
    event.preventDefault();
    const target = state.main.querySelector(`#${CSS.escape(subsection.dataset.dcxDocumentTarget)}`);
    scrollToTarget(state, target, state.currentCategory, {
      historyMode: "replace",
      hash: subsection.dataset.dcxDocumentTarget,
    });
  };

  const closeDocument = (state, { updateHistory = true } = {}) => {
    if (!state || state.closing) return;
    window.closeDcxSettings?.({ restoreFocus: false, instant: true });
    state.closing = true;
    state.expander.dataset.dcxClosing = "true";
    releasePinnedCategory(state);
    if (state.scrollFrame) cancelAnimationFrame(state.scrollFrame);
    if (state.contentFrame) cancelAnimationFrame(state.contentFrame);
    if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
    state.contentObserver?.disconnect();
    state.layoutObserver?.disconnect();
    state.main.removeEventListener("scroll", state.onScroll);
    state.main.removeEventListener("wheel", state.onManualScroll);
    state.main.removeEventListener("touchstart", state.onManualScroll);
    state.main.removeEventListener("pointerdown", state.onManualScroll);
    state.nav.removeEventListener("click", state.onNavClick);

    const tile = document.querySelector(`.dcx-tile[data-category="${state.currentCategory}"]`) || state.opener;
    const rect = tile?.getBoundingClientRect() || state.originRect;
    state.expander.classList.remove("is-ready", "is-full");
    state.expander.style.top = `${rect.top}px`;
    state.expander.style.left = `${rect.left}px`;
    state.expander.style.width = `${rect.width}px`;
    state.expander.style.height = `${rect.height}px`;

    if (updateHistory) {
      history.pushState(null, "", `${location.pathname}${location.search}`);
    }

    const finish = () => {
      state.expander.remove();
      document.body.classList.remove("is-locked");
      if (state.background) {
        state.background.inert = false;
        state.background.removeAttribute("aria-hidden");
      }
      state.opener?.focus({ preventScroll: true });
      if (documentState === state) documentState = null;
    };
    if (REDUCED_MOTION.matches) finish();
    else state.closeTimer = window.setTimeout(finish, 540);
  };

  const openDocument = (category, { historyMode = "push", opener = null, targetHash = category } = {}) => {
    if (!CATEGORY_SET.has(category) || !templatesReady()) return false;
    if (documentState) {
      scrollToCategory(documentState, category, { historyMode });
      return true;
    }

    const sourceTile = opener || document.querySelector(`.dcx-tile[data-category="${category}"]`);
    const shellTemplate = document.querySelector("#dcx-shell-template");
    if (!sourceTile || !shellTemplate) return false;
    const rect = sourceTile.getBoundingClientRect();
    const expander = document.createElement("section");
    expander.className = "dcx-expander";
    expander.dataset.dcxDocument = "true";
    expander.setAttribute("role", "dialog");
    expander.setAttribute("aria-modal", "true");
    expander.setAttribute("aria-label", "Design context document");
    expander.style.top = `${rect.top}px`;
    expander.style.left = `${rect.left}px`;
    expander.style.width = `${rect.width}px`;
    expander.style.height = `${rect.height}px`;
    expander.appendChild(shellTemplate.content.cloneNode(true));
    const background = document.querySelector("[data-dcx-shell]");
    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    document.body.appendChild(expander);
    document.body.classList.add("is-locked");

    const state = {
      expander,
      main: expander.querySelector(".dcx-main"),
      nav: expander.querySelector(".dcx-nav"),
      opener: sourceTile,
      originRect: rect,
      background,
      currentCategory: "",
      pinnedCategory: category,
      pinTimer: 0,
      scrollFrame: 0,
      contentFrame: 0,
      layoutFrame: 0,
      initialCategory: category,
      initialHash: targetHash,
      settleUntil: performance.now() + 3200,
      userInteracted: false,
      closing: false,
    };
    documentState = state;
    mountArticles(state);
    prepareSubnavs(state);

    state.onScroll = () => handleMainScroll(state);
    state.onManualScroll = () => {
      state.userInteracted = true;
      state.layoutObserver?.disconnect();
      releasePinnedCategory(state);
    };
    state.onNavClick = (event) => {
      state.userInteracted = true;
      handleNavigation(state, event);
    };
    state.contentObserver = new MutationObserver(() => {
      if (state.contentFrame) return;
      state.contentFrame = requestAnimationFrame(() => {
        state.contentFrame = 0;
        initializeColorFans(state.main);
        setActiveCategory(state, state.currentCategory);
        if (!state.userInteracted && performance.now() < state.settleUntil) {
          const target = targetFromHash(state, state.initialHash, state.initialCategory);
          scrollToTarget(state, target, state.initialCategory, {
            instant: true,
            historyMode: "replace",
            hash: state.initialHash,
          });
        }
      });
    });
    state.contentObserver.observe(state.main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "data-dcx-audience-enhanced", "data-dcx-detail-enhanced"],
    });
    state.layoutObserver = new ResizeObserver(() => {
      if (state.layoutFrame || state.userInteracted || performance.now() >= state.settleUntil) return;
      state.layoutFrame = requestAnimationFrame(() => {
        state.layoutFrame = 0;
        const target = targetFromHash(state, state.initialHash, state.initialCategory);
        scrollToTarget(state, target, state.initialCategory, {
          instant: true,
          historyMode: "replace",
          hash: state.initialHash,
        });
      });
    });
    state.main.querySelectorAll(":scope > .dcx-article[data-dcx-category]").forEach((article) => {
      state.layoutObserver.observe(article);
    });
    state.main.addEventListener("scroll", state.onScroll, { passive: true });
    state.main.addEventListener("wheel", state.onManualScroll, { passive: true });
    state.main.addEventListener("touchstart", state.onManualScroll, { passive: true });
    state.main.addEventListener("pointerdown", state.onManualScroll, { passive: true });
    state.nav.addEventListener("click", state.onNavClick);
    expander.querySelector(".dcx-close")?.addEventListener("click", () => closeDocument(state));

    setActiveCategory(state, category);
    if (historyMode === "push") history.pushState({ category }, "", `#${targetHash}`);
    if (historyMode === "replace") history.replaceState({ category }, "", `#${targetHash}`);

    requestAnimationFrame(() => {
      expander.classList.add("is-full");
      const target = targetFromHash(state, targetHash, category);
      scrollToTarget(state, target, category, { instant: true, historyMode: "none", hash: targetHash });
      window.setTimeout(() => {
        expander.classList.add("is-ready");
        expander.querySelector(".dcx-close")?.focus({ preventScroll: true });
      }, REDUCED_MOTION.matches ? 0 : 260);
    });
    [180, 520, 1100, 1800, 3000].forEach((delay) => {
      window.setTimeout(() => {
        if (documentState === state && !state.userInteracted) {
          const target = targetFromHash(state, state.initialHash, category);
          scrollToTarget(state, target, category, {
            instant: true,
            historyMode: "replace",
            hash: state.initialHash,
          });
        }
      }, delay);
    });
    return true;
  };

  const handleTileClick = (event) => {
    const tile = event.target.closest(".dcx-tile[data-category]");
    if (!tile || !document.querySelector("[data-dcx-shell]")?.contains(tile)) return;
    if (!CATEGORY_SET.has(tile.dataset.category)) return;
    if (!templatesReady()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDocument(tile.dataset.category, { opener: tile });
  };

  const handleKeydown = (event) => {
    if (event.key === "Escape" && document.querySelector("#dcx-context-settings[open]")) return;
    if (event.key === "Escape" && documentState) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDocument(documentState);
      return;
    }
    if (documentState && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
      documentState.userInteracted = true;
      releasePinnedCategory(documentState);
    }
  };

  const handlePopstate = (event) => {
    const hash = location.hash.slice(1);
    const category = categoryFromHash(hash);
    if (documentState?.closing && category) {
      event.stopImmediatePropagation();
      window.closeDcxSettings?.({ restoreFocus: false, instant: true });
      const closingState = documentState;
      window.clearTimeout(closingState.closeTimer);
      closingState.expander.remove();
      if (closingState.background) {
        closingState.background.inert = false;
        closingState.background.removeAttribute("aria-hidden");
      }
      document.body.classList.remove("is-locked");
      documentState = null;
      openDocument(category, { historyMode: "none", targetHash: hash });
      return;
    }
    if (!documentState) {
      if (!category) {
        pendingInitialCategory = "";
        pendingInitialHash = "";
        return;
      }
      event.stopImmediatePropagation();
      if (templatesReady()) {
        openDocument(category, { historyMode: "none", targetHash: hash });
      } else {
        pendingInitialCategory = category;
        pendingInitialHash = hash;
        if (!pendingObserver) {
          pendingObserver = new MutationObserver(schedulePendingDocument);
          pendingObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "hidden"],
          });
        }
        schedulePendingDocument();
      }
      return;
    }

    event.stopImmediatePropagation();
    if (category) {
      const target = targetFromHash(documentState, hash, category);
      scrollToTarget(documentState, target, category, { historyMode: "none", hash });
    } else {
      closeDocument(documentState, { updateHistory: false });
    }
  };

  const openPendingDocument = () => {
    revealFrame = 0;
    if (!pendingInitialCategory) {
      if (document.body.classList.contains("dcx-open") && templatesReady()) {
        pendingObserver?.disconnect();
        pendingObserver = null;
      }
      return;
    }
    if (documentState) return;
    const shell = document.querySelector("[data-dcx-shell]");
    if (!document.body.classList.contains("dcx-open") || shell?.hidden || !templatesReady()) return;
    const category = pendingInitialCategory;
    const targetHash = pendingInitialHash || category;
    if (openDocument(category, { historyMode: "replace", targetHash })) {
      pendingInitialCategory = "";
      pendingInitialHash = "";
      pendingObserver?.disconnect();
      pendingObserver = null;
    }
  };

  const schedulePendingDocument = () => {
    if (revealFrame) return;
    revealFrame = requestAnimationFrame(openPendingDocument);
  };

  const handleCommandCopy = async (event) => {
    const button = event.target.closest?.("[data-dcx-copy-command]");
    if (!button) return;

    const command = button.dataset.dcxCopyCommand;
    const status = button.closest("[data-dcx-command-context]")
      ?.querySelector(".dcx-command-status");
    const copied = await copyText(command);

    window.clearTimeout(button._dcxCopyTimer);
    button.classList.remove("copied");
    void button.offsetWidth;
    button.classList.toggle("copied", copied);
    button.dataset.copied = String(copied);
    if (status) status.textContent = copied ? "Command copied." : "The command could not be copied.";
    button._dcxCopyTimer = window.setTimeout(() => {
      button.classList.remove("copied");
      button.removeAttribute("data-copied");
      if (status) status.textContent = "";
    }, 1200);
  };

  /* Integration hook: the data layer re-renders the detail templates when the
     store moves (a request the agent finished, a value it settled). The mounted
     document is built from clones, so it re-mounts here, holding the reader's
     place. Enhancers re-run on their own observers; scroll is restored after
     two frames so their layout has landed. */
  const remountDocument = () => {
    if (!documentState || documentState.closing) return;
    const state = documentState;
    const category = state.currentCategory || state.initialCategory;
    const scrollTop = state.main.scrollTop;
    state.userInteracted = true;
    releasePinnedCategory(state);
    mountArticles(state);
    prepareSubnavs(state);
    state.currentCategory = "";
    setActiveCategory(state, category);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        state.main.scrollTop = scrollTop;
      });
    });
  };

  window.dcxDocument = {
    isOpen: () => Boolean(documentState),
    currentCategory: () => documentState?.currentCategory || "",
    remount: remountDocument,
  };

  if (pendingInitialCategory) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
  document.addEventListener("click", handleTileClick, true);
  document.addEventListener("click", handleCommandCopy);
  document.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("popstate", handlePopstate, true);

  pendingObserver = new MutationObserver(schedulePendingDocument);
  pendingObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  schedulePendingDocument();
})();
