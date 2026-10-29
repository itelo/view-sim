#!/usr/bin/env node
// MCP server for the view-sim extension. MCP clients talk to it over stdio; the extension's
// background page dials in over a localhost WebSocket and executes the commands.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { closeHeadless, headlessScreenshot } from "./headless.mjs";

const PORT = Number(process.env.VIEW_SIM_PORT ?? 47820);
// The extension retries every 30s (an alarm), so a fresh server may wait up to that long.
const CONNECT_WAIT_MS = 35_000;
const CALL_TIMEOUT_MS = 120_000;
// stdout carries the MCP protocol, so diagnostics go to stderr.
const log = (...parts) => console.error("[view-sim]", ...parts);
// Extension ids allowed to connect: Chrome's 32-letter id, or the add-on id in Firefox and Zen.
// Unset means any extension may connect, which is fine on a machine you trust.
const ALLOWED_EXTENSION_IDS = new Set(
  (process.env.VIEW_SIM_EXTENSION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
if (ALLOWED_EXTENSION_IDS.size === 0) {
  log("VIEW_SIM_EXTENSION_IDS is not set, so any browser extension may connect; set it to view-sim's extension id to allow only view-sim");
}
const isAllowedExtensionId = (id) => ALLOWED_EXTENSION_IDS.size === 0 || ALLOWED_EXTENSION_IDS.has(id);

// --- bridge to the extension ---------------------------------------------------
let extension = null;
let listenError = null;
let nextCallId = 1;
const pendingCalls = new Map();
const connectionWaiters = new Set();

function startBridge() {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    // Web pages can open localhost sockets too; only extension pages are let in. A Chrome origin
    // carries the extension id; Firefox's carries a random per-install UUID, so there the id is
    // checked from the hello message instead.
    verifyClient: ({ origin = "" }) => {
      const chromeId = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1];
      if (chromeId != null) return isAllowedExtensionId(chromeId);
      return /^moz-extension:\/\//.test(origin);
    },
  });
  server.on("listening", () => {
    listenError = null;
    log(`waiting for the extension on ws://127.0.0.1:${PORT}`);
  });
  server.on("error", (error) => {
    listenError = error;
    log(`cannot listen on ${PORT}: ${error.message}; retrying in 5s`);
    server.close();
    setTimeout(startBridge, 5000);
  });
  server.on("connection", (socket) => {
    // Every browser running the extension dials in every 30s. Taking over on each new connection
    // would make two browsers steal it from each other, so the first one keeps it until it closes.
    if (extension != null && extension.socket.readyState === extension.socket.OPEN) {
      socket.close(4000, "Another browser is already connected");
      return;
    }
    const connection = { socket, info: null };
    extension = connection;
    const keepAlive = setInterval(() => socket.send(JSON.stringify({ type: "ping" })), 20_000);
    // A socket that never says hello would otherwise hold the slot.
    const helloTimer = setTimeout(() => connection.info == null && socket.close(4001, "No hello"), 10_000);

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type === "hello") {
        if (!isAllowedExtensionId(message.extensionId)) {
          log(`refused extension ${JSON.stringify(message.extensionId)}: not in VIEW_SIM_EXTENSION_IDS`);
          socket.close(4003, "This extension is not allowed by VIEW_SIM_EXTENSION_IDS");
          return;
        }
        clearTimeout(helloTimer);
        connection.info = { userAgent: message.userAgent, version: message.version, extensionId: message.extensionId };
        log(`extension connected: ${message.userAgent}`);
        for (const resolve of connectionWaiters) resolve();
        connectionWaiters.clear();
        return;
      }
      const call = pendingCalls.get(message.id);
      if (call == null) return;
      pendingCalls.delete(message.id);
      clearTimeout(call.timer);
      if (message.error != null) call.reject(new Error(message.error));
      else call.resolve(message.result);
    });

    socket.on("close", () => {
      clearInterval(keepAlive);
      clearTimeout(helloTimer);
      if (extension === connection) extension = null;
      for (const [id, call] of pendingCalls) {
        if (call.socket !== socket) continue;
        pendingCalls.delete(id);
        clearTimeout(call.timer);
        call.reject(new Error("The extension disconnected before answering"));
      }
    });
  });
}

