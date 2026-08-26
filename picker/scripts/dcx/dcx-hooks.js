import RULES from '../../data/hook-rules.json';

(() => {
  "use strict";

  const STORAGE_KEY = "dcx-hooks-preview-v1";
  const MOBILE_FAMILIES = window.matchMedia("(max-width: 560px)");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FAMILY_META = {
    fingerprints: {
      label: "Fingerprints",
      description: "Recurring signatures found across generated interfaces.",
    },
    slop: {
      label: "UI tells",
      description: "Common generated-UI habits that make a design feel interchangeable.",
    },
    quality: {
      label: "Quality floor",
      description: "Measurable defects in legibility, hierarchy, overflow, and system consistency.",
    },
  };
  const DISCIPLINE_ORDER = [
    "Visual Details",
    "Typography",
    "Color & Contrast",
    "Layout & Space",
    "Motion",
    "Imagery",
    "Copy",
    "Quality",
  ];

  const initialState = () => ({
    enabled: true,
    activeFamily: "fingerprints",
    disabled: ["em-dash-overuse"],
    custom: [],
  });

  const loadState = () => {
    const fallback = initialState();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return fallback;
      return {
        enabled: parsed.enabled !== false,
        activeFamily: FAMILY_META[parsed.activeFamily] ? parsed.activeFamily : fallback.activeFamily,
        disabled: Array.isArray(parsed.disabled)
          ? parsed.disabled.filter((id) => typeof id === "string")
          : fallback.disabled,
        custom: Array.isArray(parsed.custom)
          ? parsed.custom.filter((rule) => rule && typeof rule.id === "string" && typeof rule.name === "string")
          : [],
      };
    } catch {
      return fallback;
    }
  };

  const state = loadState();
  const disabledRules = new Set(state.disabled);
  const disciplineAnimations = new WeakMap();
  const customFormAnimations = new WeakMap();
  let syncFrame = 0;

  const persist = () => {
    state.disabled = [...disabledRules];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The file:// preview may deny storage; the in-memory controls still work.
    }
  };

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const slugify = (value) => String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "custom-rule";

  const compactDescription = (value) => {
    const text = String(value).trim();
    const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
    return firstSentence || text;
  };

  const templateMarkup = () => `
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
  `;

  const renameInterfaceToHooks = () => {
    const tile = document.querySelector('.dcx-tile[data-category="interface"]');
    if (tile) {
      tile.dataset.category = "hooks";
      tile.dataset.name = "Hooks";
      tile.setAttribute("aria-label", "Open Hooks");
      const title = tile.querySelector(".dcx-tile-title");
      if (title) title.textContent = "Hooks";
    }

    const shellTemplate = document.querySelector("#dcx-shell-template");
    const navItem = shellTemplate?.content.querySelector('li[data-category="interface"]');
    const navLink = navItem?.querySelector(".dcx-nav-link");
    if (navItem && navLink) {
      navItem.dataset.category = "hooks";
      navLink.href = "#hooks";
      navLink.dataset.dcxNav = "hooks";
      navLink.textContent = "Hooks";
    }
  };

  const installTemplate = () => {
    if (document.querySelector("#dcx-detail-hooks")) return;
    const template = document.createElement("template");
    template.id = "dcx-detail-hooks";
    template.innerHTML = templateMarkup();
    document.querySelector("#dcx-detail-interface")?.after(template);
  };

  const familyRules = (family) => RULES.filter((rule) => rule.group === family);
  const isEnabled = (id) => !disabledRules.has(id);

  const revealSelectedFamily = (target) => {
    if (!MOBILE_FAMILIES.matches) return;
    const selected = target.querySelector('[data-hooks-family][aria-selected="true"]');
    if (!selected) return;

    const viewport = target.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    let delta = 0;
    if (item.left < viewport.left + 3) delta = item.left - viewport.left - 3;
    else if (item.right > viewport.right - 3) delta = item.right - viewport.right + 3;
    if (Math.abs(delta) < 1) return;
    target.scrollTo({
      left: Math.max(0, target.scrollLeft + delta),
      behavior: REDUCED_MOTION.matches ? "auto" : "smooth",
    });
  };

  const setDisciplineOpen = (details, expanded) => {
    const panel = details.querySelector(":scope > .dcx-hooks-disclosure");
    const inner = panel?.querySelector(":scope > .dcx-hooks-disclosure-inner");
    if (!panel || !inner) {
      details.open = expanded;
      return;
    }

    const previous = disciplineAnimations.get(details);
    const currentHeight = panel.getBoundingClientRect().height;
    const currentOpacity = Number.parseFloat(getComputedStyle(panel).opacity) || 0;
    previous?.cancel();

    if (REDUCED_MOTION.matches) {
      disciplineAnimations.delete(details);
      details.classList.remove("is-closing");
      details.open = expanded;
      panel.style.removeProperty("height");
      panel.style.removeProperty("opacity");
      return;
    }

    details.open = true;
    details.classList.toggle("is-closing", !expanded);
    const fromHeight = previous ? currentHeight : expanded ? 0 : currentHeight;
    const fromOpacity = previous ? currentOpacity : expanded ? 0 : 1;
    const toHeight = expanded ? inner.scrollHeight : 0;
    const toOpacity = expanded ? 1 : 0;

    const animation = panel.animate([
      { height: `${fromHeight}px`, opacity: fromOpacity },
      { height: `${toHeight}px`, opacity: toOpacity },
    ], {
      duration: 360,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });
    disciplineAnimations.set(details, animation);

    animation.finished.then(() => {
      if (disciplineAnimations.get(details) !== animation) return;
      disciplineAnimations.delete(details);
      details.classList.remove("is-closing");
      details.open = expanded;
      animation.cancel();
      panel.style.removeProperty("height");
      panel.style.removeProperty("opacity");
    }).catch(() => {});
  };

  const setCustomFormOpen = (form, expanded) => {
    const previous = customFormAnimations.get(form);
    const currentHeight = form.hidden ? 0 : form.getBoundingClientRect().height;
    const currentOpacity = form.hidden ? 0 : Number.parseFloat(getComputedStyle(form).opacity) || 1;
    previous?.cancel();

    if (REDUCED_MOTION.matches) {
      customFormAnimations.delete(form);
      form.hidden = !expanded;
      return;
    }

    if (expanded) form.hidden = false;
    const toHeight = expanded ? form.scrollHeight : 0;
    form.style.overflow = "clip";
    const animation = form.animate([
      { height: `${currentHeight}px`, opacity: currentOpacity },
      { height: `${toHeight}px`, opacity: expanded ? 1 : 0 },
    ], {
      duration: 320,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });
    customFormAnimations.set(form, animation);

    animation.finished.then(() => {
      if (customFormAnimations.get(form) !== animation) return;
      customFormAnimations.delete(form);
      form.hidden = !expanded;
      animation.cancel();
      form.style.removeProperty("height");
      form.style.removeProperty("opacity");
      form.style.removeProperty("overflow");
    }).catch(() => {});
  };

  const toggleDiscipline = (article, summary) => {
    const disclosure = summary.parentElement;
    const expanded = !disclosure.open || disclosure.classList.contains("is-closing");
    const query = article.querySelector("[data-hooks-search]")?.value.trim();
    if (expanded && !query) {
      disclosure.parentElement?.querySelectorAll(":scope > .dcx-hooks-discipline[open]").forEach((sibling) => {
        if (sibling !== disclosure) setDisciplineOpen(sibling, false);
      });
    }
    setDisciplineOpen(disclosure, expanded);
  };

  const renderFamilies = (article) => {
    const target = article.querySelector("[data-hooks-families]");
    if (!target) return;
    target.innerHTML = Object.entries(FAMILY_META).map(([id, meta]) => {
      const rules = familyRules(id);
      const enabled = rules.filter((rule) => isEnabled(rule.id)).length;
      const selected = state.activeFamily === id;
      return `
        <button
          id="dcx-hooks-family-${id}"
          class="dcx-hooks-family${selected ? " is-active" : ""}"
          type="button"
          role="tab"
          tabindex="${selected ? "0" : "-1"}"
          aria-selected="${selected}"
          aria-label="${escapeHtml(meta.label)}, ${enabled} of ${rules.length} selected"
          aria-controls="dcx-hooks-rule-panel"
          data-hooks-family="${id}"
        >
          <span class="dcx-hooks-family-name">${escapeHtml(meta.label)}</span>
          <span class="dcx-hooks-family-count">${enabled}/${rules.length}</span>
        </button>
      `;
    }).join("");
    const panel = article.querySelector("#dcx-hooks-rule-panel");
    panel?.setAttribute("aria-labelledby", `dcx-hooks-family-${state.activeFamily}`);
    requestAnimationFrame(() => revealSelectedFamily(target));
  };

  const renderRules = (article) => {
    const target = article.querySelector("[data-hooks-rule-groups]");
    const summary = article.querySelector("[data-hooks-summary]");
    const search = article.querySelector("[data-hooks-search]");
    if (!target || !summary) return;

    const query = (search?.value || "").trim().toLowerCase();
    const rules = familyRules(state.activeFamily);
    const filtered = rules.filter((rule) => !query
      || `${rule.id} ${rule.name} ${rule.description} ${rule.discipline}`.toLowerCase().includes(query));
    const enabled = rules.filter((rule) => isEnabled(rule.id)).length;
    summary.textContent = query
      ? `${filtered.length} matching ${filtered.length === 1 ? "rule" : "rules"}`
      : `${enabled} of ${rules.length} selected`;

    const groups = new Map();
    filtered.forEach((rule) => {
      if (!groups.has(rule.discipline)) groups.set(rule.discipline, []);
      groups.get(rule.discipline).push(rule);
    });

    const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
      const ai = DISCIPLINE_ORDER.indexOf(a);
      const bi = DISCIPLINE_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
    });

    if (!orderedGroups.length) {
      target.innerHTML = '<p class="dcx-hooks-empty">No rules match this search.</p>';
      return;
    }

    target.innerHTML = orderedGroups.map(([discipline, entries], index) => {
      const disclosureId = `dcx-hooks-${state.activeFamily}-${slugify(discipline)}`;
      const summaryId = `${disclosureId}-summary`;
      return `
      <details class="dcx-hooks-discipline" ${query || index === 0 ? "open" : ""}>
        <summary id="${summaryId}">
          <span>${escapeHtml(discipline)}</span>
          <span>${entries.length}</span>
        </summary>
        <div class="dcx-hooks-disclosure" id="${disclosureId}" role="region" aria-labelledby="${summaryId}">
          <div class="dcx-hooks-disclosure-inner">
            <ul class="dcx-hooks-rules">
              ${entries.map((rule) => `
                <li class="dcx-hooks-rule" data-rule-id="${escapeHtml(rule.id)}">
                  <div class="dcx-hooks-rule-copy">
                    <strong>${escapeHtml(rule.name)}</strong>
                    <p>${escapeHtml(compactDescription(rule.description))}</p>
                  </div>
                  <label class="dcx-hooks-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-hooks-rule="${escapeHtml(rule.id)}"
                      aria-label="Enable ${escapeHtml(rule.name)}"
                      ${isEnabled(rule.id) ? "checked" : ""}
                    >
                    <span aria-hidden="true"></span>
                  </label>
                </li>
              `).join("")}
            </ul>
          </div>
        </div>
      </details>
    `;
    }).join("");
  };

  const renderCustom = (article) => {
    const target = article.querySelector("[data-hooks-custom-list]");
    const count = article.querySelector("[data-hooks-custom-count]");
    if (!target) return;

    if (count) {
      count.textContent = state.custom.length
        ? `${state.custom.length} custom ${state.custom.length === 1 ? "rule" : "rules"}`
        : "No custom rules.";
    }

    if (!state.custom.length) {
      target.innerHTML = "";
      return;
    }

    target.innerHTML = "";
    state.custom.forEach((rule) => {
      const row = document.createElement("article");
      row.className = "dcx-hooks-custom-rule";

      const copy = document.createElement("div");
      copy.className = "dcx-hooks-rule-copy";
      const id = document.createElement("code");
      id.textContent = rule.id;
      const name = document.createElement("strong");
      name.textContent = rule.name;
      const description = document.createElement("p");
      description.textContent = rule.description;
      const discipline = document.createElement("span");
      discipline.className = "dcx-hooks-custom-discipline";
      discipline.textContent = rule.discipline;
      copy.append(id, name, description, discipline);

      const controls = document.createElement("div");
      controls.className = "dcx-hooks-custom-controls";
      const toggle = document.createElement("label");
      toggle.className = "dcx-hooks-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-label", `Enable ${rule.name}`);
      input.dataset.hooksCustomRule = rule.id;
      input.checked = rule.enabled !== false;
      const track = document.createElement("span");
      track.setAttribute("aria-hidden", "true");
      toggle.append(input, track);

      const remove = document.createElement("button");
      remove.className = "dcx-hooks-remove";
      remove.type = "button";
      remove.dataset.hooksRemove = rule.id;
      remove.setAttribute("aria-label", `Remove ${rule.name}`);
      remove.textContent = "Remove";
      controls.append(toggle, remove);
      row.append(copy, controls);
      target.appendChild(row);
    });
  };

  const syncMaster = (article) => {
    const input = article.querySelector("[data-hooks-master]");
    const status = article.querySelector("[data-hooks-status]");
    const copy = article.querySelector("[data-hooks-master-copy]");
    const detail = article.querySelector("[data-hooks-master-detail]");
    const stateText = article.querySelector("[data-hooks-master-state]");
    if (!input || !status || !copy || !detail || !stateText) return;

    input.checked = state.enabled;
    status.classList.toggle("is-paused", !state.enabled);
    copy.textContent = "Enable hooks";
    detail.textContent = "Preview only — project settings are unchanged.";
    stateText.textContent = state.enabled ? "On" : "Off";
  };

  const renderArticle = (article) => {
    syncMaster(article);
    renderFamilies(article);
    renderRules(article);
    renderCustom(article);
  };

  const initializeMountedArticles = () => {
    syncFrame = 0;
    document.querySelectorAll('.dcx-article[data-dcx-category="hooks"]').forEach((article) => {
      if (article.dataset.dcxHooksReady === "true") return;
      article.dataset.dcxHooksReady = "true";
      renderArticle(article);
    });
  };

  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(initializeMountedArticles);
  };

  document.addEventListener("click", (event) => {
    const article = event.target.closest('.dcx-article[data-dcx-category="hooks"]');
    if (!article) return;

    const summary = event.target.closest(".dcx-hooks-discipline > summary");
    if (summary) {
      event.preventDefault();
      toggleDiscipline(article, summary);
      return;
    }

    const family = event.target.closest("[data-hooks-family]");
    if (family) {
      const restoreFocus = family === document.activeElement;
      state.activeFamily = family.dataset.hooksFamily;
      persist();
      renderFamilies(article);
      renderRules(article);
      if (restoreFocus) {
        article.querySelector(`[data-hooks-family="${state.activeFamily}"]`)?.focus({ preventScroll: true });
      }
      return;
    }

    const add = event.target.closest("[data-hooks-add]");
    if (add) {
      const form = article.querySelector("[data-hooks-form]");
      if (!form) return;
      setCustomFormOpen(form, true);
      add.setAttribute("aria-expanded", "true");
      form.querySelector("input[name='name']")?.focus();
      return;
    }

    const cancel = event.target.closest("[data-hooks-cancel]");
    if (cancel) {
      const form = article.querySelector("[data-hooks-form]");
      form?.reset();
      if (form) setCustomFormOpen(form, false);
      const addButton = article.querySelector("[data-hooks-add]");
      addButton?.setAttribute("aria-expanded", "false");
      addButton?.focus({ preventScroll: true });
      return;
    }

    const remove = event.target.closest("[data-hooks-remove]");
    if (remove) {
      state.custom = state.custom.filter((rule) => rule.id !== remove.dataset.hooksRemove);
      persist();
      renderCustom(article);
      (article.querySelector("[data-hooks-remove]") || article.querySelector("[data-hooks-add]"))
        ?.focus({ preventScroll: true });
    }
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-hooks-search]")) return;
    const article = event.target.closest('.dcx-article[data-dcx-category="hooks"]');
    if (article) renderRules(article);
  });

  document.addEventListener("keydown", (event) => {
    const summary = event.target.closest(".dcx-hooks-discipline > summary");
    if (summary && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) {
        const article = summary.closest('.dcx-article[data-dcx-category="hooks"]');
        if (article) toggleDiscipline(article, summary);
      }
      return;
    }

    const family = event.target.closest("[data-hooks-family]");
    if (!family || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const article = family.closest('.dcx-article[data-dcx-category="hooks"]');
    const buttons = [...article.querySelectorAll("[data-hooks-family]")];
    const index = buttons.indexOf(family);
    if (index < 0) return;

    event.preventDefault();
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + direction + buttons.length) % buttons.length;
    buttons[nextIndex].click();
    article.querySelector(`[data-hooks-family="${state.activeFamily}"]`)?.focus();
  });

  document.addEventListener("change", (event) => {
    const article = event.target.closest('.dcx-article[data-dcx-category="hooks"]');
    if (!article) return;

    if (event.target.matches("[data-hooks-master]")) {
      state.enabled = event.target.checked;
      persist();
      syncMaster(article);
      return;
    }

    if (event.target.matches("[data-hooks-rule]")) {
      if (event.target.checked) disabledRules.delete(event.target.dataset.hooksRule);
      else disabledRules.add(event.target.dataset.hooksRule);
      persist();
      renderFamilies(article);
      const query = article.querySelector("[data-hooks-search]")?.value.trim();
      const summary = article.querySelector("[data-hooks-summary]");
      if (!query && summary) {
        const rules = familyRules(state.activeFamily);
        summary.textContent = `${rules.filter((rule) => isEnabled(rule.id)).length} of ${rules.length} selected`;
      }
      return;
    }

    if (event.target.matches("[data-hooks-custom-rule]")) {
      const rule = state.custom.find((entry) => entry.id === event.target.dataset.hooksCustomRule);
      if (rule) {
        rule.enabled = event.target.checked;
        persist();
      }
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-hooks-form]");
    if (!form) return;
    event.preventDefault();
    const article = form.closest('.dcx-article[data-dcx-category="hooks"]');
    if (!article) return;

    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    const discipline = String(data.get("discipline") || "Visual Details");
    if (!name || !description) return;

    const base = slugify(name);
    let id = base;
    let suffix = 2;
    const existing = new Set([...RULES.map((rule) => rule.id), ...state.custom.map((rule) => rule.id)]);
    while (existing.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }

    state.custom.push({ id, name, description, discipline, enabled: true });
    persist();
    form.reset();
    setCustomFormOpen(form, false);
    const addButton = article.querySelector("[data-hooks-add]");
    addButton?.setAttribute("aria-expanded", "false");
    renderCustom(article);
    addButton?.focus({ preventScroll: true });
  });

  renameInterfaceToHooks();
  installTemplate();

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
})();
