// The only code a journey runs in a page: the server names one of these and gives its arguments. Generated from the
// functions the server's own browser runs, so the two read a page alike. Changes arrive as a whole new copy of this
// file and consent-rules.js, with HASH below: an edit by hand here is overwritten, and makes HASH untrue.

function clickByText(wanted, opts) {
  const w = globalThis, doc = w.document, norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(), stop = ["the", "a", "an", "button", "link", "in", "on", "header", "footer", "nav", "menu", "at", "top", "of", "to"], spoken = norm(wanted).split(" "), nextTo = / (?:next to|beside) /.test(` ${spoken.join(" ")} `), real = spoken.filter((x, i) => stop.indexOf(x) === -1 && !(x === "next" && spoken[i + 1] === "to")), wantsBeside = nextTo || /\b(?:icons?|arrows?|carets?|chevrons?|plus|minus)\b/i.test(wanted), wantsMenu = /\b(?:hamburger|burger|menu (?:button|icon|toggle)|nav(?:igation)? (?:toggle|button|icon|menu)|toggle navigation)\b/i.test(wanted), words = real.length > 0 || wantsMenu ? real : spoken.filter((x) => !/^(?:the|a|an|in|on|at|of|to)$/.test(x));
  if (words.length === 0 && !wantsMenu)
    return null;
  const modals = Array.prototype.slice.call(doc.querySelectorAll(':modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')).filter((el) => {
    const modal = el.tagName.toLowerCase() === "dialog" || el.getAttribute("aria-modal") === "true" && /^(?:alert)?dialog$/.test(el.getAttribute("role") ?? ""), r = el.getBoundingClientRect(), style = typeof w.getComputedStyle === "function" ? w.getComputedStyle(el) : null;
    return modal && r.width >= 2 && r.height >= 2 && (!style || style.visibility !== "hidden" && style.display !== "none");
  }), focusedModals = modals.filter((el) => doc.activeElement && el.contains?.(doc.activeElement)), modal = focusedModals[focusedModals.length - 1] ?? modals[modals.length - 1], beside = (el) => {
    if (!wantsBeside || el.getAttribute("aria-label") || el.getAttribute("title"))
      return "";
    const r = el.getBoundingClientRect();
    if (r.width > 48 || r.height > 48 || el.querySelector?.('img[alt]:not([alt=""]), [aria-label], title'))
      return "";
    const gap = (b) => Math.max(0, b.left - r.left - r.width, r.left - b.left - b.width) + Math.max(0, b.top - r.bottom, r.top - b.bottom);
    return [el.previousElementSibling, el.nextElementSibling].filter((n) => !!n && (n.textContent ?? "").length <= 80).map((n) => ({ t: norm(n.innerText || n.textContent || ""), d: gap(n.getBoundingClientRect()) })).filter((n) => n.t && n.t.length <= 40).sort((a, b) => a.d - b.d)[0]?.t ?? "";
  }, informal = Array.prototype.slice.call(doc.querySelectorAll("*")).filter((el) => {
    const worded = !!(el.textContent || el.innerText || "").trim();
    if (!worded && !wantsBeside)
      return !1;
    const style = w.getComputedStyle?.(el);
    if (style?.visibility === "hidden" || style?.display === "none")
      return !1;
    return (typeof el.onclick === "function" || style?.cursor === "pointer" && (!el.parentElement || w.getComputedStyle?.(el.parentElement)?.cursor !== "pointer")) && (worded || !!beside(el));
  }), semantic = Array.prototype.slice.call(doc.querySelectorAll(opts?.any ? `a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"]), h1, h2, h3, h4, h5, h6, p, li, figure, figcaption, img, video, [aria-label], [title]${opts.files ? ", div, section" : ""}` : 'a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"])')), visible = [...new Set([...semantic, ...informal])].filter((el) => {
    const style = w.getComputedStyle?.(el);
    return (!modal || !!modal.contains?.(el)) && style?.visibility !== "hidden" && style?.visibility !== "collapse" && style?.display !== "none";
  }), carries = (el) => [el.getAttribute("aria-label") ?? "", el.innerText || el.textContent || ""].some((n) => norm(n) === words.join(" ")), labelsOf = (el) => Array.prototype.slice.call(el.labels ?? []), inside = (owner, hit) => {
    if (hit !== owner && !owner.contains?.(hit))
      return !1;
    const inner = opts?.any ? null : hit.closest?.('a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"])');
    return !inner || inner === owner || inner === owner.control || !owner.contains?.(inner);
  }, reach = (el) => {
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
  }, candidates = ((pool) => pool.filter((el) => !informal.includes(el) || !pool.some((child) => {
    if (child === el || !el.contains?.(child) || norm(child.innerText || child.textContent || "") !== norm(el.innerText || el.textContent || ""))
      return !1;
    if (carries(el) && !carries(child))
      return !1;
    const rect = child.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && !!reach(child);
  })))(visible);
  let within = null;
  if (opts?.within)
    try {
      const all = doc.querySelectorAll(opts.within);
      within = all.length === 1 ? all[0] : null;
    } catch {
      within = null;
    }
  let best = null;
  if (modal)
    within = modal;
  const asked = words.join(" "), fullyNamed = candidates.some((el) => {
    if (within?.contains && !within.contains(el) && within !== el)
      return !1;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && (norm(el.innerText || el.textContent || "") === asked || norm(el.getAttribute("aria-label") ?? "") === asked);
  }), requestedName = (el) => {
    const role = el.getAttribute("role");
    return (role === "switch" || role === "checkbox" || el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "checkbox") && !fullyNamed ? asked.replace(/ (?:toggle|switch|checkbox)$/, "") || asked : asked;
  }, named = [], partly = [], isSlider = (el) => el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "range" || el.getAttribute("role") === "slider", wantsButton = /\b(?:buttons?|btn)\b/i.test(wanted), wantsTick = /\b(?:circles?|checkbox(?:es)?|check ?marks?|ticks?|tick ?box(?:es)?|radio(?: button)?s?)\b/i.test(wanted), isTick = (el) => /^(?:checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(el.getAttribute("role") ?? "") || el.tagName.toLowerCase() === "input" && /^(?:checkbox|radio)$/.test(el.getAttribute("type") ?? ""), rowOf = (el) => {
    if (norm(`${el.innerText || el.textContent || ""}`) || isTick(el) && !wantsTick)
      return "";
    const row = el.closest?.('li, tr, [role="row"], [role="listitem"], [role="option"], [role="treeitem"]'), words = row ? norm(row.innerText || row.textContent || "") : beside(el);
    return words.length <= 200 ? words : "";
  }, SHAPE = /^(?:hamburger|burger|lines?|bars?|stripes?|icon|corner|top|right|left|upper|toggle|nav|navigation|three|two|open|close|mobile|header|small|with|and|or|its|that|has|like|near|beside|under|above|by|from|for|side)$/i, wantsIcon = /\bicons?\b/i.test(wanted), isButton = (el) => {
    const tag = el.tagName.toLowerCase();
    return tag === "button" || el.getAttribute("role") === "button" || tag === "input" && /^(?:button|submit|reset)$/i.test(el.getAttribute("type") ?? "");
  }, wantsSlider = !!opts?.drag && /\b(?:sliders?|faders?|crossfaders?|scrubbers?|range (?:input|control|slider)s?)\b/i.test(wanted), sectionOfPage = (el) => {
    if (el.getAttribute("role") === "tab" || !!el.closest?.('[role="tablist"]'))
      return !0;
    const href = el.tagName.toLowerCase() === "a" ? el.getAttribute("href") : null;
    if (!href || !w.location?.href)
      return !1;
    let here, to;
    try {
      here = new URL(w.location.href);
      to = new URL(href, here);
    } catch {
      return !1;
    }
    if (to.origin !== here.origin)
      return !1;
    const path = (u) => u.pathname.replace(/\/+$/, "");
    return path(to) === path(here) && (to.search !== "" || to.search !== here.search) || path(here) !== "" && path(to).indexOf(`${path(here)}/`) === 0;
  }, cardTexts = new Map, scored = new Map;
  for (const el of candidates) {
    const asked = requestedName(el), rect = el.getBoundingClientRect();
    if ((rect.width < 2 || rect.height < 2) && !(el.tagName.toLowerCase() === "input" && /^(?:checkbox|radio)$/.test(el.getAttribute("type") ?? "") && rect.width > 0 && rect.height > 0))
      continue;
    const label = norm(`${el.innerText || el.textContent || ""}`) || norm(el.getAttribute("aria-label") ?? ""), labelled = Array.prototype.map.call(el.labels ?? [], (l) => l.innerText || l.textContent || "").join(" "), row = rowOf(el), text = norm(`${label} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.value ?? ""} ${row} ${labelled}`);
    if (!text)
      continue;
    let score = 0, chrome = !1;
    for (const x of words)
      if (new RegExp(`(?:^|\\s)${x}(?:\\s|$)`).test(text))
        score += 1;
    if (score === 0)
      continue;
    const nameWords = label.split(" ").filter((x) => stop.indexOf(x) === -1), extra = words.filter((x) => !SHAPE.test(x) && ` ${text} `.indexOf(` ${x} `) === -1), card = nameWords.length > 0 && extra.length > 0 && nameWords.every((x) => words.indexOf(x) !== -1) ? el.closest?.('li, article, tr, [role="listitem"], [role="row"], [role="article"]') : null;
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
      const inChrome = !!el.closest('header, footer, [role="banner"], [role="contentinfo"]'), inSiteNav = !!el.closest('nav, [role="navigation"]') && !el.closest('main, aside, article, section, [role="main"], [role="complementary"]');
      if (inChrome || inSiteNav)
        score -= 1;
      chrome = inChrome || inSiteNav;
    }
    if (label === asked)
      score += 4;
    else if (` ${label} `.indexOf(` ${asked} `) !== -1)
      score += 2;
    else if (text === asked)
      score += 2;
    if (wantsSlider && isSlider(el))
      score += 2;
    if (wantsButton && isButton(el) || wantsIcon && !norm(`${el.innerText || el.textContent || ""}`) || wantsTick && isTick(el))
      score += 1.5;
    const inView = rect.bottom > 0 && rect.top < w.innerHeight;
    if (inView)
      score += 0.5;
    if (row && text === row)
      score += wantsBeside ? 0.25 : -0.25;
    const inViewBoth = inView && (typeof w.innerWidth !== "number" || rect.left + rect.width > 0 && rect.left < w.innerWidth), name = label || norm(labelled) || text, own = { el, score, text: name.slice(0, 60), size: name.length };
    scored.set(el, { own, label });
    const captioned = el.tagName.toLowerCase() === "input" && /^(?:submit|reset|button)$/i.test(el.getAttribute("type") ?? "");
    if (label.replace(/^(?:step )?\d+ /, "") === asked || norm(el.getAttribute("aria-label") ?? "") === asked || captioned && norm(el.value ?? "") === asked)
      named.push({ ...own, inView: inViewBoth, chrome, leads: !0 });
    else if (` ${label} `.indexOf(` ${asked} `) !== -1)
      partly.push({ ...own, inView: inViewBoth, chrome, leads: `${label} `.indexOf(`${asked} `) === 0 });
    if (!best || score > best.score || score === best.score && own.size < (best.size ?? best.text.length))
      best = own;
  }
  let several = 0, by, ambiguous = !1;
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
      ambiguous = !0;
    best = pool.reduce((a, n) => n.score > a.score || n.score === a.score && n.text.length < a.text.length ? n : a);
  }
  const prep = spoken.findIndex((x, i) => i > 0 && /^(?:for|under|in|inside|within|on|of)$/.test(x) && spoken.slice(0, i).some((y) => stop.indexOf(y) === -1)), tail = prep === -1 ? [] : spoken.slice(prep + 1).filter((x) => stop.indexOf(x) === -1 && !SHAPE.test(x)), head = (prep === -1 ? spoken : spoken.slice(0, prep)).filter((x) => stop.indexOf(x) === -1 && !SHAPE.test(x)), hits = (label) => head.filter((x) => ` ${label} `.indexOf(` ${x} `) !== -1).join(" "), bestLabel = best && scored.has(best.el) ? scored.get(best.el).label : "", bestHits = bestLabel ? hits(bestLabel) : "", partial = bestHits.split(" ").length < head.length, sort = bestHits ? tail.length > 0 || several === 0 ? bestHits : "" : tail.length > 0 ? [...scored.values()].map((s) => hits(s.label)).reduce((a, h) => h && (!a || h.split(" ").length > a.split(" ").length) ? h : a, "") : "", kin = sort ? [...scored].filter(([el, s]) => hits(s.label) === sort && (tail.length > 0 || partial || s.label === bestLabel) && (!within?.contains || within.contains(el))) : [];
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
    }, told = kin.map(([el, s]) => {
      let card = el;
      while (card.parentElement && holds.get(card.parentElement) === 1)
        card = card.parentElement;
      const seen = tail.length ? `${shownOn(card)}${s.label} ` : "";
      return { own: s.own, n: tail.filter((x) => seen.indexOf(` ${x} `) !== -1).length };
    }), most = Math.max(...told.map((t) => t.n)), top = told.filter((t) => t.n === most);
    several = kin.length;
    if (most > 0 && top.length === 1) {
      best = top[0].own;
      by = "card";
      ambiguous = !1;
    } else {
      ambiguous = !0;
      if (most > 0 && !top.some((t) => t.own.el === best.el))
        best = top[0].own;
    }
  }
  let one = !1;
  const usable = (el) => {
    if (el.getAttribute("disabled") !== null || el.getAttribute("aria-disabled") === "true")
      return !1;
    const cs = typeof w.getComputedStyle === "function" ? w.getComputedStyle(el) : null;
    return !cs || cs.visibility !== "hidden" && cs.display !== "none" && cs.pointerEvents !== "none";
  };
  if (wantsMenu && (!best || words.every((x) => SHAPE.test(x)))) {
    const menuLike = /(?:menu|nav|navigation|hamburger|burger)/i, all = candidates.filter((el) => {
      if (el.tagName.toLowerCase() !== "button" && el.getAttribute("role") !== "button")
        return !1;
      const said = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("title") ?? ""} ${typeof el.className === "string" ? el.className : ""} ${el.id ?? ""}`, own = norm(el.textContent ?? ""), icon = !!el.querySelector?.("svg, img");
      if (!menuLike.test(said) && !(icon && own.length <= 40 && /\b(?:menu|nav|navigation|hamburger|burger)\b/.test(own)))
        return !1;
      const rect = el.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && usable(el) && rect.bottom > 0 && rect.top < w.innerHeight && (!within || !within.contains || within.contains(el));
    }), inHeader = all.filter((el) => !!el.closest && !!el.closest('header, [role="banner"]')), menus = inHeader.length === 1 ? inHeader : all;
    if (menus.length === 1) {
      const m = menus[0], name = norm(m.getAttribute("aria-label") ?? "") || norm(m.getAttribute("title") ?? "") || norm(`${m.innerText || m.textContent || ""}`) || "menu";
      best = { el: m, score: 0, text: name.slice(0, 60) };
      one = "menu";
    }
  }
  if (wantsSlider) {
    const sliders = Array.prototype.slice.call(doc.querySelectorAll('input[type="range"], [role="slider"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && usable(el) && (!within || !within.contains || within.contains(el));
    }), vw = typeof w.innerWidth === "number" ? w.innerWidth : Number.POSITIVE_INFINITY, inView = sliders.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < w.innerHeight && rect.left + rect.width > 0 && rect.left < vw;
    }), pool = sliders.length === 1 ? [sliders[0], "page"] : inView.length === 1 ? [inView[0], "view"] : null;
    if (pool && (!best || !isSlider(best.el) && best.score < 4)) {
      const [s, how] = pool, name = norm(s.getAttribute("aria-label") ?? "") || norm(s.getAttribute("title") ?? "") || norm(`${s.innerText || s.textContent || ""}`) || "slider";
      best = { el: s, score: 0, text: name.slice(0, 60) };
      one = how;
    }
  }
  if (!opts?.drag && !(best && best.text === asked)) {
    const holders = [];
    for (const sel of Array.prototype.slice.call(doc.querySelectorAll("select"))) {
      if (sel.tagName.toLowerCase() !== "select" || typeof sel.querySelectorAll !== "function")
        continue;
      const rect = sel.getBoundingClientRect(), off = (e) => {
        try {
          return typeof e.matches === "function" && e.matches(":disabled");
        } catch {
          return !1;
        }
      };
      if (rect.width < 2 || rect.height < 2 || !usable(sel) || off(sel) || within && within.contains && !within.contains(sel))
        continue;
      const opt = Array.prototype.slice.call(sel.querySelectorAll("option")).find((o) => o.getAttribute("disabled") === null && !off(o) && (norm(`${o.textContent ?? ""}`) === asked || norm(o.getAttribute("label") ?? "") === asked));
      if (opt)
        holders.push({ sel, opt });
    }
    if (holders.length === 1) {
      const { sel, opt } = holders[0];
      sel.scrollIntoView({ block: "center" });
      const r = sel.getBoundingClientRect(), labelled = sel.id ? doc.querySelector(`label[for="${sel.id.replace(/"/g, "")}"]`) : null, selectName = norm(sel.getAttribute("aria-label") ?? "") || norm(`${labelled?.textContent ?? ""}`) || norm(sel.getAttribute("name") ?? "");
      if (!opts?.locateOnly) {
        sel.value = opt.value ?? norm(`${opt.textContent ?? ""}`);
        const Ev = w.Event;
        sel.dispatchEvent(new Ev("input", { bubbles: !0 }));
        sel.dispatchEvent(new Ev("change", { bubbles: !0 }));
      }
      return { clicked: norm(`${opt.textContent ?? ""}`).slice(0, 60), exact: !0, tag: "option", selector: `select${sel.id ? `#${sel.id}` : ""}${sel.getAttribute("name") ? `[name="${sel.getAttribute("name")}"]` : ""}`, target: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }, scrollY: Math.round(w.scrollY), chose: { option: norm(`${opt.textContent ?? ""}`).slice(0, 60), select: selectName.slice(0, 60) } };
    }
  }
  if (!best)
    return null;
  best.el.scrollIntoView({ block: "center" });
  const r = best.el.getBoundingClientRect(), target = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, reached = reach(best.el), point = reached ?? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  let covered;
  const hit = doc.elementFromPoint && !reached ? doc.elementFromPoint(point.x, point.y) : null, around = !!hit?.contains?.(best.el);
  if (hit && !around && hit !== best.el && !best.el.contains?.(hit) && !labelsOf(best.el).some((owner) => inside(owner, hit))) {
    const cls = typeof hit.className === "string" ? hit.className.trim().split(/\s+/)[0] : "";
    covered = `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : cls ? `.${cls}` : ""}`;
  }
  if (!opts?.locateOnly)
    best.el.click();
  const aria = norm(best.el.getAttribute("aria-label") ?? ""), names = [best.text, aria].filter((n) => n.length > 0), requested = requestedName(best.el), exact = names.some((n) => n === requested || n.indexOf(requested) === 0 || n.indexOf(` ${requested}`) !== -1), outside = !!within && !!within.contains && !within.contains(best.el) && within !== best.el, slider = isSlider(best.el), axis = !slider ? void 0 : best.el.getAttribute("aria-orientation") === "vertical" ? "y" : best.el.getAttribute("aria-orientation") === "horizontal" || best.el.tagName.toLowerCase() === "input" || r.width >= r.height ? "x" : "y", esc = (t) => t.replace(/([^a-zA-Z0-9_-])/g, "\\$1"), ownClasses = typeof best.el.className === "string" ? best.el.className.split(/\s+/).filter(Boolean).slice(0, 8) : [], selector = `${best.el.tagName.toLowerCase()}${best.el.id ? `#${esc(best.el.id)}` : ""}${ownClasses.map((c) => `.${esc(c)}`).join("")}${best.el.getAttribute("name") ? `[name="${esc(best.el.getAttribute("name"))}"]` : ""}${best.el.getAttribute("data-testid") || best.el.getAttribute("data-test") ? `[data-testid="${esc(best.el.getAttribute("data-testid") ?? best.el.getAttribute("data-test"))}"]` : ""}`, alike = several > 1 && !one ? { several, ...ambiguous ? { ambiguous: !0 } : by ? { by } : {} } : {}, label = norm(best.el.getAttribute("aria-label") ?? best.el.getAttribute("title") ?? "") || void 0, role = best.el.getAttribute("role") ?? void 0, peers = [best.el, ...candidates.filter((el) => el !== best.el).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && !el.closest?.("[inert]") && el.getAttribute("disabled") === null;
  }).filter((el) => el.tagName.toLowerCase() !== "label" && [el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? "", el.innerText || el.textContent || ""].some((name) => norm(name) !== "" && [norm(label || ""), norm(best.text)].includes(norm(name))))], signature = (el) => JSON.stringify([el.tagName.toLowerCase(), typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).sort() : [], el.getAttribute("name"), el.getAttribute("data-testid") ?? el.getAttribute("data-test")]), sameSelector = peers.length > 1 && peers.includes(best.el) && peers.every((el) => signature(el) === signature(best.el)), sharedClasses = ownClasses.filter((c) => peers.every((el) => typeof el.className === "string" && el.className.split(/\s+/).includes(c))).map((c) => `.${esc(c)}`), inChange = !!opts?.changeRegion && r.top + w.scrollY >= opts.changeRegion.top && r.bottom + w.scrollY <= opts.changeRegion.bottom, tag = best.el.tagName.toLowerCase(), kind = (best.el.getAttribute("type") ?? "").toLowerCase(), field = tag === "textarea" || tag === "select" || best.el.isContentEditable === !0 || tag === "input" && !/^(?:button|submit|reset)$/.test(kind), own = tag === "input" ? (best.el.value ?? "").trim() : (best.el.innerText ?? "").trim(), ticked = tag === "input" && /^(?:checkbox|radio)$/.test(kind) ? labelsOf(best.el).filter((l) => {
    const b = l.getBoundingClientRect();
    return (l.getClientRects?.().length ?? 1) > 0 && b.width >= 2 && b.height >= 2;
  }).map((l) => (l.innerText ?? l.textContent ?? "").trim()).filter(Boolean).join(" ") : "", shown = field ? ticked || void 0 : own || best.el.getAttribute("aria-label") || void 0, shownKey = (t) => (t ?? "").normalize("NFKC").toLowerCase().trim().replace(/[.,]$/, "").split(/\s+/).filter(Boolean).join(" "), shownOf = (el) => {
    const t = el.tagName.toLowerCase(), k = (el.getAttribute("type") ?? "").toLowerCase();
    if (t === "textarea" || t === "select" || el.isContentEditable === !0 || t === "input" && !/^(?:button|submit|reset)$/.test(k))
      return "";
    return shownKey((t === "input" ? (el.value ?? "").trim() : (el.innerText ?? "").trim()) || el.getAttribute("aria-label"));
  }, shownTwins = shown ? candidates.filter((el) => el !== best.el && !labelsOf(best.el).includes(el) && shownOf(el) === shownKey(shown)).length : 0, list = tag === "select" ? best.el : tag === "label" ? best.el.control ?? best.el.querySelector?.("select") : null, disabled = (e) => {
    try {
      return e.matches(":disabled");
    } catch {
      return e.getAttribute("disabled") !== null;
    }
  }, siteText = (o) => {
    const visible = (o.getAttribute("label") || o.textContent || "").normalize("NFKC").replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, "").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]|"/gu, "").replace(/\s+/g, " ").trim();
    return Array.from(visible).slice(0, 60).join("").trim();
  };
  let options;
  if (list?.tagName.toLowerCase() === "select" && list.getAttribute("multiple") === null && !disabled(list)) {
    const all = Array.prototype.slice.call(list.querySelectorAll?.("option") ?? []), names = all.filter((o) => !disabled(o)).map(siteText).filter(Boolean), picked = all.find((o) => o.selected), current = picked ? siteText(picked) : "";
    options = { names: names.slice(0, 12), count: names.length, ...current ? { current } : {} };
  }
  return { clicked: best.text, ...options ? { options } : {}, ...shown ? { shown } : {}, ...shownTwins ? { shownTwins } : {}, nameCount: peers.length, ...sameSelector ? { sameSelector } : {}, ...sharedClasses.length ? { sharedClasses } : {}, ...inChange ? { inChange } : {}, ...label ? { label } : {}, ...role ? { role } : {}, href: best.el.closest?.("a[href]")?.getAttribute("href") ?? void 0, exact: !!one || exact, tag: best.el.tagName.toLowerCase(), selector, target, point, scrollY: Math.round(w.scrollY), ...covered ? { covered } : {}, ...outside ? { outside: !0 } : {}, ...slider ? { slider: !0, axis } : {}, ...one ? { one } : {}, ...alike };
}

