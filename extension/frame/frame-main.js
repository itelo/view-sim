// Runs in the page's MAIN world at document_start inside every frame of an enabled host.
// It only acts in the simulator's own iframes, which carry their device config in window.name.
(() => {
  "use strict";
  if (window === window.top) return;
  if (window.parent !== window.top) return;

  const PREFIX = "__mfsim__";
  let config;
  try {
    if (!window.name.startsWith(PREFIX)) return;
    config = JSON.parse(window.name.slice(PREFIX.length));
  } catch {
    return;
  }

  const isIOS = () => config.os === "ios";
  const isLandscape = () => config.w > config.h;
  const defineGetter = (target, prop, get) => {
    try {
      Object.defineProperty(target, prop, { get, configurable: true, enumerable: true });
    } catch {}
  };

  // --- screen (every device) ----------------------------------------------
  const screenProto = Screen.prototype;
  defineGetter(screenProto, "width", () => config.w);
  defineGetter(screenProto, "height", () => config.h);
  defineGetter(screenProto, "availWidth", () => config.w);
  defineGetter(screenProto, "availHeight", () => config.h);
  defineGetter(window, "devicePixelRatio", () => config.dpr);
  defineGetter(window, "orientation", () => (isLandscape() ? 90 : 0));
  if (typeof ScreenOrientation !== "undefined") {
    defineGetter(ScreenOrientation.prototype, "type", () => (isLandscape() ? "landscape-primary" : "portrait-primary"));
    defineGetter(ScreenOrientation.prototype, "angle", () => (isLandscape() ? 90 : 0));
  }

  // --- mobile-only emulation: desktops keep the real browser's UA, input and scrollbars ---
  if (!config.desktop) {
    // --- navigator ----------------------------------------------------------
    const brands = [
      { brand: "Chromium", version: "124" },
      { brand: "Google Chrome", version: "124" },
      { brand: "Not-A.Brand", version: "99" },
    ];
    const androidUserAgentData = {
      brands,
      mobile: true,
      platform: "Android",
      getHighEntropyValues: async () => ({
        brands,
        mobile: true,
        platform: "Android",
        platformVersion: "14.0.0",
        model: config.model ?? "",
        architecture: "",
        bitness: "",
        uaFullVersion: "124.0.0.0",
        fullVersionList: brands.map((entry) => ({ ...entry, version: `${entry.version}.0.0.0` })),
      }),
      toJSON: () => ({ brands, mobile: true, platform: "Android" }),
    };

    const navigatorProto = Navigator.prototype;
    defineGetter(navigatorProto, "userAgent", () => config.ua);
    defineGetter(navigatorProto, "appVersion", () => config.ua.replace(/^Mozilla\//, ""));
    defineGetter(navigatorProto, "platform", () => {
      if (!isIOS()) return "Linux armv81";
      return config.tablet ? "iPad" : "iPhone";
    });
    // iOS browsers all run WebKit, so they all report Apple; Firefox on Android reports no vendor.
    defineGetter(navigatorProto, "vendor", () => {
      if (isIOS()) return "Apple Computer, Inc.";
      return config.browser === "firefox" ? "" : "Google Inc.";
    });
    defineGetter(navigatorProto, "maxTouchPoints", () => 5);
    defineGetter(navigatorProto, "userAgentData", () =>
      isIOS() || config.browser === "firefox" ? undefined : androidUserAgentData,
    );

    // `'ontouchstart' in window` is the classic touch-device check; make it true and keep the handlers working.
    const touchHandlers = new WeakMap();
    const defineTouchHandler = (target, type) => {
      const prop = `on${type}`;
      if (prop in target) return;
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: true,
        get() {
          return touchHandlers.get(this)?.get(type) ?? null;
        },
        set(handler) {
          const handlersForTarget = touchHandlers.get(this) ?? new Map();
          touchHandlers.set(this, handlersForTarget);
          const previous = handlersForTarget.get(type);
          if (previous) this.removeEventListener(type, previous);
          if (typeof handler === "function") {
            handlersForTarget.set(type, handler);
            this.addEventListener(type, handler);
          } else {
            handlersForTarget.delete(type);
          }
        },
      });
    };
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      for (const target of [window, Document.prototype, HTMLElement.prototype]) defineTouchHandler(target, type);
    }

    // JS media queries answer as a touch device would. CSS media queries can't be changed from here.
    const ALWAYS = "(min-width: 0px)";
    const NEVER = "(min-width: 99999999px)";
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = function matchMedia(query) {
      const rewritten = String(query)
        .replace(/\(\s*(any-)?pointer\s*:\s*coarse\s*\)/gi, ALWAYS)
        .replace(/\(\s*(any-)?pointer\s*:\s*fine\s*\)/gi, NEVER)
        .replace(/\(\s*(any-)?hover\s*:\s*none\s*\)/gi, ALWAYS)
        .replace(/\(\s*(any-)?hover\s*:\s*hover\s*\)/gi, NEVER);
      return originalMatchMedia.call(this, rewritten);
    };

    // --- look & feel ----------------------------------------------------------
    const touchCursor =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.9)" stroke-width="2"/></svg>',
      );
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        * { scrollbar-width: none !important; -webkit-tap-highlight-color: transparent; }
        *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        html, html * { cursor: url("${touchCursor}") 14 14, auto !important; }
      `);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {}

    // --- mouse → touch, plus drag-to-scroll ----------------------------------
    const TOUCH_ID = 1;
    const DRAG_THRESHOLD = 6;
    let gesture = null;

    const dispatchTouch = (type, mouseEvent, target) => {
      if (typeof Touch !== "function" || typeof TouchEvent !== "function") {
        return dispatchTouchLike(type, mouseEvent, target);
      }
      try {
        const touch = new Touch({
          identifier: TOUCH_ID,
          target,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY,
          screenX: mouseEvent.screenX,
          screenY: mouseEvent.screenY,
          pageX: mouseEvent.pageX,
          pageY: mouseEvent.pageY,
          radiusX: 11.5,
          radiusY: 11.5,
          rotationAngle: 0,
          force: 1,
        });
        const activeTouches = type === "touchend" ? [] : [touch];
        const touchEvent = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          touches: activeTouches,
          targetTouches: activeTouches,
          changedTouches: [touch],
        });
        return target.dispatchEvent(touchEvent);
      } catch {
        return true;
      }
    };

    // Firefox desktop has no Touch/TouchEvent constructors: send a plain event shaped like a TouchEvent.
    const dispatchTouchLike = (type, mouseEvent, target) => {
      const touch = {
        identifier: TOUCH_ID,
        target,
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
        screenX: mouseEvent.screenX,
        screenY: mouseEvent.screenY,
        pageX: mouseEvent.pageX,
        pageY: mouseEvent.pageY,
        radiusX: 11.5,
        radiusY: 11.5,
        rotationAngle: 0,
        force: 1,
      };
      const asTouchList = (list) => Object.assign([...list], { item: (index) => list[index] ?? null });
      const activeTouches = asTouchList(type === "touchend" ? [] : [touch]);
      const touchEvent = new UIEvent(type, { bubbles: true, cancelable: true, composed: true, view: window });
      for (const [prop, value] of [
        ["touches", activeTouches],
        ["targetTouches", activeTouches],
        ["changedTouches", asTouchList([touch])],
      ]) {
        Object.defineProperty(touchEvent, prop, { value, enumerable: true });
      }
      return target.dispatchEvent(touchEvent);
    };

    const isEditable = (element) =>
      element instanceof Element &&
      element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') != null;

    const findScroller = (element) => {
      for (let node = element; node instanceof Element; node = node.parentElement) {
        if (node === document.body || node === document.documentElement) break;
        const style = getComputedStyle(node);
        const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        const canScrollX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
        if (canScrollY || canScrollX) return node;
      }
      return document.scrollingElement ?? document.documentElement;
    };

    const suppressNextClick = () => {
      const swallowClick = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
    };

    const endGesture = (mouseEvent) => {
      if (gesture == null) return;
      dispatchTouch("touchend", mouseEvent, gesture.target);
      if (gesture.dragging) suppressNextClick();
      gesture = null;
    };

    window.addEventListener(
      "mousedown",
      (event) => {
        if (!event.isTrusted || event.button !== 0 || !(event.target instanceof Element)) return;
        const notPrevented = dispatchTouch("touchstart", event, event.target);
        gesture = {
          target: event.target,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          dragging: false,
          scrollBlocked: !notPrevented,
          scroller: findScroller(event.target),
        };
        // Mobile browsers don't start a text selection on press-and-drag.
        if (!isEditable(event.target)) event.preventDefault();
      },
      true,
    );

    window.addEventListener(
      "mousemove",
      (event) => {
        if (gesture == null || !event.isTrusted) return;
        if ((event.buttons & 1) === 0) {
          endGesture(event);
          return;
        }
        const notPrevented = dispatchTouch("touchmove", event, gesture.target);
        const deltaX = event.clientX - gesture.lastX;
        const deltaY = event.clientY - gesture.lastY;
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        if (!gesture.dragging) {
          gesture.dragging =
            Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > DRAG_THRESHOLD;
        }
        if (gesture.dragging && notPrevented && !gesture.scrollBlocked) {
          gesture.scroller.scrollBy(-deltaX, -deltaY);
        }
      },
      true,
    );

    window.addEventListener("mouseup", (event) => event.isTrusted && endGesture(event), true);
  }

  // --- talk to the simulator ------------------------------------------------
  const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
  const report = (kind) => {
    try {
      window.parent.postMessage(
        { __mfsim: true, type: "nav", kind, href: location.href, title: document.title, themeColor: themeColor() },
        "*",
      );
    } catch {}
  };

  document.addEventListener("DOMContentLoaded", () => report("load"), { once: true });
  window.addEventListener("load", () => report("replace"), { once: true });
  window.addEventListener("popstate", () => report("pop"));
  window.addEventListener("hashchange", () => report("hash"));
  for (const [method, kind] of [
    ["pushState", "push"],
    ["replaceState", "replace"],
  ]) {
    const original = History.prototype[method];
    History.prototype[method] = function (...args) {
      const result = original.apply(this, args);
      report(kind);
      return result;
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.__mfsim !== true || event.data.type !== "config") return;
    event.stopImmediatePropagation();
    config = { ...config, ...event.data.config };
    try {
      window.name = PREFIX + JSON.stringify(config);
    } catch {}
    window.dispatchEvent(new Event("orientationchange"));
  });
})();