async function waitForExtension() {
  if (extension?.info != null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connectionWaiters.delete(done);
      const reason =
        listenError != null
          ? `port ${PORT} is unavailable (${listenError.code ?? listenError.message}); another view-sim MCP server is probably running`
          : "make sure the view-sim extension is loaded in a running browser and 'MCP bridge' is on in its settings";
      reject(new Error(`The view-sim extension is not connected: ${reason}.`));
    }, CONNECT_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    connectionWaiters.add(done);
  });
}

async function callExtension(method, params = {}) {
  await waitForExtension();
  const { socket } = extension;
  const id = nextCallId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(id, { resolve, reject, timer, socket });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

// --- MCP tools -----------------------------------------------------------------------
const asJson = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const BROWSER_IDS = ["safari", "chrome", "firefox", "zen"];
const tabIdInput = z
  .number()
  .int()
  .optional()
  .describe("Browser tab id from view_sim_status. Defaults to the focused simulator tab.");
const deviceEntryInput = z.union([
  z.string().describe("Device id, e.g. iphone-15-pro"),
  z.object({
    id: z.string().describe("Device id from view_sim_list_devices"),
    browser: z.enum(BROWSER_IDS).optional().describe("Browser UI and user agent to emulate. Defaults to Safari on Apple devices, Chrome on Android."),
    landscape: z.boolean().optional(),
  }),
]);
const optionsInput = {
  zoom: z.enum(["fit", "0.5", "0.75", "1"]).optional().describe("How large devices are drawn on screen"),
  frame: z.boolean().optional().describe("Draw device bezels, status bars and browser UI"),
  sync: z.boolean().optional().describe("Navigate every device when one of them navigates"),
};

const server = new McpServer({ name: "view-sim", version: "1.0.0" });

server.registerTool(
  "view_sim_status",
  {
    title: "Simulator status",
    description: "Whether the extension is connected, and every open simulator tab with its devices, URLs and viewport sizes.",
    inputSchema: {},
  },
  async () => {
    const state = await callExtension("getState");
    return asJson({ extension: extension?.info, ...state });
  },
);

server.registerTool(
  "view_sim_list_devices",
  {
    title: "List devices",
    description: "Every device the simulator can show (phones, tablets, Macs, displays) with screen size, pixel ratio and the browsers it supports.",
    inputSchema: {},
  },
  async () => asJson(await callExtension("listDevices")),
);

server.registerTool(
  "view_sim_open",
  {
    title: "Open a URL in the simulator",
    description:
      "Opens a URL in a new browser tab with the simulator on for its site, optionally choosing the devices. Waits until every device has loaded. The site must have been allowed once from the extension's toolbar button in Firefox/Zen.",
    inputSchema: {
      url: z.string().url(),
      devices: z.array(deviceEntryInput).optional().describe("Devices to show, left to right. Omit to keep the site's saved devices."),
      tab_id: tabIdInput.describe("Reuse this tab instead of opening a new one"),
      ...optionsInput,
    },
  },
  async ({ url, devices, tab_id, zoom, frame, sync }) =>
    asJson(await callExtension("open", { url, devices, tabId: tab_id, zoom, frame, syncNav: sync })),
);

server.registerTool(
  "view_sim_set_devices",
  {
    title: "Set devices",
    description: "Replaces the devices shown in a simulator tab and reloads them.",
    inputSchema: { devices: z.array(deviceEntryInput).min(1), tab_id: tabIdInput },
  },
  async ({ devices, tab_id }) => asJson(await callExtension("setDevices", { devices, tabId: tab_id })),
);

server.registerTool(
  "view_sim_navigate",
  {
    title: "Navigate",
    description: "Loads a URL (absolute, or a path like /pricing) in the simulator's devices and waits for them to load. A URL on another site leaves the simulator unless that site is on too.",
    inputSchema: { url: z.string(), tab_id: tabIdInput },
  },
  async ({ url, tab_id }) => asJson(await callExtension("navigate", { url, tabId: tab_id })),
);

server.registerTool(
  "view_sim_set_options",
  {
    title: "Set display options",
    description: "Changes zoom, frames and navigation sync for a simulator tab.",
    inputSchema: { ...optionsInput, tab_id: tabIdInput },
  },
  async ({ zoom, frame, sync, tab_id }) => asJson(await callExtension("setOptions", { zoom, frame, syncNav: sync, tabId: tab_id })),
);

server.registerTool(
  "view_sim_screenshot",
  {
    title: "Screenshot devices",
    description:
      "Screenshots one device, or every device in the extension's simulator tab (uses your real browser session, so signed-in pages work). mode 'device' includes the bezel and stand, 'screen' is the whole display with status bar and browser UI, 'viewport' is only the web page; 'device' and 'screen' have a transparent background. The tab is brought to the front while capturing. For screenshots without a browser window, use view_sim_headless_screenshot.",
    inputSchema: {
      device: z
        .union([z.number().int(), z.string()])
        .optional()
        .describe("Card index (0 = leftmost) or device id. Omit to capture every device."),
      mode: z.enum(["device", "screen", "viewport"]).optional().default("device"),
      max_width: z.number().int().min(200).max(8192).optional().default(1600).describe("Images wider than this are scaled down"),
      save_dir: z.string().optional().describe("Also write the PNGs to this directory and return their paths"),
      tab_id: tabIdInput,
    },
  },
  async ({ device, mode, max_width, save_dir, tab_id }) => {
    const result = await callExtension("screenshot", { device, mode, maxWidth: max_width, tabId: tab_id });
    const content = [];
    for (const image of result.images) {
      const savedPath = save_dir == null ? null : await savePng(save_dir, image, mode);
      const label = `${image.name ?? image.device} · ${image.browser} · ${mode} · ${image.width}×${image.height}`;
      content.push({ type: "text", text: savedPath == null ? label : `${label}\nsaved to ${savedPath}` });
      content.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    return { content };
  },
);

server.registerTool(
  "view_sim_headless_screenshot",
  {
    title: "Headless screenshot",
    description:
      "Screenshots a URL on simulated devices without any browser window or the extension, using Playwright with real device emulation (viewport, pixel ratio, touch, mobile mode, user agent). Safari devices render in WebKit, the others in Chromium. 'device' and 'screen' images have a transparent background. Pages behind a login need storage_state.",
    inputSchema: {
      url: z.string().url(),
      devices: z.array(deviceEntryInput).min(1).optional().default(["iphone-15-pro"]),
      mode: z.enum(["device", "screen", "viewport"]).optional().default("device").describe("device: with bezel and stand; screen: display with status and browser bars; viewport: the web page only"),
      frame: z.boolean().optional().default(true).describe("viewport mode only: false uses the whole screen as the page instead of leaving room for status and browser bars"),
      full_page: z.boolean().optional().default(false).describe("viewport mode only: capture the full scrollable page"),
      max_width: z.number().int().min(200).max(8192).optional().default(1600).describe("Images are rendered at most this wide (and at most at the device's pixel ratio)"),
      wait_ms: z.number().int().min(0).max(30_000).optional().default(800).describe("Extra time after load, for animations and late content"),
      engine: z.enum(["auto", "chromium", "webkit"]).optional().default("auto"),
      storage_state: z.string().optional().describe("Path to a Playwright storage-state JSON (cookies and localStorage) for signed-in pages"),
      save_dir: z.string().optional().describe("Also write the PNGs to this directory and return their paths"),
    },
  },
  async ({ url, devices, mode, frame, full_page, max_width, wait_ms, engine, storage_state, save_dir }) => {
    const content = [];
    for (const device of devices) {
      const image = await headlessScreenshot({
        url,
        device,
        mode,
        frame,
        fullPage: full_page,
        maxWidth: max_width,
        waitMs: wait_ms,
        engine,
        storageState: storage_state,
      });
      const savedPath = save_dir == null ? null : await savePng(save_dir, image, mode);
      const label = `${image.name} · ${image.browser} (${image.engine}) · ${mode} · ${image.width}×${image.height}`;
      content.push({ type: "text", text: savedPath == null ? label : `${label}\nsaved to ${savedPath}` });
      content.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    return { content };
  },
);

async function savePng(directory, image, mode) {
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const savedPath = path.resolve(directory, `${image.device}-${image.browser}-${mode}-${stamp}.png`);
  await writeFile(savedPath, Buffer.from(image.data, "base64"));
  return savedPath;
}

server.registerTool(
  "view_sim_turn_off",
  {
    title: "Turn the simulator off for a site",
    description: "Turns the simulator off for a hostname; its tabs show the normal page after a reload.",
    inputSchema: { host: z.string().describe("Hostname, e.g. localhost or example.com") },
  },
  async ({ host }) => asJson(await callExtension("disable", { host })),
);

startBridge();
await server.connect(new StdioServerTransport());
// Playwright's browsers are child processes; close them when the client goes away.
process.stdin.on("close", async () => {
  await closeHeadless();
  process.exit(0);
});
