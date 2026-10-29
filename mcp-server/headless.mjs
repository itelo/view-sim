// Headless screenshots with Playwright: no browser window and no extension needed. The page is
// rendered with real device emulation (viewport, pixel ratio, touch, mobile mode, UA), then the
// extension's own simulator draws the device around it on a transparent page.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { chromium, webkit } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
// The npm package carries copies of the extension files in vendor/ (see scripts/vendor.mjs); in the
// repo they are read from extension/ directly.
const VENDOR_DIR = path.join(here, "vendor");
const vendored = existsSync(path.join(VENDOR_DIR, "render.html"));
const EXTENSION_DIR = vendored ? VENDOR_DIR : path.resolve(here, "../extension");
const RENDER_PAGE_URL = pathToFileURL(vendored ? path.join(VENDOR_DIR, "render.html") : path.join(here, "render/render.html")).href;
const SIMULATOR_CSS = path.join(EXTENSION_DIR, "simulator/simulator.css");

// devices.js is written for browsers (it assigns to `self`), so it runs in a small sandbox here.
const catalog = { self: {} };
vm.runInNewContext(readFileSync(path.join(EXTENSION_DIR, "shared/devices.js"), "utf8"), catalog);
const { MFSIM_DEVICES: DEVICES, MFSIM_resolveBrowser: resolveBrowser } = catalog.self;

// Playwright's default desktop UA says "HeadlessChrome", which some sites block.
const DESKTOP_USER_AGENTS = {
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
};
DESKTOP_USER_AGENTS.zen = DESKTOP_USER_AGENTS.firefox;

const launched = new Map();
function launch(engine) {
  if (!launched.has(engine)) {
    const browser = (engine === "webkit" ? webkit : chromium).launch();
    browser.catch(() => launched.delete(engine));
    launched.set(engine, browser);
  }
  return launched.get(engine);
}

export async function closeHeadless() {
  for (const browser of launched.values()) await (await browser.catch(() => null))?.close();
  launched.clear();
}

export function normalizeDeviceEntry(entry) {
  const id = typeof entry === "string" ? entry : entry.id;
  const device = DEVICES.find((candidate) => candidate.id === id);
  if (device == null) throw new Error(`Unknown device ${JSON.stringify(id)}. Known: ${DEVICES.map((d) => d.id).join(", ")}`);
  const requested = typeof entry === "string" ? undefined : entry.browser;
  const browser = resolveBrowser(device, requested);
  if (requested != null && requested !== browser) throw new Error(`${requested} is not available on ${device.name}`);
  return { id, browser, landscape: typeof entry === "string" ? false : Boolean(entry.landscape) };
}

/**
 * @returns {Promise<{ mimeType: string, data: string, width: number, height: number, device: string, name: string, browser: string, engine: string, title: string }>}
 */
export async function headlessScreenshot({ url, device: deviceEntry, mode = "device", frame = true, maxWidth = 1600, fullPage = false, waitMs = 800, storageState, engine = "auto", route }) {
  const entry = normalizeDeviceEntry(deviceEntry);
  const framed = mode === "viewport" ? frame : true;

  // 1. Ask the simulator for this device's geometry: page size, screen, outer frame size.
  const probe = await openRenderPage({ entry, url, mode, frame: framed, deviceScaleFactor: 1 });
  const geometry = await probe.page.evaluate(() => window.__mfsimRender.state().devices[0]);
  await probe.context.close();

  // 2. Load the site with real emulation at that page size.
  const isDesktop = geometry.os === "macos";
  const siteEngine = pickEngine(entry.browser, engine);
  // "device" crops include the 4px outline margin on each side.
  const outputCssWidth = { device: geometry.outer.width + 8, screen: geometry.screen.width, viewport: geometry.viewport.width }[mode];
  const outputScale = Math.min(geometry.dpr, maxWidth / outputCssWidth);
  const site = await loadSite({
    url,
    engine: siteEngine,
    storageState,
    waitMs,
    route,
    contextOptions: {
      viewport: geometry.viewport,
      screen: geometry.screen,
      // A page-only shot is the final image, so it is taken at the output scale directly.
      deviceScaleFactor: mode === "viewport" ? outputScale : geometry.dpr,
      userAgent: geometry.userAgent ?? DESKTOP_USER_AGENTS[entry.browser],
      ...(isDesktop ? {} : { hasTouch: true, isMobile: siteEngine.name !== "firefox" }),
    },
  });

  try {
    const shot = await site.page.screenshot({ type: "png", fullPage: mode === "viewport" && fullPage });
    if (mode === "viewport") {
      return describeImage(shot, outputScale, geometry, entry, siteEngine.name, site.title, { fullPage });
    }

    // 3. Draw the device around the screenshot and capture it on a transparent page.
    const final = await openRenderPage({ entry, url, mode, frame: framed, deviceScaleFactor: outputScale, size: geometry.outer });
    try {
      await final.page.evaluate(
        (page) => window.__mfsimRender.setPage(0, page),
        { src: `data:image/png;base64,${shot.toString("base64")}`, url: site.url, title: site.title, themeColor: site.themeColor },
      );
      const clip = await final.page.evaluate((captureMode) => window.__mfsimRender.rect(0, captureMode), mode);
      const image = await final.page.screenshot({ type: "png", clip, omitBackground: true });
      return describeImage(image, outputScale, geometry, entry, siteEngine.name, site.title, { clip });
    } finally {
      await final.context.close();
    }
  } finally {
    await site.context.close();
  }
}

function pickEngine(browser, requested) {
  if (requested === "chromium" || requested === "webkit") return { name: requested };
  // Safari's engine is WebKit; the others render with Chromium (Playwright's Firefox can't emulate mobile).
  return { name: browser === "safari" ? "webkit" : "chromium" };
}

async function openRenderPage({ entry, url, mode, frame, deviceScaleFactor, size }) {
  const browser = await launch("chromium");
  const context = await browser.newContext({
    viewport: { width: Math.ceil((size?.width ?? 3200) + 96), height: Math.ceil((size?.height ?? 2400) + 96) },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  await page.addInitScript((render) => {
    window.MFSIM_RENDER = render;
  }, { devices: [entry], url, mode, frame });
  // The simulator calls window.stop() as it starts, so "load" never fires; wait for it instead.
  await page.goto(RENDER_PAGE_URL, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__mfsimRender != null, null, { timeout: 15_000 });
  await page.addStyleTag({ path: SIMULATOR_CSS });
  return { context, page };
}

async function loadSite({ url, engine, storageState, waitMs, route, contextOptions }) {
  let browser;
  try {
    browser = await launch(engine.name);
  } catch (error) {
    if (engine.name !== "webkit") throw error;
    engine.name = "chromium";
    browser = await launch("chromium");
  }
  const context = await browser.newContext({ ...contextOptions, ...(storageState ? { storageState } : {}) });
  // Tools (not the MCP tool) can serve the site themselves, e.g. tools/store-images.mjs.
  if (route != null) await context.route("**/*", route);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  const details = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
  }));
  return { context, page, ...details };
}

function describeImage(buffer, scale, geometry, entry, engine, title, { clip, fullPage } = {}) {
  const cssWidth = clip?.width ?? geometry.viewport.width;
  return {
    mimeType: "image/png",
    data: buffer.toString("base64"),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    scale: Math.round(scale * 1000) / 1000,
    cssWidth: Math.round(cssWidth),
    fullPage: Boolean(fullPage),
    device: entry.id,
    name: geometry.name,
    browser: entry.browser,
    engine,
    title,
  };
}
