// The only code a journey runs in a page: the server names one of these and gives its arguments. Generated, outside
// this repository, from the functions the server's own browser runs, so the two read a page alike. Changes arrive as a
// whole new copy of this file and consent-rules.js, with HASH below: an edit by hand here is overwritten, and makes HASH
// untrue (docs/DEVELOP.md).

function clickByText(wanted, opts) {
  const clickable = 'a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"])';
  const hoverable = `${clickable}, h1, h2, h3, h4, h5, h6, p, li, figure, figcaption, img, video, [aria-label], [title]`;
  const w = globalThis;
  const doc = w.document;
  const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const stop = ["the", "a", "an", "button", "link", "in", "on", "header", "footer", "nav", "menu", "at", "top", "of", "to"];
  const carts = (x) => /^(?:baskets?|bags?|carts?|trolleys?)$/.test(x) ? "(?:baskets?|bags?|carts?|trolleys?)" : x;
  const spoken = norm(wanted).split(" "), nextTo = / (?:next to|beside) /.test(` ${spoken.join(" ")} `);
  const lookAt = spoken.findIndex((x, i) => i > 0 && /^(?:for|under|in|inside|within|on|of)$/.test(x) && spoken.slice(0, i).some((y) => stop.indexOf(y) === -1));
  const colour = (i) => (lookAt === -1 || i < lookAt) && /^(?:white|black|grey|gray|blue|red|green|yellow|orange|pink|purple|brown|beige|navy|silver|gold)$/.test(spoken[i]);
  const shownNames = spoken.some((_, i) => colour(i)) ? Array.prototype.map.call(doc.querySelectorAll(clickable), (el) => ` ${norm(`${el.innerText ?? el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`)} `) : [];
  const looks = (i) => colour(i) && !(i + 1 < spoken.length && shownNames.some((n) => n.includes(` ${spoken[i]} ${spoken[i + 1]} `)));
  const lookOnly = /\b(?:buttons?|btn|icons?)\b/i.test(wanted) && !/\b(?:swatch(?:es)?|colou?rs?|options?|variants?|shades?)\b/i.test(wanted) && spoken.some((x, i) => !looks(i) && (lookAt === -1 || i < lookAt) && stop.indexOf(x) === -1);
  const said = lookOnly ? spoken.map((x, i) => looks(i) ? "" : x) : spoken;
  const real = said.filter((x, i) => x !== "" && stop.indexOf(x) === -1 && !(x === "next" && said[i + 1] === "to"));
  const wantsBeside = nextTo || /\b(?:icons?|arrows?|carets?|chevrons?|plus|minus)\b/i.test(wanted);
  const wantsMenu = /\b(?:hamburger|burger|menu (?:button|icon|toggle)|nav(?:igation)? (?:toggle|button|icon|menu)|toggle navigation)\b/i.test(wanted);
  const words = real.length > 0 || wantsMenu ? real : spoken.filter((x) => !/^(?:the|a|an|in|on|at|of|to)$/.test(x));
  const placeOnly = new Set(lookAt === -1 ? [] : spoken.slice(lookAt + 1).filter((x) => said.indexOf(x) === -1 || said.indexOf(x) > lookAt));
  if (words.length === 0 && !wantsMenu)
    return null;
  const modals = Array.prototype.slice.call(doc.querySelectorAll(':modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')).filter((el) => {
    const modal = el.tagName.toLowerCase() === "dialog" || el.getAttribute("aria-modal") === "true" && /^(?:alert)?dialog$/.test(el.getAttribute("role") ?? "");
    const r = el.getBoundingClientRect();
    const style = typeof w.getComputedStyle === "function" ? w.getComputedStyle(el) : null;
    return modal && r.width >= 2 && r.height >= 2 && (!style || style.visibility !== "hidden" && style.display !== "none");
  });
  const focusedModals = modals.filter((el) => doc.activeElement && el.contains?.(doc.activeElement));
  const modal = focusedModals[focusedModals.length - 1] ?? modals[modals.length - 1];
  const beside = (el) => {
    if (!wantsBeside || el.getAttribute("aria-label") || el.getAttribute("title"))
      return "";
    const r = el.getBoundingClientRect();
    if (r.width > 48 || r.height > 48 || el.querySelector?.('img[alt]:not([alt=""]), [aria-label], title'))
      return "";
    const gap = (b) => Math.max(0, b.left - r.left - r.width, r.left - b.left - b.width) + Math.max(0, b.top - r.bottom, r.top - b.bottom);
    return [el.previousElementSibling, el.nextElementSibling].filter((n) => !!n && (n.textContent ?? "").length <= 80).map((n) => ({ t: norm(n.innerText || n.textContent || ""), d: gap(n.getBoundingClientRect()) })).filter((n) => n.t && n.t.length <= 40).sort((a, b) => a.d - b.d)[0]?.t ?? "";
  };
  const informal = Array.prototype.slice.call(doc.querySelectorAll("*")).filter((el) => {
    const worded = !!(el.textContent || el.innerText || "").trim();
    if (!worded && !wantsBeside)
      return false;
    const style = w.getComputedStyle?.(el);
    if (style?.visibility === "hidden" || style?.display === "none")
      return false;
    return (typeof el.onclick === "function" || style?.cursor === "pointer" && (!el.parentElement || w.getComputedStyle?.(el.parentElement)?.cursor !== "pointer")) && (worded || !!beside(el));
  });
  const pane = (el) => {
    const box = el;
    return !opts?.any && typeof box.matches === "function" && !box.matches(clickable.replace(', [tabindex]:not([tabindex="-1"])', "")) && !!box.querySelector?.(clickable);
  };
  const semantic = Array.prototype.slice.call(doc.querySelectorAll(opts?.any ? `${hoverable}${opts.files ? ", div, section" : ""}` : clickable)).filter((el) => !pane(el));
  const visible = [...new Set([...semantic, ...informal])].filter((el) => {
    const style = w.getComputedStyle?.(el);
    return (!modal || !!modal.contains?.(el)) && style?.visibility !== "hidden" && style?.visibility !== "collapse" && style?.display !== "none";
  });
  const carries = (el) => [el.getAttribute("aria-label") ?? "", el.innerText || el.textContent || ""].some((n) => norm(n) === words.join(" "));
  const labelsOf = (el) => Array.prototype.slice.call(el.labels ?? []);
  const inside = (owner, hit) => {
    if (hit !== owner && !owner.contains?.(hit))
      return false;
    const inner = opts?.any ? null : hit.closest?.(clickable);
    return !inner || inner === owner || inner === owner.control || !owner.contains?.(inner);
  };
  const reach = (el) => {
    if (!doc.elementFromPoint)
      return null;
    const labels = labelsOf(el);
    for (const by of [el, ...labels]) {
      const boxes = [...Array.prototype.slice.call(by.getClientRects?.() ?? []), by.getBoundingClientRect()].filter((q) => q.width > 0 && q.height > 0);
      for (const q of boxes)
        for (const x of [q.left + q.width / 2, q.left + Math.min(8, q.width / 4)]) {
          const y = q.top + q.height / 2, hit = doc.elementFromPoint(x, y);
          if (hit && (inside(el, hit) || labels.some((l) => inside(l, hit))))
            return { x: Math.round(x), y: Math.round(y) };
        }
    }
    return null;
  };
  const distinct = (pool) => pool.filter((el) => !informal.includes(el) || !pool.some((child) => {
    if (child === el || !el.contains?.(child) || norm(child.innerText || child.textContent || "") !== norm(el.innerText || el.textContent || ""))
      return false;
    if (carries(el) && !carries(child))
      return false;
    const rect = child.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && !!reach(child);
  }));
  const candidates = distinct(visible);
  let within = null;
  if (opts?.within) {
    try {
      const all = doc.querySelectorAll(opts.within);
      within = all.length === 1 ? all[0] : null;
    } catch {
      within = null;
    }
  }
  let best = null;
  if (modal)
    within = modal;
  const asked = words.join(" ");
  const fullyNamed = candidates.some((el) => {
    if (within?.contains && !within.contains(el) && within !== el)
      return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && (norm(el.innerText || el.textContent || "") === asked || norm(el.getAttribute("aria-label") ?? "") === asked);
  });
  const requestedName = (el) => {
    const role = el.getAttribute("role");
    const check = role === "switch" || role === "checkbox" || el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "checkbox";
    return check && !fullyNamed ? asked.replace(/ (?:toggle|switch|checkbox)$/, "") || asked : asked;
  };
  const named = [];
  const partly = [];
  const isSlider = (el) => el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "range" || el.getAttribute("role") === "slider";
  const wantsButton = /\b(?:buttons?|btn)\b/i.test(wanted);
  const wantsTick = /\b(?:circles?|checkbox(?:es)?|check ?marks?|ticks?|tick ?box(?:es)?|radio(?: button)?s?)\b/i.test(wanted);
  const isTick = (el) => /^(?:checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(el.getAttribute("role") ?? "") || el.tagName.toLowerCase() === "input" && /^(?:checkbox|radio)$/.test(el.getAttribute("type") ?? "");
  const wantsSwatch = /\b(?:swatch(?:es)?|colou?r (?:option|choice|dot|circle)s?)\b/i.test(wanted);
  const isChoice = (el) => /^(?:radio|option|menuitemradio)$/.test(el.getAttribute("role") ?? "") || el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "radio" && el.getBoundingClientRect().width >= 2 || !/^(?:label|input)$/.test(el.tagName.toLowerCase()) && el.closest?.("label")?.control?.getAttribute("type") === "radio";
  const rowOf = (el) => {
    if (norm(`${el.innerText || el.textContent || ""}`) || isTick(el) && !wantsTick)
      return "";
    const row = el.closest?.('li, tr, [role="row"], [role="listitem"], [role="option"], [role="treeitem"]');
    const words = row ? norm(row.innerText || row.textContent || "") : beside(el);
    return words.length <= 200 ? words : "";
  };
  const SHAPE = /^(?:hamburger|burger|lines?|bars?|stripes?|icon|corner|top|right|left|upper|toggle|nav|navigation|three|two|open|close|mobile|header|small|with|and|or|its|that|has|like|near|beside|under|above|by|from|for|side)$/i;
  const wantsIcon = /\bicons?\b/i.test(wanted);
  const isButton = (el) => {
    const tag = el.tagName.toLowerCase();
    return tag === "button" || el.getAttribute("role") === "button" || tag === "input" && /^(?:button|submit|reset)$/i.test(el.getAttribute("type") ?? "");
  };
  const wantsSlider = !!opts?.drag && /\b(?:sliders?|faders?|crossfaders?|scrubbers?|range (?:input|control|slider)s?)\b/i.test(wanted);
  const sectionOfPage = (el) => {
    if (el.getAttribute("role") === "tab" || !!el.closest?.('[role="tablist"]'))
      return true;
    const href = el.tagName.toLowerCase() === "a" ? el.getAttribute("href") : null;
    if (!href || !w.location?.href)
      return false;
    let here;
    let to;
    try {
      here = new URL(w.location.href);
      to = new URL(href, here);
    } catch {
      return false;
    }
    if (to.origin !== here.origin)
      return false;
    const path = (u) => u.pathname.replace(/\/+$/, "");
    return path(to) === path(here) && (to.search !== "" || to.search !== here.search) || path(here) !== "" && path(to).indexOf(`${path(here)}/`) === 0;
  };
  const cardTexts = new Map;
  const scored = new Map;
  for (const el of candidates) {
    const asked = requestedName(el);
    const rect = el.getBoundingClientRect();
    if ((rect.width < 2 || rect.height < 2) && !(el.tagName.toLowerCase() === "input" && /^(?:checkbox|radio)$/.test(el.getAttribute("type") ?? "") && (rect.width > 0 && rect.height > 0 || labelsOf(el).some((l) => {
      const b = l.getBoundingClientRect();
      return b.width >= 2 && b.height >= 2;
    }))))
      continue;
    const label = norm(`${el.innerText || el.textContent || ""}`) || norm(el.getAttribute("aria-label") ?? "");
    const labelled = Array.prototype.map.call(el.labels ?? [], (l) => l.innerText || l.textContent || "").join(" ");
    const row = rowOf(el), text = norm(`${label} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${/^password$/i.test(el.getAttribute("type") ?? "") || el.getAttribute("data-impeccable-secret-field") !== null || el.getAttribute("data-impeccable-secret-maybe") !== null || /(?:^|\s)(?:cc-\S*|one-time-code|current-password|new-password)(?=\s|$)/i.test(el.getAttribute("autocomplete") ?? "") || el.tagName === "INPUT" && !/^(?:checkbox|radio|button|submit|hidden|file|range|color|image|reset|date|datetime-local|month|time|week)$/i.test(el.getAttribute("type") ?? "") && ["name", "id", "placeholder", "aria-label"].some((a) => /passw|pwd/i.test(el.getAttribute(a) ?? "")) ? "" : el.value ?? ""} ${row} ${labelled}`);
    if (!text)
      continue;
    let score = 0;
    let chrome = false;
    for (const x of words)
      if (new RegExp(`(?:^|\\s)${carts(x)}(?:\\s|$)`).test(text))
        score += placeOnly.has(x) ? 0.5 : 1;
    if (score === 0)
      continue;
    const nameWords = label.split(" ").filter((x) => stop.indexOf(x) === -1), extra = words.filter((x) => !SHAPE.test(x) && ` ${text} `.indexOf(` ${x} `) === -1);
    const card = nameWords.length > 0 && extra.length > 0 && nameWords.every((x) => words.indexOf(x) !== -1) ? el.closest?.('li, article, tr, [role="listitem"], [role="row"], [role="article"]') : null;
    if (card && !cardTexts.has(card))
      cardTexts.set(card, (card.textContent ?? "").length <= 600 ? norm(card.innerText || card.textContent || "") : "");
    const cardText = card ? cardTexts.get(card) : "";
    if (cardText.length <= 300) {
      for (const x of extra)
        if (` ${cardText} `.indexOf(` ${x} `) !== -1)
          score += 1;
    }
    if (within && within.contains && within.contains(el))
      score += 3;
    if (el.closest && !sectionOfPage(el)) {
      const inChrome = !!el.closest('header, footer, [role="banner"], [role="contentinfo"]');
      const inSiteNav = !!el.closest('nav, [role="navigation"]') && !el.closest('main, aside, article, section, [role="main"], [role="complementary"]');
      if (inChrome || inSiteNav)
        score -= 1;
      chrome = inChrome || inSiteNav;
    }
    const ariaWhole = label !== asked && norm(el.getAttribute("aria-label") ?? "") === asked;
    if (label === asked || ariaWhole)
      score += 4;
    else if (` ${label} `.indexOf(` ${asked} `) !== -1)
      score += 2;
    else if (text === asked)
      score += 2;
    if (wantsSlider && isSlider(el))
      score += 2;
    if (wantsButton && isButton(el) || wantsIcon && !norm(`${el.innerText || el.textContent || ""}`) || wantsTick && isTick(el) || wantsSwatch && isChoice(el))
      score += 1.5;
    const inView = rect.bottom > 0 && rect.top < w.innerHeight;
    if (inView)
      score += 0.5;
    if (row && text === row)
      score += wantsBeside ? 0.25 : -0.25;
    const inViewBoth = inView && (typeof w.innerWidth !== "number" || rect.left + rect.width > 0 && rect.left < w.innerWidth);
    const name = label || norm(labelled) || text, own = { el, score, text: name.slice(0, 60), size: name.length };
    scored.set(el, { own, label: ariaWhole ? asked : label });
    const captioned = el.tagName.toLowerCase() === "input" && /^(?:submit|reset|button)$/i.test(el.getAttribute("type") ?? "");
    if (label.replace(/^(?:step )?\d+ /, "") === asked || norm(el.getAttribute("aria-label") ?? "") === asked || captioned && norm(el.value ?? "") === asked)
      named.push({ ...own, inView: inViewBoth, chrome, leads: true });
    else if (` ${label} `.indexOf(` ${asked} `) !== -1)
      partly.push({ ...own, inView: inViewBoth, chrome, leads: `${label} `.indexOf(`${asked} `) === 0 });
    if (!best || score > best.score || score === best.score && own.size < (best.size ?? best.text.length))
      best = own;
  }
  let several = 0;
  let by;
  let ambiguous = false;
  const rivals = named.length > 1 && best && named.some((n) => n.el === best.el) ? named : named.length === 0 && partly.length > 1 && best && partly.some((n) => n.el === best.el) ? partly : null;
  if (rivals) {
    several = rivals.length;
    let pool = rivals;
    const narrow = (keep, why) => {
      if (pool.length < 2)
        return;
      const kept = pool.filter(keep);
      if (kept.length > 0 && kept.length < pool.length) {
        pool = kept;
        by = why;
      }
    };
    if (within)
      narrow((n) => !!within.contains && within.contains(n.el), "surface");
    narrow((n) => n.inView, "view");
    narrow((n) => n.inView && !!reach(n.el), "reachable");
    narrow((n) => !n.chrome, "page");
    narrow((n) => n.leads, "leads");
    if (pool.length > 1)
      ambiguous = true;
    best = pool.reduce((a, n) => n.score > a.score || n.score === a.score && n.text.length < a.text.length ? n : a);
  }
  const prep = lookAt;
  const tail = prep === -1 ? [] : spoken.slice(prep + 1).filter((x) => stop.indexOf(x) === -1 && !SHAPE.test(x));
  const head = (prep === -1 ? said : said.slice(0, prep)).filter((x) => x !== "" && stop.indexOf(x) === -1 && !SHAPE.test(x));
  const hits = (label) => head.filter((x) => new RegExp(`(?:^|\\s)${carts(x)}(?:\\s|$)`).test(label)).join(" ");
  const bestLabel = best && scored.has(best.el) ? scored.get(best.el).label : "", bestHits = bestLabel ? hits(bestLabel) : "";
  const partial = bestHits.split(" ").length < head.length;
  const sort = bestHits ? tail.length > 0 || several === 0 ? bestHits : "" : tail.length > 0 ? [...scored.values()].map((s) => hits(s.label)).reduce((a, h) => h && (!a || h.split(" ").length > a.split(" ").length) ? h : a, "") : "";
  const kin = sort ? [...scored].filter(([el, s]) => hits(s.label) === sort && (tail.length > 0 || partial || s.label === bestLabel) && (!within?.contains || within.contains(el))) : [];
  if (kin.length > 1) {
    const holds = new Map;
    for (const [el] of kin)
      for (let a = el.parentElement;a; a = a.parentElement)
        holds.set(a, (holds.get(a) ?? 0) + 1);
    const shownOn = (card) => {
      let t = ` ${norm(card.innerText || card.textContent || "")} `;
      for (const d of Array.prototype.slice.call(card.querySelectorAll?.("*") ?? [])) {
        const b = d.getBoundingClientRect(), dt = norm(d.textContent ?? "");
        if (dt && (b.width <= 1 || b.height <= 1))
          t = t.replace(` ${dt} `, " ");
      }
      return t;
    };
    const told = kin.map(([el, s]) => {
      let card = el;
      while (card.parentElement && holds.get(card.parentElement) === 1)
        card = card.parentElement;
      const seen = tail.length ? `${shownOn(card)}${s.label} ` : "";
      return { own: s.own, n: tail.filter((x) => seen.indexOf(` ${x} `) !== -1).length };
    });
    const most = Math.max(...told.map((t) => t.n)), top = told.filter((t) => t.n === most);
    several = kin.length;
    if (most > 0 && top.length === 1) {
      best = top[0].own;
      by = "card";
      ambiguous = false;
    } else {
      ambiguous = true;
      if (most > 0 && !top.some((t) => t.own.el === best.el))
        best = top[0].own;
    }
  }
  let one = false;
  const usable = (el) => {
    if (el.getAttribute("disabled") !== null || el.getAttribute("aria-disabled") === "true")
      return false;
    const cs = typeof w.getComputedStyle === "function" ? w.getComputedStyle(el) : null;
    return !cs || cs.visibility !== "hidden" && cs.display !== "none" && cs.pointerEvents !== "none";
  };
  if (wantsMenu && (!best || words.every((x) => SHAPE.test(x)))) {
    const menuLike = /(?:menu|nav|navigation|hamburger|burger)/i;
    const all = candidates.filter((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag !== "button" && el.getAttribute("role") !== "button")
        return false;
      const said = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("title") ?? ""} ${typeof el.className === "string" ? el.className : ""} ${el.id ?? ""}`;
      const own = norm(el.textContent ?? ""), icon = !!el.querySelector?.("svg, img");
      if (!menuLike.test(said) && !(icon && own.length <= 40 && /\b(?:menu|nav|navigation|hamburger|burger)\b/.test(own)))
        return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && usable(el) && rect.bottom > 0 && rect.top < w.innerHeight && (!within || !within.contains || within.contains(el));
    });
    const inHeader = all.filter((el) => !!el.closest && !!el.closest('header, [role="banner"]'));
    const menus = inHeader.length === 1 ? inHeader : all;
    if (menus.length === 1) {
      const m = menus[0];
      const name = norm(m.getAttribute("aria-label") ?? "") || norm(m.getAttribute("title") ?? "") || norm(`${m.innerText || m.textContent || ""}`) || "menu";
      best = { el: m, score: 0, text: name.slice(0, 60) };
      one = "menu";
    }
  }
  if (wantsSlider) {
    const sliders = Array.prototype.slice.call(doc.querySelectorAll('input[type="range"], [role="slider"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && usable(el) && (!within || !within.contains || within.contains(el));
    });
    const vw = typeof w.innerWidth === "number" ? w.innerWidth : Number.POSITIVE_INFINITY;
    const inView = sliders.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < w.innerHeight && rect.left + rect.width > 0 && rect.left < vw;
    });
    const pool = sliders.length === 1 ? [sliders[0], "page"] : inView.length === 1 ? [inView[0], "view"] : null;
    if (pool && (!best || !isSlider(best.el) && best.score < 4)) {
      const [s, how] = pool;
      const name = norm(s.getAttribute("aria-label") ?? "") || norm(s.getAttribute("title") ?? "") || norm(`${s.innerText || s.textContent || ""}`) || "slider";
      best = { el: s, score: 0, text: name.slice(0, 60) };
      one = how;
    }
  }
  if (!opts?.drag && !(best && best.text === asked)) {
    const holders = [];
    for (const sel of Array.prototype.slice.call(doc.querySelectorAll("select"))) {
      if (sel.tagName.toLowerCase() !== "select" || typeof sel.querySelectorAll !== "function")
        continue;
      const rect = sel.getBoundingClientRect();
      const off = (e) => {
        try {
          return typeof e.matches === "function" && e.matches(":disabled");
        } catch {
          return false;
        }
      };
      if (rect.width < 2 || rect.height < 2 || !usable(sel) || off(sel) || within && within.contains && !within.contains(sel))
        continue;
      const options = Array.prototype.slice.call(sel.querySelectorAll("option"));
      const opt = options.find((o) => o.getAttribute("disabled") === null && !off(o) && (norm(`${o.textContent ?? ""}`) === asked || norm(o.getAttribute("label") ?? "") === asked));
      if (opt)
        holders.push({ sel, opt });
    }
    if (holders.length === 1) {
      const { sel, opt } = holders[0];
      const was = sel.getBoundingClientRect();
      sel.scrollIntoView({ block: "center" });
      const r = sel.getBoundingClientRect();
      const labelled = sel.id ? doc.querySelector(`label[for="${sel.id.replace(/"/g, "")}"]`) : null;
      const selectName = norm(sel.getAttribute("aria-label") ?? "") || norm(`${labelled?.textContent ?? ""}`) || norm(sel.getAttribute("name") ?? "");
      if (!opts?.locateOnly) {
        sel.value = opt.value ?? norm(`${opt.textContent ?? ""}`);
        const Ev = w.Event;
        sel.dispatchEvent(new Ev("input", { bubbles: true }));
        sel.dispatchEvent(new Ev("change", { bubbles: true }));
      }
      return { clicked: norm(`${opt.textContent ?? ""}`).slice(0, 60), exact: true, tag: "option", selector: `select${sel.id ? `#${sel.id}` : ""}${sel.getAttribute("name") ? `[name="${sel.getAttribute("name")}"]` : ""}`, target: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }, scrollY: Math.round(w.scrollY), ...typeof w.innerWidth === "number" ? { view: { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) }, seen: { x: Math.round(was.left), y: Math.round(was.top) } } : {}, chose: { option: norm(`${opt.textContent ?? ""}`).slice(0, 60), select: selectName.slice(0, 60) } };
    }
  }
  if (!best)
    return null;
  const was = best.el.getBoundingClientRect();
  best.el.scrollIntoView({ block: "center" });
  const r = best.el.getBoundingClientRect();
  const target = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  const reached = reach(best.el);
  const point = reached ?? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  let covered;
  const hit = doc.elementFromPoint && !reached ? doc.elementFromPoint(point.x, point.y) : null;
  const around = !!hit?.contains?.(best.el);
  if (hit && !around && hit !== best.el && !best.el.contains?.(hit) && !labelsOf(best.el).some((owner) => inside(owner, hit))) {
    const cls = typeof hit.className === "string" ? hit.className.trim().split(/\s+/)[0] : "";
    covered = `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : cls ? `.${cls}` : ""}`;
  }
  if (!opts?.locateOnly)
    best.el.click();
  const aria = norm(best.el.getAttribute("aria-label") ?? "");
  const names = [best.text, aria].filter((n) => n.length > 0);
  const requested = requestedName(best.el);
  const exact = names.some((n) => n === requested || n.indexOf(requested) === 0 || n.indexOf(` ${requested}`) !== -1);
  const outside = !!within && !!within.contains && !within.contains(best.el) && within !== best.el;
  const slider = isSlider(best.el);
  const axis = !slider ? undefined : best.el.getAttribute("aria-orientation") === "vertical" ? "y" : best.el.getAttribute("aria-orientation") === "horizontal" || best.el.tagName.toLowerCase() === "input" || r.width >= r.height ? "x" : "y";
  const esc = (t) => t.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  const ownClasses = typeof best.el.className === "string" ? best.el.className.split(/\s+/).filter(Boolean).slice(0, 8) : [];
  const selector = `${best.el.tagName.toLowerCase()}${best.el.id ? `#${esc(best.el.id)}` : ""}${ownClasses.map((c) => `.${esc(c)}`).join("")}${best.el.getAttribute("name") ? `[name="${esc(best.el.getAttribute("name"))}"]` : ""}${best.el.getAttribute("data-testid") || best.el.getAttribute("data-test") ? `[data-testid="${esc(best.el.getAttribute("data-testid") ?? best.el.getAttribute("data-test"))}"]` : ""}`;
  const alike = several > 1 && !one ? { several, ...ambiguous ? { ambiguous: true } : by ? { by } : {} } : {};
  const label = norm(best.el.getAttribute("aria-label") ?? best.el.getAttribute("title") ?? "") || undefined, role = best.el.getAttribute("role") ?? undefined;
  const peers = [best.el, ...candidates.filter((el) => el !== best.el).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && !el.closest?.("[inert]") && el.getAttribute("disabled") === null;
  }).filter((el) => el.tagName.toLowerCase() !== "label" && [el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? "", el.innerText || el.textContent || ""].some((name) => norm(name) !== "" && [norm(label || ""), norm(best.text)].includes(norm(name))))];
  const signature = (el) => JSON.stringify([el.tagName.toLowerCase(), typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).sort() : [], el.getAttribute("name"), el.getAttribute("data-testid") ?? el.getAttribute("data-test")]), sameSelector = peers.length > 1 && peers.includes(best.el) && peers.every((el) => signature(el) === signature(best.el));
  const sharedClasses = ownClasses.filter((c) => peers.every((el) => typeof el.className === "string" && el.className.split(/\s+/).includes(c))).map((c) => `.${esc(c)}`), inChange = !!opts?.changeRegion && r.top + w.scrollY >= opts.changeRegion.top && r.bottom + w.scrollY <= opts.changeRegion.bottom;
  const tag = best.el.tagName.toLowerCase(), kind = (best.el.getAttribute("type") ?? "").toLowerCase();
  const field = tag === "textarea" || tag === "select" || best.el.isContentEditable === true || tag === "input" && !/^(?:button|submit|reset)$/.test(kind);
  const own = tag === "input" ? (best.el.value ?? "").trim() : (best.el.innerText ?? "").trim();
  const ticked = tag === "input" && /^(?:checkbox|radio)$/.test(kind) ? labelsOf(best.el).filter((l) => {
    const b = l.getBoundingClientRect();
    return (l.getClientRects?.().length ?? 1) > 0 && b.width >= 2 && b.height >= 2;
  }).map((l) => (l.innerText ?? l.textContent ?? "").trim()).filter(Boolean).join(" ") : "";
  const shown = field ? ticked || undefined : own || best.el.getAttribute("aria-label") || undefined;
  const shownKey = (t) => (t ?? "").normalize("NFKC").toLowerCase().trim().replace(/[.,]$/, "").split(/\s+/).filter(Boolean).join(" ");
  const shownOf = (el) => {
    const t = el.tagName.toLowerCase(), k = (el.getAttribute("type") ?? "").toLowerCase();
    if (t === "textarea" || t === "select" || el.isContentEditable === true || t === "input" && !/^(?:button|submit|reset)$/.test(k))
      return "";
    return shownKey((t === "input" ? (el.value ?? "").trim() : (el.innerText ?? "").trim()) || el.getAttribute("aria-label"));
  };
  const shownTwins = shown ? candidates.filter((el) => el !== best.el && !labelsOf(best.el).includes(el) && shownOf(el) === shownKey(shown)).length : 0;
  const list = tag === "select" ? best.el : tag === "label" ? best.el.control ?? best.el.querySelector?.("select") : null;
  const disabled = (e) => {
    try {
      return e.matches(":disabled");
    } catch {
      return e.getAttribute("disabled") !== null;
    }
  };
  const siteText = (o) => {
    const raw = (o.getAttribute("label") || o.textContent || "").normalize("NFKC");
    const visible = raw.replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, "").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]|"/gu, "").replace(/\s+/g, " ").trim();
    return Array.from(visible).slice(0, 60).join("").trim();
  };
  let options;
  if (list?.tagName.toLowerCase() === "select" && list.getAttribute("multiple") === null && !disabled(list)) {
    const all = Array.prototype.slice.call(list.querySelectorAll?.("option") ?? []);
    const names = all.filter((o) => !disabled(o)).map(siteText).filter(Boolean);
    const picked = all.find((o) => o.selected), current = picked ? siteText(picked) : "";
    options = { names: names.slice(0, 12), count: names.length, ...current ? { current } : {} };
  }
  return { clicked: best.text, ...options ? { options } : {}, ...shown ? { shown } : {}, ...shownTwins ? { shownTwins } : {}, nameCount: peers.length, ...sameSelector ? { sameSelector } : {}, ...sharedClasses.length ? { sharedClasses } : {}, ...inChange ? { inChange } : {}, ...label ? { label } : {}, ...role ? { role } : {}, href: best.el.closest?.("a[href]")?.getAttribute("href") ?? undefined, exact: !!one || exact, tag: best.el.tagName.toLowerCase(), selector, target, point, scrollY: Math.round(w.scrollY), ...typeof w.innerWidth === "number" ? { view: { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) }, seen: { x: Math.round(was.left), y: Math.round(was.top) } } : {}, ...covered ? { covered } : {}, ...outside ? { outside: true } : {}, ...slider ? { slider: true, axis } : {}, ...one ? { one } : {}, ...alike };
}

