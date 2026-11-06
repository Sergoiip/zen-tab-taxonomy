// ==UserScript==
// @name           Tab Taxonomy
// @description    AI tidy for Zen Browser: designs a taxonomy for the Space's tabs and sorts them into collapsible sections (like Arc's Tidy Tabs). Engine: Groq (free); fallbacks: Zen's local AI, then by domain.
// @include        main
// @author         Sergio Marcucci · CogniLab (https://cognilab.org)
// @version        1.0.0
// @license        MIT
// ==/UserScript==

(() => {
  "use strict";
  if (window.TabTaxonomy) {
    return;
  }

  /* ───────────────────────── configuración ───────────────────────── */

  const PREF = "tabtaxonomy.";
  const LEGACY_PREF = "argos.tidy."; // versión privada 1.0
  const P = {
    groqKey: PREF + "groq-key",            // opcional: si está vacío se lee del archivo .env
    envFile: PREF + "env-file",            // archivo con GROQ_API_KEY=...
    model: PREF + "model",
    fallbackModel: PREF + "fallback-model",
    localFallback: PREF + "local-fallback",
    suggestSpaces: PREF + "suggest-spaces",
    position: PREF + "position",           // "below" (sin ordenar arriba, categorías debajo) | "above"
    shortcut: PREF + "shortcut",
    maxCats: PREF + "max-categories",
    language: PREF + "language",           // "auto" | "es" | "en"
    layout: PREF + "layout",               // JSON { spaceUuid: [{n, e, s}] }
    collapsed: PREF + "collapsed",         // JSON [ "spaceUuid|nombre" ]
  };
  const DEFAULTS = {
    [P.groqKey]: "",
    [P.envFile]: "",
    [P.model]: "openai/gpt-oss-120b",
    [P.fallbackModel]: "openai/gpt-oss-20b",
    [P.localFallback]: true,
    [P.suggestSpaces]: true,
    [P.position]: "below",
    [P.shortcut]: "ctrl+alt+o",
    [P.maxCats]: "8",
    [P.language]: "auto",
    [P.layout]: "{}",
    [P.collapsed]: "[]",
  };
  const TAB_KEY = "tabtaxonomy";
  const LEGACY_TAB_KEY = "argos-tidy";
  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  const CHUNK = 110; // pestañas por petición (límite gratuito de Groq: ~8k tokens/min)
  const PALETTE = ["#3fa9ff", "#9b5cff", "#ff2e88", "#ff4d6d", "#2ec4b6", "#ffb347", "#5fd068", "#7d8cff", "#e86bff", "#4dd0e1"];

  const getPref = key => {
    const def = DEFAULTS[key];
    try {
      if (typeof def === "boolean") {
        return Services.prefs.getBoolPref(key, def);
      }
      return Services.prefs.getStringPref(key, def);
    } catch {
      return def;
    }
  };
  const setPref = (key, value) => {
    if (typeof value === "boolean") {
      Services.prefs.setBoolPref(key, value);
    } else {
      Services.prefs.setStringPref(key, String(value));
    }
  };
  const jsonPref = key => {
    try {
      return JSON.parse(getPref(key)) ?? JSON.parse(DEFAULTS[key]);
    } catch {
      return JSON.parse(DEFAULTS[key]);
    }
  };

  const log = (...a) => console.log("[Tab Taxonomy]", ...a);
  const warn = (...a) => console.warn("[Tab Taxonomy]", ...a);

  /* ───────────────────────── idioma (es / en) ───────────────────────── */

  const STRINGS = {
    es: {
      button: "Ordenar",
      buttonTip: k => `Ordenar pestañas con IA (${k})`,
      busyTip: "Ordenando… (clic para cancelar)",
      sortAI: "Ordenar pestañas con IA",
      sortNew: "Ordenar lo nuevo",
      resortAll: "Reordenar todo el Space",
      undo: "Deshacer último orden",
      rename: "Renombrar…",
      up: "Subir",
      down: "Bajar",
      moveCatToSpace: "Mover categoría a Space",
      ungroup: "Desagrupar",
      unload: "Descargar de memoria",
      closeTabs: "Cerrar pestañas",
      moveToCat: "Mover a categoría",
      newCat: "Nueva categoría…",
      newCatTitle: "Nueva categoría",
      newCatMsg: "Nombre:",
      removeFromCat: "Sacar de la categoría",
      renameTitle: "Renombrar categoría",
      renameMsg: "Nuevo nombre:",
      closeCatTip: "Cerrar las pestañas de esta categoría",
      chipTip: n => `Sugerencia: esta categoría encaja en «${n}». Clic para moverla allá.`,
      movedTo: (n, sp) => `${n} pestañas → ${sp}`,
      nothingUndo: "No hay nada que deshacer",
      restored: "Orden anterior restaurado",
      cancelled: "Ordenado cancelado",
      allSorted: "Todo está ordenado ✓",
      noneFit: n => `${n} pestañas no encajan en ninguna categoría: quedan sueltas`,
      result: (n, c, e) => `${n} pestañas en ${c} categorías · ${e}`,
      unsorted: n => ` · ${n} sin clasificar`,
      undoHint: "Clic derecho en una categoría → Deshacer último orden",
      noKeyHint: "Sin clave de Groq: usé el respaldo local. Consigue una gratis en console.groq.com/keys y pégala en Ajustes → Sine Mods → Tab Taxonomy.",
      designing: n => `Leyendo ${n} pestañas…`,
      sorting: (d, n) => `Clasificando… ${d}/${n}`,
      waiting: s => `Límite de Groq: espero ${s}s…`,
      localWorking: "IA local de Zen: agrupando…",
      localEmpty: "la IA local no devolvió grupos",
      noKey: "falta la clave de Groq",
      noCats: "el modelo no propuso categorías",
      noQuota: "Groq sin cupo por ahora",
      rateLimited: "límite de Groq",
      http401: "clave inválida",
      http403: "acceso denegado",
      http404: "modelo inexistente",
      http413: "petición demasiado grande",
      httpOther: "error del servidor",
      group: "Grupo",
      localFiles: "Archivos locales",
      pTax1: sp => `Diseñas la taxonomía para ordenar las pestañas abiertas del Space «${sp}» de un navegador, como el Tidy Tabs de Arc. Lee TODAS las pestañas.`,
      pTaxNew: m => `Propón entre 4 y ${m} categorías que las cubran casi todas.`,
      pTaxExisting: (list, m) => `Categorías que YA existen (consérvalas con su nombre exacto): ${list}. Añade categorías nuevas solo si estas pestañas no caben en las existentes (máximo ${m} en total). Nunca crees sinónimos ni variantes de una existente (si existe «Estética y referencias», no crees «Estética visual»).`,
      pTaxRules: `- Nombres en español, de 1 a 3 palabras, concretos y por tarea o tema (bien: «Edición en DaVinci», «Búsqueda de empleo», «Marca personal»; mal: «Recursos», «Herramientas», «Varios», «Utilidades», «Google», «Tecnología»).
- "scope": una frase que diga qué entra y qué NO entra, para que otra persona clasifique sin dudas.
- Sin solapamientos. Ninguna categoría con más de un tercio de las pestañas: si un tema es enorme, pártelo en subtemas reales.
- Un emoji por categoría.`,
      pTaxSpaces: sp => `"space": casi siempre vacío. Pon el nombre de otro Space SOLO si la categoría entera es claramente del tema de ese Space y no de «${sp}». Otros Spaces y ejemplos de lo que contienen:`,
      pTaxNoSpaces: `"space": déjalo siempre vacío.`,
      pAssign: "Clasifica cada pestaña en UNA categoría. Lee el título y el sitio de cada una por separado.\nCategorías:",
      pAssignNone: "- = ninguna encaja de verdad (úsalo poco).\nResponde con la clave tN de cada pestaña y la letra de su categoría.",
      localFile: "archivo local",
    },
    en: {
      button: "Tidy",
      buttonTip: k => `Tidy tabs with AI (${k})`,
      busyTip: "Tidying… (click to cancel)",
      sortAI: "Tidy tabs with AI",
      sortNew: "Tidy new tabs",
      resortAll: "Re-tidy the whole Space",
      undo: "Undo last tidy",
      rename: "Rename…",
      up: "Move up",
      down: "Move down",
      moveCatToSpace: "Move category to Space",
      ungroup: "Ungroup",
      unload: "Unload tabs",
      closeTabs: "Close tabs",
      moveToCat: "Move to category",
      newCat: "New category…",
      newCatTitle: "New category",
      newCatMsg: "Name:",
      removeFromCat: "Remove from category",
      renameTitle: "Rename category",
      renameMsg: "New name:",
      closeCatTip: "Close the tabs in this category",
      chipTip: n => `Suggestion: this category fits “${n}”. Click to move it there.`,
      movedTo: (n, sp) => `${n} tabs → ${sp}`,
      nothingUndo: "Nothing to undo",
      restored: "Previous order restored",
      cancelled: "Tidy cancelled",
      allSorted: "Everything is tidy ✓",
      noneFit: n => `${n} tabs don't fit any category: left loose`,
      result: (n, c, e) => `${n} tabs in ${c} categories · ${e}`,
      unsorted: n => ` · ${n} left unsorted`,
      undoHint: "Right-click a category → Undo last tidy",
      noKeyHint: "No Groq key: used the local fallback. Get a free one at console.groq.com/keys and paste it in Settings → Sine Mods → Tab Taxonomy.",
      designing: n => `Reading ${n} tabs…`,
      sorting: (d, n) => `Sorting… ${d}/${n}`,
      waiting: s => `Groq rate limit: waiting ${s}s…`,
      localWorking: "Zen local AI: grouping…",
      localEmpty: "the local AI returned no groups",
      noKey: "missing Groq key",
      noCats: "the model proposed no categories",
      noQuota: "Groq is out of quota for now",
      rateLimited: "Groq rate limit",
      http401: "invalid key",
      http403: "access denied",
      http404: "unknown model",
      http413: "request too large",
      httpOther: "server error",
      group: "Group",
      localFiles: "Local files",
      pTax1: sp => `You design the taxonomy to tidy the open tabs of the browser Space “${sp}”, like Arc's Tidy Tabs. Read ALL the tabs.`,
      pTaxNew: m => `Propose between 4 and ${m} categories that cover nearly all of them.`,
      pTaxExisting: (list, m) => `Categories that ALREADY exist (keep their exact names): ${list}. Add new categories only if these tabs don't fit the existing ones (at most ${m} in total). Never create synonyms or variants of an existing one (if “Visual references” exists, don't create “Visual inspiration”).`,
      pTaxRules: `- Names in English, 1 to 3 words, concrete and by task or topic (good: “Video editing”, “Job search”, “Trip to Japan”; bad: “Resources”, “Tools”, “Misc”, “Utilities”, “Google”, “Technology”).
- "scope": one sentence stating what belongs and what does NOT, so someone else could sort without doubt.
- No overlaps. No category with more than a third of the tabs: if a topic is huge, split it into real subtopics.
- One emoji per category.`,
      pTaxSpaces: sp => `"space": almost always empty. Put another Space's name ONLY if the whole category clearly belongs to that Space's theme and not to “${sp}”. Other Spaces and examples of what they hold:`,
      pTaxNoSpaces: `"space": always leave it empty.`,
      pAssign: "Put each tab in ONE category. Read each tab's title and site on its own.\nCategories:",
      pAssignNone: "- = none really fits (use sparingly).\nAnswer with each tab's key tN and its category letter.",
      localFile: "local file",
    },
  };
  function lang() {
    const pref = getPref(P.language);
    if (pref === "es" || pref === "en") {
      return pref;
    }
    return Services.locale.appLocaleAsBCP47.toLowerCase().startsWith("es") ? "es" : "en";
  }
  function tr(key, ...args) {
    const v = STRINGS[lang()][key] ?? STRINGS.en[key];
    return typeof v === "function" ? v(...args) : v ?? "";
  }


  // La versión privada 1.0 usaba el prefijo «argos.tidy.»: se copian sus valores una sola vez.
  function migrateLegacyPrefs() {
    const names = Services.prefs.getBranch(LEGACY_PREF).getChildList("");
    if (!names.length) {
      return;
    }
    for (const name of names) {
      const from = LEGACY_PREF + name;
      const to = PREF + name;
      try {
        if (!Services.prefs.prefHasUserValue(to)) {
          if (Services.prefs.getPrefType(from) === Services.prefs.PREF_BOOL) {
            Services.prefs.setBoolPref(to, Services.prefs.getBoolPref(from));
          } else {
            Services.prefs.setStringPref(to, Services.prefs.getStringPref(from));
          }
        }
      } catch {}
      Services.prefs.clearUserPref(from);
    }
    // En la 1.0 la clave se leía por defecto de ~/.hermes/.env.
    if (!Services.prefs.prefHasUserValue(P.envFile)) {
      setPref(P.envFile, "~/.hermes/.env");
    }
    log("preferencias 1.0 migradas");
  }

  /* ───────────────────────── estado por Space ───────────────────────── */

  // Lista ordenada de categorías de un Space: [{ n: nombre, e: emoji, s: uuid de Space sugerido | "" }]
  function getCats(spaceId) {
    const all = jsonPref(P.layout);
    return Array.isArray(all[spaceId]) ? all[spaceId] : [];
  }
  function setCats(spaceId, cats) {
    const all = jsonPref(P.layout);
    if (cats.length) {
      all[spaceId] = cats;
    } else {
      delete all[spaceId];
    }
    setPref(P.layout, JSON.stringify(all));
  }
  const norm = s => String(s ?? "").trim().toLocaleLowerCase("es");
  const collapsedKey = (spaceId, name) => `${spaceId}|${norm(name)}`;
  function isCollapsed(spaceId, name) {
    return jsonPref(P.collapsed).includes(collapsedKey(spaceId, name));
  }
  function setCollapsed(spaceId, name, value) {
    const set = new Set(jsonPref(P.collapsed));
    const k = collapsedKey(spaceId, name);
    value ? set.add(k) : set.delete(k);
    setPref(P.collapsed, JSON.stringify([...set]));
  }

  // Categoría de una pestaña (persistida en la sesión de Zen, sobrevive reinicios).
  const memo = new WeakMap();
  function catOf(tab) {
    if (memo.has(tab)) {
      return memo.get(tab);
    }
    let value = null;
    try {
      let raw = SessionStore.getCustomTabValue(tab, TAB_KEY);
      if (!raw) {
        raw = SessionStore.getCustomTabValue(tab, LEGACY_TAB_KEY);
        if (raw) {
          SessionStore.setCustomTabValue(tab, TAB_KEY, raw);
          SessionStore.deleteCustomTabValue(tab, LEGACY_TAB_KEY);
        }
      }
      if (raw) {
        value = JSON.parse(raw);
      }
    } catch {}
    memo.set(tab, value);
    return value;
  }
  function setCatOf(tab, name) {
    const space = tab.getAttribute("zen-workspace-id") || "";
    const value = name ? { c: name, s: space } : null;
    memo.set(tab, value);
    try {
      if (value) {
        SessionStore.setCustomTabValue(tab, TAB_KEY, JSON.stringify(value));
      } else {
        SessionStore.deleteCustomTabValue(tab, TAB_KEY);
      }
    } catch (e) {
      warn("no se pudo guardar la categoría", e);
    }
  }
  // La categoría solo vale en el Space donde se asignó.
  function catNameIn(tab, spaceId) {
    const v = catOf(tab);
    return v && v.s === spaceId ? v.c : null;
  }

  /* ───────────────────────── utilidades de pestañas ───────────────────────── */

  const isOurs = el => el.classList?.contains("tt-tidy-header");
  function isTab(el) {
    return (
      el?.localName === "tab" &&
      !el.pinned &&
      !el.closing &&
      !el.hasAttribute("zen-empty-tab") &&
      !el.hasAttribute("zen-essential") &&
      !el.hasAttribute("zen-glance-tab")
    );
  }
  function spaceOfContainer(container) {
    return container.getAttribute("zen-workspace-id") || container.closest("zen-workspace")?.id || "";
  }
  function containers() {
    return [...document.querySelectorAll(".zen-workspace-normal-tabs-section")];
  }
  function containerOf(spaceId) {
    return containers().find(c => spaceOfContainer(c) === spaceId) ?? null;
  }
  const contentTabs = container => [...container.children].filter(isTab);

  function tabURL(tab) {
    let spec = tab.linkedBrowser?.currentURI?.spec ?? "";
    if (!spec || spec === "about:blank") {
      try {
        spec = SessionStore.getLazyTabValue(tab, "url") || spec;
      } catch {}
    }
    return spec;
  }
  function tabWhere(tab) {
    const spec = tabURL(tab);
    try {
      const uri = Services.io.newURI(spec);
      if (uri.schemeIs("file")) {
        const parts = decodeURIComponent(uri.filePath).split("/").filter(Boolean);
        return `${tr("localFile")}: ${parts.slice(-3).join("/")}`.slice(0, 70);
      }
      return (uri.host || uri.scheme).replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  const cleanTitle = t =>
    String(t || "")
      .replace(/^(💤\s*)?(\(\d+\+?\)\s*)?/u, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);
  const describe = tab => `${cleanTitle(tab.label)} — ${tabWhere(tab)}`;

  function spaces() {
    try {
      return gZenWorkspaces.getWorkspaces().map(w => ({ id: w.uuid, name: w.name, icon: w.icon || "" }));
    } catch {
      return [];
    }
  }
  const activeSpace = () => gZenWorkspaces.activeWorkspace;

  /* ───────────────────────── maquetación (headers + orden) ───────────────────────── */

  let moving = false;
  let frame = null;
  function schedule() {
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        frame = null;
        layoutAll();
      });
    }
  }

  function layoutAll() {
    if (gBrowser.tabContainer.hasAttribute("movingtab")) {
      setTimeout(schedule, 300);
      return;
    }
    for (const c of containers()) {
      try {
        layout(c);
      } catch (e) {
        warn("layout", e);
      }
    }
  }

  function colorFor(cats, name) {
    const i = cats.findIndex(c => norm(c.n) === norm(name));
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  function clearTabLook(tab) {
    for (const a of ["tt-cat", "tt-collapsed", "tt-first", "tt-last"]) {
      tab.removeAttribute(a);
    }
    tab.style.removeProperty("--tt-color");
  }

  function layout(container) {
    const spaceId = spaceOfContainer(container);
    const cats = getCats(spaceId);
    const tabs = contentTabs(container);
    const byCat = new Map(cats.map(c => [norm(c.n), []]));
    const loose = [];
    for (const tab of tabs) {
      const name = catNameIn(tab, spaceId);
      const bucket = name ? byCat.get(norm(name)) : null;
      if (bucket) {
        bucket.push(tab);
      } else {
        loose.push(tab);
        clearTabLook(tab);
      }
    }

    const grouped = cats.flatMap(c => byCat.get(norm(c.n)));
    const above = getPref(P.position) === "above";

    // 1. Orden: las pestañas sueltas nunca se mueven; las agrupadas se colocan en bloque.
    moving = true;
    try {
      if (above) {
        let prev = null;
        for (const tab of grouped) {
          if (!prev) {
            const first = [...container.children].find(isTab);
            if (first && first !== tab) {
              gBrowser.moveTabBefore(tab, first);
            }
          } else if (nextTab(prev) !== tab) {
            gBrowser.moveTabAfter(tab, prev);
          }
          prev = tab;
        }
      } else {
        let anchor = loose.at(-1) ?? null;
        for (const tab of grouped) {
          if (!anchor) {
            const first = [...container.children].find(isTab);
            if (first && first !== tab) {
              gBrowser.moveTabBefore(tab, first);
            }
          } else if (nextTab(anchor) !== tab) {
            gBrowser.moveTabAfter(tab, anchor);
          }
          anchor = tab;
        }
      }
    } finally {
      moving = false;
    }

    // 2. Atributos de las pestañas agrupadas.
    for (const c of cats) {
      const list = byCat.get(norm(c.n));
      const color = colorFor(cats, c.n);
      const closed = isCollapsed(spaceId, c.n);
      list.forEach((tab, i) => {
        tab.setAttribute("tt-cat", c.n);
        tab.toggleAttribute("tt-collapsed", closed);
        tab.toggleAttribute("tt-first", i === 0);
        tab.toggleAttribute("tt-last", i === list.length - 1);
        tab.style.setProperty("--tt-color", color);
      });
    }

    // 3. Headers.
    const existing = new Map();
    for (const el of [...container.children]) {
      if (isOurs(el)) {
        existing.set(norm(el.dataset.cat), el);
      }
    }
    const keep = new Set();
    for (const c of cats) {
      const list = byCat.get(norm(c.n));
      if (!list.length) {
        continue;
      }
      const header = existing.get(norm(c.n)) ?? makeHeader();
      updateHeader(header, spaceId, c, list, colorFor(cats, c.n));
      if (header.nextElementSibling !== list[0]) {
        container.insertBefore(header, list[0]);
      }
      keep.add(header);
    }
    for (const el of [...container.children]) {
      if (isOurs(el) && !keep.has(el)) {
        el.remove();
      }
    }
    container.toggleAttribute("tt-has-groups", keep.size > 0);
  }

  function nextTab(el) {
    let n = el.nextElementSibling;
    while (n && !isTab(n) && n.localName !== "tab-split-view-wrapper" && n.localName !== "tab-group" && n.localName !== "zen-folder") {
      n = n.nextElementSibling;
    }
    return n;
  }

  function makeHeader() {
    const h = document.createXULElement("hbox");
    h.className = "tt-tidy-header";
    h.setAttribute("context", "tt-tidy-header-menu");
    h.setAttribute("align", "center");
    const chevron = document.createXULElement("image");
    chevron.className = "tt-chevron";
    const emoji = document.createXULElement("label");
    emoji.className = "tt-emoji";
    const label = document.createXULElement("label");
    label.className = "tt-label";
    label.setAttribute("crop", "end");
    label.setAttribute("flex", "1");
    const count = document.createXULElement("label");
    count.className = "tt-count";
    const chip = document.createXULElement("label");
    chip.className = "tt-chip";
    const close = document.createXULElement("image");
    close.className = "tt-close";
    close.setAttribute("tooltiptext", tr("closeCatTip"));
    h.append(chevron, emoji, label, count, chip, close);

    for (const type of ["mousedown", "dblclick", "auxclick"]) {
      h.addEventListener(type, e => e.stopPropagation());
    }
    h.addEventListener("dblclick", () => renameCat(h));
    h.addEventListener("click", e => {
      e.stopPropagation();
      if (e.button !== 0) {
        return;
      }
      if (e.target === close) {
        closeCat(h);
      } else if (e.target === chip) {
        moveCatToSpace(h, h.dataset.suggest);
      } else {
        const space = h.dataset.space;
        setCollapsed(space, h.dataset.cat, !isCollapsed(space, h.dataset.cat));
        schedule();
      }
    });
    return h;
  }

  function updateHeader(h, spaceId, cat, tabs, color) {
    h.dataset.cat = cat.n;
    h.dataset.space = spaceId;
    h.style.setProperty("--tt-color", color);
    h.querySelector(".tt-emoji").setAttribute("value", cat.e || "•");
    h.querySelector(".tt-label").setAttribute("value", cat.n);
    h.querySelector(".tt-count").setAttribute("value", String(tabs.length));
    h.toggleAttribute("tt-closed", isCollapsed(spaceId, cat.n));
    const chip = h.querySelector(".tt-chip");
    const target = cat.s && cat.s !== spaceId ? spaces().find(s => s.id === cat.s) : null;
    if (target && getPref(P.suggestSpaces)) {
      h.dataset.suggest = target.id;
      chip.setAttribute("value", `→ ${target.icon || ""} ${target.name}`.replace(/\s+/g, " "));
      chip.setAttribute("tooltiptext", tr("chipTip", target.name));
      chip.hidden = false;
    } else {
      delete h.dataset.suggest;
      chip.hidden = true;
    }
  }

  /* ───────────────────────── acciones de categoría ───────────────────────── */

  function tabsOfHeader(h) {
    const container = h.parentElement;
    return contentTabs(container).filter(t => norm(catNameIn(t, h.dataset.space)) === norm(h.dataset.cat));
  }

  function closeCat(h) {
    const tabs = tabsOfHeader(h);
    if (tabs.length) {
      gBrowser.removeTabs(tabs);
    }
  }

  function ungroupCat(h) {
    const space = h.dataset.space;
    for (const t of tabsOfHeader(h)) {
      setCatOf(t, null);
    }
    setCats(space, getCats(space).filter(c => norm(c.n) !== norm(h.dataset.cat)));
    setCollapsed(space, h.dataset.cat, false);
    schedule();
  }

  function renameCat(h) {
    const space = h.dataset.space;
    const old = h.dataset.cat;
    const value = { value: old };
    if (!Services.prompt.prompt(window, tr("renameTitle"), tr("renameMsg"), value, null, {})) {
      return;
    }
    const name = value.value.trim();
    if (!name || name === old) {
      return;
    }
    const cats = getCats(space);
    if (cats.some(c => norm(c.n) === norm(name))) {
      // Fusionar con una existente.
      for (const t of tabsOfHeader(h)) {
        setCatOf(t, cats.find(c => norm(c.n) === norm(name)).n);
      }
      setCats(space, cats.filter(c => norm(c.n) !== norm(old)));
    } else {
      for (const t of tabsOfHeader(h)) {
        setCatOf(t, name);
      }
      setCats(space, cats.map(c => (norm(c.n) === norm(old) ? { ...c, n: name } : c)));
    }
    if (isCollapsed(space, old)) {
      setCollapsed(space, old, false);
      setCollapsed(space, name, true);
    }
    schedule();
  }

  function moveCatInList(h, delta) {
    const space = h.dataset.space;
    const cats = getCats(space);
    const i = cats.findIndex(c => norm(c.n) === norm(h.dataset.cat));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cats.length) {
      return;
    }
    [cats[i], cats[j]] = [cats[j], cats[i]];
    setCats(space, cats);
    schedule();
  }

  function moveCatToSpace(h, targetId) {
    const from = h.dataset.space;
    if (!targetId || targetId === from) {
      return;
    }
    const tabs = tabsOfHeader(h);
    if (!tabs.length) {
      return;
    }
    const cats = getCats(from);
    const cat = cats.find(c => norm(c.n) === norm(h.dataset.cat)) ?? { n: h.dataset.cat, e: "" };
    const target = spaces().find(s => s.id === targetId);
    gZenWorkspaces.moveTabsToWorkspace(tabs, targetId);
    // La categoría viaja con las pestañas.
    for (const t of tabs) {
      t.setAttribute("zen-workspace-id", targetId);
      setCatOf(t, cat.n);
    }
    const targetCats = getCats(targetId);
    if (!targetCats.some(c => norm(c.n) === norm(cat.n))) {
      targetCats.push({ n: cat.n, e: cat.e, s: "" });
      setCats(targetId, targetCats);
    }
    setCats(from, cats.filter(c => norm(c.n) !== norm(cat.n)));
    if (tabs.includes(gBrowser.selectedTab)) {
      const rest = contentTabs(containerOf(from) ?? document.createElement("div"));
      if (rest[0]) {
        gBrowser.selectedTab = rest[0];
      }
    }
    toast(tr("movedTo", tabs.length, `${target?.icon ?? ""} ${target?.name ?? ""}`.trim()));
    schedule();
  }

  /* ───────────────────────── deshacer ───────────────────────── */

  let undo = null;
  function snapshot(spaceId) {
    const container = containerOf(spaceId);
    undo = {
      spaceId,
      cats: JSON.parse(JSON.stringify(getCats(spaceId))),
      order: contentTabs(container).map(t => ({ tab: t, cat: catOf(t) })),
    };
  }
  function doUndo() {
    if (!undo) {
      toast(tr("nothingUndo"));
      return;
    }
    const { spaceId, cats, order } = undo;
    undo = null;
    setCats(spaceId, cats);
    const alive = order.filter(o => o.tab.isConnected && !o.tab.closing);
    for (const o of alive) {
      setCatOf(o.tab, o.cat && o.cat.s === spaceId ? o.cat.c : null);
    }
    moving = true;
    try {
      for (let i = 1; i < alive.length; i++) {
        if (alive[i].tab.parentElement === alive[i - 1].tab.parentElement && nextTab(alive[i - 1].tab) !== alive[i].tab) {
          gBrowser.moveTabAfter(alive[i].tab, alive[i - 1].tab);
        }
      }
    } finally {
      moving = false;
    }
    schedule();
    toast(tr("restored"));
  }

  /* ───────────────────────── motores de clasificación ───────────────────────── */

  async function groqKey() {
    const direct = getPref(P.groqKey).trim();
    if (direct) {
      return direct;
    }
    let path = getPref(P.envFile).trim();
    if (!path) {
      return "";
    }
    if (path.startsWith("~/")) {
      path = PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ...path.slice(2).split("/"));
    }
    try {
      const text = await IOUtils.readUTF8(path);
      const m = text.match(/^\s*(?:export\s+)?GROQ_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  }

  class EngineError extends Error {}

  async function groqChat(key, model, messages, schema, signal) {
    const body = {
      model,
      messages,
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: { name: "tidy", strict: true, schema } },
    };
    if (model.includes("gpt-oss")) {
      body.reasoning_effort = "low";
    } else if (model.includes("qwen3")) {
      body.reasoning_effort = "none";
    }
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    });
    if (res.status === 429) {
      const e = new EngineError(tr("rateLimited"));
      e.retryAfter = Number(res.headers.get("retry-after")) || 10;
      e.rateLimited = true;
      throw e;
    }
    if (!res.ok) {
      const text = await res.text();
      warn(model, res.status, text.slice(0, 300));
      const e = new EngineError(`${tr("http" + res.status) || tr("httpOther")} (${res.status})`);
      // 400 suele ser una salida JSON que no cumplió el esquema; 5xx, un fallo pasajero: otro modelo puede lograrlo.
      e.retry = res.status === 400 || res.status >= 500;
      throw e;
    }
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  }

  // Rota entre modelos de Groq (cada uno tiene su propio cupo por minuto). Un 429 o una salida
  // JSON inválida (400) pasa al siguiente modelo; si todos están sin cupo, espera una vez.
  function modelOrder(prefer = 0) {
    const list = [...new Set([getPref(P.model), getPref(P.fallbackModel), "qwen/qwen3.8-27b"].filter(Boolean))];
    const k = prefer % list.length;
    return [...list.slice(k), ...list.slice(0, k)];
  }
  async function groqCall(key, messages, schema, signal, prefer = 0) {
    let lastWait = 0;
    let lastError = null;
    for (let round = 0; round < 2; round++) {
      for (const model of modelOrder(prefer)) {
        try {
          return await groqChat(key, model, messages, schema, signal);
        } catch (e) {
          if (signal.aborted) {
            throw e;
          }
          if (!e.rateLimited && !e.retry) {
            throw e;
          }
          lastError = e;
          if (e.rateLimited) {
            lastWait = Math.max(lastWait, e.retryAfter);
          }
          warn(`${model}: ${e.message}`);
        }
      }
      if (round === 0 && lastWait > 0 && lastWait <= 30) {
        status(tr("waiting", lastWait));
        await new Promise(r => setTimeout(r, lastWait * 1000));
      }
    }
    throw lastError ?? new EngineError(tr("noQuota"));
  }

  function spacesContext(currentId) {
    return spaces()
      .filter(s => s.id !== currentId)
      .map(s => {
        const c = containerOf(s.id);
        const sample = c ? contentTabs(c).slice(0, 8).map(tab => cleanTitle(tab.label).slice(0, 50)) : [];
        return { ...s, sample };
      });
  }

  const GENERIC = /^(misc|miscel[aá]ne|varios|otros|other|general|utilidades|utilities|recursos|resources|herramientas|tools|tecnolog[ií]a|technology|internet|web)\b/i;
  const ASSIGN_CHUNK = 25;
  const TAXONOMY_LIMIT = 260; // pestañas que ve el modelo para diseñar las categorías

  // Paso 1: diseñar la taxonomía (nombre + alcance) mirando todas las pestañas a la vez.
  async function designTaxonomy(key, targets, spaceName, existing, others, signal, limit = 0) {
    const maxCats = limit || Number(getPref(P.maxCats)) || 8;
    const suggest = getPref(P.suggestSpaces) && others.length > 0;
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["categories"],
      properties: {
        categories: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "emoji", "scope", "space"],
            properties: {
              name: { type: "string" },
              emoji: { type: "string" },
              scope: { type: "string" },
              space: { type: "string", enum: ["", ...others.map(s => s.name)] },
            },
          },
        },
      },
    };
    const sample = targets.slice(0, TAXONOMY_LIMIT).map(tab => `- ${describe(tab)}`).join("\n");
    const system = [
      tr("pTax1", spaceName),
      existing.length
        ? tr("pTaxExisting", existing.map(c => `«${c.n}»${c.d ? ` (${c.d})` : ""}`).join("; "), maxCats)
        : tr("pTaxNew", maxCats),
      tr("pTaxRules"),
      suggest ? tr("pTaxSpaces", spaceName) + "\n" + others.map(s => `- ${s.name}: ${s.sample.join("; ")}`).join("\n") : tr("pTaxNoSpaces"),
    ].join("\n");
    status(tr("designing", targets.length));
    const out = await groqCall(key, [
      { role: "system", content: system },
      { role: "user", content: sample },
    ], schema, signal, 0);
    const cats = [];
    for (const c of out.categories ?? []) {
      const name = String(c.name || "").trim().slice(0, 40);
      if (!name || cats.some(x => norm(x.name) === norm(name))) {
        continue;
      }
      const old = existing.find(x => norm(x.n) === norm(name));
      cats.push({
        name: old?.n ?? name,
        emoji: old?.e || [...String(c.emoji || "")].slice(0, 2).join(""),
        scope: String(c.scope || old?.d || "").slice(0, 220),
        space: c.space ? others.find(s => s.name === c.space)?.id ?? "" : old?.s ?? "",
        generic: GENERIC.test(name),
        tabs: [],
      });
    }
    // Las categorías existentes siempre siguen disponibles aunque el modelo no las repita.
    for (const c of existing) {
      if (!cats.some(x => norm(x.name) === norm(c.n))) {
        cats.push({ name: c.n, emoji: c.e, scope: c.d || "", space: c.s || "", generic: false, tabs: [] });
      }
    }
    return cats;
  }

  // Paso 2: clasificar en bloques pequeños; el esquema exige una clave por pestaña (t0, t1…),
  // así ninguna se pierde ni se desalinea.
  async function assignChunk(key, chunk, offset, cats, signal, prefer) {
    const codes = cats.map((_, i) => String.fromCharCode(65 + i));
    const keys = chunk.map((_, k) => `t${offset + k}`);
    const schema = {
      type: "object",
      additionalProperties: false,
      required: keys,
      properties: Object.fromEntries(keys.map(k => [k, { type: "string", enum: [...codes, "-"] }])),
    };
    const system =
      tr("pAssign") + "\n" +
      cats.map((c, i) => `${codes[i]} = ${c.name}${c.scope ? `: ${c.scope}` : ""}`).join("\n") +
      "\n" + tr("pAssignNone");
    const user = chunk.map((tab, k) => `t${offset + k}: ${describe(tab)}`).join("\n");
    const out = await groqCall(key, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], schema, signal, prefer);
    const result = new Map();
    keys.forEach((k, i) => {
      const code = out?.[k];
      const idx = codes.indexOf(code);
      if (idx >= 0) {
        result.set(chunk[i], idx);
      }
    });
    return result;
  }

  async function classifyGroq(targets, spaceId, existing, signal) {
    const key = await groqKey();
    if (!key) {
      throw new EngineError(tr("noKey"));
    }
    const space = spaces().find(s => s.id === spaceId);
    const others = spacesContext(spaceId);
    const cats = await designTaxonomy(key, targets, space?.name ?? "", existing, others, signal);
    log("taxonomía:", cats.map(c => c.name).join(" · "));
    if (!cats.length) {
      throw new EngineError(tr("noCats"));
    }

    const placed = new Map(); // pestaña → índice de categoría
    let done = 0;
    const assignAll = async (list, catList, label) => {
      const chunks = [];
      for (let start = 0; start < list.length; start += ASSIGN_CHUNK) {
        chunks.push([list.slice(start, start + ASSIGN_CHUNK), start]);
      }
      // Hasta 3 bloques en paralelo, cada uno empezando por un modelo distinto.
      for (let i = 0; i < chunks.length; i += 3) {
        const batch = chunks.slice(i, i + 3).map(([chunk, start], j) =>
          assignChunk(key, chunk, start, catList, signal, j).then(r => {
            done += chunk.length;
            status(tr("sorting", Math.min(done, label), label));
            return r;
          })
        );
        for (const map of await Promise.all(batch)) {
          for (const [tab, idx] of map) {
            placed.set(tab, idx);
          }
        }
      }
    };
    status(tr("sorting", 0, targets.length));
    await assignAll(targets, cats, targets.length);

    // Segunda pasada: si quedó mucho sin clasificar, faltaban categorías. Se diseñan solo para el resto.
    const leftovers = () => targets.filter(tab => !placed.has(tab) || cats[placed.get(tab)].generic);
    let rest = leftovers();
    if (rest.length >= 3 && rest.length / targets.length > 0.08) {
      const known = cats.filter(c => !c.generic).map(c => ({ n: c.name, e: c.emoji, s: c.space, d: c.scope }));
      const extra = await designTaxonomy(key, rest, space?.name ?? "", known, others, signal, cats.length + 4);
      log("segunda pasada:", rest.length, "sueltas →", extra.map(c => c.name).join(" · "));
      for (const c of extra) {
        if (!cats.some(x => norm(x.name) === norm(c.name))) {
          cats.push(c);
        }
      }
      for (const tab of rest) {
        placed.delete(tab);
      }
      done = 0;
      await assignAll(rest, cats, rest.length);
    }

    for (const [tab, idx] of placed) {
      cats[idx].tabs.push(tab);
    }
    // Las categorías tipo «Varios» no ayudan, y una categoría nueva con una sola pestaña es ruido:
    // esas pestañas quedan sueltas hasta el próximo orden.
    const before = new Set(existing.map(c => norm(c.n)));
    const useful = cats.filter(c => c.tabs.length && !c.generic && (c.tabs.length >= 2 || before.has(norm(c.name))));
    const assigned = useful.reduce((n, c) => n + c.tabs.length, 0);
    return { engine: "Groq", categories: useful, missing: targets.length - assigned };
  }

  async function classifyLocal(targets) {
    if (!Services.prefs.getBoolPref("browser.ml.enable", false)) {
      Services.prefs.setBoolPref("browser.ml.enable", true);
    }
    const { SmartTabGroupingManager } = ChromeUtils.importESModule(
      "moz-src:///browser/components/tabbrowser/SmartTabGrouping.sys.mjs"
    );
    const manager = new SmartTabGroupingManager();
    status(tr("localWorking"));
    const result = await manager.generateClusters(targets, null, 0);
    // Grupos de una sola pestaña no ayudan: esas quedan sueltas.
    const clusters = (result?.clusterRepresentations ?? []).filter(c => c.tabs?.length >= 2);
    const categories = [];
    let assigned = 0;
    for (const cl of clusters) {
      const others = targets.filter(t => !cl.tabs.includes(t));
      let label = "";
      try {
        label = (await manager.getPredictedLabelForGroup(cl.tabs, others))?.trim() ?? "";
      } catch {}
      if (label.length < 4) {
        label = dominantSite(cl.tabs) ?? tr("group");
      }
      categories.push({ name: label.slice(0, 32), emoji: "", space: "", tabs: cl.tabs });
      assigned += cl.tabs.length;
    }
    if (!categories.length) {
      throw new EngineError(tr("localEmpty"));
    }
    return { engine: "IA local", categories: dedupeNames(categories), missing: targets.length - assigned };
  }

  function siteOf(tab) {
    try {
      const host = Services.io.newURI(tabURL(tab)).host;
      try {
        return Services.eTLD.getBaseDomainFromHost(host);
      } catch {
        return host;
      }
    } catch {
      return null;
    }
  }
  function dominantSite(tabs) {
    const n = new Map();
    for (const t of tabs) {
      const s = siteOf(t);
      if (s) {
        n.set(s, (n.get(s) ?? 0) + 1);
      }
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  function classifyDomain(targets) {
    const groups = new Map();
    for (const t of targets) {
      const s = siteOf(t) ?? tr("localFiles");
      if (!groups.has(s)) {
        groups.set(s, []);
      }
      groups.get(s).push(t);
    }
    const categories = [...groups.entries()]
      .filter(([, tabs]) => tabs.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, tabs]) => ({ name, emoji: "", space: "", tabs }));
    const assigned = categories.reduce((n, c) => n + c.tabs.length, 0);
    return { engine: "dominios", categories, missing: targets.length - assigned };
  }
  function dedupeNames(categories) {
    const seen = new Map();
    for (const c of categories) {
      const k = norm(c.name);
      if (seen.has(k)) {
        seen.get(k).tabs.push(...c.tabs);
      } else {
        seen.set(k, c);
      }
    }
    return [...seen.values()];
  }

  /* ───────────────────────── Tidy ───────────────────────── */

  let running = null;

  async function tidy({ all = false } = {}) {
    if (running) {
      running.abort();
      running = null;
      status(null);
      toast(tr("cancelled"));
      return;
    }
    const spaceId = activeSpace();
    const container = containerOf(spaceId);
    if (!container) {
      return;
    }
    const tabs = contentTabs(container);
    let existing = getCats(spaceId);
    if (all) {
      existing = [];
    } else {
      // Solo se conservan las categorías que todavía tienen pestañas.
      const live = new Set(tabs.map(t => norm(catNameIn(t, spaceId))).filter(Boolean));
      existing = existing.filter(c => live.has(norm(c.n)));
    }
    const known = new Set(existing.map(c => norm(c.n)));
    const BLANK = /^(about:(blank|newtab|home|privatebrowsing)|)$/;
    const targets = tabs.filter(t => !BLANK.test(tabURL(t)) && (all || !known.has(norm(catNameIn(t, spaceId)))));
    if (!targets.length) {
      toast(tr("allSorted"));
      return;
    }

    snapshot(spaceId);
    running = new AbortController();
    const signal = running.signal;
    setBusy(true);
    let result = null;
    const notes = [];
    try {
      try {
        result = await classifyGroq(targets, spaceId, existing, signal);
      } catch (e) {
        if (signal.aborted) {
          return;
        }
        warn("Groq falló:", e);
        notes.push(e.message === tr("noKey") ? tr("noKeyHint") : `Groq: ${e.message}`);
        if (getPref(P.localFallback)) {
          try {
            result = await classifyLocal(targets);
          } catch (e2) {
            warn("IA local falló:", e2);
            notes.push(`IA local: ${e2.message}`);
          }
        }
        result ??= classifyDomain(targets);
      }
      if (signal.aborted || !result) {
        return;
      }
      apply(spaceId, result, all, existing);
      const n = result.categories.reduce((a, c) => a + c.tabs.length, 0);
      if (!n) {
        toast(tr("noneFit", result.missing), notes.join(" | "));
        return;
      }
      let msg = tr("result", n, result.categories.length, result.engine);
      if (result.missing > 0) {
        msg += tr("unsorted", result.missing);
      }
      toast(msg, notes.length ? notes.join(" | ") : tr("undoHint"));
    } finally {
      running = null;
      setBusy(false);
      status(null);
    }
  }

  function apply(spaceId, result, all, existing) {
    const prev = getCats(spaceId);
    let cats = all ? [] : existing.map(c => ({ ...c }));
    for (const c of result.categories) {
      let entry = cats.find(x => norm(x.n) === norm(c.name));
      if (!entry) {
        const old = prev.find(x => norm(x.n) === norm(c.name));
        entry = { n: c.name, e: c.emoji || old?.e || "", s: c.space || "", d: c.scope || old?.d || "" };
        cats.push(entry);
      } else {
        entry.e ||= c.emoji || "";
        entry.d ||= c.scope || "";
      }
      for (const t of c.tabs) {
        setCatOf(t, entry.n);
      }
    }
    if (all) {
      // Las pestañas que el modelo no clasificó quedan sueltas.
      const placed = new Set(result.categories.flatMap(c => c.tabs));
      for (const t of contentTabs(containerOf(spaceId))) {
        if (!placed.has(t)) {
          setCatOf(t, null);
        }
      }
    }
    setCats(spaceId, cats);
    layoutAll();
  }

  /* ───────────────────────── UI: botón, estado, toast, menús ───────────────────────── */

  function setBusy(on) {
    document.documentElement.toggleAttribute("tt-tidy-busy", on);
    for (const b of document.querySelectorAll(".tt-tidy-button")) {
      b.setAttribute("tooltiptext", on ? tr("busyTip") : tr("buttonTip", prettyShortcut()));
    }
  }

  function status(text) {
    const container = containerOf(activeSpace());
    let el = document.getElementById("tt-tidy-status");
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createXULElement("hbox");
      el.id = "tt-tidy-status";
      el.setAttribute("align", "center");
      const spin = document.createXULElement("image");
      spin.className = "tt-spinner";
      const label = document.createXULElement("label");
      el.append(spin, label);
    }
    el.querySelector("label").setAttribute("value", text);
    if (container && el.parentElement !== container) {
      container.prepend(el);
    }
  }

  let toastTimer = null;
  function toast(text, detail = "") {
    let el = document.getElementById("tt-tidy-toast");
    if (!el) {
      el = document.createXULElement("vbox");
      el.id = "tt-tidy-toast";
      const l = document.createXULElement("label");
      l.className = "tt-toast-main";
      const d = document.createXULElement("label");
      d.className = "tt-toast-detail";
      el.append(l, d);
      el.addEventListener("click", () => el.removeAttribute("shown"));
      (document.getElementById("zen-main-app-wrapper") ?? document.documentElement).append(el);
    }
    el.querySelector(".tt-toast-main").setAttribute("value", text);
    const d = el.querySelector(".tt-toast-detail");
    d.setAttribute("value", detail);
    d.hidden = !detail;
    el.setAttribute("shown", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.removeAttribute("shown"), detail ? 8000 : 4500);
  }

  function prettyShortcut() {
    return getPref(P.shortcut)
      .split("+")
      .map(k => (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)))
      .join("+");
  }

  function addButtons() {
    for (const sep of document.querySelectorAll(".pinned-tabs-container-separator")) {
      if (sep.querySelector(".tt-tidy-button")) {
        continue;
      }
      const b = document.createXULElement("toolbarbutton");
      b.className = "tt-tidy-button toolbarbutton-1";
      b.setAttribute("label", tr("button"));
      b.setAttribute("tooltiptext", tr("buttonTip", prettyShortcut()));
      b.addEventListener("command", e => tidy({ all: e.shiftKey }));
      b.addEventListener("click", e => {
        if (e.button === 1) {
          tidy({ all: true });
        }
      });
      const clear = sep.querySelector(".zen-workspace-close-unpinned-tabs-button");
      sep.insertBefore(b, clear ?? null);
    }
  }

  // Elementos con texto traducible: se re-etiquetan si cambia el idioma.
  const labeled = [];
  function labelKey(el, key) {
    el.setAttribute("label", tr(key));
    labeled.push([el, key]);
  }
  function relabel() {
    for (const [el, key] of labeled) {
      el.setAttribute("label", tr(key));
    }
    for (const b of document.querySelectorAll(".tt-tidy-button")) {
      b.setAttribute("label", tr("button"));
      b.setAttribute("tooltiptext", tr("buttonTip", prettyShortcut()));
    }
  }

  function menuItem(label, fn, id) {
    const m = document.createXULElement("menuitem");
    if (Object.hasOwn(STRINGS.en, label)) {
      labelKey(m, label);
    } else {
      m.setAttribute("label", label);
    }
    if (id) {
      m.id = id;
    }
    m.addEventListener("command", fn);
    return m;
  }

  function setupMenus() {
    // Menú contextual de las cabeceras.
    const popup = document.createXULElement("menupopup");
    popup.id = "tt-tidy-header-menu";
    const header = () => popup.triggerNode?.closest?.(".tt-tidy-header");
    const moveMenu = document.createXULElement("menu");
    labelKey(moveMenu, "moveCatToSpace");
    const movePopup = document.createXULElement("menupopup");
    moveMenu.append(movePopup);
    popup.append(
      menuItem("rename", () => header() && renameCat(header())),
      menuItem("up", () => header() && moveCatInList(header(), -1)),
      menuItem("down", () => header() && moveCatInList(header(), 1)),
      moveMenu,
      document.createXULElement("menuseparator"),
      menuItem("ungroup", () => header() && ungroupCat(header())),
      menuItem("unload", () => {
        const h = header();
        if (h) {
          gBrowser.explicitUnloadTabs(tabsOfHeader(h).filter(t => !t.hasAttribute("pending")));
        }
      }),
      menuItem("closeTabs", () => header() && closeCat(header())),
      document.createXULElement("menuseparator"),
      menuItem("sortNew", () => tidy()),
      menuItem("resortAll", () => tidy({ all: true })),
      menuItem("undo", doUndo)
    );
    popup.addEventListener("popupshowing", e => {
      if (e.target !== popup) {
        return;
      }
      const h = header();
      movePopup.replaceChildren(
        ...spaces()
          .filter(s => s.id !== h?.dataset.space)
          .map(s => menuItem(`${s.icon} ${s.name}`.trim(), () => h && moveCatToSpace(h, s.id)))
      );
      moveMenu.disabled = !movePopup.children.length;
    });
    document.getElementById("mainPopupSet").append(popup);

    // Menú contextual de las pestañas.
    const tabMenu = document.getElementById("tabContextMenu");
    const sep = document.createXULElement("menuseparator");
    sep.id = "tt-tidy-sep";
    const itemTidy = menuItem("sortAI", () => tidy(), "tt-tidy-ctx-tidy");
    const itemAll = menuItem("resortAll", () => tidy({ all: true }), "tt-tidy-ctx-all");
    const catMenu = document.createXULElement("menu");
    catMenu.id = "tt-tidy-ctx-cat";
    labelKey(catMenu, "moveToCat");
    const catPopup = document.createXULElement("menupopup");
    catMenu.append(catPopup);
    const itemUndo = menuItem("undo", doUndo, "tt-tidy-ctx-undo");
    tabMenu.append(sep, itemTidy, itemAll, catMenu, itemUndo);
    tabMenu.addEventListener("popupshowing", e => {
      if (e.target !== tabMenu) {
        return;
      }
      const tab = TabContextMenu.contextTab;
      const ok = tab && isTab(tab);
      for (const el of [sep, itemTidy, itemAll, catMenu, itemUndo]) {
        el.hidden = !ok;
      }
      itemUndo.hidden = !ok || !undo;
      if (!ok) {
        return;
      }
      const space = tab.getAttribute("zen-workspace-id");
      const selected = tab.multiselected ? gBrowser.selectedTabs.filter(isTab) : [tab];
      const current = catNameIn(tab, space);
      const items = getCats(space).map(c => {
        const m = menuItem(`${c.e || "•"} ${c.n}`, () => {
          selected.forEach(t => setCatOf(t, c.n));
          schedule();
        });
        if (norm(c.n) === norm(current)) {
          m.setAttribute("disabled", "true");
        }
        return m;
      });
      items.push(document.createXULElement("menuseparator"));
      items.push(
        menuItem("newCat", () => {
          const v = { value: "" };
          if (Services.prompt.prompt(window, tr("newCatTitle"), tr("newCatMsg"), v, null, {}) && v.value.trim()) {
            const name = v.value.trim();
            const cats = getCats(space);
            if (!cats.some(c => norm(c.n) === norm(name))) {
              cats.push({ n: name, e: "", s: "" });
              setCats(space, cats);
            }
            selected.forEach(t => setCatOf(t, cats.find(c => norm(c.n) === norm(name)).n));
            schedule();
          }
        })
      );
      if (current) {
        items.push(
          menuItem("removeFromCat", () => {
            selected.forEach(t => setCatOf(t, null));
            schedule();
          })
        );
      }
      catPopup.replaceChildren(...items);
    });

    // Menú del Space (clic derecho en el nombre del Space).
    const wsMenu = document.getElementById("zenWorkspaceMoreActions");
    if (wsMenu) {
      wsMenu.append(
        document.createXULElement("menuseparator"),
        menuItem("sortAI", () => tidy(), "tt-tidy-ws-tidy"),
        menuItem("resortAll", () => tidy({ all: true }), "tt-tidy-ws-all")
      );
    }
  }

  function matchesShortcut(e) {
    const parts = getPref(P.shortcut).toLowerCase().split("+").map(s => s.trim());
    const key = parts.at(-1);
    const want = new Set(parts.slice(0, -1));
    return (
      e.key.toLowerCase() === key &&
      e.ctrlKey === want.has("ctrl") &&
      e.altKey === want.has("alt") &&
      e.shiftKey === (want.has("shift") || false) &&
      e.metaKey === want.has("meta")
    );
  }

  /* ───────────────────────── eventos ───────────────────────── */

  // Si el usuario arrastra una pestaña, adopta la categoría del vecino donde cae.
  function onTabMove(e) {
    if (moving) {
      return;
    }
    const tab = e.target;
    if (!isTab(tab) || !gBrowser.tabContainer.hasAttribute("movingtab") && !tab._ttDragged) {
      schedule();
      return;
    }
    tab._ttDragged = false;
    const space = tab.getAttribute("zen-workspace-id");
    let prev = tab.previousElementSibling;
    while (prev && !isTab(prev) && !isOurs(prev)) {
      prev = prev.previousElementSibling;
    }
    const name = isOurs(prev) ? prev.dataset.cat : prev ? catNameIn(prev, space) : null;
    let next = tab.nextElementSibling;
    while (next && !isTab(next) && !isOurs(next)) {
      next = next.nextElementSibling;
    }
    const nextName = next && isTab(next) ? catNameIn(next, space) : null;
    // Entre dos pestañas de la misma categoría, o justo debajo de una cabecera: entra a esa categoría.
    if (name && (isOurs(prev) || name === nextName || catNameIn(tab, space) === name)) {
      setCatOf(tab, name);
    } else if (!name && !nextName) {
      setCatOf(tab, null);
    } else if (name && !nextName) {
      // Último de un grupo: se une al grupo de arriba.
      setCatOf(tab, name);
    } else {
      setCatOf(tab, nextName);
    }
    schedule();
  }

  // Una pestaña abierta desde otra hereda su categoría (como los hijos en Arc).
  function onTabOpen(e) {
    const tab = e.target;
    const opener = tab.openerTab ?? tab.owner;
    if (opener && isTab(opener)) {
      const space = opener.getAttribute("zen-workspace-id");
      const name = catNameIn(opener, space);
      if (name && tab.getAttribute("zen-workspace-id") === space) {
        setCatOf(tab, name);
      }
    }
    schedule();
  }

  /* ───────────────────────── estilos ───────────────────────── */

  const CSS = `
    .tt-tidy-header {
      --tt-c: var(--tt-color, #3fa9ff);
      min-height: 28px;
      margin: 6px var(--tab-inline-padding, 4px) 1px;
      padding-inline: 8px 6px;
      gap: 6px;
      border-radius: var(--border-radius-medium, 8px);
      font-size: 12px;
      font-weight: 600;
      cursor: default;
      -moz-window-dragging: no-drag;
      color: color-mix(in srgb, var(--tt-c) 55%, currentColor);
      background: color-mix(in srgb, var(--tt-c) 9%, transparent);
      transition: background 120ms ease;
    }
    .tt-tidy-header:hover { background: color-mix(in srgb, var(--tt-c) 16%, transparent); }
    .tt-tidy-header .tt-chevron {
      width: 12px; height: 12px;
      background-color: currentColor;
      mask: url("chrome://browser/skin/zen-icons/arrow-right.svg") center / 12px 12px no-repeat;
      transform: rotate(90deg);
      transition: transform 140ms ease;
      opacity: .8;
    }
    .tt-tidy-header[tt-closed] .tt-chevron { transform: rotate(0deg); }
    .tt-tidy-header .tt-emoji { margin: 0; font-size: 13px; min-width: 16px; text-align: center; }
    .tt-tidy-header .tt-label { margin: 0; color: var(--toolbox-textcolor, currentColor); }
    .tt-tidy-header .tt-count {
      margin: 0; padding: 0 6px; border-radius: 99px; font-size: 10.5px; font-weight: 700;
      background: color-mix(in srgb, var(--tt-c) 22%, transparent);
    }
    .tt-tidy-header .tt-chip {
      margin: 0; padding: 1px 7px; border-radius: 99px; font-size: 10.5px; font-weight: 600;
      border: 1px dashed color-mix(in srgb, var(--tt-c) 70%, transparent);
      cursor: pointer;
    }
    .tt-tidy-header .tt-chip:hover { background: color-mix(in srgb, var(--tt-c) 25%, transparent); }
    .tt-tidy-header .tt-close {
      width: 16px; height: 16px; border-radius: 4px; padding: 2px;
      list-style-image: url("chrome://global/skin/icons/close.svg");
      -moz-context-properties: fill; fill: currentColor;
      display: none;
    }
    .tt-tidy-header:hover .tt-close { display: flex; opacity: .7; }
    .tt-tidy-header .tt-close:hover { opacity: 1; background: color-mix(in srgb, currentColor 15%, transparent); }

    tab[tt-cat] { position: relative; }
    :root[zen-sidebar-expanded="true"] tab[tt-cat] > .tab-stack { margin-inline-start: 10px; }
    :root[zen-sidebar-expanded="true"] tab[tt-cat]::before {
      content: ""; position: absolute; inset-inline-start: calc(var(--tab-inline-padding, 4px) + 4px);
      top: 3px; bottom: 3px; width: 3px; border-radius: 3px;
      background: color-mix(in srgb, var(--tt-color, #3fa9ff) 85%, transparent);
      pointer-events: none;
    }
    tab[tt-collapsed]:not([selected], [multiselected], [visuallyselected]) { display: none !important; }

    /* El botón vive en la línea divisoria, como el «Clear» de Zen: aparece al pasar el mouse por la barra. */
    .tt-tidy-button {
      list-style-image: url("chrome://global/skin/icons/highlights.svg");
      -moz-context-properties: fill; fill: currentColor;
      font-weight: 600 !important;
    }
    :root[tt-tidy-busy] .tt-tidy-button { pointer-events: auto !important; color: #9b5cff; }
    :root[tt-tidy-busy] .tt-tidy-button :is(.toolbarbutton-icon, .toolbarbutton-text) { opacity: 1 !important; }

    #tt-tidy-status {
      margin: 4px var(--tab-inline-padding, 4px); padding: 6px 10px; gap: 8px;
      border-radius: var(--border-radius-medium, 8px);
      font-size: 11.5px; font-weight: 600;
      background: linear-gradient(90deg, rgba(63,169,255,.16), rgba(155,92,255,.16), rgba(255,46,136,.16));
      background-size: 200% 100%;
      animation: tt-shimmer 1.6s linear infinite;
    }
    #tt-tidy-status label { margin: 0; }
    #tt-tidy-status .tt-spinner {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid currentColor; border-top-color: transparent;
      animation: tt-spin .8s linear infinite;
    }
    @keyframes tt-spin { to { transform: rotate(360deg); } }
    @keyframes tt-shimmer { to { background-position: -200% 0; } }

    #tt-tidy-toast {
      position: fixed; left: 50%; bottom: 18px; z-index: 10000;
      max-width: 420px; padding: 9px 14px; gap: 2px;
      border-radius: 12px;
      background: color-mix(in srgb, #06060f 88%, #9b5cff);
      color: #f3f3ff; font-size: 12px; font-weight: 600;
      box-shadow: 0 8px 28px rgba(0,0,0,.35);
      border: 1px solid rgba(155,92,255,.45);
      opacity: 0; transform: translate(-50%, 8px); pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    #tt-tidy-toast[shown] { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
    #tt-tidy-toast label { margin: 0; }
    #tt-tidy-toast .tt-toast-detail { font-weight: 400; opacity: .7; font-size: 11px; }
  `;

  /* ───────────────────────── arranque ───────────────────────── */

  function init() {
    migrateLegacyPrefs();
    windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(CSS), windowUtils.AUTHOR_SHEET);
    setupMenus();
    addButtons();

    const tc = gBrowser.tabContainer;
    tc.addEventListener("TabOpen", onTabOpen);
    tc.addEventListener("TabMove", onTabMove);
    tc.addEventListener("dragstart", e => {
      const tab = e.target.closest?.("tab");
      if (tab) {
        tab._ttDragged = true;
      }
    }, true);
    tc.addEventListener("dragend", e => {
      const tab = e.target.closest?.("tab");
      if (tab) {
        setTimeout(() => (tab._ttDragged = false), 600);
      }
    }, true);
    for (const type of ["TabClose", "TabPinned", "TabUnpinned", "TabSelect", "TabGrouped", "TabUngrouped", "SSTabRestoring"]) {
      tc.addEventListener(type, schedule);
    }
    window.addEventListener("ZenWorkspacesUIUpdate", () => {
      addButtons();
      schedule();
    });
    window.addEventListener("keydown", e => {
      if (matchesShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        tidy();
      }
    }, true);

    const prefObserver = { observe: schedule };
    Services.prefs.addObserver(P.position, prefObserver);
    Services.prefs.addObserver(P.suggestSpaces, prefObserver);
    const langObserver = { observe: () => { relabel(); schedule(); } };
    Services.prefs.addObserver(P.language, langObserver);
    window.addEventListener("unload", () => Services.prefs.removeObserver(P.language, langObserver));
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(P.position, prefObserver);
      Services.prefs.removeObserver(P.suggestSpaces, prefObserver);
    });

    const headerFor = (name, spaceId = activeSpace()) =>
      [...(containerOf(spaceId)?.children ?? [])].find(e => isOurs(e) && norm(e.dataset.cat) === norm(name));
    window.TabTaxonomy = {
      tidy,
      undo: doUndo,
      layoutAll,
      getCats,
      catOf,
      setCatOf,
      moveCategoryToSpace: (name, targetId) => headerFor(name) && moveCatToSpace(headerFor(name), targetId),
      renameCategory: name => headerFor(name) && renameCat(headerFor(name)),
      ungroupCategory: name => headerFor(name) && ungroupCat(headerFor(name)),
    };
    schedule();
    // La restauración de sesión rellena las pestañas poco a poco.
    setTimeout(schedule, 1500);
    setTimeout(schedule, 5000);
    log("listo");
  }

  function whenReady(fn) {
    const go = () =>
      Promise.race([
        window.gZenWorkspaces?.promiseInitialized ?? Promise.resolve(),
        new Promise(r => setTimeout(r, 5000)),
      ]).then(fn);
    if (gBrowserInit.delayedStartupFinished) {
      go();
      return;
    }
    const obs = subject => {
      if (subject === window) {
        Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
        go();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }

  whenReady(init);
})();