function confirmingControl(at, enter = !1, wide = !1) {
  const doc = globalThis.document, norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(), whole = (raw, short) => wide ? [...short, ...raw.map((s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80)).filter((s) => s.length > 0 && !short.includes(s))] : short, changes = /\b(?:approve|reject|decline|deny|submit|save|delete|remove|send|pay|confirm|publish|archive|revoke|withdraw|transfer)\b|\bcancel [a-z]/;
  let el = at ? doc.elementFromPoint ? doc.elementFromPoint(at.x, at.y) : null : doc.activeElement ?? null;
  while (el) {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") ?? "").toLowerCase(), raw = [el.getAttribute("aria-label") ?? "", `${el.innerText || el.textContent || ""}`, el.getAttribute("title") ?? "", tag === "input" && /^(?:submit|button)$/.test(type) ? el.value ?? "" : ""], own = norm(raw[1]), said = [norm(raw[0]), own.length <= 40 ? own : "", norm(raw[2]), norm(raw[3])].filter((s) => s.length > 0), told = whole(raw, said), link = tag === "a" && el.getAttribute("href") !== null && !el.getAttribute("role");
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
      const find = form, method = (el.getAttribute("formmethod") ?? form.getAttribute("method") ?? "").toLowerCase(), reads = method === "get" || method === "dialog" || !method && (form.getAttribute("role") === "search" || !!(find.querySelector && find.querySelector('input[type="search"]'))), sends = tag === "button" ? type === "" || type === "submit" : tag === "input" && (type === "submit" || type === "image" || enter && !/^(?:button|reset|checkbox|radio|file|range|color)$/.test(type)), sub = enter && tag !== "button" && type !== "submit" && type !== "image" && find.querySelector ? find.querySelector('[type="submit"], button:not([type])') : null, subRaw = sub ? [sub.getAttribute("aria-label") ?? "", `${sub.innerText || sub.textContent || ""}`, sub.value ?? ""] : [], all = [...whole(subRaw, subRaw.map(norm).filter((s) => s.length > 0 && s.length <= 40)), ...told];
      if (!reads && sends)
        return wide ? all.length > 0 ? [...all, "<form>"].join(`
`) : "" : all[0] ?? "the form\u2019s submit button";
    }
    if (el.closest && el.closest('a, button, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], input:not([type="hidden"]), select, textarea, summary, label, [onclick], [tabindex]:not([tabindex="-1"])') === el) {
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

function fieldReads(point, noSecrets = !1) {
  const doc = globalThis.document, read = (el) => {
    if (!el)
      return null;
    const tokens = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
    if (noSecrets && (el.tagName === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "password" || tokens.some((t) => t === "current-password" || t === "new-password" || t === "one-time-code" || t.startsWith("cc-"))))
      return null;
    if (typeof el.value === "string")
      return el.value;
    if (el.getAttribute("contenteditable") === "true")
      return el.textContent ?? "";
    return null;
  }, focused = read(doc.activeElement);
  if (focused !== null)
    return focused;
  const under = point && doc.elementFromPoint ? doc.elementFromPoint(point.x, point.y) : null;
  return read(under?.closest?.('input, textarea, [contenteditable="true"]') ?? under);
}

function focusedText() {
  const doc = globalThis.document, key = (t) => (t ?? "").normalize("NFKC").toLowerCase().trim().replace(/[.,]$/, "").split(/\s+/).filter(Boolean).join(" "), shownOf = (el) => {
    if (!el || /^(?:body|html|textarea|select)$/i.test(el.tagName) || el.isContentEditable)
      return null;
    const input = el.tagName === "INPUT";
    if (input && !/^(?:button|submit|reset)$/i.test(el.type ?? ""))
      return null;
    const words = (input ? (el.value ?? "").trim() : (el.innerText ?? "").trim()) || el.getAttribute("aria-label");
    return words && key(words) ? words : null;
  }, shown = shownOf(doc.activeElement);
  if (!shown)
    return null;
  const several = Array.from(doc.querySelectorAll?.("button,a,input,summary,[role],[tabindex]") ?? []).filter((el) => el !== doc.activeElement && key(shownOf(el)) === key(shown)).length + 1;
  return { shown, several };
}

function pageAddress() {
  return String(globalThis.location?.href ?? "");
}

function pageSignature() {
  const g = globalThis, text = (g.document.body?.innerText ?? "").slice(0, 400000), states = Array.from(g.document.querySelectorAll("[aria-expanded],[aria-selected],[aria-checked],[aria-pressed],[aria-hidden],[aria-invalid],[aria-current],[hidden],[disabled],[open],[data-state],input,select,textarea,dialog,details")).slice(0, 4000).map((el) => `${el.tagName}|${["aria-expanded", "aria-selected", "aria-checked", "aria-pressed", "aria-hidden", "aria-invalid", "aria-current", "hidden", "disabled", "open", "data-state"].map((n) => el.getAttribute(n) ?? "\u2400").join(",")}|${typeof el.value === "string" ? el.value : ""}|${el.checked === !0 ? 1 : 0}|${el.open === !0 ? 1 : 0}`).join(`
`);
  let h = 2166136261;
  for (const part of [text, states])
    for (let i = 0;i < part.length; i++)
      h = Math.imul(h ^ part.charCodeAt(i), 16777619);
  return `${g.location.href} ${g.document.querySelectorAll("*").length} ${text.length} ${(h >>> 0).toString(36)}`;
}

function scrollBy(direction, pane) {
  const w = globalThis, by = direction === "up" ? -w.innerHeight * 0.85 : w.innerHeight * 0.85;
  if (pane?.trim()) {
    const asked = pane.toLowerCase().replace(/^the\s+/, "").trim(), rooms = Array.from(w.document.querySelectorAll("*")).filter((e) => (e.scrollHeight ?? 0) - (e.clientHeight ?? 0) > 1 && /^(?:auto|scroll)$/.test(w.getComputedStyle?.(e)?.overflowY ?? "")), says = (e) => `${e.getAttribute("aria-label") ?? ""} ${e.innerText || e.textContent || ""}`.toLowerCase().includes(asked), navigates = (e) => Boolean(e && (/^(?:ASIDE|NAV)$/.test(e.tagName) || e.getAttribute("role") === "navigation" || navigates(e.parentElement))), box = rooms.filter(says).sort((a, b) => (a.scrollHeight ?? 0) - (b.scrollHeight ?? 0))[0] ?? (/side ?bar|nav|menu|rail|panel|contents/.test(asked) ? rooms.find(navigates) : void 0);
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
  let el = w.document.elementFromPoint?.((w.innerWidth ?? 0) / 2, w.innerHeight / 2) ?? null, ended;
  while (el) {
    const room = (el.scrollHeight ?? 0) - (el.clientHeight ?? 0), paneFrom = Math.round(el.scrollTop ?? 0), style = w.getComputedStyle?.(el);
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

function scrollToSurface(name, scroll = !0, headingAlone = !1) {
  const scope = globalThis, doc = scope.document;
  if (!doc)
    return null;
  const stop = new Set(["the", "and", "for", "with", "page", "section", "new", "rebuilt", "changed", "demo", "reference"]), norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), words = norm(name).split(" ").filter((w) => w.length >= 3 && !stop.has(w));
  if (words.length === 0)
    return null;
  const wanted = words.join(" "), slug = words.join("-"), candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, section, [role="region"], [aria-label], [id]')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }), isHeading = (el) => /^h[1-4]$/.test(el.tagName.toLowerCase());
  let best = void 0;
  const exact = candidates.find((el) => isHeading(el) && norm(el.textContent ?? "") === wanted || (el.id ?? "").toLowerCase() === slug || norm(el.getAttribute("aria-label") ?? "") === wanted);
  if (exact)
    best = { el: exact, score: words.length };
  if (!best && words.length >= 2) {
    const need = Math.ceil(words.length / 2), scored = [];
    for (const el of candidates) {
      const own = isHeading(el) ? el.textContent ?? "" : `${el.id ?? ""} ${el.getAttribute("aria-label") ?? ""}`, tokens = new Set(norm(own).split(" "));
      let score = 0;
      for (const w of words)
        if (tokens.has(w))
          score += 1;
      if (score >= need)
        scored.push({ el, score });
    }
    const top = Math.max(0, ...scored.map((c) => c.score)), tied = scored.filter((c) => c.score === top);
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
  const r = best.el.getBoundingClientRect(), selectorOf = (el) => `${el.tagName.toLowerCase()}${!el.id ? "" : /^[A-Za-z_][\w-]*$/.test(el.id) ? `#${el.id}` : `[id="${el.id.replace(/["\\]/g, "\\$&")}"]`}`, alone = (sel) => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return !1;
    }
  };
  let label = selectorOf(best.el);
  if (isHeading(best.el) && !headingAlone) {
    label = "";
    for (let around = best.el.closest?.('section, article, main, form, dialog, [role="region"], [role="main"], [role="dialog"]') ?? null;around; around = around.parentElement?.closest?.('section, article, main, form, dialog, [role="region"], [role="main"], [role="dialog"]') ?? null)
      if (alone(selectorOf(around))) {
        label = selectorOf(around);
        break;
      }
  }
  return { what: label, top: Math.round(r.top + (scope.scrollY ?? 0)) };
}

function typeInto(wanted, text, keys, noSecrets = !1) {
  const w = globalThis, doc = w.document, norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(), words = norm(wanted).split(" ").filter((x) => x.length > 1), fields = Array.prototype.slice.call(doc.querySelectorAll('input:not([type=hidden]):not([type=submit]), textarea, [contenteditable="true"]'));
  let best = null;
  for (const el of fields) {
    const label = Array.prototype.map.call(el.labels ?? [], (l) => l.textContent ?? "").join(" "), t = norm(`${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("name") ?? ""} ${label}`);
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
  const tokens = (best.el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/), secret = best.el.tagName === "INPUT" && (best.el.getAttribute("type") ?? "").toLowerCase() === "password" || tokens.some((t) => t === "current-password" || t === "new-password" || t === "one-time-code" || t.startsWith("cc-"));
  if (noSecrets && secret)
    return null;
  best.el.scrollIntoView({ block: "center" });
  const r = best.el.getBoundingClientRect(), target = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  best.el.focus();
  const field = typeof best.el.value === "string";
  if (keys)
    if (field)
      best.el.select?.();
    else
      w.getSelection?.()?.selectAllChildren(best.el);
  else if (field) {
    const proto = Object.getPrototypeOf(best.el), setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter)
      setter.call(best.el, text);
    else
      best.el.value = text;
    best.el.dispatchEvent(new w.Event("input", { bubbles: !0 }));
    best.el.dispatchEvent(new w.Event("change", { bubbles: !0 }));
  } else {
    best.el.textContent = text;
    best.el.dispatchEvent(new w.Event("input", { bubbles: !0 }));
  }
  return { typed: text, target, point: { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) } };
}

function controlKeyEvidence(mode) {
  const token = Symbol.for("impeccable.keyEvidence"), doc = globalThis.document, old = doc[token];
  if (old) {
    old.stop();
    delete doc[token];
  }
  if (mode === "finish")
    return old?.acted() ?? !1;
  const control = doc.activeElement;
  if (!control)
    return !1;
  let acted = !1;
  const listener = (event) => {
    if (event.type === "submit" ? Boolean(control.form && event.target === control.form) : event.target === control)
      acted = !0;
  }, types = ["input", "change", "submit"];
  for (const type of types)
    doc.addEventListener(type, listener, !0);
  doc[token] = { acted: () => acted, stop: () => {
    for (const type of types)
      doc.removeEventListener(type, listener, !0);
  } };
  return !1;
}

function focusedControl(region) {
  const doc = globalThis.document, el = doc.activeElement;
  if (!el || /^(?:body|html)$/.test(el.tagName.toLowerCase()))
    return null;
  const tag = el.tagName.toLowerCase(), inputType = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : "", inputRole = ["checkbox", "radio"].includes(inputType) ? inputType : inputType === "range" ? "slider" : ["date", "datetime-local", "month", "week", "time", "number"].includes(inputType) ? "spinbutton" : ["button", "submit", "reset", "image", "color"].includes(inputType) ? "button" : "textbox", role = el.getAttribute("role") ?? { button: "button", a: "link", input: inputRole, textarea: "textbox", summary: "button", select: "combobox", dialog: "dialog" }[tag];
  if (!/^(?:a|button|input|select|textarea|summary|dialog)$/.test(tag) && !role && el.getAttribute("tabindex") === null && el.getAttribute("contenteditable") !== "true")
    return null;
  let label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
  if (!label && el.id)
    label = Array.prototype.slice.call(doc.querySelectorAll("label[for]")).find((candidate) => candidate.getAttribute("for") === el.id)?.textContent ?? "";
  const resolved = (label || (tag === "button" || tag === "a" || role ? el.innerText || el.textContent || "" : "")).normalize("NFKC").replace(/\s+/g, " ").trim() || null, classes = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 8) : [], esc = (s) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1"), name = el.getAttribute("name"), testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test"), selector = `${tag}${el.id ? `#${esc(el.id)}` : ""}${classes.map((c) => `.${esc(c)}`).join("")}${name ? `[name="${esc(name)}"]` : ""}${testId ? `[data-testid="${esc(testId)}"]` : ""}`, controls = Array.prototype.slice.call(doc.querySelectorAll('button,a,input,select,textarea,summary,dialog,[role],[contenteditable="true"],[tabindex]')), styleOf = globalThis.getComputedStyle, visible = (candidate) => {
    const style = styleOf?.(candidate), rect = candidate.getBoundingClientRect?.();
    return style?.display !== "none" && style?.visibility !== "hidden" && style?.visibility !== "collapse" && (!rect || rect.width >= 2 && rect.height >= 2) && !candidate.closest?.("[inert]") && candidate.getAttribute("disabled") === null;
  }, modals = Array.from(doc.querySelectorAll(':modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')).filter((candidate) => (candidate.tagName.toLowerCase() === "dialog" || candidate.getAttribute("aria-modal") === "true") && visible(candidate)), modal = modals.filter((candidate) => candidate.contains?.(el)).at(-1) ?? modals.at(-1), sameName = [...new Set([el, ...controls])].filter((candidate) => {
    if (!visible(candidate) || modal && candidate !== modal && !modal.contains?.(candidate))
      return !1;
    let name = candidate.getAttribute("aria-label") || candidate.getAttribute("title") || candidate.getAttribute("placeholder") || "";
    if (!name && candidate.id)
      name = Array.prototype.slice.call(doc.querySelectorAll("label[for]")).find((label) => label.getAttribute("for") === candidate.id)?.textContent ?? "";
    return (name || candidate.innerText || candidate.textContent || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") === resolved?.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ");
  }), signature = (candidate) => JSON.stringify([candidate.tagName.toLowerCase(), typeof candidate.className === "string" ? candidate.className.split(/\s+/).filter(Boolean).sort() : [], candidate.getAttribute("name"), candidate.getAttribute("data-testid") ?? candidate.getAttribute("data-test")]), several = sameName.length, sameSelector = several > 1 && sameName.includes(el) && sameName.every((candidate) => signature(candidate) === signature(el)), sharedClasses = classes.filter((c) => sameName.every((candidate) => typeof candidate.className === "string" && candidate.className.split(/\s+/).includes(c))).map((c) => `.${esc(c)}`);
  let inChange = !1;
  if (region) {
    const rect = el.getBoundingClientRect?.(), y = globalThis.scrollY ?? 0;
    inChange = !!rect && rect.top + y >= region.top && rect.bottom + y <= region.bottom;
  }
  return { resolved, several, ...sameSelector ? { sameSelector } : {}, ...sharedClasses.length ? { sharedClasses } : {}, ...inChange ? { inChange } : {}, ...label ? { label: label.normalize("NFKC").replace(/\s+/g, " ").trim() } : {}, ...role ? { role } : {}, ...selector !== tag ? { selector } : {} };
}

