// Renders the README images (docs/) and the store images (store/images/) from the demo site in
// tools/demo-site/showcase.html, with the headless renderer and the real extension pages.
// Needs `npm install` and `npm run install-browsers` in mcp-server/ first.
//
//   node tools/store-images.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "mcp-server/package.json"));
const { chromium } = require("playwright");
const { headlessScreenshot, closeHeadless } = await import(path.join(root, "mcp-server/headless.mjs"));

// The demo site is served under a made-up address, so the browser bars show a plausible URL.
const SITE = "https://fernway.example/";
const showcase = readFileSync(path.join(root, "tools/demo-site/showcase.html"));
const serveShowcase = (route) =>
  new URL(route.request().url()).hostname === "fernway.example"
    ? route.fulfill({ status: 200, contentType: "text/html", body: showcase })
    : route.abort();

const docsDir = path.join(root, "docs");
const storeDir = path.join(root, "store/images");
mkdirSync(storeDir, { recursive: true });

async function device(entry, { mode = "device", maxWidth = 1600 } = {}) {
  const shot = await headlessScreenshot({ url: SITE, device: entry, mode, maxWidth, waitMs: 200, route: serveShowcase });
  return { ...shot, src: `data:image/png;base64,${shot.data}` };
}

console.log("rendering devices…");
const shots = {
  iphoneSafari: await device({ id: "iphone-15-pro", browser: "safari" }, { maxWidth: 900 }),
  iphoneChrome: await device({ id: "iphone-15-pro", browser: "chrome" }, { maxWidth: 900 }),
  pixel: await device({ id: "pixel-8", browser: "chrome" }, { maxWidth: 900 }),
  pixelFirefox: await device({ id: "pixel-8", browser: "firefox" }, { maxWidth: 900 }),
  ipad: await device({ id: "ipad-mini", browser: "safari" }, { maxWidth: 1400 }),
  macbook: await device({ id: "macbook-pro-14", browser: "chrome" }, { maxWidth: 2000 }),
  dell: await device({ id: "dell-u4025qw", browser: "zen" }, { maxWidth: 2400 }),
};
await closeHeadless();

// README images are the plain transparent device PNGs.
const save = (file, shot) => writeFileSync(file, Buffer.from(shot.data, "base64"));
save(path.join(docsDir, "iphone-safari.png"), shots.iphoneSafari);
save(path.join(docsDir, "macbook-chrome.png"), shots.macbook);
save(path.join(docsDir, "dell-zen.png"), shots.dell);

const browser = await chromium.launch();

// --- the popup, rendered from the real extension page with a stubbed active tab -----------------
const extensionDir = path.join(root, "extension");
const popupContext = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 340, height: 230 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
let [worker] = popupContext.serviceWorkers();
worker ??= await popupContext.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;
await worker.evaluate(() => chrome.storage.local.set({ enabledHosts: ["fernway.example"] }));
const popupPage = await popupContext.newPage();
await popupPage.addInitScript(() => {
  const query = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (filter) => (filter?.active ? [{ id: 1, url: "https://fernway.example/" }] : query(filter));
});
await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
await popupPage.waitForSelector("#site:not([hidden])");
const popupPng = await popupPage.screenshot({ fullPage: true });
writeFileSync(path.join(docsDir, "popup.png"), popupPng);
const popupSrc = `data:image/png;base64,${popupPng.toString("base64")}`;
await popupContext.close();

