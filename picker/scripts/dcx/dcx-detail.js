import { dcxAsset } from './assets.js';

(() => {
  "use strict";

  const DETAIL_META = {
    product: {
      "Purpose": ["Why the product exists and what success looks like.", "/assets/product/product-purpose-foil.png"],
      "Positioning": ["The strategic space this product should occupy.", "/assets/product/product-positioning-foil.png"],
      "Primary conversion": ["The single action the experience should make inevitable.", "/assets/product/product-primary-conversion-foil.png"],
      "What must be clear first": ["The facts people need before anything else.", "/assets/product/product-clear-first-foil.png"],
      "Product principles": ["The rules that keep every product decision aligned.", "/assets/product/product-principles-foil.png"],
      "Operating context": ["Where and how the product must work.", "/assets/product/product-operating-context-foil.png"],
      "Surfaces": ["The chosen experiences and the job each one performs.", "/assets/product/product-surfaces-foil.png"],
    },
    brand: {
      "Personality": ["The character every expression should carry.", "/assets/brand/brand-personality-foil.png"],
      "Voice": ["How the brand sounds—and what it deliberately avoids.", "/assets/brand/brand-voice-foil.png"],
      "Principles": ["The rules that turn character into consistent choices.", "/assets/brand/brand-principles-foil.png"],
      "Commitments": ["The promises the brand must keep.", "/assets/brand/brand-commitments-foil.png"],
      "Named references": ["Useful signals to borrow without becoming an imitation."],
      "Anti-reference": ["The direction the brand must deliberately avoid."],
      "Marks": ["The identity assets already available to the system."],
      "Boards and references": ["Visual evidence that should inform the work."],
      "Assets provided": ["The source material available for production."],
      "Brand assets": ["Logos, moodboards, and visual references available to the system."],
    },
    color: {
      "The cue": ["", "/assets/color/color-palette-foil.png"],
      "Also generated": ["Adjacent directions retained as useful context."],
      "Palette": ["The core color relationships for the experience.", "/assets/color/color-palette-foil.png"],
      "Strategy per surface": ["How the palette changes emphasis across contexts.", "/assets/color/color-strategy-per-surface-foil.png"],
    },
    typography: {
      "The pair": ["Two typefaces with distinct, complementary jobs.", "/assets/typography/typography-pair-foil.png"],
      "Type scale": ["The hierarchy that gives content pace and proportion.", "/assets/typography/typography-type-scale-foil.png"],
      "In running text": ["How the pair behaves when the content gets real."],
    },
    components: {
      "Buttons": ["Variants, sizes, icons, and loading states."],
      "Input fields": ["States, sizes, affixes, and multiline input."],
      "Cards": ["Content, media, horizontal, and action compositions."],
    },
    material: {
      "The page, as chosen": ["What each selected surface represents in this design context."],
      "Motion per surface": ["How movement supports each context without becoming spectacle."],
      "Motion": ["How movement should support the experience."],
      "Accessibility": ["The rules that keep the material system readable and operable."],
      "Layout structure": ["The spatial system that organizes the page.", "/assets/material/material-layout-structure-foil.png"],
      "Boundaries per surface": ["Where separation is visible—and where space does the work.", "/assets/material/material-boundaries-per-surface-foil.png"],
      "Corners per surface": ["How edge character changes with context.", "/assets/material/material-corners-per-surface-foil.png"],
      "Depth per surface": ["How hierarchy is expressed without decorative elevation.", "/assets/material/material-depth-per-surface-foil.png"],
      "Iconography": ["The chosen icon library, its character, grid, stroke, and license."],
    },
    hooks: {
      "How it runs": [""],
      "Built-in rules": ["Choose what the detector watches."],
      "Custom rules": [""],
    },
  };

  let syncFrame = 0;

  const slugify = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const wrapPrincipleContent = (section, category) => {
    section.querySelectorAll(":scope .dcx-principles > li").forEach((item) => {
      let copy = item.querySelector(":scope > .dcx-detail-principle-copy");
      if (!copy) {
        copy = document.createElement("div");
        copy.className = "dcx-detail-principle-copy";
        while (item.firstChild) copy.appendChild(item.firstChild);
        item.appendChild(copy);
      }
      if (category === "product" && section.dataset.label === "Product principles") {
        const detail = copy.querySelector(":scope > strong:first-child")?.nextSibling;
        if (detail?.nodeType === Node.TEXT_NODE) {
          detail.textContent = detail.textContent.replace(/^\s*[—–-]+\s*/, " ");
        }
      }
    });
  };

  const demoteBodyHeadings = (body) => {
    body.querySelectorAll("h3").forEach((heading) => {
      const replacement = document.createElement("h4");
      [...heading.attributes].forEach((attribute) => {
        replacement.setAttribute(attribute.name, attribute.value);
      });
      while (heading.firstChild) replacement.appendChild(heading.firstChild);
      heading.replaceWith(replacement);
    });
  };

  const placeProductPlatform = (section, category) => {
    if (category !== "product" || section.dataset.label !== "Purpose") return;

    const callout = section.querySelector(":scope .dcx-purpose .dcx-callout");
    const name = callout?.querySelector(":scope > .dcx-callout-name");
    const platform = section.querySelector(":scope .dcx-purpose > .dcx-platform-pill");
    if (!callout || !name || !platform) return;

    platform.classList.remove("dcx-chip");
    name.after(platform);
  };

  const removeProvenanceNotes = (section) => {
    section.querySelectorAll(":scope .dcx-fan-note").forEach((note) => note.remove());
  };

  const compactColorArticle = (article) => {
    if (article.dataset.dcxColorCompacted === "true") return;

    const sections = new Map(
      [...article.querySelectorAll(":scope > .dcx-block[data-label]")]
        .map((section) => [section.dataset.label, section]),
    );
    const cueSection = sections.get("The cue");
    const paletteSection = sections.get("Palette");
    const strategySection = sections.get("Strategy per surface");
    const cue = cueSection?.querySelector(":scope > .dcx-cue");
    const fan = paletteSection?.querySelector(":scope > .dcx-fan");

    cueSection?.querySelector(":scope > .dcx-fan-note")?.remove();
    strategySection?.querySelector(":scope > .dcx-fan-note")?.remove();
    sections.get("Roles and values")?.remove();
    sections.get("Interview direction")?.remove();

    if (cue && fan) {
      const cueCard = cue.querySelector(":scope > .dcx-cue-card");
      const panels = [...fan.querySelectorAll(":scope > .dcx-fan-panel")];
      if (cueCard && panels.length) {
        cueCard.querySelector(":scope > .dcx-cue-tag")?.remove();
        cueCard.querySelector(":scope > .dcx-cue-name")?.remove();

        const bands = document.createElement("ul");
        bands.className = "dcx-cue-bands";
        bands.setAttribute("aria-label", "Committed palette");

        panels.forEach((panel) => {
          const role = panel.querySelector(":scope .dcx-fan-name")?.textContent.trim() || "Color";
          const value = panel.querySelector(":scope .dcx-fan-value")?.textContent.trim() || "";
          const color = panel.style.getPropertyValue("--panel-swatch");
          const ink = panel.style.getPropertyValue("--panel-ink");

          const item = document.createElement("li");
          item.className = "dcx-cue-band-item";

          const swatch = document.createElement("div");
          swatch.className = "dcx-cue-band";
          swatch.style.setProperty("--band-color", color);
          swatch.style.setProperty("--band-ink", ink);

          const hex = document.createElement("code");
          hex.className = "dcx-cue-band-value";
          hex.textContent = value;
          swatch.appendChild(hex);

          const label = document.createElement("span");
          label.className = "dcx-cue-band-label";
          label.textContent = role;
          item.append(swatch, label);
          bands.appendChild(item);
        });

        cueCard.querySelectorAll(":scope > .dcx-cue-role").forEach((role) => role.remove());
        cueCard.appendChild(bands);
        paletteSection.remove();
      }
    }

    const heroLede = article.querySelector(":scope > header > .dcx-lede");
    if (heroLede) heroLede.textContent = "Committed palette and per-surface strategy.";
    article.dataset.dcxColorCompacted = "true";
  };

  const replaceMaterialPagePreviews = (article) => {
    const section = article.querySelector(':scope > .dcx-block[data-label="The page, as chosen"]');
    const previews = section?.querySelector(":scope > .dcx-surfaces");
    if (!previews) return;

    /* One definition per chosen surface, published by the data layer at render
       time (design-context.js renderDocument). If the list is missing the
       original preview boards stay, which is a visible fallback rather than an
       empty section. */
    const entries = Array.isArray(window.dcxSurfaceDefs) ? window.dcxSurfaceDefs : [];
    if (!entries.length) return;

    const definitions = document.createElement("dl");
    definitions.className = "dcx-defs";
    entries.forEach(({ label, description }) => {
      const item = document.createElement("div");
      item.className = "dcx-def";
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = description;
      item.append(term, detail);
      definitions.appendChild(item);
    });

    previews.replaceWith(definitions);
  };

  const enhanceSection = (section, category, iconIndex) => {
    const label = section.dataset.label || "Section";
    const [ledeText, icon] = DETAIL_META[category]?.[label] || ["The decisions that define this part of the system."];
    const slug = `${category}-${slugify(label)}`;

    section.querySelector(":scope > .dcx-block-label")?.remove();

    const body = document.createElement("div");
    body.className = "dcx-detail-section-body";
    while (section.firstChild) body.appendChild(section.firstChild);

    const heading = document.createElement("div");
    heading.className = "dcx-detail-section-heading";

    const title = document.createElement("h3");
    title.className = "dcx-detail-section-title";
    title.id = `dcx-${slug}-title`;
    title.textContent = label;

    heading.appendChild(title);
    if (ledeText) {
      const lede = document.createElement("p");
      lede.className = "dcx-detail-section-lede";
      lede.textContent = ledeText;
      heading.appendChild(lede);
    }

    const header = document.createElement("header");
    header.className = "dcx-detail-section-head";
    header.appendChild(heading);

    if (icon) {
      header.classList.add("dcx-detail-section-head--with-icon");
      const figure = document.createElement("figure");
      figure.className = "dcx-detail-section-icon";
      figure.setAttribute("aria-hidden", "true");
      figure.setAttribute("data-dcx-hide-on-error", "");

      const image = document.createElement("img");
      image.src = dcxAsset(icon);
      image.alt = "";
      image.width = 256;
      image.height = 256;
      image.decoding = "async";
      if (section.closest(".dcx-article")?.dataset.dcxCategory || iconIndex > 0) image.loading = "lazy";
      figure.appendChild(image);
      header.appendChild(figure);
    }

    section.classList.add("dcx-detail-section", `dcx-detail-section--${slugify(label)}`);
    section.id = `dcx-${slug}`;
    if (!section.closest(".dcx-article")?.dataset.dcxCategory) {
      section.setAttribute("role", "region");
      section.setAttribute("aria-labelledby", title.id);
    }
    section.append(header, body);

    demoteBodyHeadings(body);
    body.querySelector(":scope > .dcx-list")?.classList.add("dcx-detail-list");
    body.querySelector(":scope > .dcx-defs")?.classList.add("dcx-detail-defs");
    wrapPrincipleContent(section, category);
    placeProductPlatform(section, category);
    removeProvenanceNotes(section);
  };

  const enhanceArticle = (article, category) => {
    if (article.dataset.dcxDetailEnhanced === category) return;

    if (category === "color") compactColorArticle(article);
    if (category === "typography") {
      article.querySelectorAll(":scope .dcx-pair-why").forEach((note) => note.remove());
      article.querySelector(':scope > .dcx-block[data-label="Interview direction"]')?.remove();
    }
    if (category === "iconography") {
      article.querySelector(':scope > .dcx-block[data-label="The hand"]')?.remove();
    }
    if (category === "material") {
      replaceMaterialPagePreviews(article);
      article.querySelectorAll(":scope > .dcx-block[data-label] > .dcx-fan-note")
        .forEach((note) => note.remove());
    }
    article.classList.add("dcx-detail-article", `dcx-detail-article--${category}`);
    article.querySelector(":scope > header")?.classList.add("dcx-detail-hero");

    let iconIndex = 0;
    article.querySelectorAll(":scope > .dcx-block[data-label]").forEach((section) => {
      const hasIcon = Boolean(DETAIL_META[category]?.[section.dataset.label]?.[1]);
      enhanceSection(section, category, iconIndex);
      if (hasIcon) iconIndex += 1;
    });

    article.dataset.dcxDetailEnhanced = category;
  };

  const syncDetails = () => {
    syncFrame = 0;
    const expander = document.querySelector(".dcx-expander");
    const continuousArticles = expander?.querySelectorAll('.dcx-main > .dcx-article[data-dcx-category]');
    if (continuousArticles?.length) {
      continuousArticles.forEach((article) => {
        const category = article.dataset.dcxCategory;
        if (category !== "audience" && DETAIL_META[category]) enhanceArticle(article, category);
      });
      return;
    }

    const activeItem = expander?.querySelector(".dcx-nav-list > li.is-active[data-category]");
    const article = expander?.querySelector(".dcx-main > .dcx-article");
    const category = activeItem?.dataset.category;
    if (!article || !category || category === "audience" || !DETAIL_META[category]) return;
    enhanceArticle(article, category);
  };

  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(syncDetails);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
})();
