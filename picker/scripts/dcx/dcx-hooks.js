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
  const EXCEPTION_KINDS = {
    value: { label: "Silence one value", hint: "One rule stops flagging one exact value, everywhere." },
    "rule-in-files": { label: "Silence a rule in files", hint: "One rule goes quiet in matching files and stays live everywhere else." },
    file: { label: "Skip a file entirely", hint: "Every rule skips matching files. The widest exception; prefer the two above." },
  };

  /* Only the view preference persists in the browser. The state that matters
     lives in the project's .impeccable/config.json and arrives from the doc
     session, so the page shows what the hook will actually do, not a preview. */
  const loadView = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return { activeFamily: parsed && FAMILY_META[parsed.activeFamily] ? parsed.activeFamily : "fingerprints" };
    } catch {
      return { activeFamily: "fingerprints" };
    }
  };

  const view = loadView();

  const persistView = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeFamily: view.activeFamily }));
    } catch {
      // The file:// preview may deny storage; the in-memory controls still work.
    }
  };

  /* live is the last state the project confirmed; draft is what the controls
     show. Apply sends the whole draft and the server's echo becomes the new
     live, so the page and .impeccable/config.json can only disagree while the
     Apply bar is visible and says so. */
  let live = null;
  let draft = null;
  let liveError = "";
  let applying = false;
  let appliedFlash = false;
  let appliedFlashTimer = 0;
  let fetchStarted = false;

  const docSession = () => window.dcxDocSession || null;
  const hooksUrl = () => {
    const session = docSession();
    if (!session?.base || !session?.token) return "";
    return `${session.base}/doc/hooks?token=${encodeURIComponent(session.token)}`;
  };

  const cloneState = (state) => JSON.parse(JSON.stringify(state));

  const entryKey = (entry) => {
    const files = Array.isArray(entry.files) && entry.files.length > 0 ? [...entry.files].sort().join("\u001f") : "";
    return `${entry.rule}\u0000${entry.value}\u0000${files}`;
  };

  const changeCount = () => {
    if (!live || !draft) return 0;
    let count = draft.enabled !== live.enabled ? 1 : 0;
    const liveRules = new Set(live.ignoreRules);
    const draftRules = new Set(draft.ignoreRules);
    for (const id of draftRules) if (!liveRules.has(id)) count += 1;
    for (const id of liveRules) if (!draftRules.has(id)) count += 1;
    const liveFiles = new Set(live.ignoreFiles);
    const draftFiles = new Set(draft.ignoreFiles);
    for (const glob of draftFiles) if (!liveFiles.has(glob)) count += 1;
    for (const glob of liveFiles) if (!draftFiles.has(glob)) count += 1;
    const liveValues = new Map(live.ignoreValues.map((entry) => [entryKey(entry), entry]));
    const draftValues = new Map(draft.ignoreValues.map((entry) => [entryKey(entry), entry]));
    for (const key of draftValues.keys()) if (!liveValues.has(key)) count += 1;
    for (const key of liveValues.keys()) if (!draftValues.has(key)) count += 1;
    return count;
  };

  /* Three-way rebase for an apply that lost the race: keep every edit the
     visitor made (draft against the state the page read) and land it on what
     the project now holds, so nothing another writer added is dropped. */
  const rebaseDraft = (oldLive, oldDraft, newLive) => {
    const next = cloneState(newLive);
    if (oldDraft.enabled !== oldLive.enabled) next.enabled = oldDraft.enabled;
    for (const key of ["ignoreRules", "ignoreFiles"]) {
      const removed = new Set(oldLive[key].filter((item) => !oldDraft[key].includes(item)));
      const added = oldDraft[key].filter((item) => !oldLive[key].includes(item));
      next[key] = next[key].filter((item) => !removed.has(item));
      for (const item of added) if (!next[key].includes(item)) next[key].push(item);
    }
    const oldKeys = new Set(oldLive.ignoreValues.map(entryKey));
    const draftKeys = new Set(oldDraft.ignoreValues.map(entryKey));
    const removedKeys = new Set([...oldKeys].filter((key) => !draftKeys.has(key)));
    next.ignoreValues = next.ignoreValues.filter((entry) => !removedKeys.has(entryKey(entry)));
    const presentKeys = new Set(next.ignoreValues.map(entryKey));
    for (const entry of oldDraft.ignoreValues) {
      const key = entryKey(entry);
      if (!oldKeys.has(key) && !presentKeys.has(key)) {
        next.ignoreValues.push(cloneState(entry));
        presentKeys.add(key);
      }
    }
    return next;
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

  const ruleName = (id) => RULES.find((rule) => rule.id === id)?.name || id;

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
              <p data-hooks-master-detail>Reading this project&rsquo;s settings&hellip;</p>
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
      <section class="dcx-block" data-label="Exceptions">
        <span class="dcx-block-label">Exceptions</span>
        <div class="dcx-hooks-custom" data-hooks-custom>
          <div class="dcx-hooks-custom-toolbar">
            <p data-hooks-custom-count>No exceptions.</p>
            <button class="dcx-hooks-button" type="button" data-hooks-add aria-expanded="false" aria-controls="dcx-hooks-custom-form">Add exception</button>
          </div>
          <form class="dcx-hooks-custom-form" id="dcx-hooks-custom-form" data-hooks-form hidden>
            <label>
              <span>Kind</span>
              <select name="kind" data-hooks-kind>
                ${Object.entries(EXCEPTION_KINDS).map(([id, meta]) => `<option value="${id}">${escapeHtml(meta.label)}</option>`).join("")}
              </select>
            </label>
            <p class="dcx-hooks-kind-hint" data-hooks-kind-hint>${escapeHtml(EXCEPTION_KINDS.value.hint)}</p>
            <label data-hooks-field="rule">
              <span>Rule</span>
              <select name="rule">
                ${[...RULES].sort((a, b) => a.name.localeCompare(b.name)).map((rule) => `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.name)}</option>`).join("")}
              </select>
            </label>
            <label data-hooks-field="value">
              <span>Value</span>
              <input name="value" maxlength="200" placeholder="e.g. Inter, or #7BA98F">
            </label>
            <label data-hooks-field="files" hidden>
              <span>Files</span>
              <input name="files" maxlength="400" placeholder="Globs, comma separated: src/legacy/**, docs/demo.html">
            </label>
            <label data-hooks-field="reason">
              <span>Reason</span>
              <input name="reason" maxlength="200" placeholder="Optional: who decided, and the evidence">
            </label>
            <div class="dcx-hooks-form-actions">
              <button class="dcx-hooks-button dcx-hooks-button--quiet" type="button" data-hooks-cancel>Cancel</button>
              <button class="dcx-hooks-button" type="submit">Add</button>
            </div>
          </form>
          <div class="dcx-hooks-custom-list" data-hooks-custom-list></div>
          <p class="dcx-hooks-storage-note" data-hooks-live-note>Exceptions apply to the design hook and to npx impeccable detect in this project.</p>
        </div>
      </section>
      <div class="dcx-hooks-applybar" data-hooks-applybar hidden>
        <p class="dcx-hooks-applybar-copy" data-hooks-applybar-copy aria-live="polite"></p>
        <div class="dcx-hooks-applybar-actions">
          <button class="dcx-hooks-button dcx-hooks-button--quiet" type="button" data-hooks-discard>Discard</button>
          <button class="dcx-hooks-button" type="button" data-hooks-apply>Apply</button>
        </div>
      </div>
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
  const isEnabled = (id) => !(draft ? draft.ignoreRules.includes(id) : false);
  const interactive = () => Boolean(live && draft && !applying);

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

  const disciplineAnimations = new WeakMap();
  const customFormAnimations = new WeakMap();
  let syncFrame = 0;

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
      const selected = view.activeFamily === id;
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
    panel?.setAttribute("aria-labelledby", `dcx-hooks-family-${view.activeFamily}`);
    requestAnimationFrame(() => revealSelectedFamily(target));
  };

  const renderRules = (article) => {
    const target = article.querySelector("[data-hooks-rule-groups]");
    const summary = article.querySelector("[data-hooks-summary]");
    const search = article.querySelector("[data-hooks-search]");
    if (!target || !summary) return;

    const query = (search?.value || "").trim().toLowerCase();
    const rules = familyRules(view.activeFamily);
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

    const disabledUi = interactive() ? "" : "disabled";
    target.innerHTML = orderedGroups.map(([discipline, entries], index) => {
      const disclosureId = `dcx-hooks-${view.activeFamily}-${slugify(discipline)}`;
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
                      ${disabledUi}
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

  /* One row per exception the project holds, whatever wrote it: entries added
     here, by an agent's triage, or by npx impeccable ignores all render the
     same, and Remove queues a real removal for Apply. */
  const renderExceptions = (article) => {
    const target = article.querySelector("[data-hooks-custom-list]");
    const count = article.querySelector("[data-hooks-custom-count]");
    const note = article.querySelector("[data-hooks-live-note]");
    const add = article.querySelector("[data-hooks-add]");
    if (!target) return;

    const values = draft ? draft.ignoreValues : [];
    const files = draft ? draft.ignoreFiles : [];
    const total = values.length + files.length;
    if (count) {
      count.textContent = total
        ? `${total} ${total === 1 ? "exception" : "exceptions"}`
        : "No exceptions.";
    }
    if (add) add.disabled = !interactive();
    if (note) {
      note.textContent = interactive() || applying
        ? "Exceptions apply to the design hook and to npx impeccable detect in this project."
        : "The editing session has ended. /impeccable design-context reopens it.";
    }

    target.innerHTML = "";
    values.forEach((entry, index) => {
      const row = document.createElement("article");
      row.className = "dcx-hooks-custom-rule";

      const copy = document.createElement("div");
      copy.className = "dcx-hooks-rule-copy";
      const kind = document.createElement("span");
      kind.className = "dcx-hooks-custom-discipline";
      kind.textContent = entry.value === "*" ? "Rule, in files" : "Value";
      const name = document.createElement("strong");
      name.textContent = entry.value === "*"
        ? ruleName(entry.rule)
        : `${ruleName(entry.rule)}: ${entry.value}`;
      const detail = document.createElement("p");
      detail.textContent = entry.files?.length
        ? `In ${entry.files.join(", ")}`
        : "Everywhere in this project.";
      copy.append(kind, name, detail);
      if (entry.reason) {
        const reason = document.createElement("p");
        reason.className = "dcx-hooks-custom-reason";
        reason.textContent = entry.reason;
        copy.append(reason);
      }

      const controls = document.createElement("div");
      controls.className = "dcx-hooks-custom-controls";
      const remove = document.createElement("button");
      remove.className = "dcx-hooks-remove";
      remove.type = "button";
      remove.dataset.hooksRemoveValue = String(index);
      remove.setAttribute("aria-label", `Remove exception for ${ruleName(entry.rule)}`);
      remove.textContent = "Remove";
      remove.disabled = !interactive();
      controls.append(remove);
      row.append(copy, controls);
      target.appendChild(row);
    });

    files.forEach((glob, index) => {
      const row = document.createElement("article");
      row.className = "dcx-hooks-custom-rule";

      const copy = document.createElement("div");
      copy.className = "dcx-hooks-rule-copy";
      const kind = document.createElement("span");
      kind.className = "dcx-hooks-custom-discipline";
      kind.textContent = "Skipped files";
      const name = document.createElement("strong");
      name.textContent = glob;
      const detail = document.createElement("p");
      detail.textContent = "Every rule skips matching files.";
      copy.append(kind, name, detail);

      const controls = document.createElement("div");
      controls.className = "dcx-hooks-custom-controls";
      const remove = document.createElement("button");
      remove.className = "dcx-hooks-remove";
      remove.type = "button";
      remove.dataset.hooksRemoveFile = String(index);
      remove.setAttribute("aria-label", `Stop skipping ${glob}`);
      remove.textContent = "Remove";
      remove.disabled = !interactive();
      controls.append(remove);
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

    const enabled = draft ? draft.enabled : true;
    input.checked = enabled;
    input.disabled = !interactive();
    status.classList.toggle("is-paused", !enabled);
    copy.textContent = "Enable hooks";
    if (draft) {
      detail.textContent = "Runs in this project; changes land in .impeccable/config.json when you press Apply.";
    } else if (liveError) {
      detail.textContent = liveError;
    } else if (!docSession()) {
      detail.textContent = "The editing session has ended. /impeccable design-context reopens it.";
    } else {
      detail.textContent = "Reading this project’s settings…";
    }
    stateText.textContent = enabled ? "On" : "Off";
  };

  const syncApplyBar = (article) => {
    const bar = article.querySelector("[data-hooks-applybar]");
    const copy = article.querySelector("[data-hooks-applybar-copy]");
    const apply = article.querySelector("[data-hooks-apply]");
    const discard = article.querySelector("[data-hooks-discard]");
    if (!bar || !copy || !apply || !discard) return;

    const changes = changeCount();
    const show = Boolean(live && draft) && (changes > 0 || applying || appliedFlash);
    bar.hidden = !show;
    if (!show) return;

    apply.disabled = applying || changes === 0;
    discard.disabled = applying || changes === 0;
    if (applying) {
      copy.textContent = "Applying…";
    } else if (changes > 0) {
      copy.textContent = `${changes} ${changes === 1 ? "change" : "changes"} not applied yet.`;
    } else {
      copy.textContent = "Applied to .impeccable/config.json.";
    }
  };

  const renderArticle = (article) => {
    syncMaster(article);
    renderFamilies(article);
    renderRules(article);
    renderExceptions(article);
    syncApplyBar(article);
  };

  const hooksArticles = () => [...document.querySelectorAll('.dcx-article[data-dcx-category="hooks"]')];
  const renderAll = () => hooksArticles().forEach(renderArticle);

  const fetchLiveState = async () => {
    const url = hooksUrl();
    if (!url || fetchStarted) return;
    fetchStarted = true;
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body.state) {
        throw new Error(body?.error || `The doc session answered ${response.status}.`);
      }
      live = body.state;
      draft = cloneState(live);
      liveError = "";
    } catch {
      liveError = "Could not read this project’s hook settings; the controls stay read-only.";
      /* A later remount retries: the session may only now be announced. */
      fetchStarted = false;
    }
    renderAll();
  };

  const applyDraft = async (article) => {
    const url = hooksUrl();
    const session = docSession();
    if (!url || !session || !draft || applying) return;
    applying = true;
    appliedFlash = false;
    if (appliedFlashTimer) {
      window.clearTimeout(appliedFlashTimer);
      appliedFlashTimer = 0;
    }
    renderAll();
    try {
      const response = await fetch(`${session.base}/doc/hooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token, state: { ...draft, baseline: live } }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body.state) {
        throw new Error(body?.error || `The doc session answered ${response.status}.`);
      }
      live = body.state;
      draft = cloneState(live);
      appliedFlash = true;
      appliedFlashTimer = window.setTimeout(() => {
        appliedFlashTimer = 0;
        appliedFlash = false;
        renderAll();
      }, 2600);
    } catch (error) {
      const message = String(error.message || error);
      applying = false;
      if (message.includes("hook config changed on disk") && live && draft) {
        const oldLive = live;
        const oldDraft = draft;
        try {
          const refreshed = await fetch(url);
          const refreshedBody = await refreshed.json().catch(() => null);
          if (refreshed.ok && refreshedBody?.ok && refreshedBody.state) {
            live = refreshedBody.state;
            draft = rebaseDraft(oldLive, oldDraft, live);
            renderAll();
            /* Written after renderAll so the bar's own copy cannot eat it. */
            const copy = article.querySelector("[data-hooks-applybar-copy]");
            if (copy) copy.textContent = "Another run changed this project's hook settings while you edited. Your changes were re-applied on top; review and press Apply again.";
            return;
          }
        } catch {
          /* The session dropped mid-conflict; fall through to the plain error. */
        }
      }
      syncApplyBar(article);
      /* After the bar re-renders its change count, the reason overwrites it;
         written after the sync so the sync cannot eat it. */
      const copy = article.querySelector("[data-hooks-applybar-copy]");
      if (copy) copy.textContent = `Not applied: ${message}`;
      return;
    }
    applying = false;
    renderAll();
  };

  const initializeMountedArticles = () => {
    syncFrame = 0;
    hooksArticles().forEach((article) => {
      if (article.dataset.dcxHooksReady === "true") return;
      article.dataset.dcxHooksReady = "true";
      renderArticle(article);
    });
    if (live === null) fetchLiveState();
  };

  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(initializeMountedArticles);
  };

  const syncKindFields = (form) => {
    const kind = form.querySelector("[data-hooks-kind]")?.value || "value";
    const hint = form.querySelector("[data-hooks-kind-hint]");
    if (hint) hint.textContent = EXCEPTION_KINDS[kind]?.hint || "";
    form.querySelector('[data-hooks-field="rule"]')?.toggleAttribute("hidden", kind === "file");
    form.querySelector('[data-hooks-field="value"]')?.toggleAttribute("hidden", kind !== "value");
    form.querySelector('[data-hooks-field="files"]')?.toggleAttribute("hidden", kind === "value");
    form.querySelector('[data-hooks-field="reason"]')?.toggleAttribute("hidden", kind === "file");
  };

  const parseGlobList = (value) => [...new Set(String(value)
    .split(/[\n,]/)
    .map((glob) => glob.trim())
    .filter(Boolean))];

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
      view.activeFamily = family.dataset.hooksFamily;
      persistView();
      renderFamilies(article);
      renderRules(article);
      if (restoreFocus) {
        article.querySelector(`[data-hooks-family="${view.activeFamily}"]`)?.focus({ preventScroll: true });
      }
      return;
    }

    const add = event.target.closest("[data-hooks-add]");
    if (add && interactive()) {
      const form = article.querySelector("[data-hooks-form]");
      if (!form) return;
      syncKindFields(form);
      setCustomFormOpen(form, true);
      add.setAttribute("aria-expanded", "true");
      form.querySelector("[data-hooks-kind]")?.focus();
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

    const removeValue = event.target.closest("[data-hooks-remove-value]");
    if (removeValue && interactive()) {
      draft.ignoreValues.splice(Number(removeValue.dataset.hooksRemoveValue), 1);
      renderAll();
      (article.querySelector(".dcx-hooks-remove") || article.querySelector("[data-hooks-add]"))
        ?.focus({ preventScroll: true });
      return;
    }

    const removeFile = event.target.closest("[data-hooks-remove-file]");
    if (removeFile && interactive()) {
      draft.ignoreFiles.splice(Number(removeFile.dataset.hooksRemoveFile), 1);
      renderAll();
      (article.querySelector(".dcx-hooks-remove") || article.querySelector("[data-hooks-add]"))
        ?.focus({ preventScroll: true });
      return;
    }

    const discard = event.target.closest("[data-hooks-discard]");
    if (discard && live) {
      draft = cloneState(live);
      renderAll();
      return;
    }

    const apply = event.target.closest("[data-hooks-apply]");
    if (apply) applyDraft(article);
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
    article.querySelector(`[data-hooks-family="${view.activeFamily}"]`)?.focus();
  });

  document.addEventListener("change", (event) => {
    const article = event.target.closest('.dcx-article[data-dcx-category="hooks"]');
    if (!article) return;

    if (event.target.matches("[data-hooks-kind]")) {
      const form = event.target.closest("[data-hooks-form]");
      if (form) syncKindFields(form);
      return;
    }

    if (!interactive()) return;

    if (event.target.matches("[data-hooks-master]")) {
      draft.enabled = event.target.checked;
      syncMaster(article);
      syncApplyBar(article);
      return;
    }

    if (event.target.matches("[data-hooks-rule]")) {
      const id = event.target.dataset.hooksRule;
      if (event.target.checked) draft.ignoreRules = draft.ignoreRules.filter((entry) => entry !== id);
      else if (!draft.ignoreRules.includes(id)) draft.ignoreRules.push(id);
      renderFamilies(article);
      syncApplyBar(article);
      const query = article.querySelector("[data-hooks-search]")?.value.trim();
      const summary = article.querySelector("[data-hooks-summary]");
      if (!query && summary) {
        const rules = familyRules(view.activeFamily);
        summary.textContent = `${rules.filter((rule) => isEnabled(rule.id)).length} of ${rules.length} selected`;
      }
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-hooks-form]");
    if (!form) return;
    event.preventDefault();
    const article = form.closest('.dcx-article[data-dcx-category="hooks"]');
    if (!article || !interactive()) return;

    const data = new FormData(form);
    const kind = String(data.get("kind") || "value");
    const rule = String(data.get("rule") || "").trim();
    const value = String(data.get("value") || "").trim();
    const files = parseGlobList(data.get("files") || "");
    const reason = String(data.get("reason") || "").trim();

    if (kind === "file") {
      if (!files.length) return;
      files.forEach((glob) => {
        if (!draft.ignoreFiles.includes(glob)) draft.ignoreFiles.push(glob);
      });
    } else {
      const entry = kind === "value"
        ? { rule, value }
        : { rule, value: "*", files };
      if (!entry.rule || (kind === "value" && !entry.value)) return;
      if (kind === "rule-in-files" && !files.length) return;
      if (reason) entry.reason = reason;
      const keys = new Set(draft.ignoreValues.map(entryKey));
      if (!keys.has(entryKey(entry))) draft.ignoreValues.push(entry);
    }

    form.reset();
    syncKindFields(form);
    setCustomFormOpen(form, false);
    const addButton = article.querySelector("[data-hooks-add]");
    addButton?.setAttribute("aria-expanded", "false");
    renderAll();
    addButton?.focus({ preventScroll: true });
  });

  renameInterfaceToHooks();
  installTemplate();

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
})();