// --- store images: HTML compositions captured at exact sizes ------------------------------------
const LOGO = `data:image/svg+xml;base64,${readFileSync(path.join(extensionDir, "icons/logo.svg")).toString("base64")}`;
const css = `
  * { box-sizing: border-box; margin: 0; }
  body { width: var(--w); height: var(--h); overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1d2330;
    background: radial-gradient(circle at 15% 0%, #ffffff, #eef1f8 45%, #e2e7f3); display: flex; flex-direction: column; }
  .title { padding: 44px 56px 0; display: flex; align-items: center; gap: 18px; }
  .title img { width: 52px; height: 52px; }
  h1 { font-size: 40px; font-weight: 750; letter-spacing: -1px; line-height: 1.1; }
  h1 em { font-style: normal; color: #4f6ef7; }
  .sub { padding: 10px 56px 0 126px; font-size: 20px; color: #5b6475; }
  .stage { flex: 1; display: flex; align-items: flex-end; justify-content: center; gap: 28px; padding: 24px 40px 0; min-height: 0; }
  .stage img { display: block; filter: drop-shadow(0 18px 30px rgba(20, 30, 60, 0.18)); }
  .wordmark { font-weight: 800; letter-spacing: -1px; }
  .wordmark .a { color: #6b7384; font-weight: 600; } .wordmark .b { color: #4f6ef7; }
  .checker { background: repeating-conic-gradient(#dfe3ea 0 25%, #f7f8fb 0 50%) 0 0 / 24px 24px; border-radius: 22px; padding: 24px 40px 0; }
  .term { width: 520px; border-radius: 14px; background: #161a23; color: #d7dce5; font: 15px/1.6 ui-monospace, "SF Mono", Menlo, monospace; padding: 18px 20px 22px; box-shadow: 0 18px 30px rgba(20, 30, 60, 0.25); align-self: center; }
  .term .dots { display: flex; gap: 7px; margin-bottom: 14px; } .term .dots i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; } .term .dots i:nth-child(2) { background: #febc2e; } .term .dots i:nth-child(3) { background: #28c840; }
  .term .p { color: #8ea2ff; } .term .ok { color: #6fd08c; } .term .dim { color: #7d8597; }
`;
const page = await browser.newPage();
async function compose(name, width, height, body, scale = 1) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>:root{--w:${width}px;--h:${height}px}${css}</style><body>${body}</body>`);
  await page.waitForLoadState("load");
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))));
  const file = path.join(storeDir, name);
  writeFileSync(file, await page.screenshot({ type: "png", scale: scale === 1 ? "css" : "device" }));
  console.log(path.relative(root, file));
}
const img = (shot, height, extra = "") => `<img src="${shot.src}" style="height:${height}px;${extra}">`;
const heading = (title, sub) =>
  `<div class="title"><img src="${LOGO}"><h1>${title}</h1></div><p class="sub">${sub}</p>`;

await compose(
  "screenshot-1-devices.png",
  1280,
  800,
  `${heading("Your site on <em>every screen</em>, side by side", "Phones, tablets, laptops and big displays, in the browser you already use.")}
   <div class="stage">${img(shots.macbook, 520)}${img(shots.ipad, 490, "margin-left:-190px")}${img(shots.iphoneSafari, 450, "margin-left:-110px")}</div>`,
);
await compose(
  "screenshot-2-browsers.png",
  1280,
  800,
  `${heading("The browser <em>your users</em> actually use", "Safari, Chrome, Firefox or Zen per device, with their bars, user agents and touch input.")}
   <div class="stage">${img(shots.iphoneSafari, 560)}${img(shots.iphoneChrome, 560)}${img(shots.pixel, 560)}${img(shots.pixelFirefox, 560)}</div>`,
);
await compose(
  "screenshot-3-transparent.png",
  1280,
  800,
  `${heading("<em>Transparent</em> PNG screenshots", "The device with its frame, the screen, or only the page. Ready for docs, slides and store pages.")}
   <div class="stage" style="padding-bottom:36px"><div class="stage checker" style="flex:none;padding:28px 60px">${img(shots.iphoneSafari, 500)}${img(shots.ipad, 500)}</div></div>`,
);
await compose(
  "screenshot-4-mcp.png",
  1280,
  800,
  `${heading("Let <em>AI agents</em> check your layout", "An MCP server lets Claude Code and other agents open pages on devices and take screenshots.")}
   <div class="stage" style="align-items:center;padding-bottom:40px">
     <div class="term"><div class="dots"><i></i><i></i><i></i></div>
       <div><span class="p">&gt;</span> check the home page on iPhone and Pixel</div>
       <div class="dim">⏺ view_sim_headless_screenshot</div>
       <div class="dim">&nbsp;&nbsp;url: https://fernway.example/</div>
       <div class="dim">&nbsp;&nbsp;devices: iphone-15-pro, pixel-8</div>
       <div class="ok">&nbsp;&nbsp;✓ 2 screenshots</div>
       <div style="margin-top:8px">Both hold up: the menu collapses to an icon and the cart button stays in view.</div>
     </div>
     ${img(shots.iphoneSafari, 560)}${img(shots.pixel, 560)}
   </div>`,
);
await compose(
  "screenshot-5-popup.png",
  1280,
  800,
  `${heading("<em>One switch</em> per site", "Turn it on from the toolbar and every page of that site opens on your devices. Nothing is collected.")}
   <div class="stage" style="align-items:center;padding-bottom:60px;gap:56px">
     <img src="${popupSrc}" style="width:520px;border-radius:16px;border:1px solid #dfe3ea">
     ${img(shots.iphoneSafari, 560)}
   </div>`,
);
await compose(
  "promo-small-440x280.png",
  440,
  280,
  `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(135deg,#ffffff,#e6ebfb)">
     <div style="display:flex;align-items:center;gap:12px"><img src="${LOGO}" style="width:54px"><div class="wordmark" style="font-size:44px"><span class="a">view-</span><span class="b">sim</span></div></div>
     <div style="font-size:17px;color:#5b6475;text-align:center;line-height:1.35">Every device, side by side,<br>in your own browser</div>
   </div>`,
);
await compose(
  "promo-marquee-1400x560.png",
  1400,
  560,
  `<div style="flex:1;display:flex;align-items:center;gap:40px;padding:0 0 0 80px;background:linear-gradient(135deg,#ffffff,#e6ebfb)">
     <div style="flex:none;width:470px">
       <div style="display:flex;align-items:center;gap:14px"><img src="${LOGO}" style="width:64px"><div class="wordmark" style="font-size:56px"><span class="a">view-</span><span class="b">sim</span></div></div>
       <div style="margin-top:18px;font-size:26px;line-height:1.3;color:#3a4252">Your site on phones, tablets and laptops, side by side. Transparent screenshots. An MCP server for agents.</div>
     </div>
     <div class="stage" style="align-self:stretch;padding:40px 0 0">${img(shots.macbook, 400)}${img(shots.iphoneSafari, 380, "margin-left:-120px")}</div>
   </div>`,
);
await browser.close();