function locateChange(markers, perMarker, reveal = !1, inView = !1, observe = !1) {
  const g = globalThis, doc = g.document, norm = (t) => t.replace(/\u00a0/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  let hits = [], hidden = [];
  const shutFrom = (n) => n && n.closest ? n.closest("details:not([open])") : null, shutAbove = (el) => {
    for (let shut = shutFrom(el.parentElement);shut; shut = shutFrom(shut.parentElement)) {
      let inSummary = !1;
      for (let a = el;a && a !== shut; a = a.parentElement)
        if (String(a.tagName).toUpperCase() === "SUMMARY" && a.parentElement === shut)
          inSummary = !0;
      if (!inSummary)
        return shut;
    }
    return null;
  }, shownNow = (el, r) => {
    if (r.bottom <= 0 || r.top >= g.innerHeight)
      return !1;
    if (r.right !== void 0 && r.left !== void 0 && g.innerWidth !== void 0 && (r.right <= 0 || r.left >= g.innerWidth))
      return !1;
    if (!g.getComputedStyle)
      return !0;
    if (g.getComputedStyle(el).visibility === "hidden")
      return !1;
    for (let a = el;a; a = a.parentElement)
      if (g.getComputedStyle(a).opacity === "0")
        return !1;
    return !0;
  }, push = (el, marker) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || shutAbove(el) || inView && !shownNow(el, r)) {
      hidden.push(el);
      return;
    }
    hits.push({ top: r.top + g.scrollY, bottom: r.bottom + g.scrollY, marker });
  }, gather = () => {
    for (const m of markers)
      try {
        if (m.charAt(0) === "~") {
          const want = m.slice(1);
          let el = doc.body;
          if (!el || norm(el.textContent || "").indexOf(want) < 0)
            continue;
          for (;; ) {
            const next = Array.prototype.slice.call(el.children).find((k) => norm(k.textContent || "").indexOf(want) >= 0);
            if (!next)
              break;
            el = next;
          }
          push(el, m);
          continue;
        }
        const selector = m.charAt(0) === "&" ? m.slice(1) : m.charAt(0) === "=" ? m.slice(1).split(" ").map(function(c) {
          return "." + g.CSS.escape(c);
        }).join("") : m.charAt(0) === "." ? "." + g.CSS.escape(m.slice(1)) : "#" + g.CSS.escape(m.slice(1)), found = doc.querySelectorAll(selector);
        for (let i = 0;i < found.length && i < perMarker; i++)
          push(found[i], m);
      } catch {}
  };
  gather();
  let revealed = 0, shutTop;
  if (reveal && hits.length === 0 && hidden.length > 0) {
    for (const el of hidden)
      for (let shut = shutAbove(el);shut && shut.setAttribute; shut = shutAbove(shut)) {
        const group = shut.getAttribute ? shut.getAttribute("name") : null;
        if (group) {
          const peers = doc.querySelectorAll('details[open][name="' + g.CSS.escape(group) + '"]');
          for (let i = 0;i < peers.length; i++)
            if (peers[i].setAttribute && peers[i].getAttribute?.("data-impeccable-revealed") == null)
              peers[i].setAttribute("data-impeccable-peer", "");
        }
        const top = shut.getBoundingClientRect().top + g.scrollY;
        shutTop = shutTop === void 0 ? top : Math.min(shutTop, top);
        shut.setAttribute("open", "");
        shut.setAttribute("data-impeccable-revealed", "");
        revealed++;
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
  const gap = g.innerHeight, groups = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && h.top <= last.bottom + gap) {
      last.bottom = Math.max(last.bottom, h.bottom);
      last.markers[h.marker] = !0;
    } else {
      const fresh = {};
      fresh[h.marker] = !0;
      groups.push({ top: h.top, bottom: h.bottom, markers: fresh });
    }
  }
  groups.sort((a, b) => Object.keys(b.markers).length - Object.keys(a.markers).length || a.top - b.top);
  const best = groups[0];
  return finish({ top: Math.max(0, Math.round(best.top)), bottom: Math.round(best.bottom), markers: Object.keys(best.markers), ...revealed > 0 ? { revealed, ...shutTop !== void 0 ? { shutTop: Math.max(0, Math.round(shutTop)) } : {} } : {} });
}

