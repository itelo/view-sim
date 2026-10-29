// Runs at document_start in the top frame of an enabled host (isolated world). It stops the real
// page from loading and replaces it with the simulator, which re-loads the same URL in device iframes.
(() => {
  "use strict";
  if (window.top !== window || window.__mfsimTop) return;
  window.__mfsimTop = true;
  // Set by the MCP server's headless renderer: draw one device around a screenshot instead of a live page.
  const RENDER = self.MFSIM_RENDER ?? null;

  if (!RENDER) window.stop();
  const root = document.documentElement ?? document.appendChild(document.createElement("html"));
  for (const attribute of [...root.attributes]) root.removeAttribute(attribute.name);
  root.replaceChildren();
  if (RENDER) root.className = "mf-render-root";
  const head = root.appendChild(document.createElement("head"));
  const body = root.appendChild(document.createElement("body"));
  head.append(Object.assign(document.createElement("meta"), { name: "viewport", content: "width=device-width" }));
  document.title = `${location.host} — view-sim`;
  body.className = "mf-app";

  const DEVICES = self.MFSIM_DEVICES;
  const BROWSERS = self.MFSIM_BROWSERS;
  const DEFAULTS = self.MFSIM_DEFAULTS;
  const browsersFor = self.MFSIM_browsersFor;
  const resolveBrowser = self.MFSIM_resolveBrowser;
  const userAgentFor = self.MFSIM_userAgentFor;
  const deviceById = new Map(DEVICES.map((device) => [device.id, device]));
  const browserById = new Map(BROWSERS.map((browser) => [browser.id, browser]));
  const host = location.hostname;
  const storageKey = `host:${host}`;
  const FRAME_NAME_PREFIX = "__mfsim__";
  const ZOOM_OPTIONS = [
    ["fit", "Fit"],
    ["0.5", "50%"],
    ["0.75", "75%"],
    ["1", "100%"],
  ];

  let settings;
  let currentUrl = RENDER?.url ?? location.href;
  let activeCard = null;
  let cards = [];
  let nextUid = 1;
  let captureState = null;

  // --- tiny DOM helpers -------------------------------------------------------
  const h = (tag, props = {}, ...children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") element.className = value;
      else if (key === "text") element.textContent = value;
      else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value === true ? "" : value);
    }
    element.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
    return element;
  };

  const SVG_NS = "http://www.w3.org/2000/svg";
  const icon = (paths, { size = 18, fill = false } = {}) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", fill ? "currentColor" : "none");
    svg.setAttribute("stroke", fill ? "none" : "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of [paths].flat()) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  };
  const ICONS = {
    back: "M15 18l-6-6 6-6",
    forward: "M9 18l6-6-6-6",
    reload: ["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"],
    rotate: ["M16 3h5v5", "M21 3l-6 6", "M3 12a9 9 0 0 0 15.5 6.2"],
    close: ["M18 6L6 18", "M6 6l12 12"],
    power: ["M12 2v10", "M18.36 6.64a9 9 0 1 1-12.73 0"],
    sync: ["M4 12a8 8 0 0 1 14-5.3L20 9", "M20 4v5h-5", "M20 12a8 8 0 0 1-14 5.3L4 15", "M4 20v-5h5"],
    frame: ["M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z", "M11 18h2"],
    camera: ["M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z", "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
    signal: "M2 20h3v-4H2zM7 20h3v-8H7zM12 20h3V8h-3zM17 20h3V4h-3z",
    wifi: "M12 20.5l3.5-4.2a5.5 5.5 0 0 0-7 0zM5.2 13.2a10 10 0 0 1 13.6 0l2-2.4a13 13 0 0 0-17.6 0z",
    battery: "M3 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm18 3.5v3a1.5 1.5 0 0 0 0-3z",
    share: ["M12 3v12", "M8 7l4-4 4 4", "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"],
    book: ["M12 6c-2-2-6-2-9-1v14c3-1 7-1 9 1 2-2 6-2 9-1V5c-3-1-7-1-9 1z", "M12 6v14"],
    tabs: ["M8 8h12v12H8z", "M4 16V4h12"],
    plus: ["M12 5v14", "M5 12h14"],
    dotsV: "M12 7a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 12 7zm0 6.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zm0 6.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
    dotsH: "M7 12a1.6 1.6 0 1 1-3.2 0A1.6 1.6 0 0 1 7 12zm6.6 0a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zm6.6 0a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z",
    lock: ["M6 11h12v10H6z", "M8 11V7a4 4 0 0 1 8 0v4"],
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    tune: ["M4 7h10", "M18 7h2", "M16 5v4", "M4 17h4", "M12 17h8", "M10 15v4"],
    home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
    sidebar: ["M3 4h18v16H3z", "M9 4v16"],
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-5-5"],
    menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  };

  // --- device geometry --------------------------------------------------------
  const isDesktop = (device) => device.os === "macos";
  const HOME_AREA = 34;
  const GESTURE_BAR = 24;

  // Browser UI around the page, in CSS px: rows above and below it, a left sidebar (Zen), and the
  // margin Zen leaves around its rounded content area.
  const browserInsets = (device, browser, landscape) => {
    const none = { top: 0, bottom: 0, left: 0, inset: 0 };
    if (isDesktop(device)) {
      if (browser === "zen") return { ...none, left: 260, inset: 8 };
      return { ...none, top: { safari: 52, chrome: 76, firefox: 78 }[browser] };
    }
    if (landscape && device.type === "phone") return { ...none, top: device.os === "ios" && browser === "safari" ? 50 : 48 };
    if (device.type === "tablet") return { ...none, top: browser === "safari" ? 50 : 56 };
    if (device.os === "ios") {
      const home = device.cutout === "classic" ? 0 : HOME_AREA;
      return browser === "safari" ? { ...none, bottom: 105 + home } : { ...none, top: 56, bottom: 49 + home };
    }
    return browser === "firefox" ? { ...none, bottom: 56 + GESTURE_BAR } : { ...none, top: 56, bottom: GESTURE_BAR };
  };

  // Laptop lids sit above a wider base; iMacs and monitors stand on a neck and foot. Both live
  // outside the lid box, as overhangX on each side and standHeight below it.
  const bodyGeometry = (device, landscape, screenW, screenH) => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    const geometry = { pad: zero, overhangX: 0, standHeight: 0, chin: 0 };
    if (!settings.frame) return geometry;
    if (device.type === "laptop") {
      return { ...geometry, pad: { top: 22, right: 18, bottom: 24, left: 18 }, overhangX: Math.round(screenW * 0.065), standHeight: 24 };
    }
    if (device.type === "imac") {
      const chin = Math.round(screenH * 0.17);
      return { ...geometry, pad: { top: 34, right: 34, bottom: 34 + chin, left: 34 }, standHeight: Math.round(screenH * 0.2), chin };
    }
    if (device.type === "monitor") {
      return { ...geometry, pad: { top: 12, right: 12, bottom: 30, left: 12 }, standHeight: Math.round(screenH * 0.26) };
    }
    if (device.cutout === "classic") {
      return { ...geometry, pad: landscape ? { top: 16, right: 72, bottom: 16, left: 72 } : { top: 72, right: 16, bottom: 72, left: 16 } };
    }
    const bezel = device.type === "tablet" ? 22 : 13;
    return { ...geometry, pad: { top: bezel, right: bezel, bottom: bezel, left: bezel } };
  };

  const metrics = (card) => {
    const { device, browser } = card;
    const landscape = !isDesktop(device) && card.entry.landscape;
    const screenW = landscape ? device.height : device.width;
    const screenH = landscape ? device.width : device.height;
    const framed = settings.frame;
    let systemTop = 0;
    if (framed) {
      if (isDesktop(device)) systemTop = device.menuBar;
      else if (!landscape || device.type === "tablet") systemTop = device.statusBar;
    }
    const chrome = framed ? browserInsets(device, browser, landscape) : { top: 0, bottom: 0, left: 0, inset: 0 };
    const middleH = screenH - systemTop - chrome.top - chrome.bottom;
    const body = bodyGeometry(device, landscape, screenW, screenH);
    return {
      screenW,
      screenH,
      systemTop,
      chrome,
      middleH,
      viewportW: screenW - chrome.left - chrome.inset,
      viewportH: middleH - chrome.inset * 2,
      ...body,
      outerW: screenW + body.pad.left + body.pad.right,
      outerH: screenH + body.pad.top + body.pad.bottom,
    };
  };

  const frameConfig = (card) => {
    const { device, browser } = card;
    const landscape = !isDesktop(device) && card.entry.landscape;
    return {
      desktop: isDesktop(device),
      ua: userAgentFor(device, browser),
      os: device.os,
      browser,
      tablet: device.type === "tablet",
      model: device.model,
      dpr: device.dpr,
      w: landscape ? device.height : device.width,
      h: landscape ? device.width : device.height,
    };
  };

  // --- persistence ------------------------------------------------------------
  const save = () => {
    if (RENDER) return;
    chrome.storage.local.set({ [storageKey]: settings }).catch(() => {});
  };

  const normalizeEntry = (entry) => {
    const device = deviceById.get(entry.id);
    if (device == null) return null;
    return { id: device.id, browser: resolveBrowser(device, entry.browser), landscape: Boolean(entry.landscape) };
  };

  const loadSettings = async () => {
    if (RENDER) {
      return { devices: RENDER.devices.map(normalizeEntry).filter((entry) => entry != null), zoom: "1", frame: RENDER.frame !== false, syncNav: false };
    }
    const stored = await chrome.storage.local.get([storageKey, "defaults"]);
    const defaults = { ...DEFAULTS, ...stored.defaults };
    const hostSettings = stored[storageKey] ?? {
      devices: defaults.devices.map((id) => ({ id })),
      zoom: defaults.zoom,
      frame: defaults.frame,
      syncNav: defaults.syncNav,
    };
    hostSettings.devices = hostSettings.devices.map(normalizeEntry).filter((entry) => entry != null);
    if (hostSettings.devices.length === 0) hostSettings.devices = [normalizeEntry({ id: DEVICES[0].id })];
    return hostSettings;
  };

  // --- toolbar ----------------------------------------------------------------
  const urlInput = h("input", {
    class: "mf-url",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    onkeydown: (event) => {
      if (event.key === "Enter") navigateFromInput(urlInput.value);
      if (event.key === "Escape") {
        urlInput.value = activeCard?.href ?? currentUrl;
        urlInput.blur();
      }
    },
    onfocus: () => urlInput.select(),
  });

  const toggleButton = (iconPaths, label, getValue, onToggle) => {
    const button = h("button", { class: "mf-btn mf-btn-toggle", title: label }, icon(iconPaths, { size: 16 }), h("span", { text: label }));
    const refresh = () => button.setAttribute("aria-pressed", String(getValue()));
    button.addEventListener("click", () => {
      onToggle();
      refresh();
    });
    return { button, refresh };
  };

  const syncToggle = toggleButton(ICONS.sync, "Sync", () => settings.syncNav, () => {
    settings.syncNav = !settings.syncNav;
    save();
  });
  const frameToggle = toggleButton(ICONS.frame, "Frame", () => settings.frame, () => {
    settings.frame = !settings.frame;
    save();
    applyFrameMode();
  });

  const zoomSelect = h(
    "select",
    {
      class: "mf-select",
      title: "Zoom",
      onchange: () => {
        settings.zoom = zoomSelect.value;
        save();
        layout();
      },
    },
    ZOOM_OPTIONS.map(([value, label]) => h("option", { value, text: label })),
  );

  const addSelect = h(
    "select",
    {
      class: "mf-select mf-add",
      title: "Add a device",
      onchange: () => {
        if (addSelect.value === "") return;
        addDevice(normalizeEntry({ id: addSelect.value }));
        addSelect.value = "";
      },
    },
    h("option", { value: "", text: "+ Add device" }),
    deviceGroups(),
  );

  const toolbar = h(
    "header",
    { class: "mf-toolbar" },
    h("div", { class: "mf-brand" }, h("span", { class: "mf-brand-light", text: "view-" }), h("span", { class: "mf-brand-bold", text: "sim" })),
    h(
      "div",
      { class: "mf-nav" },
      h("button", { class: "mf-btn", title: "Back", onclick: () => historyStep(-1) }, icon(ICONS.back)),
      h("button", { class: "mf-btn", title: "Forward", onclick: () => historyStep(1) }, icon(ICONS.forward)),
      h("button", { class: "mf-btn", title: "Reload all devices", onclick: reloadAll }, icon(ICONS.reload)),
    ),
    urlInput,
    syncToggle.button,
    frameToggle.button,
    zoomSelect,
    addSelect,
    h(
      "button",
      { class: "mf-btn mf-btn-off", title: `Turn off the simulator on ${host}`, onclick: turnOff },
      icon(ICONS.power, { size: 16 }),
      h("span", { text: "Turn off" }),
    ),
  );

  const stageInner = h("div", { class: "mf-stage-inner" });
  const stage = h("main", { class: "mf-stage" }, stageInner);
  const toast = h("div", { class: "mf-toast", role: "status" });
  body.append(toolbar, stage, toast);

  function deviceGroups() {
    const groups = [
      ["iPhone & iPad", DEVICES.filter((device) => device.os === "ios")],
      ["Android", DEVICES.filter((device) => device.os === "android")],
      ["Mac & displays", DEVICES.filter(isDesktop)],
    ];
    return groups.map(([label, devices]) =>
      h("optgroup", { label }, devices.map((device) => h("option", { value: device.id, text: device.name }))),
    );
  }

  let toastTimer;
  function showToast(text, { error = false } = {}) {
    toast.textContent = text;
    toast.classList.toggle("is-error", error);
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), error ? 6000 : 2200);
  }

  // --- device cards -----------------------------------------------------------
  function buildCard(entry) {
    const device = deviceById.get(entry.id) ?? DEVICES[0];
    const card = { uid: nextUid++, entry, device, browser: resolveBrowser(device, entry.browser), href: currentUrl, title: "", loading: true };

    const deviceSelect = h(
      "select",
      {
        class: "mf-device-select",
        title: "Device",
        onchange: () => {
          entry.id = deviceSelect.value;
          entry.browser = resolveBrowser(deviceById.get(entry.id), entry.browser);
          save();
          replaceCard(card);
        },
      },
      deviceGroups(),
    );
    deviceSelect.value = device.id;

    const browserSelect = h(
      "select",
      {
        class: "mf-browser-select",
        title: "Browser",
        onchange: () => setCardBrowser(card, browserSelect.value),
      },
      browsersFor(device).map((browser) => h("option", { value: browser.id, text: browser.name })),
    );
    browserSelect.value = card.browser;
    card.browserSelect = browserSelect;

    card.dims = h("span", { class: "mf-dims" });
    card.iframe = createIframe(card, currentUrl);

    card.top = h("div", { class: "mf-top" });
    card.side = h("div", { class: "mf-side" });
    card.wrap = h("div", { class: "mf-wrap" }, card.iframe);
    card.middle = h("div", { class: "mf-middle" }, card.side, card.wrap);
    card.bottom = h("div", { class: "mf-bottom" });

    card.screen = h(
      "div",
      { class: "mf-screen" },
      card.top,
      card.middle,
      card.bottom,
      device.os === "ios" && device.cutout !== "classic" ? h("div", { class: "mf-home-indicator" }) : null,
      ["island", "notch", "punch", "macnotch"].includes(device.cutout) ? h("div", { class: `mf-cutout mf-cutout-${device.cutout}` }) : null,
    );

    card.body = h(
      "div",
      { class: "mf-device" },
      card.screen,
      device.cutout === "classic" ? [h("div", { class: "mf-speaker" }), h("div", { class: "mf-home-button" })] : null,
      buildStand(card),
      device.type === "monitor" ? h("div", { class: "mf-monitor-logo", text: "DELL" }) : null,
    );
    card.scaler = h("div", { class: "mf-scaler" }, card.body);

    const smallButton = (title, iconPaths, onclick) =>
      h("button", { class: "mf-btn mf-btn-small", title, onclick }, icon(iconPaths, { size: 15 }));

    card.element = h(
      "section",
      {
        class: `mf-card mf-os-${device.os} mf-type-${device.type}`,
        onpointerdown: () => setActive(card),
      },
      h(
        "div",
        { class: "mf-card-head" },
        deviceSelect,
        browserSelect,
        card.dims,
        h("span", { class: "mf-spacer" }),
        smallButton("Screenshot (⌥-click: page only)", ICONS.camera, (event) => {
          const mode = event.altKey ? "viewport" : settings.frame ? "device" : "screen";
          screenshotFromUi(card, mode);
        }),
        isDesktop(device) ? null : smallButton("Rotate", ICONS.rotate, () => rotateCard(card)),
        smallButton("Remove device", ICONS.close, () => removeCard(card)),
      ),
      card.scaler,
    );
    renderChrome(card);
    return card;
  }

  // window.name carries the device config into the frame and survives navigations, but it can't be
  // changed from outside once the frame exists; a new UA therefore needs a new iframe.
  function createIframe(card, src) {
    if (RENDER) {
      card.loading = false;
      return h("img", { class: "mf-iframe", alt: "" });
    }
    const iframe = h("iframe", {
      class: "mf-iframe",
      name: FRAME_NAME_PREFIX + JSON.stringify(frameConfig(card)),
      title: card.device.name,
      allow: "clipboard-read; clipboard-write; fullscreen; geolocation; camera; microphone",
    });
    iframe.addEventListener("load", () => {
      if (card.iframe === iframe) card.loading = false;
    });
    card.loading = true;
    iframe.src = src;
    return iframe;
  }

  function buildStand(card) {
    const { type } = card.device;
    if (type === "laptop") {
      card.stand = h("div", { class: "mf-laptop-base" });
    } else if (type === "imac" || type === "monitor") {
      card.stand = h("div", { class: "mf-stand" }, h("div", { class: "mf-stand-neck" }), h("div", { class: "mf-stand-foot" }));
    }
    return card.stand ?? null;
  }

  function addDevice(entry) {
    settings.devices.push(entry);
    save();
    const card = buildCard(entry);
    cards.push(card);
    stageInner.append(card.element);
    layout();
    return card;
  }

  function replaceCard(card) {
    const replacement = buildCard(card.entry);
    replacement.href = card.href;
    replacement.title = card.title;
    replacement.iframe.src = card.href;
    updateAddress(replacement);
    card.element.replaceWith(replacement.element);
    cards = cards.map((existing) => (existing === card ? replacement : existing));
    if (activeCard === card) {
      activeCard = replacement;
      replacement.element.classList.add("is-active");
    }
    layout();
  }

  function removeCard(card) {
    if (cards.length === 1) return;
    cards = cards.filter((existing) => existing !== card);
    settings.devices = settings.devices.filter((entry) => entry !== card.entry);
    save();
    card.element.remove();
    if (activeCard === card) setActive(cards[0]);
    layout();
  }

  function rebuildAllCards() {
    cards = settings.devices.map(buildCard);
    stageInner.replaceChildren(...cards.map((card) => card.element));
    activeCard = null;
    setActive(cards[0]);
    layout();
  }

  function rotateCard(card) {
    card.entry.landscape = !card.entry.landscape;
    save();
    renderChrome(card);
    layout();
    card.iframe.contentWindow?.postMessage({ __mfsim: true, type: "config", config: frameConfig(card) }, "*");
  }

  function setCardBrowser(card, browserId) {
    card.browser = resolveBrowser(card.device, browserId);
    card.entry.browser = card.browser;
    card.browserSelect.value = card.browser;
    save();
    renderChrome(card);
    card.iframe = createIframe(card, card.href);
    card.wrap.replaceChildren(card.iframe);
    layout();
  }

  function setActive(card) {
    if (card == null || card === activeCard) return;
    activeCard?.element.classList.remove("is-active");
    activeCard = card;
    card.element.classList.add("is-active");
    if (document.activeElement !== urlInput) urlInput.value = card.href;
  }

  // --- browser chrome ---------------------------------------------------------
  function renderChrome(card) {
    const { device, browser } = card;
    const landscape = !isDesktop(device) && card.entry.landscape;
    card.addressNodes = [];
    card.titleNodes = [];
    card.statusBar = null;
    card.top.replaceChildren();
    card.side.replaceChildren();
    card.bottom.replaceChildren();
    card.screen.dataset.browser = browser;
    if (!settings.frame) return;

    const insets = browserInsets(device, browser, landscape);
    const kit = chromeKit(card);
    if (isDesktop(device)) {
      card.top.append(menuBar(device, browser));
      if (browser === "zen") card.side.append(zenSidebar(kit));
      else card.top.append(desktopToolbar(browser, insets.top, kit));
      return;
    }
    if (!landscape || device.type === "tablet") {
      card.statusBar = mobileStatusBar(device);
      card.top.append(card.statusBar);
      applyThemeColor(card);
    }
    const bars = mobileBars(device, browser, landscape, insets, kit);
    if (bars.top) card.top.append(bars.top);
    if (bars.bottom) card.bottom.append(bars.bottom);
  }

  function chromeKit(card) {
    return {
      address: (extraClass = "") => {
        const element = h("span", { class: `mf-addr ${extraClass}`, text: displayAddress(card.href) });
        card.addressNodes.push(element);
        return element;
      },
      tabTitle: () => {
        const element = h("span", { class: "mf-tab-title", text: card.title || displayAddress(card.href) });
        card.titleNodes.push(element);
        return element;
      },
      glyph: (paths, size = 20, fill = false) => h("span", { class: "mf-glyph" }, icon(paths, { size, fill })),
      bar: (className, height, ...children) => h("div", { class: `mf-bar ${className}`, style: height == null ? null : `height: ${height}px` }, ...children),
      pill: (...children) => h("div", { class: "mf-pill" }, ...children),
      tabCount: () => h("span", { class: "mf-tabcount", text: "1" }),
      traffic: () => h("span", { class: "mf-traffic" }, h("i"), h("i"), h("i")),
    };
  }

  function mobileStatusBar(device) {
    return h(
      "div",
      { class: "mf-statusbar", style: `height: ${device.statusBar}px` },
      h("span", { class: "mf-time", text: device.os === "ios" ? "9:41" : "9:30" }),
      h(
        "span",
        { class: "mf-status-icons" },
        icon(ICONS.signal, { size: 15, fill: true }),
        icon(ICONS.wifi, { size: 15, fill: true }),
        icon(ICONS.battery, { size: 20, fill: true }),
      ),
    );
  }

  function mobileBars(device, browser, landscape, insets, kit) {
    const { address, glyph, bar, pill, tabCount } = kit;
    const lockPill = () => pill(glyph(browser === "firefox" ? ICONS.shield : ICONS.lock, 13), address());

    if (landscape && device.type === "phone") {
      return {
        top: bar(`mf-compact mf-b-${browser}`, insets.top, glyph(ICONS.back), glyph(ICONS.forward), lockPill(), glyph(ICONS.share), glyph(ICONS.tabs)),
      };
    }

    if (device.type === "tablet") {
      if (browser === "safari") {
        return {
          top: bar("mf-ipad-safari", insets.top, glyph(ICONS.sidebar), glyph(ICONS.back), glyph(ICONS.forward), pill(h("span", { class: "mf-aa", text: "AA" }), address(), glyph(ICONS.reload, 14)), glyph(ICONS.share), glyph(ICONS.plus), glyph(ICONS.tabs)),
        };
      }
      return {
        top: bar(`mf-compact mf-b-${browser}`, insets.top, glyph(ICONS.back), glyph(ICONS.forward), glyph(ICONS.reload), lockPill(), glyph(ICONS.plus), tabCount(), glyph(ICONS.dotsH)),
      };
    }

    if (device.os === "ios") {
      const homeArea = device.cutout === "classic" ? 0 : HOME_AREA;
      if (browser === "safari") {
        return {
          bottom: bar(
            "mf-ios-safari-bottom",
            insets.bottom,
            h("div", { class: "mf-pill-row" }, pill(h("span", { class: "mf-aa", text: "AA" }), address(), glyph(ICONS.reload, 15))),
            h("div", { class: "mf-tool-row", style: `margin-bottom: ${homeArea}px` }, glyph(ICONS.back, 22), glyph(ICONS.forward, 22), glyph(ICONS.share, 22), glyph(ICONS.book, 22), glyph(ICONS.tabs, 22)),
          ),
        };
      }
      const middleButton = browser === "chrome" ? glyph(ICONS.plus, 22) : glyph(ICONS.search, 22);
      return {
        top: bar(`mf-ios-top mf-b-${browser}`, insets.top, lockPill()),
        bottom: bar(
          `mf-ios-toolbar mf-b-${browser}`,
          insets.bottom,
          h("div", { class: "mf-tool-row", style: `margin-bottom: ${homeArea}px` }, glyph(ICONS.back, 22), glyph(ICONS.forward, 22), middleButton, tabCount(), glyph(browser === "chrome" ? ICONS.dotsH : ICONS.menu, 22)),
        ),
      };
    }

    const gesture = h("div", { class: "mf-gesture" }, h("i"));
    if (browser === "firefox") {
      return {
        bottom: bar("mf-android-firefox-bottom", insets.bottom, h("div", { class: "mf-tool-row mf-urlrow" }, glyph(ICONS.home), lockPill(), tabCount(), glyph(ICONS.dotsV)), gesture),
      };
    }
    return {
      top: bar("mf-android-chrome-top", insets.top, glyph(ICONS.home), pill(glyph(ICONS.tune, 14), address()), tabCount(), glyph(ICONS.dotsV)),
      bottom: bar("mf-android-nav", insets.bottom, gesture),
    };
  }

  function menuBar(device, browser) {
    const appName = { safari: "Safari", chrome: "Chrome", firefox: "Firefox", zen: "Zen" }[browser];
    const menus =
      browser === "chrome"
        ? ["File", "Edit", "View", "History", "Bookmarks", "Profiles", "Tab", "Window", "Help"]
        : browser === "safari"
          ? ["File", "Edit", "View", "History", "Bookmarks", "Window", "Help"]
          : ["File", "Edit", "View", "History", "Bookmarks", "Tools", "Window", "Help"];
    return h(
      "div",
      { class: "mf-menubar", style: `height: ${device.menuBar}px` },
      h("span", { class: "mf-menubar-dot" }),
      h("strong", { text: appName }),
      menus.map((label) => h("span", { text: label })),
      h("span", { class: "mf-spacer" }),
      icon(ICONS.wifi, { size: 14, fill: true }),
      icon(ICONS.battery, { size: 19, fill: true }),
      h("span", { text: "Tue 9:41" }),
    );
  }

  function desktopToolbar(browser, height, kit) {
    const { address, tabTitle, glyph, bar, pill, traffic } = kit;
    if (browser === "safari") {
      return bar(
        "mf-desk mf-desk-safari",
        height,
        traffic(),
        glyph(ICONS.sidebar, 17),
        glyph(ICONS.back, 17),
        glyph(ICONS.forward, 17),
        pill(address()),
        glyph(ICONS.share, 17),
        glyph(ICONS.plus, 17),
        glyph(ICONS.tabs, 17),
      );
    }
    const tab = h("span", { class: "mf-desk-tab" }, h("i", { class: "mf-favicon" }), tabTitle(), glyph(ICONS.close, 12));
    if (browser === "chrome") {
      return h(
        "div",
        { class: "mf-desk mf-desk-chrome", style: `height: ${height}px` },
        bar("mf-tabstrip", 36, traffic(), tab, glyph(ICONS.plus, 16)),
        bar("mf-navbar", 40, glyph(ICONS.back, 17), glyph(ICONS.forward, 17), glyph(ICONS.reload, 16), pill(glyph(ICONS.tune, 14), address()), glyph(ICONS.star, 16), h("i", { class: "mf-avatar" }), glyph(ICONS.dotsV, 17)),
      );
    }
    return h(
      "div",
      { class: "mf-desk mf-desk-firefox", style: `height: ${height}px` },
      bar("mf-tabstrip", 38, traffic(), tab, glyph(ICONS.plus, 16)),
      bar("mf-navbar", 40, glyph(ICONS.back, 17), glyph(ICONS.forward, 17), glyph(ICONS.reload, 16), pill(glyph(ICONS.shield, 14), address()), glyph(ICONS.menu, 17)),
    );
  }

  function zenSidebar(kit) {
    const { address, tabTitle, glyph, pill, traffic } = kit;
    return h(
      "div",
      { class: "mf-zen" },
      h("div", { class: "mf-zen-row" }, traffic(), h("span", { class: "mf-spacer" }), glyph(ICONS.sidebar, 16), glyph(ICONS.back, 16), glyph(ICONS.forward, 16), glyph(ICONS.reload, 15)),
      pill(address()),
      h("div", { class: "mf-zen-essentials" }, h("i"), h("i"), h("i")),
      h("div", { class: "mf-zen-label", text: "Tabs" }),
      h("div", { class: "mf-zen-tab is-active" }, h("i", { class: "mf-favicon" }), tabTitle()),
      h("div", { class: "mf-zen-tab" }, glyph(ICONS.plus, 14), h("span", { class: "mf-tab-title", text: "New Tab" })),
      h("span", { class: "mf-spacer" }),
      h("div", { class: "mf-zen-workspaces" }, h("i", { class: "is-active" }), h("i"), h("i")),
    );
  }

  function updateAddress(card) {
    for (const node of card.addressNodes ?? []) node.textContent = displayAddress(card.href);
    for (const node of card.titleNodes ?? []) node.textContent = card.title || displayAddress(card.href);
  }

  function displayAddress(href) {
    try {
      return new URL(href).host;
    } catch {
      return href;
    }
  }

  // --- layout -------------------------------------------------------------------
  function frameRadii(device, framed, bezel) {
    if (!framed) return { screen: "0", body: "0" };
    if (device.type === "laptop") return { screen: "10px 10px 0 0", body: "22px 22px 8px 8px" };
    if (device.type === "imac") return { screen: "0", body: "22px" };
    if (device.type === "monitor") return { screen: "0", body: "8px" };
    if (device.cutout === "classic") return { screen: `${device.radius}px`, body: "54px" };
    return { screen: `${device.radius}px`, body: `${device.radius + bezel}px` };
  }

  function computeScale(measured) {
    const fit = (entries, availableW, availableH) => {
      const tallest = Math.max(...entries.map(({ metrics: m }) => m.outerH + m.standHeight));
      const widest = Math.max(...entries.map(({ metrics: m }) => m.outerW + m.overhangX * 2));
      return Math.min(1, Math.max(0.1, Math.min(availableH / tallest, availableW / widest)));
    };
    if (captureState) {
      const target = measured.filter(({ card }) => card === captureState.card);
      return fit(target, window.innerWidth - 48, window.innerHeight - 48);
    }
    const scale = Number(settings.zoom);
    if (settings.zoom !== "fit" && Number.isFinite(scale)) return scale;
    return fit(measured, stage.clientWidth - 64, stage.clientHeight - 64 - 44);
  }

  function layout() {
    if (cards.length === 0) return;
    const measured = cards.map((card) => ({ card, metrics: metrics(card) }));
    const scale = computeScale(measured);
    for (const { card, metrics: m } of measured) layoutCard(card, m, scale);
  }

  function layoutCard(card, m, scale) {
    const { device, entry } = card;
    const framed = settings.frame;
    card.scale = scale;
    card.element.classList.toggle("is-landscape", entry.landscape && !isDesktop(device));
    card.element.classList.toggle("is-framed", framed);
    card.dims.textContent = `${m.viewportW} × ${m.viewportH}`;

    card.top.style.height = `${m.systemTop + m.chrome.top}px`;
    card.bottom.style.height = `${m.chrome.bottom}px`;
    card.middle.style.height = `${m.middleH}px`;
    card.side.style.width = `${m.chrome.left}px`;
    card.side.hidden = m.chrome.left === 0;
    card.wrap.style.padding = m.chrome.inset ? `${m.chrome.inset}px ${m.chrome.inset}px ${m.chrome.inset}px 0` : "0";
    card.iframe.style.width = `${m.viewportW}px`;
    card.iframe.style.height = `${m.viewportH}px`;

    const radii = frameRadii(device, framed, m.pad.top);
    card.screen.style.borderRadius = radii.screen;
    Object.assign(card.body.style, {
      left: `${m.overhangX * scale}px`,
      width: `${m.outerW}px`,
      height: `${m.outerH}px`,
      padding: `${m.pad.top}px ${m.pad.right}px ${m.pad.bottom}px ${m.pad.left}px`,
      borderRadius: radii.body,
      transform: `scale(${scale})`,
    });
    card.body.style.setProperty("--mf-chin", `${m.chin}px`);
    if (card.stand) {
      Object.assign(card.stand.style, { height: `${m.standHeight}px`, left: `${-m.overhangX}px`, right: `${-m.overhangX}px` });
    }
    card.scaler.style.width = `${(m.outerW + m.overhangX * 2) * scale}px`;
    card.scaler.style.height = `${(m.outerH + m.standHeight) * scale}px`;
  }

  function applyFrameMode() {
    stage.classList.toggle("is-bare", !settings.frame);
    for (const card of cards) renderChrome(card);
    layout();
  }

  // --- screenshots ----------------------------------------------------------------
  // The background page captures the visible tab and crops it, so the card is shown alone and as
  // large as the window allows while that happens.
  async function prepareCapture(card, mode) {
    for (let waited = 0; window.innerWidth === 0 && waited < 3000; waited += 100) await sleep(100);
    if (window.innerWidth === 0) throw new Error("The simulator tab has no size on screen. Make sure its browser window is visible.");
    captureState = { card, mode };
    body.classList.add("mf-capturing");
    body.classList.toggle("mf-capture-screen", mode === "screen");
    body.classList.remove("mf-capture-white");
    for (const other of cards) other.element.classList.toggle("is-capture-target", other === card);
    layout();
    await waitForPaint();
    const element = { device: settings.frame ? card.scaler : card.screen, screen: card.screen, viewport: card.iframe }[mode] ?? card.scaler;
    const rect = element.getBoundingClientRect();
    // The bezel's outline rings sit just outside the device box.
    const margin = element === card.scaler ? 4 * card.scale : 0;
    return {
      rect: { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 },
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
      layoutScale: card.scale,
    };
  }

  function endCapture() {
    captureState = null;
    body.classList.remove("mf-capturing", "mf-capture-screen", "mf-capture-white");
    for (const card of cards) card.element.classList.remove("is-capture-target");
    layout();
  }

  function waitForPaint() {
    // rAF never fires in a background tab, so the timeout keeps this from hanging.
    const frames = new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Promise.race([frames, sleep(400)]).then(() => sleep(120));
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function screenshotFromUi(card, mode) {
    const response = await chrome.runtime.sendMessage({ type: "captureCard", index: cards.indexOf(card), mode }).catch((error) => ({ ok: false, error: String(error) }));
    if (!response?.ok) {
      showToast(`Screenshot failed: ${response?.error ?? "unknown error"}`, { error: true });
      return;
    }
    const { image } = response;
    const bytes = Uint8Array.from(atob(image.data), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const link = h("a", { href: url, download: `${host}-${card.device.id}-${card.browser}-${mode}-${stamp}.png` });
    body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showToast(`Saved ${image.width} × ${image.height} screenshot`);
  }

  // --- navigation ---------------------------------------------------------------
  function navigateCard(card, href) {
    card.href = href;
    card.loading = true;
    updateAddress(card);
    try {
      card.iframe.contentWindow.location.href = href;
    } catch {
      card.iframe.src = href;
    }
  }

  function resolveInput(value) {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    try {
      const looksAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
      const looksLikeHost = !looksAbsolute && !trimmed.startsWith("/") && /^[^\s/]+\.[^\s/]+/.test(trimmed);
      return new URL(looksLikeHost ? `https://${trimmed}` : trimmed, activeCard?.href ?? currentUrl);
    } catch {
      return null;
    }
  }

  function navigateFromInput(value) {
    const target = resolveInput(value);
    if (target == null) return { navigated: false };
    urlInput.blur();
    if (target.hostname !== host) {
      // Another site: leave the simulator (it starts there too if that host is enabled).
      location.href = target.href;
      return { navigated: true, leftSimulator: true, url: target.href };
    }
    currentUrl = target.href;
    const targets = settings.syncNav ? cards : [activeCard];
    for (const card of targets) navigateCard(card, target.href);
    reflectTopUrl(target.href);
    return { navigated: true, url: target.href };
  }

  function historyStep(delta) {
    const targets = settings.syncNav ? cards : [activeCard];
    for (const card of targets) {
      try {
        card.iframe.contentWindow.history.go(delta);
      } catch {}
    }
  }

  function reloadAll() {
    for (const card of cards) {
      card.loading = true;
      try {
        card.iframe.contentWindow.location.reload();
      } catch {
        card.iframe.src = card.href;
      }
    }
  }

  function reflectTopUrl(href) {
    try {
      const url = new URL(href);
      if (url.origin === location.origin && url.href !== location.href) history.replaceState(null, "", url.href);
    } catch {}
  }

  function turnOff() {
    chrome.runtime.sendMessage({ type: "setEnabled", host, enabled: false });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.__mfsim !== true || message.type !== "nav") return;
    const card = cards.find((candidate) => candidate.iframe.contentWindow === event.source);
    if (card == null) return;

    card.href = message.href;
    card.title = message.title ?? "";
    card.themeColor = isDesktop(card.device) ? null : message.themeColor;
    updateAddress(card);
    applyThemeColor(card);
    if (card === activeCard) {
      if (document.activeElement !== urlInput) urlInput.value = message.href;
      if (message.title) document.title = `${message.title} — view-sim`;
    }

    // replaceState and late "load" reports only update the address; they never move other devices.
    if (message.kind === "replace") {
      if (card === activeCard) reflectTopUrl(message.href);
      return;
    }
    const changed = message.href !== currentUrl;
    currentUrl = message.href;
    reflectTopUrl(message.href);
    if (!changed || !settings.syncNav) return;
    setActive(card);
    for (const other of cards) {
      if (other !== card && other.href !== message.href) navigateCard(other, message.href);
    }
  });

  // Clicks inside an iframe never reach the top document; the window blurring is the only signal.
  window.addEventListener("blur", () => {
    setTimeout(() => {
      const focusedCard = cards.find((card) => card.iframe === document.activeElement);
      if (focusedCard) setActive(focusedCard);
    }, 0);
  });

  function applyThemeColor(card) {
    const statusBar = card.statusBar;
    if (statusBar == null) return;
    if (!card.themeColor) {
      statusBar.style.removeProperty("background");
      statusBar.style.removeProperty("color");
      return;
    }
    statusBar.style.background = card.themeColor;
    statusBar.style.color = isDark(card.themeColor) ? "#fff" : "#000";
  }

  function isDark(color) {
    const probe = h("span");
    probe.style.color = color;
    body.append(probe);
    const match = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
    probe.remove();
    if (match == null) return false;
    const [red, green, blue] = match.map(Number);
    return 0.299 * red + 0.587 * green + 0.114 * blue < 140;
  }

  window.addEventListener("resize", () => {
    if (captureState == null) layout();
  });

  // --- commands from the background page (toolbar screenshots and the MCP bridge) ---
  function describeState() {
    return {
      host,
      url: currentUrl,
      zoom: settings.zoom,
      frame: settings.frame,
      syncNav: settings.syncNav,
      devices: cards.map((card, index) => {
        const m = metrics(card);
        return {
          index,
          id: card.device.id,
          name: card.device.name,
          browser: card.browser,
          landscape: !isDesktop(card.device) && card.entry.landscape,
          url: card.href,
          title: card.title,
          loading: card.loading,
          viewport: { width: m.viewportW, height: m.viewportH },
          screen: { width: m.screenW, height: m.screenH },
          outer: { width: m.outerW + m.overhangX * 2, height: m.outerH + m.standHeight },
          dpr: card.device.dpr,
          os: card.device.os,
          type: card.device.type,
          userAgent: userAgentFor(card.device, card.browser),
          active: card === activeCard,
        };
      }),
    };
  }

  function applySettings(patch) {
    if (patch.devices != null) {
      const entries = patch.devices.map(normalizeEntry).filter((entry) => entry != null);
      if (entries.length === 0) throw new Error("No known device ids in devices");
      settings.devices = entries;
    }
    if (patch.zoom != null) settings.zoom = String(patch.zoom);
    if (patch.frame != null) settings.frame = Boolean(patch.frame);
    if (patch.syncNav != null) settings.syncNav = Boolean(patch.syncNav);
    save();
    zoomSelect.value = settings.zoom;
    syncToggle.refresh();
    frameToggle.refresh();
    stage.classList.toggle("is-bare", !settings.frame);
    if (patch.devices != null) rebuildAllCards();
    else applyFrameMode();
  }

  function findCard(selector) {
    if (selector == null) return activeCard ?? cards[0];
    const byIndex = typeof selector === "number" ? cards[selector] : null;
    const card = byIndex ?? cards.find((candidate) => candidate.device.id === selector);
    if (card == null) throw new Error(`No device ${JSON.stringify(selector)} on this page`);
    return card;
  }

  async function handleCommand(message) {
    switch (message.type) {
      case "mfsim:getState":
        return describeState();
      case "mfsim:apply":
        applySettings(message.settings ?? {});
        return describeState();
      case "mfsim:setBrowser":
        setCardBrowser(findCard(message.device), message.browser);
        return describeState();
      case "mfsim:navigate":
        return navigateFromInput(message.url);
      case "mfsim:prepareCapture":
        return prepareCapture(findCard(message.index), message.mode ?? "device");
      case "mfsim:setCaptureBackground":
        body.classList.toggle("mf-capture-white", message.color === "white");
        await waitForPaint();
        return true;
      case "mfsim:endCapture":
        endCapture();
        return true;
      default:
        throw new Error(`Unknown command ${message.type}`);
    }
  }

  const booted = loadSettings().then((loaded) => {
    settings = loaded;
    zoomSelect.value = String(settings.zoom);
    syncToggle.refresh();
    frameToggle.refresh();
    urlInput.value = currentUrl;
    stage.classList.toggle("is-bare", !settings.frame);
    rebuildAllCards();
    if (RENDER) startRenderMode();
  });

  function startRenderMode() {
    body.classList.add("mf-capturing", "mf-render");
    body.classList.toggle("mf-capture-screen", RENDER.mode === "screen");
    cards[0].element.classList.add("is-capture-target");
    window.__mfsimRender = {
      state: () => {
        layout();
        return describeState();
      },
      setPage: (index, page) => {
        const card = cards[index];
        card.href = page.url ?? card.href;
        card.title = page.title ?? "";
        card.themeColor = isDesktop(card.device) ? null : page.themeColor;
        updateAddress(card);
        applyThemeColor(card);
        return new Promise((resolve, reject) => {
          card.iframe.onload = resolve;
          card.iframe.onerror = () => reject(new Error("Could not load the page screenshot"));
          card.iframe.src = page.src;
        });
      },
      rect: (index, mode) => {
        const card = cards[index];
        const element = { device: settings.frame ? card.scaler : card.screen, screen: card.screen, viewport: card.iframe }[mode] ?? card.scaler;
        const rect = element.getBoundingClientRect();
        const margin = element === card.scaler ? 4 : 0;
        return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
      },
    };
  }

  // Firefox stops an idle background page after 30s and doesn't count WebSocket traffic as activity,
  // which would drop the MCP bridge mid-command. Port messages do count, so an open simulator tab
  // keeps it alive; reconnecting after a stop also wakes it up again.
  const keepBackgroundAlive = () => {
    let port;
    try {
      port = chrome.runtime.connect({ name: "mfsim-keepalive" });
    } catch {
      return;
    }
    const timer = setInterval(() => port.postMessage({ type: "ping" }), 20_000);
    port.onDisconnect.addListener(() => {
      clearInterval(timer);
      setTimeout(keepBackgroundAlive, 1000);
    });
  };
  if (!RENDER) keepBackgroundAlive();

  if (!RENDER) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message?.type !== "string" || !message.type.startsWith("mfsim:")) return false;
    booted
      .then(() => handleCommand(message))
      .then(
        (result) => sendResponse({ ok: true, result }),
        (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
      );
    return true;
  });
})();