function confirmingControl(at, enter = false, wide = false) {
  const doc = globalThis.document;
  const control = 'a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"])';
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(), whole = (raw, short) => wide ? [...short, ...raw.map((s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80)).filter((s) => s.length > 0 && !short.includes(s))] : short;
  const changes = /\b(?:approve|reject|decline|deny|submit|save|delete|remove|send|pay|confirm|publish|archive|revoke|withdraw|transfer)\b|\bcancel [a-z]/;
  let el = at ? doc.elementFromPoint ? doc.elementFromPoint(at.x, at.y) : null : doc.activeElement ?? null;
  for (;!at; ) {
    if (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
      continue;
    }
    if (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      let inner = null;
      try {
        inner = el.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (!inner)
        return wide ? "" : "the frame";
      el = inner.activeElement ?? null;
      continue;
    }
    break;
  }
  while (el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const raw = [el.getAttribute("aria-label") ?? "", `${el.innerText || el.textContent || ""}`, el.getAttribute("title") ?? "", tag === "input" && /^(?:submit|button)$/.test(type) ? el.value ?? "" : ""], own = norm(raw[1]);
    const said = [norm(raw[0]), own.length <= 40 ? own : "", norm(raw[2]), norm(raw[3])].filter((s) => s.length > 0), told = whole(raw, said);
    const link = tag === "a" && el.getAttribute("href") !== null && !el.getAttribute("role");
    if (said.some((s) => changes.test(s) || wide && !link && /\b(?:add|buy|order|checkout|book|post|like|follow|subscribe)\b/.test(s)))
      return wide ? told.join(`
`) : said[0];
    if (el.getAttribute("role") === "switch" || wide && el.getAttribute("aria-pressed") !== null)
      return wide ? told.join(`
`) : said[0] ?? "the switch";
    const editable = el.getAttribute("contenteditable");
    if (enter && (tag === "textarea" || editable !== null && editable !== "false"))
      return said[0] ?? "the text box";
    const form = el.closest ? el.closest("form") : null;
    if (form) {
      const find = form;
      const method = (el.getAttribute("formmethod") ?? form.getAttribute("method") ?? "").toLowerCase();
      const reads = method === "get" || method === "dialog" || !method && (form.getAttribute("role") === "search" || !!(find.querySelector && find.querySelector('input[type="search"]')));
      const sends = tag === "button" ? type === "" || type === "submit" : tag === "input" && (type === "submit" || type === "image" || enter && !/^(?:button|reset|checkbox|radio|file|range|color)$/.test(type));
      const sub = enter && tag !== "button" && type !== "submit" && type !== "image" && find.querySelector ? find.querySelector('[type="submit"], button:not([type])') : null, subRaw = sub ? [sub.getAttribute("aria-label") ?? "", `${sub.innerText || sub.textContent || ""}`, sub.value ?? ""] : [], all = [...whole(subRaw, subRaw.map(norm).filter((s) => s.length > 0 && s.length <= 40)), ...told];
      if (!reads && sends)
        return wide ? all.length > 0 ? [...all, "<form>"].join(`
`) : "" : all[0] ?? "the form’s submit button";
    }
    if (el.closest && el.closest(control) === el) {
      if (wide && said.length === 0 && (tag === "button" || el.getAttribute("role") === "button" || tag === "input" && /^(?:submit|button|image)$/.test(type)))
        return "";
      break;
    }
    el = el.parentElement ?? null;
  }
  return null;
}

function currentUrlOf() {
  return globalThis.location.href;
}

function fieldReads(point, noSecrets = false) {
  const doc = globalThis.document;
  const secret = (el, narrow) => el.tagName === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "password" || el.getAttribute("data-impeccable-secret-field") !== null || (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).some((t) => t === "current-password" || t === "new-password" || t === "one-time-code" || t.startsWith("cc-")) || !narrow && (el.getAttribute("data-impeccable-secret-maybe") !== null || el.tagName === "INPUT" && !/^(?:checkbox|radio|button|submit|hidden|file|range|color|image|reset|date|datetime-local|month|time|week)$/i.test(el.getAttribute("type") ?? "") && ["name", "id", "placeholder", "aria-label"].some((a) => /passw|pwd/i.test(el.getAttribute(a) ?? "")));
  const holds = (el, narrow) => secret(el, narrow) || Array.from(el.shadowRoot?.querySelectorAll?.("*") ?? []).some((inner) => holds(inner, narrow));
  const read = (el, through = []) => {
    if (!el)
      return null;
    const own = typeof el.value === "string" ? el.value : el.getAttribute("contenteditable") === "true" ? el.textContent ?? "" : null;
    if (!noSecrets || own === null)
      return own;
    const around = [...through, el];
    return around.some((h) => holds(h, true)) ? null : around.some((h) => holds(h, false)) ? own ? "•" : "" : own;
  };
  const through = [];
  let at = doc.activeElement ?? null;
  for (;; ) {
    let inner = null;
    if (at?.shadowRoot?.activeElement)
      inner = at.shadowRoot;
    else if (at && (at.tagName === "IFRAME" || at.tagName === "FRAME")) {
      try {
        inner = at.contentDocument ?? null;
      } catch {
        inner = null;
      }
    }
    if (!at || !inner?.activeElement)
      break;
    through.push(at);
    at = inner.activeElement;
  }
  const focused = read(at, through);
  if (focused !== null)
    return focused;
  const under = point && doc.elementFromPoint ? doc.elementFromPoint(point.x, point.y) : null;
  return read(under?.closest?.('input, textarea, [contenteditable="true"]') ?? under);
}

function focusedText() {
  const doc = globalThis.document, roots = [doc];
  let focused = doc.activeElement ?? null, deep = false;
  for (;; ) {
    if (focused?.shadowRoot?.activeElement) {
      deep = true;
      focused = focused.shadowRoot.activeElement;
      continue;
    }
    if (focused && (focused.tagName === "IFRAME" || focused.tagName === "FRAME")) {
      let inner = null;
      try {
        inner = focused.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (!inner)
        return null;
      deep = true;
      focused = inner.activeElement ?? null;
      continue;
    }
    break;
  }
  for (let at = 0;deep && at < roots.length; at++) {
    for (const el of Array.from(roots[at].querySelectorAll?.("*") ?? [])) {
      if (el.shadowRoot)
        roots.push(el.shadowRoot);
      if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        try {
          if (el.contentDocument)
            roots.push(el.contentDocument);
        } catch {}
      }
    }
  }
  const key = (t) => (t ?? "").normalize("NFKC").toLowerCase().trim().replace(/[.,]$/, "").split(/\s+/).filter(Boolean).join(" ");
  const shownOf = (el) => {
    if (!el || /^(?:body|html|textarea|select)$/i.test(el.tagName) || el.isContentEditable)
      return null;
    const input = el.tagName === "INPUT";
    if (input && !/^(?:button|submit|reset)$/i.test(el.type ?? ""))
      return null;
    const words = (input ? (el.value ?? "").trim() : (el.innerText ?? "").trim()) || el.getAttribute("aria-label");
    return words && key(words) ? words : null;
  };
  const shown = shownOf(focused);
  if (!shown)
    return null;
  const several = roots.flatMap((root) => Array.from(root.querySelectorAll?.("button,a,input,summary,[role],[tabindex]") ?? [])).filter((el) => el !== focused && key(shownOf(el)) === key(shown)).length + 1;
  return { shown, several };
}

function pageAddress() {
  return String(globalThis.location?.href ?? "");
}

function pageSignature() {
  const g = globalThis;
  const text = (g.document.body?.innerText ?? "").slice(0, 400000);
  const states = Array.from(g.document.querySelectorAll("[aria-expanded],[aria-selected],[aria-checked],[aria-pressed],[aria-hidden],[aria-invalid],[aria-current],[hidden],[disabled],[open],[data-state],input,select,textarea,dialog,details")).slice(0, 4000).map((el) => `${el.tagName}|${["aria-expanded", "aria-selected", "aria-checked", "aria-pressed", "aria-hidden", "aria-invalid", "aria-current", "hidden", "disabled", "open", "data-state"].map((n) => el.getAttribute(n) ?? "␀").join(",")}|${typeof el.value !== "string" ? "" : el.tagName === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "password" || el.getAttribute("data-impeccable-secret-field") !== null || el.getAttribute("data-impeccable-secret-maybe") !== null || (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).some((t) => t === "current-password" || t === "new-password" || t === "one-time-code" || t.startsWith("cc-")) || el.tagName === "INPUT" && !/^(?:checkbox|radio|button|submit|hidden|file|range|color|image|reset|date|datetime-local|month|time|week)$/i.test(el.getAttribute("type") ?? "") && ["name", "id", "placeholder", "aria-label"].some((a) => /passw|pwd/i.test(el.getAttribute(a) ?? "")) ? el.value ? "•" : "" : el.value}|${el.checked === true ? 1 : 0}|${el.open === true ? 1 : 0}`).join(`
`);
  let h = 2166136261;
  for (const part of [text, states])
    for (let i = 0;i < part.length; i++)
      h = Math.imul(h ^ part.charCodeAt(i), 16777619);
  return `${g.location.href} ${g.document.querySelectorAll("*").length} ${text.length} ${(h >>> 0).toString(36)}`;
}

function scrollBy(direction, pane) {
  const w = globalThis;
  const by = direction === "up" ? -w.innerHeight * 0.85 : w.innerHeight * 0.85;
  if (pane?.trim()) {
    const asked = pane.toLowerCase().replace(/^the\s+/, "").trim();
    const rooms = Array.from(w.document.querySelectorAll("*")).filter((e) => (e.scrollHeight ?? 0) - (e.clientHeight ?? 0) > 1 && /^(?:auto|scroll)$/.test(w.getComputedStyle?.(e)?.overflowY ?? ""));
    const says = (e) => `${e.getAttribute("aria-label") ?? ""} ${e.innerText || e.textContent || ""}`.toLowerCase().includes(asked);
    const navigates = (e) => Boolean(e && (/^(?:ASIDE|NAV)$/.test(e.tagName) || e.getAttribute("role") === "navigation" || navigates(e.parentElement)));
    const box = rooms.filter(says).sort((a, b) => (a.scrollHeight ?? 0) - (b.scrollHeight ?? 0))[0] ?? (/side ?bar|nav|menu|rail|panel|contents/.test(asked) ? rooms.find(navigates) : undefined);
    if (box) {
      const room = (box.scrollHeight ?? 0) - (box.clientHeight ?? 0), at = Math.round(box.scrollTop ?? 0);
      if (box.scrollTo)
        box.scrollTo({ top: at + by, behavior: "instant" });
      else
        box.scrollTop = at + by;
      return { y: Math.round(box.scrollTop ?? 0), from: at, max: Math.round(room) };
    }
  }
  const from = Math.round(w.scrollY);
  w.scrollBy(0, by);
  const max = Math.max(0, w.document.documentElement.scrollHeight - w.innerHeight);
  if (max > 0)
    return { y: Math.round(w.scrollY), from, max: Math.round(max) };
  let el = w.document.elementFromPoint?.((w.innerWidth ?? 0) / 2, w.innerHeight / 2) ?? null;
  let ended;
  while (el) {
    const room = (el.scrollHeight ?? 0) - (el.clientHeight ?? 0);
    const paneFrom = Math.round(el.scrollTop ?? 0);
    const style = w.getComputedStyle?.(el);
    if (room > 1 && /^(?:auto|scroll)$/.test(style?.overflowY ?? "")) {
      if (by < 0 ? paneFrom > 0 : paneFrom < room - 1) {
        if (el.scrollTo)
          el.scrollTo({ top: paneFrom + by, behavior: "instant" });
        else
          el.scrollTop = paneFrom + by;
        return { y: Math.round(el.scrollTop ?? 0), from: paneFrom, max: Math.round(room) };
      }
      ended ??= { from: paneFrom, room };
      if (/^(?:contain|none)$/.test(style?.overscrollBehaviorY ?? ""))
        break;
    }
    el = el.parentElement ?? null;
  }
  if (ended)
    return { y: ended.from, from: ended.from, max: Math.round(ended.room) };
  return { y: Math.round(w.scrollY), from, max: 0 };
}

function scrollPageTo(y) {
  globalThis.scrollTo(0, y);
}

function scrollToSurface(name, scroll = true, headingAlone = false) {
  const scope = globalThis;
  const doc = scope.document;
  if (!doc)
    return null;
  const stop = new Set(["the", "and", "for", "with", "page", "section", "new", "rebuilt", "changed", "demo", "reference"]);
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = norm(name).split(" ").filter((w) => w.length >= 3 && !stop.has(w));
  if (words.length === 0)
    return null;
  const wanted = words.join(" ");
  const slug = words.join("-");
  const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, section, [role="region"], [aria-label], [id]')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  const isHeading = (el) => /^h[1-4]$/.test(el.tagName.toLowerCase());
  let best = undefined;
  const exact = candidates.find((el) => isHeading(el) && norm(el.textContent ?? "") === wanted || (el.id ?? "").toLowerCase() === slug || norm(el.getAttribute("aria-label") ?? "") === wanted);
  if (exact)
    best = { el: exact, score: words.length };
  if (!best && words.length >= 2) {
    const need = Math.ceil(words.length / 2);
    const scored = [];
    for (const el of candidates) {
      const own = isHeading(el) ? el.textContent ?? "" : `${el.id ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
      const tokens = new Set(norm(own).split(" "));
      let score = 0;
      for (const w of words)
        if (tokens.has(w))
          score += 1;
      if (score >= need)
        scored.push({ el, score });
    }
    const top = Math.max(0, ...scored.map((c) => c.score));
    const tied = scored.filter((c) => c.score === top);
    if (tied.length === 1)
      best = tied[0];
    else if (tied.length > 1) {
      const outer = tied.find((c) => tied.every((o) => o === c || c.el.contains(o.el)));
      if (outer)
        best = outer;
    }
  }
  if (!best)
    return null;
  if (scroll)
    best.el.scrollIntoView({ block: "start" });
  const r = best.el.getBoundingClientRect();
  const selectorOf = (el) => `${el.tagName.toLowerCase()}${!el.id ? "" : /^[A-Za-z_][\w-]*$/.test(el.id) ? `#${el.id}` : `[id="${el.id.replace(/["\\]/g, "\\$&")}"]`}`;
  const alone = (sel) => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  let label = selectorOf(best.el);
  if (isHeading(best.el) && !headingAlone) {
    const LANDMARK = 'section, article, main, form, dialog, [role="region"], [role="main"], [role="dialog"]';
    label = "";
    for (let around = best.el.closest?.(LANDMARK) ?? null;around; around = around.parentElement?.closest?.(LANDMARK) ?? null) {
      if (alone(selectorOf(around))) {
        label = selectorOf(around);
        break;
      }
    }
  }
  return { what: label, top: Math.round(r.top + (scope.scrollY ?? 0)) };
}

function typeInto(wanted, text, keys, noSecrets = false) {
  const w = globalThis;
  const doc = w.document;
  const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = norm(wanted).split(" ").filter((x) => x.length > 1);
  const fields = Array.prototype.slice.call(doc.querySelectorAll('input:not([type=hidden]):not([type=submit]), textarea, [contenteditable="true"]'));
  let best = null;
  for (const el of fields) {
    const label = Array.prototype.map.call(el.labels ?? [], (l) => l.textContent ?? "").join(" ");
    const t = norm(`${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("name") ?? ""} ${label}`);
    let score = 0;
    for (const x of words)
      if (t.indexOf(x) !== -1)
        score += 1;
    if (!best || score > best.score)
      best = { el, score };
  }
  if (!best)
    return null;
  const focused = doc.activeElement;
  if (best.score === 0 && focused && fields.includes(focused))
    best = { el: focused, score: 0 };
  if (noSecrets && (best.el.tagName === "INPUT" && (best.el.getAttribute("type") ?? "").toLowerCase() === "password" || best.el.getAttribute("data-impeccable-secret-field") !== null || (best.el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).some((t) => t === "current-password" || t === "new-password" || t === "one-time-code" || t.startsWith("cc-"))))
    return null;
  const was = best.el.getBoundingClientRect();
  best.el.scrollIntoView({ block: "center" });
  const r = best.el.getBoundingClientRect();
  const target = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  best.el.focus();
  const field = typeof best.el.value === "string";
  if (keys) {
    if (field)
      best.el.select?.();
    else
      w.getSelection?.()?.selectAllChildren(best.el);
  } else if (field) {
    const proto = Object.getPrototypeOf(best.el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter)
      setter.call(best.el, text);
    else
      best.el.value = text;
    best.el.dispatchEvent(new w.Event("input", { bubbles: true }));
    best.el.dispatchEvent(new w.Event("change", { bubbles: true }));
  } else {
    best.el.textContent = text;
    best.el.dispatchEvent(new w.Event("input", { bubbles: true }));
  }
  return { typed: text, target, point: { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }, ...typeof w.innerWidth === "number" ? { view: { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) }, seen: { x: Math.round(was.left), y: Math.round(was.top) } } : {} };
}

function controlKeyEvidence(mode) {
  const token = Symbol.for("impeccable.keyEvidence");
  const doc = globalThis.document;
  const old = doc[token];
  if (old) {
    old.stop();
    delete doc[token];
  }
  if (mode === "finish")
    return old?.acted() ?? false;
  const control = doc.activeElement;
  if (!control)
    return false;
  let acted = false;
  const listener = (event) => {
    if (event.type === "submit" ? Boolean(control.form && event.target === control.form) : event.target === control)
      acted = true;
  };
  const types = ["input", "change", "submit"];
  for (const type of types)
    doc.addEventListener(type, listener, true);
  doc[token] = { acted: () => acted, stop: () => {
    for (const type of types)
      doc.removeEventListener(type, listener, true);
  } };
  return false;
}

function focusedControl(region) {
  const roots = [globalThis.document];
  let focus = roots[0].activeElement ?? null;
  for (;; ) {
    if (focus?.shadowRoot?.activeElement) {
      roots.push(focus.shadowRoot);
      focus = focus.shadowRoot.activeElement;
      continue;
    }
    if (focus && (focus.tagName === "IFRAME" || focus.tagName === "FRAME")) {
      let inner = null;
      try {
        inner = focus.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (!inner)
        return null;
      roots.push(inner);
      focus = inner.activeElement ?? null;
      continue;
    }
    break;
  }
  const el = focus, doc = roots.at(-1), all = (selector) => roots.flatMap((root) => Array.prototype.slice.call(root.querySelectorAll(selector)));
  if (!el || /^(?:body|html)$/.test(el.tagName.toLowerCase()))
    return null;
  const tag = el.tagName.toLowerCase();
  const inputType = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : "";
  const inputRole = ["checkbox", "radio"].includes(inputType) ? inputType : inputType === "range" ? "slider" : ["date", "datetime-local", "month", "week", "time", "number"].includes(inputType) ? "spinbutton" : ["button", "submit", "reset", "image", "color"].includes(inputType) ? "button" : "textbox";
  const role = el.getAttribute("role") ?? { button: "button", a: "link", input: inputRole, textarea: "textbox", summary: "button", select: "combobox", dialog: "dialog" }[tag];
  if (!/^(?:a|button|input|select|textarea|summary|dialog)$/.test(tag) && !role && el.getAttribute("tabindex") === null && el.getAttribute("contenteditable") !== "true")
    return null;
  let label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
  if (!label && el.id)
    label = Array.prototype.slice.call(doc.querySelectorAll("label[for]")).find((candidate) => candidate.getAttribute("for") === el.id)?.textContent ?? "";
  const resolved = (label || (tag === "button" || tag === "a" || role ? el.innerText || el.textContent || "" : "")).normalize("NFKC").replace(/\s+/g, " ").trim() || null;
  const classes = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 8) : [];
  const esc = (s) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  const name = el.getAttribute("name");
  const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test");
  const selector = `${tag}${el.id ? `#${esc(el.id)}` : ""}${classes.map((c) => `.${esc(c)}`).join("")}${name ? `[name="${esc(name)}"]` : ""}${testId ? `[data-testid="${esc(testId)}"]` : ""}`;
  const controls = all('button,a,input,select,textarea,summary,dialog,[role],[contenteditable="true"],[tabindex]');
  const styleOf = globalThis.getComputedStyle;
  const visible = (candidate) => {
    const style = styleOf?.(candidate), rect = candidate.getBoundingClientRect?.();
    return style?.display !== "none" && style?.visibility !== "hidden" && style?.visibility !== "collapse" && (!rect || rect.width >= 2 && rect.height >= 2) && !candidate.closest?.("[inert]") && candidate.getAttribute("disabled") === null;
  };
  const modals = all(':modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]').filter((candidate) => (candidate.tagName.toLowerCase() === "dialog" || candidate.getAttribute("aria-modal") === "true") && visible(candidate));
  const modal = modals.filter((candidate) => candidate.contains?.(el)).at(-1) ?? modals.at(-1);
  const sameName = [...new Set([el, ...controls])].filter((candidate) => {
    if (!visible(candidate) || modal && candidate !== modal && !modal.contains?.(candidate))
      return false;
    let name = candidate.getAttribute("aria-label") || candidate.getAttribute("title") || candidate.getAttribute("placeholder") || "";
    if (!name && candidate.id)
      name = all("label[for]").find((label) => label.getAttribute("for") === candidate.id)?.textContent ?? "";
    return (name || candidate.innerText || candidate.textContent || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") === resolved?.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ");
  });
  const signature = (candidate) => JSON.stringify([candidate.tagName.toLowerCase(), typeof candidate.className === "string" ? candidate.className.split(/\s+/).filter(Boolean).sort() : [], candidate.getAttribute("name"), candidate.getAttribute("data-testid") ?? candidate.getAttribute("data-test")]);
  const several = sameName.length, sameSelector = several > 1 && sameName.includes(el) && sameName.every((candidate) => signature(candidate) === signature(el));
  const sharedClasses = classes.filter((c) => sameName.every((candidate) => typeof candidate.className === "string" && candidate.className.split(/\s+/).includes(c))).map((c) => `.${esc(c)}`);
  let inChange = false;
  if (region) {
    const rect = el.getBoundingClientRect?.(), y = globalThis.scrollY ?? 0;
    inChange = !!rect && rect.top + y >= region.top && rect.bottom + y <= region.bottom;
  }
  return { resolved, several, ...sameSelector ? { sameSelector } : {}, ...sharedClasses.length ? { sharedClasses } : {}, ...inChange ? { inChange } : {}, ...label ? { label: label.normalize("NFKC").replace(/\s+/g, " ").trim() } : {}, ...role ? { role } : {}, ...selector !== tag ? { selector } : {} };
}

function locateChange(markers, perMarker, reveal = false, inView = false, observe = false) {
  const g = globalThis;
  const doc = g.document;
  const norm = (t) => t.replace(/\u00a0/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  let hits = [];
  let hidden = [];
  const shutFrom = (n) => n && n.closest ? n.closest("details:not([open])") : null;
  const shutAbove = (el) => {
    for (let shut = shutFrom(el.parentElement);shut; shut = shutFrom(shut.parentElement)) {
      let inSummary = false;
      for (let a = el;a && a !== shut; a = a.parentElement)
        if (String(a.tagName).toUpperCase() === "SUMMARY" && a.parentElement === shut)
          inSummary = true;
      if (!inSummary)
        return shut;
    }
    return null;
  };
  const shownNow = (el, r) => {
    if (r.bottom <= 0 || r.top >= g.innerHeight)
      return false;
    if (r.right !== undefined && r.left !== undefined && g.innerWidth !== undefined && (r.right <= 0 || r.left >= g.innerWidth))
      return false;
    if (!g.getComputedStyle)
      return true;
    if (g.getComputedStyle(el).visibility === "hidden")
      return false;
    for (let a = el;a; a = a.parentElement)
      if (g.getComputedStyle(a).opacity === "0")
        return false;
    return true;
  };
  const push = (el, marker) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || shutAbove(el) || inView && !shownNow(el, r)) {
      hidden.push(el);
      return;
    }
    hits.push({ top: r.top + g.scrollY, bottom: r.bottom + g.scrollY, marker });
  };
  const gather = () => {
    for (const m of markers) {
      try {
        if (m.charAt(0) === "~") {
          const want = m.slice(1);
          let el = doc.body;
          if (!el || norm(el.textContent || "").indexOf(want) < 0)
            continue;
          for (;; ) {
            const kids = Array.prototype.slice.call(el.children);
            const next = kids.find((k) => norm(k.textContent || "").indexOf(want) >= 0);
            if (!next)
              break;
            el = next;
          }
          push(el, m);
          continue;
        }
        const selector = m.charAt(0) === "&" ? m.slice(1) : m.charAt(0) === "=" ? m.slice(1).split(" ").map(function(c) {
          return "." + g.CSS.escape(c);
        }).join("") : m.charAt(0) === "." ? "." + g.CSS.escape(m.slice(1)) : "#" + g.CSS.escape(m.slice(1));
        const found = doc.querySelectorAll(selector);
        for (let i = 0;i < found.length && i < perMarker; i++)
          push(found[i], m);
      } catch {}
    }
  };
  gather();
  let revealed = 0;
  let shutTop;
  if (reveal && hits.length === 0 && hidden.length > 0) {
    for (const el of hidden) {
      for (let shut = shutAbove(el);shut && shut.setAttribute; shut = shutAbove(shut)) {
        const group = shut.getAttribute ? shut.getAttribute("name") : null;
        if (group) {
          const peers = doc.querySelectorAll('details[open][name="' + g.CSS.escape(group) + '"]');
          for (let i = 0;i < peers.length; i++)
            if (peers[i].setAttribute && peers[i].getAttribute?.("data-impeccable-revealed") == null)
              peers[i].setAttribute("data-impeccable-peer", "");
        }
        const top = shut.getBoundingClientRect().top + g.scrollY;
        shutTop = shutTop === undefined ? top : Math.min(shutTop, top);
        shut.setAttribute("open", "");
        shut.setAttribute("data-impeccable-revealed", "");
        revealed++;
      }
    }
    if (revealed > 0) {
      hits = [];
      hidden = [];
      gather();
    }
  }
  const finish = (region) => observe ? { region, found: markers.slice(0, 30).flatMap((m, i) => hits.some((h) => h.marker === m) ? [i] : []) } : region;
  if (hits.length === 0)
    return finish(null);
  hits.sort((a, b) => a.top - b.top);
  const gap = g.innerHeight;
  const groups = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && h.top <= last.bottom + gap) {
      last.bottom = Math.max(last.bottom, h.bottom);
      last.markers[h.marker] = true;
    } else {
      const fresh = {};
      fresh[h.marker] = true;
      groups.push({ top: h.top, bottom: h.bottom, markers: fresh });
    }
  }
  groups.sort((a, b) => Object.keys(b.markers).length - Object.keys(a.markers).length || a.top - b.top);
  const best = groups[0];
  return finish({ top: Math.max(0, Math.round(best.top)), bottom: Math.round(best.bottom), markers: Object.keys(best.markers), ...revealed > 0 ? { revealed, ...shutTop !== undefined ? { shutTop: Math.max(0, Math.round(shutTop)) } : {} } : {} });
}

function restoreClosed() {
  const doc = globalThis.document;
  const opened = doc.querySelectorAll("[data-impeccable-revealed]");
  for (let i = 0;i < opened.length; i++) {
    opened[i].removeAttribute("open");
    opened[i].removeAttribute("data-impeccable-revealed");
  }
  const peers = doc.querySelectorAll("[data-impeccable-peer]");
  for (let i = 0;i < peers.length; i++) {
    peers[i].setAttribute("open", "");
    peers[i].removeAttribute("data-impeccable-peer");
  }
  return opened.length;
}

function pageLinks() {
  const doc = globalThis.document;
  return Array.from(doc.querySelectorAll("a[href]")).map((a) => typeof a.href === "string" ? a.href : "").filter(Boolean).slice(0, 2000);
}

function browserLanguage(tag) {
  try {
    const proto = Object.getPrototypeOf(globalThis.navigator);
    Object.defineProperty(proto, "language", { get: () => tag, configurable: true });
    Object.defineProperty(proto, "languages", { get: () => [tag], configurable: true });
  } catch {}
}

function documentLang() {
  return String(globalThis.document?.documentElement?.lang ?? "");
}

function themeReads() {
  const w = globalThis;
  const els = [w.document.documentElement, w.document.body].filter((e) => Boolean(e));
  const attr = els.flatMap((e) => ["data-theme", "data-color-scheme", "data-mode", "data-bs-theme"].map((n) => e.getAttribute(n) ?? "")).filter(Boolean).join(" ");
  const classes = els.map((e) => typeof e.className === "string" ? e.className : "").join(" ");
  const style = (el) => el && w.getComputedStyle ? w.getComputedStyle(el) : undefined;
  const scheme = style(w.document.documentElement)?.colorScheme ?? "";
  const painted = (c) => c && !/^(?:transparent|rgba\([^)]*,\s*0\))$/.test(c) ? c : "";
  const bg = painted(style(w.document.body)?.backgroundColor) || painted(style(w.document.documentElement)?.backgroundColor);
  const doc = globalThis.performance?.timeOrigin;
  return { attr, classes, scheme, bg, ...typeof doc === "number" ? { doc } : {} };
}

async function readCover(opts) {
  const scope = globalThis;
  const doc = scope.document;
  const style = scope.getComputedStyle;
  if (!doc || !doc.body || !style)
    return null;
  const vh = scope.innerHeight ?? 0;
  const vw = scope.innerWidth ?? 0;
  const frames = () => new Promise((done) => {
    const raf = scope.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
    raf(() => raf(() => done()));
  });
  const name = (el) => {
    const classes = Array.from(el.classList).slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes ? `.${classes}` : ""}`;
  };
  const barOf = (el) => {
    for (let e = el;e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
      const p = style(e).position;
      if ((p === "fixed" || p === "sticky") && e.getBoundingClientRect().width >= vw * 0.5)
        return e;
    }
    return null;
  };
  const rootStyle = doc.documentElement.style;
  const smooth = rootStyle?.scrollBehavior ?? "";
  if (rootStyle)
    rootStyle.scrollBehavior = "auto";
  const settle = async (el) => {
    let last = Math.round(el.getBoundingClientRect().top);
    for (let i = 0;i < 20; i += 1) {
      await frames();
      const now = Math.round(el.getBoundingClientRect().top);
      if (now === last)
        return;
      last = now;
    }
  };
  const words = opts.words.map((w) => w.toLowerCase());
  const meets = (have) => words.filter((w) => have.some((h) => h === w || h.length >= 4 && w.length >= 4 && (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5))))).length;
  const candidates = [];
  const all = Array.from(doc.querySelectorAll("body *")).slice(0, 4000);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0)
      continue;
    const s = style(el);
    if (s.visibility === "hidden" || s.display === "none")
      continue;
    if (barOf(el))
      continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const own = text.length <= 40 ? text : "";
    const named = `${el.id ?? ""} ${Array.from(el.classList).join(" ")} ${el.getAttribute("aria-label") ?? ""} ${own}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const hits = meets(named);
    if (hits > 0)
      candidates.push({ el, hits, ...own ? { label: own } : {} });
  }
  candidates.sort((a, b) => b.hits - a.hits);
  const inPanel = (el) => {
    for (let e = el.parentElement;e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
      const o = style(e).overflowY ?? "visible";
      const box = e;
      if ((o === "auto" || o === "scroll") && (box.scrollHeight ?? 0) > (box.clientHeight ?? 0) + 1)
        return true;
    }
    return false;
  };
  const measurable = candidates.filter((c) => !inPanel(c.el));
  const targets = measurable.slice(0, opts.max);
  const best = candidates[0]?.hits ?? 0;
  const complete = candidates.filter((c) => c.hits === best).every((c) => targets.includes(c));
  const covered = [];
  for (const t of targets) {
    for (const edge of ["bottom", "top"]) {
      const r0 = t.el.getBoundingClientRect();
      const at = (edge === "top" ? r0.top + 3 : r0.bottom - 3) + (scope.scrollY ?? 0);
      scope.scrollTo?.(0, Math.max(0, at - vh / 2));
      await settle(t.el);
      const r = t.el.getBoundingClientRect();
      const y = edge === "top" ? r.top + 3 : r.bottom - 3;
      if (y < 0 || y > vh)
        continue;
      const left = Math.max(1, r.left + 6);
      const right = Math.min(vw - 1, r.right - 6);
      if (right < left)
        continue;
      let hit;
      for (const x of [left, (left + right) / 2, right]) {
        const top = doc.elementFromPoint(x, y);
        if (!top || t.el.contains(top) || top.contains(t.el))
          continue;
        const bar = barOf(top);
        if (bar && !bar.contains(t.el)) {
          hit = { bar, br: bar.getBoundingClientRect() };
          break;
        }
      }
      if (!hit)
        continue;
      const px = Math.round(edge === "bottom" ? Math.min(r.height, r.bottom - hit.br.top) : Math.min(r.height, hit.br.bottom - r.top));
      covered.push({ target: name(t.el), ...t.label ? { label: t.label } : {}, by: name(hit.bar), edge, px: Math.max(1, px) });
      break;
    }
  }
  scope.scrollTo?.(0, 0);
  if (rootStyle)
    rootStyle.scrollBehavior = smooth;
  return { matched: targets.length, covered, ...complete ? {} : { partial: true }, viewport: { width: vw, height: vh }, ...scope.location ? { page: scope.location.pathname } : {} };
}

function readLanding() {
  const doc = globalThis.document;
  const meta = doc.querySelector('meta[http-equiv="refresh" i]');
  let target = null;
  const content = meta ? meta.getAttribute("content") || "" : "";
  const m = /url\s*=\s*['"]?([^'";]+)/i.exec(content);
  if (m && m[1])
    target = m[1].trim();
  const body = doc.body;
  const text = body ? (body.innerText || body.textContent || "").trim() : "";
  const inputs = Array.prototype.slice.call(doc.getElementsByTagName("input"));
  return {
    title: doc.title || "",
    text: text.length,
    metaRefresh: target,
    head: text.slice(0, 160),
    password: inputs.some((input) => (input.getAttribute("type") || "").toLowerCase() === "password" && (typeof input.getClientRects !== "function" || input.getClientRects().length > 0)),
    netlifyMark: doc.querySelector('a[href^="https://www.netlify.com"], a[href^="https://netlify.com"]') !== null
  };
}

function relativeStylesMissedInPage() {
  const g = globalThis;
  const links = Array.prototype.slice.call(g.document.querySelectorAll('link[rel~="stylesheet"][href]'));
  return links.some((l) => {
    if (/^(?:[a-z][a-z\d+.-]*:|[/?#])/i.test(l.getAttribute("href") ?? "/"))
      return false;
    return g.performance.getEntriesByName(l.href).reduce((last, e) => e.responseStatus ?? last, 0) >= 400;
  });
}

function installSystemFace(base64, families, descriptors, key) {
  const scope = globalThis;
  const doc = scope.document;
  const fonts = doc?.fonts;
  if (!doc || !fonts || typeof scope.FontFace !== "function" || typeof scope.atob !== "function")
    return;
  const name = (family) => String(family).replace(/^["']|["']$/g, "").trim().toLowerCase();
  let watch;
  const yieldToPage = () => {
    const ours = scope[key] ?? [];
    const theirs = new Set;
    fonts.forEach((face) => {
      if (ours.indexOf(face) === -1)
        theirs.add(name(face.family));
    });
    const kept = ours.filter((face) => {
      if (!theirs.has(name(face.family)))
        return true;
      fonts.delete(face);
      return false;
    });
    scope[key] = kept;
    if (kept.length === 0)
      watch?.disconnect();
  };
  if (!Array.isArray(scope[key])) {
    const text = scope.atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0;i < text.length; i++)
      bytes[i] = text.charCodeAt(i);
    const added = [];
    for (const family of families) {
      try {
        const face = new scope.FontFace(family, bytes.buffer, descriptors);
        fonts.add(face);
        added.push(face);
      } catch {}
    }
    scope[key] = added;
    doc.addEventListener?.("DOMContentLoaded", yieldToPage, { once: true });
    scope.addEventListener?.("load", yieldToPage, { once: true });
    if (typeof scope.MutationObserver === "function") {
      const observer = new scope.MutationObserver((records) => {
        for (const record of records) {
          for (let i = 0;i < record.addedNodes.length; i++) {
            const node = record.addedNodes[i];
            if (node.nodeName === "LINK")
              node.addEventListener?.("load", yieldToPage, { once: true });
            else if (node.nodeName === "STYLE")
              scope.setTimeout?.(yieldToPage, 0);
          }
        }
      });
      observer.observe(doc, { childList: true, subtree: true });
      watch = observer;
    }
    const later = () => {
      scope.setTimeout?.(yieldToPage, 0);
    };
    const add = fonts.add;
    fonts.add = function(face) {
      const result = add.call(this, face);
      later();
      return result;
    };
    const sheet = scope.CSSStyleSheet?.prototype;
    for (const method of ["insertRule", "replace", "replaceSync"]) {
      const original = sheet?.[method];
      if (typeof original !== "function")
        continue;
      sheet[method] = function(text, ...rest) {
        const result = original.call(this, text, ...rest);
        if (/@font-face/i.test(String(text))) {
          if (result && typeof result.then === "function")
            result.then(later, () => {});
          else
            later();
        }
        return result;
      };
    }
  }
  yieldToPage();
}

function readConsentState() {
  const g = globalThis;
  const s = g.__impeccableConsent;
  if (!s || typeof s !== "object")
    return null;
  return { ...s, age: typeof s.since === "number" && g.performance ? g.performance.now() - s.since : 0 };
}

function consentSeen() {
  return globalThis.__impeccableConsentSeen === true;
}

function markConsentSeen() {
  globalThis.__impeccableConsentSeen = true;
}

function collectA11ySample(probeFocus = true) {
  const scope = globalThis;
  const doc = scope.document;
  const attr = (node, name) => {
    try {
      const getAttribute = node.getAttribute;
      const value = typeof getAttribute === "function" ? getAttribute.call(node, name) : null;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };
  const hasAttr = (node, name) => {
    try {
      const hasAttribute = node.hasAttribute;
      return typeof hasAttribute === "function" ? hasAttribute.call(node, name) === true : false;
    } catch {
      return false;
    }
  };
  const text = (node) => {
    if (!node)
      return "";
    const content = typeof node.textContent === "string" ? node.textContent : "";
    return content.replace(/\s+/g, " ").trim().slice(0, 200);
  };
  const label = (node) => {
    const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "element";
    const id = attr(node, "id");
    if (id)
      return `${tag}#${id}`;
    const className = attr(node, "class").trim();
    if (className)
      return `${tag}.${className.split(/\s+/)[0]}`;
    const own = text(node);
    return own ? `${tag} "${own.slice(0, 30)}"` : tag;
  };
  const labelledBy = (node) => {
    const ids = attr(node, "aria-labelledby").trim();
    if (!ids)
      return "";
    let out = "";
    for (const id of ids.split(/\s+/)) {
      try {
        out += ` ${text(doc.getElementById(id))}`;
      } catch {}
    }
    return out.trim();
  };
  const lang = doc.documentElement && typeof doc.documentElement.lang === "string" ? doc.documentElement.lang : "";
  let mainLandmarks = 0;
  try {
    mainLandmarks = doc.querySelectorAll('main, [role="main"]').length;
  } catch {
    mainLandmarks = 0;
  }
  let headingCount = 0;
  try {
    headingCount = doc.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
  } catch {
    headingCount = 0;
  }
  const bodyText = doc.body ? typeof doc.body.innerText === "string" ? doc.body.innerText : typeof doc.body.textContent === "string" ? doc.body.textContent : "" : "";
  const textLength = bodyText.replace(/\s+/g, " ").trim().length;
  const images = [];
  const totals = { images: 0, controls: 0, fields: 0 };
  try {
    const nodes = doc.querySelectorAll("img");
    totals.images = nodes.length;
    for (let i = 0;i < nodes.length && images.length < 200; i++) {
      const node = nodes[i];
      const rect = node.getBoundingClientRect.call(node);
      images.push({
        selector: label(node),
        hasAlt: hasAttr(node, "alt"),
        altText: attr(node, "alt"),
        ariaHidden: attr(node, "aria-hidden") === "true",
        role: attr(node, "role").toLowerCase(),
        width: rect.width,
        height: rect.height
      });
    }
  } catch {}
  const controls = [];
  try {
    const nodes = doc.querySelectorAll('button, a[href], [role="button"], [role="link"], input[type="button"], input[type="submit"]');
    totals.controls = nodes.length;
    for (let i = 0;i < nodes.length && controls.length < 250; i++) {
      const node = nodes[i];
      const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "element";
      let innerImageAlt = "";
      try {
        const inner = node.querySelectorAll.call(node, "img[alt], svg title");
        for (let j = 0;j < inner.length; j++) {
          innerImageAlt += ` ${attr(inner[j], "alt")} ${text(inner[j])}`;
        }
      } catch {}
      const value = tag === "input" ? attr(node, "value") : "";
      controls.push({
        selector: label(node),
        tag,
        role: attr(node, "role").toLowerCase(),
        text: `${text(node)} ${value}`.trim(),
        ariaLabel: attr(node, "aria-label"),
        labelledByText: labelledBy(node),
        title: attr(node, "title"),
        innerImageAlt: innerImageAlt.trim(),
        ariaHidden: attr(node, "aria-hidden") === "true",
        disabled: hasAttr(node, "disabled") || attr(node, "aria-disabled") === "true"
      });
    }
  } catch {}
  const fields = [];
  try {
    const nodes = doc.querySelectorAll("input, select, textarea");
    totals.fields = nodes.length;
    for (let i = 0;i < nodes.length && fields.length < 200; i++) {
      const node = nodes[i];
      const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "input";
      const type = tag === "input" ? (attr(node, "type") || "text").toLowerCase() : tag;
      let hasLabelElement = false;
      try {
        const id = attr(node, "id");
        if (id) {
          const labels = doc.querySelectorAll("label[for]");
          for (let j = 0;j < labels.length; j++) {
            if (attr(labels[j], "for") === id) {
              hasLabelElement = true;
              break;
            }
          }
        }
        if (!hasLabelElement) {
          const closest = node.closest;
          if (typeof closest === "function" && closest.call(node, "label"))
            hasLabelElement = true;
        }
      } catch {
        hasLabelElement = false;
      }
      fields.push({
        selector: label(node),
        type,
        hasLabelElement,
        ariaLabel: attr(node, "aria-label"),
        labelledByText: labelledBy(node),
        title: attr(node, "title"),
        placeholder: attr(node, "placeholder"),
        ariaHidden: attr(node, "aria-hidden") === "true"
      });
    }
  } catch {}
  const focus = [];
  if (!probeFocus)
    return { lang, mainLandmarks, textLength, headingCount, images, controls, fields, focus, totals };
  const restoredSelectors = [];
  const focusSelector = (selector) => {
    let out = "";
    let quote = "";
    let attribute = false;
    for (let i = 0;i < selector.length; i++) {
      const ch = selector[i];
      if (ch === "\\") {
        out += ch + (selector[++i] ?? "");
        continue;
      }
      if (quote) {
        if (ch === quote)
          quote = "";
      } else if (ch === '"' || ch === "'")
        quote = ch;
      else if (ch === "[")
        attribute = true;
      else if (ch === "]")
        attribute = false;
      else if (!attribute && /^:focus-visible(?![-\w])/i.test(selector.slice(i))) {
        out += ":focus";
        i += ":focus-visible".length - 1;
        continue;
      }
      out += ch;
    }
    return out;
  };
  const prepareFocusRules = (parent) => {
    let rules;
    try {
      rules = parent.cssRules;
    } catch {
      return;
    }
    for (let i = 0;rules && i < rules.length; i++) {
      const rule = rules[i];
      try {
        if (rule.selectorText) {
          const selector = rule.selectorText;
          const replacement = focusSelector(selector);
          if (replacement !== selector) {
            rule.selectorText = replacement;
            restoredSelectors.push({ rule, selector, replacement: rule.selectorText });
          }
        }
        prepareFocusRules(rule);
        if (rule.styleSheet)
          prepareFocusRules(rule.styleSheet);
      } catch {}
    }
  };
  const scrollX = typeof scope.scrollX === "number" ? scope.scrollX : 0;
  const scrollY = typeof scope.scrollY === "number" ? scope.scrollY : 0;
  try {
    const sheets = doc.styleSheets;
    for (let i = 0;sheets && i < sheets.length; i++)
      prepareFocusRules(sheets[i]);
    try {
      doc.activeElement?.blur?.();
    } catch {}
    const nodes = doc.querySelectorAll("a[href], button, input, select, textarea, [tabindex]");
    const read = (node) => {
      const style = scope.getComputedStyle ? scope.getComputedStyle(node) : {};
      return {
        outlineWidth: style.outlineWidth ?? "",
        outlineStyle: style.outlineStyle ?? "",
        outlineColor: style.outlineColor ?? "",
        boxShadow: style.boxShadow ?? "",
        border: `${style.borderTopWidth ?? ""} ${style.borderTopColor ?? ""} ${style.borderBottomWidth ?? ""}`,
        background: style.backgroundColor ?? "",
        color: style.color ?? "",
        textDecoration: style.textDecorationLine ?? ""
      };
    };
    let probed = 0;
    for (let i = 0;i < nodes.length && probed < 16; i++) {
      const node = nodes[i];
      const rect = node.getBoundingClientRect.call(node);
      if (!(rect.width > 0) || !(rect.height > 0))
        continue;
      if (hasAttr(node, "disabled"))
        continue;
      const before = read(node);
      const focusFn = node.focus;
      if (typeof focusFn !== "function")
        continue;
      focusFn.call(node, { preventScroll: true });
      const after = read(node);
      probed += 1;
      let changedOtherwise = false;
      for (const key of ["boxShadow", "border", "background", "color", "textDecoration"]) {
        if (before[key] !== after[key])
          changedOtherwise = true;
      }
      focus.push({
        selector: label(node),
        outlineWidth: parseFloat(after.outlineWidth ?? "") || 0,
        outlineStyle: after.outlineStyle ?? "",
        changedOtherwise
      });
    }
  } catch {} finally {
    for (const { rule, selector, replacement } of restoredSelectors.reverse()) {
      try {
        if (rule.selectorText === replacement)
          rule.selectorText = selector;
      } catch {}
    }
    try {
      const active = doc.activeElement;
      if (active && typeof active.blur === "function")
        active.blur();
      if (typeof scope.scrollTo === "function")
        scope.scrollTo(scrollX, scrollY);
    } catch {}
  }
  return { lang, mainLandmarks, textLength, headingCount, images, controls, fields, focus, totals };
}