function restoreClosed() {
  const doc = globalThis.document, opened = doc.querySelectorAll("[data-impeccable-revealed]");
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
    Object.defineProperty(proto, "language", { get: () => tag, configurable: !0 });
    Object.defineProperty(proto, "languages", { get: () => [tag], configurable: !0 });
  } catch {}
}

function documentLang() {
  return String(globalThis.document?.documentElement?.lang ?? "");
}

function themeReads() {
  const w = globalThis, els = [w.document.documentElement, w.document.body].filter((e) => Boolean(e)), attr = els.flatMap((e) => ["data-theme", "data-color-scheme", "data-mode", "data-bs-theme"].map((n) => e.getAttribute(n) ?? "")).filter(Boolean).join(" "), classes = els.map((e) => typeof e.className === "string" ? e.className : "").join(" "), style = (el) => el && w.getComputedStyle ? w.getComputedStyle(el) : void 0, scheme = style(w.document.documentElement)?.colorScheme ?? "", painted = (c) => c && !/^(?:transparent|rgba\([^)]*,\s*0\))$/.test(c) ? c : "", bg = painted(style(w.document.body)?.backgroundColor) || painted(style(w.document.documentElement)?.backgroundColor), doc = globalThis.performance?.timeOrigin;
  return { attr, classes, scheme, bg, ...typeof doc === "number" ? { doc } : {} };
}

