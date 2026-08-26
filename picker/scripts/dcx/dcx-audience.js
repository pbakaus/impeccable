import { dcxAsset } from './assets.js';

(() => {
  "use strict";

  const SECTION_META = [
    {
      labels: ["Who they are"],
      slug: "who-they-are",
      variant: "people",
      lede: "The core people this experience must speak to.",
      icon: "audience-groups-foil.png",
    },
    {
      labels: ["Emotional journey", "Emotional state"],
      slug: "emotional-journey",
      variant: "journey",
      lede: "The change in confidence the experience should create.",
      icon: "emotional-journey-foil.png",
    },
    {
      labels: ["Needs"],
      slug: "needs",
      variant: "list",
      lede: "What the experience must make clear and easy.",
      icon: "needs-foil.png",
    },
    {
      labels: ["Trust triggers"],
      slug: "trust-triggers",
      variant: "list",
      lede: "The signals that turn interest into confidence.",
      icon: "trust-triggers-foil.png",
    },
    {
      labels: ["Who must not be excluded"],
      slug: "inclusion",
      variant: "list",
      lede: "Access requirements that belong in the core experience.",
      icon: "inclusion-foil.png",
    },
  ];

  let syncFrame = 0;

  const findMeta = (label) => SECTION_META.find((meta) => meta.labels.includes(label));

  const unwrapColumns = (article) => {
    article.querySelectorAll(":scope > .dcx-cols").forEach((columns) => {
      const fragment = document.createDocumentFragment();
      [...columns.children].forEach((child) => fragment.appendChild(child));
      columns.replaceWith(fragment);
    });
  };

  const enhanceAudienceArticle = (article) => {
    if (article.dataset.dcxAudienceEnhanced === "true") return;

    article.classList.add("dcx-audience");
    article.querySelector(":scope > header")?.classList.add("dcx-audience-hero");
    unwrapColumns(article);

    const sections = [...article.querySelectorAll(":scope > .dcx-block[data-label]")];
    sections.forEach((section, index) => {
      const label = section.dataset.label || "";
      const meta = findMeta(label);
      if (!meta) return;

      const oldLabel = section.querySelector(":scope > .dcx-block-label");
      oldLabel?.remove();

      const body = document.createElement("div");
      body.className = "dcx-audience-section-body";
      while (section.firstChild) body.appendChild(section.firstChild);

      const heading = document.createElement("div");
      heading.className = "dcx-audience-section-heading";

      const title = document.createElement("h3");
      title.className = "dcx-audience-section-title";
      title.id = `dcx-audience-${meta.slug}-title`;
      title.textContent = label;

      const lede = document.createElement("p");
      lede.className = "dcx-audience-section-lede";
      lede.textContent = meta.lede;
      heading.append(title, lede);

      const figure = document.createElement("figure");
      figure.className = "dcx-audience-section-icon";
      figure.setAttribute("data-dcx-hide-on-error", "");
      figure.setAttribute("aria-hidden", "true");

      const image = document.createElement("img");
      image.src = dcxAsset(`/assets/audience/${meta.icon}`);
      image.alt = "";
      image.width = 256;
      image.height = 256;
      image.decoding = "async";
      if (index > 0) image.loading = "lazy";
      figure.appendChild(image);

      const header = document.createElement("header");
      header.className = "dcx-audience-section-head";
      header.append(heading, figure);

      section.classList.add("dcx-audience-section", `dcx-audience-section--${meta.variant}`);
      section.id = `dcx-audience-${meta.slug}`;
      if (!article.dataset.dcxCategory) {
        section.setAttribute("role", "region");
        section.setAttribute("aria-labelledby", title.id);
      }

      if (meta.variant === "journey") {
        const journey = body.querySelector(".dcx-callout-pair");
        if (journey) {
          journey.classList.add("dcx-audience-journey");
          if (journey.children.length > 1) {
            const arrow = document.createElement("div");
            arrow.className = "dcx-audience-journey-arrow";
            arrow.setAttribute("aria-hidden", "true");
            arrow.textContent = "→";
            journey.children[0].after(arrow);
          }
        }
      }

      if (meta.variant === "list") {
        body.querySelector(".dcx-list")?.classList.add("dcx-audience-list");
      }

      section.append(header, body);
    });

    article.dataset.dcxAudienceEnhanced = "true";
  };

  const syncAudience = () => {
    syncFrame = 0;
    const expander = document.querySelector(".dcx-expander");
    if (!expander) return;

    const continuousArticle = expander.querySelector('.dcx-main > .dcx-article[data-dcx-category="audience"]');
    if (continuousArticle) {
      enhanceAudienceArticle(continuousArticle);
      return;
    }

    const audienceItem = expander.querySelector('.dcx-nav-list li[data-category="audience"].is-active');
    const article = expander.querySelector(".dcx-main > .dcx-article");
    if (audienceItem && article) enhanceAudienceArticle(article);
  };

  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(syncAudience);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
})();
