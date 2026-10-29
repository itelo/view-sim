// Chrome runs this as a service worker; Firefox runs it as an event page with devices.js listed first.
if (typeof importScripts === "function" && self.MFSIM_DEVICES == null) importScripts("shared/devices.js");

const TOP_SCRIPT_ID = "mfsim-top";
const FRAME_SCRIPT_ID = "mfsim-frame";
const DEVICES = self.MFSIM_DEVICES;
const BROWSERS = self.MFSIM_BROWSERS;
const DEFAULTS = self.MFSIM_DEFAULTS;
const userAgentFor = self.MFSIM_userAgentFor;
const resolveBrowser = self.MFSIM_resolveBrowser;

// --- registration -------------------------------------------------------------
// registerContentScripts throws on duplicate ids, so syncs must never overlap.
let syncQueue = Promise.resolve();
const queue = (task) => {
  syncQueue = syncQueue.then(task, task);
  return syncQueue;
};

chrome.runtime.onInstalled.addListener(async () => {
  const { defaults } = await chrome.storage.local.get("defaults");
  await chrome.storage.local.set({ defaults: { ...DEFAULTS, ...defaults } });
  await chrome.action.setBadgeBackgroundColor({ color: "#3d8ef7" });
  await queue(syncScripts);
  await queue(syncRules);
});

chrome.runtime.onStartup.addListener(() => {
  queue(syncScripts);
  queue(syncRules);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const keys = Object.keys(changes);
  if (keys.includes("enabledHosts")) queue(syncScripts);
  if (keys.includes("enabledHosts") || keys.some((key) => key.startsWith("host:"))) queue(syncRules);
  if (keys.includes("defaults")) connectBridge();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url != null || changeInfo.status === "loading") updateBadge(tabId, tab.url);
});

// The popup asks for access to a site, then turns it on. When the browser closes the popup while its
// permission prompt is showing, the grant arrives here instead and the site is turned on from here.
let pendingEnable = null;
let autoEnabledHost = null;
chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  const pending = pendingEnable;
  if (pending == null || !origins.includes(`*://${pending.host}/*`)) return;
  pendingEnable = null;
  autoEnabledHost = pending.host;
  setEnabled(pending.host, true)
    .then(() => pending.tabId != null && chrome.tabs.reload(pending.tabId))
    .catch(() => {});
});

async function getEnabledHosts() {
  const { enabledHosts = [] } = await chrome.storage.local.get("enabledHosts");
  return enabledHosts;
}

async function setEnabled(host, enabled) {
  const enabledHosts = await getEnabledHosts();
  const next = enabled ? [...new Set([...enabledHosts, host])] : enabledHosts.filter((h) => h !== host);
  await chrome.storage.local.set({ enabledHosts: next });
  await queue(syncScripts);
  await queue(syncRules);
}

async function syncScripts() {
  const enabledHosts = await getEnabledHosts();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [TOP_SCRIPT_ID, FRAME_SCRIPT_ID] });
  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
  }
  if (enabledHosts.length > 0) {
    // Match patterns without a port match every port, so localhost:3000 is covered by *://localhost/*.
    const matches = enabledHosts.map((host) => `*://${host}/*`);
    await chrome.scripting.registerContentScripts([
      {
        id: TOP_SCRIPT_ID,
        matches,
        js: ["shared/devices.js", "simulator/simulator.js"],
        css: ["simulator/simulator.css"],
        runAt: "document_start",
        allFrames: false,
        persistAcrossSessions: true,
      },
      {
        id: FRAME_SCRIPT_ID,
        matches,
        js: ["frame/frame-main.js"],
        runAt: "document_start",
        allFrames: true,
        world: "MAIN",
        persistAcrossSessions: true,
      },
    ]);
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) updateBadge(tab.id, tab.url, enabledHosts);
}

async function syncRules() {
  const stored = await chrome.storage.local.get(null);
  const enabledHosts = stored.enabledHosts ?? [];
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: enabledHosts.map((host, index) => frameHeaderRule(index + 1, host, stored[`host:${host}`])),
  });
}