async function readCover(opts) {
  const scope = globalThis, { document: doc, getComputedStyle: style } = scope;
  if (!doc || !doc.body || !style)
    return null;
  const vh = scope.innerHeight ?? 0, vw = scope.innerWidth ?? 0, frames = () => new Promise((done) => {
    const raf = scope.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
    raf(() => raf(() => done()));
  }), name = (el) => {
    const classes = Array.from(el.classList).slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes ? `.${classes}` : ""}`;
  }, barOf = (el) => {
    for (let e = el;e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
      const p = style(e).position;
      if ((p === "fixed" || p === "sticky") && e.getBoundingClientRect().width >= vw * 0.5)
        return e;
    }
    return null;
  }, rootStyle = doc.documentElement.style, smooth = rootStyle?.scrollBehavior ?? "";
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
  }, words = opts.words.map((w) => w.toLowerCase()), meets = (have) => words.filter((w) => have.some((h) => h === w || h.length >= 4 && w.length >= 4 && (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5))))).length, candidates = [], all = Array.from(doc.querySelectorAll("body *")).slice(0, 4000);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0)
      continue;
    const s = style(el);
    if (s.visibility === "hidden" || s.display === "none")
      continue;
    if (barOf(el))
      continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim(), own = text.length <= 40 ? text : "", named = `${el.id ?? ""} ${Array.from(el.classList).join(" ")} ${el.getAttribute("aria-label") ?? ""} ${own}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), hits = meets(named);
    if (hits > 0)
      candidates.push({ el, hits, ...own ? { label: own } : {} });
  }
  candidates.sort((a, b) => b.hits - a.hits);
  const inPanel = (el) => {
    for (let e = el.parentElement;e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
      const o = style(e).overflowY ?? "visible", box = e;
      if ((o === "auto" || o === "scroll") && (box.scrollHeight ?? 0) > (box.clientHeight ?? 0) + 1)
        return !0;
    }
    return !1;
  }, targets = candidates.filter((c) => !inPanel(c.el)).slice(0, opts.max), best = candidates[0]?.hits ?? 0, complete = candidates.filter((c) => c.hits === best).every((c) => targets.includes(c)), covered = [];
  for (const t of targets)
    for (const edge of ["bottom", "top"]) {
      const r0 = t.el.getBoundingClientRect(), at = (edge === "top" ? r0.top + 3 : r0.bottom - 3) + (scope.scrollY ?? 0);
      scope.scrollTo?.(0, Math.max(0, at - vh / 2));
      await settle(t.el);
      const r = t.el.getBoundingClientRect(), y = edge === "top" ? r.top + 3 : r.bottom - 3;
      if (y < 0 || y > vh)
        continue;
      const left = Math.max(1, r.left + 6), right = Math.min(vw - 1, r.right - 6);
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
  scope.scrollTo?.(0, 0);
  if (rootStyle)
    rootStyle.scrollBehavior = smooth;
  return { matched: targets.length, covered, ...complete ? {} : { partial: !0 }, viewport: { width: vw, height: vh }, ...scope.location ? { page: scope.location.pathname } : {} };
}

