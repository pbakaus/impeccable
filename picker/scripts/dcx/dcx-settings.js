(() => {
  "use strict";

  if (window.__dcxSettingsInstalled) return;
  window.__dcxSettingsInstalled = true;

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const COMMANDS = [
    {
      label: "Open",
      description: "Pick up where you left off.",
      command: "/impeccable design-context open",
    },
    {
      label: "Edit",
      description: "Make a few changes to this design context.",
      command: "/impeccable design-context edit",
    },
    {
      label: "Export",
      description: "Save a copy to share or keep elsewhere.",
      command: "/impeccable design-context export",
    },
    {
      label: "Import",
      description: "Bring a saved design context into this project.",
      command: "/impeccable design-context import",
    },
  ];

  const settingsIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>`;

  const closeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11"></path>
    </svg>`;

  const installTopbarActions = (root) => {
    const topbar = root?.querySelector?.(".dcx-topbar");
    const templateClose = topbar?.querySelector(".dcx-close");
    if (!topbar || !templateClose || topbar.querySelector("[data-dcx-settings-open]")) return;
    const actions = document.createElement("div");
    actions.className = "dcx-topbar-actions";

    const trigger = document.createElement("button");
    trigger.className = "dcx-settings-trigger";
    trigger.type = "button";
    trigger.dataset.dcxSettingsOpen = "";
    trigger.setAttribute("aria-label", "Design context settings");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "dcx-context-settings");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = settingsIcon;

    const request = topbar.querySelector(".dcx-request");
    (request || templateClose).before(actions);
    if (request) actions.append(request);
    actions.append(trigger, templateClose);
  };

  const shellTemplate = document.querySelector("#dcx-shell-template");
  installTopbarActions(shellTemplate?.content);
  document.querySelectorAll(".dcx-expander").forEach(installTopbarActions);

  let modal = document.querySelector("#dcx-context-settings");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "dcx-context-settings";
    modal.className = "picker-modal dcx-settings-modal";
    modal.setAttribute("aria-labelledby", "dcx-context-settings-title");
    modal.setAttribute("aria-describedby", "dcx-context-settings-lede");
    modal.innerHTML = `
      <div class="picker-modal-inner dcx-settings-panel" data-dcx-command-context>
        <header class="picker-modal-head dcx-settings-head">
          <div>
            <h2 id="dcx-context-settings-title">Design context commands</h2>
            <p id="dcx-context-settings-lede">Choose what you’d like to do with this design context.</p>
          </div>
          <button class="dcx-settings-close" type="button" data-dcx-settings-close aria-label="Close settings">
            ${closeIcon}
          </button>
        </header>
        <div class="dcx-settings-commands">
          ${COMMANDS.map(({ label, description, command }) => `
            <section class="dcx-settings-command">
              <div class="dcx-settings-command-copy">
                <h3>${label}</h3>
                <p>${description}</p>
              </div>
              <div class="dcx-command-copy">
                <span class="dcx-command-copy__prompt" aria-hidden="true">$</span>
                <code>${command}</code>
                <button class="dcx-command-copy__button" type="button" data-dcx-copy-command="${command}" aria-label="Copy ${label.toLowerCase()} command">
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
            </section>`).join("")}
        </div>
        <p class="dcx-command-status" role="status" aria-live="polite"></p>
      </div>`;
    document.body.appendChild(modal);
  }

  let invoker = null;
  let closeTimer = 0;

  const resetCopyState = () => {
    modal.querySelectorAll("[data-dcx-copy-command]").forEach((button) => {
      window.clearTimeout(button._dcxCopyTimer);
      button.classList.remove("copied");
      button.removeAttribute("data-copied");
    });
    const status = modal.querySelector(".dcx-command-status");
    if (status) status.textContent = "";
  };

  const openSettings = (trigger) => {
    window.clearTimeout(closeTimer);
    resetCopyState();
    invoker = trigger;
    trigger.setAttribute("aria-expanded", "true");
    if (!modal.open) modal.showModal();
    requestAnimationFrame(() => {
      modal.classList.add("is-visible");
      modal.querySelector("[data-dcx-settings-close]")?.focus({ preventScroll: true });
    });
  };

  const closeSettings = ({ restoreFocus = true, instant = false } = {}) => {
    if (!modal.open) return;
    window.clearTimeout(closeTimer);
    modal.classList.remove("is-visible");

    const finish = () => {
      if (!modal.open) return;
      modal.close();
      resetCopyState();
      invoker?.setAttribute?.("aria-expanded", "false");
      if (restoreFocus && invoker instanceof HTMLElement && invoker.isConnected) {
        invoker.focus({ preventScroll: true });
      }
      invoker = null;
    };

    if (instant || REDUCED_MOTION.matches) finish();
    else closeTimer = window.setTimeout(finish, 200);
  };

  window.closeDcxSettings = closeSettings;

  document.addEventListener("click", async (event) => {
    const openButton = event.target.closest?.("[data-dcx-settings-open]");
    if (openButton) {
      event.preventDefault();
      openSettings(openButton);
      return;
    }

    if (event.target.closest?.("[data-dcx-settings-close]")) {
      closeSettings();
      return;
    }

  });

  modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    const rect = modal.getBoundingClientRect();
    const outside = event.clientX < rect.left
      || event.clientX > rect.right
      || event.clientY < rect.top
      || event.clientY > rect.bottom;
    if (outside) closeSettings();
  });

  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSettings();
  });

  document.addEventListener("keydown", (event) => {
    if (!modal.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSettings();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...modal.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getClientRects().length > 0 && !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, true);

  document.addEventListener("dcx:document-mounted", (event) => {
    installTopbarActions(event.target);
  });
})();