// Only sub-frames that the simulated host itself loads are touched: they get the mobile UA
// (server-side detection) and lose the headers that would refuse to render inside our frames.
function frameHeaderRule(id, host, hostSettings) {
  const firstEntry = hostSettings?.devices?.[0] ?? { id: DEFAULTS.devices[0] };
  const device = DEVICES.find((candidate) => candidate.id === firstEntry.id) ?? DEVICES[0];
  const browser = resolveBrowser(device, firstEntry.browser);
  const userAgent = userAgentFor(device, browser);
  const responseHeaders = [
    { header: "x-frame-options", operation: "remove" },
    { header: "content-security-policy", operation: "remove" },
  ];
  const condition = { requestDomains: [host], initiatorDomains: [host], resourceTypes: ["sub_frame"] };
  if (userAgent == null) {
    return { id, priority: 1, action: { type: "modifyHeaders", responseHeaders }, condition };
  }

  const sendsClientHints = device.os === "android" && browser === "chrome";
  const clientHintHeaders = sendsClientHints
    ? [
        { header: "sec-ch-ua-mobile", operation: "set", value: "?1" },
        { header: "sec-ch-ua-platform", operation: "set", value: '"Android"' },
      ]
    : [
        { header: "sec-ch-ua", operation: "remove" },
        { header: "sec-ch-ua-mobile", operation: "remove" },
        { header: "sec-ch-ua-platform", operation: "remove" },
      ];

  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "user-agent", operation: "set", value: userAgent }, ...clientHintHeaders],
      responseHeaders,
    },
    condition,
  };
}

async function updateBadge(tabId, url, knownHosts) {
  if (tabId == null) return;
  const enabledHosts = knownHosts ?? (await getEnabledHosts());
  const isOn = hostOf(url) != null && enabledHosts.includes(hostOf(url));
  chrome.action.setBadgeText({ tabId, text: isOn ? "ON" : "" }).catch(() => {});
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : null;
  } catch {
    return null;
  }
}

// --- messages from the popup, options page and simulator ----------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pendingEnable") {
    pendingEnable = { host: message.host, tabId: message.tabId };
    autoEnabledHost = null;
    return false;
  }
  if (message?.type === "setEnabled") {
    const tabId = message.tabId ?? sender.tab?.id;
    if (message.enabled && pendingEnable?.host === message.host) pendingEnable = null;
    else if (message.enabled && autoEnabledHost === message.host) {
      // permissions.onAdded already turned it on and reloaded the tab.
      autoEnabledHost = null;
      sendResponse({ ok: true });
      return false;
    }
    setEnabled(message.host, message.enabled)
      .then(async () => {
        if (tabId != null) await chrome.tabs.reload(tabId);
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "captureCard" && sender.tab?.id != null) {
    captureCard(sender.tab.id, message.index, message.mode, { maxWidth: Infinity })
      .then((image) => sendResponse({ ok: true, image }))
      .catch((error) => {
        // The camera button was clicked, so show the settings page where access can be granted.
        if (error?.needsAllSites) chrome.runtime.openOptionsPage();
        sendResponse({ ok: false, error: String(error?.message ?? error) });
      });
    return true;
  }
  if (message?.type === "bridgeStatus") {
    sendResponse({ connected: bridgeSocket?.readyState === WebSocket.OPEN });
    return false;
  }
  return false;
});