function documentTitle() {
  return globalThis.document.title;
}

function letGoOfFocus() {
  globalThis.document.activeElement?.blur?.();
}

function secretFocus() {
  let el = globalThis.document.activeElement ?? null;
  for (;; ) {
    if (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
      continue;
    }
    if (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      let inner = null;
      try {
        inner = el.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (!inner)
        return "frame";
      el = inner.activeElement ?? null;
      continue;
    }
    break;
  }
  if (!el)
    return null;
  const tokens = String(el.getAttribute?.("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (el.tagName === "INPUT" && String(el.type).toLowerCase() === "password" || el.getAttribute?.("data-impeccable-secret-field") != null || tokens.some((t) => t === "current-password" || t === "new-password"))
    return "password";
  if (tokens.some((t) => t.startsWith("cc-")))
    return "card";
  if (tokens.includes("one-time-code"))
    return "code";
  return null;
}

function viewSize() {
  const w = globalThis;
  return { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) };
}

function coverSecrets(on, forMs) {
  const mark = "--secret-cover";
  const seen = "data-impeccable-secret-field";
  const maybe = "data-impeccable-secret-maybe";
  const held = "data-impeccable-secret-form";
  const named = ["name", "id", "placeholder", "aria-label"];
  const other = ["checkbox", "radio", "button", "submit", "hidden", "file", "range", "color", "image", "reset", "date", "datetime-local", "month", "time", "week"];
  const fields = `input[type="password" i], [${seen}], [${maybe}], input:not(${other.map((t) => `[type="${t}" i]`).join(", ")}):is(${named.flatMap((a) => ["passw", "pwd"].map((w) => `[${a}*="${w}" i]`)).join(", ")}), [autocomplete*="password" i], [autocomplete*="one-time-code" i], [autocomplete*="cc-" i]`;
  const rule = `@layer secret-cover { ${fields} { ${mark}: 1; filter: brightness(0) !important; background-color: #000 !important; box-shadow: inset 0 0 0 100vmax #000 !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } }`;
  const g = globalThis;
  const ours = (sheet) => {
    try {
      return sheet.cssRules[0]?.cssText.includes(mark) === true;
    } catch {
      return false;
    }
  };
  const html = "http://www.w3.org/1999/xhtml";
  const shadow = (el) => {
    if (el.shadowRoot || el.namespaceURI && el.namespaceURI !== html)
      return el.shadowRoot ?? null;
    try {
      return g.chrome?.dom?.openOrClosedShadowRoot?.(el) ?? null;
    } catch {
      el.setAttribute(maybe, "");
      return null;
    }
  };
  const wear = { filter: "brightness(0)", "background-color": "#000", "box-shadow": "inset 0 0 0 100vmax #000", "-webkit-text-fill-color": "transparent", "caret-color": "transparent", transition: "none" };
  const kept = g[Symbol.for("secret-cover-kept")] ??= new Map;
  const worn = (f) => f.style?.getPropertyValue("filter") === "brightness(0)" && f.style.getPropertyPriority("filter") === "important";
  let covered = 0;
  let bare = 0;
  const visit = (root, Made, on) => {
    const others = root.adoptedStyleSheets.filter((sheet) => !ours(sheet));
    if (!on) {
      if (others.length !== root.adoptedStyleSheets.length)
        root.adoptedStyleSheets = others;
    } else if (others.length === root.adoptedStyleSheets.length) {
      const sheet = new Made;
      sheet.replaceSync(rule);
      root.adoptedStyleSheets = [...others, sheet];
    }
    if (on) {
      const kind = (f) => String(f.type).toLowerCase();
      const inputs = (box) => Array.from(box.querySelectorAll("input"));
      for (const f of inputs(root))
        if (f.getAttribute(seen) === null && (kind(f) === "password" || /current-password|new-password/i.test(f.getAttribute("autocomplete") ?? "")))
          f.setAttribute(seen, "");
      const shown = (f) => {
        const size = f.getBoundingClientRect();
        return size.width > 0 && size.height > 0;
      };
      const counts = (f) => f.getAttribute(seen) !== null || kind(f) === "text" && named.some((a) => /passw|pwd/i.test(f.getAttribute(a) ?? ""));
      const passwords = (box, all) => inputs(box).filter((f) => counts(f) && (all || shown(f))).length;
      const account = (f) => {
        const said = [...named, "autocomplete"].map((a) => f.getAttribute(a) ?? "").join(" ");
        return ["email", "tel"].includes(kind(f)) || /user|mail|login|phone|account/i.test(said) && !/pass|pwd/i.test(said);
      };
      for (const box of Array.from(root.querySelectorAll(`[${held}]`))) {
        const [most, mostShown, had] = (box.getAttribute(held) ?? "").split(" ");
        const gone = passwords(box, true) < Number(most);
        const all = inputs(box);
        if (!gone && passwords(box, false) >= Number(mostShown) || had && !all.some((f) => f.getAttribute(`${held}-name`) !== null))
          continue;
        const hidden = all.filter((f) => counts(f) && !shown(f));
        const clone = (f) => hidden.some((h) => h.parentElement === f.parentElement || Boolean(h.value) && h.value === f.value);
        for (const f of all)
          if (kind(f) === "text" && f.value && shown(f) && !account(f) && f.getAttribute(seen) === null && (gone || clone(f)))
            f.setAttribute(maybe, "");
      }
      for (const field of inputs(root)) {
        if (!counts(field))
          continue;
        const round = [];
        for (let box = field.form ? null : field.parentElement;box && box.tagName !== "HTML" && (box.tagName !== "BODY" || box === field.parentElement); box = box.parentElement)
          round.push(box);
        const upTo = round.findIndex((box) => inputs(box).some(account));
        for (const box of field.form ? [field.form] : round.slice(0, upTo < 0 ? 2 : upTo + 1)) {
          const accounts = inputs(box).filter(account);
          for (const f of accounts)
            f.setAttribute(`${held}-name`, "");
          const [most, mostShown, had] = (box.getAttribute(held) ?? "").split(" ");
          box.setAttribute(held, `${Math.max(Number(most) || 0, passwords(box, true))} ${Math.max(Number(mostShown) || 0, passwords(box, false))}${had || accounts.length ? " named" : ""}`);
        }
      }
      for (const f of Array.from(root.querySelectorAll(fields))) {
        covered += 1;
        if (f.style && (kept.has(f) || !worn(f))) {
          const was = kept.get(f) ?? { style: f.getAttribute("style"), css: f.style.cssText, after: null, props: {} };
          if (!kept.has(f)) {
            const make = () => f.ownerDocument?.createElementNS?.(html, "i");
            const [said, applied] = [make(), make()];
            if (!said?.style || !applied?.style)
              was.refused = true;
            else {
              said.style.cssText = was.style ?? "";
              applied.style.cssText = was.css;
              was.refused = said.style.cssText !== applied.style.cssText || applied.style.cssText !== was.css;
            }
          }
          if (kept.has(f) && f.getAttribute("style") !== was.after)
            was.changed = true;
          for (const [name, value] of Object.entries(wear)) {
            if (!(name in was.props))
              was.props[name] = [f.style.getPropertyValue(name), f.style.getPropertyPriority(name)];
            f.style.setProperty(name, value, "important");
          }
          if (!was.changed)
            was.after = f.getAttribute("style");
          kept.set(f, was);
        }
        try {
          const look = f.ownerDocument?.defaultView?.getComputedStyle(f);
          const drawn = Boolean(look?.display) && look.display !== "none" && (f.getClientRects?.().length ?? 1) > 0;
          const filled = (() => {
            try {
              return f.matches?.(":autofill") === true;
            } catch {
              return false;
            }
          })();
          const black = look.backgroundColor === "rgb(0, 0, 0)" || filled && /^rgb\(0, 0, 0\) .*inset/.test(look.boxShadow);
          if (drawn && (!/brightness\(0\)/.test(look.filter) || !black || !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(look.webkitTextFillColor ?? "transparent")))
            bare += 1;
        } catch {
          f.getRootNode?.()?.host?.setAttribute(maybe, "");
        }
      }
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const own = shadow(el);
      if (own)
        visit(own, Made, on);
      if (el.tagName !== "IFRAME" && el.tagName !== "FRAME")
        continue;
      let inner = null;
      try {
        inner = el.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (inner?.defaultView)
        visit(inner, inner.defaultView.CSSStyleSheet, on);
    }
  };
  const off = () => {
    visit(g.document, g.CSSStyleSheet, false);
    for (const [f, { style, css, after, changed, refused, props }] of kept) {
      if (!changed && !refused && f.style && f.getAttribute("style") === after) {
        f.style.cssText = css;
        if (style === null)
          f.removeAttribute?.("style");
        else if (f.getAttribute("style") !== style)
          f.setAttribute("style", style);
        continue;
      }
      for (const [name, [value, priority]] of Object.entries(props)) {
        if (value)
          f.style?.setProperty(name, value, priority);
        else
          f.style?.removeProperty(name);
      }
      if (style === null && f.getAttribute("style") === "")
        f.removeAttribute?.("style");
    }
    kept.clear();
  };
  if (on)
    visit(g.document, g.CSSStyleSheet, true);
  else
    off();
  const timer = Symbol.for("secret-cover");
  g.clearTimeout(g[timer]);
  if (on && forMs)
    g[timer] = g.setTimeout(off, forMs);
  if (bare)
    throw new Error(`${bare} secret field${bare === 1 ? "" : "s"} not covered`);
  return covered;
}

function coverHolds() {
  const g = globalThis;
  let selector;
  for (const sheet of Array.from(g.document.adoptedStyleSheets)) {
    try {
      if (sheet.cssRules[0]?.cssText.includes("--secret-cover"))
        selector = sheet.cssRules[0].cssRules?.[0]?.selectorText;
    } catch {}
  }
  if (!selector)
    return -1;
  let bare = 0;
  const visit = (root) => {
    for (const f of Array.from(root.querySelectorAll(selector))) {
      let look;
      try {
        look = f.ownerDocument?.defaultView?.getComputedStyle(f);
      } catch {
        look = undefined;
      }
      if (!look?.display || look.display === "none" || !((f.getClientRects?.().length ?? 1) > 0))
        continue;
      let filled = false;
      try {
        filled = f.matches?.(":autofill") === true;
      } catch {
        filled = false;
      }
      const black = look.backgroundColor === "rgb(0, 0, 0)" || filled && /^rgb\(0, 0, 0\) .*inset/.test(look.boxShadow);
      if (!/brightness\(0\)/.test(look.filter) || !black || !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(look.webkitTextFillColor ?? "transparent"))
        bare += 1;
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      let own = el.shadowRoot ?? null;
      if (!own && (!el.namespaceURI || el.namespaceURI === "http://www.w3.org/1999/xhtml")) {
        try {
          own = g.chrome?.dom?.openOrClosedShadowRoot?.(el) ?? null;
        } catch {
          own = null;
        }
      }
      if (own)
        visit(own);
      if (el.tagName !== "IFRAME" && el.tagName !== "FRAME")
        continue;
      let inner = null;
      try {
        inner = el.contentDocument ?? null;
      } catch {
        inner = null;
      }
      if (inner)
        visit(inner);
    }
  };
  visit(g.document);
  return bare;
}

export const helpers = Object.freeze({ clickByText, confirmingControl, currentUrlOf, fieldReads, focusedText, pageAddress, pageSignature, scrollBy, scrollPageTo, scrollToSurface, typeInto, controlKeyEvidence, focusedControl, locateChange, restoreClosed, pageLinks, browserLanguage, documentLang, themeReads, readCover, readLanding, relativeStylesMissedInPage, installSystemFace, readConsentState, consentSeen, markConsentSeen, collectA11ySample, documentTitle, letGoOfFocus, secretFocus, viewSize, coverSecrets, coverHolds });

/** The helpers that read what the consent rules leave in the page's own world: run there. */
export const pageWorld = Object.freeze(["readConsentState","consentSeen","markConsentSeen"]);

/** The helpers added to each new document, and only there (`loadConsent` is consent-rules.js). */
export const newDocument = Object.freeze(["browserLanguage","installSystemFace","loadConsent"]);

/** The helpers that find what lies at a point: the badge hides while one runs, so it is never what they find. */
export const atAPoint = Object.freeze(["clickByText","confirmingControl","fieldReads","scrollBy","readCover"]);

/** Each helper's `noSecrets` argument, which this extension always sets: no password, card or one-time-code field is typed into or read. */
export const noSecrets = Object.freeze({"typeInto":3,"fieldReads":1});

/** This file's and consent-rules.js's hash (sha-256 of the two, this line left out): the hello says it. */
export const HASH = 'fcdb5b4609b2901d';