function readLanding() {
  const doc = globalThis.document, meta = doc.querySelector('meta[http-equiv="refresh" i]');
  let target = null;
  const content = meta ? meta.getAttribute("content") || "" : "", m = /url\s*=\s*['"]?([^'";]+)/i.exec(content);
  if (m && m[1])
    target = m[1].trim();
  const body = doc.body, text = body ? (body.innerText || body.textContent || "").trim() : "", inputs = Array.prototype.slice.call(doc.getElementsByTagName("input"));
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
  return Array.prototype.slice.call(g.document.querySelectorAll('link[rel~="stylesheet"][href]')).some((l) => {
    if (/^(?:[a-z][a-z\d+.-]*:|[/?#])/i.test(l.getAttribute("href") ?? "/"))
      return !1;
    return g.performance.getEntriesByName(l.href).reduce((last, e) => e.responseStatus ?? last, 0) >= 400;
  });
}

function installSystemFace(base64, families, descriptors, key) {
  const scope = globalThis, doc = scope.document, fonts = doc?.fonts;
  if (!doc || !fonts || typeof scope.FontFace !== "function" || typeof scope.atob !== "function")
    return;
  const name = (family) => String(family).replace(/^["']|["']$/g, "").trim().toLowerCase();
  let watch;
  const yieldToPage = () => {
    const ours = scope[key] ?? [], theirs = new Set;
    fonts.forEach((face) => {
      if (ours.indexOf(face) === -1)
        theirs.add(name(face.family));
    });
    const kept = ours.filter((face) => {
      if (!theirs.has(name(face.family)))
        return !0;
      fonts.delete(face);
      return !1;
    });
    scope[key] = kept;
    if (kept.length === 0)
      watch?.disconnect();
  };
  if (!Array.isArray(scope[key])) {
    const text = scope.atob(base64), bytes = new Uint8Array(text.length);
    for (let i = 0;i < text.length; i++)
      bytes[i] = text.charCodeAt(i);
    const added = [];
    for (const family of families)
      try {
        const face = new scope.FontFace(family, bytes.buffer, descriptors);
        fonts.add(face);
        added.push(face);
      } catch {}
    scope[key] = added;
    doc.addEventListener?.("DOMContentLoaded", yieldToPage, { once: !0 });
    scope.addEventListener?.("load", yieldToPage, { once: !0 });
    if (typeof scope.MutationObserver === "function") {
      const observer = new scope.MutationObserver((records) => {
        for (const record of records)
          for (let i = 0;i < record.addedNodes.length; i++) {
            const node = record.addedNodes[i];
            if (node.nodeName === "LINK")
              node.addEventListener?.("load", yieldToPage, { once: !0 });
            else if (node.nodeName === "STYLE")
              scope.setTimeout?.(yieldToPage, 0);
          }
      });
      observer.observe(doc, { childList: !0, subtree: !0 });
      watch = observer;
    }
    const later = () => {
      scope.setTimeout?.(yieldToPage, 0);
    }, add = fonts.add;
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
        if (/@font-face/i.test(String(text)))
          if (result && typeof result.then === "function")
            result.then(later, () => {});
          else
            later();
        return result;
      };
    }
  }
  yieldToPage();
}

function readConsentState() {
  const g = globalThis, s = g.__impeccableConsent;
  if (!s || typeof s !== "object")
    return null;
  return { ...s, age: typeof s.since === "number" && g.performance ? g.performance.now() - s.since : 0 };
}

function consentSeen() {
  return globalThis.__impeccableConsentSeen === !0;
}

function markConsentSeen() {
  globalThis.__impeccableConsentSeen = !0;
}

export const helpers = Object.freeze({ clickByText, confirmingControl, currentUrlOf, fieldReads, focusedText, pageAddress, pageSignature, scrollBy, scrollPageTo, scrollToSurface, typeInto, controlKeyEvidence, focusedControl, locateChange, restoreClosed, pageLinks, browserLanguage, documentLang, themeReads, readCover, readLanding, relativeStylesMissedInPage, installSystemFace, readConsentState, consentSeen, markConsentSeen });

/** The helpers that read what the consent rules leave in the page's own world: run there. */
export const pageWorld = Object.freeze(["readConsentState","consentSeen","markConsentSeen"]);

/** The helpers added to each new document, and only there (`loadConsent` is consent-rules.js). */
export const newDocument = Object.freeze(["browserLanguage","installSystemFace","loadConsent"]);

/** Each helper's `noSecrets` argument, which this extension always sets: no password, card or one-time-code field is typed into or read. */
export const noSecrets = Object.freeze({"typeInto":3,"fieldReads":1});

/** This file's and consent-rules.js's hash (sha-256 of the two, this line left out): the hello says it. */
export const HASH = 'cfd1fbaf12ea4bef';