async function sendToTab(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (response == null) throw new Error("The simulator in that tab did not answer");
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

// --- screenshots -------------------------------------------------------------------
// A tab capture has no alpha channel. For "device" and "screen" captures the simulator puts the
// device on black, then on white; a pixel that is the same on both is opaque, and how far it moves
// between them is how transparent it is. That keeps rounded corners and anti-aliased edges clean.
const MAX_CAPTURE_WIDTH = 8192;
let lastCaptureAt = 0;

async function captureCard(tabId, device, mode = "device", { maxWidth = Infinity } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const prepared = await sendToTab(tabId, { type: "mfsim:prepareCapture", index: device, mode });
  try {
    const onBlack = await grabCanvas(tab, prepared, maxWidth);
    let result = onBlack;
    if (mode !== "viewport") {
      await sendToTab(tabId, { type: "mfsim:setCaptureBackground", color: "white" });
      const onWhite = await grabCanvas(tab, prepared, maxWidth);
      result = matte(onBlack, onWhite);
    }
    const blob = await result.convertToBlob({ type: "image/png" });
    return { mimeType: "image/png", data: arrayBufferToBase64(await blob.arrayBuffer()), width: result.width, height: result.height };
  } finally {
    await sendToTab(tabId, { type: "mfsim:endCapture" }).catch(() => {});
  }
}

async function grabCanvas(tab, prepared, maxWidth) {
  // Chrome's captureVisibleTab and Firefox's captureTab both need access to all websites (or a
  // fresh activeTab grant, which a click inside the page doesn't give), not just this site.
  if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) {
    throw Object.assign(
      new Error("Screenshots need access to all websites. Open view-sim's settings and click \"Allow access to all websites\"."),
      { needsAllSites: true },
    );
  }
  if (typeof globalThis.browser?.tabs?.captureTab === "function") return grabWithFirefox(tab.id, prepared, maxWidth);
  // captureVisibleTab is limited to two calls a second.
  const wait = lastCaptureAt + 600 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return cropToCanvas(await dataUrlToBitmap(dataUrl), prepared, maxWidth);
}

// Firefox renders the region itself, so it can draw the device at its natural size (2x) even when
// it is scaled down on screen.
async function grabWithFirefox(tabId, prepared, maxWidth) {
  const { rect, layoutScale } = prepared;
  const naturalWidth = (rect.width / layoutScale) * 2;
  const outputWidth = Math.min(naturalWidth, maxWidth, MAX_CAPTURE_WIDTH);
  const scale = Math.min(outputWidth / rect.width, 8);
  const bitmap = await dataUrlToBitmap(await globalThis.browser.tabs.captureTab(tabId, { format: "png", rect, scale }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
}

function cropToCanvas(bitmap, prepared, maxWidth) {
  const { rect, viewportWidth } = prepared;
  const ratio = bitmap.width / viewportWidth;
  const sourceX = Math.max(0, Math.round(rect.x * ratio));
  const sourceY = Math.max(0, Math.round(rect.y * ratio));
  const sourceW = Math.min(bitmap.width - sourceX, Math.round(rect.width * ratio));
  const sourceH = Math.min(bitmap.height - sourceY, Math.round(rect.height * ratio));
  const outputW = Math.round(Math.min(sourceW, maxWidth, MAX_CAPTURE_WIDTH));
  const outputH = Math.round(sourceH * (outputW / sourceW));
  const canvas = new OffscreenCanvas(outputW, outputH);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sourceX, sourceY, sourceW, sourceH, 0, 0, outputW, outputH);
  return canvas;
}

function matte(onBlack, onWhite) {
  const { width, height } = onBlack;
  const context = onBlack.getContext("2d");
  const blackImage = context.getImageData(0, 0, width, height);
  const black = blackImage.data;
  const white = onWhite.getContext("2d").getImageData(0, 0, width, height).data;
  for (let i = 0; i < black.length; i += 4) {
    const spread = (white[i] - black[i] + white[i + 1] - black[i + 1] + white[i + 2] - black[i + 2]) / 3;
    const alpha = Math.max(0, Math.min(255, 255 - spread));
    if (alpha > 0) {
      // On black, the captured colour is the true colour scaled by its alpha.
      black[i] = Math.min(255, (black[i] * 255) / alpha);
      black[i + 1] = Math.min(255, (black[i + 1] * 255) / alpha);
      black[i + 2] = Math.min(255, (black[i + 2] * 255) / alpha);
    }
    black[i + 3] = alpha;
  }
  context.putImageData(blackImage, 0, 0);
  return onBlack;
}

async function dataUrlToBitmap(dataUrl) {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

// --- MCP bridge ------------------------------------------------------------------
// The MCP server (mcp-server/) listens on localhost; the extension dials out to it, so nothing
// has to be registered with the browser. A closed socket is retried by an alarm, which also
// wakes the service worker / event page after the browser suspends it.
const BRIDGE_URL = "ws://127.0.0.1:47820";
const BRIDGE_ALARM = "mfsim-bridge";
let bridgeSocket = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "mfsim-keepalive") return;
  port.onMessage.addListener(() => connectBridge());
});

chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BRIDGE_ALARM) connectBridge();
});
connectBridge();

async function connectBridge() {
  const { defaults } = await chrome.storage.local.get("defaults");
  if (defaults?.bridge === false) {
    bridgeSocket?.close();
    return;
  }
  if (bridgeSocket != null && bridgeSocket.readyState <= WebSocket.OPEN) return;

  let socket;
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    return;
  }
  bridgeSocket = socket;
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({ type: "hello", extensionId: chrome.runtime.id, userAgent: navigator.userAgent, version: chrome.runtime.getManifest().version }),
    );
  });
  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (message.id == null) return;
    try {
      const result = await handleBridgeCommand(message.method, message.params ?? {});
      socket.send(JSON.stringify({ id: message.id, result }));
    } catch (error) {
      socket.send(JSON.stringify({ id: message.id, error: String(error?.message ?? error) }));
    }
  });
  socket.addEventListener("close", () => {
    if (bridgeSocket === socket) bridgeSocket = null;
  });
  socket.addEventListener("error", () => {});
}

async function handleBridgeCommand(method, params) {
  switch (method) {
    case "listDevices":
      return {
        devices: DEVICES.map(({ id, name, os, type, width, height, dpr }) => ({
          id,
          name,
          os,
          type,
          screen: { width, height },
          dpr,
          browsers: BROWSERS.filter((candidate) => candidate.platforms.includes(os)).map((candidate) => candidate.id),
        })),
        browsers: BROWSERS,
      };
    case "getState":
      return { tabs: await describeSimulatorTabs() };
    case "open":
      return openInSimulator(params);
    case "setDevices": {
      const tabId = await resolveTabId(params.tabId);
      await sendToTab(tabId, { type: "mfsim:apply", settings: { devices: normalizeDevices(params.devices) } });
      return waitForDevicesLoaded(tabId);
    }
    case "setOptions": {
      const tabId = await resolveTabId(params.tabId);
      const { zoom, frame, syncNav } = params;
      return sendToTab(tabId, { type: "mfsim:apply", settings: { zoom, frame, syncNav } });
    }
    case "navigate": {
      const tabId = await resolveTabId(params.tabId);
      const result = await sendToTab(tabId, { type: "mfsim:navigate", url: params.url });
      if (result.leftSimulator) return result;
      await sleep(300);
      return waitForDevicesLoaded(tabId);
    }
    case "screenshot":
      return screenshotForBridge(params);
    case "disable": {
      await setEnabled(params.host, false);
      return { host: params.host, enabled: false };
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

// Zen can withhold tab.url for the simulator's own tabs, so every tab is asked directly. Tabs on an
// enabled site that don't answer are listed too, since they only need a reload.
async function describeSimulatorTabs() {
  const enabledHosts = await getEnabledHosts();
  const tabs = await chrome.tabs.query({});
  const described = await Promise.all(
    tabs.map(async (tab) => {
      const base = { tabId: tab.id, windowId: tab.windowId, active: tab.active };
      try {
        const simulator = await sendToTab(tab.id, { type: "mfsim:getState" });
        return { ...base, url: simulator.url, simulator };
      } catch (error) {
        if (!enabledHosts.includes(hostOf(tab.url))) return null;
        return { ...base, url: tab.url, simulator: null, error: `${String(error?.message ?? error)} (reload the tab to start the simulator)` };
      }
    }),
  );
  return described.filter((tab) => tab != null);
}

// A tab on an enabled host that loaded before the site was turned on has no simulator in it,
// so only tabs whose simulator answers are candidates.
async function resolveTabId(tabId) {
  if (tabId != null) return tabId;
  const candidateTabs = await describeSimulatorTabs();
  const simulatorTabs = candidateTabs.filter((tab) => tab.simulator != null);
  if (simulatorTabs.length === 0) {
    const reasons = candidateTabs.map((tab) => `tab ${tab.tabId}: ${tab.error}`).join("; ");
    throw new Error(`No simulator tab is open. Use the open tool first.${reasons ? ` (${reasons})` : ""}`);
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return (simulatorTabs.find((tab) => tab.tabId === focused?.id) ?? simulatorTabs.find((tab) => tab.active) ?? simulatorTabs[0]).tabId;
}

function normalizeDevices(devices) {
  if (!Array.isArray(devices) || devices.length === 0) throw new Error("devices must be a non-empty list");
  return devices.map((entry) => {
    const id = typeof entry === "string" ? entry : entry.id;
    const device = DEVICES.find((candidate) => candidate.id === id);
    if (device == null) throw new Error(`Unknown device ${JSON.stringify(id)}. Known: ${DEVICES.map((d) => d.id).join(", ")}`);
    const browser = typeof entry === "string" ? undefined : entry.browser;
    if (browser != null && resolveBrowser(device, browser) !== browser) {
      throw new Error(`${browser} is not available on ${device.name}`);
    }
    return { id, browser: resolveBrowser(device, browser), landscape: typeof entry === "string" ? false : Boolean(entry.landscape) };
  });
}

async function openInSimulator({ url, devices, zoom, frame, syncNav, tabId }) {
  const host = hostOf(url);
  if (host == null) throw new Error("url must be an http(s) URL");
  const hasAccess = await chrome.permissions.contains({ origins: [`*://${host}/*`] });
  if (!hasAccess) {
    throw new Error(`The extension has no access to ${host}. Open the site once and turn the simulator on from the toolbar button (Firefox/Zen ask for access there).`);
  }

  const storageKey = `host:${host}`;
  const stored = await chrome.storage.local.get([storageKey, "defaults"]);
  const defaults = { ...DEFAULTS, ...stored.defaults };
  const hostSettings = stored[storageKey] ?? {
    devices: defaults.devices.map((id) => ({ id })),
    zoom: defaults.zoom,
    frame: defaults.frame,
    syncNav: defaults.syncNav,
  };
  if (devices != null) hostSettings.devices = normalizeDevices(devices);
  if (zoom != null) hostSettings.zoom = String(zoom);
  if (frame != null) hostSettings.frame = Boolean(frame);
  if (syncNav != null) hostSettings.syncNav = Boolean(syncNav);
  await chrome.storage.local.set({ [storageKey]: hostSettings });
  if (!(await getEnabledHosts()).includes(host)) await setEnabled(host, true);

  const tab = tabId != null ? await chrome.tabs.update(tabId, { url, active: true }) : await chrome.tabs.create({ url, active: true });
  await waitForSimulator(tab.id);
  return waitForDevicesLoaded(tab.id);
}

async function waitForSimulator(tabId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await sendToTab(tabId, { type: "mfsim:getState" });
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }
  throw new Error(`The simulator did not start in tab ${tabId}: ${lastError?.message ?? "timeout"}`);
}

async function waitForDevicesLoaded(tabId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await sendToTab(tabId, { type: "mfsim:getState" });
    if (state.devices.every((device) => !device.loading)) return { tabId, ...state };
    await sleep(300);
  }
  return { tabId, ...state, warning: "Some devices were still loading after 30s" };
}

async function screenshotForBridge({ tabId: requestedTabId, device, mode = "device", maxWidth = 1600 }) {
  const tabId = await resolveTabId(requestedTabId);
  const tab = await chrome.tabs.get(tabId);
  // Browsers only capture a tab that is on screen; Zen doesn't even lay out a tab whose window
  // has never been in front.
  const browserWindow = await chrome.windows.get(tab.windowId);
  if (!tab.active || !browserWindow.focused || browserWindow.state === "minimized") {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true, ...(browserWindow.state === "minimized" ? { state: "normal" } : {}) });
    await sleep(500);
  }
  const state = await waitForDevicesLoaded(tabId);
  const targets = device == null ? state.devices.map((entry) => entry.index) : [device];
  const images = [];
  for (const target of targets) {
    const image = await captureCard(tabId, target, mode, { maxWidth });
    const described = state.devices.find((entry) => entry.index === target || entry.id === target);
    images.push({ device: described?.id ?? target, name: described?.name, browser: described?.browser, ...image });
  }
  return { tabId, mode, images };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
